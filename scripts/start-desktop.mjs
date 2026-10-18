import { access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverExecutable = path.join(projectDirectory, 'dist', 'HomeAuctionServer.exe');
const cloudflaredExecutable = path.join(projectDirectory, 'build', 'cloudflared.exe');

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

if (!(await exists(serverExecutable)) || !(await exists(cloudflaredExecutable))) {
  const buildServer = spawnSync('npm', ['run', 'build:exe'], {
    cwd: projectDirectory,
    stdio: 'inherit',
    shell: process.platform === 'win32'
  });
  if (buildServer.error) throw buildServer.error;
  if (buildServer.status !== 0) {
    throw new Error(`Сборка серверного EXE завершилась с кодом ${buildServer.status ?? 'неизвестен'}.`);
  }
}

const startDesktop = spawnSync('npm', ['--workspace', 'desktop', 'run', 'start'], {
  cwd: projectDirectory,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});
if (startDesktop.error) throw startDesktop.error;
if (startDesktop.status !== 0) {
  throw new Error(`Запуск настольного клиента завершился с кодом ${startDesktop.status ?? 'неизвестен'}.`);
}
