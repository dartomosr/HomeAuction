const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { describe, test } = require('node:test');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');

async function collectJavaScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

function getExportedNames(source, filePath, visited = new Set()) {
  if (visited.has(filePath)) return new Set();
  visited.add(filePath);

  const exported = new Set();
  for (const match of source.matchAll(
    /\bexport\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  )) {
    exported.add(match[1]);
  }

  for (const match of source.matchAll(/\bexport\s*\{([\s\S]*?)\}(?:\s*from\s*(['"])(\.[^'"]+)\2)?\s*;/g)) {
    const names = match[1].split(',').map(name => name.trim()).filter(Boolean);
    if (match[3]) {
      const targetPath = path.resolve(path.dirname(filePath), match[3]);
      const targetSource = require('node:fs').readFileSync(targetPath, 'utf8');
      const targetExports = getExportedNames(targetSource, targetPath, visited);
      for (const name of names) {
        const originalName = name.split(/\s+as\s+/)[0].trim();
        if (targetExports.has(originalName)) {
          exported.add(name.split(/\s+as\s+/).at(-1).trim());
        }
      }
    } else {
      for (const name of names) exported.add(name.split(/\s+as\s+/).at(-1).trim());
    }
  }
  return exported;
}

describe('smoke checks', () => {
  test('includes the desktop PNG and ICO application icons', async () => {
    const uiDirectory = path.join(ROOT, 'desktop', 'ui');
    const [png, ico] = await Promise.all([
      fs.readFile(path.join(uiDirectory, 'icon.png')),
      fs.readFile(path.join(uiDirectory, 'icon.ico'))
    ]);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.deepEqual([...ico.subarray(0, 4)], [0, 0, 1, 0]);
    assert.ok(ico.length > 22, 'ICO must contain at least one image frame');
  });

  test('checks all server and client JavaScript syntax in parallel', async () => {
    const files = new Set([
      path.join(ROOT, 'server.js'),
      path.join(PUBLIC_DIR, 'js', 'wheel-effects.js'),
      ...await collectJavaScriptFiles(path.join(ROOT, 'src')),
      ...await collectJavaScriptFiles(path.join(PUBLIC_DIR, 'js')),
      ...await collectJavaScriptFiles(path.join(ROOT, 'desktop')),
      path.join(ROOT, 'scripts', 'build-exe.mjs'),
      path.join(ROOT, 'scripts', 'build-desktop.mjs'),
      path.join(ROOT, 'scripts', 'build-sfx.mjs'),
      path.join(ROOT, 'scripts', 'start-desktop.mjs')
    ]);

    await Promise.all([...files].map(file => execFileAsync(process.execPath, ['--check', file])));
  });

  test('validates unique HTML IDs and the DOM module contract', async () => {
    const [html, domModule] = await Promise.all([
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8'),
      fs.readFile(path.join(PUBLIC_DIR, 'js', 'dom.js'), 'utf8')
    ]);
    const ids = [...html.matchAll(/\bid\s*=\s*(["'])(.*?)\1/g)].map(match => match[2]);
    const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
    const domIds = [...domModule.matchAll(/getElementById\(\s*(['"])(.*?)\1\s*\)/g)]
      .map(match => match[2]);
    const missingIds = [...new Set(domIds)].filter(id => !ids.includes(id));

    assert.deepEqual(duplicateIds, [], `Duplicate HTML IDs: ${[...new Set(duplicateIds)].join(', ')}`);
    assert.deepEqual(missingIds, [], `DOM IDs missing from index.html: ${missingIds.join(', ')}`);
    const copyResultButton = html.match(/<button\b[^>]*\bid=["']btn-copy-result["'][^>]*>[\s\S]*?<\/button>/i);
    assert.ok(copyResultButton, 'Missing result-copy button');
    assert.match(copyResultButton[0], /\bdisabled\b/);
    assert.match(copyResultButton[0], /\btitle=["']Доступно после определения победителя["']/);
    assert.match(copyResultButton[0], /Результат/);
    for (const id of ['saves-modal', 'saves-help-toggle', 'saves-help-box', 'clear-initial-save-btn']) {
      assert.ok(ids.includes(id), `Missing saves UI element: #${id}`);
    }
  });

  test('validates named relative JavaScript imports and re-exports', async () => {
    const files = await collectJavaScriptFiles(path.join(PUBLIC_DIR, 'js'));
    const sources = new Map(await Promise.all(files.map(async file => [
      file,
      await fs.readFile(file, 'utf8')
    ])));

    for (const [file, source] of sources) {
      const imports = source.matchAll(
        /\bimport\s*\{([\s\S]*?)\}\s*from\s*(['"])(\.[^'"]+)\2/g
      );
      for (const match of imports) {
        const importedNames = match[1].split(',').map(name => name.trim()).filter(Boolean)
          .map(name => name.split(/\s+as\s+/)[0].trim());
        const targetPath = path.resolve(path.dirname(file), match[3]);
        assert.ok(sources.has(targetPath), `${path.relative(PUBLIC_DIR, file)} imports missing file ${match[3]}`);
        const exports = getExportedNames(sources.get(targetPath), targetPath);
        for (const name of importedNames) {
          assert.ok(exports.has(name), `${path.relative(PUBLIC_DIR, file)} imports missing export ${name} from ${match[3]}`);
        }
      }
    }
  });

  test('checks that imported CSS files exist and are not empty', async () => {
    const stylesheet = await fs.readFile(path.join(PUBLIC_DIR, 'style.css'), 'utf8');
    const imports = [...stylesheet.matchAll(/@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?\s*;/g)]
      .map(match => match[2]);

    assert.ok(imports.length > 0, 'public/style.css must contain CSS imports');

    for (const importedFile of imports) {
      const filePath = path.resolve(PUBLIC_DIR, importedFile);
      const relativePath = path.relative(CSS_DIR, filePath);
      assert.ok(
        relativePath !== '..' &&
          !relativePath.startsWith(`..${path.sep}`) &&
          !path.isAbsolute(relativePath),
        `CSS import must resolve inside public/css: ${importedFile}`
      );
      const contents = await fs.readFile(filePath, 'utf8');
      assert.ok(contents.trim().length > 0, `CSS import is empty: ${importedFile}`);
    }
  });

  test('parses and round-trips HomeAuction markdown saves', async () => {
    const { parseSaveFile, serializeSaveFile } = await import(
      pathToFileURL(path.join(PUBLIC_DIR, 'js', 'save-parser.js')).href
    );
    const parsed = parseSaveFile([
      '==HOME AUCTION==',
      '# Мой список',
      '- Интерстеллар',
      '1. Дюна | 20',
      '* Матрица | доп',
      'Зеленая миля | ДОП | 15',
      'Без ставки | free'
    ].join('\n'));
    assert.deepEqual(parsed.items, [
      { title: 'Интерстеллар', points: 0, isFreeSlot: false },
      { title: 'Дюна', points: 20, isFreeSlot: false },
      { title: 'Матрица', points: 0, isFreeSlot: true },
      { title: 'Зеленая миля', points: 15, isFreeSlot: true },
      { title: 'Без ставки', points: 0, isFreeSlot: true }
    ]);
    assert.equal(parsed.label, 'Мой список');
    assert.throws(() => parseSaveFile('# чужой файл\nИнтерстеллар'), /==HOME AUCTION==/);
    assert.equal(serializeSaveFile(parsed.items).startsWith('==HOME AUCTION==\n'), true);
    assert.deepEqual(parseSaveFile(serializeSaveFile(parsed.items)).items, parsed.items);
  });
});
