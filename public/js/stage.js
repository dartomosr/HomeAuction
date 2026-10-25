import { PAGE_DURATION, rankStageItems, stageCapacity, stageChanges, advanceCarousel } from './stage-model.js';
import { StageSound } from './stage-audio.js';

const socket = window.io({ auth: { role: 'stage' } });
const byId = id => document.getElementById(id);
const lotGrid = byId('lot-grid');
const playersNode = byId('players');
const number = new Intl.NumberFormat('ru-RU');
const motionPreference = matchMedia('(prefers-reduced-motion: reduce)');
const sound = new StageSound();
const spring = 'cubic-bezier(.34, 1.56, .64, 1)';
const lotNodes = new Map();
const playerNodes = new Map();
const motions = new WeakMap();
let snapshot = null;
let baseline = null;
let capacity = stageCapacity(innerWidth, innerHeight);
let itemPage = 0;
let playerPage = 0;
let elapsed = 0;
let lastAddress = '';
let embeddedActive = true;
let connected = false;
let transition = 0;
let changingPage = false;
let displayedBank = 0;
let bankTarget = 0;
let bankFrame = 0;
let activityTimer;
let previousTime = performance.now();
const active = () => embeddedActive && !document.hidden;
const animate = () => active() && !motionPreference.matches;

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function move(node, keyframes, options = {}) {
  motions.get(node)?.cancel();
  if (!animate()) return null;
  const animation = node.animate(keyframes, { duration: 720, easing: spring, ...options });
  motions.set(node, animation);
  return animation;
}

function pulse(node, className) {
  if (!animate()) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

function announce(text) {
  clearTimeout(activityTimer);
  byId('activity').textContent = text;
  pulse(byId('activity'), 'activity-pop');
  activityTimer = setTimeout(() => { byId('activity').textContent = 'Ваши телефоны решают'; }, 6500);
}

function createLot(id) {
  const card = element('article', 'lot');
  card.dataset.id = id;
  const surface = element('div', 'lot-surface glass');
  const top = element('div', 'lot-top');
  top.append(element('span', 'lot-kicker', 'ВАРИАНТ'), element('span', 'leader-badge', 'Фаворит'));
  const meta = element('div', 'lot-meta');
  const reactions = element('div', 'reactions');
  for (const [name, symbol] of [['upvotes', '▲'], ['downvotes', '▼']]) {
    const chip = element('span', `reaction ${name}`);
    chip.append(element('span', 'reaction-icon', symbol), element('span', 'reaction-value', '0'));
    reactions.append(chip);
  }
  meta.append(reactions, element('span', 'secret-chip', 'Ставки скрыты'));
  surface.append(element('span', 'lot-number'), top, element('h3', ''), meta);
  card.append(surface);
  return card;
}

function renderLots({ pageChange = false, reactions = [] } = {}) {
  const items = rankStageItems(snapshot?.items || []);
  const pages = Math.max(1, Math.ceil(items.length / capacity.items));
  itemPage %= pages;
  lotGrid.style.setProperty('--columns', capacity.columns);
  lotGrid.style.setProperty('--rows', capacity.rows);
  const first = new Map([...lotGrid.children].map(node => [node, node.getBoundingClientRect()]));
  for (const node of lotGrid.children) motions.get(node)?.cancel();
  const desired = [];
  const visible = items.slice(itemPage * capacity.items, (itemPage + 1) * capacity.items);
  visible.forEach((item, index) => {
    let card = lotNodes.get(item.id);
    if (!card) { card = createLot(item.id); lotNodes.set(item.id, card); }
    const rank = itemPage * capacity.items + index;
    card.style.setProperty('--slot', index);
    card.classList.toggle('leader', rank === 0 && item.upvotes > item.downvotes);
    card.querySelector('.lot-number').textContent = String(rank + 1).padStart(2, '0');
    card.querySelector('h3').textContent = item.title;
    card.querySelector('h3').title = item.title;
    for (const name of ['upvotes', 'downvotes']) card.querySelector(`.${name} .reaction-value`).textContent = number.format(item[name] || 0);
    desired.push(card);
  });
  for (let index = visible.length; index < capacity.items; index++) {
    const placeholder = lotGrid.querySelector(`[data-placeholder="${index}"]`) || element('div', 'lot placeholder');
    placeholder.dataset.placeholder = index;
    if (!placeholder.firstChild) {
      const surface = element('div', 'lot-surface');
      const orbit = element('div', 'placeholder-orbit');
      orbit.append(element('i', ''), element('i', ''));
      surface.append(orbit, element('p', '', 'Здесь может быть ваша идея'), element('small', '', 'Добавьте вариант с телефона'));
      placeholder.append(surface);
    }
    desired.push(placeholder);
  }
  for (const child of [...lotGrid.children]) if (!desired.includes(child)) child.remove();
  desired.forEach((node, index) => {
    if (lotGrid.children[index] !== node) lotGrid.insertBefore(node, lotGrid.children[index] || null);
  });
  // FLIP: capture First before reordering and Last after layout. The inner
  // surface floats independently, so its transform cannot fight this movement.
  const last = new Map(desired.map(node => [node, node.getBoundingClientRect()]));
  desired.forEach((node, index) => {
    const before = first.get(node);
    const after = last.get(node);
    if (before && !pageChange) {
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (Math.abs(dx) + Math.abs(dy) > 1) move(node, [
        { transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }
      ]);
    } else {
      move(node, [{ opacity: 0, transform: 'translateY(28px) scale(.92)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }],
        { delay: index * 48, fill: 'backwards' });
    }
  });
  for (const change of reactions) {
    const card = lotNodes.get(change.id);
    if (!card?.isConnected) continue;
    const surface = card.querySelector('.lot-surface');
    surface.classList.remove('reaction-up', 'reaction-down');
    pulse(surface, change.down > 0 ? 'reaction-down' : 'reaction-up');
    for (const [delta, selector] of [[change.up, '.upvotes'], [change.down, '.downvotes']]) {
      if (delta) move(card.querySelector(`${selector} .reaction-value`), [
        { transform: 'translateY(3px) scale(.75)' }, { transform: 'translateY(-4px) scale(1.3)', offset: .45 }, { transform: 'translateY(0) scale(1)' }
      ], { duration: 520 });
    }
  }
  const ids = new Set(items.map(item => item.id));
  for (const id of lotNodes.keys()) if (!ids.has(id)) lotNodes.delete(id);
  byId('item-count').textContent = `Вариантов: ${items.length}`;
  byId('page-label').textContent = pages > 1 ? `${String(itemPage + 1).padStart(2, '0')} / ${String(pages).padStart(2, '0')}` : 'ПУЛ ВАРИАНТОВ';
  const pagination = byId('pagination');
  const signature = `${pages}:${itemPage}`;
  if (pagination.dataset.signature !== signature) {
    pagination.dataset.signature = signature;
    pagination.replaceChildren();
    const firstPage = Math.max(0, Math.min(itemPage - 3, pages - 7));
    if (pages > 1) for (let page = firstPage; page < Math.min(pages, firstPage + 7); page++) {
      const pill = element('span', `page-pill${page === itemPage ? ' current' : ''}`);
      pill.setAttribute('aria-label', `Страница ${page + 1}${page === itemPage ? ', текущая' : ''}`);
      if (page === itemPage) pill.setAttribute('aria-current', 'page');
      pill.append(element('i', ''));
      pagination.append(pill);
    }
  }
}

function renderPlayers(changes) {
  const players = snapshot?.players || [];
  const pages = Math.max(1, Math.ceil(players.length / capacity.players));
  playerPage %= pages;
  const desired = players.slice(playerPage * capacity.players, (playerPage + 1) * capacity.players).map((player, index) => {
    let card = playerNodes.get(player.id);
    const fresh = !card?.isConnected;
    if (!card) {
      card = element('div', 'player');
      card.dataset.id = player.id;
      const info = element('div', 'player-info');
      info.append(element('strong', ''), element('span', 'player-badge'));
      card.append(element('span', 'player-avatar'), info);
      playerNodes.set(player.id, card);
    }
    card.classList.toggle('ready', Boolean(player.ready));
    card.classList.toggle('offline', !player.online);
    card.querySelector('strong').textContent = player.name;
    card.querySelector('strong').title = player.name;
    card.querySelector('.player-avatar').textContent = Array.from(player.name)[0]?.toUpperCase() || '';
    card.style.setProperty('--avatar-hue', [...player.id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 360);
    card.querySelector('.player-badge').textContent = !player.online ? 'Нет связи' : player.ready ? 'Готов' : 'Выбирает';
    if (fresh) move(card, [{ opacity: 0, transform: 'translateY(16px) scale(.85)' }, { opacity: 1, transform: 'translateY(0) scale(1)' }], { delay: index * 40 });
    if (changes?.ready.some(ready => ready.id === player.id)) {
      pulse(card, 'ready-bloom');
      move(card.querySelector('.player-avatar'), [{ transform: 'scale(.8) rotate(-12deg)' }, { transform: 'scale(1) rotate(0)' }]);
    }
    return card;
  });
  if (!desired.length) desired.push(element('p', 'empty-players', 'Вечер начинается с вас. Подключайтесь по QR-коду.'));
  for (const child of [...playersNode.children]) if (!desired.includes(child)) child.remove();
  desired.forEach((node, index) => {
    if (playersNode.children[index] !== node) playersNode.insertBefore(node, playersNode.children[index] || null);
  });
  const ids = new Set(players.map(player => player.id));
  for (const id of playerNodes.keys()) if (!ids.has(id)) playerNodes.delete(id);
  playersNode.style.setProperty('--player-columns', Math.min(capacity.players, Math.max(1, desired.length)));
  byId('players-page').textContent = pages > 1 ? `Участники ${playerPage + 1} / ${pages}` : 'ВМЕСТЕ ИНТЕРЕСНЕЕ';
  byId('player-count').textContent = `${players.length} в комнате`;
}

function updateBank(target) {
  if (target === bankTarget && animate()) return;
  cancelAnimationFrame(bankFrame);
  bankTarget = target;
  byId('bank-accessible').setAttribute('aria-label', `${target} очков`);
  byId('bank-card').style.setProperty('--bank-tempo', `${Math.max(2.5, 7 - Math.log1p(target) / 2)}s`);
  if (target === displayedBank) return;
  const start = displayedBank;
  if (target > start && baseline && animate()) pulse(byId('bank-card'), 'bank-surge');
  if (!animate()) { displayedBank = target; byId('bank-value').textContent = number.format(target); return; }
  const began = performance.now();
  const tick = now => {
    const progress = Math.min(1, (now - began) / 800);
    displayedBank = start + (target - start) * (1 - (1 - progress) ** 3);
    byId('bank-value').textContent = number.format(Math.round(displayedBank));
    if (progress < 1) bankFrame = requestAnimationFrame(tick);
    else displayedBank = target;
  };
  bankFrame = requestAnimationFrame(tick);
}

function render(changes) {
  const state = snapshot || { phase: 'POOL', players: [], items: [], totalBank: 0 };
  const ready = state.players.filter(player => player.ready).length;
  byId('room-name').textContent = state.roomName || 'HomeAuction';
  updateBank(state.totalBank || 0);
  byId('ready-label').textContent = `Готовы: ${ready} из ${state.players.length}`;
  const progress = state.players.length ? Math.round(ready / state.players.length * 100) : 0;
  byId('ready-progress').setAttribute('aria-valuenow', String(progress));
  byId('ready-progress').firstElementChild.style.width = `${progress}%`;
  document.body.classList.toggle('all-ready', progress === 100);
  const pool = state.phase === 'POOL';
  byId('pool-scene').hidden = !pool;
  byId('phase-teaser').hidden = pool;
  if (pool && !changingPage) renderLots({ reactions: changes?.reactions });
  renderPlayers(changes);
}

async function turnPage() {
  if (!snapshot || changingPage) return;
  playerPage++;
  renderPlayers();
  if (snapshot.items.length <= capacity.items) return;
  changingPage = true;
  const generation = ++transition;
  const exits = [...lotGrid.children].map((node, index) => move(node,
    [{ opacity: 1, transform: 'translateX(0) scale(1)' }, { opacity: 0, transform: 'translateX(-24px) scale(.96)' }],
    { duration: 220, delay: index * 25, easing: 'ease-in', fill: 'forwards' }));
  sound.play('page');
  await Promise.allSettled(exits.filter(Boolean).map(animation => animation.finished));
  if (generation !== transition) return;
  // Cancel exit fills before reusing cached cards on another page.
  exits.forEach(animation => animation?.cancel());
  itemPage++;
  changingPage = false;
  renderLots({ pageChange: true });
  elapsed = 0;
}

function cancelPageTurn() {
  transition++;
  changingPage = false;
  for (const node of lotGrid.children) motions.get(node)?.cancel();
}

function renderJoinAddress(address) {
  if (address === lastAddress) return;
  const image = byId('join-qr');
  try {
    const url = new URL(address);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported address');
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(window.HomeAuctionQR.makeQrSvg(url.href))}`;
    image.hidden = false;
    byId('join-address').textContent = url.host;
    byId('join-hint').textContent = url.protocol === 'https:' ? 'Наведите камеру. Вы в игре.' : 'Подключитесь к той же сети Wi-Fi';
    lastAddress = address;
  } catch {
    image.hidden = true;
    lastAddress = '';
    byId('join-address').textContent = 'Ожидание ссылки подключения';
  }
}

function updateActivity() {
  previousTime = performance.now();
  document.body.dataset.paused = String(!active());
  sound.setActive(active() && connected);
  if (!active()) { cancelPageTurn(); if (snapshot) render(); }
}

window.addEventListener('message', event => {
  if (window.parent === window || event.source !== window.parent || event.origin !== 'null') return;
  if (event.data?.type === 'homeauction:stage-connection') renderJoinAddress(event.data.address);
  if (event.data?.type === 'homeauction:stage-visibility') { embeddedActive = Boolean(event.data.active); updateActivity(); }
});
document.addEventListener('visibilitychange', updateActivity);
if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) renderJoinAddress(location.origin);

const muteButton = byId('sound-toggle');
sound.onChange = () => {
  const enabled = !sound.muted && sound.context?.state === 'running';
  muteButton.dataset.enabled = String(enabled);
  muteButton.setAttribute('aria-pressed', String(sound.muted));
  const label = enabled ? 'Выключить звук' : 'Включить звук';
  muteButton.title = label;
  muteButton.setAttribute('aria-label', label);
};
muteButton.addEventListener('click', () => {
  if (sound.muted) sound.setMuted(false);
  else if (sound.context?.state !== 'running') void sound.unlock();
  else sound.setMuted(true);
});
document.addEventListener('pointerdown', event => {
  if (!muteButton.contains(event.target) && !sound.muted) void sound.unlock();
}, { once: true });
sound.onChange();
void sound.unlock();

socket.on('state_update', state => {
  const changes = stageChanges(baseline, state);
  if (snapshot?.phase !== state.phase) { cancelPageTurn(); elapsed = 0; }
  snapshot = state;
  render(changes);
  baseline = state;
  if (!active()) return;
  if (changes.allReady) { sound.play('all-ready'); announce('Комната готова. Начинаем!'); }
  else if (changes.ready.length) { sound.play('ready'); announce(`${changes.ready[0].name} · готовность подтверждена`); }
  else if (changes.added.length) { sound.play('lot'); announce('Новая идея в игре'); }
  else if (changes.reactions.some(change => change.up > 0)) { sound.play('up'); announce('У кого-то появился фаворит'); }
  else if (changes.reactions.some(change => change.down > 0)) { sound.play('down'); announce('Мнения разделились'); }
  else if (changes.joined.length) announce(`${changes.joined[0].name} теперь с нами`);
});

function connectionStatus(value) {
  connected = value;
  baseline = null;
  byId('connection-status').textContent = value ? 'ПРЯМОЙ ЭФИР' : 'Переподключение...';
  byId('connection-status').classList.toggle('connected', value);
  updateActivity();
}
socket.on('connect', () => connectionStatus(true));
socket.on('disconnect', () => connectionStatus(false));
socket.on('connect_error', () => connectionStatus(false));
socket.on('auction_hard_reset', () => {
  cancelPageTurn(); itemPage = 0; playerPage = 0; elapsed = 0; baseline = null;
  clearTimeout(activityTimer); byId('activity').textContent = 'Начинаем новый вечер';
});

let resizeFrame;
window.addEventListener('resize', () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    const next = stageCapacity(innerWidth, innerHeight);
    if (next.items !== capacity.items || next.players !== capacity.players) {
      capacity = next; itemPage = 0; playerPage = 0; elapsed = 0; cancelPageTurn();
    }
    render();
  });
});
motionPreference.addEventListener('change', () => { cancelPageTurn(); render(); });
function clock(now) {
  const running = active() && connected && snapshot?.phase === 'POOL' && !changingPage;
  const step = advanceCarousel(elapsed, now - previousTime, running);
  previousTime = now;
  elapsed = step.elapsed;
  byId('pagination').style.setProperty('--page-progress', elapsed / PAGE_DURATION);
  if (step.advance) void turnPage();
  requestAnimationFrame(clock);
}
requestAnimationFrame(clock);
render();
