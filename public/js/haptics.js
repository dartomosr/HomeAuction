export function triggerHaptic(type = 'light') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  try {
    if (type === 'light') navigator.vibrate(8);
    else if (type === 'medium') navigator.vibrate(18);
    else if (type === 'success') navigator.vibrate([15, 40, 20]);
  } catch (_) {}
}
