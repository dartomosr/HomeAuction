import { access, mkdir, mkdtemp, rename, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
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
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    const interrupt = () => child.kill();
    const cleanup = () => {
      process.removeListener('SIGINT', interrupt);
      process.removeListener('SIGTERM', interrupt);
    };
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', interrupt);
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      if (code === 0) resolve();
      else reject(new Error(`${command} завершился с кодом ${code ?? signal ?? 'неизвестен'}.`));
    });
  });
}

function configured7ZipDirectory(value) {
  const configuredPath = path.resolve(value.trim());
  return ['7z', '7z.exe'].includes(path.basename(configuredPath).toLowerCase())
    ? path.dirname(configuredPath)
    : configuredPath;
}

async function find7Zip() {
  if (process.platform !== 'win32') {
    throw new Error('Сборка Windows SFX доступна только на Windows.');
  }

  const candidates = [process.env.SEVENZIP_PATH, process.env.SEVENZIP_DIR, process.env.SEVEN_ZIP_PATH]
    .filter(Boolean)
    .map(configured7ZipDirectory);

  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const where = spawnSync(lookup, ['7z'], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (where.status === 0) {
    candidates.push(...where.stdout.split(/\r?\n/).filter(Boolean).map(path.dirname));
  }
  candidates.push(
    path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip'),
    path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip')
  );

  for (const directory of [...new Set(candidates.map(candidate => path.resolve(candidate)))]) {
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

let sevenZip;
try {
  sevenZip = await find7Zip();
} catch (error) {
  console.warn(`WARN: ${error.message}`);
  console.warn('SFX пропущен; папка dist/HomeAuction остаётся доступна для распространения.');
  process.exitCode = 0;
  sevenZip = null;
}
if (!sevenZip) process.exit(0);
await mkdir(outputDirectory, { recursive: true });

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'homeauction-sfx-'));
const archivePath = path.join(temporaryDirectory, 'HomeAuction.7z');
const temporaryOutputPath = path.join(outputDirectory, `.HomeAuction-Portable-${process.pid}.tmp.exe`);
const abortController = new AbortController();
const abortBuild = () => abortController.abort();
process.on('SIGINT', abortBuild);
process.on('SIGTERM', abortBuild);
const sfxConfig = Buffer.from(
  ';!@Install@!UTF-8!\r\n' +
  'Title="HomeAuction Portable"\r\n' +
  'RunProgram="HomeAuction.exe"\r\n' +
  'GUIMode="1"\r\n' +
  ';!@InstallEnd@!\r\n',
  'utf8'
);

try {
  console.log(`Архивация содержимого ${path.relative(projectDirectory, portableDirectory)}...`);
  await run(sevenZip.executable, [
    'a',
    '-t7z',
    '-mx=9',
    '-m0=LZMA2',
    '-ms=on',
    '-mmt=on',
    '-r',
    archivePath,
    '*'
  ], { cwd: portableDirectory, signal: abortController.signal });

  await run(sevenZip.executable, ['t', archivePath], { signal: abortController.signal });

  // Собираем SFX последовательным потоком: модуль, конфигурация и проверенный архив.
  await pipeline(createReadStream(sevenZip.module), createWriteStream(temporaryOutputPath), {
    signal: abortController.signal
  });
  await writeFile(temporaryOutputPath, sfxConfig, {
    flag: 'a',
    signal: abortController.signal
  });
  await pipeline(createReadStream(archivePath), createWriteStream(temporaryOutputPath, { flags: 'a' }), {
    signal: abortController.signal
  });

  const [moduleInfo, archiveInfo, assembledInfo] = await Promise.all([
    stat(sevenZip.module),
    stat(archivePath),
    stat(temporaryOutputPath)
  ]);
  if (assembledInfo.size !== moduleInfo.size + sfxConfig.length + archiveInfo.size) {
    throw new Error('Не удалось проверить целостность собранного SFX-файла.');
  }

  // Проверяем самораспаковывающийся EXE, не изменяя модуль SFX и его overlay.
  await run(sevenZip.executable, ['t', temporaryOutputPath], { signal: abortController.signal });

  const outputInfo = await stat(temporaryOutputPath);
  await rename(temporaryOutputPath, outputPath);
  console.log(`Готово: ${path.relative(projectDirectory, outputPath)}`);
  console.log(`Размер: ${(outputInfo.size / 1024 / 1024).toFixed(1)} MiB`);
} finally {
  const cleanupResults = await Promise.allSettled([
    rm(temporaryDirectory, { recursive: true, force: true }),
    rm(temporaryOutputPath, { force: true })
  ]);
  process.removeListener('SIGINT', abortBuild);
  process.removeListener('SIGTERM', abortBuild);
  for (const result of cleanupResults) {
    if (result.status === 'rejected') console.warn(`WARN: временный файл не удалён: ${result.reason.message}`);
  }
}
