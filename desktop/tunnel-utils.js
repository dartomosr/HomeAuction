'use strict';

const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function normalizeProtocol(value) {
  const raw = String(value || '').trim().toLowerCase();
  return ['auto', 'quic', 'http2'].includes(raw)
    ? { protocol: raw, invalidValue: null }
    : { protocol: 'auto', invalidValue: raw || null };
}

function createLineBuffer(onLine, maxBuffer = 16384) {
  let buffer = '';
  let escapeTail = '';
  const cleanChunk = chunk => {
    const value = escapeTail + String(chunk);
    escapeTail = '';
    let output = '';
    for (let i = 0; i < value.length; i++) {
      if (value[i] !== '\u001b') { output += value[i]; continue; }
      const next = value[i + 1];
      if (!next) { escapeTail = value.slice(i); break; }
      if (next === '[') {
        let end = i + 2;
        while (end < value.length && !/[\x40-\x7e]/.test(value[end])) end++;
        if (end >= value.length) { escapeTail = value.slice(i, i + maxBuffer); break; }
        i = end;
      } else if (next === ']') {
        let end = i + 2;
        while (end < value.length && value[end] !== '\u0007' && !(value[end] === '\u001b' && value[end + 1] === '\\')) end++;
        if (end >= value.length || value[end] === '\u001b' && end + 1 >= value.length) { escapeTail = value.slice(i, i + maxBuffer); break; }
        i = value[end] === '\u001b' ? end + 1 : end;
      } else i++;
    }
    return output;
  };
  return {
    push(chunk) {
      buffer = (buffer + cleanChunk(chunk)).slice(-maxBuffer);
      const lines = buffer.split(/\r\n|\n|\r/);
      buffer = lines.pop() || '';
      for (const line of lines) onLine(line);
    },
    end() {
      buffer = (buffer + cleanChunk('')).slice(-maxBuffer);
      if (buffer) onLine(buffer.replace(ANSI, ''));
      buffer = '';
      escapeTail = '';
    }
  };
}

function parsePublicTunnelUrl(input) {
  const candidates = String(input || '').match(/https:\/\/[^\s|"'<>]+/gi) || [];
  for (const candidate of candidates) {
    let url;
    try { url = new URL(candidate.replace(/[),.;]+$/, '')); } catch { continue; }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) continue;
    const host = url.hostname.toLowerCase();
    const valid = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com\/?$/i.test(url.href) ||
      /^[a-z0-9-]+\.(?:lhr\.life|localhost\.run)$/i.test(host) && url.pathname === '/';
    if (valid) return `https://${host}`;
  }
  return '';
}

function parseSshTunnelConfirmation(line) {
  const text = String(line || '').replace(ANSI, '').trim();
  const confirmation = text.match(/(?:^|\s)([a-z0-9-]+\.(?:lhr\.life|localhost\.run))\s+tunneled\s+with\s+tls\s+termination\s*,\s*(https:\/\/[^\s"'<>|]+)/i);
  if (!confirmation) return '';
  const confirmedHost = confirmation[1].toLowerCase();
  let url;
  try { url = new URL(confirmation[2].replace(/[),.;]+$/, '')); } catch { return ''; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') return '';
  const host = url.hostname.toLowerCase();
  if (host !== confirmedHost || !/^[a-z0-9-]+\.(?:lhr\.life|localhost\.run)$/i.test(host)) return '';
  if (/^(?:admin|www|docs?|documentation|account|dashboard|manage)\./i.test(host)) return '';
  return `https://${host}`;
}

function isSshQrLine(line) {
  const text = String(line || '').trim();
  if (!text || /(?:tunneled\s+with\s+tls\s+termination|https:\/\/|\b(?:error|failed|warning|exception|refused|timed?\s*out)\b)/i.test(text)) return false;
  if (/qr\s*code/i.test(text)) return true;
  const marks = (text.match(/[█▀▄▌▐░▒▓▖▗▘▝▚▞╔╗╚╝║═]/g) || []).length;
  return marks >= 4 && marks / Math.max(text.length, 1) >= 0.28;
}

function isRenderableSshLine(line) {
  const text = String(line || '').trim();
  return Boolean(text) && !isSshQrLine(text);
}

function classifyTunnelLine(line) {
  const text = String(line || '').replace(ANSI, '');
  let parsed = {};
  try { const i = text.indexOf('{'); if (i >= 0) parsed = JSON.parse(text.slice(i)); } catch { /* plain log */ }
  const lower = text.toLowerCase();
  const originError = /unable to reach the origin|failed to connect to origin|origin service.*(?:refused|unreachable|error)/i.test(text);
  const connected = /registered tunnel connection/i.test(text);
  const quicFailure = /failed to dial a quic connection|failed to accept quic stream|timeout: no recent network activity/i.test(text);
  const blockedProtocol = quicFailure || /(?:udp connectivity.*fail|quic.*(?:blocked|fail)|allow outbound quic)/i.test(text) ? 'quic' :
    /(?:tcp connectivity.*fail|allow outbound tcp.*7844|http\/2.*(?:blocked|unreachable))/i.test(text) ? 'http2' : '';
  return {
    text, connected, originError,
    publicAddress: parsePublicTunnelUrl(text),
    quicFailure: quicFailure || blockedProtocol === 'quic', blockedProtocol,
    isError: /\b(?:err|error|failed)\b/i.test(text),
    precheck: /connectivity.*(?:pass|fail)|reachability|pre-check|precheck/i.test(text),
    connIndex: parsed.connIndex ?? parsed.conn_index ?? (text.match(/connIndex[=: ]+(\d+)/i) || [])[1] ?? null,
    attemptNumber: parsed.attempt ?? parsed.attemptNumber ?? (text.match(/attempt(?:Number)?[=: ]+(\d+)/i) || [])[1] ?? null
  };
}

function shouldFallbackToHttp2(attempt, event, connected = false) {
  return attempt === 1 && !connected && Boolean(event && (event.quicFailure || event.blockedProtocol === 'quic'));
}

function buildTunnelArgs(protocol, origin, forceHttp2 = false) {
  const selected = forceHttp2 ? 'http2' : normalizeProtocol(protocol).protocol;
  const args = ['tunnel', '--protocol', selected];
  if (forceHttp2) args.push('--edge-ip-version', '4');
  args.push('--url', origin);
  return args;
}

function buildSshArgs(port, knownHostsPath) {
  return ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30',
    '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=accept-new',
    '-o', `UserKnownHostsFile=${knownHostsPath}`, '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run'];
}

function mergeGoDebug(value = '') {
  const kept = String(value).split(',').map(v => v.trim()).filter(Boolean)
    .filter(v => !/^(?:tlsmlkem|tlskyber)(?:=|$)/i.test(v));
  return [...kept, 'tlsmlkem=0'].join(',');
}

function classifySshFailure(error, text = '') {
  const value = `${error && error.message || ''} ${text}`;
  if (error && error.code === 'ENOENT') return 'Системный ssh не найден. Установите OpenSSH Client в Windows.';
  if (/REMOTE HOST IDENTIFICATION HAS CHANGED|host key verification failed/i.test(value)) return 'Ключ localhost.run изменился или не прошёл проверку. Проверьте known_hosts в данных приложения.';
  if (/(?:unknown option|illegal option|bad configuration option)/i.test(value)) return 'Установленная версия ssh не поддерживает необходимые параметры резервного туннеля.';
  if (/connection refused|timed out|could not resolve|network is unreachable/i.test(value)) return `localhost.run не установил SSH-соединение: ${value.trim()}`;
  return `SSH-туннель завершился: ${value.trim() || 'неизвестная причина'}`;
}

function createTunnelFlow(deps) {
  let session = null;
  let serial = 0;
  const isCurrent = attempt => session && !session.cancelled && session.current === attempt;
  const clearTimer = attempt => { if (attempt && attempt.timer) deps.clearTimeout(attempt.timer); if (attempt) attempt.timer = null; };
  function diagnostic(attempt, key, message) {
    if (!isCurrent(attempt)) return;
    const stable = `${attempt.id}:${key}`;
    if (session.diagnostics.has(stable)) return;
    session.diagnostics.add(stable);
    deps.onDiagnostic({ attemptId: attempt.id, code: key, message });
  }
  function setState(patch) { if (session && !session.cancelled) deps.onState(patch); }
  async function stopAttempt(attempt) {
    clearTimer(attempt);
    if (!attempt || !attempt.child || attempt.stopping) return attempt && attempt.stopping;
    attempt.stopping = Promise.resolve(deps.stopProcess(attempt.child));
    await attempt.stopping;
  }
  async function fail(message, reason) {
    if (!session || session.cancelled || session.finished) return;
    session.finished = true;
    const current = session.current;
    clearTimer(current);
    setState({ tunnel: 'Ошибка', tunnelState: 'error', publicAddress: '', tunnelDiagnostic: `${message} ${reason || ''}`.trim() });
    diagnostic(current || { id: session.id }, 'final-error', `${message} ${reason || ''}`.trim());
    if (current && current.child) void stopAttempt(current).catch(error => deps.onLog(`Не удалось завершить туннель: ${error.message}`, 'Диагностика'));
  }
  async function advance(attempt, reason) {
    if (!isCurrent(attempt) || attempt.transitioning) return;
    if (attempt.kind === 'ssh') return fail('Не удалось запустить ни основной, ни резервный туннель. Проверьте сеть или попробуйте VPN.', reason);
    attempt.transitioning = true;
    clearTimer(attempt);
    const next = attempt.kind === 'auto' ? 'http2' : 'ssh';
    const msg = next === 'http2'
      ? `Обход сетевых ограничений (переключение на HTTP/2)… Причина: ${reason}`
      : `Cloudflare Tunnel не подключился (${reason}). Запуск резервного SSH-туннеля (localhost.run)…`;
    deps.onLog(msg, 'Автопереключение');
    setState({ tunnel: next === 'http2' ? 'Переподключение…' : 'Обход ограничений…', tunnelState: 'reconnecting', tunnelProvider: next === 'ssh' ? 'Резервный SSH-туннель' : 'Cloudflare Tunnel', publicAddress: '', tunnelDiagnostic: msg });
    try { await stopAttempt(attempt); } catch (error) { return fail('Не удалось остановить предыдущий туннель.', error.message); }
    if (!session || session.cancelled || session.current !== attempt) return;
    launch(next);
  }
  function onLine(attempt, line, stream) {
    if (!isCurrent(attempt)) return;
    if (attempt.kind === 'ssh') {
      if (isRenderableSshLine(line)) deps.onLog(line, 'SSH');
      const address = parseSshTunnelConfirmation(line);
      if (address) ready(attempt, address);
      if (/REMOTE HOST IDENTIFICATION HAS CHANGED/i.test(line)) diagnostic(attempt, 'host-key-changed', classifySshFailure(null, line));
      return;
    }
    deps.onLog(line, 'Cloudflare');
    if (/fatal error:.*(?:removed godebug|godebug.*old value|invalid godebug)/i.test(line)) {
      attempt.configurationFailure = line;
      void fail('Cloudflare завершился из-за некорректной конфигурации GODEBUG.', line);
      return;
    }
    const event = classifyTunnelLine(line);
    if (event.precheck) diagnostic(attempt, `precheck:${line}`, `Cloudflare precheck: ${line}`);
    if (event.originError) {
      clearTimer(attempt);
      void fail('Cloudflare не достигает локальный сервер; проверьте HTTP origin.', line);
      return;
    }
    if (event.connected) {
      attempt.registered = true;
      attempt.edgeFailures.clear();
      clearTimer(attempt);
      setState({ tunnel: 'Запускается', tunnelState: 'connecting', tunnelDiagnostic: 'Соединение зарегистрировано; ожидается публичный адрес.' });
    }
    if (event.publicAddress) attempt.address = event.publicAddress;
    if (attempt.registered && attempt.address) ready(attempt, attempt.address);
    if (attempt.kind === 'http2' && !attempt.registered && /(?:tls: first record does not look like a TLS handshake|tls handshake.*(?:eof|timeout)|unable to establish connection)/i.test(line)) {
      const index = event.connIndex;
      const num = event.attemptNumber;
      if (index !== null && num !== null) {
        const key = `${index}:${num}`;
        if (!attempt.edgeFailures.has(key)) attempt.edgeFailures.add(key);
        if (attempt.edgeFailures.size >= 3) void advance(attempt, 'Три отдельных сбоя HTTP/2 edge-соединения.');
      }
    }
    if (event.quicFailure && !event.precheck && !attempt.registered) void advance(attempt, line);
  }
  function ready(attempt, address) {
    if (!isCurrent(attempt) || attempt.ready) return;
    attempt.ready = true;
    clearTimer(attempt);
    setState({ tunnel: 'Подключён', tunnelState: 'connected', publicAddress: address, tunnelDiagnostic: '' });
    diagnostic(attempt, 'connected', `Публичная ссылка выдана туннелем: ${address}`);
  }
  function attach(attempt, child) {
    attempt.child = child;
    const lines = new Map();
    for (const [streamName, stream] of [['stdout', child.stdout], ['stderr', child.stderr]]) {
      if (!stream) continue;
      const buffer = createLineBuffer(line => onLine(attempt, line, streamName));
      lines.set(streamName, buffer);
      stream.setEncoding && stream.setEncoding('utf8');
      stream.on('data', buffer.push); stream.on('end', buffer.end);
    }
    child.once('error', error => {
      if (!isCurrent(attempt)) return;
      clearTimer(attempt);
      if (attempt.kind === 'ssh') void fail('Не удалось запустить ни основной, ни резервный туннель. Проверьте сеть или попробуйте VPN.', classifySshFailure(error));
      else void fail(`Не удалось запустить cloudflared: ${error.message}`, 'Проверьте бинарный файл Cloudflare Tunnel.');
    });
    child.once('close', (code, signal) => {
      for (const buffer of lines.values()) buffer.end();
      if (!isCurrent(attempt) || attempt.transitioning || session.finished) return;
      clearTimer(attempt);
      if (session.cancelled) return;
      const reason = `${attempt.kind === 'ssh' ? 'SSH' : 'Cloudflare'} завершился (код ${code ?? 'нет'}, сигнал ${signal ?? 'нет'}).`;
      if (attempt.kind === 'ssh') void fail('Не удалось запустить ни основной, ни резервный туннель. Проверьте сеть или попробуйте VPN.', reason);
      else if (attempt.configurationFailure) void fail('Cloudflare завершился из-за некорректной конфигурации.', attempt.configurationFailure);
      else void advance(attempt, reason);
    });
    const timeout = attempt.kind === 'ssh' ? 20000 : 15000;
    attempt.timer = deps.setTimeout(() => {
      attempt.timer = null;
      if (!isCurrent(attempt) || attempt.ready) return;
      if (attempt.kind === 'ssh') void fail('Не удалось запустить ни основной, ни резервный туннель. Проверьте сеть или попробуйте VPN.', 'localhost.run не выдал публичный адрес за 20 секунд.');
      else if (!attempt.registered) void advance(attempt, 'Нет Registered tunnel connection за 15 секунд.');
    }, timeout);
  }
  function launch(kind) {
    if (!session || session.cancelled) return;
    const attempt = { id: ++serial, kind, child: null, timer: null, registered: false, ready: false, transitioning: false, edgeFailures: new Set(), address: '' };
    session.current = attempt;
    if (kind === 'ssh') {
      setState({ tunnel: 'Ожидание резервного SSH-туннеля…', tunnelState: 'reconnecting', tunnelProvider: 'Резервный SSH-туннель', publicAddress: '' });
      Promise.resolve(deps.prepareSsh(session.port, attempt.id)).then(config => {
        if (!isCurrent(attempt)) return;
        const child = deps.spawnSsh(config, attempt.id);
        attach(attempt, child);
      }).catch(error => { if (isCurrent(attempt)) void fail('Не удалось запустить ни основной, ни резервный туннель. Проверьте сеть или попробуйте VPN.', classifySshFailure(error)); });
      return;
    }
    try {
      deps.onProtocol(kind === 'auto' ? 'auto' : 'http2');
      attach(attempt, deps.spawnCloudflare(kind, `http://127.0.0.1:${session.port}`, attempt.id));
    } catch (error) { void fail(`Не удалось запустить cloudflared: ${error.message}`, 'Проверьте бинарный файл Cloudflare Tunnel.'); }
  }
  return {
    async start(port) {
      if (session && !session.cancelled && !session.finished) return;
      session = { id: ++serial, port, cancelled: false, finished: false, current: null, diagnostics: new Set() };
      setState({ tunnel: 'Запускается', tunnelState: 'connecting', tunnelProvider: 'Cloudflare Tunnel', publicAddress: '', tunnelDiagnostic: '' });
      launch('auto');
    },
    async stop() {
      const active = session;
      if (active) { active.cancelled = true; clearTimer(active.current); }
      session = null;
      const child = active && active.current && active.current.child;
      if (child) await deps.stopProcess(child);
      deps.onState({ tunnel: 'Остановлен', tunnelState: 'stopped', tunnelProvider: 'Cloudflare Tunnel', publicAddress: '', tunnelDiagnostic: '' });
    },
    get current() { return session && session.current; }
  };
}

module.exports = { normalizeProtocol, createLineBuffer, classifyTunnelLine, shouldFallbackToHttp2,
  buildTunnelArgs, buildSshArgs, mergeGoDebug, parsePublicTunnelUrl, parseSshTunnelConfirmation,
  isSshQrLine, isRenderableSshLine, classifySshFailure, createTunnelFlow };
