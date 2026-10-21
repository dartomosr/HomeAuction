const statusElements = {
  server: document.getElementById('server-status'),
  tunnel: document.getElementById('tunnel-status'),
  chip: document.getElementById('server-chip')
};
const localAddress = document.getElementById('local-address');
const publicAddress = document.getElementById('public-address');
const logElement = document.getElementById('log');
const tunnelDiagnostic = document.getElementById('tunnel-diagnostic');
const toastElement = document.getElementById('toast');
let toastTimer;

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
    state.tunnel === 'Ошибка' ? 'status-error' :
      state.tunnel === 'Недоступна сеть' ? 'status-network' :
        state.tunnel === 'Остановлен' ? 'status-stopped' : '';
  setStatus(statusElements.tunnel, state.tunnel, tunnelClass);
  document.getElementById('tunnel-provider').textContent = state.tunnelProvider || 'Cloudflare Tunnel';

  localAddress.textContent = state.serverAddress || 'Ожидание свободного порта…';
  publicAddress.textContent = state.publicAddress || 'Адрес появится после подключения';
  document.getElementById('open-local').disabled = !state.serverAddress || state.server !== 'Запущен';
  document.getElementById('copy-local').disabled = !state.serverAddress;
  const publicAddressReady = Boolean(state.publicAddress) && state.tunnel === 'Подключён';
  document.getElementById('open-public').disabled = !publicAddressReady;
  document.getElementById('copy-public').disabled = !publicAddressReady;
  document.getElementById('start-tunnel').disabled =
    !state.serverAddress || state.server !== 'Запущен' ||
    state.tunnel === 'Подключён' || state.tunnel === 'Запускается' || state.tunnelState === 'reconnecting';
  document.getElementById('stop-tunnel').disabled =
    state.tunnel === 'Остановлен' || !['Подключён', 'Запускается', 'Ожидание резервного SSH-туннеля…', 'Переподключение…', 'Обход ограничений…', 'Ошибка', 'Недоступна сеть'].includes(state.tunnel);

  tunnelDiagnostic.textContent = state.tunnelDiagnostic ||
    (state.tunnel === 'Ошибка'
      ? 'Туннель не подключён. Проверьте журнал; локальный сервер продолжает работать.'
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
  window.homeAuction.onState(render);
  window.homeAuction.getState().then(render).catch((error) => showToast(error.message));
} else {
  render({
    server: 'Запускается',
    serverAddress: '',
    tunnel: 'Остановлен',
    publicAddress: '',
    log: []
  });
}
