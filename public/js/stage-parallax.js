// Distance and velocity are measured in viewport heights and viewport heights/sec.
export const BACKGROUND_PERIOD = 1.6;

export function stepBackgroundParallax(state, angularVelocity, seconds) {
  const dt = Math.max(0, Math.min(.1, seconds));
  const target = Math.min(12, Math.abs(angularVelocity)) * .022;
  const damping = .32;
  const decay = Math.exp(-dt / damping);
  let velocity = target + (state.velocity - target) * decay;
  const offset = state.offset + target * dt + (state.velocity - target) * damping * (1 - decay);
  if (!target && velocity < .0001) velocity = 0;
  return { offset, velocity };
}

export function backgroundPhase(offset, depth = 1) {
  return ((offset * depth % BACKGROUND_PERIOD) + BACKGROUND_PERIOD) % BACKGROUND_PERIOD;
}
