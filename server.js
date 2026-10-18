const express = require('express');
const http = require('http');
const fs = require('fs');
const os = require('os');
const { Server } = require('socket.io');
const path = require('path');
const { spawn } = require('child_process');
const { registerSocketHandlers } = require('./src/socket-handlers');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));
registerSocketHandlers(io);

const PORT = Number(process.env.PORT || 3000);
const tunnelProtocolValues = new Set(['auto', 'quic', 'http2']);
let tunnelProtocol = (process.env.CLOUDFLARE_PROTOCOL || 'auto').toLowerCase();
if (!tunnelProtocolValues.has(tunnelProtocol)) {
  console.warn(`Предупреждение: неизвестный CLOUDFLARE_PROTOCOL "${process.env.CLOUDFLARE_PROTOCOL}". Используется auto.`);
  tunnelProtocol = 'auto';
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(`Некорректный PORT: ${process.env.PORT}. Укажите порт от 1 до 65535.`);
  process.exit(1);
}

let tunnel = null;
let shuttingDown = false;
let tunnelErrorReported = false;
const localAddress = `http://127.0.0.1:${PORT}`;

function reportTunnelError(message) {
  if (!tunnelErrorReported) {
    console.error(`Cloudflare Tunnel недоступен. Локальный сервер продолжает работать: ${localAddress}`);
    tunnelErrorReported = true;
  }
  console.error(message);
}

function getTunnelBinaryPath() {
  const appData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const binaryDirectory = path.join(appData, 'HomeAuction', 'bin');
  const binaryPath = path.join(binaryDirectory, 'cloudflared.exe');
  const embeddedPath = path.join(__dirname, 'build', 'cloudflared.exe');
  const embeddedBinary = fs.readFileSync(embeddedPath);

  fs.mkdirSync(binaryDirectory, { recursive: true });
  if (!fs.existsSync(binaryPath) || !fs.readFileSync(binaryPath).equals(embeddedBinary)) {
    const temporaryPath = `${binaryPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, embeddedBinary);
    fs.rmSync(binaryPath, { force: true });
    fs.renameSync(temporaryPath, binaryPath);
  }

  return binaryPath;
}

function startTunnel() {
  let binaryPath;
  try {
    binaryPath = getTunnelBinaryPath();
  } catch (error) {
    reportTunnelError(`Не удалось подготовить Cloudflare Tunnel: ${error.message}`);
    return;
  }

  console.log(`Запускается Cloudflare Tunnel (protocol=${tunnelProtocol})...`);
  tunnel = spawn(binaryPath, [
    'tunnel',
    '--protocol',
    tunnelProtocol,
    '--url',
    localAddress
  ], {
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const reportOutput = (chunk) => {
    const text = chunk.toString();
    const publicUrl = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);
    if (publicUrl) {
      console.log(`Публичный адрес: ${publicUrl[0]}`);
    }
    const errorLines = text.split(/\r?\n/).filter(line => /\b(ERR|ERROR|FATAL)\b/i.test(line));
    if (errorLines.length > 0) {
      const portBlocked = errorLines.some(line =>
        /7844|allow outbound.*(?:quic|tcp)|outbound.*(?:quic|tcp)/i.test(line)
      );
      if (portBlocked) {
        reportTunnelError(
          'Сеть блокирует исходящие UDP/TCP-соединения Cloudflare на порту 7844. ' +
          'Попробуйте другую сеть или задайте CLOUDFLARE_PROTOCOL=http2.'
        );
      }
      for (const line of errorLines) {
        console.error(`Cloudflare Tunnel: ${line.trim()}`);
      }
      if (!portBlocked) {
        reportTunnelError(`Cloudflare Tunnel: ${errorLines.join('\n')}`);
      }
    }
  };

  tunnel.stdout.on('data', reportOutput);
  tunnel.stderr.on('data', reportOutput);
  tunnel.on('error', (error) => {
    reportTunnelError(`Не удалось запустить Cloudflare Tunnel: ${error.message}`);
  });
  tunnel.on('close', (code, signal) => {
    tunnel = null;
    if (!shuttingDown) {
      console.error(`Cloudflare Tunnel завершился (код ${code ?? 'неизвестен'}, сигнал ${signal ?? 'нет'}).`);
      console.error(`Локальный сервер продолжает работать: ${localAddress}`);
    }
  });
}

function closeServer() {
  return new Promise((resolve) => {
    io.close(() => resolve());
    server.closeAllConnections();
  });
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nЗавершение HomeAuction (${signal})...`);

  const tunnelExit = tunnel
    ? new Promise((resolve) => tunnel.once('close', resolve))
    : Promise.resolve();
  if (tunnel) tunnel.kill();

  await Promise.all([closeServer(), tunnelExit]);
  console.log('Сервер и Cloudflare Tunnel остановлены.');
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    shutdown(signal).catch((error) => {
      console.error(`Ошибка при завершении HomeAuction: ${error.message}`);
      process.exitCode = 1;
    });
  });
}
if (process.platform === 'win32') {
  process.on('SIGBREAK', () => {
    shutdown('SIGBREAK').catch((error) => {
      console.error(`Ошибка при завершении HomeAuction: ${error.message}`);
      process.exitCode = 1;
    });
  });
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Порт ${PORT} уже используется. Освободите его или задайте другой через переменную окружения PORT.`);
    process.exitCode = 1;
    io.close();
    return;
  }
  console.error(`Не удалось запустить сервер: ${error.message}`);
  process.exitCode = 1;
  io.close();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=========================================`);
  console.log(`Сервер готов: ${localAddress}`);
  console.log(`=========================================`);
  if (process.pkg && process.env.HOMEAUCTION_MANAGED !== '1') startTunnel();
});
