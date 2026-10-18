const assert = require('node:assert/strict');
const { describe, test } = require('node:test');
const { classifyTunnelLine, createLineBuffer, normalizeProtocol } = require('../desktop/tunnel-utils');

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
});
