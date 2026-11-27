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
  '16-showcase-full': 44.5,
  '17-bonus-lot': 50.1,
  '18-bank-grows': 47.8,
  '19-tactical-pause': 51.7,
  '20-last-ready': 52.2,
  '21-final-countdown': 50.4,
};
const poseFallbacks = {
  '16-showcase-full': '15-applause',
  '17-bonus-lot': '03-new-idea',
  '18-bank-grows': '04-approval',
  '19-tactical-pause': '12-thinking',
  '20-last-ready': '13-before-reveal',
  '21-final-countdown': '05-timer'
};
const host = document.querySelector('.show-host');
const image = host.querySelector('img');
const bubble = host.querySelector('p');
let lastPose;
let poseAnimation;
let finaleSince;
const missingPoses = new Set();

function choosePose(state, scene) {
  if (scene.finale) {
    finaleSince ??= performance.now();
    const elapsed = performance.now() - finaleSince;
    if (elapsed > 14000) return ['11-thanks', 'Спасибо за игру!'];
    if (elapsed > 6000) return ['15-applause', 'Аплодисменты участникам!'];
    return ['10-winner', 'Вот и выбор вечера!'];
  }
  finaleSince = undefined;
  if (scene.revealing) {
    if (scene.revealLead) return [scene.revealLead.pose, scene.revealLead.text];
    return ['06-reveal', 'Вскрываем конверты!'];
  }
  if (state && state.phase !== 'POOL') {
    if (scene.elimination) return ['08-elimination', ''];
    if (scene.spinning) return ['14-watch-wheel', ''];
    if (scene.duel) return ['09-duel', 'Остались двое!'];
    return ['07-suspense', 'Кому выпадет сектор?'];
  }
  return [scene.poolLine.pose, scene.poolLine.text];
}

function setPose(pose) {
  lastPose = pose;
  host.dataset.pose = pose;
  image.src = '/art/cardboard/' + pose + '.webp';
  host.style.setProperty('--face-x', faceXByPose[pose] + '%');
}

image.addEventListener('error', () => {
  const fallback = poseFallbacks[lastPose];
  if (!fallback) return;
  missingPoses.add(lastPose);
  setPose(fallback);
});

export function updateShowHost(state, scene) {
  const enabled = document.body.classList.contains('cardboard');
  host.hidden = !enabled;
  if (!enabled) return;
  const [requestedPose, line] = choosePose(state, scene);
  const pose = missingPoses.has(requestedPose) ? poseFallbacks[requestedPose] : requestedPose;
  host.dataset.side = scene.finale || scene.revealing || !state || state.phase === 'POOL' ? 'left' : 'right';
  host.style.setProperty('--silhouette-top', scene.revealing ? '12%' : host.dataset.side === 'right' ? '17%' : '4%');
  if (bubble.textContent !== line) bubble.textContent = line;
  bubble.hidden = !line;
  if (lastPose === pose) return;
  setPose(pose);
  poseAnimation?.cancel();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    poseAnimation = image.animate([{ opacity: .55, translate: '0 5px', rotate: '-1deg' }, { opacity: 1, translate: '0 0', rotate: '0deg' }], { duration: 280, easing: 'ease-out' });
  }
}
