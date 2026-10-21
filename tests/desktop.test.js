const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const {
  classifyTunnelLine,
  createLineBuffer,
  normalizeProtocol,
  shouldFallbackToHttp2,
  buildTunnelArgs,
  buildSshArgs,
  mergeGoDebug,
  parsePublicTunnelUrl,
  parseSshTunnelConfirmation,
  isRenderableSshLine,
  classifySshFailure,
  createTunnelFlow
} = require('../desktop/tunnel-utils');
const { EventEmitter } = require('node:events');

describe('desktop Cloudflare diagnostics', () => {
  test('accepts supported protocols and falls back to auto', () => {
    assert.deepEqual(normalizeProtocol('quic'), { protocol: 'quic', invalidValue: null });
    assert.deepEqual(normalizeProtocol('HTTP2'), { protocol: 'http2', invalidValue: null });
    assert.deepEqual(normalizeProtocol('invalid'), { protocol: 'auto', invalidValue: 'invalid' });
    assert.deepEqual(normalizeProtocol(undefined), { protocol: 'auto', invalidValue: null });
  });

  test('buffers complete log lines across data chunks', () => {
    const lines = [];
    const buffer = createLineBuffer((line) => lines.push(line));
    buffer.push('2025-01-01 INF Starting\n2025-01-01 INF Regis');
    buffer.push('tered tunnel connection\ntrailing');
    buffer.end();
    assert.deepEqual(lines, [
      '2025-01-01 INF Starting',
      '2025-01-01 INF Registered tunnel connection',
      'trailing'
    ]);
  });

  test('identifies a quick-tunnel address only in its announcement line', () => {
    assert.equal(
      classifyTunnelLine('2025-01-01T00:00:00Z INF | https://some-name.trycloudflare.com |').publicAddress,
      'https://some-name.trycloudflare.com'
    );
    assert.equal(
      classifyTunnelLine('request URL contains https://some-name.trycloudflare.com?retry=1').publicAddress,
      ''
    );
    assert.equal(
      classifyTunnelLine('https://some-name.trycloudflare.com').publicAddress,
      'https://some-name.trycloudflare.com'
    );
  });

  test('distinguishes QUIC and TCP port 7844 failures', () => {
    assert.equal(
      classifyTunnelLine('ERROR: Allow outbound QUIC traffic on port 7844 or use HTTP2').blockedProtocol,
      'quic'
    );
    assert.equal(
      classifyTunnelLine('ERROR: Allow outbound QUIC traffic on port 7844 or use HTTP2').isError,
      true
    );
    assert.equal(
      classifyTunnelLine('ERROR: Allow outbound TCP on port 7844').blockedProtocol,
      'http2'
    );
    assert.equal(
      classifyTunnelLine('INF | UDP Connectivity region2 FAIL QUIC connection failed |').blockedProtocol,
      'quic'
    );
    assert.equal(
      classifyTunnelLine('INF | TCP Connectivity region2 FAIL HTTP/2 connection is blocked or unreachable |').blockedProtocol,
      'http2'
    );
    assert.equal(classifyTunnelLine('ERROR: port 7844 unavailable').blockedProtocol, '');
    assert.equal(
      classifyTunnelLine('ERROR: Failed to dial a QUIC connection; Allow outbound TCP on port 7844').blockedProtocol,
      'quic'
    );
  });

  test('identifies origin failures separately from network blocks', () => {
    const event = classifyTunnelLine(
      'Unable to reach the origin service: originService=http://127.0.0.1:3000 EOF'
    );
    assert.equal(event.originError, true);
    assert.equal(event.blockedProtocol, '');
  });

  test('distinguishes address announcement from tunnel connection', () => {
    assert.equal(
      classifyTunnelLine('INF | https://some-name.trycloudflare.com |').connected,
      false
    );
    assert.equal(
      classifyTunnelLine('INF Registered tunnel connection connIndex=0').connected,
      true
    );
  });

  test('recognizes QUIC failures that should trigger the automatic fallback', () => {
    for (const line of [
      'ERR Failed to dial a QUIC connection: timeout',
      'ERR failed to accept QUIC stream: context deadline exceeded',
      'ERR timeout: no recent network activity'
    ]) {
      const event = classifyTunnelLine(line);
      assert.equal(event.quicFailure, true, line);
      assert.equal(shouldFallbackToHttp2(1, event), true, line);
      assert.equal(shouldFallbackToHttp2(2, event), false, line);
    }
    assert.equal(shouldFallbackToHttp2(1, classifyTunnelLine('ERR timeout: no recent network activity'), true), false);
    assert.equal(shouldFallbackToHttp2(1, classifyTunnelLine('INF | UDP Connectivity region2 FAIL QUIC connection failed |'), true), false);
  });

  test('builds the second attempt with forced HTTP/2 and IPv4', () => {
    assert.deepEqual(
      buildTunnelArgs('auto', 'http://127.0.0.1:3000'),
      ['tunnel', '--protocol', 'auto', '--url', 'http://127.0.0.1:3000']
    );
    assert.deepEqual(
      buildTunnelArgs('auto', 'http://127.0.0.1:3000', true),
      ['tunnel', '--protocol', 'http2', '--edge-ip-version', '4', '--url', 'http://127.0.0.1:3000']
    );
  });

  test('merges Go TLS compatibility flags without duplicate settings', () => {
    assert.equal(mergeGoDebug('http2client=0,tlsmlkem=1,tlskyber=0,custom=1'), 'http2client=0,custom=1,tlsmlkem=0');
    assert.equal(mergeGoDebug(''), 'tlsmlkem=0');
    assert.doesNotMatch(mergeGoDebug('tlskyber=0,other=1'), /tlskyber/i);
  });

  test('only accepts exact public tunnel URL hosts', () => {
    assert.equal(parsePublicTunnelUrl('https://name.lhr.life'), 'https://name.lhr.life');
    assert.equal(parsePublicTunnelUrl('https://name.localhost.run/'), 'https://name.localhost.run');
    for (const bad of ['https://localhost.run', 'https://evil.test', 'https://name.localhost.run.evil.test',
      'https://name.localhost.run/path', 'https://name.trycloudflare.com/?x=1']) {
      assert.equal(parsePublicTunnelUrl(bad), '', bad);
    }
  });

  test('accepts only a confirmed SSH tunnel address and verifies hostname agreement', () => {
    assert.equal(parseSshTunnelConfirmation('To set up and manage custom domains go to https://admin.localhost.run/'), '');
    assert.equal(parseSshTunnelConfirmation('be19a4d505dd47.lhr.life tunneled with tls termination, https://be19a4d505dd47.lhr.life'),
      'https://be19a4d505dd47.lhr.life');
    assert.equal(parseSshTunnelConfirmation('game.localhost.run tunneled with tls termination, https://game.localhost.run'),
      'https://game.localhost.run');
    assert.equal(parseSshTunnelConfirmation('admin.localhost.run tunneled with tls termination, https://admin.localhost.run'), '');
    assert.equal(parseSshTunnelConfirmation('www.localhost.run tunneled with tls termination, https://www.localhost.run'), '');
    assert.equal(parseSshTunnelConfirmation('game.lhr.life tunneled with tls termination, https://game.lhr.life.evil.test'), '');
    assert.equal(parseSshTunnelConfirmation('game.lhr.life tunneled with tls termination, https://other.lhr.life'), '');
  });

  test('buffers CRLF and split ANSI sequences, bounded, and rejects blank or QR-only UI lines', () => {
    const lines = [];
    const buffer = createLineBuffer(line => lines.push(line), 128);
    buffer.push('\u001b[31');
    buffer.push('m    \u001b[0m\r\n');
    buffer.push('╔══════╗\r\n');
    buffer.push('Connection refused after QR\r\n');
    buffer.end();
    assert.deepEqual(lines, ['    ', '╔══════╗', 'Connection refused after QR']);
    assert.equal(isRenderableSshLine(lines[0]), false);
    assert.equal(isRenderableSshLine(lines[1]), false);
    assert.equal(isRenderableSshLine(lines[2]), true);
    assert.equal(isRenderableSshLine('   '), false);
  });

  test('builds SSH fallback arguments with the loopback origin and explicit host-key storage', () => {
    assert.deepEqual(buildSshArgs(4321, 'C:\\app\\ssh\\known_hosts'), [
      '-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', '-o', 'ServerAliveInterval=30',
      '-o', 'ServerAliveCountMax=2', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=accept-new',
      '-o', 'UserKnownHostsFile=C:\\app\\ssh\\known_hosts', '-R', '80:127.0.0.1:4321', 'nokey@localhost.run'
    ]);
  });

  test('classifies missing SSH, changed host key, and unsupported options distinctly', () => {
    assert.match(classifySshFailure(Object.assign(new Error('spawn ssh ENOENT'), { code: 'ENOENT' })), /OpenSSH Client/);
    assert.match(classifySshFailure(null, 'REMOTE HOST IDENTIFICATION HAS CHANGED'), /Ключ .*изменился/);
    assert.match(classifySshFailure(null, 'unknown option -- Z'), /не поддерживает/);
  });

  test('serially falls back auto → HTTP/2 → SSH, stopping each process before the next', async () => {
    const h = makeFlowHarness();
    await h.flow.start(4321);
    assert.deepEqual(h.spawned.map(x => x.kind), ['auto']);
    h.spawned[0].stdout.emit('data', 'ERR Failed to dial a QUIC connection\n');
    await flush();
    assert.deepEqual(h.stopped, [h.spawned[0]]);
    assert.deepEqual(h.spawned.map(x => x.kind), ['auto', 'http2']);
    h.spawned[1].emit('close', 1, null);
    await flush();
    assert.deepEqual(h.stopped, [h.spawned[0], h.spawned[1]]);
    assert.deepEqual(h.spawned.map(x => x.kind), ['auto', 'http2', 'ssh']);
    h.spawned[2].stdout.emit('data', 'new-name.lhr.life tunneled with tls termination, https://new-name.lhr.life\n');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.state.at(-1).publicAddress, 'https://new-name.lhr.life');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('does not fall back on prechecks, duplicate edge failures, or post-registration edge errors', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].stderr.emit('data', 'INF UDP Connectivity region2 FAIL QUIC connection failed\n');
    assert.equal(h.spawned.length, 1);
    h.timers.advance(15000);
    await flush();
    assert.deepEqual(h.spawned.map(x => x.kind), ['auto', 'http2']);
    const child = h.spawned[1];
    const fail = 'ERR TLS handshake EOF connIndex=0 attempt=1';
    child.stderr.emit('data', `${fail}\n${fail}\n`);
    assert.equal(h.spawned.length, 2);
    child.stderr.emit('data', 'INF Registered tunnel connection connIndex=0\n');
    child.stderr.emit('data', 'ERR TLS handshake EOF connIndex=1 attempt=2\n');
    child.stderr.emit('data', 'INF | https://h2-name.trycloudflare.com |\n');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.spawned.length, 2);
  });

  test('requires both Cloudflare registration and URL and ignores stale events after manual stop', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    const child = h.spawned[0];
    child.stdout.emit('data', 'INF | https://early.trycloudflare.com |\n');
    assert.notEqual(h.state.at(-1).tunnel, 'Подключён');
    child.stdout.emit('data', 'INF Registered tunnel connection connIndex=0\n');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    await h.flow.stop();
    child.stderr.emit('data', 'ERR Failed to dial a QUIC connection\n');
    assert.equal(h.spawned.length, 1);
    assert.equal(h.state.at(-1).tunnel, 'Остановлен');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('falls back after three separately identified HTTP/2 edge connection failures', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    const child = h.spawned[1];
    child.stderr.emit('data', [0, 1, 2].map(index =>
      `ERR TLS handshake EOF connIndex=${index} attempt=1`).join('\n') + '\n');
    await flush();
    assert.deepEqual(h.spawned.map(process => process.kind), ['auto', 'http2', 'ssh']);
    assert.deepEqual(h.stopped, [h.spawned[0], h.spawned[1]]);
  });

  test('reports SSH timeout and process failures without restarting in a loop', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    h.spawned[1].emit('close', 1, null);
    await flush();
    assert.equal(h.spawned[2].kind, 'ssh');
    h.timers.advance(20000);
    await flush();
    assert.equal(h.state.at(-1).tunnel, 'Ошибка');
    assert.match(h.state.at(-1).tunnelDiagnostic, /localhost\.run не выдал/);
    assert.equal(h.spawned.length, 3);
  });

  test('ignores the localhost.run banner, keeps timer, and accepts the later lhr confirmation from chunked output', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    h.spawned[1].emit('close', 1, null);
    await flush();
    const ssh = h.spawned[2];
    assert.equal(h.state.at(-1).tunnelProvider, 'Резервный SSH-туннель');
    assert.notEqual(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.timers.activeCount(), 1);
    ssh.stdout.emit('data', '\u001b[32mTo set up and manage custom domains go to https://admin.');
    ssh.stdout.emit('data', 'localhost.run/\u001b[0m\r\n');
    assert.notEqual(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.timers.activeCount(), 1);
    ssh.stdout.emit('data', 'be19a4d505dd47.lhr.life tunneled with tls termination, https://be19');
    ssh.stdout.emit('data', 'a4d505dd47.lhr.life\r\n');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
    assert.equal(h.state.at(-1).publicAddress, 'https://be19a4d505dd47.lhr.life');
    assert.equal(h.timers.activeCount(), 0);
  });

  test('handles the complete banner and tunnel confirmation in one output chunk', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    h.spawned[1].emit('close', 1, null);
    await flush();
    h.spawned[2].stdout.emit('data', 'To set up and manage custom domains go to https://admin.localhost.run/\r\nbe19a4d505dd47.lhr.life tunneled with tls termination, https://be19a4d505dd47.lhr.life\r\n');
    assert.equal(h.state.at(-1).publicAddress, 'https://be19a4d505dd47.lhr.life');
    assert.equal(h.state.at(-1).tunnel, 'Подключён');
  });

  test('requires tunnel confirmation on localhost.run and keeps stdout and stderr buffers independent', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    h.spawned[1].emit('close', 1, null);
    await flush();
    const ssh = h.spawned[2];
    ssh.stdout.emit('data', 'https://fake.localhost.run');
    ssh.stderr.emit('data', ' tunneled with tls termination, https://fake.localhost.run\n');
    assert.notEqual(h.state.at(-1).tunnel, 'Подключён');
    ssh.stderr.emit('data', 'hello.localhost.run tunneled with tls termination, https://hello.localhost.run\n');
    assert.equal(h.state.at(-1).publicAddress, 'https://hello.localhost.run');
  });

  test('suppresses QR and empty SSH lines but retains ordinary output and later errors', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].emit('close', 1, null);
    await flush();
    h.spawned[1].emit('close', 1, null);
    await flush();
    const ssh = h.spawned[2];
    ssh.stdout.emit('data', '   \r\n╔══════╗\r\n║ █▀▄ ▌▐║\r\nConnected to localhost.run\r\n');
    ssh.stderr.emit('data', 'Connection reset by peer\r\n');
    assert.equal(h.logs.some(line => /^\s*$/.test(line)), false);
    assert.equal(h.logs.some(line => /╔══════╗|█▀▄/.test(line)), false);
    assert.equal(h.logs.some(line => /Connected to localhost\.run/.test(line)), true);
    assert.equal(h.logs.some(line => /Connection reset by peer/.test(line)), true);
  });

  test('treats fatal GODEBUG configuration as local startup failure without retrying Cloudflare', async () => {
    const h = makeFlowHarness();
    await h.flow.start(3000);
    h.spawned[0].stderr.emit('data', 'fatal error: removed GODEBUG "tlskyber" set to old value "0" in environment\n');
    await flush();
    assert.deepEqual(h.spawned.map(process => process.kind), ['auto']);
    assert.equal(h.state.at(-1).tunnel, 'Ошибка');
    assert.match(h.state.at(-1).tunnelDiagnostic, /GODEBUG/);
  });
});

function makeFlowHarness() {
  class FakeChild extends EventEmitter {
    constructor(kind) {
      super(); this.kind = kind; this.exitCode = null; this.stdout = new EventEmitter(); this.stderr = new EventEmitter();
    }
  }
  const timers = new Map(); let timerId = 0;
  const clock = {
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    activeCount() { return timers.size; },
    advance(ms) { for (const [id, timer] of [...timers]) if (timer.ms <= ms) { timers.delete(id); timer.fn(); } }
  };
  const harness = { timers: clock, spawned: [], stopped: [], state: [], logs: [] };
  harness.flow = createTunnelFlow({
    ...clock,
    onState: patch => harness.state.push(patch),
    onLog: line => harness.logs.push(line), onDiagnostic() {}, onProtocol() {},
    spawnCloudflare(kind) { const child = new FakeChild(kind); harness.spawned.push(child); return child; },
    async prepareSsh() { return { args: [] }; },
    spawnSsh() { const child = new FakeChild('ssh'); harness.spawned.push(child); return child; },
    async stopProcess(child) { harness.stopped.push(child); child.exitCode = 0; child.emit('close', 0, null); }
  });
  return harness;
}

function flush() { return new Promise(resolve => setImmediate(resolve)); }
