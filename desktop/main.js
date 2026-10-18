const { app, BrowserWindow, Tray, Menu, clipboard, ipcMain, nativeImage, shell } = require('electron');
const { spawn, execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const { classifyTunnelLine, createLineBuffer, normalizeProtocol } = require('./tunnel-utils');

const execFileAsync = promisify(execFile);
const localAppDirectory = path.join(
  process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
  'HomeAuction',
  'bin'
);
const state = {
  server: 'Запускается',
  serverAddress: '',
  tunnel: 'Остановлен',
  publicAddress: '',
  tunnelDiagnostic: '',
  protocol: 'auto',
  log: []
};

let mainWindow;
let tray;
let serverProcess;
let tunnelProcess;
let jobGuard;
let jobGuardReady = false;
let serverReady = false;
let tunnelStopping = false;
let serverStopping = false;
let isQuitting = false;
let exitStarted = false;
let tunnelStarting = false;
let tunnelStartCancelled = false;
let tunnelBlockedProtocols = new Set();

function publishState() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('homeauction:state', { ...state, log: [...state.log] });
  }
  if (tray) {
    tray.setToolTip(
      `HomeAuction — сервер ${state.server.toLowerCase()}, туннель ${state.tunnel.toLowerCase()}`
    );
  }
}

function addLog(message, source = 'Приложение') {
  for (const line of String(message).split(/\r?\n/).filter(Boolean)) {
    state.log.push(`${new Date().toLocaleTimeString()} [${source}] ${line}`);
  }
  if (state.log.length > 200) state.log.splice(0, state.log.length - 200);
  publishState();
}

function setServerStatus(status) {
  state.server = status;
  publishState();
}

function setTunnelStatus(status) {
  state.tunnel = status;
  publishState();
}

function getServerExecutable() {
  return app.isPackaged
    ? path.join(path.dirname(process.resourcesPath), 'server', 'HomeAuctionServer.exe')
    : path.resolve(__dirname, '..', 'dist', 'HomeAuctionServer.exe');
}

function getBundledTunnelExecutable() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'cloudflared.exe')
    : path.resolve(__dirname, '..', 'build', 'cloudflared.exe');
}

async function getTunnelExecutable() {
  const bundledPath = getBundledTunnelExecutable();
  const bundledBuffer = await fsp.readFile(bundledPath);
  await fsp.mkdir(localAppDirectory, { recursive: true });
  const executablePath = path.join(localAppDirectory, 'cloudflared.exe');
  let currentBuffer;
  try {
    currentBuffer = await fsp.readFile(executablePath);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  if (!currentBuffer || !currentBuffer.equals(bundledBuffer)) {
    const temporaryPath = `${executablePath}.${process.pid}.tmp`;
    await fsp.writeFile(temporaryPath, bundledBuffer);
    await fsp.rm(executablePath, { force: true });
    await fsp.rename(temporaryPath, executablePath);
  }
  return executablePath;
}

function validateProtocol(value = process.env.CLOUDFLARE_PROTOCOL || 'auto') {
  const result = normalizeProtocol(value);
  if (result.invalidValue !== null) {
    addLog(`Неизвестный CLOUDFLARE_PROTOCOL «${result.invalidValue}», используется auto.`);
  }
  return result.protocol;
}

function startJobGuard() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const powershellPath = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const scriptPath = app.isPackaged
    ? path.join(process.resourcesPath, 'process-job.ps1')
    : path.join(__dirname, 'process-job.ps1');
  jobGuard = spawn(powershellPath, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath,
    '-ProcessId',
    String(process.pid)
  ], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  return new Promise((resolve) => {
    let resolved = false;
    let pending = '';
    const complete = (ready) => {
      if (resolved) return;
      resolved = true;
      jobGuardReady = ready;
      clearTimeout(timeout);
      resolve(ready);
    };
    const timeout = setTimeout(() => {
      addLog('Windows Job Object не подтвердил запуск за 10 секунд; будет использована остановка дерева процессов.');
      complete(false);
    }, 10000);

    jobGuard.stdout.setEncoding('utf8');
    jobGuard.stdout.on('data', (chunk) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) {
        if (line === 'JOB_READY') {
          addLog('Windows Job Object активен: дочерние процессы завершатся вместе с приложением.');
          complete(true);
        } else if (line === 'JOB_DISARMED') {
          addLog('Windows Job Object отключён для штатного завершения.');
        } else if (line.trim()) {
          addLog(line.trim(), 'Job Object');
        }
      }
    });
    jobGuard.stderr.setEncoding('utf8');
    jobGuard.stderr.on('data', (chunk) => addLog(chunk.trim(), 'Job Object'));
    jobGuard.once('error', (error) => {
      addLog(`Не удалось запустить Windows Job Object: ${error.message}`);
      complete(false);
    });
    jobGuard.once('close', (code) => {
      if (!resolved) {
        addLog(`Windows Job Object завершился до готовности (код ${code ?? 'нет'}).`);
        complete(false);
      }
      jobGuardReady = false;
      jobGuard = null;
    });
  });
}

function findFreePort(port = 3000) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE' && port < 65535) {
        resolve(findFreePort(port + 1));
        return;
      }
      reject(error);
    });
    probe.listen(port, '127.0.0.1', () => {
      const selectedPort = probe.address().port;
      probe.close((error) => error ? reject(error) : resolve(selectedPort));
    });
  });
}

function requestServerStatus(address) {
  return new Promise((resolve) => {
    const request = http.get(address, { timeout: 1200 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.once('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.once('error', () => resolve(false));
  });
}

function waitForServer(child, address, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    let finished = false;
    const check = async () => {
      if (finished) return;
      if (child.exitCode !== null) {
        finished = true;
        reject(new Error('Серверный процесс завершился до начала ответа HTTP.'));
        return;
      }
      if (await requestServerStatus(address)) {
        finished = true;
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        finished = true;
        reject(new Error('Сервер не ответил HTTP 200 за 30 секунд.'));
        return;
      }
      setTimeout(check, 400);
    };
    check();
  });
}

function attachOutput(child, source, handleLine) {
  for (const stream of [child.stdout, child.stderr]) {
    if (!stream) continue;
    const lineBuffer = createLineBuffer((line) => {
      if (!line.trim()) return;
      if (handleLine(line) !== false) addLog(line.trim(), source);
    });
    stream.setEncoding('utf8');
    stream.on('data', lineBuffer.push);
    stream.on('end', lineBuffer.end);
  }
}

async function ensureServerStarted() {
  if (serverReady && serverProcess && serverProcess.exitCode === null) return;
  if (serverProcess && serverProcess.exitCode === null) {
    throw new Error('Сервер уже запускается.');
  }

  const serverExecutable = getServerExecutable();
  await fsp.access(serverExecutable);
  const port = await findFreePort();
  state.serverAddress = `http://127.0.0.1:${port}`;
  state.publicAddress = '';
  setServerStatus('Запускается');
  addLog(`Выбран свободный порт ${port}. Запуск сервера...`);

  serverProcess = spawn(serverExecutable, [], {
    env: {
      ...process.env,
      PORT: String(port),
      HOMEAUCTION_MANAGED: '1'
    },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const child = serverProcess;
  attachOutput(child, 'Сервер', () => {});
  child.once('error', (error) => {
    if (serverProcess !== child) return;
    setServerStatus('Ошибка');
    addLog(`Не удалось запустить сервер: ${error.message}`);
  });
  child.once('close', (code, signal) => {
    if (serverProcess !== child) return;
    serverProcess = null;
    serverReady = false;
    if (!serverStopping && !isQuitting) {
      setServerStatus('Ошибка');
      state.publicAddress = '';
      addLog(`Сервер завершился (код ${code ?? 'нет'}, сигнал ${signal ?? 'нет'}).`);
      void stopTunnel();
    } else {
      setServerStatus('Остановлен');
    }
  });

  try {
    await waitForServer(child, state.serverAddress);
    if (child.exitCode !== null || serverProcess !== child) {
      throw new Error('Сервер завершился при проверке готовности.');
    }
    serverReady = true;
    setServerStatus('Запущен');
    addLog(`Сервер готов, HTTP 200: ${state.serverAddress}`);
  } catch (error) {
    setServerStatus('Ошибка');
    addLog(error.message);
    await terminateProcessTree(child);
    if (serverProcess === child) serverProcess = null;
    throw error;
  }
}

function reportTunnelLine(line) {
  const event = classifyTunnelLine(line);
  if (event.publicAddress) {
    if (state.publicAddress === event.publicAddress) return false;
    state.publicAddress = event.publicAddress;
    publishState();
  }

  if (event.connected) {
    setTunnelStatus('Подключён');
  }

  if (event.blockedProtocol) {
    tunnelBlockedProtocols.add(event.blockedProtocol);
    const blocked = [...tunnelBlockedProtocols];
    const message = blocked.length > 1
      ? 'Предупреждение: cloudflared сообщил о проблемах отдельных узлов QUIC и TCP порта 7844 при проверке. Это не означает полной блокировки сети и само по себе не меняет работу туннеля; ориентируйтесь на его статус.'
      : event.blockedProtocol === 'quic'
        ? 'Предупреждение: cloudflared сообщил о проблеме QUIC на одном из узлов UDP/7844 при проверке. Это не доказывает блокировку всех узлов и само по себе не меняет работу туннеля.'
        : 'Предупреждение: cloudflared сообщил о проблеме TCP на одном из узлов порта 7844 при проверке. Это не доказывает блокировку всех узлов и само по себе не меняет работу туннеля.';
    const isNewDiagnostic = state.tunnelDiagnostic !== message;
    state.tunnelDiagnostic = message;
    if (isNewDiagnostic) addLog(message);
    return;
  }

  if (event.originError) {
    const message = `Cloudflare не достигает локальный origin ${state.serverAddress}; сервер должен отвечать HTTP 200.`;
    const isNewDiagnostic = state.tunnelDiagnostic !== message;
    state.tunnelDiagnostic = message;
    setTunnelStatus('Ошибка');
    if (isNewDiagnostic) addLog(message);
    return;
  }

  if (event.isError) {
    state.tunnelDiagnostic = 'Ошибка Cloudflare Tunnel. Локальный сервер продолжает работать; подробности см. в журнале.';
    setTunnelStatus('Ошибка');
  }

  return true;
}

async function startTunnel() {
  if (tunnelProcess && tunnelProcess.exitCode === null) return;
  if (tunnelStarting) return;
  if (state.server !== 'Запущен' || !serverReady || !state.serverAddress) {
    throw new Error('Сначала дождитесь запуска сервера.');
  }
  tunnelStarting = true;
  tunnelStartCancelled = false;
  state.publicAddress = '';
  state.tunnelDiagnostic = '';
  tunnelBlockedProtocols = new Set();
  tunnelStopping = false;
  setTunnelStatus('Запускается');
  try {
    if (!(await requestServerStatus(state.serverAddress))) {
      throw new Error('Сервер не отвечает HTTP 200; туннель не запущен.');
    }
    if (tunnelStartCancelled || isQuitting) return;

    const binaryPath = await getTunnelExecutable();
    if (tunnelStartCancelled || isQuitting) return;
    state.protocol = validateProtocol();
    addLog(`Запуск Cloudflare Tunnel после проверки HTTP 200 (protocol=${state.protocol}).`);
    tunnelProcess = spawn(binaryPath, [
      'tunnel',
      '--protocol',
      state.protocol,
      '--url',
      state.serverAddress
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const child = tunnelProcess;
    attachOutput(child, 'Cloudflare', reportTunnelLine);
    child.once('error', (error) => {
      if (tunnelProcess !== child) return;
      state.tunnelDiagnostic = `Не удалось запустить cloudflared: ${error.message}`;
      setTunnelStatus('Ошибка');
      addLog(state.tunnelDiagnostic);
    });
    child.once('close', (code, signal) => {
      if (tunnelProcess !== child) return;
      tunnelProcess = null;
      if (!tunnelStopping && !isQuitting) {
        state.publicAddress = '';
        if (state.tunnel !== 'Недоступна сеть') setTunnelStatus('Ошибка');
        addLog(`Cloudflare Tunnel завершился (код ${code ?? 'нет'}, сигнал ${signal ?? 'нет'}). Локальный сервер продолжает работать.`);
      } else if (!isQuitting) {
        setTunnelStatus('Остановлен');
      }
    });
  } catch (error) {
    state.tunnelDiagnostic = error.message;
    setTunnelStatus('Ошибка');
    addLog(error.message);
    throw error;
  } finally {
    tunnelStarting = false;
  }
}

async function terminateProcessTree(child) {
  if (!child || child.exitCode !== null) return;
  const closed = new Promise((resolve) => child.once('close', resolve));
  if (process.platform === 'win32' && child.pid) {
    try {
      await execFileAsync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        timeout: 7000
      });
    } catch (error) {
      if (child.exitCode === null) {
        child.kill();
        addLog(`taskkill не завершил процесс ${child.pid}: ${error.message}; отправлен резервный сигнал.`);
      }
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 7500))
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await Promise.race([
      closed,
      new Promise((resolve) => setTimeout(resolve, 3000))
    ]);
    if (child.exitCode === null) {
      throw new Error(`Процесс ${child.pid} не завершился после остановки дерева процессов.`);
    }
  }
}

async function stopTunnel() {
  tunnelStartCancelled = true;
  const child = tunnelProcess;
  if (!child) {
    setTunnelStatus('Остановлен');
    state.publicAddress = '';
    state.tunnelDiagnostic = '';
    return;
  }
  tunnelStopping = true;
  setTunnelStatus('Остановлен');
  state.publicAddress = '';
  state.tunnelDiagnostic = '';
  tunnelProcess = null;
  await terminateProcessTree(child);
  addLog('Cloudflare Tunnel остановлен.');
}

async function stopServer() {
  const child = serverProcess;
  if (!child) {
    serverReady = false;
    setServerStatus('Остановлен');
    state.serverAddress = '';
    return;
  }
  serverStopping = true;
  serverReady = false;
  setServerStatus('Остановлен');
  serverProcess = null;
  await terminateProcessTree(child);
  serverStopping = false;
  state.serverAddress = '';
  addLog('Сервер остановлен.');
}

async function openAddress(kind) {
  const address = kind === 'local' ? state.serverAddress : state.publicAddress;
  if (!address || !/^https?:\/\/(?:127\.0\.0\.1|[a-z0-9.-]+\.trycloudflare\.com)(?::\d+)?$/i.test(address)) {
    throw new Error('Адрес сейчас недоступен.');
  }
  await shell.openExternal(address);
}

function copyAddress(kind) {
  const address = kind === 'local' ? state.serverAddress : state.publicAddress;
  if (!address) throw new Error('Адрес сейчас недоступен.');
  clipboard.writeText(address);
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'tray.svg')
    : path.join(__dirname, 'ui', 'tray.svg');
  let icon = nativeImage.createFromPath(iconPath);
  if (icon.isEmpty()) {
    icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII='
    );
  }
  tray = new Tray(icon.resize({ width: 16, height: 16 }));
  tray.setToolTip('HomeAuction');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть HomeAuction', click: () => openAddress('local').catch(showError) },
    { label: 'Открыть окно управления', click: showMainWindow },
    { type: 'separator' },
    { label: 'Скопировать локальный адрес', click: () => {
      try { copyAddress('local'); } catch (error) { showError(error); }
    } },
    { label: 'Скопировать публичный адрес', click: () => {
      try { copyAddress('public'); } catch (error) { showError(error); }
    } },
    { type: 'separator' },
    { label: 'Запустить туннель', click: () => startTunnel().catch(showError) },
    { label: 'Остановить туннель', click: () => stopTunnel().catch(showError) },
    { type: 'separator' },
    { label: 'Выйти', click: () => app.quit() }
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

function showError(error) {
  addLog(error && error.message ? error.message : String(error));
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 760,
    height: 760,
    minWidth: 620,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    title: 'HomeAuction',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'));
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    publishState();
  });
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function shutdown() {
  if (exitStarted) return;
  exitStarted = true;
  isQuitting = true;
  addLog('Остановка дочерних процессов...');
  const errors = [];
  try {
    await stopTunnel();
  } catch (error) {
    errors.push(error);
  }
  try {
    await stopServer();
  } catch (error) {
    errors.push(error);
  }
  try {
    await stopJobGuard();
  } catch (error) {
    errors.push(error);
  }
  for (const error of errors) addLog(`Ошибка завершения: ${error.message}`);
  if (tray) tray.destroy();
  app.exit(errors.length ? 1 : 0);
}

async function stopJobGuard() {
  const child = jobGuard;
  if (!child) return;
  if (jobGuardReady && child.exitCode === null) {
    child.stdin.write('DISARM\n');
    await Promise.race([
      new Promise((resolve) => child.once('close', resolve)),
      new Promise((resolve) => setTimeout(resolve, 5000))
    ]);
  }
  if (child.exitCode === null) {
    await terminateProcessTree(child);
  }
  jobGuard = null;
  jobGuardReady = false;
}

function registerIpcHandlers() {
  ipcMain.handle('homeauction:get-state', () => ({ ...state, log: [...state.log] }));
  ipcMain.handle('homeauction:start-tunnel', async () => {
    await startTunnel();
    return { ...state, log: [...state.log] };
  });
  ipcMain.handle('homeauction:stop-tunnel', async () => {
    await stopTunnel();
    return { ...state, log: [...state.log] };
  });
  ipcMain.handle('homeauction:open-address', (_event, kind) => openAddress(kind));
  ipcMain.handle('homeauction:copy-address', (_event, kind) => copyAddress(kind));
  ipcMain.handle('homeauction:minimize', () => {
    if (mainWindow) mainWindow.hide();
  });
  ipcMain.handle('homeauction:quit', () => app.quit());
}

const hasSingleInstance = app.requestSingleInstanceLock();
if (!hasSingleInstance) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
  app.on('before-quit', (event) => {
    if (exitStarted) return;
    event.preventDefault();
    void shutdown();
  });
  app.whenReady().then(async () => {
    registerIpcHandlers();
    createTray();
    createMainWindow();
    state.protocol = validateProtocol();
    await startJobGuard();
    try {
      await ensureServerStarted();
    } catch (error) {
      setServerStatus('Ошибка');
      addLog(`Не удалось запустить сервер: ${error.message}`);
      return;
    }
    try {
      await startTunnel();
    } catch (error) {
      setTunnelStatus('Ошибка');
      addLog(`Туннель не запущен; локальный сервер продолжает работать: ${error.message}`);
    }
  }).catch((error) => {
    showError(error);
  });
  app.on('window-all-closed', () => {});
}
