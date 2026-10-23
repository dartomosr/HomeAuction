const statusElements = {
  server: document.getElementById('server-status'),
  tunnel: document.getElementById('tunnel-status'),
  chip: document.getElementById('server-chip')
};
const localAddress = document.getElementById('local-address');
const publicAddress = document.getElementById('public-address');
const healthBadge = document.getElementById('external-health');
const logElement = document.getElementById('log');
const tunnelDiagnostic = document.getElementById('tunnel-diagnostic');
const toastElement = document.getElementById('toast');
let toastTimer;
let latestState = null;
let qrSource = 'wifi';
let renderedQrAddress = '';
let qrCopyTimer;

function renderConnectionQr(state, animate = false) {
  const wifiAddress = state.wifiAddress || '';
  const cloudAddress = state.tunnel === 'Подключён' ? (state.publicAddress || '') : '';
  const cloudTab = document.getElementById('qr-source-cloud');
  cloudTab.disabled = !cloudAddress;
  if (!cloudAddress && qrSource === 'cloud') qrSource = 'wifi';

  const isCloud = qrSource === 'cloud';
  const address = isCloud ? cloudAddress : wifiAddress;
  for (const [id, selected] of [['qr-source-wifi', !isCloud], ['qr-source-cloud', isCloud]]) {
    const tab = document.getElementById(id);
    tab.classList.toggle('active', selected);
    tab.setAttribute('aria-selected', String(selected));
  }

  const image = document.getElementById('connection-qr');
  const placeholder = document.getElementById('qr-placeholder');
  image.classList.toggle('hidden', !address);
  placeholder.classList.toggle('hidden', Boolean(address));
  placeholder.textContent = isCloud
    ? 'Публичная ссылка появится после подключения туннеля'
    : 'Локальный адрес появится после запуска сервера';
  if (address && address !== renderedQrAddress) {
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(window.HomeAuctionQR.makeQrSvg(address))}`;
    renderedQrAddress = address;
    animate = true;
  }
  if (address && animate) {
    image.classList.remove('qr-refresh');
    void image.offsetWidth;
    image.classList.add('qr-refresh');
  }

  document.getElementById('qr-instructions').textContent = isCloud
    ? 'Для игры через интернет с любых устройств'
    : 'Отсканируйте камерой телефона в одной сети Wi-Fi';
  document.getElementById('qr-address').textContent = address || 'Ожидание адреса…';
  const qrHealth = document.getElementById('qr-health');
  qrHealth.className = 'qr-health';
  qrHealth.title = '';
  qrHealth.textContent = '';
  if (isCloud) {
    qrHealth.textContent = state.externalHealth === 'available'
      ? '✓ Доступен извне'
      : state.externalHealth === 'warning'
        ? '⚠️ Внешняя проверка не ответила'
        : 'Проверка внешней доступности…';
    qrHealth.classList.toggle('health-available', state.externalHealth === 'available');
    qrHealth.classList.toggle('health-warning', state.externalHealth === 'warning');
    if (state.externalHealth === 'warning') {
      qrHealth.title = 'Запрос изнутри сети не подтвердил доступность (это нормально для некоторых провайдеров/NAT). Попробуйте открыть ссылку с мобильного интернета.';
    }
  }
}

function showToast(message) {
  toastElement.textContent = message;
  toastElement.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastElement.classList.remove('visible'), 2200);
}

function setStatus(element, label, value) {
  element.textContent = label;
  element.className = `status-text ${value}`;
}

function render(state) {
  statusElements.server.textContent = state.server;
  statusElements.server.className = `status-text ${
    state.server === 'Запущен' ? 'status-running' :
      state.server === 'Ошибка' ? 'status-error' :
        state.server === 'Остановлен' ? 'status-stopped' : ''
  }`;
  statusElements.chip.textContent = state.server;
  statusElements.chip.className = `status-chip ${
    state.server === 'Запущен' ? 'status-running' :
      state.server === 'Ошибка' ? 'status-error' :
        state.server === 'Остановлен' ? 'status-stopped' : 'status-starting'
  }`;

  const tunnelClass = state.tunnelState === 'reconnecting' ? 'status-reconnecting' :
    state.tunnel === 'Подключён' ? 'status-connected' :
    ['Ошибка', 'Ошибка подключения'].includes(state.tunnel) ? 'status-error' :
      state.tunnel === 'Недоступна сеть' ? 'status-network' :
        state.tunnel === 'Остановлен' ? 'status-stopped' : '';
  setStatus(statusElements.tunnel, state.tunnel, tunnelClass);

  localAddress.textContent = state.wifiAddress || state.serverAddress || 'Ожидание свободного порта…';
  publicAddress.textContent = state.publicAddress || 'Адрес появится после подключения';
  document.getElementById('open-local').disabled = !state.serverAddress || state.server !== 'Запущен';
  document.getElementById('copy-local').disabled = !state.serverAddress;
  const publicAddressReady = Boolean(state.publicAddress) && state.tunnel === 'Подключён';
  document.getElementById('open-public').disabled = !publicAddressReady;
  document.getElementById('copy-public').disabled = !publicAddressReady;
  healthBadge.className = `health-badge ${state.externalHealth === 'available' ? 'health-available' : 'health-warning'}`;
  healthBadge.classList.toggle('hidden', !['available', 'warning'].includes(state.externalHealth));
  healthBadge.textContent = state.externalHealth === 'available'
    ? '✓ Доступен извне'
    : '⚠️ Внешняя проверка не ответила';
  healthBadge.title = state.externalHealth === 'warning'
    ? 'Запрос изнутри сети не подтвердил доступность (это нормально для некоторых провайдеров/NAT). Попробуйте открыть ссылку с мобильного интернета.'
    : 'Публичная ссылка ответила на проверочный запрос с HTTP 200.';
  document.getElementById('start-tunnel').disabled =
    !state.serverAddress || state.server !== 'Запущен' ||
    state.tunnel === 'Подключён' || state.tunnel === 'Запускается' || state.tunnelState === 'reconnecting';
  document.getElementById('stop-tunnel').disabled =
    state.tunnel === 'Остановлен' || !['Подключён', 'Запускается', 'Переподключение…', 'Ошибка', 'Ошибка подключения', 'Недоступна сеть'].includes(state.tunnel);
  renderConnectionQr(state);

  tunnelDiagnostic.textContent = state.tunnelDiagnostic ||
    (['Ошибка', 'Ошибка подключения'].includes(state.tunnel)
      ? 'Публичный доступ недоступен. Локальная игра продолжает работать.'
      : '');
  tunnelDiagnostic.classList.toggle('warning', state.tunnelDiagnostic.startsWith('Предупреждение:'));
  tunnelDiagnostic.classList.toggle('reconnecting', state.tunnelState === 'reconnecting');
  tunnelDiagnostic.classList.toggle('hidden', !tunnelDiagnostic.textContent);
  logElement.replaceChildren();
  const entries = (state.log || []).slice(-200);
  if (entries.length === 0) logElement.textContent = 'Журнал пока пуст.';
  entries.forEach((entry, index) => {
    if (index > 0) logElement.append(document.createTextNode('\n'));
    const line = document.createElement('span');
    line.textContent = entry;
    if (/Автопереключение|Обход сетевых ограничений|Обход ограничений|HTTP\/2, IPv4|localhost\.run/i.test(entry)) {
      line.className = 'log-line-fallback';
    }
    logElement.append(line);
  });
  logElement.scrollTop = logElement.scrollHeight;
}

async function runAction(action, successMessage) {
  try {
    await action();
    if (successMessage) showToast(successMessage);
  } catch (error) {
    showToast(error.message || String(error));
  }
}

document.getElementById('open-local').addEventListener('click', () =>
  runAction(() => window.homeAuction.openAddress('local')));
document.getElementById('copy-local').addEventListener('click', () =>
  runAction(() => window.homeAuction.copyAddress('local'), 'Локальный адрес скопирован'));
document.getElementById('qr-source-wifi').addEventListener('click', () => {
  qrSource = 'wifi';
  if (latestState) renderConnectionQr(latestState, true);
});
document.getElementById('qr-source-cloud').addEventListener('click', () => {
  if (!latestState?.publicAddress || latestState.tunnel !== 'Подключён') return;
  qrSource = 'cloud';
  renderConnectionQr(latestState, true);
});
const qrFrame = document.getElementById('qr-frame');
async function copyQrAddress() {
  const address = qrSource === 'cloud'
    ? (latestState?.tunnel === 'Подключён' ? latestState.publicAddress : '')
    : latestState?.wifiAddress;
  if (!address) return;
  try {
    await window.homeAuction.copyAddress(qrSource === 'cloud' ? 'public' : 'local');
    const feedback = document.getElementById('qr-copy-feedback');
    feedback.textContent = '✓ Ссылка скопирована!';
    feedback.classList.add('visible');
    clearTimeout(qrCopyTimer);
    qrCopyTimer = setTimeout(() => {
      feedback.classList.remove('visible');
      feedback.textContent = '';
    }, 1500);
  } catch (error) {
    showToast(error.message || String(error));
  }
}
qrFrame.addEventListener('click', copyQrAddress);
qrFrame.addEventListener('keydown', event => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    copyQrAddress();
  }
});
document.getElementById('open-public').addEventListener('click', () =>
  runAction(() => window.homeAuction.openAddress('public')));
document.getElementById('copy-public').addEventListener('click', () =>
  runAction(() => window.homeAuction.copyAddress('public'), 'Публичный адрес скопирован'));
document.getElementById('start-tunnel').addEventListener('click', () =>
  runAction(() => window.homeAuction.startTunnel()));
document.getElementById('stop-tunnel').addEventListener('click', () =>
  runAction(() => window.homeAuction.stopTunnel()));
document.getElementById('minimize').addEventListener('click', () =>
  runAction(() => window.homeAuction.minimize()));
document.getElementById('quit').addEventListener('click', () =>
  runAction(() => window.homeAuction.quit()));
if (window.homeAuction) {
  window.homeAuction.onState(state => { latestState = state; render(state); });
  window.homeAuction.getState().then(state => { latestState = state; render(state); }).catch((error) => showToast(error.message));
} else {
  latestState = {
    server: 'Запускается',
    serverAddress: '',
    wifiAddress: '',
    tunnel: 'Остановлен',
    publicAddress: '',
    externalHealth: 'idle',
    log: []
  };
  render(latestState);
}
