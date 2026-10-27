import { paintBroadcastSector, spinRotation, pointerSector, crossedBoundaries, stepPointerSpring, TAU } from './wheel-canvas.js';
import { stageWheelItems, riskLabel } from './stage-model.js';

const byId = id => document.getElementById(id);
const node = (tag, className, text) => {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
};

export class StageWheel {
  constructor({ sound, active, reduced }) {
    this.sound = sound;
    this.active = active;
    this.reduced = reduced;
    this.canvas = byId('stage-wheel');
    this.ctx = this.canvas.getContext('2d');
    this.fx = new window.WheelSectorEffects(byId('stage-wheel-fx'));
    this.rotation = 0;
    this.slices = [];
    this.frame = null;
    this.seen = new Set();
    this.pointer = { angle: 0, velocity: 0 };
    this.motions = new Map();
    this.flights = new Set();
    this.labels = new Map();
    this.meshLights = [...document.querySelectorAll('.mesh i')];
    this.presentation = { active: false, nextSpinAt: 0 };
    this.resize = new ResizeObserver(() => this.draw());
    this.resize.observe(byId('wheel-arena'));
  }

  motion(element, frames, options = {}) {
    this.motions.get(element)?.cancel();
    if (this.reduced() || !this.active()) return null;
    const animation = element.animate(frames, { duration: 650, easing: 'cubic-bezier(.16,1,.3,1)', ...options });
    this.motions.set(element, animation);
    animation.finished.catch(() => {}).finally(() => {
      if (this.motions.get(element) === animation) this.motions.delete(element);
    });
    return animation;
  }

  reactBackdrop(angularVelocity = 0) {
    const energy = this.reduced() || !this.active() ? 0 : Math.min(1, Math.abs(angularVelocity) / 12);
    const now = performance.now();
    // Background speed needs only 10 updates/sec; keep inherited styles local.
    if (energy && now - (this.backdropUpdatedAt || 0) < 100) return;
    const level = Math.round(energy * 20) / 20;
    if (level === this.backdropEnergy) return;
    this.backdropUpdatedAt = now;
    this.backdropEnergy = level;
    byId('wheel-arena').style.setProperty('--spin-energy', level);
    if (!this.backdropAnimations?.length || this.backdropAnimations.some(animation => animation.playState === 'idle')) {
      this.backdropAnimations = this.meshLights.flatMap(light => light.getAnimations())
        .filter(animation => ['silk-drift', 'stage-drift'].includes(animation.animationName));
    }
    for (const animation of this.backdropAnimations) animation.updatePlaybackRate(1 + level * 7);
  }

  impact(color = '#ceb2e9', winner = false) {
    byId('wheel-arena').style.setProperty('--arena-color', color);
    if (!winner) {
      byId('stage-flash').style.setProperty('--flash-color', color);
      this.motion(byId('stage-flash'), [{ opacity: 0 }, { opacity: .48, offset: .22 }, { opacity: 0 }], { duration: 260, easing: 'ease-out' });
    }
    this.motion(byId('arena-impact'), [
      { opacity: 0, transform: 'scale(.9)' },
      { opacity: winner ? .8 : .65, transform: 'scale(1)', offset: .18 },
      { opacity: 0, transform: 'scale(1.2)' }
    ], { duration: winner ? 1500 : 1050 });
  }

  clearMotion() {
    this.reactBackdrop();
    for (const animation of this.motions.values()) animation.cancel();
    this.motions.clear();
    for (const ghost of this.flights) { ghost.getAnimations().forEach(animation => animation.cancel()); ghost.remove(); }
    this.flights.clear();
    cancelAnimationFrame(this.pointerFrame);
    this.pointer = { angle: 0, velocity: 0 };
    byId('pointer-blade').removeAttribute('transform');
  }

  setPresentation(data) {
    this.presentation = { ...data, nextSpinAt: data.nextSpinAt ? performance.now() + data.nextSpinAt - data.serverNow : 0 };
    this.countdownDuration = Math.max(1, this.presentation.nextSpinAt - performance.now());
    this.lastSecond = null;
    this.tickCountdown();
  }

  tickCountdown() {
    cancelAnimationFrame(this.countdownFrame);
    const left = Math.max(0, (this.presentation.nextSpinAt || 0) - performance.now());
    const ring = byId('auto-countdown');
    ring.hidden = !this.presentation.active || !left || Boolean(this.spin) || this.state?.phase !== 'REVEAL';
    ring.style.setProperty('--remaining', left / (this.countdownDuration || 1));
    const second = Math.ceil(left / 1000);
    if (this.lastSecond !== second) {
      byId('countdown-value').textContent = String(second);
      if (!ring.hidden) this.motion(byId('countdown-value'), [
        { transform: 'translateX(-50%) scale(1.16)', opacity: .6 },
        { transform: 'translateX(-50%) scale(1)', opacity: 1 }
      ], { duration: 350 });
    }
    if (!ring.hidden && this.active()) {
      if (this.lastSecond !== second) { this.lastSecond = second; this.sound.play('countdown'); }
    }
    if (left > 0) this.countdownFrame = requestAnimationFrame(() => this.tickCountdown());
  }

  update(state, { silent = false } = {}) {
    const previous = this.state;
    this.state = state;
    this.silentUpdate = silent;
    if (state.phase === 'POOL') { this.reset(); return; }
    const history = state.wheel?.history || [];
    if (!previous || silent) history.forEach(item => this.seen.add(item.id));
    // The completion snapshot is authoritative for a missed event or reconnect.
    if (!this.spin && !this.elimination) {
      this.focusId = null;
      cancelAnimationFrame(this.settleFrame);
      this.retiringId = null;
      const fresh = history.find(item => !this.seen.has(item.id));
      if (fresh && this.active() && !silent) this.eliminate(fresh, this.slices);
      else this.slices = stageWheelItems(state);
    }
    this.renderLists();
    this.draw();
    if (state.wheel?.spin) this.start(state.wheel.spin, silent);
    this.silentUpdate = false;
  }

  renderLists() {
    if (!this.state) return;
    const alive = stageWheelItems(this.state);
    const total = this.state.items.filter(item => !item.droppedZero).length;
    const winner = this.state.wheel?.winner;
    const history = this.state.wheel?.history || [];
    const title = this.elimination ? 'ИТОГ РАУНДА'
      : winner ? 'ПОБЕДИТЕЛЬ ОПРЕДЕЛЁН' : alive.length === 2 ? 'ФИНАЛЬНАЯ ДУЭЛЬ' : `В ИГРЕ: ${alive.length} ИЗ ${total}`;
    if (!document.body.classList.contains('reveal-mode') && byId('round-title').textContent !== title) {
      byId('round-title').textContent = title;
      this.motion(byId('round-title'), [{ opacity: .2, transform: 'translateY(9px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 580 });
    }
    const round = history.length + (this.elimination && history.some(item => item.id === this.elimination.id) ? 0 : 1);
    byId('round-kicker').textContent = winner ? 'ФИНАЛ ВЕЧЕРА' : `РАУНД ${String(Math.max(1, round)).padStart(2, '0')} / КОЛЕСО НА ВЫБЫВАНИЕ`;
    byId('round-progress').style.setProperty('--alive-ratio', `${total ? alive.length / total * 100 : 0}%`);
    byId('contender-count').textContent = String(alive.length).padStart(2, '0');
    byId('history-count').textContent = String(history.length).padStart(2, '0');
    document.body.classList.toggle('final-duel', alive.length === 2 && !winner);
    if (alive.length === 2) {
      document.body.style.setProperty('--duel-one', alive[0].color);
      document.body.style.setProperty('--duel-two', alive[1].color);
    }
    const signature = JSON.stringify([alive, history, winner?.id]);
    if (signature !== this.listSignature) {
      this.listSignature = signature;
      const list = byId('contenders');
      const historyNode = byId('eliminated-lots');
      const old = new Map([...list.children].map(card => [card.dataset.id, { card: card.cloneNode(true), rect: card.getBoundingClientRect() }]));
      list.replaceChildren(...[...alive].sort((a, b) => b.totalPoints - a.totalPoints).map(item => this.card(item)));
      historyNode.replaceChildren(...history.map((item, i) => {
        const card = this.card(item, true);
        card.prepend(node('span', 'history-order', `ВЫЛЕТ / ${String(i + 1).padStart(2, '0')}`));
        return card;
      }));
      if (!history.length) historyNode.append(node('p', 'empty-history', `РАУНД ${String(Math.max(1, round)).padStart(2, '0')}`));
      for (const card of historyNode.children) {
        const source = old.get(card.dataset.id);
        if (!source || this.silentUpdate || this.reduced() || !this.active()) continue;
        // A fixed ghost escapes the scroll masks; real cards keep their layout.
        const last = card.getBoundingClientRect();
        const first = source.rect;
        const visible = list.getBoundingClientRect();
        if (first.bottom < visible.top || first.top > visible.bottom) continue;
        const ghost = source.card;
        ghost.classList.add('flying-lot');
        Object.assign(ghost.style, { left: `${first.left}px`, top: `${first.top}px`, width: `${first.width}px`, height: `${first.height}px` });
        document.body.append(ghost); this.flights.add(ghost);
        const flight = this.motion(ghost, [
          { transform: 'translate(0,0) scale(1)', opacity: .85 },
          { transform: `translate(${(last.left - first.left) * .5}px, ${last.top - first.top - 35}px) scale(.86)`, opacity: .6, offset: .5 },
          { transform: `translate(${last.left - first.left}px, ${last.top - first.top}px) scale(.92)`, opacity: 0 }
        ], { duration: 850 });
        flight?.finished.catch(() => {}).finally(() => { ghost.remove(); this.flights.delete(ghost); });
        this.motion(card, [{ opacity: 0, transform: 'translateX(-12px)' }, { opacity: 1, transform: 'translateX(0)' }], { duration: 650, delay: 260, fill: 'backwards' });
      }
    }
    const showWinner = Boolean(winner) && !this.elimination && !this.spin;
    const freshWinner = showWinner && byId('winner-panel').hidden;
    byId('winner-panel').hidden = !showWinner;
    byId('winner-name').textContent = winner?.title || '';
    document.body.classList.toggle('winner-celebration', showWinner);
    if (freshWinner && !this.silentUpdate) {
      this.impact('#e8c48a', true);
      this.motion(byId('winner-panel'), [
        { opacity: 0, transform: 'translateY(calc(-50% + 24px)) scale(.88)', filter: 'blur(8px)' },
        { opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'blur(0)' }
      ], { duration: 1000, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    if (!this.spin) byId('arena-cue').textContent = showWinner ? 'ЭТОТ ВЕЧЕР ПОЛУЧИЛ СВОЙ ВЫБОР' : this.elimination ? 'ОДНИМ ПРЕТЕНДЕНТОМ МЕНЬШЕ' : 'ВСЁ РЕШАЕТ СЛЕДУЮЩИЙ ОБОРОТ';
  }

  card(item, eliminated = false) {
    const champion = this.state.wheel?.winner?.id === item.id;
    const card = node('article', `wheel-lot glass${eliminated ? ' departed' : ''}${champion ? ' champion' : ''}`);
    card.dataset.id = item.id;
    const color = stageWheelItems({ items: this.state.items.map(i => ({ ...i, eliminated: false, droppedZero: false })) }).find(i => i.id === item.id)?.color;
    card.style.setProperty('--lot-color', color || '#a998ef');
    const stats = node('div', 'lot-stat');
    const points = node('span', 'lot-points', String(item.totalPoints));
    points.append(node('small', '', ' очк.'));
    const risk = node('span', 'lot-risk', champion ? 'Победитель' : 'риск ');
    if (!champion) risk.append(node('b', '', riskLabel(item.roundElimShare)));
    stats.append(points, risk);
    card.append(node('h3', '', item.title), stats);
    const investors = node('div', 'investor-chips');
    const contributors = [...(item.contributors || [])].sort((a, b) => b.points - a.points);
    contributors.slice(0, 3).forEach(person => {
      const chip = node('span', '', `${Array.from(person.name)[0] || '?'}:`);
      chip.append(node('b', '', String(person.points)));
      chip.title = `${person.name}: ${person.points}`;
      investors.append(chip);
    });
    if (contributors.length > 3) investors.append(node('span', '', `+${contributors.length - 3}`));
    card.append(investors);
    return card;
  }

  start(data, silent = false) {
    if (!this.state || this.state.phase === 'POOL' || this.spin?.startedAt === data.startedAt || this.lastSpin === data.startedAt) return;
    this.finishElimination();
    cancelAnimationFrame(this.settleFrame);
    this.retiringId = null;
    cancelAnimationFrame(this.frame);
    this.lastSpin = data.startedAt;
    this.spin = data;
    cancelAnimationFrame(this.pointerFrame);
    const colors = new Map(stageWheelItems(this.state).map(item => [item.id, item.color]));
    this.slices = data.slices.map(item => ({ ...item, color: colors.get(item.id) || '#a998ef' }));
    this.spinStart = this.rotation % TAU;
    this.spinBegan = performance.now() - Math.max(0, Date.now() - data.startedAt);
    this.silentSpin = silent && performance.now() - this.spinBegan >= data.durationSec * 1000;
    this.rotation = spinRotation(data, this.spinStart, performance.now() - this.spinBegan);
    this.lastIndex = pointerSector(this.slices, this.rotation);
    this.lastFrameTime = performance.now();
    this.focusId = null;
    byId('arena-cue').textContent = this.slices.length === 2 ? 'ДВА ВАРИАНТА. ОДИН ПОБЕДИТЕЛЬ.' : 'КОЛЕСО В ДВИЖЕНИИ';
    document.body.classList.add('wheel-spinning');
    this.motion(byId('wheel-hub'), [
      { transform: 'translate(-50%,-50%) scale(.94)' },
      { transform: 'translate(-50%,-50%) scale(1)' }
    ], { duration: 700, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    byId('winner-panel').hidden = true;
    this.tickCountdown();
    const frame = now => {
      if (!this.spin) return;
      const elapsed = now - this.spinBegan;
      const dt = Math.max(.001, (now - this.lastFrameTime) / 1000);
      this.lastFrameTime = now;
      const rotation = spinRotation(data, this.spinStart, elapsed);
      const index = pointerSector(this.slices, rotation);
      const speed = Math.abs(rotation - this.rotation) / dt;
      this.reactBackdrop(speed);
      const crossings = crossedBoundaries(this.slices, this.rotation, rotation);
      this.rotation = rotation;
      if (crossings > 0 && this.active() && !this.silentSpin) {
        this.sound.tick(Math.min(1, speed / 12), this.slices.length === 2);
        if (!this.reduced()) {
          this.pointer.velocity -= (45 + Math.min(180, speed * 18)) * Math.min(2, crossings);
          this.pointer.velocity = Math.max(-400, this.pointer.velocity);
        }
      }
      this.updatePointer(dt);
      const settling = elapsed / (data.durationSec * 1000) > .72;
      document.body.classList.toggle('wheel-settling', settling);
      if (settling) byId('arena-cue').textContent = this.slices.length === 2 ? 'ПОСЛЕДНИЕ ОБОРОТЫ ФИНАЛА' : 'КАЖДАЯ ЗАСЕЧКА МЕНЯЕТ ИСХОД';
      const focusId = settling && speed < 4 ? this.slices[index]?.id : null;
      if (this.focusId !== focusId) {
        this.focusId = focusId;
        for (const card of byId('contenders').children) card.classList.toggle('in-focus', card.dataset.id === focusId);
      }
      this.lastIndex = index;
      this.draw();
      if (elapsed < data.durationSec * 1000) this.frame = requestAnimationFrame(frame);
      else {
        this.spin = null;
        this.reactBackdrop();
        document.body.classList.remove('wheel-spinning', 'wheel-settling');
        this.settlePointer();
        const item = this.state.items.find(item => item.id === data.eliminatedId);
        const slice = data.slices.find(item => item.id === data.eliminatedId);
        if (item && !this.silentSpin && this.active()) this.eliminate({ ...item, roundElimShare: slice.share * 100 }, this.slices);
        else { this.slices = stageWheelItems(this.state); this.draw(); }
        this.renderLists();
      }
    };
    this.frame = requestAnimationFrame(frame);
  }

  updatePointer(dt) {
    if (this.reduced() || !this.active()) this.pointer = { angle: 0, velocity: 0 };
    else this.pointer = stepPointerSpring(this.pointer, dt);
    byId('pointer-blade').setAttribute('transform', `rotate(${this.pointer.angle.toFixed(3)} 51 24)`);
  }

  settlePointer() {
    let before = performance.now();
    const frame = now => {
      this.updatePointer((now - before) / 1000); before = now;
      if (Math.abs(this.pointer.angle) + Math.abs(this.pointer.velocity) > .03) this.pointerFrame = requestAnimationFrame(frame);
      else byId('pointer-blade').removeAttribute('transform');
    };
    this.pointerFrame = requestAnimationFrame(frame);
  }

  eliminate(item, slices) {
    if (this.seen.has(item.id)) return;
    this.seen.add(item.id);
    this.elimination = item;
    this.slices = slices;
    const banner = byId('elimination-banner');
    const risk = node('p', 'elimination-risk', 'Риск выбывания');
    risk.append(node('strong', '', riskLabel(item.roundElimShare)));
    const burned = node('div', 'burned-points');
    burned.append(node('span', 'burned-label', 'Сгоревшие очки'));
    for (const person of item.contributors || []) {
      const chip = node('span', 'burned-chip', person.name);
      chip.append(node('b', '', `−${person.points}`)); burned.append(chip);
    }
    if (!item.contributors?.length) burned.append(node('span', 'burned-chip', 'Нет вложений'));
    banner.replaceChildren(node('span', 'eyebrow', 'ВЫБЫВАЕТ'), node('h2', '', item.title), risk, burned);
    banner.hidden = false;
    this.motion(banner, [
      { opacity: 0, transform: 'translateY(calc(-50% + 16px)) scale(.84)', filter: 'blur(7px)' },
      { opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'blur(0)' }
    ], { duration: 430, easing: 'cubic-bezier(.34,1.56,.64,1)' });
    this.impact(slices.find(slice => slice.id === item.id)?.color);
    this.sound.play('elimination');
    const index = slices.findIndex(slice => slice.id === item.id);
    if (index >= 0 && !this.reduced() && this.active() && this.geometry?.width) {
      this.fx.start({ wheelCanvas: this.canvas, geometry: this.geometry, index, slices, rotation: this.rotation, kind: 'glass', duration: 1800 });
    }
    this.draw();
    this.bannerExitTimer = setTimeout(() => {
      this.motion(banner, [
        { opacity: 1, transform: 'translateY(-50%) scale(1)', filter: 'blur(0)' },
        { opacity: 0, transform: 'translateY(calc(-50% - 12px)) scale(1.025)', filter: 'blur(5px)' }
      ], { duration: 300, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    }, 1500);
    this.bannerTimer = setTimeout(() => this.finishElimination(), 1800);
  }

  finishElimination() {
    clearTimeout(this.bannerTimer);
    clearTimeout(this.bannerExitTimer);
    this.fx.cancel();
    const departed = this.elimination?.id;
    this.elimination = null;
    this.focusId = null;
    for (const card of byId('contenders').children) card.classList.remove('in-focus');
    byId('elimination-banner').hidden = true;
    byId('elimination-banner').getAnimations().forEach(animation => animation.cancel());
    if (this.state) {
      const target = stageWheelItems(this.state);
      if (departed && this.state.phase === 'REVEAL' && this.active() && !this.reduced()) this.settleSectors(target, departed);
      else this.slices = target;
      this.renderLists(); this.draw();
    }
  }

  settleSectors(target, departed) {
    cancelAnimationFrame(this.settleFrame);
    const from = this.slices.map(slice => ({ ...slice }));
    const targets = new Map(target.map(slice => [slice.id, slice.share]));
    this.retiringId = departed;
    const began = performance.now();
    const frame = now => {
      const t = Math.min(1, (now - began) / 650);
      const ease = 1 - (1 - t) ** 4;
      this.slices = from.map(slice => ({ ...slice, share: slice.share + ((targets.get(slice.id) || 0) - slice.share) * ease }));
      this.draw();
      if (t < 1) this.settleFrame = requestAnimationFrame(frame);
      else { this.retiringId = null; this.slices = target; this.draw(); }
    };
    this.settleFrame = requestAnimationFrame(frame);
  }

  browseLists(now) {
    if (!this.active() || this.spin || this.elimination || this.state?.phase === 'POOL') { this.nextBrowse = now + 8000; return; }
    if (!this.nextBrowse) this.nextBrowse = now + 8000;
    if (now < this.nextBrowse) return;
    this.nextBrowse = now + 8000;
    const list = byId('contenders');
    if (list.matches(':hover') || list.scrollHeight <= list.clientHeight + 8) return;
    const bottom = list.scrollHeight - list.clientHeight;
    list.scrollTo({ top: list.scrollTop >= bottom - 8 ? 0 : Math.min(bottom, list.scrollTop + list.clientHeight * .72), behavior: this.reduced() ? 'instant' : 'smooth' });
  }

  paintLabel(ctx, slice, angle, side) {
    const sweep = slice.share * TAU;
    if (sweep <= .10) return;
    const middle = angle + sweep / 2;
    const reverse = Math.cos(middle) < 0;
    ctx.save(); ctx.translate(side / 2, side / 2); ctx.rotate(middle + (reverse ? Math.PI : 0));
    ctx.textAlign = reverse ? 'left' : 'right'; ctx.textBaseline = 'middle';
    const fontSize = Math.max(9, side * (this.slices.length <= 4 ? .034 : .027));
    ctx.font = `700 ${fontSize}px "Segoe UI", sans-serif`;
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#241158aa'; ctx.shadowBlur = 3; ctx.shadowOffsetY = 1;
    const key = `${side}:${slice.id}:${slice.title}:${fontSize}`;
    if (!this.labels.has(key)) {
      let label = slice.title;
      while (ctx.measureText(label).width > side * .30 && label.length > 1) label = label.slice(0, -1);
      this.labels.set(key, label === slice.title ? label : `${label.slice(0, -1)}…`);
    }
    ctx.fillText(this.labels.get(key), side * .425 * (reverse ? -1 : 1), 0);
    ctx.restore();
  }

  draw() {
    // Layout dimensions are stable while the arena itself scales on entry.
    const side = byId('wheel-arena').clientWidth;
    if (!side) return;
    const ratio = Math.min(2, devicePixelRatio || 1);
    if (this.canvas.width !== Math.round(side * ratio)) {
      this.canvas.width = this.canvas.height = Math.round(side * ratio);
      if (this.fx.active) this.fx.cancel();
    }
    const ctx = this.ctx;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, side, side);
    this.geometry = { width: side, height: side, cx: side / 2, cy: side / 2, radius: side * .47, scale: side / 540 };
    const missingId = this.elimination?.id || this.retiringId;
    const textureKey = JSON.stringify([side, ratio, this.slices.map(slice => [slice.id, slice.share, slice.color, slice.title]), missingId]);
    if (textureKey !== this.textureKey) {
      this.textureKey = textureKey;
      this.texture ||= document.createElement('canvas');
      if (this.texture.width !== this.canvas.width) this.texture.width = this.texture.height = this.canvas.width;
      const texture = this.texture.getContext('2d');
      texture.setTransform(ratio, 0, 0, ratio, 0, 0);
      texture.clearRect(0, 0, side, side);
      let angle = 0;
      for (const slice of this.slices) {
        if (slice.id !== missingId) {
          paintBroadcastSector(texture, this.geometry, angle, slice.share * TAU, slice.color);
          this.paintLabel(texture, slice, angle, side);
        }
        angle += slice.share * TAU;
      }
    }
    ctx.save(); ctx.translate(side / 2, side / 2); ctx.rotate(this.rotation);
    ctx.drawImage(this.texture, -side / 2, -side / 2, side, side); ctx.restore();
    let angle = this.rotation;
    for (const slice of this.slices) {
      const sweep = slice.share * TAU;
      if (slice.id === this.focusId && slice.id !== missingId) {
        ctx.beginPath(); ctx.moveTo(side / 2, side / 2);
        ctx.arc(side / 2, side / 2, side * .47, angle, angle + sweep); ctx.closePath();
        ctx.fillStyle = '#ffffff12'; ctx.fill();
        ctx.strokeStyle = '#ffffffbb'; ctx.lineWidth = 2; ctx.stroke();
      }
      angle += sweep;
    }
    const color = this.slices[Math.max(0, pointerSector(this.slices, this.rotation))]?.color || '#a998ef';
    if (color !== this.hubColor) {
      this.hubColor = color;
      byId('wheel-hub').style.setProperty('--hub-color', color);
    }
    ctx.beginPath(); ctx.arc(side / 2, side / 2, side * .47, 0, TAU);
    ctx.strokeStyle = '#d5cfed35'; ctx.lineWidth = side * .002; ctx.stroke();

  }

  reset() {
    this.clearMotion();
    cancelAnimationFrame(this.settleFrame);
    this.retiringId = null;
    this.nextBrowse = 0;
    this.listSignature = null;
    this.focusId = null;
    this.labels.clear();
    cancelAnimationFrame(this.frame);
    cancelAnimationFrame(this.countdownFrame);
    this.spin = null;
    this.lastSpin = null;
    this.seen.clear();
    this.rotation = 0;
    this.finishElimination();
    document.body.classList.remove('wheel-spinning', 'wheel-settling', 'final-duel', 'winner-celebration');
    this.setPresentation({ active: false, nextSpinAt: 0 });
  }

  suspend() {
    this.clearMotion();
    cancelAnimationFrame(this.settleFrame);
    this.retiringId = null;
    cancelAnimationFrame(this.frame);
    this.spin = null;
    this.lastSpin = null;
    this.finishElimination();
    document.body.classList.remove('wheel-spinning', 'wheel-settling');
  }
}
