'use strict';

const https = require('node:https');

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;
const CLOUDFLARE_START_TIMEOUT_MS = 30000;
const CLOUDFLARE_ADDRESS_TIMEOUT_MS = 10000;
const CLOUDFLARE_RECOVERY_TIMEOUT_MS = 30000;
const PUBLIC_HEALTHCHECK_TIMEOUT_MS = 7000;

function getLocalIPv4(networkInterfaces = require('node:os').networkInterfaces()) {
  const virtualName = /virtual|vmware|virtualbox|hyper-v|vethernet|wsl|docker|loopback|\btap\b|\btun\b|vpn/i;
  const candidates = [];
  for (const [name, addresses] of Object.entries(networkInterfaces || {})) {
    if (virtualName.test(name)) continue;
    for (const address of addresses || []) {
      const family = address.family;
      if (address.internal || (family !== 'IPv4' && family !== 4)) continue;
      const ip = String(address.address || '');
      if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip) || ip.startsWith('127.') || ip.startsWith('169.254.')) continue;
      candidates.push({ ip, private: /^(10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip) });
    }
  }
  candidates.sort((a, b) => Number(b.private) - Number(a.private));
  return candidates[0]?.ip || '';
}

function startPublicHealthcheck(address, {
  get = https.get,
  timeoutMs = PUBLIC_HEALTHCHECK_TIMEOUT_MS,
  onResult = () => {},
  setTimeout: schedule = setTimeout,
  clearTimeout: cancelTimer = clearTimeout
} = {}) {
  let finished = false;
  let request;
  const timer = schedule(() => {
    request?.destroy();
    finish(false);
  }, timeoutMs);
  const finish = available => {
    if (finished) return;
    finished = true;
    cancelTimer(timer);
    onResult(Boolean(available));
  };
  try {
    const url = new URL(address);
    if (url.protocol !== 'https:') {
      finish(false);
      return () => {};
    }
    request = get(url.toString(), { timeout: timeoutMs }, response => {
      response.resume?.();
      finish(response.statusCode === 200);
    });
    request.once('error', () => finish(false));
  } catch {
    finish(false);
  }
  return () => {
    if (finished) return;
    finished = true;
    cancelTimer(timer);
    request?.destroy();
  };
}

function normalizeProtocol(value) {
  const raw = String(value || '').trim().toLowerCase();
  return ['auto', 'quic', 'http2'].includes(raw)
    ? { protocol: raw, invalidValue: null }
    : { protocol: 'auto', invalidValue: raw || null };
}

function createLineBuffer(onLine, maxBuffer = 16384) {
  let buffer = '';
  let escapeTail = '';
  let pendingCR = false;
  const stripChunk = chunk => {
    const text = escapeTail + String(chunk);
    escapeTail = '';
    let output = '';
    for (let i = 0; i < text.length; i++) {
      if (text[i] !== '\u001b') { output += text[i]; continue; }
      const next = text[i + 1];
      if (!next) { escapeTail = text.slice(i, i + maxBuffer); break; }
      if (next !== '[') { i++; continue; }
      let end = i + 2;
      while (end < text.length && !/[\x40-\x7e]/.test(text[end])) end++;
      if (end >= text.length) { escapeTail = text.slice(i, i + maxBuffer); break; }
      i = end;
    }
    return output;
  };
  return {
    push(chunk) {
      let text = stripChunk(chunk);
      if (pendingCR) {
        onLine(buffer);
        buffer = '';
        pendingCR = false;
        if (text.startsWith('\n')) text = text.slice(1);
      }
      for (const char of text) {
        if (char === '\r') { pendingCR = true; continue; }
        if (char === '\n') { onLine(buffer); buffer = ''; continue; }
        buffer = (buffer + char).slice(-maxBuffer);
      }
    },
    end() {
      buffer = (buffer + stripChunk('')).slice(-maxBuffer);
      if (pendingCR) onLine(buffer);
      else if (buffer) onLine(buffer.replace(ANSI, ''));
      buffer = '';
      escapeTail = '';
      pendingCR = false;
    }
  };
}

function parsePublicTunnelUrl(input) {
  const candidates = String(input || '').match(/https:\/\/[^\s|"'<>]+/gi) || [];
  for (const candidate of candidates) {
    let url;
    try { url = new URL(candidate.replace(/[),.;]+$/, '')); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) continue;
    if (!/^[a-z0-9-]+\.trycloudflare\.com$/i.test(url.hostname) || !['', '/'].includes(url.pathname)) continue;
    return `https://${url.hostname.toLowerCase()}`;
  }
  return '';
}

function classifyTunnelLine(line) {
  const text = String(line || '').replace(ANSI, '');
  let parsed = {};
  try { const i = text.indexOf('{'); if (i >= 0) parsed = JSON.parse(text.slice(i)); } catch { /* plain log */ }
  const originError = /unable to reach the origin|failed to connect to origin|origin service.*(?:refused|unreachable|error)/i.test(text);
  const configurationError = /fatal error:.*(?:removed godebug|godebug.*old value|invalid godebug)|(?:unknown|invalid) flag/i.test(text);
  const registered = /registered tunnel connection/i.test(text);
  const unregistered = /(?:unregistered|unregistering|closed) tunnel connection/i.test(text);
  const index = parsed.connIndex ?? parsed.conn_index ?? (text.match(/connIndex[=: ]+(\d+)/i) || [])[1] ?? null;
  const precheck = /connectivity.*(?:pass|fail)|reachability|pre-check|precheck/i.test(text);
  const isError = /\b(?:err|error|failed|fatal)\b/i.test(text);
  let failureKind = '';
  if (/no such host|name resolution|temporary failure in name resolution|dns/i.test(text)) failureKind = 'dns';
  else if (/tls|handshake|certificate/i.test(text)) failureKind = 'tls';
  else if (/timeout|timed out|deadline exceeded/i.test(text)) failureKind = 'timeout';
  else if (isError) failureKind = 'error';
  const quicFailure = /failed to dial a quic connection|failed to accept quic stream|timeout: no recent network activity/i.test(text);
  const blockedProtocol = quicFailure || /(?:udp connectivity.*fail|quic.*(?:blocked|fail)|allow outbound quic)/i.test(text) ? 'quic' :
    /(?:tcp connectivity.*fail|allow outbound tcp.*7844|http\/2.*(?:blocked|unreachable))/i.test(text) ? 'http2' : '';
  return {
    text, originError, configurationError, registered, unregistered,
    publicAddress: parsePublicTunnelUrl(text), quicFailure, blockedProtocol,
    isError, failureKind, precheck,
    connIndex: index === null ? null : String(index)
  };
}

function shouldFallbackToHttp2(attempt, event, hasActiveConnection = false) {
  return attempt === 1 && !hasActiveConnection && Boolean(event && (event.quicFailure || event.blockedProtocol === 'quic'));
}

function buildTunnelArgs(protocol, origin, forceHttp2 = false) {
  const selected = forceHttp2 ? 'http2' : normalizeProtocol(protocol).protocol;
  const args = ['tunnel', '--protocol', selected];
  if (forceHttp2) args.push('--edge-ip-version', '4');
  args.push('--url', origin);
  return args;
}

function mergeGoDebug(value = '') {
  const kept = String(value).split(',').map(v => v.trim()).filter(Boolean)
    .filter(v => !/^(?:tlsmlkem|tlskyber)(?:=|$)/i.test(v));
  return [...kept, 'tlsmlkem=0'].join(',');
}

function cloudflareFailureReason(line) {
  const text = String(line || '').trim();
  if (!text) return '';
  if (/no such host|name resolution|temporary failure in name resolution|dns/i.test(text)) return `Ошибка DNS: ${text}`;
  if (/tls|handshake|certificate/i.test(text)) return `Ошибка TLS: ${text}`;
  return text;
}

function createTunnelFlow(deps) {
  let session = null;
  let serial = 0;
  const isCurrent = attempt => session && !session.cancelled && session.current === attempt;
  const clearTimer = (attempt, name) => {
    if (attempt && attempt[name]) deps.clearTimeout(attempt[name]);
    if (attempt) attempt[name] = null;
  };
  const clearTimers = attempt => {
    clearTimer(attempt, 'registrationTimer');
    clearTimer(attempt, 'addressTimer');
    clearTimer(attempt, 'recoveryTimer');
  };
  function diagnostic(attempt, key, message) {
    if (!isCurrent(attempt)) return;
    const stableKey = `${attempt.id}:${key}`;
    if (session.diagnostics.has(stableKey)) return;
    session.diagnostics.add(stableKey);
    deps.onDiagnostic({ attemptId: attempt.id, code: key, message });
  }
  function setState(patch) {
    if (session && !session.cancelled) deps.onState(patch);
  }
  async function stopAttempt(attempt) {
    clearTimers(attempt);
    if (!attempt || !attempt.child) return;
    if (!attempt.stopping) attempt.stopping = Promise.resolve(deps.stopProcess(attempt.child));
    await attempt.stopping;
  }
  async function fail(attempt, reason, displayMessage) {
    if (!isCurrent(attempt) || session.finished) return;
    session.finished = true;
    attempt.finished = true;
    clearTimers(attempt);
    try { await stopAttempt(attempt); } catch (error) { reason = `${reason}; не удалось завершить cloudflared: ${error.message}`; }
    if (!session || session.cancelled || session.current !== attempt) return;
    const message = displayMessage || 'Не удалось подключиться к Cloudflare Tunnel. Публичный доступ недоступен. Проверьте подключение к сети или попробуйте VPN. Локальная игра продолжает работать.';
    setState({ tunnel: 'Ошибка подключения', tunnelState: 'error', publicAddress: '', tunnelDiagnostic: message });
    diagnostic(attempt, 'final-error', reason);
    deps.onLog(`Cloudflare Tunnel: ${reason}`, 'Диагностика');
  }
  async function advance(attempt, reason) {
    if (!isCurrent(attempt) || session.finished || attempt.transitioning || attempt.protocol !== 'auto') return;
    attempt.transitioning = true;
    clearTimers(attempt);
    const message = `Попытка Cloudflare Tunnel (auto) не удалась: ${reason}. Переключение на HTTP/2 и IPv4.`;
    deps.onLog(message, 'Автопереключение');
    diagnostic(attempt, 'fallback-http2', reason);
    setState({ tunnel: 'Переподключение…', tunnelState: 'reconnecting', publicAddress: '', tunnelDiagnostic: message });
    try { await stopAttempt(attempt); } catch (error) {
      return fail(attempt, `Не удалось остановить первую попытку: ${error.message}`);
    }
    if (!session || session.cancelled || session.current !== attempt) return;
    launch('http2');
  }
  function activeConnectionCount(attempt) { return attempt.activeConnections.size; }
  function startAddressTimer(attempt) {
    clearTimer(attempt, 'addressTimer');
    attempt.addressTimer = deps.setTimeout(() => {
      attempt.addressTimer = null;
      if (!isCurrent(attempt) || attempt.ready || !attempt.registeredOnce || attempt.address) return;
      const reason = `Соединение зарегистрировано, но публичный адрес не получен за ${CLOUDFLARE_ADDRESS_TIMEOUT_MS / 1000} секунд.`;
      if (attempt.protocol === 'auto') void advance(attempt, reason);
      else void fail(attempt, reason);
    }, CLOUDFLARE_ADDRESS_TIMEOUT_MS);
  }
  function startRecoveryTimer(attempt) {
    clearTimer(attempt, 'recoveryTimer');
    attempt.recoveryTimer = deps.setTimeout(() => {
      attempt.recoveryTimer = null;
      if (!isCurrent(attempt) || activeConnectionCount(attempt) > 0) return;
      const reason = `Cloudflare потерял соединение и не восстановил его за ${CLOUDFLARE_RECOVERY_TIMEOUT_MS / 1000} секунд.`;
      if (attempt.wasReady) void fail(attempt, reason);
      else if (attempt.protocol === 'auto') void advance(attempt, reason);
      else void fail(attempt, reason);
    }, CLOUDFLARE_RECOVERY_TIMEOUT_MS);
  }
  function setConnected(attempt) {
    if (!isCurrent(attempt) || !attempt.address || activeConnectionCount(attempt) === 0) return;
    attempt.ready = true;
    attempt.wasReady = true;
    clearTimers(attempt);
    setState({ tunnel: 'Подключён', tunnelState: 'connected', publicAddress: attempt.address, tunnelDiagnostic: '' });
    diagnostic(attempt, 'connected', `Подключение Cloudflare Tunnel зарегистрировано: ${attempt.address}`);
  }
  function onLine(attempt, line) {
    if (!isCurrent(attempt) || session.finished || !line.trim()) return;
    deps.onLog(line, 'Cloudflare');
    const event = classifyTunnelLine(line);
    if (event.configurationError) {
      void fail(attempt, `Ошибка конфигурации cloudflared: ${line}`, 'Ошибка конфигурации cloudflared. Проверьте журнал; локальная игра продолжает работать.');
      return;
    }
    if (event.originError) {
      void fail(attempt, `Локальный origin недоступен: ${line}`, 'Cloudflare не может подключиться к локальному серверу. Локальная игра продолжает работать.');
      return;
    }
    if (event.isError && !event.precheck) attempt.lastFailure = cloudflareFailureReason(line);
    if (event.precheck) diagnostic(attempt, `connectivity-precheck:${event.blockedProtocol || 'general'}`, `Cloudflare connectivity precheck: ${line}`);
    if (event.registered) {
      const key = event.connIndex === null ? 'unknown' : event.connIndex;
      attempt.activeConnections.add(key);
      attempt.registeredOnce = true;
      clearTimer(attempt, 'registrationTimer');
      clearTimer(attempt, 'recoveryTimer');
      if (!attempt.address) startAddressTimer(attempt);
      setConnected(attempt);
    }
    if (event.unregistered) {
      const key = event.connIndex === null ? 'unknown' : event.connIndex;
      attempt.activeConnections.delete(key);
      if (activeConnectionCount(attempt) === 0 && attempt.registeredOnce) {
        attempt.ready = false;
        setState({ tunnel: 'Переподключение…', tunnelState: 'reconnecting', publicAddress: '', tunnelDiagnostic: 'Соединение Cloudflare потеряно; ожидание восстановления.' });
        clearTimer(attempt, 'addressTimer');
        startRecoveryTimer(attempt);
      }
    }
    if (event.publicAddress) {
      attempt.address = event.publicAddress;
      if (attempt.registeredOnce && activeConnectionCount(attempt) > 0) {
        clearTimer(attempt, 'addressTimer');
        setConnected(attempt);
      }
    }
  }
  function attach(attempt, child) {
    attempt.child = child;
    const buffers = [];
    for (const stream of [child.stdout, child.stderr]) {
      if (!stream) continue;
      const buffer = createLineBuffer(line => onLine(attempt, line));
      buffers.push(buffer);
      stream.setEncoding && stream.setEncoding('utf8');
      stream.on('data', buffer.push);
      stream.on('end', buffer.end);
    }
    child.once('error', error => {
      if (!isCurrent(attempt) || session.finished) return;
      const reason = error.code === 'ENOENT'
        ? 'cloudflared не найден. Проверьте встроенный бинарный файл.'
        : `Ошибка запуска cloudflared: ${error.message}`;
      void fail(attempt, reason, `${reason} Локальная игра продолжает работать.`);
    });
    child.once('close', (code, signal) => {
      for (const buffer of buffers) buffer.end();
      if (!isCurrent(attempt) || session.finished || attempt.transitioning) return;
      const exitReason = `Процесс Cloudflare завершился с кодом ${code ?? 'нет'} (сигнал ${signal ?? 'нет'}).`;
      const reason = attempt.lastFailure ? `${attempt.lastFailure}; ${exitReason}` : exitReason;
      if (attempt.wasReady) void fail(attempt, reason);
      else if (attempt.protocol === 'auto') void advance(attempt, reason);
      else void fail(attempt, reason);
    });
    attempt.registrationTimer = deps.setTimeout(() => {
      attempt.registrationTimer = null;
      if (!isCurrent(attempt) || attempt.registeredOnce) return;
      const reason = `Истекло ${CLOUDFLARE_START_TIMEOUT_MS / 1000} секунд ожидания Registered tunnel connection (protocol=${attempt.protocol}).`;
      if (attempt.protocol === 'auto') void advance(attempt, reason);
      else void fail(attempt, reason);
    }, CLOUDFLARE_START_TIMEOUT_MS);
  }
  function launch(protocol) {
    if (!session || session.cancelled || session.finished) return;
    const attempt = {
      id: ++serial, protocol, child: null, registrationTimer: null, addressTimer: null, recoveryTimer: null,
      activeConnections: new Set(), registeredOnce: false, address: '', ready: false, wasReady: false,
      transitioning: false, finished: false, lastFailure: '', stopping: null
    };
    session.current = attempt;
    deps.onProtocol(protocol);
    if (protocol === 'http2') setState({ tunnel: 'Запускается', tunnelState: 'connecting', publicAddress: '', tunnelDiagnostic: 'Запуск Cloudflare Tunnel с HTTP/2 и IPv4.' });
    try {
      const origin = `http://127.0.0.1:${session.port}`;
      const child = deps.spawnCloudflare(protocol, origin, attempt.id);
      attach(attempt, child);
    } catch (error) {
      const reason = `Ошибка запуска cloudflared: ${error.message}`;
      void fail(attempt, reason, `${reason} Локальная игра продолжает работать.`);
    }
  }
  return {
    async start(port) {
      if (session && !session.cancelled && !session.finished) return;
      session = { id: ++serial, port, cancelled: false, finished: false, current: null, diagnostics: new Set() };
      deps.onState({ tunnel: 'Запускается', tunnelState: 'connecting', publicAddress: '', tunnelDiagnostic: '' });
      launch('auto');
    },
    async stop() {
      const active = session;
      if (active) {
        active.cancelled = true;
        clearTimers(active.current);
      }
      session = null;
      const current = active && active.current;
      if (current) await stopAttempt(current);
      deps.onState({ tunnel: 'Остановлен', tunnelState: 'stopped', publicAddress: '', tunnelDiagnostic: '' });
    },
    get current() { return session && session.current; }
  };
}

module.exports = {
  CLOUDFLARE_START_TIMEOUT_MS,
  CLOUDFLARE_ADDRESS_TIMEOUT_MS,
  CLOUDFLARE_RECOVERY_TIMEOUT_MS,
  PUBLIC_HEALTHCHECK_TIMEOUT_MS,
  getLocalIPv4,
  startPublicHealthcheck,
  normalizeProtocol,
  createLineBuffer,
  classifyTunnelLine,
  shouldFallbackToHttp2,
  buildTunnelArgs,
  mergeGoDebug,
  cloudflareFailureReason,
  parsePublicTunnelUrl,
  createTunnelFlow
};
