import { access, cp, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktopDirectory = path.join(projectDirectory, 'desktop');
const serverExecutable = path.join(projectDirectory, 'dist', 'HomeAuctionServer.exe');
const cloudflaredExecutable = path.join(projectDirectory, 'build', 'cloudflared.exe');
const outputDirectory = path.join(projectDirectory, 'dist', 'HomeAuction');
const resourcesDirectory = path.join(outputDirectory, 'resources');
const appDirectory = path.join(resourcesDirectory, 'app');
const serverOutputDirectory = path.join(outputDirectory, 'server');
const electronVersion = JSON.parse(
  await readFile(path.join(desktopDirectory, 'package.json'), 'utf8')
).devDependencies.electron;

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} завершился с кодом ${result.status ?? 'неизвестен'}.`);
  }
}

async function prepareServer() {
  if (await exists(serverExecutable) && await exists(cloudflaredExecutable)) return;
  console.log('Подготавливаются серверный EXE и cloudflared...');
  run('npm', ['run', 'build:exe'], {
    cwd: projectDirectory,
    shell: process.platform === 'win32'
  });
}

async function getRuntimeDirectory(temporaryDirectory) {
  const installedRuntime = path.join(projectDirectory, 'node_modules', 'electron', 'dist');
  if (await exists(path.join(installedRuntime, 'electron.exe'))) return installedRuntime;

  if (process.platform !== 'win32') {
    throw new Error('Portable-клиент собирается только на Windows x64.');
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const archive = path.join(
    localAppData,
    'electron',
    'Cache',
    `electron-v${electronVersion}-win32-x64.zip`
  );
  if (!(await exists(archive))) {
    throw new Error(
      `Не найден кэшированный Electron runtime: ${archive}. ` +
      'Запустите npm ci или предоставьте официальный Electron runtime; повторная загрузка не выполнялась.'
    );
  }

  const powershell = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  );
  const extractionDirectory = path.join(temporaryDirectory, 'runtime');
  await mkdir(extractionDirectory, { recursive: true });
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  const command = `$ErrorActionPreference = 'Stop'; ` +
    `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(extractionDirectory)} -Force`;
  run(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  return extractionDirectory;
}

await prepareServer();
if (process.platform !== 'win32') {
  throw new Error('Сборка portable-клиента поддерживается только на Windows x64.');
}
await access(serverExecutable);
await access(cloudflaredExecutable);

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'homeauction-desktop-'));
try {
  const runtimeDirectory = await getRuntimeDirectory(temporaryDirectory);
  await access(path.join(runtimeDirectory, 'electron.exe'));
  await access(path.join(runtimeDirectory, 'resources', 'default_app.asar'));
  await mkdir(outputDirectory, { recursive: true });
  await cp(runtimeDirectory, outputDirectory, { recursive: true, force: true });

  const packagedExecutable = path.join(outputDirectory, 'HomeAuction.exe');
  await copyFile(path.join(runtimeDirectory, 'electron.exe'), packagedExecutable);
  await rm(path.join(outputDirectory, 'electron.exe'), { force: true });

  await mkdir(appDirectory, { recursive: true });
  for (const file of ['main.js', 'preload.js', 'process-job.ps1', 'tunnel-utils.js']) {
    await copyFile(path.join(desktopDirectory, file), path.join(appDirectory, file));
  }
  await cp(path.join(desktopDirectory, 'ui'), path.join(appDirectory, 'ui'), {
    recursive: true,
    force: true
  });
  await writeFile(path.join(appDirectory, 'package.json'), JSON.stringify({
    name: 'homeauction-desktop',
    version: '1.0.0',
    main: 'main.js'
  }, null, 2));

  await mkdir(serverOutputDirectory, { recursive: true });
  await copyFile(serverExecutable, path.join(serverOutputDirectory, 'HomeAuctionServer.exe'));
  await copyFile(cloudflaredExecutable, path.join(resourcesDirectory, 'cloudflared.exe'));
  await copyFile(
    path.join(desktopDirectory, 'process-job.ps1'),
    path.join(resourcesDirectory, 'process-job.ps1')
  );
  await copyFile(
    path.join(desktopDirectory, 'ui', 'tray.svg'),
    path.join(resourcesDirectory, 'tray.svg')
  );

  console.log(`Готово: ${path.relative(projectDirectory, packagedExecutable)}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
