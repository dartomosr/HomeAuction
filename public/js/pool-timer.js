export function createPoolTimerDisplay(container) {
  const label = container.querySelector('[data-timer-label]');
  const clock = container.querySelector('[data-timer-clock]');
  let tick;

  return timer => {
    clearTimeout(tick);
    container.hidden = !timer;
    if (!timer) return;

    const running = timer.status === 'running';
    const expired = timer.status === 'expired';
    const deadline = performance.now() + timer.remainingMs;
    label.textContent = expired ? 'Время ставок вышло' : running ? 'До конца ставок' : 'Таймер на паузе';
    clock.hidden = expired;
    if (expired) return;

    const render = () => {
      const remainingMs = running ? Math.max(0, deadline - performance.now()) : timer.remainingMs;
      const seconds = Math.ceil(remainingMs / 1000);
      const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
      if (clock.textContent !== time) clock.textContent = time;
      if (running && seconds > 0) tick = setTimeout(render, remainingMs % 1000 || 1000);
    };
    render();
  };
}
