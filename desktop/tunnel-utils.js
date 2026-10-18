function normalizeProtocol(value) {
  const protocol = String(value || 'auto').toLowerCase();
  return ['auto', 'quic', 'http2'].includes(protocol)
    ? { protocol, invalidValue: null }
    : { protocol: 'auto', invalidValue: value };
}

function createLineBuffer(onLine) {
  let pending = '';
  return {
    push(chunk) {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();
      for (const line of lines) onLine(line);
    },
    end() {
      if (pending) onLine(pending);
      pending = '';
    }
  };
}

function classifyTunnelLine(line) {
  const trimmedLine = line.trim();
  const quickTunnelLine = trimmedLine.match(
    /(?:^|\bINF\s+\|\s*)(https:\/\/[a-z0-9-]+\.trycloudflare\.com)(?=\s*\|\s*$|\s*$)/i
  );
  const quicBlocked =
    /allow outbound quic traffic on port 7844|failed to dial a quic connection|udp connectivity.*quic connection failed/i.test(line);
  const tcpBlocked =
    /allow outbound tcp on port 7844|tcp connectivity.*http\/2 connection (?:is blocked or unreachable|failed)/i.test(line);

  return {
    publicAddress: quickTunnelLine?.[1] || '',
    connected: /\bregistered tunnel connection\b|\bconnection registered\b/i.test(line),
    blockedProtocol: quicBlocked ? 'quic' : tcpBlocked ? 'http2' : '',
    originError: /unable to reach the origin service|originservice=/i.test(line),
    isError: /\b(ERR|ERROR|FATAL)\b/i.test(line)
  };
}

module.exports = { normalizeProtocol, createLineBuffer, classifyTunnelLine };
