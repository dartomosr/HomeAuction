const faceXByPose = {
  '01-idle': 56.2,
  '02-welcome': 48.0,
  '03-new-idea': 59.9,
  '04-approval': 51.7,
  '05-timer': 52.9,
  '06-reveal': 68.1,
  '07-suspense': 45.4,
  '08-elimination': 51.4,
  '09-duel': 52.1,
  '10-winner': 58.2,
  '11-thanks': 53.4,
  '12-thinking': 56.0,
  '13-before-reveal': 52.5,
  '14-watch-wheel': 41.1,
  '15-applause': 52.8,
};
const host = document.querySelector('.show-host');
const image = host.querySelector('img');
const bubble = host.querySelector('p');
let lastPose;
let reaction;
let until = 0;
let finaleSince;

function choosePose(state, scene) {
  if (scene.finale) {
    finaleSince ??= performance.now();
    const elapsed = performance.now() - finaleSince;
    if (elapsed > 14000) return ['11-thanks', 'Спасибо за игру!'];
    if (elapsed > 6000) return ['15-applause', 'Аплодисменты участникам!'];
    return ['10-winner', 'Вот и выбор вечера!'];
  }
  finaleSince = undefined;
  if (scene.revealing) return ['06-reveal', 'Вскрываем конверты!'];
  if (state && state.phase !== 'POOL') {
    if (scene.elimination) return ['08-elimination', ''];
    if (scene.spinning) return ['14-watch-wheel', ''];
    if (scene.duel) return ['09-duel', 'Остались двое!'];
    return ['07-suspense', 'Кому выпадет сектор?'];
  }
  if (!state?.players.length) return ['02-welcome', 'Заходите по QR-коду!'];
  if (state.players.every(player => player.ready)) return ['13-before-reveal', 'Все готовы!'];
  if (performance.now() < until && reaction) return reaction;
  if (state.poolTimer?.status === 'running') return ['05-timer', 'Успейте сделать ставку!'];
  if (!state.items.length) return ['12-thinking', 'Что предложим на вечер?'];
  return ['01-idle', ''];
}

export function updateShowHost(state, scene) {
  const enabled = document.body.classList.contains('cardboard');
  host.hidden = !enabled;
  if (!enabled) return;
  if (scene.changes?.added.length) {
    reaction = ['03-new-idea', 'Есть новая идея!'];
    until = performance.now() + 3200;
  } else if (scene.changes?.ready.length) {
    reaction = ['04-approval', 'Ставки приняты!'];
    until = performance.now() + 2500;
  }
  const [pose, line] = choosePose(state, scene);
  host.dataset.side = scene.finale || scene.revealing || !state || state.phase === 'POOL' ? 'left' : 'right';
  if (lastPose === pose) return;
  lastPose = pose;
  host.dataset.pose = pose;
  image.src = '/art/cardboard/' + pose + '.webp';
  host.style.setProperty('--face-x', faceXByPose[pose] + '%');
  host.style.setProperty('--silhouette-top', scene.revealing ? '12%' : host.dataset.side === 'right' ? '17%' : '4%');
  bubble.textContent = line;
  bubble.hidden = !line;
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    image.animate([{ opacity: .55, translate: '0 5px', rotate: '-1deg' }, { opacity: 1, translate: '0 0', rotate: '0deg' }], { duration: 280, easing: 'ease-out' });
  }
}
