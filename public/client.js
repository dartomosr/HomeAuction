const socket = io();

// 1. ПАЛИТРЫ СЕКТОРОВ КОЛЕСА ПОД КАЖДУЮ ТЕМУ
const THEME_WHEEL_PALETTES = {
  anime: ['#bb6279', '#5b91a7', '#bba46e', '#846f9c', '#669b86', '#b18360', '#6e85b0', '#a66c91'],
  casino: ['#8c2d38', '#1f4e3d', '#b8922f', '#2b3a4a', '#5e232a', '#2e5948', '#967117', '#382c1e'],
  terminal: ['#ebbcba', '#9ccfd8', '#f6c177', '#c4a7e7', '#31748f', '#eb6f92', '#908caa', '#b9b4ce'],
  paper: ['#b96860', '#69635f', '#bb9462', '#798fa5', '#759481', '#9b7866', '#8e85a5', '#a77579'],
  nordic: ['#5e81ac', '#81a1c1', '#88c0d0', '#8fbcbb', '#a3be8c', '#ebcb8b', '#d08770', '#bf616a']
};

// 2. ЛОКАЛЬНОЕ СОСТОЯНИЕ БРАУЗЕРА
let appState = null;
let myToken = localStorage.getItem('auction_token') || null;
let myName = localStorage.getItem('auction_name') || '';
let soundEnabled = localStorage.getItem('auction_sound') !== 'off';
let currentTheme = localStorage.getItem('auction_theme') || 'anime';
let autoSpinActive = false;
let autoSpinTimer = null;
let activeSpinFrame = null;
let activeElimination = null;
let lastFxType = null;
const SPIN_COMMENTS = [
  'Колесо решает судьбу лота — чьи шансы не выдержат?',
  'Круг замыкается. Не всем суждено пройти дальше…',
  'Ставки сделаны, исход скрыт за оборотами.',
  'Ещё один оборот — и один участник покинет гонку.',
  'Стрелка ищет следующего выбывшего. Напряжение растёт!',
  'Сектора мелькают… Чья история здесь закончится?',
  'Удача любит интригу. Колесо уже в пути!',
  'Очки влияют на риск, но в этот момент всё решает случай.',
  'Подождите вердикта колеса: выбор уже сделан.'
];
const ELIMINATION_EFFECTS = [
  ['fold', '0 · Обычное сворачивание'],
  ['glass', '1 · Разбитое стекло'],
  ['blast', '2 · Взрыв'],
  ['shot', '3 · Выстрел'],
  ['bubble', '4 · Лопнувший пузырь'],
  ['slash', '5 · Прямой разрез'],
  ['glitch', '6 · Цифровой сбой'],
  ['pixels', '7 · Пиксельный распад'],
  ['vortex', '8 · Вихрь'],
  ['split', '9 · Трещина и падающий верх']
];
let effectsEnabled = localStorage.getItem('auction_effects_enabled') !== 'off';
let enabledEffects;
try {
  const storedEffects = JSON.parse(localStorage.getItem('auction_effect_list'));
  enabledEffects = Array.isArray(storedEffects) ? storedEffects.filter(v => ELIMINATION_EFFECTS.some(([id]) => id === v)) : ELIMINATION_EFFECTS.map(([id]) => id);
} catch (_) {
  enabledEffects = ELIMINATION_EFFECTS.map(([id]) => id);
}

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
const roFlexiblePoints = document.getElementById('ro-flexible-points');
const roForeignPoints = document.getElementById('ro-foreign-points');
const setRestrictOwn = document.getElementById('set-restrict-own');
const setForeignOnly = document.getElementById('set-foreign-only');
const ownLimitGroup = document.getElementById('own-limit-group');
const pointsSplitPreview = document.getElementById('points-split-preview');
const poolFlexiblePoints = document.getElementById('pool-flexible-points');
const poolFlexibleNote = document.getElementById('pool-flexible-note');
const poolForeignPoints = document.getElementById('pool-foreign-points');
const poolForeignUnit = document.getElementById('pool-foreign-unit');
const poolForeignNote = document.getElementById('pool-foreign-note');
const hostSettingsForm = document.getElementById('host-settings-form');
const setMaxPoints = document.getElementById('set-max-points');
const setMaxItems = document.getElementById('set-max-items');
const setSpinDuration = document.getElementById('set-spin-duration');
const wheelDurationPanel = document.getElementById('wheel-duration-panel');
const hostDurationControl = document.getElementById('host-duration-control');
const durationReadonly = document.getElementById('duration-readonly');
const durationApply = document.getElementById('duration-apply');
const durationMinus = document.getElementById('duration-minus');
const durationPlus = document.getElementById('duration-plus');
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
const wheelStage = document.getElementById('wheel-stage');
const wheelPointer = document.getElementById('wheel-pointer');
const wheelLegend = document.getElementById('wheel-legend');
const wheelTooltip = document.getElementById('wheel-slice-tooltip');
const wheelCard = document.querySelector('.wheel-card');
const btnWheelFocus = document.getElementById('btn-wheel-focus');
const wheelParticles = document.getElementById('wheel-particles');
const particleCtx = wheelParticles.getContext('2d');
const fxCanvas = document.getElementById('wheel-fx-canvas');
const wheelFx = new WheelSectorEffects(fxCanvas);
const effectsCheckboxes = document.getElementById('effects-checkboxes');
const effectsSelectAll = document.getElementById('fx-select-all');
const effectsMasterToggle = document.getElementById('fx-master-toggle');
const effectsSelectNone = document.getElementById('fx-select-none');
const effectsSettings = document.getElementById('effects-settings');
const btnToggleEffects = document.getElementById('btn-toggle-effects');
const btnResetHard = document.getElementById('btn-reset-hard');
let wheelPixelRatio = 1;
let wheelLabelFont = getComputedStyle(document.body).fontFamily;
const motionReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
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

// Выбор эффектов хранится только в браузере: вероятности на сервере не меняются.
function renderEffectsControls() {
  effectsCheckboxes.replaceChildren();
  for (const [id, label] of ELIMINATION_EFFECTS) {
    const wrapper = document.createElement('label');
    wrapper.className = 'fx-checkbox-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = enabledEffects.includes(id);
    checkbox.disabled = !effectsEnabled;
    checkbox.addEventListener('change', () => {
      enabledEffects = checkbox.checked
        ? [...new Set([...enabledEffects, id])]
        : enabledEffects.filter(effect => effect !== id);
      localStorage.setItem('auction_effect_list', JSON.stringify(enabledEffects));
      effectsMasterToggle.checked = enabledEffects.length === ELIMINATION_EFFECTS.length;
      effectsMasterToggle.indeterminate = enabledEffects.length > 0 && !effectsMasterToggle.checked;
    });
    wrapper.append(checkbox, document.createTextNode(label));
    effectsCheckboxes.appendChild(wrapper);
  }
  effectsMasterToggle.checked = enabledEffects.length === ELIMINATION_EFFECTS.length;
  effectsMasterToggle.indeterminate = enabledEffects.length > 0 && !effectsMasterToggle.checked;
  btnToggleEffects.textContent = effectsEnabled ? '✨ Эффекты: ВКЛ' : '◌ Эффекты: ВЫКЛ';
  btnToggleEffects.setAttribute('aria-pressed', String(effectsEnabled));
}
function setAllEffects(enabled) {
  enabledEffects = enabled ? ELIMINATION_EFFECTS.map(([id]) => id) : [];
  localStorage.setItem('auction_effect_list', JSON.stringify(enabledEffects));
  renderEffectsControls();
}
effectsMasterToggle.addEventListener('change', () => setAllEffects(effectsMasterToggle.checked));
effectsSelectAll.addEventListener('click', () => setAllEffects(true));
effectsSelectNone.addEventListener('click', () => setAllEffects(false));
btnToggleEffects.addEventListener('click', () => {
  effectsEnabled = !effectsEnabled;
  localStorage.setItem('auction_effects_enabled', effectsEnabled ? 'on' : 'off');
  renderEffectsControls();
});
// Не оставляем раскрытое меню поверх колеса при клике в другом месте.
document.addEventListener('click', (event) => {
  if (!effectsSettings.contains(event.target)) effectsSettings.open = false;
});
renderEffectsControls();

// Негромкие локальные звуки без внешних аудиофайлов. Для стекла —
// короткий сухой треск (фильтрованный шум) и несколько высоких звонов.
function playFxTone(effect) {
  if (!soundEnabled || !audioCtx || effect === 'fold') return;
  try {
    const now = audioCtx.currentTime;
    if (['glass', 'shot', 'blast', 'bubble', 'slash'].includes(effect)) {
      const duration = effect === 'glass' ? .32 : effect === 'blast' ? .49 : .17;
      const sampleRate = audioCtx.sampleRate;
      const buffer = audioCtx.createBuffer(1, Math.ceil(sampleRate * duration), sampleRate);
      const channel = buffer.getChannelData(0);
      let smoothed = 0;
      for (let i = 0; i < channel.length; i++) {
        const t = i / sampleRate;
        const noise = (Math.random() * 2 - 1);
        smoothed = smoothed * .74 + noise * .26;
        const envelope = Math.pow(1 - t / duration, effect === 'glass' ? 3.4 : 1.8);
        channel[i] = (noise * .55 + smoothed * .45) * envelope;
      }
      const noiseSource = audioCtx.createBufferSource();
      noiseSource.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = effect === 'glass' ? 'highpass' : 'lowpass';
      filter.frequency.value = effect === 'glass' ? 1700 : effect === 'shot' ? 1800 : 600;
      const gain = audioCtx.createGain();
      gain.gain.value = effect === 'glass' ? .055 : effect === 'shot' ? .075 : .065;
      noiseSource.connect(filter); filter.connect(gain); gain.connect(audioCtx.destination);
      noiseSource.start(now); noiseSource.stop(now + duration);
    }
    if (effect === 'glass') {
      [830, 1230, 1910, 2560].forEach((frequency, i) => {
        const start = now + i * .024;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(.018, start);
        gain.gain.exponentialRampToValueAtTime(.0001, start + .19 + i * .04);
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.start(start); osc.stop(start + .23 + i * .04);
      });
    }
  } catch (_) {}
}

// Сектор разрушается именно на Canvas колеса. Нет ни всплывающих окон,
// ни дубля названия поверх страницы. Цвет/текст превращаются в части сектора.
function showEliminationEffect(title, eliminatedId, slices, fxSeed) {
  wheelFx.cancel();
  activeElimination = null;
  if (motionReduced.matches) return 'fold';
  const index = slices.findIndex(s => s.id === eliminatedId) >= 0
    ? slices.findIndex(s => s.id === eliminatedId)
    : slices.findIndex(s => s.title === title);
  if (index < 0) return 'fold';

  const list = effectsEnabled ? enabledEffects : [];
  // Результат случайный, но воспроизводимый на клиентах с одинаковыми галочками.
  const id = list.length ? list[(fxSeed >>> 0) % list.length] : 'fold';
  const geometry = getWheelGeometry();
  if (!geometry.width || !geometry.height) return 'fold';
  const spinSlices = slices.map(s => ({ ...s }));
  // Сохраняем геометрию предыдущего раунда до окончания эффекта.
  activeElimination = { index, slices: spinSlices };
  wheelStage.classList.add('is-eliminating');
  wheelStage.classList.remove('spin-finished');
  lastFxType = id;
  try {
    wheelFx.start({
      wheelCanvas, geometry, index, slices: spinSlices, rotation: wheelRotation,
      kind: id, seed: fxSeed, duration: id === 'shot' ? 3100 : id === 'glass' ? 2900 : 2450,
      onComplete: () => {
        activeElimination = null;
        wheelStage.classList.remove('is-eliminating');
        drawWheel();
        renderWheelLegend();
        // Автоматическая прокрутка начинается после эффекта, а не поверх него.
        if (autoSpinActive && appState?.me?.isHost && appState.phase === 'REVEAL' &&
            !appState.wheel.isSpinning && appState.items.filter(i => !i.eliminated).length > 1) {
          clearTimeout(autoSpinTimer);
          autoSpinTimer = setTimeout(() => {
            autoSpinTimer = null;
            if (autoSpinActive && !isAnimatingWheel && !activeElimination &&
                appState?.phase === 'REVEAL' && !appState.wheel.isSpinning) socket.emit('spin_wheel');
          }, 650);
        }
        if (appState) renderMainArea(appState);
      }
    });
    drawWheel();
    playFxTone(id);
  } catch (err) {
    console.error('Ошибка эффекта сектора', err);
    wheelFx.cancel();
    activeElimination = null;
    wheelStage.classList.remove('is-eliminating');
    drawWheel();
    return 'fold';
  }
  return id;
}

function resetClientVisualState() {
  autoSpinActive = false;
  clearTimeout(autoSpinTimer);
  autoSpinTimer = null;
  if (activeSpinFrame !== null) cancelAnimationFrame(activeSpinFrame);
  activeSpinFrame = null;
  wheelFx.cancel();
  activeElimination = null;
  wheelStage.classList.remove('is-eliminating');
  wheelRotation = 0;
  isAnimatingWheel = false;
  activeSpinSlices = null;
  wheelStage.classList.remove('is-spinning', 'spin-finished', 'is-eliminating');
  particleCtx.clearRect(0, 0, wheelParticles.width, wheelParticles.height);
  wheelStatusBox.textContent = 'Колесо готово к новому аукциону';
}

// 5. ИНИЦИАЛИЗАЦИЯ ТЕМЫ И ЗВУКА
function applyTheme(themeName) {
  currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  wheelLabelFont = getComputedStyle(document.body).fontFamily;
  localStorage.setItem('auction_theme', themeName);
  if (themeSelect.value !== themeName) themeSelect.value = themeName;
  drawWheel();
  renderWheelLegend();
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

socket.on('auction_hard_reset', () => {
  resetClientVisualState();
  appState = null;
  myToken = null;
  localStorage.removeItem('auction_token');
  screenApp.classList.add('hidden');
  screenJoin.classList.remove('hidden');
  myProfileChip.classList.add('hidden');
  phaseBadge.textContent = 'КОМНАТА ОЧИЩЕНА';
  showToast('Комната полностью очищена. Войдите заново, сервер продолжает работать.');
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

  if (!activeElimination) renderWheelLegend();
  if (!isAnimatingWheel && !activeElimination) {
    resizeWheelCanvas();
    drawWheel();
  }

  // Если включена авто-крутка до победителя (у Хоста)
  if (
    autoSpinActive &&
    state.me.isHost &&
    state.phase === 'REVEAL' &&
    !state.wheel.isSpinning &&
    !isAnimatingWheel && !activeElimination
  ) {
    const aliveCount = state.items.filter((i) => !i.eliminated).length;
    if (aliveCount > 1) {
      clearTimeout(autoSpinTimer);
      autoSpinTimer = setTimeout(() => {
        autoSpinTimer = null;
        if (autoSpinActive && appState && appState.phase === 'REVEAL' && !appState.wheel.isSpinning && !isAnimatingWheel && !activeElimination) {
          socket.emit('spin_wheel');
        }
      }, 2400);
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
  const foreignReserve = state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0;
  roFlexiblePoints.textContent = state.settings.restrictOwnPoints
    ? `${state.settings.maxPoints - foreignReserve} очк.` : `Все ${state.settings.maxPoints} очк.`;
  roForeignPoints.textContent = state.settings.restrictOwnPoints ? `${foreignReserve} очк.` : 'Нет ограничений';
  roKeepZero.textContent = state.settings.keepZeroItems
    ? `На колесе (вес ${state.settings.zeroItemWeight})`
    : 'Удаляются';

  // Если мы Хост — показываем форму настроек
  if (state.me.isHost) {
    hostSettingsForm.classList.remove('hidden');
    if (document.activeElement !== setMaxPoints &&
        document.activeElement !== setMaxItems &&
        document.activeElement !== setForeignOnly &&
        document.activeElement !== setZeroWeight) {
      setMaxPoints.value = state.settings.maxPoints;
      setMaxItems.value = state.settings.maxItems;
      setRestrictOwn.checked = Boolean(state.settings.restrictOwnPoints);
      setForeignOnly.value = state.settings.foreignOnlyPoints || 0;
      ownLimitGroup.classList.toggle('hidden', !setRestrictOwn.checked);
      updatePointsSplitPreview();
      setKeepZero.checked = state.settings.keepZeroItems;
      setZeroWeight.value = state.settings.zeroItemWeight;
      zeroWeightGroup.classList.toggle('hidden', !state.settings.keepZeroItems);
    }
  } else {
    hostSettingsForm.classList.add('hidden');
  }
}

function updatePointsSplitPreview() {
  const total = Math.max(1, Number(setMaxPoints.value) || 100);
  setForeignOnly.max = total;
  const reserve = setRestrictOwn.checked
    ? Math.max(0, Math.min(total, Number(setForeignOnly.value) || 0)) : 0;
  pointsSplitPreview.textContent = `${total - reserve} очк. — на свои и чужие; ${reserve} очк. — только на чужие.`;
}
setRestrictOwn.addEventListener('change', () => {
  ownLimitGroup.classList.toggle('hidden', !setRestrictOwn.checked);
  updatePointsSplitPreview();
});
setForeignOnly.addEventListener('input', updatePointsSplitPreview);
setMaxPoints.addEventListener('input', updatePointsSplitPreview);
setKeepZero.addEventListener('change', () => {
  zeroWeightGroup.classList.toggle('hidden', !setKeepZero.checked);
});

hostSettingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('update_settings', {
    maxPoints: Number(setMaxPoints.value),
    maxItems: Number(setMaxItems.value),
    restrictOwnPoints: setRestrictOwn.checked,
    foreignOnlyPoints: Number(setForeignOnly.value),
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

btnResetHard.addEventListener('click', () => {
  if (confirm('Полностью очистить комнату, участников, ставки, лоты, историю и настройки? Все участники попадут на экран входа. Сервер и туннель останутся работать.')) {
    socket.emit('hard_reset_auction');
  }
});

// 9. ОТРИСОВКА ОСНОВНОЙ ОБЛАСТИ (ПУЛ ИЛИ КОЛЕСО)
function renderMainArea(state) {
  if (state.phase === 'POOL') {
    viewPool.classList.remove('hidden');
    viewReveal.classList.add('hidden');
    wheelDurationPanel.classList.add('hidden');
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
  const reserve = state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0;
  poolFlexiblePoints.textContent = state.settings.maxPoints - reserve;
  poolFlexibleNote.textContent = reserve
    ? 'Максимум, доступный для собственных лотов'
    : 'Все очки доступны для любых ставок';
  poolForeignPoints.textContent = reserve ? reserve : '—';
  poolForeignUnit.textContent = reserve ? ' очк.' : '';
  poolForeignNote.textContent = reserve
    ? 'Резерв: можно тратить только на чужие лоты'
    : 'Ограничения отключены';

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

    const ownLimit = state.settings.maxPoints - reserve;
    const allowedByOwnership = item.canDelete
      ? Math.max(0, ownLimit - (state.me.mySpentOwnPoints - item.myPoints))
      : state.settings.maxPoints;
    const maxPossibleForThisItem = Math.max(0, Math.min(item.myPoints + state.me.remainingPoints, allowedByOwnership));
    // Шкала у КАЖДОГО ползунка всегда от 0 до N, как в предыдущей версии.
    // Иначе изменение остатка очков меняет диапазоны других ползунков,
    // визуально сдвигая их значения без изменения самих ставок.

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
  const items = appState.items;
  const count = items.length;
  const total = appState.settings.maxPoints;
  const limit = total - (appState.settings.restrictOwnPoints ? appState.settings.foreignOnlyPoints : 0);
  const allocation = items.map((_, i) => Math.floor(total / count) + (i < total % count ? 1 : 0));
  let ownTotal = allocation.reduce((sum, p, i) => sum + (items[i].canDelete ? p : 0), 0);
  let extra = Math.max(0, ownTotal - limit);
  for (let i = 0; i < count && extra > 0; i++) {
    if (!items[i].canDelete) continue;
    const amount = Math.min(extra, allocation[i]);
    allocation[i] -= amount;
    extra -= amount;
  }
  const others = items.map((it, i) => !it.canDelete ? i : -1).filter(i => i >= 0);
  if (others.length) {
    const leftover = total - allocation.reduce((sum, p) => sum + p, 0);
    for (let i = 0; i < leftover; i++) allocation[others[i % others.length]]++;
  }
  // Сначала снимаем старые ставки, затем расставляем новые: сервер проверяет
  // каждый запрос независимо, не позволяя промежуточному состоянию превысить N.
  items.forEach(it => { if (it.myPoints) socket.emit('set_points', { itemId: it.id, points: 0 }); });
  items.forEach((it, i) => { if (allocation[i]) socket.emit('set_points', { itemId: it.id, points: allocation[i] }); });
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
  wheelDurationPanel.classList.remove('hidden');
  const canEditDuration = state.me.isHost && state.phase === 'REVEAL';
  hostDurationControl.classList.toggle('hidden', !canEditDuration);
  durationReadonly.classList.toggle('hidden', canEditDuration);
  durationReadonly.textContent = `${state.settings.spinDuration} сек.`;
  const lockedDuration = state.wheel.isSpinning || isAnimatingWheel || Boolean(activeElimination);
  [setSpinDuration, durationApply, durationMinus, durationPlus].forEach(el => el.disabled = lockedDuration);
  if (document.activeElement !== setSpinDuration) setSpinDuration.value = state.settings.spinDuration;
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
    btnSpinWheel.disabled = state.wheel.isSpinning || isAnimatingWheel || Boolean(activeElimination) || aliveItems.length < 1;
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

    // Оттенки показывают силу поддержки и текущий риск, не заменяя точные числа.
    const weightRate = Math.min(1, it.effectivePoints / Math.max(1, ...sortedItems.map(x => x.effectivePoints)));
    const winRate = Math.max(0, Math.min(1, it.winProbability / 100));
    const riskRate = Math.max(0, Math.min(1, it.roundElimShare / 100));
    tr.style.setProperty('--weight-alpha', (0.025 + weightRate * 0.15).toFixed(3));
    tdWinProb.classList.add('chance-cell');
    tdWinProb.style.setProperty('--prob-alpha', (0.06 + winRate * 0.32).toFixed(3));
    tdElimShare.classList.add('risk-cell');
    tdElimShare.style.setProperty('--risk-alpha', (0.04 + riskRate * 0.26).toFixed(3));
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
      const peak = Math.max(1, ...state.wheel.history.map(item => item.totalPoints));
      li.style.setProperty('--history-alpha', (0.055 + h.totalPoints / peak * 0.2).toFixed(3));
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

function applySpinDuration() {
  const raw = Number(setSpinDuration.value);
  if (!Number.isFinite(raw)) return;
  socket.emit('update_spin_duration', { duration: Math.max(2, Math.min(500, raw)) });
}
durationApply.addEventListener('click', applySpinDuration);
setSpinDuration.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); applySpinDuration(); setSpinDuration.blur(); }
});
for (const [button, step] of [[durationMinus, -5], [durationPlus, 5]]) {
  button.addEventListener('click', () => {
    setSpinDuration.value = Math.max(2, Math.min(500, (Number(setSpinDuration.value) || 5.5) + step));
    applySpinDuration();
  });
}
btnSpinWheel.addEventListener('click', () => {
  initAudio();
  if (!activeElimination) socket.emit('spin_wheel');
});

btnAutoSpin.addEventListener('click', () => {
  initAudio();
  autoSpinActive = !autoSpinActive;
  btnAutoSpin.textContent = autoSpinActive ? 'Остановить авто-крутку' : 'Авто-крутка до победителя';
  if (autoSpinActive && appState && !appState.wheel.isSpinning && !isAnimatingWheel && !activeElimination) {
    socket.emit('spin_wheel');
  }
});

// 11. ОТРИСОВКА И СИНХРОННАЯ АНИМАЦИЯ КОЛЕСА НА CANVAS
function getCurrentWheelSlices() {
  if (activeElimination) return activeElimination.slices;
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

// Масштабируем bitmap под реальный размер на странице и DPR: в увеличенном режиме
// текст остаётся чётким. Логические координаты — CSS-пиксели, углы не меняются.
function resizeWheelCanvas() {
  const side = Math.round(wheelStage.getBoundingClientRect().width);
  if (side <= 0) return;
  // При смене размера во время эффекта старые координаты Canvas становятся
  // некорректными: безопасно завершаем только визуализацию, не игровой раунд.
  if (activeElimination && wheelFx.active && Math.abs(wheelFx.active.width - side) > 1) {
    wheelFx.cancel();
    activeElimination = null;
    wheelStage.classList.remove('is-eliminating');
  }
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(side * ratio);
  if (wheelCanvas.width !== pixels || wheelCanvas.height !== pixels || wheelPixelRatio !== ratio) {
    wheelCanvas.width = pixels;
    wheelCanvas.height = pixels;
    wheelPixelRatio = ratio;
  }
  if (wheelParticles.width !== pixels || wheelParticles.height !== pixels) {
    wheelParticles.width = pixels;
    wheelParticles.height = pixels;
  }
  wheelCtx.setTransform(wheelPixelRatio, 0, 0, wheelPixelRatio, 0, 0);
  particleCtx.setTransform(wheelPixelRatio, 0, 0, wheelPixelRatio, 0, 0);
}

function getWheelGeometry() {
  const width = wheelCanvas.width / wheelPixelRatio;
  const height = wheelCanvas.height / wheelPixelRatio;
  const scale = Math.min(width, height) / 540;
  return { width, height, cx: width / 2, cy: height / 2,
    radius: Math.min(width, height) / 2 - 18 * scale, scale };
}

// Измеряем текст на Canvas, переносим длинные названия и подрезаем лишь при
// физической нехватке площади. Полная строка всегда доступна в легенде/подсказке.
function fitWheelLines(text, maxWidth, maxLines, fontSize) {
  wheelCtx.font = `800 ${fontSize}px ${wheelLabelFont}`;
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (wheelCtx.measureText(attempt).width <= maxWidth) {
      line = attempt;
      continue;
    }
    if (line) { lines.push(line); line = ''; }
    // У вариантов могут быть очень длинные слова без пробелов.
    for (const char of Array.from(word)) {
      if (wheelCtx.measureText(line + char).width > maxWidth && line) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  const complete = lines.length <= maxLines;
  if (!complete) {
    lines.length = maxLines;
    let end = Array.from(lines[maxLines - 1] || '');
    while (end.length && wheelCtx.measureText(end.join('') + '…').width > maxWidth) end.pop();
    lines[maxLines - 1] = end.join('') + '…';
  }
  return { lines, complete };
}

function drawWheelLabel(slice, index, angle, midAngle, geometry) {
  const { radius, scale } = geometry;
  const radialWidth = radius - 78 * scale;
  const crossWidth = 2 * radius * 0.56 * Math.sin(Math.min(angle / 2, Math.PI / 2)) - 9 * scale;
  if (crossWidth < 10 * scale || radialWidth < 25) return; // Полное имя есть в легенде.

  // На крупных секторах предпочитаем хорошо различимые буквы вместо попытки
  // уместить все 80 символов ценой слишком мелкого шрифта.
  const minSize = crossWidth >= 38 * scale ? 15 : (crossWidth >= 22 * scale ? 13 : 11);
  const minFont = minSize * scale;
  let chosen = null;
  const label = `${slice.title} (${slice.totalPoints})`;
  for (let size = 20; size >= minSize; size--) {
    const fontSize = size * scale;
    const lineHeight = fontSize * 1.18;
    const maxLines = Math.min(3, Math.floor(crossWidth / lineHeight));
    if (maxLines < 1) continue;
    const fit = fitWheelLines(label, radialWidth, maxLines, fontSize);
    chosen = { ...fit, fontSize, lineHeight };
    if (fit.complete) break;
  }
  if (!chosen || chosen.fontSize < minFont - 0.01) return;

  // Узкому сектору не навязываем нечитаемые обрезки длинных слов:
  // маленький номер однозначно сопоставляется с полным названием в легенде.
  if (!chosen.complete && crossWidth < 23 * scale) {
    chosen = { lines: [String(index + 1)], fontSize: 13 * scale, lineHeight: 15 * scale };
  }

  wheelCtx.save();
  wheelCtx.translate(geometry.cx, geometry.cy);
  wheelCtx.rotate(midAngle);
  const reverse = Math.cos(midAngle) < 0;
  if (reverse) wheelCtx.rotate(Math.PI);
  const x = (radius + 48 * scale) / 2 * (reverse ? -1 : 1);
  wheelCtx.textAlign = 'center';
  wheelCtx.textBaseline = 'middle';
  wheelCtx.font = `800 ${chosen.fontSize}px ${wheelLabelFont}`;
  wheelCtx.lineJoin = 'round';
  wheelCtx.strokeStyle = 'rgba(14, 18, 24, 0.88)';
  wheelCtx.lineWidth = Math.max(2.6 * scale, chosen.fontSize * 0.19);
  wheelCtx.fillStyle = '#ffffff';
  chosen.lines.forEach((line, i) => {
    const y = (i - (chosen.lines.length - 1) / 2) * chosen.lineHeight;
    wheelCtx.strokeText(line, x, y);
    wheelCtx.fillText(line, x, y);
  });
  wheelCtx.restore();
}

function renderWheelLegend(slices = getCurrentWheelSlices()) {
  wheelLegend.replaceChildren();
  const palette = THEME_WHEEL_PALETTES[currentTheme] || THEME_WHEEL_PALETTES.anime;
  const fragment = document.createDocumentFragment();
  slices.forEach((slice, idx) => {
    const item = document.createElement('div');
    item.className = 'wheel-legend-item';
    item.setAttribute('role', 'listitem');
    const swatch = document.createElement('span');
    swatch.className = 'wheel-legend-swatch';
    swatch.style.backgroundColor = palette[idx % palette.length];
    const content = document.createElement('div');
    content.className = 'wheel-legend-text';
    const name = document.createElement('div');
    name.className = 'wheel-legend-name';
    name.textContent = `${idx + 1}. ${slice.title}`;
    const stats = document.createElement('div');
    stats.className = 'wheel-legend-stats';
    stats.textContent = `${slice.totalPoints} очк. · ${(slice.share * 100).toFixed(1)}% сектора вылета`;
    content.append(name, stats);
    item.append(swatch, content);
    fragment.appendChild(item);
  });
  wheelLegend.appendChild(fragment);
}

function drawWheel() {
  resizeWheelCanvas();
  const geometry = getWheelGeometry();
  const { width, height, cx, cy, radius, scale } = geometry;
  wheelCtx.clearRect(0, 0, width, height);

  const slices = getCurrentWheelSlices();
  if (slices.length === 0) return;
  const palette = THEME_WHEEL_PALETTES[currentTheme] || THEME_WHEEL_PALETTES.anime;
  let currentAngle = wheelRotation;

  slices.forEach((slice, index) => {
    const sliceAngle = slice.share * Math.PI * 2;
    const endAngle = currentAngle + sliceAngle;
    if (activeElimination && activeElimination.index === index) {
      currentAngle = endAngle;
      return;
    }
    wheelCtx.beginPath();
    wheelCtx.moveTo(cx, cy);
    wheelCtx.arc(cx, cy, radius, currentAngle, endAngle);
    wheelCtx.closePath();
    wheelCtx.fillStyle = palette[index % palette.length];
    wheelCtx.fill();
    wheelCtx.lineWidth = 2 * scale;
    wheelCtx.strokeStyle = 'rgba(14, 18, 24, 0.88)';
    wheelCtx.stroke();

    drawWheelLabel(slice, index, sliceAngle, currentAngle + sliceAngle / 2, geometry);
    currentAngle = endAngle;
  });

  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  wheelCtx.lineWidth = 5 * scale;
  wheelCtx.strokeStyle = '#15191e';
  wheelCtx.stroke();

  wheelCtx.beginPath();
  wheelCtx.arc(cx, cy, 28 * scale, 0, Math.PI * 2);
  wheelCtx.fillStyle = '#222831';
  wheelCtx.fill();
  wheelCtx.lineWidth = 3 * scale;
  wheelCtx.strokeStyle = '#ffffff';
  wheelCtx.stroke();
}

// По умолчанию большое колесо встроено в обычную страницу, с боковой панелью,
// историями и всеми настройками. Переключатель меняет только сетку и масштаб.
function setWheelFocus(shouldFocus) {
  document.body.classList.toggle('wheel-layout-expanded', shouldFocus);
  wheelCard.classList.toggle('is-focused', shouldFocus);
  btnWheelFocus.setAttribute('aria-pressed', String(shouldFocus));
  btnWheelFocus.setAttribute('aria-label', shouldFocus ? 'Уменьшить колесо' : 'Увеличить колесо');
  btnWheelFocus.title = shouldFocus ? 'Вернуться к компактной сетке' : 'Сделать колесо больше';
  btnWheelFocus.textContent = shouldFocus ? '↙ Свернуть' : '⛶ Развернуть';
  localStorage.setItem('auction_wheel_expanded', shouldFocus ? 'yes' : 'no');
  wheelTooltip.classList.add('hidden');
  requestAnimationFrame(() => { resizeWheelCanvas(); if (!isAnimatingWheel && !activeElimination) drawWheel(); });
}
btnWheelFocus.addEventListener('click', () => setWheelFocus(!wheelCard.classList.contains('is-focused')));
setWheelFocus(localStorage.getItem('auction_wheel_expanded') !== 'no');

// Показываем полные названия при наведении на сектор, без изменения игрового состояния.
wheelCanvas.addEventListener('pointermove', (event) => {
  if (isAnimatingWheel || activeElimination) { wheelTooltip.classList.add('hidden'); return; }
  const rect = wheelCanvas.getBoundingClientRect();
  const geometry = getWheelGeometry();
  const x = (event.clientX - rect.left) * geometry.width / rect.width - geometry.cx;
  const y = (event.clientY - rect.top) * geometry.height / rect.height - geometry.cy;
  const r = Math.hypot(x, y);
  if (r > geometry.radius || r < 28 * geometry.scale) {
    wheelTooltip.classList.add('hidden');
    return;
  }
  const fraction = (((Math.atan2(y, x) - wheelRotation) / (2 * Math.PI)) % 1 + 1) % 1;
  const slices = getCurrentWheelSlices();
  let cumulative = 0;
  const found = slices.find((slice) => { cumulative += slice.share; return fraction < cumulative; });
  if (!found) { wheelTooltip.classList.add('hidden'); return; }
  wheelTooltip.textContent = `${found.title} — ${found.totalPoints} очк.`;
  wheelTooltip.classList.remove('hidden');
  const posX = event.clientX - rect.left;
  const half = wheelTooltip.offsetWidth / 2;
  const viewportLeft = 10 - rect.left + half;
  const viewportRight = window.innerWidth - 10 - rect.left - half;
  const safeLeft = Math.max(viewportLeft, Math.min(viewportRight, posX));
  wheelTooltip.style.left = `${safeLeft}px`;
  wheelTooltip.style.top = `${Math.max(42, event.clientY - rect.top)}px`;
});
wheelCanvas.addEventListener('pointerleave', () => wheelTooltip.classList.add('hidden'));
window.addEventListener('resize', () => wheelTooltip.classList.add('hidden'));

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { resizeWheelCanvas(); if (!isAnimatingWheel && !activeElimination) drawWheel(); }).observe(wheelStage);
} else {
  window.addEventListener('resize', drawWheel);
}
if (document.fonts) document.fonts.ready.then(drawWheel);

// Canvas-партиклы фронтенда: следы, искры и орбиты поверх колеса.
// Положение вычисляется по времени, серверная математика не затрагивается.
function drawSpinParticles(now, progress) {
  const { width, height, cx, cy, radius, scale } = getWheelGeometry();
  particleCtx.clearRect(0, 0, width, height);
  if (motionReduced.matches) return;
  const base = now / 1000;
  const opacity = Math.min(0.9, 0.2 + Math.sin(Math.PI * progress) * 0.55);
  const colors = getComputedStyle(document.documentElement);
  const main = colors.getPropertyValue('--accent-primary').trim() || '#d987a2';
  const alt = colors.getPropertyValue('--accent-secondary').trim() || '#83bbaa';
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + base * (i % 3 === 0 ? -1.2 : 0.9);
    const r = radius * (0.8 + Math.sin(i * 6.31 + base * 2) * 0.2);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const size = (i % 6 === 0 ? 3.7 : 1.9) * scale;
    particleCtx.globalAlpha = opacity * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(base * 3 + i)));
    particleCtx.fillStyle = i % 3 === 0 ? main : alt;
    particleCtx.shadowColor = particleCtx.fillStyle;
    particleCtx.shadowBlur = 7 * scale;
    particleCtx.beginPath();
    particleCtx.arc(x, y, size, 0, Math.PI * 2);
    particleCtx.fill();
  }
  particleCtx.shadowBlur = 0;
  particleCtx.globalAlpha = 1;
}

// Событие синхронного запуска колеса от сервера
socket.on('wheel_spin', ({ slices, eliminatedId, eliminatedTitle, targetFraction, extraSpins, durationSec }) => {
  initAudio();
  isAnimatingWheel = true;
  activeSpinSlices = slices;
  wheelTooltip.classList.add('hidden');
  wheelStage.classList.remove('spin-finished');
  wheelStage.classList.add('is-spinning');
  renderWheelLegend(slices);
  wheelStatusBox.textContent = SPIN_COMMENTS[Math.floor(Math.random() * SPIN_COMMENTS.length)];
  if (activeElimination) { wheelFx.cancel(); activeElimination = null; wheelStage.classList.remove('is-eliminating'); }
  if (activeSpinFrame !== null) cancelAnimationFrame(activeSpinFrame);
  clearTimeout(autoSpinTimer);
  autoSpinTimer = null;

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

  // При длительности 500 с крутим с постоянной скоростью, замедление —
  // только в последние максимум 8 секунд (иначе easeOutQuart почти остановит
  // колесо уже на середине длительного аукциона).
  function easeSpin(t) {
    const slowdown = Math.min(0.35, 8000 / durationMs);
    const linearTime = 1 - slowdown;
    const linearDistance = 3 * linearTime / (3 * linearTime + slowdown);
    if (t < linearTime) return (t / linearTime) * linearDistance;
    const stopT = (t - linearTime) / slowdown;
    return linearDistance + (1 - linearDistance) * (1 - Math.pow(1 - stopT, 3));
  }
  let lastCanvasFrame = -Infinity;

  function animateFrame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    // Для долгих сессий ограничиваем частоту тяжёлой Canvas-перерисовки.
    if (durationMs > 30000 && now - lastCanvasFrame < 32 && progress < 1) {
      activeSpinFrame = requestAnimationFrame(animateFrame);
      return;
    }
    lastCanvasFrame = now;
    const eased = easeSpin(progress);

    wheelRotation = startRotation + totalDelta * eased;
    drawWheel();
    drawSpinParticles(now, progress);

    const currentSliceIdx = getSliceIndexAtPointer(wheelRotation);
    if (currentSliceIdx !== lastSliceIdx) {
      playTickSound();
      if (!motionReduced.matches && wheelPointer.animate) {
        wheelPointer.animate([
          { transform: 'translateY(-50%) rotate(-9deg)' },
          { transform: 'translateY(-50%) rotate(3deg)', offset: 0.45 },
          { transform: 'translateY(-50%) rotate(0deg)' }
        ], { duration: 160, easing: 'ease-out' });
      }
      lastSliceIdx = currentSliceIdx;
    }

    if (progress < 1) {
      activeSpinFrame = requestAnimationFrame(animateFrame);
    } else {
      activeSpinFrame = null;
      particleCtx.clearRect(0, 0, wheelParticles.width, wheelParticles.height);
      isAnimatingWheel = false;
      activeSpinSlices = null;
      wheelStage.classList.remove('is-spinning');
      wheelStage.classList.add('spin-finished');
      renderWheelLegend(slices);
      const seed = (Math.floor(targetFraction * 0x7fffffff) ^ (eliminatedId?.length || 13) * 2654435761) >>> 0;
      if (showEliminationEffect(eliminatedTitle, eliminatedId, slices, seed) === 'fold') playEliminatedSound();
      wheelStatusBox.textContent = `❌ Выбывает вариант: «${eliminatedTitle}»!`;
    }
  }

  activeSpinFrame = requestAnimationFrame(animateFrame);
});