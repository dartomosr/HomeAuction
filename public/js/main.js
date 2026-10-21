import { store, writeSetting } from './store.js';
import { dom } from './dom.js';
import { socket, initSocketClient } from './socket-client.js';
import { initAudio, playUiClickSound, playUiSliderSound, playUiReadySound } from './audio.js';
import { updatePointsSplitPreview, updateJoinPresetVisibility, renderEffectsControls, setAllEffects, applyTheme, updateSoundButton, openAllItemsModal, closeAllItemsModal, openHelpModal, closeHelpModal, renderHelpModal, switchHistoryTab, copyResultSummary, showToast, renderMainArea } from './ui-render.js';
import { drawWheel, renderWheelLegend, resizeWheelCanvas } from './wheel-canvas.js';
import { getInitialItems } from './saves.js';
import { createRandomModeFlow, createSpinPlan, createPresetDraft, filterEnabledPresets, loadPresetIds, RANDOM_PRESET_STORAGE_KEY } from './random-mode.js';

if (window.matchMedia('(max-width: 768px)').matches) {
  dom.btnToggleSettings.setAttribute('aria-expanded', 'false');
  dom.btnToggleSettings.setAttribute('aria-label', 'Раскрыть настройки');
  dom.btnToggleSettings.title = 'Раскрыть настройки';
  dom.btnToggleSettings.querySelector('span').textContent = 'Раскрыть';
  dom.settingsContent.classList.add('is-collapsed');
}

if (store.myName) dom.inputName.value = store.myName;
dom.inputSpectator.checked = store.isSpectator;
updateJoinPresetVisibility();
initSocketClient();

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const control = target && target.closest('button, summary.btn, .settings-collapse-toggle');
  if (!control || control.id === 'btn-sound' || control.id === 'btn-ready' ||
      control.id === 'btn-add-item' || control.id === 'btn-add-free-item' ||
      control.id === 'btn-distribute-even' ||
      control.matches('.pool-item-controls button, .reaction-btn, #btn-copy-result')) return;
  if (store.soundEnabled) initAudio();
  playUiClickSound();
});

dom.formJoin.addEventListener('submit', (e) => {
  e.preventDefault();
  initAudio();
  const clean = dom.inputName.value.trim();
  if (!clean) return;
  store.myName = clean;
  store.isSpectator = dom.inputSpectator.checked;
  writeSetting('auction_name', store.myName);
  writeSetting('auction_spectator', store.isSpectator ? 'on' : 'off');
  const joinData = {
    token: store.myToken,
    name: store.myName,
    isSpectator: store.isSpectator,
    preset: store.selectedPreset
  };
  const initialItems = getInitialItems();
  if (initialItems) joinData.initialItems = initialItems;
  socket.emit('join', joinData);
});

dom.joinPresetGroup.addEventListener('click', (event) => {
  const button = event.target instanceof Element ? event.target.closest('.preset-option-btn') : null;
  if (!button) return;

  store.selectedPreset = button.dataset.preset;
  dom.joinPresetGroup.querySelectorAll('.preset-option-btn').forEach(option => {
    const isActive = option === button;
    option.classList.toggle('active', isActive);
    option.setAttribute('aria-pressed', String(isActive));
  });
});

function getStartModes() {
  return Array.from(dom.joinPresetGroup.querySelectorAll('.preset-option-btn[data-preset]'))
    .map(button => ({
      id: button.dataset.preset,
      name: button.querySelector('strong')?.textContent.trim() || button.dataset.preset,
      button
    }))
    .filter(mode => mode.id);
}

function getLocalStorageSafely() {
  try { return window.localStorage; } catch { return null; }
}

const randomPresetStorage = getLocalStorageSafely();
let enabledRandomPresetIds = loadPresetIds(randomPresetStorage, getStartModes());
let settingsReturnFocus = null;
let settingsDraft = null;
let activeReelAnimation = null;

function canConfigureStartMode() {
  const state = store.appState;
  return !store.isSpectator && !state?.hasPlayers && !state?.hasHost && !dom.joinPresetGroup.classList.contains('hidden');
}

function closeRandomSettings() {
  if (dom.randomPresetDialog.open) dom.randomPresetDialog.close();
}

function renderRandomSettings() {
  dom.randomPresetSettingsList.replaceChildren();
  const checked = settingsDraft || createPresetDraft(enabledRandomPresetIds);
  for (const mode of getStartModes()) {
    const label = document.createElement('label');
    label.className = 'random-preset-setting-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = mode.id;
    checkbox.checked = checked.has(mode.id);
    checkbox.setAttribute('aria-label', `Участвует режим «${mode.name}»`);
    const name = document.createElement('span');
    name.textContent = mode.name;
    label.append(checkbox, name);
    dom.randomPresetSettingsList.append(label);
  }
}

dom.randomPresetSettings.addEventListener('click', () => {
  settingsReturnFocus = dom.randomPresetSettings;
  settingsDraft = createPresetDraft(enabledRandomPresetIds);
  dom.randomPresetSettingsError.hidden = true;
  renderRandomSettings();
  dom.randomPresetDialog.showModal();
  dom.randomPresetSettingsList.querySelector('input')?.focus();
});

dom.randomPresetSettingsList.addEventListener('change', (event) => {
  if (!(event.target instanceof HTMLInputElement) || event.target.type !== 'checkbox') return;
  settingsDraft?.set(event.target.value, event.target.checked);
  dom.randomPresetSettingsError.hidden = true;
});

dom.randomPresetSettingsSave.addEventListener('click', () => {
  const available = new Set(getStartModes().map(mode => mode.id));
  const selected = (settingsDraft?.values() || []).filter(id => available.has(id));
  if (!selected.length) {
    dom.randomPresetSettingsError.textContent = 'Выберите хотя бы один режим.';
    dom.randomPresetSettingsError.hidden = false;
    dom.randomPresetSettingsList.querySelector('input')?.focus();
    return;
  }
  if (!settingsDraft?.commit(randomPresetStorage, getStartModes(), RANDOM_PRESET_STORAGE_KEY)) {
    dom.randomPresetSettingsError.textContent = 'Не удалось сохранить настройки в этом браузере.';
    dom.randomPresetSettingsError.hidden = false;
    return;
  }
  enabledRandomPresetIds = selected;
  settingsDraft?.cancel();
  settingsDraft = null;
  closeRandomSettings();
});

dom.randomPresetSettingsCancel.addEventListener('click', closeRandomSettings);
dom.randomPresetDialog.addEventListener('cancel', () => { settingsDraft?.cancel(); settingsDraft = null; });
dom.randomPresetDialog.addEventListener('close', () => {
  settingsDraft?.cancel();
  settingsDraft = null;
  settingsReturnFocus?.focus();
  settingsReturnFocus = null;
});
dom.randomPresetDialog.addEventListener('click', (event) => {
  if (event.target === dom.randomPresetDialog) closeRandomSettings();
});

function cancelReelAnimation() {
  const animation = activeReelAnimation;
  activeReelAnimation = null;
  animation?.cancel();
}

function animateRandomPreset(winner, presets) {
  const ids = presets.map(mode => mode.id);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const plan = createSpinPlan(ids, winner.id, reducedMotion);
  if (!plan) return Promise.reject(new Error('Не удалось подготовить прокрутку режимов.'));

  dom.randomPresetTrack.replaceChildren();
  for (const id of plan.sequence) {
    const card = document.createElement('div');
    card.className = 'random-preset-reel-card';
    card.textContent = presets.find(mode => mode.id === id)?.name || id;
    dom.randomPresetTrack.append(card);
  }

  const firstCard = dom.randomPresetTrack.firstElementChild;
  const slotHeight = firstCard.getBoundingClientRect().height + Number.parseFloat(getComputedStyle(dom.randomPresetTrack).rowGap || '0');
  const centerOffset = dom.randomPresetTrack.parentElement.clientHeight / 2 - firstCard.getBoundingClientRect().height / 2;
  const from = centerOffset - plan.startIndex * slotHeight;
  const to = centerOffset - plan.endIndex * slotHeight;
  const fromTransform = `translateY(${from}px)`;
  const toTransform = `translateY(${to}px)`;
  dom.randomPresetTrack.style.transform = fromTransform;

  const animationTarget = reducedMotion && plan.sequence.length > 1
    ? dom.randomPresetTrack.children[plan.endIndex]
    : plan.sequence.length === 1 ? firstCard : dom.randomPresetTrack;
  const frames = animationTarget === firstCard
    ? [{ opacity: 0.55, transform: 'scale(.97)' }, { opacity: 1, transform: 'scale(1)' }]
    : [{ transform: fromTransform }, { transform: toTransform }];
  const animation = animationTarget.animate(frames, {
    duration: plan.duration,
    easing: plan.sequence.length === 1 || reducedMotion ? 'ease-out' : 'cubic-bezier(.08,.72,.1,1)',
    fill: 'forwards'
  });
  activeReelAnimation = animation;
  return animation.finished.then(() => {
    if (activeReelAnimation === animation) {
      dom.randomPresetTrack.style.transform = toTransform;
      activeReelAnimation = null;
      animation.cancel();
    }
  });
}

function setRandomPresetScreen(phase, winner) {
  const spinning = phase === 'spinning';
  const completed = phase === 'result';
  dom.randomPresetBegin.disabled = !completed;
  dom.randomPresetReroll.disabled = !completed;
  dom.randomPresetExit.disabled = false;
  dom.randomPresetResult.textContent = completed && winner ? `Выпал режим: ${winner.name}` : spinning ? 'Выбираем режим…' : '';
  if (phase === 'closed') {
    dom.randomPresetScreen.classList.add('hidden');
    dom.screenJoin.classList.remove('hidden');
    dom.randomPresetTrack.replaceChildren();
    dom.randomPresetTrack.style.transform = '';
  }
}

const randomModeFlow = createRandomModeFlow({
  getPresets: () => filterEnabledPresets(getStartModes(), enabledRandomPresetIds),
  animate: animateRandomPreset,
  cancelAnimation: cancelReelAnimation,
  canApply: canConfigureStartMode,
  onState: ({ phase, winner }) => setRandomPresetScreen(phase, winner),
  onExit: () => (canConfigureStartMode() ? dom.randomPresetOpen : dom.inputName).focus(),
  onUnavailable: () => {
    updateJoinPresetVisibility(store.appState);
    showToast('Создание комнаты сейчас недоступно. Выбор режима отменён.');
  },
  onApply: mode => {
    mode.button.click();
    dom.formJoin.requestSubmit();
  }
});

dom.randomPresetOpen.addEventListener('click', () => {
  if (!canConfigureStartMode()) return;
  dom.screenJoin.classList.add('hidden');
  dom.randomPresetScreen.classList.remove('hidden');
  dom.randomPresetExit.focus();
  void randomModeFlow.open();
});
dom.randomPresetBegin.addEventListener('click', () => { randomModeFlow.begin(); });
dom.randomPresetReroll.addEventListener('click', () => { void randomModeFlow.reroll(); });
dom.randomPresetExit.addEventListener('click', () => { randomModeFlow.exit(); });
document.addEventListener('keydown', event => {
  if (event.key !== 'Escape' || dom.randomPresetDialog.open || dom.randomPresetScreen.classList.contains('hidden')) return;
  event.preventDefault();
  randomModeFlow.exit();
});
document.addEventListener('auction:state-update', () => {
  if (!dom.randomPresetScreen.classList.contains('hidden') && !canConfigureStartMode()) randomModeFlow.exit();
});

dom.inputSpectator.addEventListener('change', () => updateJoinPresetVisibility());

dom.poolItemFilters.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target.closest('[data-pool-filter]') : null;
  if (!target) return;

  store.poolFilter = target.dataset.poolFilter;
  writeSetting('auction_pool_filter', store.poolFilter);
  dom.poolItemFilters.querySelectorAll('[data-pool-filter]').forEach((button) => {
    const isActive = button === target;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  if (store.appState) renderMainArea(store.appState);
});

dom.effectsMasterToggle.addEventListener('change', () => setAllEffects(dom.effectsMasterToggle.checked));
dom.effectsSelectAll.addEventListener('click', () => setAllEffects(true));
dom.effectsSelectNone.addEventListener('click', () => setAllEffects(false));
dom.btnToggleEffects.addEventListener('click', () => {
  store.effectsEnabled = !store.effectsEnabled;
  writeSetting('auction_effects_enabled', store.effectsEnabled ? 'on' : 'off');
  renderEffectsControls();
});

document.addEventListener('click', (event) => {
  if (!dom.effectsSettings.contains(event.target)) dom.effectsSettings.open = false;
});
renderEffectsControls();

document.addEventListener('auction:theme-change', () => { drawWheel(); renderWheelLegend(); });
applyTheme(store.currentTheme);
dom.themeSelect.addEventListener('change', (e) => applyTheme(e.target.value));
dom.themeAnimationToggle.addEventListener('change', () => {
  store.themeAnimationEnabled = dom.themeAnimationToggle.checked;
  writeSetting('auction_theme_animation', store.themeAnimationEnabled ? 'on' : 'off');
  document.body.classList.toggle(
    'has-animated-background-pattern',
    store.themeAnimationEnabled && ['anime', 'casino', 'terminal', 'paper', 'coffee', 'pastel-soft', 'nordic'].includes(store.currentTheme)
  );
});

updateSoundButton();

dom.btnSound.addEventListener('click', () => {
  initAudio();
  store.soundEnabled = !store.soundEnabled;
  writeSetting('auction_sound', store.soundEnabled ? 'on' : 'off');
  updateSoundButton();
});

// Модальное окно истории вариантов и статистики

dom.btnAllItems.addEventListener('click', openAllItemsModal);
dom.btnCloseAllItems.addEventListener('click', closeAllItemsModal);
dom.btnHelp.addEventListener('click', openHelpModal);
dom.btnCloseHelp.addEventListener('click', closeHelpModal);
dom.modalHelp.addEventListener('click', (e) => {
  if (e.target === dom.modalHelp) closeHelpModal();
});
dom.tabBtnAll.addEventListener('click', () => switchHistoryTab('all'));
dom.tabBtnStats.addEventListener('click', () => switchHistoryTab('stats'));
dom.btnCopyResult.addEventListener('click', copyResultSummary);
dom.modalAllItems.addEventListener('click', (e) => {
  if (e.target === dom.modalAllItems) closeAllItemsModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    dom.effectsSettings.open = false;
    if (!dom.modalHelp.classList.contains('hidden')) closeHelpModal();
    if (!dom.modalAllItems.classList.contains('hidden')) {
      closeAllItemsModal();
    }
  }
});

dom.setRestrictOwn.addEventListener('change', () => {
  dom.ownLimitGroup.classList.toggle('hidden', !dom.setRestrictOwn.checked);
  updatePointsSplitPreview();
});
dom.setForeignOnly.addEventListener('input', updatePointsSplitPreview);
dom.setMaxPoints.addEventListener('input', updatePointsSplitPreview);
dom.setKeepZero.addEventListener('change', () => {
  dom.zeroWeightGroup.classList.toggle('hidden', !dom.setKeepZero.checked);
});

dom.btnToggleSettings.addEventListener('click', () => {
  const isExpanded = dom.btnToggleSettings.getAttribute('aria-expanded') === 'true';
  dom.btnToggleSettings.setAttribute('aria-expanded', String(!isExpanded));
  dom.btnToggleSettings.setAttribute('aria-label', isExpanded ? 'Раскрыть настройки' : 'Свернуть настройки');
  dom.btnToggleSettings.title = isExpanded ? 'Раскрыть настройки' : 'Свернуть настройки';
  dom.btnToggleSettings.querySelector('span').textContent = isExpanded ? 'Раскрыть' : 'Свернуть';
  dom.settingsContent.classList.toggle('is-collapsed', isExpanded);
});

dom.hostSettingsForm.addEventListener('submit', (e) => {
  e.preventDefault();
  socket.emit('update_settings', {
    maxPoints: Number(dom.setMaxPoints.value),
    minimumBid: Number(dom.setMinimumBid.value),
    maxItems: Number(dom.setMaxItems.value),
    allowFreeItemsForAll: dom.setAllowFreeAll.checked,
    allowReactions: dom.setAllowReactions.checked,
    restrictOwnPoints: dom.setRestrictOwn.checked,
    foreignOnlyPoints: Number(dom.setForeignOnly.value),
    keepZeroItems: dom.setKeepZero.checked,
    zeroItemWeight: Number(dom.setZeroWeight.value)
  });
});

dom.btnResetKeep.addEventListener('click', () => {
  store.autoSpinActive = false;
  socket.emit('reset_auction', { clearItems: false });
});

dom.btnResetClear.addEventListener('click', () => {
  if (confirm('Очистить все варианты и начать с чистого листа?')) {
    store.autoSpinActive = false;
    socket.emit('reset_auction', { clearItems: true });
  }
});

dom.btnResetHard.addEventListener('click', () => {
  if (confirm('Полностью очистить комнату, участников, ставки, лоты, историю и настройки? Все участники попадут на экран входа. Сервер и туннель останутся работать.')) {
    socket.emit('hard_reset_auction');
  }
});

dom.formAddItem.addEventListener('submit', (e) => {
  e.preventDefault();
  const title = dom.inputItemTitle.value.trim();
  if (!title) return;
  if (store.soundEnabled) initAudio();
  const limitReached = store.appState && store.appState.me.myItemsCount >= store.appState.settings.maxItems;
  const canUseFreeSlot = store.appState && (store.appState.me.isHost || store.appState.settings.allowFreeItemsForAll);
  // Если обычный лимит исчерпан, но доступно добавление + ДОП, Enter отправляет как + ДОП
  socket.emit('add_item', { title, isFreeSlot: Boolean(limitReached && canUseFreeSlot) });
  dom.inputItemTitle.value = '';
});

dom.btnAddFreeItem.addEventListener('click', () => {
  const title = dom.inputItemTitle.value.trim();
  if (!title) {
    dom.inputItemTitle.focus();
    return;
  }
  if (store.soundEnabled) initAudio();
  socket.emit('add_item', { title, isFreeSlot: true });
  dom.inputItemTitle.value = '';
});

// Раскидать очки поровну
dom.btnDistributeEven.addEventListener('click', () => {
  if (!store.appState || store.appState.items.length === 0) return;
  if (store.soundEnabled) initAudio();
  playUiSliderSound();
  const items = store.appState.items;
  const count = items.length;
  const total = store.appState.settings.maxPoints;
  const minimumBid = Number(store.appState.settings.minimumBid) || 0;
  const limit = total - (store.appState.settings.restrictOwnPoints ? store.appState.settings.foreignOnlyPoints : 0);
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
  allocation.forEach((points, i) => {
    if (points > 0 && points < minimumBid) allocation[i] = 0;
  });
  items.forEach(it => { if (it.myPoints) socket.emit('set_points', { itemId: it.id, points: 0 }); });
  items.forEach((it, i) => { if (allocation[i]) socket.emit('set_points', { itemId: it.id, points: allocation[i] }); });
});

// Обнулить мои ставки
dom.btnClearPoints.addEventListener('click', () => {
  if (!store.appState) return;
  store.appState.items.forEach((it) => {
    if (it.myPoints > 0) {
      socket.emit('set_points', { itemId: it.id, points: 0 });
    }
  });
});

// Готовность
dom.btnReady.addEventListener('click', () => {
  if (store.soundEnabled) initAudio();
  playUiReadySound(Boolean(store.appState && !store.appState.me.ready));
  socket.emit('toggle_ready');
});

dom.btnMerge.addEventListener('click', () => {
  const sourceId = dom.mergeSource.value;
  const targetId = dom.mergeTarget.value;
  if (!sourceId || !targetId || sourceId === targetId) {
    showToast('Выберите два разных варианта для объединения');
    return;
  }
  socket.emit('merge_items', { sourceId, targetId });
});

function applySpinDuration() {
  const raw = Number(dom.setSpinDuration.value);
  if (!Number.isFinite(raw)) return;
  socket.emit('update_spin_duration', { duration: Math.max(2, Math.min(500, raw)) });
}
dom.durationApply.addEventListener('click', applySpinDuration);
dom.setSpinDuration.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); applySpinDuration(); dom.setSpinDuration.blur(); }
});
for (const [button, step] of [[dom.durationMinus, -5], [dom.durationPlus, 5]]) {
  button.addEventListener('click', () => {
    dom.setSpinDuration.value = Math.max(2, Math.min(500, (Number(dom.setSpinDuration.value) || 5.5) + step));
    applySpinDuration();
  });
}
dom.btnSpinWheel.addEventListener('click', () => {
  initAudio();
  if (!store.activeElimination) socket.emit('spin_wheel');
});

dom.btnAutoSpin.addEventListener('click', () => {
  initAudio();
  store.autoSpinActive = !store.autoSpinActive;
  dom.btnAutoSpin.textContent = store.autoSpinActive ? 'Остановить авто-крутку' : 'Авто-крутка до победителя';
  if (store.autoSpinActive && store.appState && !store.appState.wheel.isSpinning && !store.isAnimatingWheel && !store.activeElimination) {
    socket.emit('spin_wheel');
  }
});

window.addEventListener('resize', () => { resizeWheelCanvas(); drawWheel(); });
if (document.fonts) document.fonts.ready.then(drawWheel);
