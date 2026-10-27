// Shared Canvas primitives. This module never imports player controls or sockets.
export const TAU = Math.PI * 2;
export function paintWheelSector(ctx, geometry, start, angle, color) {
  const { cx, cy, radius, scale } = geometry;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, start + angle);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2 * scale;
  ctx.strokeStyle = 'rgba(14, 18, 24, 0.88)';
  ctx.stroke();
}

export function spinRotation(spin, start, elapsed) {
  const desired = (1 - spin.targetFraction) * TAU;
  let delta = (desired - start % TAU + TAU) % TAU;
  if (delta <= 0) delta += TAU;
  const duration = spin.durationSec * 1000;
  const t = Math.max(0, Math.min(1, elapsed / duration));
  // Integrate a cosine velocity envelope: brief acceleration, long coast to rest.
  // Both joins have zero acceleration; elapsed time alone reconstructs reconnects.
  const acceleration = Math.min(.08, 650 / duration);
  const coast = 1 - acceleration;
  const u = (t - acceleration) / coast;
  const eased = t < acceleration
    ? t - acceleration / Math.PI * Math.sin(Math.PI * t / acceleration)
    : acceleration + coast * (u + Math.sin(Math.PI * u) / Math.PI);
  return start + (spin.extraSpins * TAU + delta) * eased;
}

export function pointerSector(slices, rotation) {
  const fraction = ((-rotation % TAU) + TAU) % TAU / TAU;
  let end = 0;
  return slices.findIndex(slice => { end += slice.share; return fraction < end; });
}

// Count crossings even when several narrow slices pass in one rendered frame.
export function crossedBoundaries(slices, from, to) {
  if (to <= from) return 0;
  let boundary = 0;
  let count = 0;
  for (const slice of slices) {
    count += Math.floor((to + boundary) / TAU) - Math.floor((from + boundary) / TAU);
    boundary += slice.share * TAU;
  }
  return count;
}

// Analytic damped spring: consistent resistance at 30, 60 and 120 fps.
export function stepPointerSpring({ angle, velocity }, seconds) {
  const dt = Math.max(0, Math.min(.1, seconds));
  const damping = 15;
  const frequency = Math.sqrt(900 - damping * damping);
  const decay = Math.exp(-damping * dt);
  const cosine = Math.cos(frequency * dt);
  const sine = Math.sin(frequency * dt);
  const b = (velocity + damping * angle) / frequency;
  return {
    angle: decay * (angle * cosine + b * sine),
    velocity: decay * ((b * frequency - damping * angle) * cosine - (angle * frequency + damping * b) * sine)
  };
}

// Broadcast-only finish; the player client's existing palette remains intact.
export function paintBroadcastSector(ctx, geometry, start, angle, color, focus = false) {
  if (angle <= 0) return;
  const { cx, cy, radius, scale } = geometry;
  ctx.save();
  ctx.beginPath();
  if (angle < TAU - 1e-6) ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, radius, start, start + angle); ctx.closePath();
  ctx.fillStyle = color; ctx.fill();
  const depth = ctx.createRadialGradient(cx, cy, radius * .12, cx, cy, radius);
  depth.addColorStop(0, '#ffffff20');
  depth.addColorStop(.55, '#ffffff00');
  depth.addColorStop(.89, '#ffffff08');
  depth.addColorStop(1, '#ffffff30');
  ctx.fillStyle = depth; ctx.fill();
  ctx.lineWidth = 1.2 * scale; ctx.strokeStyle = '#ffffff66'; ctx.stroke();
  // Fine edge lighting leaves the sector geometry legible at speed.
  const inset = Math.min(.003, angle / 4);
  ctx.beginPath(); ctx.arc(cx, cy, radius - 2 * scale, start + inset, start + angle - inset);
  ctx.strokeStyle = focus ? '#fff3d3eb' : `${color}bb`;
  ctx.lineWidth = (focus ? 4 : 1.5) * scale; ctx.stroke();
  if (focus) {
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, radius, start, start + angle); ctx.closePath();
    ctx.fillStyle = '#fff7df0b'; ctx.fill();
  }
  ctx.restore();
}
