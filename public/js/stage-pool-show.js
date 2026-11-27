import { showLines } from './stage-show-lines.js';

const POOL_LINES = showLines.POOL;
const QUIET_MS = 25000;
const LINE_MS = 4800;
const LINE_TTL_MS = 7000;
const LINE_GAP_MS = 1200;
const LOW_TIME_MS = 10000;
const MIN_TIMER_LINE_MS = 2000;
const NAMED_LINE_GAP_MS = 5000;

export function largeBankThreshold(capacity) {
  return Math.max(Math.ceil(capacity * 55 / 100), Math.min(50, Math.ceil(capacity * 60 / 100)));
}

function background(state) {
  if (!state.players.length) return 'waiting';
  return state.items.length ? 'quiet' : 'empty';
}

function displayName(player) {
  const name = player?.name;
  if (name && [...name].length <= 12 && !/[\s\p{C}\p{Extended_Pictographic}\uFE0F\u20E3\p{Regional_Indicator}]/u.test(name)) return name;
  return '';
}

const regularCount = state => state.items.filter(item => item.kind === 'regular').length;
const sameRoster = (previous, next) => previous.players.length === next.players.length &&
  next.players.every(player => previous.players.some(old => old.id === player.id));

function matchesContext(event, state, players, slots) {
  switch (event.key) {
    case 'joined':
      return players.length > 0;
    case 'lastReady':
      return players.length > 0 && state.players.length > 1 &&
        state.players.filter(player => !player.ready).length === 1;
    case 'firstReady':
    case 'ready':
      return players.length > 0 && state.players.some(player => !player.ready);
    case 'showcaseFull':
      return slots === 6 && regularCount(state) >= 6;
    case 'firstLot':
    case 'extra':
    case 'added':
      return state.items.some(item => event.payload.some(entity => entity.id === item.id));
    case 'bankStarted':
      return state.totalBank > 0;
    case 'bankLarge':
      return state.totalBank >= largeBankThreshold(state.bankCapacity);
    case 'stakesCleared':
      return state.players.filter(player => player.online).length > 1;
    default:
      return true;
  }
}

export function createPoolShow({ random = Math.random } = {}) {
  let state;
  let running = false;
  let lastActivity = 0;
  let nextLineAt = 0;
  let lastNamedAt = -Infinity;
  let deadline = 0;
  let startedRun;
  let warnedRun;
  let lastEventId = 0;
  let activeLine;
  let ambientLine;
  const queue = new Map();
  const shown = new Set();
  const announcedReady = new Set();
  const lastShown = new Map();
  const lastVariants = new Map();
  const playedAmbient = new Map();

  function choose(phase, key, players = [], hasQr = false) {
    const definition = showLines[phase][key];
    const variants = players.length > 1 && definition.grouped ? definition.grouped : definition.variants;
    const candidates = variants.filter(variant => !variant.requiresQr || hasQr);
    const variantKey = phase + '.' + key;
    const seen = definition.idle ? (playedAmbient.get(key) || new Set()) : null;
    if (seen && candidates.every(variant => seen.has(variant))) seen.clear();
    const different = candidates.filter(variant => variant !== lastVariants.get(variantKey) && !seen?.has(variant));
    const options = different.length ? different : candidates;
    const variant = options[Math.floor(random() * options.length)];
    lastVariants.set(variantKey, variant);
    if (seen) {
      seen.add(variant);
      playedAmbient.set(key, seen);
    }
    const name = variant.fallbackText ? displayName(players[0]) : '';
    return {
      pose: variant.pose,
      text: variant.fallbackText ? name ? variant.text.replace('[Имя]', () => name) : variant.fallbackText : variant.text,
      named: Boolean(name),
      requiresQr: variant.requiresQr
    };
  }

  function setRunning(value, now) {
    if (running === value) return;
    running = value;
    queue.clear();
    activeLine = null;
    ambientLine = null;
    nextLineAt = now;
    lastActivity = state?.phase === 'POOL' && background(state) === 'quiet' ? now : now - QUIET_MS;
  }

  function newRound(now) {
    queue.clear();
    shown.clear();
    announcedReady.clear();
    lastShown.clear();
    activeLine = null;
    ambientLine = null;
    startedRun = undefined;
    warnedRun = undefined;
    lastEventId = 0;
    lastNamedAt = -Infinity;
    nextLineAt = now;
    lastActivity = now - QUIET_MS;
  }

  function enqueue(key, now, payload = []) {
    const rule = POOL_LINES[key];
    if (rule.once && shown.has(key)) return;
    const existing = queue.get(rule.group);
    const weight = rule.priority * 10 + (rule.rank || 0);
    if (existing?.weight > weight) return;
    const merge = existing && (existing.key === key || rule.group === 'ready');
    const entities = [...new Map([...(merge ? existing.payload : []), ...payload].map(entity => [entity.id, entity])).values()];
    queue.set(rule.group, {
      key, rule, weight, payload: entities, at: existing?.at ?? now,
      readyAt: existing?.readyAt ?? now + (rule.batchMs || 0),
      expiresAt: now + (rule.ttlMs || LINE_TTL_MS)
    });
    if (queue.size > 3) {
      const lowest = [...queue.values()].sort((a, b) => a.weight - b.weight || a.at - b.at)[0];
      queue.delete(lowest.rule.group);
    }
  }

  function receive(previous, next, changes, now, slots) {
    const newPool = next.phase === 'POOL' && (state?.roundId !== next.roundId || state?.phase !== 'POOL');
    state = next;
    if (newPool) newRound(now);
    const timer = next.poolTimer;
    deadline = timer?.status === 'running' ? now + timer.remainingMs : 0;
    if (next.phase !== 'POOL') {
      queue.clear();
      activeLine = null;
      return;
    }
    if (!running) return;
    if (!previous || newPool) {
      if (background(next) === 'quiet') lastActivity = now;
      return;
    }

    const nextBackground = background(next);
    if (background(previous) !== nextBackground) {
      ambientLine = null;
      lastActivity = nextBackground === 'quiet' ? now : now - QUIET_MS;
    }
    if (previous.poolTimer?.runId !== timer?.runId) {
      queue.delete('timer');
      if (timer?.status === 'running' && timer.remainingMs > LOW_TIME_MS) enqueue('timerStarted', now);
      lastActivity = now;
    }
    if (changes.joined.length) enqueue('joined', now, changes.joined);
    if (changes.added.length) {
      const extra = changes.added.filter(item => item.kind === 'extra');
      if (!previous.items.length && !shown.has('firstLot')) enqueue('firstLot', now, changes.added);
      else if (slots === 6 && regularCount(previous) < 6 && regularCount(next) >= 6 && !shown.has('showcaseFull')) {
        enqueue('showcaseFull', now);
      } else if (extra.length && now >= (lastShown.get('extra') ?? -Infinity) + POOL_LINES.extra.ownCooldownMs) {
        enqueue('extra', now, extra);
      } else enqueue('added', now, changes.added);
    }
    const newlyReady = changes.ready.filter(player => !announcedReady.has(player.id));
    const readyCount = next.players.filter(player => player.ready).length;
    const unchangedRoster = sameRoster(previous, next);
    if (!unchangedRoster && queue.get('ready')?.key === 'lastReady') queue.delete('ready');
    if (changes.ready.length && next.players.length > 1 && readyCount === next.players.length - 1 &&
        unchangedRoster && !shown.has('lastReady')) {
      enqueue('lastReady', now, changes.ready);
    } else if (newlyReady.length && readyCount < next.players.length) {
      const firstReady = !previous.players.some(player => player.ready) && !shown.has('firstReady');
      enqueue(firstReady ? 'firstReady' : 'ready', now, newlyReady);
    }

    const sameBankCapacity = previous.bankCapacity === next.bankCapacity && unchangedRoster;
    const threshold = largeBankThreshold(next.bankCapacity);
    if (!sameBankCapacity) queue.delete('bank');
    else if (next.totalBank > previous.totalBank) {
      if (threshold > 0 && previous.totalBank < threshold && next.totalBank >= threshold) enqueue('bankLarge', now);
      else if (previous.totalBank === 0) enqueue('bankStarted', now);
    }
    if (next.stageEvent?.type === 'stakesCleared' && next.stageEvent.id > lastEventId) {
      lastEventId = next.stageEvent.id;
      if (next.players.filter(player => player.online).length > 1) enqueue('stakesCleared', now);
    }
    const readinessChanged = next.players.some(player => previous.players.some(old =>
      old.id === player.id && (old.ready !== player.ready || old.online !== player.online)));
    if (!unchangedRoster || next.items.length !== previous.items.length || changes.added.length ||
        readinessChanged || changes.reactions.length || next.totalBank !== previous.totalBank ||
        timer?.status !== previous.poolTimer?.status) {
      if (nextBackground === 'quiet' || nextBackground === background(previous)) lastActivity = now;
    }
  }

  function tick(now, { slots, hasQr }) {
    const base = state ? background(state) : 'waiting';
    const idle = POOL_LINES[base].idle;
    if (state && state.phase !== 'POOL') return { pose: idle.pose, text: '' };
    if (!running || !state) return idle;

    const remaining = deadline - now;
    const runId = state.poolTimer?.runId;
    if (!runId || remaining < MIN_TIMER_LINE_MS) queue.delete('timer');
    else if (remaining <= LOW_TIME_MS && warnedRun !== runId) enqueue('timerEnding', now);
    if (activeLine?.key === 'timerEnding' && (activeLine.runId !== runId || remaining <= 0)) activeLine = null;
    if (activeLine?.key === 'timerStarted' && (activeLine.runId !== runId || !deadline)) activeLine = null;
    if (activeLine && now >= activeLine.until) {
      nextLineAt = activeLine.until + LINE_GAP_MS;
      lastActivity = Math.max(lastActivity, activeLine.until);
      activeLine = null;
    }

    const pending = [...queue.values()].sort((a, b) => b.weight - a.weight || a.at - b.at);
    for (const event of pending) {
      const { key, rule } = event;
      const players = rule.group === 'joined' || rule.group === 'ready'
        ? state.players.filter(player => event.payload.some(entity => entity.id === player.id) &&
          (rule.group === 'joined' ? player.online : player.ready))
        : [];
      const nearNamedLine = now < lastNamedAt + NAMED_LINE_GAP_MS || queue.has('ready') || queue.has('joined');
      const invalid = now >= event.expiresAt || !matchesContext(event, state, players, slots) ||
        (key === 'stakesCleared' && nearNamedLine) ||
        (key === 'timerStarted' && (startedRun === runId || remaining <= LOW_TIME_MS));
      if (invalid) {
        queue.delete(rule.group);
        continue;
      }
      const urgent = rule.priority >= 90;
      const preempts = activeLine && urgent && activeLine.priority < rule.priority;
      const cooldown = (lastShown.get(rule.group) ?? -Infinity) + (rule.cooldownMs || 0);
      if ((!preempts && activeLine) || now < event.readyAt || (!urgent && now < Math.max(nextLineAt, cooldown))) continue;
      queue.delete(rule.group);
      if (rule.once) shown.add(key);
      lastShown.set(rule.group, now);
      lastShown.set(key, now);
      if (rule.group === 'ready') players.forEach(player => announcedReady.add(player.id));
      if (key === 'timerStarted') startedRun = runId;
      if (key === 'timerEnding') warnedRun = runId;
      const line = choose('POOL', key, players);
      if (line.named) lastNamedAt = now;
      activeLine = { ...line, key, runId, priority: rule.priority, until: now + LINE_MS };
      return activeLine;
    }
    if (!activeLine && !queue.size && now >= lastActivity + QUIET_MS) {
      ambientLine = choose('POOL', base, [], hasQr);
      lastActivity = now;
    }
    return activeLine || (ambientLine?.requiresQr && !hasQr ? idle : ambientLine || idle);
  }

  return {
    receive, setRunning, tick,
    reveal: reason => showLines.REVEAL[reason] ? choose('REVEAL', reason) : null
  };
}
