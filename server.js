const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Начальные настройки используются в том числе для полного сброса комнаты.
const DEFAULT_SETTINGS = Object.freeze({
  maxPoints: 50,
  maxItems: 5,
  keepZeroItems: false,
  zeroItemWeight: 0.5,
  spinDuration: 5.5,
  restrictOwnPoints: false,
  foreignOnlyPoints: 0
});
let pendingSpinTimer = null;
let spinGeneration = 0;

// Состояние аукциона в оперативной памяти
const state = {
  phase: 'POOL', // 'POOL' (добавление и тайные ставки) | 'REVEAL' (колесо) | 'FINISHED' (финал)
  settings: { ...DEFAULT_SETTINGS },
  hostToken: null,
  players: new Map(), // token -> { id, token, socketId, name, isHost, ready, online }
  items: [],          // { id, title, createdByToken, createdByName, allocations: { [token]: pts }, originalAllocations: null, eliminated: false, mergedInto: null }
  wheel: {
    predeterminedWinnerId: null,
    isSpinning: false,
    history: [], // Список выбывших по порядку
    winner: null
  }
};

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

function getPlayerNameByToken(token, fallback = 'Участник') {
  const p = state.players.get(token);
  return p ? p.name : fallback;
}

function getRawPoints(item) {
  let sum = 0;
  for (const pts of Object.values(item.allocations)) {
    sum += pts;
  }
  return sum;
}

function getEffectivePoints(item) {
  const raw = getRawPoints(item);
  if (raw > 0) return raw;
  return state.settings.keepZeroItems ? (Number(state.settings.zeroItemWeight) || 0.5) : 0;
}

function getActiveRevealItems() {
  return state.items.filter(item => {
    if (item.mergedInto) return false;
    const raw = getRawPoints(item);
    if (raw === 0 && !state.settings.keepZeroItems) return false;
    return true;
  });
}

function getAliveWheelItems() {
  return getActiveRevealItems().filter(item => !item.eliminated);
}

// Формируем персональное состояние для каждого игрока (без чужих очков в фазе POOL)
function buildClientState(forToken) {
  const me = state.players.get(forToken);
  const isHostViewer = Boolean(me && me.isHost);

  const playersList = [];
  for (const p of state.players.values()) {
    playersList.push({
      id: p.id,
      name: p.name,
      isHost: p.isHost,
      ready: p.ready,
      online: p.online,
      isMe: p.token === forToken,
      canKick: isHostViewer && p.token !== forToken
    });
  }

  const isRevealed = state.phase === 'REVEAL' || state.phase === 'FINISHED';
  const activeReveal = isRevealed ? getActiveRevealItems() : [];
  const totalEffectivePoints = activeReveal.reduce((acc, it) => acc + getEffectivePoints(it), 0);

  const aliveWheel = isRevealed ? getAliveWheelItems() : [];
  const totalInvWeight = aliveWheel.reduce((acc, it) => acc + (1 / getEffectivePoints(it)), 0);

  let myItemsCount = 0;
  let mySpentPoints = 0;
  let mySpentOwnPoints = 0;

  for (const item of state.items) {
    if (item.createdByToken === forToken && !item.mergedInto) {
      myItemsCount++;
    }
    if (item.allocations[forToken] && !item.mergedInto) {
      mySpentPoints += item.allocations[forToken];
      if (item.createdByToken === forToken) mySpentOwnPoints += item.allocations[forToken];
    }
  }

  const itemsList = state.items
    .filter(item => !item.mergedInto)
    .filter(item => {
      if (isRevealed) {
        const raw = getRawPoints(item);
        if (raw === 0 && !state.settings.keepZeroItems) return false;
      }
      return true;
    })
    .map(item => {
      const myPts = item.allocations[forToken] || 0;
      const isOwn = item.createdByToken === forToken;
      if (!isRevealed) {
        return {
          id: item.id,
          title: item.title,
          myPoints: myPts,
          isOwn,
          canDelete: isOwn,
          canHostDelete: isHostViewer && !isOwn
        };
      } else {
        const rawPts = getRawPoints(item);
        const effPts = getEffectivePoints(item);
        const winProbability = totalEffectivePoints > 0 ? (effPts / totalEffectivePoints) * 100 : 0;
        const elimWeight = !item.eliminated && effPts > 0 ? (1 / effPts) : 0;
        const roundElimShare = (!item.eliminated && totalInvWeight > 0) ? (elimWeight / totalInvWeight) * 100 : 0;

        return {
          id: item.id,
          title: item.title,
          myPoints: myPts,
          totalPoints: rawPts,
          effectivePoints: effPts,
          winProbability,
          roundElimShare,
          eliminated: item.eliminated
        };
      }
    });

  // Полный список ВСЕХ добавленных вариантов для всплывающего окна
  const allItemsList = state.items.map(item => {
    const mergedTarget = item.mergedInto
      ? state.items.find(t => t.id === item.mergedInto)
      : null;

    if (!isRevealed) {
      return {
        id: item.id,
        title: item.title,
        myPoints: item.allocations[forToken] || 0,
        isMerged: Boolean(item.mergedInto),
        mergedIntoTitle: mergedTarget ? mergedTarget.title : null
      };
    }

    // На этапе колеса показываем всех, кто вложил очки в этот вариант
    const allocSource = item.mergedInto && item.originalAllocations
      ? item.originalAllocations
      : item.allocations;

    const contributors = Object.entries(allocSource || {})
      .filter(([, pts]) => pts > 0)
      .map(([tok, pts]) => ({
        name: getPlayerNameByToken(tok, 'Удалённый игрок'),
        points: pts,
        isMe: tok === forToken
      }))
      .sort((a, b) => b.points - a.points);

    const rawPts = Object.values(allocSource || {}).reduce((acc, v) => acc + v, 0);
    const isWinner = state.phase === 'FINISHED' && state.wheel.winner && state.wheel.winner.id === item.id;

    return {
      id: item.id,
      title: item.title,
      totalPoints: rawPts,
      myPoints: (allocSource && allocSource[forToken]) || 0,
      eliminated: item.eliminated,
      isWinner: Boolean(isWinner),
      isMerged: Boolean(item.mergedInto),
      mergedIntoTitle: mergedTarget ? mergedTarget.title : null,
      droppedZero: !item.mergedInto && rawPts === 0 && !state.settings.keepZeroItems,
      contributors
    };
  });

  return {
    phase: state.phase,
    settings: state.settings,
    me: me ? {
      name: me.name,
      isHost: me.isHost,
      ready: me.ready,
      myItemsCount,
      mySpentPoints,
      mySpentOwnPoints,
      remainingPoints: Math.max(0, state.settings.maxPoints - mySpentPoints)
    } : null,
    players: playersList,
    items: itemsList,
    allItems: allItemsList,
    wheel: {
      isSpinning: state.wheel.isSpinning,
      hasStarted: state.wheel.predeterminedWinnerId !== null,
      history: state.wheel.history,
      winner: state.wheel.winner
    }
  };
}

function broadcastState() {
  for (const [token, player] of state.players.entries()) {
    if (player.socketId) {
      io.to(player.socketId).emit('state_update', buildClientState(token));
    }
  }
}

// Автоматический переход к REVEAL только когда 100% игроков нажали «Готов»
function checkAllReady() {
  if (state.phase !== 'POOL') return;
  const allPlayers = Array.from(state.players.values());
  if (allPlayers.length === 0) return;

  const everyoneReady = allPlayers.every(p => p.ready);
  if (!everyoneReady) return;

  const validItems = getActiveRevealItems();
  if (validItems.length === 0) {
    // Если все нажали «Готов», но нет ни одного варианта с очками — снимаем готовность и шлем подсказку
    for (const p of state.players.values()) p.ready = false;
    io.emit('toast_error', 'В пуле нет ни одного активного варианта! Добавьте вариант и распределите очки.');
    broadcastState();
    return;
  }

  state.phase = 'REVEAL';
  broadcastState();
}

// Честный выбор победителя на старте пропорционально очкам: P_i = S_i / Sum(S)
function pickPredeterminedWinner(aliveItems) {
  const totalWeight = aliveItems.reduce((sum, item) => sum + getEffectivePoints(item), 0);
  let rand = Math.random() * totalWeight;
  for (const item of aliveItems) {
    rand -= getEffectivePoints(item);
    if (rand <= 0) return item.id;
  }
  return aliveItems[aliveItems.length - 1].id;
}

// Выбор выбывающего среди остальных вариантов (вес вылета = 1 / Очки)
function pickEliminatedItem(candidates) {
  const weights = candidates.map(item => 1 / getEffectivePoints(item));
  const totalInv = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalInv;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

io.on('connection', (socket) => {
  let currentToken = null;

  socket.on('join', ({ token, name }) => {
    const cleanName = (name || '').trim().slice(0, 24);
    if (!cleanName) return;

    const playerToken = (token && state.players.has(token)) ? token : (token || generateId());
    currentToken = playerToken;

    let player = state.players.get(playerToken);
    if (!player) {
      if (!state.hostToken) {
        state.hostToken = playerToken;
      }
      player = {
        id: generateId(),
        token: playerToken,
        socketId: socket.id,
        name: cleanName,
        isHost: state.hostToken === playerToken,
        ready: false,
        online: true
      };
      state.players.set(playerToken, player);
    } else {
      if (!player.id) player.id = generateId();
      player.socketId = socket.id;
      player.name = cleanName;
      player.online = true;
      player.isHost = (state.hostToken === playerToken);
    }

    socket.emit('joined', { token: playerToken });
    broadcastState();
  });

  // Кик пользователя из лобби Хостом
  socket.on('kick_player', ({ playerId }) => {
    const hostPlayer = state.players.get(currentToken);
    if (!hostPlayer || !hostPlayer.isHost || state.wheel.isSpinning) return;

    let targetToken = null;
    let targetPlayer = null;
    for (const [tok, p] of state.players.entries()) {
      if (p.id === playerId) {
        targetToken = tok;
        targetPlayer = p;
        break;
      }
    }

    if (!targetPlayer || targetToken === currentToken) return;

    // Если мы на этапе POOL, удаляем ставки кикнутого игрока
    if (state.phase === 'POOL') {
      for (const item of state.items) {
        delete item.allocations[targetToken];
      }
    }

    if (targetPlayer.socketId) {
      io.to(targetPlayer.socketId).emit('kicked', {
        reason: 'Ведущий удалил вас из комнаты.'
      });
    }

    state.players.delete(targetToken);
    broadcastState();
    checkAllReady();
  });

  // Обновление настроек Хостом
  socket.on('update_settings', (newSettings) => {
    const player = state.players.get(currentToken);
    if (!player || !player.isHost || state.wheel.isSpinning) return;

    const maxPoints = Math.max(1, Math.min(100000, parseInt(newSettings.maxPoints, 10) || 100));
    const maxItems = Math.max(1, Math.min(50, parseInt(newSettings.maxItems, 10) || 3));
    const keepZeroItems = Boolean(newSettings.keepZeroItems);
    const zeroItemWeight = Math.max(0.01, Math.min(100, parseFloat(newSettings.zeroItemWeight) || 0.5));
    const restrictOwnPoints = Boolean(newSettings.restrictOwnPoints);
    const foreignOnlyPoints = restrictOwnPoints
      ? Math.max(0, Math.min(maxPoints, Math.floor(Number(newSettings.foreignOnlyPoints) || 0))) : 0;
    const spinDuration = state.settings.spinDuration;

    if (state.phase === 'POOL' && maxPoints < state.settings.maxPoints) {
      for (const pToken of state.players.keys()) {
        let spent = 0;
        for (const item of state.items) spent += (item.allocations[pToken] || 0);
        if (spent > maxPoints) {
          for (const item of state.items) delete item.allocations[pToken];
          const p = state.players.get(pToken);
          if (p) p.ready = false;
        }
      }
    }

    if (state.phase === 'POOL') {
      const ownLimit = maxPoints - foreignOnlyPoints;
      for (const pToken of state.players.keys()) {
        let ownSpent = state.items.filter(it => !it.mergedInto && it.createdByToken === pToken)
          .reduce((sum, it) => sum + (it.allocations[pToken] || 0), 0);
        let changed = false;
        for (const item of state.items) {
          if (ownSpent <= ownLimit) break;
          if (item.mergedInto || item.createdByToken !== pToken) continue;
          const current = item.allocations[pToken] || 0;
          const reduction = Math.min(current, ownSpent - ownLimit);
          if (reduction) {
            if (current === reduction) delete item.allocations[pToken];
            else item.allocations[pToken] = current - reduction;
            ownSpent -= reduction;
            changed = true;
          }
        }
        if (changed) state.players.get(pToken).ready = false;
      }
    }
    state.settings = {
      maxPoints,
      maxItems,
      keepZeroItems,
      zeroItemWeight,
      spinDuration,
      restrictOwnPoints,
      foreignOnlyPoints
    };
    broadcastState();
  });

  // Ведущий меняет время непосредственно у колеса
  socket.on('update_spin_duration', ({ duration }) => {
    const player = state.players.get(currentToken);
    if (!player || player.socketId !== socket.id || !player.isHost ||
        state.phase !== 'REVEAL' || state.wheel.isSpinning) return;
    const n = Number(duration);
    if (!Number.isFinite(n)) return;
    state.settings.spinDuration = Math.max(2, Math.min(500, Math.round(n * 2) / 2));
    broadcastState();
  });

  // Добавление варианта в общий пул
  socket.on('add_item', ({ title }) => {
    const player = state.players.get(currentToken);
    if (!player || state.phase !== 'POOL' || player.ready) return;

    const cleanTitle = (title || '').trim().slice(0, 80);
    if (!cleanTitle) return;

    const myItemsCount = state.items.filter(it => it.createdByToken === currentToken && !it.mergedInto).length;
    if (myItemsCount >= state.settings.maxItems) {
      socket.emit('toast_error', `Лимит вариантов (${state.settings.maxItems} шт.) исчерпан.`);
      return;
    }

    const existing = state.items.find(it => !it.mergedInto && it.title.toLowerCase() === cleanTitle.toLowerCase());
    if (existing) {
      socket.emit('toast_error', 'Такой вариант уже есть в общем списке!');
      return;
    }

    state.items.push({
      id: generateId(),
      title: cleanTitle,
      createdByToken: currentToken,
      createdByName: player.name,
      allocations: {},
      originalAllocations: null,
      eliminated: false,
      mergedInto: null
    });

    broadcastState();
  });

  // Удаление варианта (разрешено автору варианта ИЛИ Хосту даже для чужих вариантов)
  socket.on('delete_item', ({ itemId }) => {
    const player = state.players.get(currentToken);
    if (!player || state.phase !== 'POOL') return;

    const idx = state.items.findIndex(it => it.id === itemId && !it.mergedInto);
    if (idx === -1) return;

    const targetItem = state.items[idx];
    const isOwner = targetItem.createdByToken === currentToken;
    const isHost = Boolean(player.isHost);

    // Обычный игрок не может удалить свой вариант, если нажал «Готов».
    // Хост может удалить чужой вариант в любой момент фазы POOL.
    if (isOwner && !player.ready) {
      state.items.splice(idx, 1);
      broadcastState();
    } else if (isHost) {
      state.items.splice(idx, 1);
      broadcastState();
    }
  });

  // Изменение тайной ставки очков на конкретный вариант
  socket.on('set_points', ({ itemId, points }) => {
    const player = state.players.get(currentToken);
    if (!player || state.phase !== 'POOL' || player.ready) return;

    const item = state.items.find(it => it.id === itemId && !it.mergedInto);
    if (!item) return;

    const desired = Math.max(0, parseInt(points, 10) || 0);
    let spentOnOthers = 0;
    for (const it of state.items) {
      if (it.id !== itemId && !it.mergedInto) {
        spentOnOthers += (it.allocations[currentToken] || 0);
      }
    }

    const ownLimit = state.settings.maxPoints - (state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0);
    const spentOnOwnOthers = item.createdByToken === currentToken
      ? state.items.filter(it => !it.mergedInto && it.id !== itemId && it.createdByToken === currentToken)
          .reduce((sum, it) => sum + (it.allocations[currentToken] || 0), 0)
      : 0;
    const allowed = Math.max(
      0,
      Math.min(
        desired,
        state.settings.maxPoints - spentOnOthers,
        item.createdByToken === currentToken ? ownLimit - spentOnOwnOthers : state.settings.maxPoints
      )
    );
    if (allowed === 0) {
      delete item.allocations[currentToken];
    } else {
      item.allocations[currentToken] = allowed;
    }

    broadcastState();
  });

  // Переключение статуса «Готов»
  socket.on('toggle_ready', () => {
    const player = state.players.get(currentToken);
    if (!player || state.phase !== 'POOL') return;

    player.ready = !player.ready;
    broadcastState();
    checkAllReady();
  });

  // Слияние двух дубликатов Хостом перед запуском колеса
  socket.on('merge_items', ({ sourceId, targetId }) => {
    const player = state.players.get(currentToken);
    if (!player || !player.isHost || state.phase !== 'REVEAL') return;
    if (state.wheel.isSpinning || state.wheel.predeterminedWinnerId) return;
    if (sourceId === targetId) return;

    const source = state.items.find(it => it.id === sourceId && !it.mergedInto);
    const target = state.items.find(it => it.id === targetId && !it.mergedInto);
    if (!source || !target) return;

    source.originalAllocations = { ...source.allocations };
    for (const [token, pts] of Object.entries(source.allocations)) {
      target.allocations[token] = (target.allocations[token] || 0) + pts;
    }
    source.mergedInto = target.id;
    source.allocations = {};

    broadcastState();
  });

  // Запуск очередного раунда колеса на выбывание Хостом
  socket.on('spin_wheel', () => {
    const player = state.players.get(currentToken);
    if (!player || !player.isHost || state.phase !== 'REVEAL') return;
    if (state.wheel.isSpinning) return;

    const aliveItems = getAliveWheelItems();
    if (aliveItems.length === 0) return;

    if (aliveItems.length === 1) {
      state.phase = 'FINISHED';
      state.wheel.winner = {
        id: aliveItems[0].id,
        title: aliveItems[0].title,
        totalPoints: getRawPoints(aliveItems[0])
      };
      broadcastState();
      return;
    }

    if (!state.wheel.predeterminedWinnerId || !aliveItems.some(it => it.id === state.wheel.predeterminedWinnerId)) {
      state.wheel.predeterminedWinnerId = pickPredeterminedWinner(aliveItems);
    }

    const candidates = aliveItems.filter(it => it.id !== state.wheel.predeterminedWinnerId);
    const eliminatedItem = pickEliminatedItem(candidates);

    const invWeights = aliveItems.map(it => 1 / getEffectivePoints(it));
    const totalInv = invWeights.reduce((a, b) => a + b, 0);

    let cursor = 0;
    let targetFraction = 0.5;
    const slices = aliveItems.map((it, idx) => {
      const share = invWeights[idx] / totalInv;
      const start = cursor;
      const end = cursor + share;
      cursor = end;

      if (it.id === eliminatedItem.id) {
        targetFraction = start + (0.15 + Math.random() * 0.7) * share;
      }

      return {
        id: it.id,
        title: it.title,
        totalPoints: getRawPoints(it),
        share
      };
    });

    state.wheel.isSpinning = true;
    broadcastState();

    const durationSec = state.settings.spinDuration;
    const extraSpins = Math.max(6, Math.round(durationSec * 0.85)) + Math.floor(Math.random() * 3);

    io.emit('wheel_spin', {
      slices,
      eliminatedId: eliminatedItem.id,
      eliminatedTitle: eliminatedItem.title,
      targetFraction,
      extraSpins,
      durationSec
    });

    const thisSpin = ++spinGeneration;
    pendingSpinTimer = setTimeout(() => {
      if (thisSpin !== spinGeneration) return;
      pendingSpinTimer = null;
      eliminatedItem.eliminated = true;
      state.wheel.isSpinning = false;
      state.wheel.history.push({
        id: eliminatedItem.id,
        title: eliminatedItem.title,
        totalPoints: getRawPoints(eliminatedItem)
      });

      const remaining = getAliveWheelItems();
      if (remaining.length === 1) {
        state.phase = 'FINISHED';
        state.wheel.winner = {
          id: remaining[0].id,
          title: remaining[0].title,
          totalPoints: getRawPoints(remaining[0])
        };
      }

      broadcastState();
    }, durationSec * 1000 + 400);
  });

  // Полная очистка комнаты без остановки Node.js / Cloudflare tunnel.
  socket.on('hard_reset_auction', () => {
    const player = state.players.get(currentToken);
    if (!player || player.socketId !== socket.id || !player.isHost) return;
    spinGeneration++;
    if (pendingSpinTimer) clearTimeout(pendingSpinTimer);
    pendingSpinTimer = null;
    state.phase = 'POOL';
    state.settings = { ...DEFAULT_SETTINGS };
    state.hostToken = null;
    state.players.clear();
    state.items = [];
    state.wheel = { predeterminedWinnerId: null, isSpinning: false, history: [], winner: null };
    for (const sock of io.sockets.sockets.values()) sock.data.auctionToken = null;
    io.emit('auction_hard_reset');
  });

  // Сброс аукциона для новой игры Хостом
  socket.on('reset_auction', ({ clearItems } = {}) => {
    const player = state.players.get(currentToken);
    if (!player || !player.isHost || state.wheel.isSpinning) return;

    state.phase = 'POOL';
    state.wheel = {
      predeterminedWinnerId: null,
      isSpinning: false,
      history: [],
      winner: null
    };

    for (const p of state.players.values()) {
      p.ready = false;
    }

    if (clearItems) {
      state.items = [];
    } else {
      state.items = state.items.filter(it => !it.mergedInto).map(it => ({
        ...it,
        allocations: {},
        originalAllocations: null,
        eliminated: false,
        mergedInto: null
      }));
    }

    broadcastState();
  });

  socket.on('disconnect', () => {
    if (currentToken && state.players.has(currentToken)) {
      const player = state.players.get(currentToken);
      player.online = false;
      broadcastState();
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`=========================================`);
  console.log(`Аукцион запущен: http://localhost:${PORT}`);
  console.log(`=========================================`);
});