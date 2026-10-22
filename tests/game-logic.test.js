const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, test } = require('node:test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { DEFAULT_SETTINGS, PRESET_CATALOG, PRESET_GROUPS, ROOM_PRESETS } = require(path.join(ROOT, 'src', 'config.js'));
const {
  state,
  getRawPoints,
  getEffectivePoints,
  buildClientState,
  addInitialItems,
  importPoolItems,
  getAliveWheelItems
} = require(path.join(ROOT, 'src', 'state.js'));
const {
  pickPredeterminedWinner,
  pickEliminatedItem
} = require(path.join(ROOT, 'src', 'wheel-math.js'));
const { registerSocketHandlers } = require(path.join(ROOT, 'src', 'socket-handlers.js'));

function resetState() {
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
}

function createSocketHarness() {
  const connected = new Map();
  let connectionHandler;
  const io = {
    sockets: { sockets: connected },
    on(event, handler) {
      if (event === 'connection') connectionHandler = handler;
    },
    emit(event, ...args) {
      for (const socket of connected.values()) socket.emit(event, ...args);
    },
    to(socketId) {
      return {
        emit(event, ...args) {
          const socket = connected.get(socketId);
          if (socket) socket.emit(event, ...args);
        }
      };
    }
  };

  registerSocketHandlers(io);

  function connect(id) {
    const handlers = new Map();
    const received = [];
    const socket = {
      id,
      data: {},
      received,
      emit(event, ...args) {
        received.push({ event, args });
      },
      on(event, handler) {
        handlers.set(event, handler);
      },
      receive(event, ...args) {
        const handler = handlers.get(event);
        assert.ok(handler, `No socket handler registered for ${event}`);
        handler(...args);
      }
    };
    connected.set(id, socket);
    connectionHandler(socket);
    return socket;
  }

  return { connect };
}

function join(socket, token, name, extra = {}) {
  socket.receive('join', { token, name, ...extra });
}

describe('isolated backend unit checks', () => {
  beforeEach(resetState);
  afterEach(resetState);

  test('starts with the expected default limits', () => {
    assert.equal(state.settings.maxPoints, 50);
    assert.equal(state.settings.maxItems, 5);
    assert.equal(state.settings.minimumBid, 0);
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

  test('catalog registers the stable all-or-nothing preset without copying base rules', () => {
    const allOrNothing = ROOM_PRESETS['all-or-nothing'];
    assert.ok(PRESET_CATALOG.some(preset => preset.id === 'all-or-nothing' && preset.group === 'experimental'));
    assert.deepEqual(PRESET_GROUPS.map(group => group.id), ['standard', 'experimental']);
    assert.equal(allOrNothing.maxPoints, 50);
    assert.equal(allOrNothing.minimumBid, 50);
    assert.deepEqual({ ...allOrNothing, minimumBid: 0 }, ROOM_PRESETS.basic);
    assert.ok(Object.isFrozen(allOrNothing));

    const applied = structuredClone(allOrNothing);
    applied.minimumBid = 0;
    applied.maxPoints = 99;
    assert.equal(allOrNothing.minimumBid, 50);
    assert.equal(allOrNothing.maxPoints, 50);
    assert.equal(ROOM_PRESETS.basic.minimumBid, 0);
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
    state.settings.minimumBid = 5;
    assert.equal(getRawPoints({ allocations: { player1: 0 } }), 0);
    assert.equal(getEffectivePoints({ allocations: { player1: 0 } }), 0);
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

describe('socket handler scenarios', () => {
  beforeEach(resetState);
  afterEach(resetState);

  test('per-opponent mode calculates equal quotas and carries division remainder into free points', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    join(host, 'host', 'Host');
    const players = [];
    for (let i = 0; i < 3; i++) {
      const socket = connect(`socket-${i}`);
      join(socket, `player${i}`, `Player ${i}`);
      players.push(socket);
    }
    host.receive('update_settings', { ...DEFAULT_SETTINGS, maxPoints: 50, foreignReserveMode: 'per_opponent', freePointsBudget: 20 });
    const client = buildClientState('host');
    assert.equal(client.opponentsCount, 3);
    assert.equal(client.quotaPerOpponent, 10);
    assert.equal(client.effectiveFreePoints, 20);
    host.receive('update_settings', { ...state.settings, freePointsBudget: 19 });
    const remainder = buildClientState('host');
    assert.equal(remainder.quotaPerOpponent, 10);
    assert.equal(remainder.effectiveFreePoints, 20);
  });

  test('per-opponent stakes use each author quota and shared free points, rejecting excess atomically', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    const another = connect('socket-another');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    join(another, 'another', 'Another');
    host.receive('update_settings', { ...DEFAULT_SETTINGS, maxPoints: 30, foreignReserveMode: 'per_opponent', freePointsBudget: 10 });
    host.receive('add_item', { title: 'Host lot' });
    player.receive('add_item', { title: 'Player lot' });
    another.receive('add_item', { title: 'Another lot' });
    const hostLot = state.items.find(item => item.createdByToken === 'host');
    const playerLot = state.items.find(item => item.createdByToken === 'player');
    const anotherLot = state.items.find(item => item.createdByToken === 'another');
    // Two opponents: quota 10 and free bank 10.
    player.receive('set_points', { itemId: hostLot.id, points: 10 });
    player.receive('set_points', { itemId: playerLot.id, points: 5 });
    assert.equal(hostLot.allocations.player, 10);
    assert.equal(playerLot.allocations.player, 5);
    player.receive('set_points', { itemId: hostLot.id, points: 11 });
    assert.equal(hostLot.allocations.player, 11);
    player.receive('set_points', { itemId: anotherLot.id, points: 10 });
    assert.equal(anotherLot.allocations.player, 10);
    player.receive('set_points', { itemId: hostLot.id, points: 16 });
    assert.equal(hostLot.allocations.player, 11);
    assert.match(player.received.at(-2).args[0], /Недостаточно свободных очков/);
    assert.equal(state.players.get('player').ready, false);
  });

  test('per-opponent quota is recalculated when active roster changes and invalid stakes are reduced', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const a = connect('socket-a');
    const b = connect('socket-b');
    join(host, 'host', 'Host');
    join(a, 'a', 'A');
    join(b, 'b', 'B');
    host.receive('update_settings', { ...DEFAULT_SETTINGS, maxPoints: 50, foreignReserveMode: 'per_opponent', freePointsBudget: 20 });
    host.receive('add_item', { title: 'Host lot' });
    const lot = state.items[0];
    a.receive('set_points', { itemId: lot.id, points: 15 });
    state.players.get('a').ready = true;
    const c = connect('socket-c');
    join(c, 'c', 'C');
    assert.equal(buildClientState('a').quotaPerOpponent, 10);
    assert.equal(lot.allocations.a, 10);
    assert.equal(state.players.get('a').ready, false);
  });

  test('reserves foreign-only points while limiting bids on a player’s own item', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    host.receive('update_settings', {
      ...DEFAULT_SETTINGS,
      maxPoints: 50,
      restrictOwnPoints: true,
      foreignOnlyPoints: 25,
      minimumBid: 25
    });
    host.receive('add_item', { title: 'Host item' });
    player.receive('add_item', { title: 'Player item' });
    const ownItem = state.items.find(item => item.createdByToken === 'host');
    const foreignItem = state.items.find(item => item.createdByToken === 'player');

    host.receive('set_points', { itemId: ownItem.id, points: 30 });
    host.receive('set_points', { itemId: foreignItem.id, points: 25 });

    assert.equal(ownItem.allocations.host, 25);
    assert.equal(foreignItem.allocations.host, 25);
    assert.equal(ownItem.allocations.host + foreignItem.allocations.host, 50);

    host.receive('set_points', { itemId: ownItem.id, points: 30 });
    host.receive('set_points', { itemId: foreignItem.id, points: 30 });
    assert.equal(ownItem.allocations.host, 25);
    assert.equal(foreignItem.allocations.host, 25);
    assert.equal(ownItem.allocations.host + foreignItem.allocations.host, 50);
  });

  test('all-or-nothing uses normal minimum validation and cannot split the 50-point budget', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    join(host, 'host', 'Host', { preset: 'all-or-nothing' });
    assert.equal(state.settings.maxPoints, 50);
    assert.equal(state.settings.minimumBid, 50);
    assert.deepEqual({ ...state.settings, minimumBid: 0 }, ROOM_PRESETS.basic);

    host.receive('add_item', { title: 'First' });
    host.receive('add_item', { title: 'Second' });
    const [first, second] = state.items;
    host.receive('set_points', { itemId: first.id, points: 0 });
    host.receive('set_points', { itemId: first.id, points: 49 });
    assert.equal(first.allocations.host, undefined);
    host.receive('set_points', { itemId: first.id, points: 50 });
    assert.equal(first.allocations.host, 50);
    host.receive('set_points', { itemId: second.id, points: 50 });
    assert.equal(second.allocations.host, undefined);
    assert.equal(first.allocations.host + (second.allocations.host || 0), 50);
    host.receive('set_points', { itemId: first.id, points: 0 });
    assert.equal(first.allocations.host, undefined);
    assert.equal(ROOM_PRESETS.basic.minimumBid, 0);
  });

  test('validates minimum bid against the flexible budget and rejects invalid values atomically', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    join(host, 'host', 'Host');
    host.receive('update_settings', {
      ...DEFAULT_SETTINGS,
      maxPoints: 50,
      restrictOwnPoints: true,
      foreignOnlyPoints: 25,
      minimumBid: 25
    });
    assert.equal(state.settings.minimumBid, 25);

    for (const minimumBid of [-1, 1.5, NaN, Infinity, 26]) {
      host.receive('update_settings', { ...state.settings, minimumBid });
      assert.equal(state.settings.maxPoints, 50, `maxPoints changed for invalid minimum ${minimumBid}`);
      assert.equal(state.settings.minimumBid, 25, `minimum changed for invalid value ${minimumBid}`);
      assert.match(host.received.at(-2).args[0], /Минимальная ставка должна быть целым числом/);
    }
    host.receive('update_settings', { ...state.settings, minimumBid: 0 });
    assert.equal(state.settings.minimumBid, 0);
  });

  test('allows zero or a bid at the minimum, rejects lower bids, and keeps the minimum per player', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const playerA = connect('socket-a');
    const playerB = connect('socket-b');
    join(host, 'host', 'Host');
    join(playerA, 'a', 'A');
    join(playerB, 'b', 'B');
    host.receive('update_settings', { ...DEFAULT_SETTINGS, minimumBid: 5 });
    host.receive('add_item', { title: 'Option' });
    const item = state.items[0];

    playerA.receive('set_points', { itemId: item.id, points: 0 });
    assert.equal(item.allocations.a, undefined);
    playerA.receive('set_points', { itemId: item.id, points: 4 });
    assert.equal(item.allocations.a, undefined);
    assert.match(playerA.received.at(-2).args[0], /Минимальная ставка — 5/);

    playerA.receive('set_points', { itemId: item.id, points: 5 });
    playerB.receive('set_points', { itemId: item.id, points: 4 });
    assert.equal(item.allocations.a, 5);
    assert.equal(item.allocations.b, undefined);
    playerB.receive('set_points', { itemId: item.id, points: 5 });
    assert.equal(item.allocations.b, 5);
    playerA.receive('set_points', { itemId: item.id, points: 0 });
    assert.equal(item.allocations.a, undefined);
    assert.equal(item.allocations.b, 5);
  });

  test('rejects a budget-clamped stake below the minimum without changing existing stakes', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    host.receive('update_settings', { ...DEFAULT_SETTINGS, minimumBid: 10 });
    host.receive('add_item', { title: 'One' });
    host.receive('add_item', { title: 'Two' });
    host.receive('add_item', { title: 'Three' });
    const [one, two, three] = state.items;

    player.receive('set_points', { itemId: one.id, points: 40 });
    player.receive('set_points', { itemId: two.id, points: 10 });
    player.receive('set_points', { itemId: three.id, points: 10 });
    assert.equal(one.allocations.player, 40);
    assert.equal(two.allocations.player, 10);
    assert.equal(three.allocations.player, undefined);
    assert.match(player.received.at(-2).args[0], /Недостаточно свободных очков/);
  });

  test('removes existing bids below a raised minimum, notifies players, and resets readiness', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    host.receive('add_item', { title: 'Low' });
    host.receive('add_item', { title: 'Valid' });
    const [low, valid] = state.items;
    player.receive('set_points', { itemId: low.id, points: 3 });
    player.receive('set_points', { itemId: valid.id, points: 7 });
    state.players.get('player').ready = true;

    host.receive('update_settings', { ...state.settings, minimumBid: 5 });
    assert.equal(state.settings.minimumBid, 5);
    assert.equal(low.allocations.player, undefined);
    assert.equal(valid.allocations.player, 7);
    assert.equal(state.players.get('player').ready, false);
    assert.ok(player.received.some(entry => entry.event === 'toast_error' && /ниже нового минимума/.test(entry.args[0])));
  });

  test('keeps legacy settings without minimumBid at zero and rejects edits outside the pool phase', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    const legacySettings = { ...DEFAULT_SETTINGS };
    delete legacySettings.minimumBid;
    host.receive('update_settings', legacySettings);
    assert.equal(state.settings.minimumBid, 0);

    player.receive('update_settings', { ...state.settings, minimumBid: 4 });
    assert.equal(state.settings.minimumBid, 0);
    state.phase = 'REVEAL';
    host.receive('update_settings', { ...state.settings, minimumBid: 4 });
    assert.equal(state.settings.minimumBid, 0);
  });

  test('transfers host from a spectator and enters REVEAL when active players are ready', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    const player = connect('socket-player');
    const spectator = connect('socket-spectator');
    join(host, 'host', 'Host');
    join(player, 'player', 'Player');
    join(spectator, 'spectator', 'Spectator', { isSpectator: true });
    player.receive('add_item', { title: 'Active item' });
    const item = state.items[0];
    player.receive('set_points', { itemId: item.id, points: 10 });

    join(host, 'host', 'Host', { isSpectator: true });
    assert.equal(state.players.get('host').isSpectator, true);
    assert.equal(state.players.get('host').isHost, false);
    assert.equal(state.players.get('player').isHost, true);
    assert.equal(state.hostToken, 'player');

    player.receive('toggle_ready');
    assert.equal(state.players.get('player').ready, true);
    assert.equal(state.players.get('spectator').ready, false);
    assert.equal(state.phase, 'REVEAL');
  });

  test('merges duplicate lots, bids, and base points before the first spin', () => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    join(host, 'host', 'Host');
    state.players.set('player', {
      id: 'player-id',
      token: 'player',
      socketId: 'socket-player',
      name: 'Player',
      isHost: false,
      ready: true,
      online: true,
      isSpectator: false
    });
    state.phase = 'REVEAL';
    state.items = [
      {
        id: 'lot-a', title: 'Lot A', basePoints: 2,
        allocations: { host: 5, player: 7 }, eliminated: false, mergedInto: null
      },
      {
        id: 'lot-b', title: 'Lot B', basePoints: 4,
        allocations: { host: 11, player: 13 }, eliminated: false, mergedInto: null
      }
    ];

    host.receive('merge_items', { sourceId: 'lot-b', targetId: 'lot-a' });

    assert.equal(state.items[0].basePoints, 6);
    assert.deepEqual(state.items[0].allocations, { host: 16, player: 20 });
    assert.equal(state.items[1].mergedInto, 'lot-a');
    assert.deepEqual(state.items[1].allocations, {});
    assert.deepEqual(getAliveWheelItems().map(item => item.id), ['lot-a']);
  });

  test('finishes the wheel round and supports both host reset modes', t => {
    const { connect } = createSocketHarness();
    const host = connect('socket-host');
    join(host, 'host', 'Host');
    state.phase = 'REVEAL';
    state.settings.spinDuration = 0.1;
    state.items = [
      {
        id: 'lot-a', title: 'Lot A', basePoints: 2,
        allocations: { host: 8 }, eliminated: false, mergedInto: null
      },
      {
        id: 'lot-b', title: 'Lot B', basePoints: 3,
        allocations: { host: 12 }, eliminated: false, mergedInto: null
      }
    ];
    t.mock.timers.enable({ apis: ['setTimeout'] });

    host.receive('spin_wheel');
    assert.equal(state.wheel.isSpinning, true);
    t.mock.timers.tick(500);

    assert.equal(state.phase, 'FINISHED');
    assert.equal(state.wheel.isSpinning, false);
    assert.equal(state.wheel.history.length, 1);
    assert.ok(state.wheel.winner);
    assert.notEqual(state.wheel.history[0].id, state.wheel.winner.id);
    assert.ok(state.items.find(item => item.id === state.wheel.history[0].id).eliminated);

    state.settings.minimumBid = 5;
    host.receive('reset_auction', { clearItems: false });
    assert.equal(state.phase, 'POOL');
    assert.equal(state.settings.minimumBid, 5);
    assert.equal(state.items.length, 2);
    assert.ok(state.items.every(item =>
      item.basePoints === 0 && Object.keys(item.allocations).length === 0
    ));
    assert.equal(state.players.size, 1);

    state.phase = 'REVEAL';
    state.items[0].basePoints = 9;
    state.items[0].allocations = { host: 4 };
    host.receive('reset_auction', { clearItems: true });
    assert.equal(state.phase, 'POOL');
    assert.deepEqual(state.items, []);
    assert.equal(state.players.size, 1);
    assert.equal(state.players.has('host'), true);

    host.receive('hard_reset_auction');
    assert.equal(state.settings.minimumBid, 0);
  });
});
