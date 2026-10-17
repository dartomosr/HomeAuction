const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { afterEach, beforeEach, describe, test } = require('node:test');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const { DEFAULT_SETTINGS } = require(path.join(ROOT, 'src', 'config.js'));
const {
  state,
  getRawPoints,
  getEffectivePoints,
  buildClientState
} = require(path.join(ROOT, 'src', 'state.js'));
const {
  pickPredeterminedWinner,
  pickEliminatedItem
} = require(path.join(ROOT, 'src', 'wheel-math.js'));

async function collectJavaScriptFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [entryPath] : [];
  }));
  return nestedFiles.flat();
}

describe('smoke checks', () => {
  test('checks all server and client JavaScript syntax in parallel', async () => {
    const files = [
      path.join(ROOT, 'server.js'),
      path.join(PUBLIC_DIR, 'wheel-effects.js'),
      ...await collectJavaScriptFiles(path.join(ROOT, 'src')),
      ...await collectJavaScriptFiles(path.join(PUBLIC_DIR, 'js'))
    ];

    await Promise.all(files.map(file => execFileAsync(process.execPath, ['--check', file])));
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
    assert.match(html, /<button[^>]*id="btn-copy-result"[^>]*disabled[^>]*title="Доступно после определения победителя"[^>]*>📋 Результат<\/button>/);
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

  describe('isolated backend unit checks', () => {
    beforeEach(() => {
      state.players = new Map();
      state.items = [];
      state.phase = 'POOL';
      state.settings = { ...DEFAULT_SETTINGS };
      state.wheel = {
        predeterminedWinnerId: null,
        isSpinning: false,
        history: [],
        winner: null
      };
    });

    afterEach(() => {
      state.players.clear();
      state.items = [];
    });

    test('starts with the expected default limits', () => {
      assert.equal(state.settings.maxPoints, 50);
      assert.equal(state.settings.maxItems, 5);
      assert.equal(DEFAULT_SETTINGS.allowReactions, false);
    });

    test('calculates raw and effective points, including zero-point items', () => {
      const item = { allocations: { player1: 12, player2: 8 } };
      const zeroPointItem = { allocations: { player1: 0 } };

      assert.equal(getRawPoints(item), 20);
      assert.equal(getEffectivePoints(item), 20);
      assert.equal(getRawPoints(zeroPointItem), 0);
      assert.equal(getEffectivePoints(zeroPointItem), 0);

      state.settings.keepZeroItems = true;
      assert.equal(getEffectivePoints(zeroPointItem), 0.5);
    });

    test('does not count free-slot items toward a player item limit', () => {
      state.players.set('player1', {
        id: '1',
        token: 'player1',
        name: 'Player 1',
        isHost: false,
        ready: false,
        online: true
      });
      state.items = [
        { id: 'regular-1', title: 'Regular 1', createdByToken: 'player1', allocations: {} },
        { id: 'free', title: 'Free', createdByToken: 'player1', isFreeSlot: true, allocations: {} },
        { id: 'regular-2', title: 'Regular 2', createdByToken: 'player1', allocations: {} }
      ];

      assert.equal(buildClientState('player1').me.myItemsCount, 2);
    });

    test('hides other players’ bids during the POOL phase', () => {
      state.players.set('player1', {
        id: '1',
        token: 'player1',
        name: 'Player 1',
        isHost: false,
        ready: false,
        online: true
      });
      state.players.set('player2', {
        id: '2',
        token: 'player2',
        name: 'Player 2',
        isHost: false,
        ready: false,
        online: true
      });
      state.items = [{
        id: 'item-1',
        title: 'Item',
        createdByToken: 'player2',
        allocations: { player1: 3, player2: 17 }
      }];

      const clientState = buildClientState('player1');
      assert.equal(clientState.phase, 'POOL');
      assert.equal(clientState.items[0].myPoints, 3);
      assert.equal(clientState.allItems[0].myPoints, 3);
      assert.equal('totalPoints' in clientState.items[0], false);
      assert.equal('contributors' in clientState.allItems[0], false);
      assert.equal(JSON.stringify(clientState).includes('17'), false);
    });

    test('sends anonymous reaction totals and only the requesting player’s reaction', () => {
      state.items = [{
        id: 'item-1',
        title: 'Item',
        createdByToken: 'player2',
        allocations: {},
        reactions: { player1: 'up', player2: 'down', player3: 'up' }
      }];

      const clientState = buildClientState('player1');
      assert.deepEqual({
        upvotes: clientState.items[0].upvotes,
        downvotes: clientState.items[0].downvotes,
        reactionScore: clientState.items[0].reactionScore,
        myReaction: clientState.items[0].myReaction
      }, {
        upvotes: 2,
        downvotes: 1,
        reactionScore: 1,
        myReaction: 'up'
      });
      assert.equal('reactions' in clientState.items[0], false);
      assert.equal(JSON.stringify(clientState).includes('player3'), false);
    });

    test('selects the winner by points and the eliminated item by inverse points', t => {
      const candidates = [
        { id: 'low', allocations: { player1: 1 } },
        { id: 'high', allocations: { player1: 3 } }
      ];

      t.mock.method(Math, 'random', () => 0.75);
      assert.equal(pickPredeterminedWinner(candidates), 'high');
      t.mock.method(Math, 'random', () => 0.9);
      assert.equal(pickEliminatedItem(candidates), candidates[1]);
    });
  });
});
