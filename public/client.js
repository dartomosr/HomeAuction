const socket = io();

// 1. ПАЛИТРЫ СЕКТОРОВ КОЛЕСА ПОД КАЖДУЮ ТЕМУ
const THEME_WHEEL_PALETTES = {
  anime: ['#ff2a5f', '#00e5ff', '#ffe600', '#7b2cbf', '#00f59b', '#ff6d00', '#3a86ff', '#ff007f'],
  casino: ['#8c2d38', '#1f4e3d', '#b8922f', '#2b3a4a', '#5e232a', '#2e5948', '#967117', '#382c1e'],
  terminal: ['#11421d', '#1b662e', '#0d2e15', '#24823b', '#175225', '#2b9c46'],
  paper: ['#d9381e', '#262626', '#d97706', '#2563eb', '#15803d', '#7c2d12', '#4f46e5', '#b91c1c'],
  nordic: ['#5e81ac', '#81a1c1', '#88c0d0', '#8fbcbb', '#a3be8c', '#ebcb8b', '#d08770', '#bf616a']
};

// 2. ЛОКАЛЬНОЕ СОСТОЯНИЕ БРАУЗЕРА
let appState = null;
let myToken = localStorage.getItem('auction_token') || null;
let myName = localStorage.getItem('auction_name') || '';
let soundEnabled = localStorage.getItem('auction_sound') !== 'off';
let currentTheme = localStorage.getItem('auction_theme') || 'anime';
let autoSpinActive = false;

// Состояние анимации колеса
let wheelRotation = 0; // Текущий угол поворота в радианах
let isAnimatingWheel = false;
let activeSpinSlices = null;

// 3. ЗВУКОВОЙ СИНТЕЗАТОР (Web Audio API — без внешних mp3 файлов)
let audioCtx = null;

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTickSound() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(620, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.035);

    gain.gain.setValueAtTime(0.16, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.035);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (_) {}
}

function playEliminatedSound() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.linearRampToValueAtTime(110, now + 0.35);

    gain.gain.setValueAtTime(0.22, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.38);

    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.4);
  } catch (_) {}
}

function playWinnerFanfare() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const now = audioCtx.currentTime + idx * 0.11;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now);
      osc.stop(now + 0.36);
    });
  } catch (_) {}
}

// 4. DOM-ЭЛЕМЕНТЫ
const themeSelect = document.getElementById('theme-select');
const btnSound = document.getElementById('btn-sound');
const phaseBadge = document.getElementById('phase-badge');
const myProfileChip = document.getElementById('my-profile-chip');
const myNameDisplay = document.getElementById('my-name-display');
const myHostBadge = document.getElementById('my-host-badge');

const screenJoin = document.getElementById('screen-join');
const screenApp = document.getElementById('screen-app');
const formJoin = document.getElementById('form-join');
const inputName = document.getElementById('input-name');

const playersListEl = document.getElementById('players-list');
const readyCounterEl = document.getElementById('ready-counter');

const roMaxPoints = document.getElementById('ro-max-points');
const roMaxItems = document.getElementById('ro-max-items');
const roKeepZero = document.getElementById('ro-keep-zero');
const hostSettingsForm = document.getElementById('host-settings-form');
const setMaxPoints = document.getElementById('set-max-points');
const setMaxItems = document.getElementById('set-max-items');
const setSpinDuration = document.getElementById('set-spin-duration');
const setKeepZero = document.getElementById('set-keep-zero');
const zeroWeightGroup = document.getElementById('zero-weight-group');
const setZeroWeight = document.getElementById('set-zero-weight');
const btnResetKeep = document.getElementById('btn-reset-keep');
const btnResetClear = document.getElementById('btn-reset-clear');

const viewPool = document.getElementById('view-pool');
const viewReveal = document.getElementById('view-reveal');

const myRemainingPointsEl = document.getElementById('my-remaining-points');
const myMaxPointsEl = document.getElementById('my-max-points');
const myItemsCountEl = document.getElementById('my-items-count');
const myMaxItemsEl = document.getElementById('my-max-items');
const btnDistributeEven = document.getElementById('btn-distribute-even');
const btnClearPoints = document.getElementById('btn-clear-points');
const btnReady = document.getElementById('btn-ready');

const formAddItem = document.getElementById('form-add-item');
const inputItemTitle = document.getElementById('input-item-title');
const btnAddItem = document.getElementById('btn-add-item');
const poolItemsList = document.getElementById('pool-items-list');

const winnerBanner = document.getElementById('winner-banner');
const winnerTitle = document.getElementById('winner-title');
const winnerPoints = document.getElementById('winner-points');

const aliveCounter = document.getElementById('alive-counter');
const wheelCanvas = document.getElementById('wheel-canvas');
const wheelCtx = wheelCanvas.getContext('2d');
const wheelStatusBox = document.getElementById('wheel-status-box');
const hostWheelControls = document.getElementById('host-wheel-controls');
const btnSpinWheel = document.getElementById('btn-spin-wheel');
const btnAutoSpin = document.getElementById('btn-auto-spin');

const hostMergeCard = document.getElementById('host-merge-card');
const mergeSource = document.getElementById('merge-source');
const mergeTarget = document.getElementById('merge-target');
const btnMerge = document.getElementById('btn-merge');

const revealItemsTbody = document.getElementById('reveal-items-tbody');
const eliminationHistory = document.getElementById('elimination-history');

// 5. ИНИЦИАЛИЗАЦИЯ ТЕМЫ И ЗВУКА
function applyTheme(themeName) {
  currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  localStorage.setItem('auction_theme', themeName);
  if (themeSelect.value !== themeName) themeSelect.value = themeName;
  drawWheel();
}

applyTheme(currentTheme);
themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));

function updateSoundButton() {
  btnSound.textContent = soundEnabled ? 'Звук: ВКЛ' : 'Звук: ВЫКЛ';
}
updateSoundButton();

btnSound.addEventListener('click', () => {
  initAudio();
  soundEnabled = !soundEnabled;
  localStorage.setItem('auction_sound', soundEnabled ? 'on' : 'off');
  updateSoundButton();
});

// Уведомления
function showToast(msg) {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

// 6. ВХОД И АВТО-ПЕРЕПОДКЛЮЧЕНИЕ
if (myName) {
  inputName.value = myName;
}

socket.on('connect', () => {
  if (myToken && myName) {
    socket.emit('join', { token: myToken, name: myName });
  }
});

formJoin.addEventListener('submit', (e) => {
  e.preventDefault();
  initAudio();
  const clean = inputName.value.trim();
  if (!clean) return;
  myName = clean;
  localStorage.setItem('auction_name', myName);
  socket.emit('join', { token: myToken, name: myName });
});

socket.on('joined', ({ token }) => {
  myToken = token;
  localStorage.setItem('auction_token', token);
  screenJoin.classList.add('hidden');
  screenApp.classList.remove('hidden');
  myProfileChip.classList.remove('hidden');
});

socket.on('toast_error', (msg) => {
  showToast(msg);
});

// 7. ПОЛУЧЕНИЕ ОБНОВЛЕНИЯ СОСТОЯНИЯ ОТ СЕРВЕРА
socket.on('state_update', (state) => {
  const prevPhase = appState ? appState.phase : null;
  appState = state;

  if (!state.me) return;

  // Обновляем шапку
  myNameDisplay.textContent = state.me.name;
  myHostBadge.classList.toggle('hidden', !state.me.isHost);

  if (state.phase === 'POOL') {
    phaseBadge.textContent = 'ЭТАП 1: ТАЙНЫЙ ПУЛ';
    autoSpinActive = false;
  } else if (state.phase === 'REVEAL') {
    phaseBadge.textContent = 'ЭТАП 2: КОЛЕСО НА ВЫБЫВАНИЕ';
  } else if (state.phase === 'FINISHED') {
    phaseBadge.textContent = 'ФИНАЛ: ПОБЕДИТЕЛЬ ОПРЕДЕЛЕН';
    autoSpinActive = false;
    if (prevPhase !== 'FINISHED') playWinnerFanfare();
  }

  renderSidebar(state);
  renderMainArea(state);

  if (!isAnimatingWheel) {
    drawWheel();
  }

  // Если включена авто-крутка до победителя (у Хоста)
  if (
    autoSpinActive &&
    state.me.isHost &&
    state.phase === 'REVEAL' &&
    !state.wheel.isSpinning &&
    !isAnimatingWheel
  ) {
    const aliveCount = state.items.filter((i) => !i.eliminated).length;
    if (aliveCount > 1) {
      setTimeout(() => {
        if (autoSpinActive && !appState.wheel.isSpinning) {
          socket.emit('spin_wheel');
        }
      }, 950);
    } else {
      autoSpinActive = false;
    }
  }
});

// 8. ОТРИСОВКА БОКОВОЙ ПАНЕЛИ (ИГРОКИ + НАСТРОЙКИ)
function renderSidebar(state) {
  const readyCount = state.players.filter((p) => p.ready).length;
  readyCounterEl.textContent = `${readyCount} / ${state.players.length} готовы`;

  playersListEl.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = `player-item ${p.online ? '' : 'is-offline'}`;

    const left = document.createElement('div');
    left.className = 'player-name-wrap';
    left.textContent = p.name + (p.isMe ? ' (Вы)' : '');

if (p.isHost) {
      const hBadge = document.createElement('span');
      hBadge.className = 'host-tag';
      hBadge.textContent = 'HOST';
      left.appendChild(hBadge);
    }

    const status = document.createElement('span');
    status.className = `player-status ${p.ready ? 'status-ready' : 'status-wait'}`;
    status.textContent = p.ready ? 'ГОТОВ' : 'ДУМАЕТ';

    li.appendChild(left);
    li.appendChild(status);
    playersListEl.appendChild(li);
  });

  // Сводка настроек
  roMaxPoints.textContent = state.settings.maxPoints;
  roMaxItems.textContent = state.settings.maxItems;
  roKeepZero.textContent = state.settings.keepZeroItems
    ? `На колесе (вес ${state.settings.zeroItemWeight})`
    : 'Удаляются';

  // Если мы Хост — показываем форму настроек
  if (state.me.isHost) {
    hostSettingsForm.classList.remove('hidden');
    if (document.activeElement !== setMaxPoints &&
        document.activeElement !== setMaxItems &&
        document.activeElement !== setSpinDuration &&
        document.activeElement !== setZeroWeight) {
      setMaxPoints.value = state.settings.maxPoints;
      setMaxItems.value = state.settings.maxItems;
      setSpinDuration.value = state.settings.spinDuration;
      setKeepZero.checked = state.settings.keepZeroItems;
      setZeroWeight.value = state.settings.zeroItemWeight;
      zeroWeightGroup.classList.toggle('hidden', !state.settings.keepZeroItems);
    }
  } else {
    hostSettingsForm.classList.add('hidden');
  }
}

setKeepZero.addEventListener('change', () => {
  zeroWeightGroup.classList.toggle('hidden', !setKeepZero.checked);
});

hostSettingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('update_settings', {
    maxPoints: Number(setMaxPoints.value),
    maxItems: Number(setMaxItems.value),
    spinDuration: Number(setSpinDuration.value),
    keepZeroItems: setKeepZero.checked,
    zeroItemWeight: Number(setZeroWeight.value)
  });
  showToast('Настройки обновлены');
});

btnResetKeep.addEventListener('click', () => {
  autoSpinActive = false;
  socket.emit('reset_auction', { clearItems: false });
});

btnResetClear.addEventListener('click', () => {
  if (confirm('Очистить все варианты и начать с чистого листа?')) {
    autoSpinActive = false;
    socket.emit('reset_auction', { clearItems: true });
  }
});

// 9. ОТРИСОВКА ОСНОВНОЙ ОБЛАСТИ (ПУЛ ИЛИ КОЛЕСО)
function renderMainArea(state) {
  if (state.phase === 'POOL') {
    viewPool.classList.remove('hidden');
    viewReveal.classList.add('hidden');
    renderPoolView(state);
  } else {
    viewPool.classList.add('hidden');
    viewReveal.classList.remove('hidden');
    renderRevealView(state);
  }
}

function renderPoolView(state) {
  myRemainingPointsEl.textContent = state.me.remainingPoints;
  myMaxPointsEl.textContent = state.settings.maxPoints;
  myItemsCountEl.textContent = state.me.myItemsCount;
  myMaxItemsEl.textContent = state.settings.maxItems;

  const isLocked = state.me.ready;
  inputItemTitle.disabled = isLocked || state.me.myItemsCount >= state.settings.maxItems;
  btnAddItem.disabled = isLocked || state.me.myItemsCount >= state.settings.maxItems;
  btnDistributeEven.disabled = isLocked || state.items.length === 0;
  btnClearPoints.disabled = isLocked || state.me.mySpentPoints === 0;

  btnReady.textContent = isLocked ? '✓ ВЫ ГОТОВЫ (ОТМЕНИТЬ)' : 'Я ГОТОВ';
  btnReady.classList.toggle('is-ready', isLocked);

  poolItemsList.innerHTML = '';
  if (state.items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted-text';
    empty.textContent = 'Пока никто не добавил ни одного варианта. Будьте первым!';
    poolItemsList.appendChild(empty);
    return;
  }

  state.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = `pool-item-card ${item.myPoints > 0 ? 'has-my-points' : ''}`;

    const left = document.createElement('div');
    left.className = 'pool-item-left';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pool-item-title';
    titleSpan.textContent = item.title;
    left.appendChild(titleSpan);

    if (item.canDelete && !isLocked) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '✕';
      delBtn.title = 'Удалить мой вариант';
      delBtn.addEventListener('click', () => {
        socket.emit('delete_item', { itemId: item.id });
      });
      left.appendChild(delBtn);
    }

    const controls = document.createElement('div');
    controls.className = 'pool-item-controls';

    const maxPossibleForThisItem = item.myPoints + state.me.remainingPoints;

    // Кнопки быстрого шага (-10, -1, ползунок, числовое поле, +1, +10, MAX)
    const makeStepBtn = (label, delta) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = label;
      b.disabled = isLocked;
      b.addEventListener('click', () => {
        socket.emit('set_points', {
          itemId: item.id,
          points: Math.max(0, item.myPoints + delta)
        });
      });
      return b;
    };

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pts-slider';
    slider.min = 0;
    slider.max = state.settings.maxPoints;
    slider.value = item.myPoints;
    slider.disabled = isLocked;
    slider.addEventListener('input', () => {
      const clamped = Math.min(Number(slider.value), maxPossibleForThisItem);
      slider.value = clamped;
      numInput.value = clamped;
    });
    slider.addEventListener('change', () => {
      socket.emit('set_points', { itemId: item.id, points: Number(slider.value) });
    });

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'input-text pts-input';
    numInput.min = 0;
    numInput.max = maxPossibleForThisItem;
    numInput.value = item.myPoints;
    numInput.disabled = isLocked;
    numInput.addEventListener('change', () => {
      socket.emit('set_points', { itemId: item.id, points: Number(numInput.value) });
    });

    controls.appendChild(makeStepBtn('-10', -10));
    controls.appendChild(makeStepBtn('-1', -1));
    controls.appendChild(slider);
    controls.appendChild(numInput);
    controls.appendChild(makeStepBtn('+1', 1));
    controls.appendChild(makeStepBtn('+10', 10));

    card.appendChild(left);
    card.appendChild(controls);
    poolItemsList.appendChild(card);
  });
}

// Добавление варианта
formAddItem.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = inputItemTitle.value.trim();
  if (!title) return;
  socket.emit('add_item', { title });
  inputItemTitle.value = '';
});

// Раскидать очки поровну
btnDistributeEven.addEventListener('click', () => {
  if (!appState || appState.items.length === 0) return;
  const count = appState.items.length;
  const total = appState.settings.maxPoints;
  const base = Math.floor(total / count);
  let rem = total % count;

  appState.items.forEach((it) => {
    const pts = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    socket.emit('set_points', { itemId: it.id, points: pts });
  });
});

// Обнулить мои ставки
btnClearPoints.addEventListener('click', () => {
  if (!appState) return;
  appState.items.forEach((it) => {
    if (it.myPoints > 0) {
      socket.emit('set_points', { itemId: it.id, points: 0 });
    }
  });
});

// Готовность
btnReady.addEventListener('click', () => {
  initAudio();
  socket.emit('toggle_ready');
});

// 10. ФАЗА 2 И 3: КОЛЕСО, СЛИЯНИЕ ДУБЛИКАТОВ И ТАБЛИЦА ВЕРОЯТНОСТЕЙ
function renderRevealView(state) {
  const aliveItems = state.items.filter((i) => !i.eliminated);
  aliveCounter.textContent = `В игре: ${aliveItems.length} из ${state.items.length}`;

  // Баннер победителя
  if (state.phase === 'FINISHED' && state.wheel.winner) {
    winnerBanner.classList.remove('hidden');
    winnerTitle.textContent = state.wheel.winner.title;
    winnerPoints.textContent = `Суммарный пул варианта: ${state.wheel.winner.totalPoints} очков`;
    wheelStatusBox.textContent = `Победитель аукциона: «${state.wheel.winner.title}»!`;
  } else {
    winnerBanner.classList.add('hidden');
    if (!state.wheel.isSpinning && !isAnimatingWheel) {
      wheelStatusBox.textContent =
        'Стрелка справа указывает на выбывающий сектор. Последний оставшийся вариант побеждает!';
    }
  }

  // Кнопки управления колесом для Хоста
  if (state.me.isHost && state.phase === 'REVEAL') {
    hostWheelControls.classList.remove('hidden');
    btnSpinWheel.disabled = state.wheel.isSpinning || isAnimatingWheel || aliveItems.length < 1;
    btnAutoSpin.textContent = autoSpinActive ? 'Остановить авто-крутку' : 'Авто-крутка до победителя';
  } else {
    hostWheelControls.classList.add('hidden');
  }

  // Панель объединения дубликатов (доступна Хосту до первого вращения колеса)
  if (state.me.isHost && state.phase === 'REVEAL' && !state.wheel.hasStarted && aliveItems.length >= 2) {
    hostMergeCard.classList.remove('hidden');
    const prevSource = mergeSource.value;
    const prevTarget = mergeTarget.value;
    mergeSource.innerHTML = '';
    mergeTarget.innerHTML = '';

    aliveItems.forEach((it) => {
      const opt1 = document.createElement('option');
      opt1.value = it.id;
      opt1.textContent = `${it.title} (${it.totalPoints} очк.)`;
      mergeSource.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = it.id;
      opt2.textContent = `${it.title} (${it.totalPoints} очк.)`;
      mergeTarget.appendChild(opt2);
    });

    if (prevSource) mergeSource.value = prevSource;
    if (prevTarget && prevTarget !== mergeSource.value) {
      mergeTarget.value = prevTarget;
    } else if (aliveItems.length > 1) {
      mergeTarget.selectedIndex = 1;
    }
  } else {
    hostMergeCard.classList.add('hidden');
  }

  // Сортируем варианты в таблице по убыванию очков
  const sortedItems = [...state.items].sort((a, b) => b.effectivePoints - a.effectivePoints);
  revealItemsTbody.innerHTML = '';

  sortedItems.forEach((it) => {
    const tr = document.createElement('tr');
    const isWinner = state.phase === 'FINISHED' && state.wheel.winner && state.wheel.winner.id === it.id;
    if (it.eliminated) tr.classList.add('is-eliminated');
    if (isWinner) tr.classList.add('is-winner');

    const tdTitle = document.createElement('td');
    tdTitle.textContent = it.title;

    const tdTotal = document.createElement('td');
    tdTotal.innerHTML = `<strong>${it.totalPoints}</strong>`;

    const tdMy = document.createElement('td');
    tdMy.textContent = it.myPoints;

    const tdWinProb = document.createElement('td');
    tdWinProb.textContent = `${it.winProbability.toFixed(1)}%`;

    const tdElimShare = document.createElement('td');
    tdElimShare.textContent = it.eliminated ? '—' : `${it.roundElimShare.toFixed(1)}%`;

    const tdStatus = document.createElement('td');
    if (isWinner) {
      tdStatus.textContent = '🏆 ПОБЕДИТЕЛЬ';
    } else if (it.eliminated) {
      tdStatus.textContent = 'Выбыл';
    } else {
      tdStatus.textContent = 'В игре';
    }

    tr.append(tdTitle, tdTotal, tdMy, tdWinProb, tdElimShare, tdStatus);
    revealItemsTbody.appendChild(tr);
  });

  // Лог выбывания
  eliminationHistory.innerHTML = '';
  if (state.wheel.history.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted-text';
    li.textContent = 'Пока никто не выбыл';
    eliminationHistory.appendChild(li);
  } else {
    state.wheel.history.forEach((h) => {
      const li = document.createElement('li');
      li.textContent = `${h.title} (${h.totalPoints} очк.)`;
      eliminationHistory.appendChild(li);
    });
  }
}

btnMerge.addEventListener('click', () => {
  const sourceId = mergeSource.value;
  const targetId = mergeTarget.value;
  if (!sourceId || !targetId || sourceId === targetId) {
    showToast('Выберите два разных варианта для объединения');
    return;
  }
  socket.emit('merge_items', { sourceId, targetId });
});

btnSpinWheel.addEventListener('click', () => {
  initAudio();
  socket.emit('spin_wheel');
});

btnAutoSpin.addEventListener('click', () => {
  initAudio();
  autoSpinActive = !autoSpinActive;
  btnAutoSpin.textContent = autoSpinActive ? 'Остановить авто-крутку' : 'Авто-крутка до победителя';
  if (autoSpinActive && appState && !appState.wheel.isSpinning && !isAnimatingWheel) {
    socket.emit('spin_wheel');
  }
});

// 11. ОТРИСОВКА И СИНХРОННАЯ АНИМАЦИЯ КОЛЕСА НА CANVAS
function getCurrentWheelSlices() {
  if (isAnimatingWheel && activeSpinSlices) {
    return activeSpinSlices;
  }
  if (!appState) return [];
  const alive = appState.items.filter((i) => !i.eliminated);
  if (alive.length === 0) return [];

  const invWeights = alive.map((it) => 1 / (it.effectivePoints || 0.5));
  const totalInv = invWeights.reduce((a, b) => a + b, 0);

  return alive.map((it, idx) => ({
    id: it.id,
    title: it.title,
    totalPoints: it.totalPoints,
    share: totalInv > 0 ? invWeights[idx] / totalInv : 1 / alive.length
  }));
}

function drawWheel() {
  const width = wheelCanvas.width;
  const height = wheelCanvas.height;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(cx, cy) - 18;

  wheelCtx.clearRect(0, 0, width, height);

  const slices = getCurrentWheelSlices();
  if (slices.length === 0) return;

  const palette = THEME_WHEEL_PALETTES[currentTheme] || THEME_WHEEL_PALETTES.anime;

  let currentAngle = wheelRotation;

  slices.forEach((slice, index) => {
    const sliceAngle = slice.share * Math.PI * 2;
    const endAngle = currentAngle + sliceAngle;

    // Сектор
    wheelCtx.beginPath();
    wheelCtx.moveTo(cx, cy);
    wheelCtx.arc(cx, cy, radius, currentAngle, endAngle);
    wheelCtx.closePath();

    wheelCtx.fillStyle = palette[index % palette.length];
    wheelCtx.fill();

    wheelCtx.lineWidth = 2;
    wheelCtx.strokeStyle = '#0a0a0f';
    wheelCtx.stroke();

    // Подпись внутри сектора (если сектор достаточно широкий)
    if (sliceAngle > 0.085) {
      wheelCtx.save();
      wheelCtx.translate(cx, cy);
      wheelCtx.rotate(currentAngle + sliceAngle / 2);
      wheelCtx.textAlign = 'right';
      wheelCtx.textBaseline = 'middle';
      wheelCtx.fillStyle = '#ffffff';
      wheelCtx.font = 'bold 14px Manrope, sans-serif';
      wheelCtx.shadowColor = 'rgba(0, 0, 0, 0.85)';
      wheelCtx.shadowBlur = 4;

      const maxLabel = slice.title.length > 20 ? slice.title.slice(0, 18) + '…' : slice.title;
      wheelCtx.fillText(`${maxLabel} (${slice.totalPoints})`, radius - 18, 0);
      wheelCtx.restore();
    }

    currentAngle = endAngle;
  });

  // Внешний обод колеса
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  wheelCtx.lineWidth = 5;
  wheelCtx.strokeStyle = '#111111';
  wheelCtx.stroke();

  // Центральная втулка
  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, 28, 0, Math.PI * 2);
  wheelCtx.fillStyle = '#14161f';
  wheelCtx.fill();
  wheelCtx.lineWidth = 3;
  wheelCtx.strokeStyle = '#ffffff';
  wheelCtx.stroke();
}

// Событие синхронного запуска колеса от сервера
socket.on('wheel_spin', ({ slices, eliminatedTitle, targetFraction, extraSpins, durationSec }) => {
  initAudio();
  isAnimatingWheel = true;
  activeSpinSlices = slices;
  wheelStatusBox.textContent = 'Колесо крутится... Кто покинет аукцион?';

  const twoPi = Math.PI * 2;
  const startRotation = wheelRotation % twoPi;

  // Указатель находится справа на угле 0 радиан.
  // Чтобы точка targetFraction оказалась на угле 0, финальный угол (по модулю 2*PI) должен быть (1 - targetFraction) * 2*PI
  const desiredEndMod = ((1 - targetFraction) * twoPi + twoPi) % twoPi;
  let delta = desiredEndMod - startRotation;
  if (delta <= 0) delta += twoPi;

  const totalDelta = extraSpins * twoPi + delta;
  const targetRotation = startRotation + totalDelta;
  const durationMs = durationSec * 1000;
  const startTime = performance.now();

  // Вычисляем границы секторов для звуковых щелчков
  const boundaries = [];
  let acc = 0;
  slices.forEach((s) => {
    boundaries.push(acc);
    acc += s.share;
  });

  function getSliceIndexAtPointer(rot) {
    const norm = ((twoPi - (rot % twoPi)) % twoPi) / twoPi;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (norm >= boundaries[i]) return i;
    }
    return 0;
  }

  let lastSliceIdx = getSliceIndexAtPointer(startRotation);

  function easeOutQuart(t) {
    return 1 - Math.pow(1 - t, 4);
  }

  function animateFrame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    const eased = easeOutQuart(progress);

    wheelRotation = startRotation + totalDelta * eased;
    drawWheel();

    const currentSliceIdx = getSliceIndexAtPointer(wheelRotation);
    if (currentSliceIdx !== lastSliceIdx) {
      playTickSound();
      lastSliceIdx = currentSliceIdx;
    }

    if (progress < 1) {
      requestAnimationFrame(animateFrame);
    } else {
      isAnimatingWheel = false;
      activeSpinSlices = null;
      playEliminatedSound();
      wheelStatusBox.textContent = `❌ Выбывает вариант: «${eliminatedTitle}»!`;
    }
  }

  requestAnimationFrame(animateFrame);
});