import { store } from './store.js';
import { dom } from './dom.js';
import { THEME_WHEEL_PALETTES, SPIN_COMMENTS } from './constants.js';
import { initAudio, playTickSound, playEliminatedSound, playFxTone } from './audio.js';
import { renderMainArea } from './ui-render.js';

function showEliminationEffect(title, eliminatedId, slices, fxSeed) {
  store.wheelFx.cancel();
  store.activeElimination = null;
  if (dom.motionReduced.matches) return 'fold';
  const index = slices.findIndex(s => s.id === eliminatedId) >= 0
    ? slices.findIndex(s => s.id === eliminatedId)
    : slices.findIndex(s => s.title === title);
  if (index < 0) return 'fold';

  const list = store.effectsEnabled ? store.enabledEffects : [];
  const id = list.length ? list[(fxSeed >>> 0) % list.length] : 'fold';
  const geometry = getWheelGeometry();
  if (!geometry.width || !geometry.height) return 'fold';
  const spinSlices = slices.map(s => ({ ...s }));
  store.activeElimination = { index, slices: spinSlices };
  dom.wheelStage.classList.add('is-eliminating');
  dom.wheelStage.classList.remove('spin-finished');
  store.lastFxType = id;
  try {
    store.wheelFx.start({
      wheelCanvas: dom.wheelCanvas, geometry, index, slices: spinSlices, rotation: store.wheelRotation,
      kind: id, seed: fxSeed, duration: id === 'shot' ? 3100 : id === 'glass' ? 2900 : 2450,
      onComplete: () => {
        store.activeElimination = null;
        dom.wheelStage.classList.remove('is-eliminating');
        drawWheel();
        renderWheelLegend();
        if (store.autoSpinActive && store.appState?.me?.isHost && store.appState.phase === 'REVEAL' &&
            !store.appState.wheel.isSpinning && store.appState.items.filter(i => !i.eliminated).length > 1) {
          clearTimeout(store.autoSpinTimer);
          store.autoSpinTimer = setTimeout(() => {
            store.autoSpinTimer = null;
            if (store.autoSpinActive && !store.isAnimatingWheel && !store.activeElimination &&
                store.appState?.phase === 'REVEAL' && !store.appState.wheel.isSpinning) store.socket.emit('spin_wheel');
          }, 650);
        }
        if (store.appState) renderMainArea(store.appState);
      }
    });
    drawWheel();
    playFxTone(id);
  } catch (err) {
    console.error('Ошибка эффекта сектора', err);
    store.wheelFx.cancel();
    store.activeElimination = null;
    dom.wheelStage.classList.remove('is-eliminating');
    drawWheel();
    return 'fold';
  }
  return id;
}

function resetClientVisualState() {
  store.autoSpinActive = false;
  clearTimeout(store.autoSpinTimer);
  store.autoSpinTimer = null;
  if (store.activeSpinFrame !== null) cancelAnimationFrame(store.activeSpinFrame);
  store.activeSpinFrame = null;
  store.wheelFx.cancel();
  store.activeElimination = null;
  store.wheelRotation = 0;
  store.isAnimatingWheel = false;
  store.activeSpinSlices = null;
  document.body.classList.remove('is-wheel-phase');
  dom.wheelStage.classList.remove('is-spinning', 'spin-finished', 'is-eliminating');
  dom.particleCtx.clearRect(0, 0, dom.wheelParticles.width, dom.wheelParticles.height);
  dom.wheelStatusBox.textContent = 'Колесо готово к новому аукциону';
}

function getCurrentWheelSlices() {
  if (store.activeElimination) return store.activeElimination.slices;
  if (store.isAnimatingWheel && store.activeSpinSlices) {
    return store.activeSpinSlices;
  }
  if (!store.appState) return [];
  const alive = store.appState.items.filter((i) => !i.eliminated);
  if (alive.length === 0) return [];

  const invWeights = alive.map((it) => 1 / (it.effectivePoints || 0.5));
  const totalInv = invWeights.reduce((a, b) => a + b, 0);

  return alive.map((it, idx) => ({
    id: it.id,
    title: it.title,
    totalPoints: it.totalPoints,
    effectivePoints: it.effectivePoints,
    share: totalInv > 0 ? invWeights[idx] / totalInv : 1 / alive.length
  }));
}

function resizeWheelCanvas() {
  const rect = dom.wheelStage.getBoundingClientRect();
  const side = Math.round(Math.min(rect.width, rect.height || rect.width));
  if (side <= 0) return;
  if (store.activeElimination && store.wheelFx.active && Math.abs(store.wheelFx.active.width - side) > 1) {
    store.wheelFx.cancel();
    store.activeElimination = null;
    dom.wheelStage.classList.remove('is-eliminating');
  }
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const pixels = Math.round(side * ratio);
  if (dom.wheelCanvas.width !== pixels || dom.wheelCanvas.height !== pixels || store.wheelPixelRatio !== ratio) {
    dom.wheelCanvas.width = pixels;
    dom.wheelCanvas.height = pixels;
    store.wheelPixelRatio = ratio;
  }
  if (dom.wheelParticles.width !== pixels || dom.wheelParticles.height !== pixels) {
    dom.wheelParticles.width = pixels;
    dom.wheelParticles.height = pixels;
  }
  dom.wheelCtx.setTransform(store.wheelPixelRatio, 0, 0, store.wheelPixelRatio, 0, 0);
  dom.particleCtx.setTransform(store.wheelPixelRatio, 0, 0, store.wheelPixelRatio, 0, 0);
}

function getWheelGeometry() {
  const width = dom.wheelCanvas.width / store.wheelPixelRatio;
  const height = dom.wheelCanvas.height / store.wheelPixelRatio;
  const scale = Math.min(width, height) / 540;
  return {
    width,
    height,
    cx: width / 2,
    cy: height / 2,
    radius: Math.min(width, height) / 2 - 18 * scale,
    scale
  };
}

function fitWheelLines(text, maxWidth, maxLines, fontSize) {
  dom.wheelCtx.font = `800 ${fontSize}px ${store.wheelLabelFont}`;
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';

  for (const word of words) {
    const attempt = line ? `${line} ${word}` : word;
    if (dom.wheelCtx.measureText(attempt).width <= maxWidth) {
      line = attempt;
      continue;
    }
    if (line) { lines.push(line); line = ''; }
    for (const char of Array.from(word)) {
      if (dom.wheelCtx.measureText(line + char).width > maxWidth && line) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
  }
  if (line) lines.push(line);
  const complete = lines.length <= maxLines;
  if (!complete) {
    lines.length = maxLines;
    let end = Array.from(lines[maxLines - 1] || '');
    while (end.length && dom.wheelCtx.measureText(end.join('') + '…').width > maxWidth) end.pop();
    lines[maxLines - 1] = end.join('') + '…';
  }
  return { lines, complete };
}

function drawWheelLabel(slice, index, angle, midAngle, geometry) {
  const { radius, scale } = geometry;
  const radialWidth = radius - 78 * scale;
  const crossWidth = 2 * radius * 0.56 * Math.sin(Math.min(angle / 2, Math.PI / 2)) - 9 * scale;
  if (crossWidth < 10 * scale || radialWidth < 25) return;

  const minSize = crossWidth >= 38 * scale ? 15 : (crossWidth >= 22 * scale ? 13 : 11);
  const minFont = minSize * scale;
  let chosen = null;
  const label = `${slice.title} (${slice.totalPoints})`;
  for (let size = 20; size >= minSize; size--) {
    const fontSize = size * scale;
    const lineHeight = fontSize * 1.18;
    const maxLines = Math.min(3, Math.floor(crossWidth / lineHeight));
    if (maxLines < 1) continue;
    const fit = fitWheelLines(label, radialWidth, maxLines, fontSize);
    chosen = { ...fit, fontSize, lineHeight };
    if (fit.complete) break;
  }
  if (!chosen || chosen.fontSize < minFont - 0.01) return;

  if (!chosen.complete && crossWidth < 23 * scale) {
    chosen = { lines: [String(index + 1)], fontSize: 13 * scale, lineHeight: 15 * scale };
  }

  dom.wheelCtx.save();
  dom.wheelCtx.translate(geometry.cx, geometry.cy);
  dom.wheelCtx.rotate(midAngle);
  const reverse = Math.cos(midAngle) < 0;
  if (reverse) dom.wheelCtx.rotate(Math.PI);
  const x = (radius + 48 * scale) / 2 * (reverse ? -1 : 1);
  dom.wheelCtx.textAlign = 'center';
  dom.wheelCtx.textBaseline = 'middle';
  dom.wheelCtx.font = `800 ${chosen.fontSize}px ${store.wheelLabelFont}`;
  dom.wheelCtx.lineJoin = 'round';
  dom.wheelCtx.strokeStyle = 'rgba(14, 18, 24, 0.88)';
  dom.wheelCtx.lineWidth = Math.max(2.6 * scale, chosen.fontSize * 0.19);
  dom.wheelCtx.fillStyle = '#ffffff';
  chosen.lines.forEach((line, i) => {
    const y = (i - (chosen.lines.length - 1) / 2) * chosen.lineHeight;
    dom.wheelCtx.strokeText(line, x, y);
    dom.wheelCtx.fillText(line, x, y);
  });
  dom.wheelCtx.restore();
}

function renderWheelLegend(slices = getCurrentWheelSlices()) {
  dom.wheelLegend.replaceChildren();
  const palette = THEME_WHEEL_PALETTES[store.currentTheme] || THEME_WHEEL_PALETTES.anime;
  const fragment = document.createDocumentFragment();
  slices.forEach((slice, idx) => {
    const item = document.createElement('div');
    item.className = 'wheel-legend-item';
    item.setAttribute('role', 'listitem');
    const swatch = document.createElement('span');
    swatch.className = 'wheel-legend-swatch';
    swatch.style.backgroundColor = palette[idx % palette.length];
    const content = document.createElement('div');
    content.className = 'wheel-legend-text';
    const name = document.createElement('div');
    name.className = 'wheel-legend-name';
    name.textContent = `${idx + 1}. ${slice.title}`;
    const stats = document.createElement('div');
    stats.className = 'wheel-legend-stats';
    stats.textContent = `${slice.totalPoints} очк. · ${(slice.share * 100).toFixed(1)}% сектора вылета`;
    content.append(name, stats);
    item.append(swatch, content);
    fragment.appendChild(item);
  });
  dom.wheelLegend.appendChild(fragment);
}

function drawWheel() {
  resizeWheelCanvas();
  const geometry = getWheelGeometry();
  const { width, height, cx, cy, radius, scale } = geometry;
  dom.wheelCtx.clearRect(0, 0, width, height);

  const slices = getCurrentWheelSlices();
  if (slices.length === 0) return;
  const palette = THEME_WHEEL_PALETTES[store.currentTheme] || THEME_WHEEL_PALETTES.anime;
  let currentAngle = store.wheelRotation;

  slices.forEach((slice, index) => {
    const sliceAngle = slice.share * Math.PI * 2;
    const endAngle = currentAngle + sliceAngle;
    if (store.activeElimination && store.activeElimination.index === index) {
      currentAngle = endAngle;
      return;
    }
    dom.wheelCtx.beginPath();
    dom.wheelCtx.moveTo(cx, cy);
    dom.wheelCtx.arc(cx, cy, radius, currentAngle, endAngle);
    dom.wheelCtx.closePath();
    dom.wheelCtx.fillStyle = palette[index % palette.length];
    dom.wheelCtx.fill();
    dom.wheelCtx.lineWidth = 2 * scale;
    dom.wheelCtx.strokeStyle = 'rgba(14, 18, 24, 0.88)';
    dom.wheelCtx.stroke();

    drawWheelLabel(slice, index, sliceAngle, currentAngle + sliceAngle / 2, geometry);
    currentAngle = endAngle;
  });

  dom.wheelCtx.beginPath();
  dom.wheelCtx.arc(cx, cy, radius, 0, Math.PI * 2);
  dom.wheelCtx.lineWidth = 5 * scale;
  dom.wheelCtx.strokeStyle = '#15191e';
  dom.wheelCtx.stroke();

  dom.wheelCtx.beginPath();
  dom.wheelCtx.arc(cx, cy, 28 * scale, 0, Math.PI * 2);
  dom.wheelCtx.fillStyle = '#222831';
  dom.wheelCtx.fill();
  dom.wheelCtx.lineWidth = 3 * scale;
  dom.wheelCtx.strokeStyle = '#ffffff';
  dom.wheelCtx.stroke();
}

// Показываем полные названия при наведении на сектор
dom.wheelCanvas.addEventListener('pointermove', (event) => {
  if (store.isAnimatingWheel || store.activeElimination) { dom.wheelTooltip.classList.add('hidden'); return; }
  const rect = dom.wheelCanvas.getBoundingClientRect();
  const geometry = getWheelGeometry();
  const x = (event.clientX - rect.left) * geometry.width / rect.width - geometry.cx;
  const y = (event.clientY - rect.top) * geometry.height / rect.height - geometry.cy;
  const r = Math.hypot(x, y);
  if (r > geometry.radius || r < 28 * geometry.scale) {
    dom.wheelTooltip.classList.add('hidden');
    return;
  }
  const fraction = (((Math.atan2(y, x) - store.wheelRotation) / (2 * Math.PI)) % 1 + 1) % 1;
  const slices = getCurrentWheelSlices();
  let cumulative = 0;
  const found = slices.find((slice) => { cumulative += slice.share; return fraction < cumulative; });
  if (!found) { dom.wheelTooltip.classList.add('hidden'); return; }
  const pointDetails = found.totalPoints < found.effectivePoints
    ? `${found.totalPoints} очк. (поддержка до ${found.effectivePoints})`
    : `${found.totalPoints} очк.`;
  dom.wheelTooltip.textContent = `${found.title} — ${pointDetails}`;
  dom.wheelTooltip.classList.remove('hidden');
  const posX = event.clientX - rect.left;
  const half = dom.wheelTooltip.offsetWidth / 2;
  const viewportLeft = 10 - rect.left + half;
  const viewportRight = window.innerWidth - 10 - rect.left - half;
  const safeLeft = Math.max(viewportLeft, Math.min(viewportRight, posX));
  dom.wheelTooltip.style.left = `${safeLeft}px`;
  dom.wheelTooltip.style.top = `${Math.max(42, event.clientY - rect.top)}px`;
});
dom.wheelCanvas.addEventListener('pointerleave', () => dom.wheelTooltip.classList.add('hidden'));
window.addEventListener('resize', () => dom.wheelTooltip.classList.add('hidden'));

if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(() => { resizeWheelCanvas(); if (!store.isAnimatingWheel && !store.activeElimination) drawWheel(); }).observe(dom.wheelStage);
} else {
  window.addEventListener('resize', drawWheel);
}
if (document.fonts) document.fonts.ready.then(drawWheel);

function drawSpinParticles(now, progress) {
  const { width, height, cx, cy, radius, scale } = getWheelGeometry();
  dom.particleCtx.clearRect(0, 0, width, height);
  if (dom.motionReduced.matches) return;
  const base = now / 1000;
  const opacity = Math.min(0.9, 0.2 + Math.sin(Math.PI * progress) * 0.55);
  const colors = getComputedStyle(document.documentElement);
  const main = colors.getPropertyValue('--accent-primary').trim() || '#d987a2';
  const alt = colors.getPropertyValue('--accent-secondary').trim() || '#83bbaa';
  for (let i = 0; i < 44; i++) {
    const a = (i / 44) * Math.PI * 2 + base * (i % 3 === 0 ? -1.2 : 0.9);
    const r = radius * (0.8 + Math.sin(i * 6.31 + base * 2) * 0.2);
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    const size = (i % 6 === 0 ? 3.7 : 1.9) * scale;
    dom.particleCtx.globalAlpha = opacity * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(base * 3 + i)));
    dom.particleCtx.fillStyle = i % 3 === 0 ? main : alt;
    dom.particleCtx.shadowColor = dom.particleCtx.fillStyle;
    dom.particleCtx.shadowBlur = 7 * scale;
    dom.particleCtx.beginPath();
    dom.particleCtx.arc(x, y, size, 0, Math.PI * 2);
    dom.particleCtx.fill();
  }
  dom.particleCtx.shadowBlur = 0;
  dom.particleCtx.globalAlpha = 1;
}

// Событие синхронного запуска колеса от сервера

export function handleWheelSpin({ slices, eliminatedId, eliminatedTitle, targetFraction, extraSpins, durationSec }) {
  initAudio();
  store.isAnimatingWheel = true;
  store.activeSpinSlices = slices;
  dom.wheelTooltip.classList.add('hidden');
  dom.wheelStage.classList.remove('spin-finished');
  dom.wheelStage.classList.add('is-spinning');
  renderWheelLegend(slices);
  dom.wheelStatusBox.textContent = SPIN_COMMENTS[Math.floor(Math.random() * SPIN_COMMENTS.length)];
  if (store.activeElimination) { store.wheelFx.cancel(); store.activeElimination = null; dom.wheelStage.classList.remove('is-eliminating'); }
  if (store.activeSpinFrame !== null) cancelAnimationFrame(store.activeSpinFrame);
  clearTimeout(store.autoSpinTimer);
  store.autoSpinTimer = null;

  const twoPi = Math.PI * 2;
  const startRotation = store.wheelRotation % twoPi;

  const desiredEndMod = ((1 - targetFraction) * twoPi + twoPi) % twoPi;
  let delta = desiredEndMod - startRotation;
  if (delta <= 0) delta += twoPi;

  const totalDelta = extraSpins * twoPi + delta;
  const durationMs = durationSec * 1000;
  const startTime = performance.now();

  const boundaries = [];
  let acc = 0;
  slices.forEach((s) => {
    boundaries.push(acc);
    acc += s.share;
  });

  function getSliceIndexAtPointer(rot) {
    const norm = ((twoPi - (rot % twoPi)) % twoPi) / twoPi;
    for (let i = boundaries.length - 1; i >= 0; i--) {
      if (norm >= boundaries[i]) return i;
    }
    return 0;
  }

  let lastSliceIdx = getSliceIndexAtPointer(startRotation);

  function easeSpin(t) {
    const slowdown = Math.min(0.35, 8000 / durationMs);
    const linearTime = 1 - slowdown;
    const linearDistance = 3 * linearTime / (3 * linearTime + slowdown);
    if (t < linearTime) return (t / linearTime) * linearDistance;
    const stopT = (t - linearTime) / slowdown;
    return linearDistance + (1 - linearDistance) * (1 - Math.pow(1 - stopT, 3));
  }
  let lastCanvasFrame = -Infinity;

  function animateFrame(now) {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / durationMs);
    if (durationMs > 30000 && now - lastCanvasFrame < 32 && progress < 1) {
      store.activeSpinFrame = requestAnimationFrame(animateFrame);
      return;
    }
    lastCanvasFrame = now;
    const eased = easeSpin(progress);

    store.wheelRotation = startRotation + totalDelta * eased;
    drawWheel();
    drawSpinParticles(now, progress);

    const currentSliceIdx = getSliceIndexAtPointer(store.wheelRotation);
    if (currentSliceIdx !== lastSliceIdx) {
      playTickSound();
      if (!dom.motionReduced.matches && dom.wheelPointer.animate) {
        dom.wheelPointer.animate([
          { transform: 'translateY(-50%) rotate(-9deg)' },
          { transform: 'translateY(-50%) rotate(3deg)', offset: 0.45 },
          { transform: 'translateY(-50%) rotate(0deg)' }
        ], { duration: 160, easing: 'ease-out' });
      }
      lastSliceIdx = currentSliceIdx;
    }

    if (progress < 1) {
      store.activeSpinFrame = requestAnimationFrame(animateFrame);
    } else {
      store.activeSpinFrame = null;
      dom.particleCtx.clearRect(0, 0, dom.wheelParticles.width, dom.wheelParticles.height);
      store.isAnimatingWheel = false;
      store.activeSpinSlices = null;
      dom.wheelStage.classList.remove('is-spinning');
      dom.wheelStage.classList.add('spin-finished');
      renderWheelLegend(slices);
      const seed = (Math.floor(targetFraction * 0x7fffffff) ^ (eliminatedId?.length || 13) * 2654435761) >>> 0;
      if (showEliminationEffect(eliminatedTitle, eliminatedId, slices, seed) === 'fold') playEliminatedSound();
      dom.wheelStatusBox.textContent = `❌ Выбывает вариант: «${eliminatedTitle}»!`;
    }
  }

  store.activeSpinFrame = requestAnimationFrame(animateFrame);
}


export { getCurrentWheelSlices, resizeWheelCanvas, getWheelGeometry, drawWheel, renderWheelLegend, drawSpinParticles, showEliminationEffect, resetClientVisualState };
