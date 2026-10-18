const assert = require('node:assert/strict');
const { afterEach, beforeEach, describe, test } = require('node:test');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const { DEFAULT_SETTINGS, ROOM_PRESETS } = require(path.join(ROOT, 'src', 'config.js'));
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

describe('socket handler scenarios', () => {
  beforeEach(resetState);
  afterEach(resetState);

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
      foreignOnlyPoints: 25
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

    host.receive('reset_auction', { clearItems: false });
    assert.equal(state.phase, 'POOL');
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
  });
});
