import { store, writeSetting, removeSetting } from './store.js';
import { dom } from './dom.js';
import { renderAllItemsModal, closeAllItemsModal, showToast, renderSidebar, renderMainArea } from './ui-render.js';
import { playWinnerFanfare } from './audio.js';
import { resetClientVisualState, renderWheelLegend, resizeWheelCanvas, drawWheel, handleWheelSpin } from './wheel-canvas.js';

export const socket = window.io();
store.socket = socket;

export function initSocketClient() {
socket.on('connect', () => {
  if (store.myToken && store.myName) {
    socket.emit('join', { token: store.myToken, name: store.myName });
  }
});

socket.on('joined', ({ token }) => {
  store.myToken = token;
  writeSetting('auction_token', token);
  dom.screenJoin.classList.add('hidden');
  dom.screenApp.classList.remove('hidden');
  dom.myProfileChip.classList.remove('hidden');
  dom.btnAllItems.classList.remove('hidden');
});

socket.on('toast_error', (msg) => {
  showToast(msg);
});

socket.on('kicked', ({ reason }) => {
  resetClientVisualState();
  closeAllItemsModal();
  store.appState = null;
  store.myToken = null;
  removeSetting('auction_token');
  dom.screenApp.classList.add('hidden');
  dom.screenJoin.classList.remove('hidden');
  dom.myProfileChip.classList.add('hidden');
  dom.btnAllItems.classList.add('hidden');
  dom.phaseBadge.textContent = 'УДАЛЕН ИЗ ЛОББИ';
  showToast(reason || 'Хост удалил вас из лобби.');
});

socket.on('auction_hard_reset', () => {
  resetClientVisualState();
  closeAllItemsModal();
  store.appState = null;
  store.myToken = null;
  removeSetting('auction_token');
  dom.screenApp.classList.add('hidden');
  dom.screenJoin.classList.remove('hidden');
  dom.myProfileChip.classList.add('hidden');
  dom.btnAllItems.classList.add('hidden');
  dom.phaseBadge.textContent = 'КОМНАТА ОЧИЩЕНА';
  showToast('Комната полностью очищена. Войдите заново, сервер продолжает работать.');
});

// 7. ПОЛУЧЕНИЕ ОБНОВЛЕНИЯ СОСТОЯНИЯ ОТ СЕРВЕРА
socket.on('state_update', (state) => {
  const prevPhase = store.appState ? store.appState.phase : null;
  store.appState = state;

  if (!state.me) return;

  // Обновляем шапку
  dom.myNameDisplay.textContent = state.me.name;
  dom.myHostBadge.classList.toggle('hidden', !state.me.isHost);
  dom.allItemsCountEl.textContent = String((state.allItems || []).length);

  if (!dom.modalAllItems.classList.contains('hidden')) {
    renderAllItemsModal(state);
  }

  const isWheelPhase = state.phase === 'REVEAL' || state.phase === 'FINISHED';
  document.body.classList.toggle('is-wheel-phase', isWheelPhase);

  if (state.phase === 'POOL') {
    dom.phaseBadge.textContent = 'ЭТАП 1: ТАЙНЫЙ ПУЛ';
    store.autoSpinActive = false;
  } else if (state.phase === 'REVEAL') {
    dom.phaseBadge.textContent = 'ЭТАП 2: КОЛЕСО НА ВЫБЫВАНИЕ';
  } else if (state.phase === 'FINISHED') {
    dom.phaseBadge.textContent = 'ФИНАЛ: ПОБЕДИТЕЛЬ ОПРЕДЕЛЕН';
    store.autoSpinActive = false;
    if (prevPhase !== 'FINISHED') playWinnerFanfare();
  }

  renderSidebar(state);
  renderMainArea(state);

  if (!store.activeElimination) renderWheelLegend();
  if (!store.isAnimatingWheel && !store.activeElimination) {
    resizeWheelCanvas();
    drawWheel();
  }

  // Если включена авто-крутка до победителя (у Хоста)
  if (
    store.autoSpinActive &&
    state.me.isHost &&
    state.phase === 'REVEAL' &&
    !state.wheel.isSpinning &&
    !store.isAnimatingWheel && !store.activeElimination
  ) {
    const aliveCount = state.items.filter((i) => !i.eliminated).length;
    if (aliveCount > 1) {
      clearTimeout(store.autoSpinTimer);
      store.autoSpinTimer = setTimeout(() => {
        store.autoSpinTimer = null;
        if (store.autoSpinActive && store.appState && store.appState.phase === 'REVEAL' && !store.appState.wheel.isSpinning && !store.isAnimatingWheel && !store.activeElimination) {
          socket.emit('spin_wheel');
        }
      }, 2400);
    } else {
      store.autoSpinActive = false;
    }
  }
});

  socket.on('wheel_spin', handleWheelSpin);
}
