const { DEFAULT_SETTINGS, generateId } = require('./config');
const { state, getRawPoints, getEffectivePoints, getActiveRevealItems, getAliveWheelItems, buildClientState } = require('./state');
const { pickPredeterminedWinner, pickEliminatedItem } = require('./wheel-math');

function registerSocketHandlers(io) {
  let pendingSpinTimer = null;
  let spinGeneration = 0;

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
    const allPlayers = Array.from(state.players.values()).filter(p => !p.isSpectator);
    if (allPlayers.length === 0) return;

    const everyoneReady = allPlayers.every(p => p.ready);
    if (!everyoneReady) return;

    const validItems = getActiveRevealItems();
    if (validItems.length === 0) {
      for (const p of allPlayers) p.ready = false;
      io.emit('toast_error', 'В пуле нет ни одного активного варианта! Добавьте вариант и распределите очки.');
      broadcastState();
      return;
    }

    state.phase = 'REVEAL';
    broadcastState();
  }

  io.on('connection', (socket) => {
    let currentToken = null;

    socket.on('join', (joinData = {}) => {
      const { token, name, isSpectator } = joinData;
      const cleanName = (name || '').trim().slice(0, 24);
      if (!cleanName) return;

      const hasSpectatorChoice = Object.prototype.hasOwnProperty.call(joinData, 'isSpectator');
      const spectatorChoice = Boolean(isSpectator);
      const playerToken = (token && state.players.has(token)) ? token : (token || generateId());
      currentToken = playerToken;

      let player = state.players.get(playerToken);
      if (!player) {
        if (!spectatorChoice && !state.hostToken) {
          state.hostToken = playerToken;
        }
        player = {
          id: generateId(),
          token: playerToken,
          socketId: socket.id,
          name: cleanName,
          isHost: state.hostToken === playerToken,
          ready: false,
          online: true,
          isSpectator: spectatorChoice
        };
        state.players.set(playerToken, player);
      } else {
        if (!player.id) player.id = generateId();
        player.socketId = socket.id;
        player.name = cleanName;
        player.online = true;
        if (hasSpectatorChoice) {
          player.isSpectator = spectatorChoice;
          if (player.isSpectator) {
            player.ready = false;
            if (state.phase === 'POOL') {
              for (const item of state.items) delete item.allocations[playerToken];
            }
          }
        }
      }

      if (state.hostToken === playerToken && player.isSpectator) {
        const nextHost = Array.from(state.players.entries()).find(
          ([candidateToken, candidate]) => candidateToken !== playerToken && !candidate.isSpectator
        );
        state.hostToken = nextHost ? nextHost[0] : null;
      } else if (!state.hostToken && !player.isSpectator) {
        state.hostToken = playerToken;
      }
      for (const p of state.players.values()) p.isHost = state.hostToken === p.token;

      socket.emit('joined', { token: playerToken });
      broadcastState();
      checkAllReady();
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

      const maxPoints = Math.max(1, Math.min(100000, parseInt(newSettings.maxPoints, 10) || 50));
      const maxItems = Math.max(1, Math.min(50, parseInt(newSettings.maxItems, 10) || 5));
      const keepZeroItems = Boolean(newSettings.keepZeroItems);
      const zeroItemWeight = Math.max(0.01, Math.min(100, parseFloat(newSettings.zeroItemWeight) || 0.5));
      const restrictOwnPoints = Boolean(newSettings.restrictOwnPoints);
      const foreignOnlyPoints = restrictOwnPoints
        ? Math.max(0, Math.min(maxPoints, Math.floor(Number(newSettings.foreignOnlyPoints) || 0))) : 0;
      const allowFreeItemsForAll = Boolean(newSettings.allowFreeItemsForAll);
      const allowReactions = Boolean(newSettings.allowReactions);
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
        foreignOnlyPoints,
        allowFreeItemsForAll,
        allowReactions
      };
      broadcastState();
    });

    socket.on('toggle_reaction', (payload = {}) => {
      if (!payload || typeof payload !== 'object') return;
      const { itemId, type } = payload;
      const player = state.players.get(currentToken);
      if (state.phase !== 'POOL' || !state.settings.allowReactions || !player) return;
      if (type !== 'up' && type !== 'down') return;

      const item = state.items.find(candidate => candidate.id === itemId && !candidate.mergedInto);
      if (!item || item.createdByToken === currentToken) return;

      if (!item.reactions) item.reactions = {};
      if (item.reactions[currentToken] === type) delete item.reactions[currentToken];
      else item.reactions[currentToken] = type;
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

    // Добавление варианта в общий пул (обычное или вне лимита + ДОП)
    socket.on('add_item', ({ title, isFreeSlot } = {}) => {
      const player = state.players.get(currentToken);
      if (!player || player.isSpectator || state.phase !== 'POOL') return;

      const wantsFreeSlot = Boolean(isFreeSlot);
      const canAddFreeSlot = Boolean(player.isHost || state.settings.allowFreeItemsForAll);

      // Обычный игрок не может добавлять лоты, когда нажал «Готов»
      // (но Хост может добавить + ДОП из админ-панели даже будучи готовым)
      if (player.ready && !(player.isHost && wantsFreeSlot)) return;

      const cleanTitle = (title || '').trim().slice(0, 80);
      if (!cleanTitle) return;

      if (wantsFreeSlot) {
        if (!canAddFreeSlot) {
          socket.emit('toast_error', 'Добавление вариантов вне лимита (+ ДОП) сейчас доступно только Хосту.');
          return;
        }
      } else {
        const myItemsCount = state.items.filter(
          it => it.createdByToken === currentToken && !it.mergedInto && !it.isFreeSlot
        ).length;
        if (myItemsCount >= state.settings.maxItems) {
          socket.emit('toast_error', `Лимит вариантов (${state.settings.maxItems} шт.) исчерпан.`);
          return;
        }
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
        isFreeSlot: wantsFreeSlot,
        allocations: {},
        reactions: {},
        originalAllocations: null,
        eliminated: false,
        mergedInto: null
      });

      broadcastState();
      socket.emit('item_added');
    });

    // Удаление варианта (разрешено автору варианта ИЛИ Хосту даже для чужих вариантов)
    socket.on('delete_item', ({ itemId }) => {
      const player = state.players.get(currentToken);
      if (!player || player.isSpectator || state.phase !== 'POOL') return;

      const idx = state.items.findIndex(it => it.id === itemId && !it.mergedInto);
      if (idx === -1) return;

      const targetItem = state.items[idx];
      const isOwner = targetItem.createdByToken === currentToken;
      const isHost = Boolean(player.isHost);

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
      if (!player || player.isSpectator || state.phase !== 'POOL' || player.ready) return;

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
      if (!player || player.isSpectator || state.phase !== 'POOL') return;

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
      if (source.isFreeSlot && !target.isFreeSlot) {
        // Оставляем целевому лоту его статус, ничего не ломая
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
          reactions: {},
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
}

module.exports = { registerSocketHandlers };
