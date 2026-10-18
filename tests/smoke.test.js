const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { afterEach, beforeEach, describe, test } = require('node:test');

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const CSS_DIR = path.join(PUBLIC_DIR, 'css');
const { DEFAULT_SETTINGS, ROOM_PRESETS } = require(path.join(ROOT, 'src', 'config.js'));
const {
  state,
  getRawPoints,
  getEffectivePoints,
  buildClientState,
  addInitialItems,
  importPoolItems
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
      path.join(PUBLIC_DIR, 'js', 'wheel-effects.js'),
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
    for (const id of ['saves-modal', 'saves-help-toggle', 'saves-help-box', 'clear-initial-save-btn']) {
      assert.ok(ids.includes(id), `Missing saves UI element: #${id}`);
    }
  });

  test('parses HomeAuction markdown saves and rejects unrelated markdown', async () => {
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
      state.hostToken = null;
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
      state.hostToken = null;
      state.items = [];
    });

    test('starts with the expected default limits', () => {
      assert.equal(state.settings.maxPoints, 50);
      assert.equal(state.settings.maxItems, 5);
      assert.equal(DEFAULT_SETTINGS.keepZeroItems, false);
      assert.equal(DEFAULT_SETTINGS.zeroItemWeight, 0.5);
      assert.equal(DEFAULT_SETTINGS.allowReactions, false);
    });

    test('exports the expected room presets', () => {
      assert.deepEqual(ROOM_PRESETS.basic, { ...DEFAULT_SETTINGS });
      assert.deepEqual(ROOM_PRESETS.diplomacy, {
        ...DEFAULT_SETTINGS,
        restrictOwnPoints: true,
        foreignOnlyPoints: 25,
        allowReactions: true
      });
      assert.equal(ROOM_PRESETS.chaos.maxPoints, 100);
      assert.equal(ROOM_PRESETS.chaos.maxItems, 10);
      assert.equal(ROOM_PRESETS.chaos.keepZeroItems, true);
      assert.equal(ROOM_PRESETS.chaos.zeroItemWeight, 5);
      assert.equal(ROOM_PRESETS.chaos.allowFreeItemsForAll, false);
      assert.equal(ROOM_PRESETS.chaos.allowReactions, true);
    });

    test('reports whether the room has a host', () => {
      assert.equal(buildClientState(null).hasHost, false);
      state.players.set('host-token', {
        id: 'host',
        token: 'host-token',
        name: 'Host',
        isHost: true,
        ready: false,
        online: true
      });
      state.hostToken = 'host-token';

      assert.equal(buildClientState(null).hasHost, true);
    });

    test('calculates raw and effective points, including zero-point items', () => {
      const supportSettings = { keepZeroItems: true, zeroItemWeight: 5 };
      for (const [rawPoints, expectedEffectivePoints] of [[0, 5], [1, 5], [4, 5], [5, 5], [8, 8]]) {
        const item = { allocations: { player1: rawPoints } };
        assert.equal(getRawPoints(item), rawPoints);
        assert.equal(getEffectivePoints(item, supportSettings), expectedEffectivePoints);
      }

      const noSupportSettings = { keepZeroItems: false, zeroItemWeight: 5 };
      assert.equal(getEffectivePoints({ allocations: { player1: 0 } }, noSupportSettings), 0);
      assert.equal(getEffectivePoints({ allocations: { player1: 5 } }, noSupportSettings), 5);
      assert.equal(getEffectivePoints({ allocations: { player1: 0 } }), 0);
      assert.equal(getEffectivePoints({ allocations: { player1: 0 } }, {
        keepZeroItems: true,
        zeroItemWeight: 0
      }), 0.5);
    });

    test('loads a deduplicated initial save without spending host budget or slots', () => {
      const host = {
        id: 'host-id',
        token: 'host-token',
        name: 'Host',
        isHost: true,
        ready: false,
        online: true
      };
      state.players.set(host.token, host);
      state.hostToken = host.token;
      const loaded = addInitialItems([
        { title: 'Film A', points: 7, isFreeSlot: false },
        { title: ' film a ', points: 3, isFreeSlot: true },
        { title: 'Film B', points: 2, isFreeSlot: false }
      ], host.token, host.name);

      assert.equal(loaded.length, 2);
      assert.equal(loaded[0].basePoints, 10);
      assert.equal(loaded[0].isFreeSlot, true);
      assert.equal(loaded[0].createdByToken, host.token);
      assert.equal(getRawPoints(loaded[0]), 10);
      const hostState = buildClientState(host.token);
      assert.equal(hostState.me.myItemsCount, 0);
      assert.equal(hostState.me.remainingPoints, state.settings.maxPoints);
      assert.equal(hostState.items.every(item => item.isSystem), true);
    });

    test('imports pool names with duplicate removal and slot-limit truncation', () => {
      state.settings.maxItems = 2;
      const player = {
        id: 'player-id',
        token: 'player-token',
        name: 'Player',
        isHost: false,
        ready: false,
        online: true
      };
      state.players.set(player.token, player);
      state.items = [
        { id: 'existing', title: 'Existing', createdByToken: 'another-player', allocations: {} },
        { id: 'owned', title: 'Owned', createdByToken: player.token, allocations: {} }
      ];

      const result = importPoolItems([
        { title: ' existing ' },
        { title: 'First', points: 50, isFreeSlot: true },
        { title: 'FIRST', points: 20 },
        { title: 'Second' },
        { title: 'Third' }
      ], player.token, player);

      assert.deepEqual(result, { added: 1, duplicates: 2, noSlots: 2 });
      assert.equal(state.items.at(-1).title, 'First');
      assert.equal(state.items.at(-1).basePoints, 0);
      assert.equal(state.items.at(-1).isFreeSlot, false);
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
