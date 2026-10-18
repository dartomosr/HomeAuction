import { access, mkdir, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binaryDirectory = path.join(projectDirectory, 'build');
const cloudflaredPath = path.join(binaryDirectory, 'cloudflared.exe');
const outputPath = path.join(projectDirectory, 'dist', 'HomeAuctionServer.exe');
const cloudflaredUrl = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe';

await mkdir(binaryDirectory, { recursive: true });
await mkdir(path.dirname(outputPath), { recursive: true });

let cloudflaredExists = true;
try {
  await access(cloudflaredPath);
} catch {
  cloudflaredExists = false;
}

if (process.env.REFRESH_CLOUDFLARED === '1' || !cloudflaredExists) {
  console.log('Загрузка cloudflared для Windows x64...');
  const download = await fetch(cloudflaredUrl);
  if (!download.ok) {
    throw new Error(`Не удалось загрузить cloudflared: HTTP ${download.status} ${download.statusText}`);
  }
  await writeFile(cloudflaredPath, Buffer.from(await download.arrayBuffer()));
}

console.log('Сборка HomeAuctionServer.exe (Node.js 22, Windows x64)...');
const pkgEntrypoint = path.join(projectDirectory, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
const build = spawnSync(process.execPath, [
  pkgEntrypoint,
  path.join(projectDirectory, 'server.js'),
  '--target',
  'node22-win-x64',
  '--output',
  outputPath
], {
  cwd: projectDirectory,
  stdio: 'inherit'
});

if (build.error) throw build.error;
if (build.status !== 0) {
  throw new Error(`Сборка завершилась с кодом ${build.status ?? 'неизвестен'}.`);
}

console.log(`Готово: ${path.relative(projectDirectory, outputPath)}`);
