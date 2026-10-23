'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { describe, test } = require('node:test');
const {
  CLOUDFLARE_START_TIMEOUT_MS,
  CLOUDFLARE_ADDRESS_TIMEOUT_MS,
  CLOUDFLARE_RECOVERY_TIMEOUT_MS,
  PUBLIC_HEALTHCHECK_TIMEOUT_MS,
  classifyTunnelLine,
  createLineBuffer,
  normalizeProtocol,
  shouldFallbackToHttp2,
  buildTunnelArgs,
  mergeGoDebug,
  cloudflareFailureReason,
  createTunnelFlow,
  getLocalIPv4,
  startPublicHealthcheck
} = require('../desktop/tunnel-utils');
const { makeQrSvg, qrMatrix } = require('../desktop/ui/qr');

describe('desktop Cloudflare tunnel flow', () => {
  test('selects a non-internal physical LAN IPv4 and skips loopback and virtual adapters', () => {
    assert.equal(getLocalIPv4({
      'VirtualBox Host-Only Network': [{ address: '192.168.56.1', family: 'IPv4', internal: false }],
      'Loopback Pseudo-Interface': [{ address: '127.0.0.1', family: 4, internal: true }],
      Ethernet: [{ address: '8.8.8.8', family: 'IPv4', internal: false }],
      'Wi-Fi': [{ address: '192.168.1.42', family: 4, internal: false }]
    }), '192.168.1.42');
    assert.equal(getLocalIPv4({ 'vEthernet (WSL)': [{ address: '172.20.0.1', family: 'IPv4', internal: false }] }), '');
  });

  test('starts a bounded public healthcheck without waiting or changing tunnel status', () => {
    const request = new EventEmitter();
    request.destroy = () => {};
    const timers = new Map();
    let timerId = 0;
    const results = [];
    let tunnelStatus = 'Подключён';
    let requestedUrl = '';
    const cancel = startPublicHealthcheck('https://game.trycloudflare.com', {
      timeoutMs: PUBLIC_HEALTHCHECK_TIMEOUT_MS,
      get(url, options, callback) {
        requestedUrl = url;
        assert.equal(options.timeout, PUBLIC_HEALTHCHECK_TIMEOUT_MS);
        request.respond = statusCode => callback({ statusCode, resume() {} });
        return request;
      },
      setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
      clearTimeout(id) { timers.delete(id); },
      onResult(available) { results.push(available); if (!available) tunnelStatus = 'Подключён'; }
    });

    assert.equal(requestedUrl, 'https://game.trycloudflare.com/');
    assert.equal(tunnelStatus, 'Подключён');
    assert.deepEqual(results, [], 'the call returns while the network request is still pending');
    assert.equal([...timers.values()][0].ms, 7000);
    request.respond(503);
    assert.deepEqual(results, [false]);
    assert.equal(tunnelStatus, 'Подключён');
    assert.equal(timers.size, 0);
    cancel();
  });

  test('marks a public healthcheck available only for HTTP 200', () => {
    const request = new EventEmitter();
    request.destroy = () => {};
    let result;
    startPublicHealthcheck('https://game.trycloudflare.com', {
      get(_url, _options, callback) {
        callback({ statusCode: 200, resume() {} });
        return request;
      },
      onResult(available) { result = available; }
    });
    assert.equal(result, true);
  });

  test('creates a scalable QR SVG for a local Wi-Fi address', () => {
    const matrix = qrMatrix('http://192.168.1.42:3000');
    assert.ok([21, 25, 29, 33].includes(matrix.length));
    assert.ok(matrix.every(row => row.length === matrix.length));
    const svg = makeQrSvg('http://192.168.1.42:3000');
    assert.match(svg, /^<svg .*<rect width="100%" height="100%" fill="#181926"\/><path d="M/);
    assert.match(svg, /fill="#f3f4f8"\/><\/svg>$/);
    assert.equal(qrMatrix('x'.repeat(60)).length, 37);
  });

  test('accepts supported protocols and builds exact auto and HTTP/2 arguments', () => {
    assert.deepEqual(normalizeProtocol('HTTP2'), { protocol: 'http2', invalidValue: null });
    assert.deepEqual(normalizeProtocol('unknown'), { protocol: 'auto', invalidValue: 'unknown' });
    assert.deepEqual(buildTunnelArgs('auto', 'http://127.0.0.1:4321'),
      ['tunnel', '--protocol', 'auto', '--url', 'http://127.0.0.1:4321']);
    assert.deepEqual(buildTunnelArgs('auto', 'http://127.0.0.1:4321', true),
      ['tunnel', '--protocol', 'http2', '--edge-ip-version', '4', '--url', 'http://127.0.0.1:4321']);
  });

  test('removes inherited tlskyber and preserves other GODEBUG and process environment values', () => {
    const inherited = { GODEBUG: 'http2client=0,tlskyber=0,custom=enabled', PATH: 'system-path', PORT: '4001' };
    const childEnv = { ...inherited, GODEBUG: mergeGoDebug(inherited.GODEBUG) };
    assert.equal(childEnv.GODEBUG, 'http2client=0,custom=enabled,tlsmlkem=0');
    assert.doesNotMatch(childEnv.GODEBUG, /tlskyber/i);
    assert.equal(childEnv.PATH, inherited.PATH);
    assert.equal(childEnv.PORT, inherited.PORT);
    assert.equal(inherited.GODEBUG, 'http2client=0,tlskyber=0,custom=enabled');
  });

  test('classifies registration, prechecks, origin/config errors, and useful TLS/DNS reasons', () => {
    assert.equal(classifyTunnelLine('INF Registered tunnel connection connIndex=0').registered, true);
    assert.equal(classifyTunnelLine('INF Unregistered tunnel connection connIndex=0').unregistered, true);
    const precheck = classifyTunnelLine('INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    assert.equal(precheck.precheck, true);
    assert.equal(precheck.blockedProtocol, 'quic');
    assert.equal(classifyTunnelLine('Unable to reach the origin service: connection refused').originError, true);
    assert.equal(classifyTunnelLine('fatal error: removed GODEBUG "tlskyber" set to old value "0"').configurationError, true);
    assert.match(cloudflareFailureReason('lookup edge.example: no such host'), /^Ошибка DNS:/);
    assert.match(cloudflareFailureReason('TLS handshake EOF'), /^Ошибка TLS:/);
  });

  test('buffers complete Cloudflare lines across chunks, strips split ANSI controls, and bounds partial data', () => {
    const lines = [];
    const buffer = createLineBuffer(line => lines.push(line), 32);
    buffer.push('\u001b[31');
    buffer.push('mRegistered tunnel connection\u001b[0m\r');
    buffer.push('\ntrailing');
    buffer.end();
    assert.deepEqual(lines, ['Registered tunnel connection', 'trailing']);
    const boundedLines = [];
    const bounded = createLineBuffer(line => boundedLines.push(line), 32);
    bounded.push('x'.repeat(10000));
    bounded.push('\n');
    assert.equal(boundedLines[0].length, 32);
  });

  test('only accepts Cloudflare quick tunnel URLs with the exact hostname suffix', () => {
    assert.equal(classifyTunnelLine('INF | https://game-name.trycloudflare.com |').publicAddress,
      'https://game-name.trycloudflare.com');
    for (const line of [
      'https://name.evil.test',
      'https://name.trycloudflare.com.evil.test', 'https://name.trycloudflare.com/path',
      'https://name.trycloudflare.com/?retry=1'
    ]) assert.equal(classifyTunnelLine(line).publicAddress, '', line);
  });

  test('runs auto then HTTP/2 IPv4 only after auto has stopped, with the actual loopback port', async () => {
    const h = makeFlowHarness();
    await h.flow.start(4567);
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto']);
    assert.equal(h.spawned[0].origin, 'http://127.0.0.1:4567');
    h.close(h.spawned[0], 1);
    await flush();
    assert.deepEqual(h.stopped, [h.spawned[0]]);
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto', 'http2']);
    assert.equal(h.spawned[1].origin, 'http://127.0.0.1:4567');
    assert.equal(h.spawned.length, 2);
  });

  test('does not switch immediately on connectivity precheck FAIL or port 7844 text', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.line(h.spawned[0], 'stderr', 'INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    h.line(h.spawned[0], 'stderr', 'ERR Allow outbound QUIC traffic on port 7844');
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto']);
    h.timers.advance(CLOUDFLARE_START_TIMEOUT_MS - 1);
    assert.equal(h.spawned.length, 1);
    h.timers.advance(1);
    await flush();
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto', 'http2']);
  });

  test('requires both URL and registered active connection for success', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    h.line(child, 'stdout', 'INF | https://game.trycloudflare.com |');
    assert.notEqual(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.timers.activeCount(), 1);
    h.line(child, 'stderr', 'INF Registered tunnel connection connIndex=0');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.state.at(-1).publicAddress, 'https://game.trycloudflare.com');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('does not fall back on an error from another connection index while one connection is active', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    h.line(child, 'stdout', 'INF | https://game.trycloudflare.com |');
    h.line(child, 'stderr', 'INF Registered tunnel connection connIndex=0');
    h.line(child, 'stderr', 'ERR TLS handshake EOF connIndex=1');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.spawned.length, 1);
    assert.equal(h.timers.activeCount(), 0);
  });

  test('uses a bounded address wait after registration and falls back only after it expires', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.line(h.spawned[0], 'stderr', 'INF Registered tunnel connection connIndex=0');
    assert.equal(h.timers.activeCount(), 1);
    h.timers.advance(CLOUDFLARE_ADDRESS_TIMEOUT_MS);
    await flush();
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto', 'http2']);
    h.line(h.spawned[1], 'stderr', 'INF Registered tunnel connection connIndex=1');
    h.timers.advance(CLOUDFLARE_ADDRESS_TIMEOUT_MS);
    await flush();
    assert.equal(h.state.at(-1).tunnel, 'Ошибка подключения');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('times out both registration attempts, stops processes, and keeps local server state running', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.timers.advance(CLOUDFLARE_START_TIMEOUT_MS);
    await flush();
    h.timers.advance(CLOUDFLARE_START_TIMEOUT_MS);
    await flush();
    assert.equal(h.state.at(-1).tunnel, 'Ошибка подключения');
    assert.equal(h.state.at(-1).publicAddress, '');
    assert.match(h.state.at(-1).tunnelDiagnostic, /Публичный доступ недоступен.*Локальная игра продолжает работать/);
    assert.equal(h.server, 'Запущен');
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto', 'http2']);
    assert.equal(h.stopped.length, 2);
    assert.equal(h.timers.activeCount(), 0);
  });

  test('allows an explicit retry with fresh counters, diagnostics, address, and auto-first order', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.line(h.spawned[0], 'stderr', 'ERR TLS handshake EOF');
    h.close(h.spawned[0], 1);
    await flush();
    h.close(h.spawned[1], 1);
    await flush();
    assert.equal(h.state.at(-1).tunnel, 'Ошибка подключения');
    await h.flow.start(3000);
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto', 'http2', 'auto']);
    assert.equal(h.state.at(-1).publicAddress, '');
    assert.equal(h.flow.current.protocol, 'auto');
  });

  test('deduplicates an identical application diagnostic per attempt but resets for a new session', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const attempt = h.spawned[0];
    h.line(attempt, 'stderr', 'INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    h.line(attempt, 'stderr', 'INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    assert.equal(h.diagnostics.length, 1, 'duplicate prechecks from the same attempt should emit one diagnostic');
    h.timers.advance(CLOUDFLARE_START_TIMEOUT_MS);
    await flush();
    h.close(h.spawned[1], 1);
    await flush();
    await h.flow.start(3000);
    const diagnosticsBeforeNewAttempt = h.diagnostics.length;
    h.line(h.spawned[2], 'stderr', 'INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    h.line(h.spawned[2], 'stderr', 'INF | UDP Connectivity region2 FAIL QUIC connection failed |');
    assert.equal(h.diagnostics.length, diagnosticsBeforeNewAttempt + 1, 'a new attempt should emit its own diagnostic');
  });

  test('ignores duplicate close/timeout races and stale events from a previous session', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const old = h.spawned[0];
    h.close(old, 1);
    await flush();
    assert.equal(h.spawned.length, 2);
    h.close(old, 1);
    old.stderr.emit('data', 'ERR Failed to dial a QUIC connection\n');
    assert.equal(h.spawned.length, 2);
    h.close(h.spawned[1], 1);
    await flush();
    await h.flow.start(3000);
    const before = h.state.length;
    h.close(old, 1);
    old.stderr.emit('data', 'ERR stale failure\n');
    assert.equal(h.state.length, before);
    assert.equal(h.flow.current.protocol, 'auto');
  });

  test('manual stop cancels timers and prevents any automatic protocol fallback', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    await h.flow.stop();
    h.line(child, 'stderr', 'ERR Failed to dial a QUIC connection');
    h.timers.advance(CLOUDFLARE_START_TIMEOUT_MS * 2);
    await flush();
    assert.deepEqual(h.spawned.map(p => p.protocol), ['auto']);
    assert.equal(h.state.at(-1).tunnel, 'Остановлен');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('treats configuration, missing executable, and origin errors distinctly without retrying', async () => {
    for (const [kind, trigger, expected] of [
      ['line', () => 'fatal error: removed GODEBUG "tlskyber" set to old value "0"', /конфигурации/],
      ['origin', () => 'Unable to reach the origin service: connection refused', /origin недоступен/],
      ['spawn', () => Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }), /не найден/]
    ]) {
      const h = makeFlowHarness();
      await h.flow.start(3000);
      if (kind === 'spawn') h.spawned[0].emit('error', trigger());
      else h.line(h.spawned[0], 'stderr', trigger());
      await flush();
      assert.deepEqual(h.spawned.map(p => p.protocol), ['auto'], kind);
      assert.equal(h.state.at(-1).tunnel, 'Ошибка подключения', kind);
      assert.match(h.logs.join('\n'), expected, kind);
    }
  });

  test('recovers from lost registration within a bounded window without clearing the server', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    h.line(child, 'stdout', 'INF | https://game.trycloudflare.com |');
    h.line(child, 'stderr', 'INF Registered tunnel connection connIndex=0');
    h.line(child, 'stderr', 'INF Unregistered tunnel connection connIndex=0');
    assert.equal(h.state.at(-1).tunnel, 'Переподключение…');
    assert.equal(h.state.at(-1).publicAddress, '');
    assert.equal(h.timers.activeCount(), 1);
    h.line(child, 'stderr', 'INF Registered tunnel connection connIndex=1');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.state.at(-1).publicAddress, 'https://game.trycloudflare.com');
    assert.equal(h.timers.activeCount(), 0);
    assert.equal(h.server, 'Запущен');
    assert.equal(h.spawned.length, 1);
  });

  test('fails after connection recovery window without restarting Cloudflare forever', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    h.line(child, 'stdout', 'INF | https://game.trycloudflare.com |');
    h.line(child, 'stderr', 'INF Registered tunnel connection connIndex=0');
    h.line(child, 'stderr', 'INF Unregistered tunnel connection connIndex=0');
    h.timers.advance(CLOUDFLARE_RECOVERY_TIMEOUT_MS);
    await flush();
    assert.equal(h.state.at(-1).tunnel, 'Ошибка подключения');
    assert.equal(h.state.at(-1).publicAddress, '');
    assert.equal(h.spawned.length, 1);
    assert.equal(h.stopped.length, 1);
  });
});

function makeFlowHarness() {
  class FakeChild extends EventEmitter {
    constructor(protocol, origin) {
      super();
      this.protocol = protocol;
      this.origin = origin;
      this.exitCode = null;
      this.stdout = new EventEmitter();
      this.stderr = new EventEmitter();
    }
  }
  const timers = new Map();
  let nextTimer = 0;
  let now = 0;
  const clock = {
    setTimeout(fn, ms) {
      const id = ++nextTimer;
      timers.set(id, { fn, due: now + ms });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
    activeCount() { return timers.size; },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers.entries()].sort((a, b) => a[1].due - b[1].due)[0];
        if (!next || next[1].due > target) break;
        now = next[1].due;
        timers.delete(next[0]);
        next[1].fn();
      }
      now = target;
    }
  };
  const harness = { timers: clock, spawned: [], stopped: [], state: [], diagnostics: [], logs: [], server: 'Запущен' };
  harness.flow = createTunnelFlow({
    ...clock,
    onState: state => harness.state.push(state),
    onLog: (line, source) => harness.logs.push(`[${source}] ${line}`),
    onDiagnostic: item => harness.diagnostics.push(item),
    onProtocol() {},
    spawnCloudflare(protocol, origin) {
      const child = new FakeChild(protocol, origin);
      harness.spawned.push(child);
      return child;
    },
    async stopProcess(child) {
      if (!harness.stopped.includes(child)) harness.stopped.push(child);
      if (child.exitCode === null) {
        child.exitCode = 0;
        child.emit('close', 0, null);
      }
    }
  });
  harness.line = (child, stream, line) => child[stream].emit('data', `${line}\r\n`);
  harness.close = (child, code) => {
    child.exitCode = code;
    child.emit('close', code, null);
  };
  return harness;
}

function flush() { return new Promise(resolve => setImmediate(resolve)); }
