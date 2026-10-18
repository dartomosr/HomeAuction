import { access, mkdir, mkdtemp, rename, rm, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

const projectDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portableDirectory = path.join(projectDirectory, 'dist', 'HomeAuction');
const outputDirectory = path.join(projectDirectory, 'dist');
const outputPath = path.join(outputDirectory, 'HomeAuction-Portable.exe');
const requiredPaths = [
  path.join(portableDirectory, 'HomeAuction.exe'),
  path.join(portableDirectory, 'resources'),
  path.join(portableDirectory, 'server')
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} завершился с кодом ${result.status ?? 'неизвестен'}.`);
  }
}

function registryInstallPaths() {
  const paths = [];
  for (const key of [
    'HKLM\\Software\\7-Zip',
    'HKLM\\Software\\WOW6432Node\\7-Zip',
    'HKCU\\Software\\7-Zip'
  ]) {
    const result = spawnSync('reg.exe', ['query', key, '/v', 'Path64'], {
      encoding: 'utf8',
      windowsHide: true
    });
    const match = result.stdout?.match(/Path64\s+REG_SZ\s+(.+?)\s*$/im);
    if (match) paths.push(match[1].trim());
  }
  return paths;
}

async function find7Zip() {
  if (process.platform !== 'win32') {
    throw new Error('Сборка Windows SFX доступна только на Windows.');
  }

  const candidates = [];
  if (process.env.SEVEN_ZIP_PATH) {
    const configuredPath = process.env.SEVEN_ZIP_PATH;
    candidates.push(path.basename(configuredPath).toLowerCase() === '7z.exe'
      ? path.dirname(configuredPath)
      : configuredPath);
  }

  const where = spawnSync('where.exe', ['7z.exe'], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (where.status === 0) {
    candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean).map(path.dirname));
  }
  candidates.push(...registryInstallPaths());
  candidates.push(
    path.join(process.env.ProgramW6432 || 'C:\\Program Files', '7-Zip'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip')
  );

  for (const directory of [...new Set(candidates)]) {
    const executable = path.join(directory, '7z.exe');
    const module = path.join(directory, '7z.sfx');
    try {
      await Promise.all([access(executable), access(module)]);
      return { executable, module };
    } catch {
      continue;
    }
  }

  throw new Error(
    'Не найдены 7z.exe и стандартный GUI SFX-модуль 7z.sfx. ' +
    'Установите 7-Zip для Windows с официального сайта; дополнительные модули не скачиваются.'
  );
}

await Promise.all(requiredPaths.map(async (requiredPath) => {
  try {
    await access(requiredPath);
  } catch {
    throw new Error(
      `Portable-сборка отсутствует или неполна: не найден ${requiredPath}. ` +
      'Сначала выполните npm run build:desktop.'
    );
  }
}));

const sevenZip = await find7Zip();
await mkdir(outputDirectory, { recursive: true });

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'homeauction-sfx-'));
const archivePath = path.join(temporaryDirectory, 'HomeAuction.7z');
const temporaryOutputPath = path.join(outputDirectory, `.HomeAuction-Portable-${process.pid}.tmp`);

try {
  console.log(`Архивация содержимого ${path.relative(projectDirectory, portableDirectory)}...`);
  run(sevenZip.executable, [
    'a',
    '-t7z',
    '-mx=1',
    '-mmt=on',
    '-r',
    archivePath,
    '*'
  ], { cwd: portableDirectory });

  run(sevenZip.executable, ['t', archivePath]);

  await pipeline(createReadStream(sevenZip.module), createWriteStream(temporaryOutputPath));
  await pipeline(createReadStream(archivePath), createWriteStream(temporaryOutputPath, { flags: 'a' }));

  const [moduleInfo, archiveInfo, outputInfo] = await Promise.all([
    stat(sevenZip.module),
    stat(archivePath),
    stat(temporaryOutputPath)
  ]);
  if (outputInfo.size !== moduleInfo.size + archiveInfo.size) {
    throw new Error('Не удалось проверить целостность собранного SFX-файла.');
  }

  await rename(temporaryOutputPath, outputPath);
  console.log(`Готово: ${path.relative(projectDirectory, outputPath)}`);
  console.log(`Размер: ${(outputInfo.size / 1024 / 1024).toFixed(1)} MiB`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
  await rm(temporaryOutputPath, { force: true });
}
