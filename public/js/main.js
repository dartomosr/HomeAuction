import { store, writeSetting } from './store.js';
import { dom } from './dom.js';
import { socket, initSocketClient } from './socket-client.js';
import { initAudio, playUiClickSound, playUiSliderSound, playUiReadySound } from './audio.js';
import { updatePointsSplitPreview, renderEffectsControls, setAllEffects, applyTheme, updateSoundButton, openAllItemsModal, closeAllItemsModal, switchHistoryTab, showToast } from './ui-render.js';
import { drawWheel, renderWheelLegend, resizeWheelCanvas } from './wheel-canvas.js';

if (store.myName) dom.inputName.value = store.myName;
dom.inputSpectator.checked = store.isSpectator;
initSocketClient();

document.addEventListener('click', (event) => {
  const target = event.target instanceof Element ? event.target : event.target.parentElement;
  const control = target && target.closest('button, summary.btn, .settings-collapse-toggle');
  if (!control || control.id === 'btn-sound' || control.id === 'btn-ready' ||
      control.id === 'btn-add-item' || control.id === 'btn-add-free-item' ||
      control.id === 'btn-distribute-even' || control.matches('.pool-item-controls button')) return;
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
  socket.emit('join', { token: store.myToken, name: store.myName, isSpectator: store.isSpectator });
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
dom.tabBtnAll.addEventListener('click', () => switchHistoryTab('all'));
dom.tabBtnStats.addEventListener('click', () => switchHistoryTab('stats'));
dom.modalAllItems.addEventListener('click', (e) => {
  if (e.target === dom.modalAllItems) closeAllItemsModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    dom.effectsSettings.open = false;
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
    maxItems: Number(dom.setMaxItems.value),
    allowFreeItemsForAll: dom.setAllowFreeAll.checked,
    restrictOwnPoints: dom.setRestrictOwn.checked,
    foreignOnlyPoints: Number(dom.setForeignOnly.value),
    keepZeroItems: dom.setKeepZero.checked,
    zeroItemWeight: Number(dom.setZeroWeight.value)
  });
  showToast('Настройки обновлены');
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
