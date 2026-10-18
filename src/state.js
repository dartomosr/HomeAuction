const { DEFAULT_SETTINGS } = require('./config');
const { generateId } = require('./config');

const state = {
  phase: 'POOL', // 'POOL' (добавление и тайные ставки) | 'REVEAL' (колесо) | 'FINISHED' (финал)
  settings: { ...DEFAULT_SETTINGS },
  hostToken: null,
  players: new Map(), // token -> { id, token, socketId, name, isHost, ready, online }
  items: [],          // { id, title, createdByToken, createdByName, isFreeSlot, allocations: { [token]: pts }, originalAllocations: null, eliminated: false, mergedInto: null }
  wheel: {
    predeterminedWinnerId: null,
    isSpinning: false,
    history: [], // Список выбывших по порядку
    winner: null
  }
};

function getPlayerNameByToken(token, fallback = 'Участник') {
  const p = state.players.get(token);
  return p ? p.name : fallback;
}

function getRawPoints(item) {
  let sum = Number(item.basePoints) || 0;
  for (const pts of Object.values(item.allocations)) {
    sum += pts;
  }
  return sum;
}

function getEffectivePoints(item, settings = state.settings) {
  const raw = getRawPoints(item);
  if (settings.keepZeroItems) {
    return Math.max(raw, Number(settings.zeroItemWeight) || 0.5);
  }
  return raw === 0 ? 0 : raw;
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

function getReactionSummary(item, forToken) {
  const reactions = item.reactions || {};
  const upvotes = Object.values(reactions).filter(type => type === 'up').length;
  const downvotes = Object.values(reactions).filter(type => type === 'down').length;
  return {
    upvotes,
    downvotes,
    reactionScore: upvotes - downvotes,
    myReaction: reactions[forToken] || null
  };
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
      isSpectator: Boolean(p.isSpectator),
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
    // Лоты, добавленные вне лимита (isFreeSlot), НЕ увеличивают счётчик слотов игрока
    if (item.createdByToken === forToken && !item.mergedInto && !item.isFreeSlot && !item.isSystem) {
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
          isSystem: Boolean(item.isSystem),
          isFreeSlot: Boolean(item.isFreeSlot),
          canDelete: isOwn,
          canHostDelete: isHostViewer && !isOwn,
          ...getReactionSummary(item, forToken)
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
          isFreeSlot: Boolean(item.isFreeSlot),
          basePoints: basePts,
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
        isFreeSlot: Boolean(item.isFreeSlot),
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
      .map(([tok, pts]) => {
        const contributor = state.players.get(tok);
        return {
          name: getPlayerNameByToken(tok, 'Удалённый игрок'),
          playerId: contributor ? contributor.id : null,
          points: pts,
          isMe: tok === forToken
        };
      })
      .sort((a, b) => b.points - a.points);

    const basePts = item.mergedInto && item.originalBasePoints !== undefined
      ? item.originalBasePoints
      : Number(item.basePoints) || 0;
    const rawPts = basePts + Object.values(allocSource || {}).reduce((acc, v) => acc + v, 0);
    if (basePts > 0) {
      contributors.push({ name: 'Стартовая база', playerId: null, points: basePts, isMe: false });
      contributors.sort((a, b) => b.points - a.points);
    }
    const isWinner = state.phase === 'FINISHED' && state.wheel.winner && state.wheel.winner.id === item.id;

    return {
      id: item.id,
      title: item.title,
      createdByPlayerId: state.players.get(item.createdByToken)?.id || null,
      createdByName: item.createdByName || 'Удалённый игрок',
      mergedIntoId: item.mergedInto || null,
      isFreeSlot: Boolean(item.isFreeSlot),
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
    hasHost: Boolean(state.hostToken && state.players.has(state.hostToken)),
    hasPlayers: state.players.size > 0,
    me: me ? {
      name: me.name,
      isHost: me.isHost,
      ready: me.ready,
      isSpectator: Boolean(me.isSpectator),
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

function getPlayerNameByToken(token, fallback = 'Участник') {
  const p = state.players.get(token);
  return p ? p.name : fallback;
}

function getRawPoints(item) {
  let sum = Number(item.basePoints) || 0;
  for (const pts of Object.values(item.allocations)) {
    sum += pts;
  }
  return sum;
}

function getEffectivePoints(item, settings = state.settings) {
  const raw = getRawPoints(item);
  if (settings.keepZeroItems) {
    return Math.max(raw, Number(settings.zeroItemWeight) || 0.5);
  }
  return raw === 0 ? 0 : raw;
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
      isSpectator: Boolean(p.isSpectator),
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
    // Лоты, добавленные вне лимита (isFreeSlot), НЕ увеличивают счётчик слотов игрока
    if (item.createdByToken === forToken && !item.mergedInto && !item.isFreeSlot && !item.isSystem) {
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
          isSystem: Boolean(item.isSystem),
          isFreeSlot: Boolean(item.isFreeSlot),
          canDelete: isOwn,
          canHostDelete: isHostViewer && !isOwn,
          ...getReactionSummary(item, forToken)
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
          isFreeSlot: Boolean(item.isFreeSlot),
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
        isOwn: item.createdByToken === forToken,
        isSystem: Boolean(item.isSystem),
        isFreeSlot: Boolean(item.isFreeSlot),
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
      .map(([tok, pts]) => {
        const contributor = state.players.get(tok);
        return {
          name: getPlayerNameByToken(tok, 'Удалённый игрок'),
          playerId: contributor ? contributor.id : null,
          points: pts,
          isMe: tok === forToken
        };
      })
      .sort((a, b) => b.points - a.points);

    const basePts = item.mergedInto && item.originalBasePoints !== undefined
      ? item.originalBasePoints
      : Number(item.basePoints) || 0;
    const rawPts = basePts + Object.values(allocSource || {}).reduce((acc, v) => acc + v, 0);
    if (basePts > 0) {
      contributors.push({ name: 'Стартовая база', playerId: null, points: basePts, isMe: false });
      contributors.sort((a, b) => b.points - a.points);
    }
    const isWinner = state.phase === 'FINISHED' && state.wheel.winner && state.wheel.winner.id === item.id;

    return {
      id: item.id,
      title: item.title,
      isOwn: item.createdByToken === forToken,
      isSystem: Boolean(item.isSystem),
      createdByPlayerId: state.players.get(item.createdByToken)?.id || null,
      createdByName: item.createdByName || 'Удалённый игрок',
      mergedIntoId: item.mergedInto || null,
      basePoints: basePts,
      isFreeSlot: Boolean(item.isFreeSlot),
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
    hasHost: Boolean(state.hostToken && state.players.has(state.hostToken)),
    hasPlayers: state.players.size > 0,
    me: me ? {
      name: me.name,
      isHost: me.isHost,
      ready: me.ready,
      isSpectator: Boolean(me.isSpectator),
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

function normalizeItemTitle(title) {
  return String(title || '').trim().toLowerCase();
}

function addInitialItems(items, hostToken, hostName) {
  const merged = new Map();
  for (const entry of (Array.isArray(items) ? items : []).slice(0, 500)) {
    const title = String(entry && entry.title || '').trim().slice(0, 80);
    const key = normalizeItemTitle(title);
    if (!key) continue;
    const points = Number(entry.points);
    const cleanPoints = Number.isFinite(points) && points >= 0 ? points : 0;
    const current = merged.get(key);
    if (current) {
      current.points += cleanPoints;
      current.isFreeSlot = current.isFreeSlot || Boolean(entry.isFreeSlot);
    } else {
      merged.set(key, { title, points: cleanPoints, isFreeSlot: Boolean(entry.isFreeSlot) });
    }
  }

  const added = [];
  for (const entry of merged.values()) {
    if (state.items.some(item => !item.mergedInto && normalizeItemTitle(item.title) === normalizeItemTitle(entry.title))) {
      continue;
    }
    const item = {
      id: generateId(),
      title: entry.title,
      createdByToken: hostToken,
      createdByName: hostName,
      isSystem: true,
      basePoints: entry.points,
      isFreeSlot: entry.isFreeSlot,
      allocations: {},
      reactions: {},
      originalAllocations: null,
      eliminated: false,
      mergedInto: null
    };
    state.items.push(item);
    added.push(item);
  }
  return added;
}

function importPoolItems(items, playerToken, player) {
  const existing = new Set(state.items
    .filter(item => !item.mergedInto)
    .map(item => normalizeItemTitle(item.title)));
  const candidates = [];
  let duplicates = 0;
  for (const entry of (Array.isArray(items) ? items : []).slice(0, 500)) {
    const title = String(entry && entry.title || '').trim().slice(0, 80);
    const key = normalizeItemTitle(title);
    if (!key) continue;
    if (existing.has(key)) {
      duplicates++;
      continue;
    }
    existing.add(key);
    candidates.push(title);
  }

  const currentCount = state.items.filter(item =>
    item.createdByToken === playerToken && !item.mergedInto && !item.isFreeSlot && !item.isSystem
  ).length;
  const slots = Math.max(0, state.settings.maxItems - currentCount);
  const accepted = candidates.slice(0, slots);
  for (const title of accepted) {
    state.items.push({
      id: generateId(),
      title,
      createdByToken: playerToken,
      createdByName: player.name,
      isFreeSlot: false,
      isSystem: false,
      basePoints: 0,
      allocations: {},
      reactions: {},
      originalAllocations: null,
      eliminated: false,
      mergedInto: null
    });
  }
  return { added: accepted.length, duplicates, noSlots: candidates.length - accepted.length };
}

module.exports = {
  state,
  getRawPoints,
  getEffectivePoints,
  getActiveRevealItems,
  getAliveWheelItems,
  buildClientState,
  normalizeItemTitle,
  addInitialItems,
  importPoolItems
};
