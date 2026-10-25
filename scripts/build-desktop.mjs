import { access, cp, copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchExecutableIcon } from './patch-executable-icon.mjs';

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

async function find7ZipSfxDirectory() {
  const directories = [process.env.SEVENZIP_PATH, process.env.SEVENZIP_DIR, process.env.SEVEN_ZIP_PATH]
    .filter(Boolean)
    .map(configured7ZipDirectory);

  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const where = spawnSync(lookup, ['7z'], {
    encoding: 'utf8',
    windowsHide: true
  });
  if (where.status === 0) {
    directories.push(...where.stdout.split(/\r?\n/).filter(Boolean).map(path.dirname));
  }

  if (process.platform === 'win32') {
    directories.push(
      path.join(process.env.ProgramFiles || 'C:\\Program Files', '7-Zip'),
      path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', '7-Zip')
    );
  }

  for (const directory of [...new Set(directories.map(candidate => path.resolve(candidate)))]) {
    try {
      await Promise.all([
        access(path.join(directory, '7z.exe')),
        access(path.join(directory, '7z.sfx'))
      ]);
      return directory;
    } catch {
      continue;
    }
  }
  return null;
}

async function prepareServer() {
  if (await exists(serverExecutable) && await exists(cloudflaredExecutable)) return;
  console.log('Подготавливаются серверный EXE и cloudflared...');
  await run('npm', ['run', 'build:exe'], {
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
  await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true });
  return extractionDirectory;
}

async function prunePackagedRuntime() {
  const localesDirectory = path.join(outputDirectory, 'locales');
  const locales = await readdir(localesDirectory, { withFileTypes: true });
  // Сохраняем локали интерфейса, которыми пользуется HomeAuction.
  for (const locale of locales) {
    if (!locale.isFile() || !['ru.pak', 'en-US.pak'].includes(locale.name)) {
      await rm(path.join(localesDirectory, locale.name), { recursive: true, force: true });
    }
  }

  async function removeUnneededFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (['.git', 'tests', 'scripts'].includes(entry.name)) {
          await rm(entryPath, { recursive: true, force: true });
        } else {
          await removeUnneededFiles(entryPath);
        }
      } else if (/\.map$/i.test(entry.name) || /\.md$/i.test(entry.name)) {
        await rm(entryPath, { force: true });
      }
    }
  }
  await removeUnneededFiles(outputDirectory);
}

await prepareServer();
if (process.platform !== 'win32') {
  throw new Error('Сборка portable-клиента поддерживается только на Windows x64.');
}
await access(serverExecutable);
await access(cloudflaredExecutable);
await access(path.join(desktopDirectory, 'ui', 'icon.png'));

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'homeauction-desktop-'));
try {
  const runtimeDirectory = await getRuntimeDirectory(temporaryDirectory);
  await access(path.join(runtimeDirectory, 'electron.exe'));
  await access(path.join(runtimeDirectory, 'resources', 'default_app.asar'));
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(runtimeDirectory, outputDirectory, { recursive: true, force: true });
  await prunePackagedRuntime();

  const packagedExecutable = path.join(outputDirectory, 'HomeAuction.exe');
  await copyFile(path.join(runtimeDirectory, 'electron.exe'), packagedExecutable);
  await rm(path.join(outputDirectory, 'electron.exe'), { force: true });
  await patchExecutableIcon(packagedExecutable, path.join(desktopDirectory, 'ui', 'icon.ico'), 'HomeAuction');

  await mkdir(appDirectory, { recursive: true });
  for (const file of ['main.js', 'preload.js', 'process-job.ps1', 'tunnel-utils.js', 'window-mode.js']) {
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

  const sevenZipDirectory = await find7ZipSfxDirectory();
  if (sevenZipDirectory) {
    console.log('Найден 7-Zip; собирается HomeAuction-Portable.exe с максимальным сжатием...');
    await run(process.execPath, [path.join(projectDirectory, 'scripts', 'build-sfx.mjs')], {
      cwd: projectDirectory,
      env: { ...process.env, SEVENZIP_DIR: sevenZipDirectory }
    });
  } else {
    console.warn(
      `WARN: 7-Zip с модулем 7z.sfx не найден. Папка ${path.relative(projectDirectory, outputDirectory)} готова, SFX пропущен. ` +
      'Добавьте 7-Zip в PATH или задайте SEVENZIP_PATH/SEVENZIP_DIR.'
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
