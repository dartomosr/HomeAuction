const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { bindWindowMode } = require('../desktop/window-mode');
const model = import('../public/js/stage-model.js');
const audio = import('../public/js/stage-audio.js');
const poolShow = import('../public/js/stage-pool-show.js');

async function createShowHarness(initial) {
  const { createPoolShow } = await poolShow;
  const { stageChanges } = await model;
  const show = createPoolShow({ random: () => 0 });
  let state = { phase: 'POOL', roundId: 'a', items: [], players: [], totalBank: 0, bankCapacity: 0, ...initial };
  show.setRunning(true, 0);
  show.receive(null, state, stageChanges(null, state), 0, 6);
  return {
    show,
    send(now, patch) {
      const next = { ...state, ...patch };
      show.receive(state, next, stageChanges(state, next), now, 6);
      state = next;
    },
    tick(now, slots = 6, hasQr = true) { return show.tick(now, { slots, hasQr }); }
  };
}

test('show batches arrivals and picks the special lot pose for a full showcase', async () => {
  const session = await createShowHarness({ items: Array.from({ length: 5 }, (_, id) => ({ id, kind: 'regular' })) });
  const a = { id: 'a', name: 'Анна', online: true };
  const b = { id: 'b', name: 'Борис', online: true };
  session.send(10, { players: [a], bankCapacity: 50 });
  session.send(100, { players: [a, b], bankCapacity: 100 });
  assert.equal(session.tick(810).text, 'Рады видеть новых гостей за столом!');
  session.send(6100, { items: Array.from({ length: 6 }, (_, id) => ({ id, kind: 'regular' })) });
  assert.equal(session.tick(6810).pose, '16-showcase-full');
});

test('show holds a reaction before returning to a contextual line between events', async () => {
  const a = { id: 'a', name: 'Анна', online: true };
  const b = { id: 'b', name: 'Борис', online: true };
  const session = await createShowHarness({ players: [a] });
  session.send(100, { items: [{ id: 1, kind: 'regular' }] });
  assert.equal(session.tick(700).pose, '03-new-idea');
  session.send(800, { players: [a, b] });
  assert.equal(session.tick(5499).pose, '03-new-idea');
  assert.equal(session.tick(5500).text, 'Обдумайте свой следующий ход.');
  assert.match(session.tick(6700).text, /Борис/);
});

test('idle phrases persist between rotations and cycle without repeats or unavailable QR prompts', async () => {
  const session = await createShowHarness();
  const lines = Array.from({ length: 7 }, (_, index) => session.tick(index * 25000, 6, false).text);
  assert.equal(new Set(lines).size, lines.length);
  assert.ok(lines.every(line => !line.includes('QR')));
  assert.equal(session.tick(6 * 25000 + 10000, 6, false).text, lines.at(-1));
  assert.notEqual(session.tick(7 * 25000, 6, false).text, lines.at(-1));
  session.send(7 * 25000 + 100, { players: [{ id: 'a', name: 'Анна', online: true }] });
  assert.equal(session.tick(7 * 25000 + 100).text, 'Жду ваши идеи для витрины!');
});

test('show uses the available room budget and drops a threshold crossing caused by a budget change', async () => {
  const { largeBankThreshold } = await poolShow;
  assert.deepEqual([20, 90, 200, 2000].map(largeBankThreshold), [12, 50, 110, 1100]);
  const session = await createShowHarness({
    players: [{ id: 'a', online: true }, { id: 'b', online: true }],
    items: [{ id: 1, kind: 'regular' }],
    totalBank: 11, bankCapacity: 20
  });
  session.send(100, { totalBank: 12, bankCapacity: 19 });
  assert.equal(session.tick(1600).text, 'Обдумайте свой следующий ход.');
  session.send(2000, { totalBank: 10 });
  session.send(2100, { totalBank: 12 });
  assert.equal(session.tick(3600).text, 'Банк растёт! Вот это размах!');
  session.send(9000, { totalBank: 10 });
  session.send(9100, { totalBank: 12 });
  assert.equal(session.tick(11000).text, 'Обдумайте свой следующий ход.');
});

test('countdown preempts the pool line and does not repeat after pause or visibility changes', async () => {
  const session = await createShowHarness();
  session.send(0, { poolTimer: { runId: 'timer', status: 'running', remainingMs: 17000 } });
  assert.equal(session.tick(0).pose, '05-timer');
  const player = { id: 'a', name: 'Анна', online: true };
  session.send(5100, { players: [player], poolTimer: { runId: 'timer', status: 'running', remainingMs: 11900 } });
  assert.match(session.tick(6000).text, /Анна/);
  assert.equal(session.tick(7000).pose, '21-final-countdown');
  session.send(7500, { poolTimer: { runId: 'timer', status: 'paused', remainingMs: 9500 } });
  assert.notEqual(session.tick(7500).pose, '21-final-countdown');
  session.show.setRunning(false, 7700);
  session.send(8000, { poolTimer: { runId: 'timer', status: 'running', remainingMs: 9500 } });
  session.show.setRunning(true, 8300);
  assert.notEqual(session.tick(8300).pose, '21-final-countdown');
  session.send(9000, { poolTimer: { runId: 'next', status: 'running', remainingMs: 5000 } });
  assert.equal(session.tick(9000).pose, '21-final-countdown');
  session.send(10000, { phase: 'REVEAL', poolTimer: null });
  assert.equal(session.tick(10000).text, '');
  assert.equal(session.show.reveal('timer').text, 'Время вышло! Раскрываем карты.');
});

test('show drops stale ready events and never reads unsuitable names aloud', async () => {
  const a = { id: 'a', name: 'Слишком Длинное Имя', online: true, ready: false };
  const b = { id: 'b', online: true, ready: false };
  const c = { id: 'c', online: true, ready: false };
  const session = await createShowHarness({ items: [{ id: 1 }], players: [a, b, c] });
  session.send(50, { players: [{ ...a, ready: true }, b, c] });
  assert.equal(session.tick(650).text, 'Первый выбор уже сделан!');
  session.send(6000, { players: [{ ...a, ready: true }, { ...b, ready: true }, c] });
  session.send(6300, { players: [{ ...a, ready: true }, b, c] });
  assert.equal(session.tick(6700).text, 'Обдумайте свой следующий ход.');
  session.send(7000, { players: [{ ...a, ready: true }, { ...b, ready: true }, c] });
  assert.equal(session.tick(7600).pose, '20-last-ready');
});

test('stage ranks by net votes, then upvotes, preserving ties and source order', async () => {
  const { rankStageItems } = await model;
  const items = [
    { id: 'a', upvotes: 2, downvotes: 1 },
    { id: 'b', upvotes: 5, downvotes: 4 },
    { id: 'c', upvotes: 2, downvotes: 0 },
    { id: 'd', upvotes: 2, downvotes: 1 }
  ];
  assert.deepEqual(rankStageItems(items).map(item => item.id), ['c', 'b', 'a', 'd']);
  assert.deepEqual(items.map(item => item.id), ['a', 'b', 'c', 'd']);
  assert.deepEqual(rankStageItems([{ id: 'zero' }, { id: 'negative', upvotes: 0, downvotes: 1 }]).map(item => item.id), ['zero', 'negative']);
});

test('stage deltas suppress initial/reconnect sounds and distinguish votes, joins and readiness', async () => {
  const { stageChanges } = await model;
  const previous = { items: [{ id: 'a', upvotes: 1, downvotes: 1 }], players: [{ id: 'p', ready: false }] };
  assert.deepEqual(stageChanges(null, previous), { added: [], reactions: [], joined: [], ready: [], allReady: false });
  const next = { items: [{ id: 'a', upvotes: 2, downvotes: 0 }, { id: 'b', upvotes: 0, downvotes: 0 }], players: [{ id: 'p', ready: true }, { id: 'q', ready: false }] };
  const changes = stageChanges(previous, next);
  assert.deepEqual(changes.reactions, [{ id: 'a', up: 1, down: -1 }]);
  assert.deepEqual(changes.added, [next.items[1]]);
  assert.deepEqual(changes.joined, [next.players[1]]);
  assert.deepEqual(changes.ready, [next.players[0]]);
  assert.equal(changes.allReady, false);
  const ready = { ...next, players: next.players.map(player => ({ ...player, ready: true })) };
  assert.equal(stageChanges(next, ready).allReady, true);
  assert.equal(stageChanges(ready, ready).allReady, false);
  assert.equal(stageChanges(ready, { items: [], players: [] }).allReady, false);
});

test('carousel freezes when hidden, advances once after delays and adapts to compact scenes', async () => {
  const { advanceCarousel, stageCapacity } = await model;
  assert.deepEqual(advanceCarousel(3000, 60000, false), { elapsed: 3000, advance: false });
  assert.deepEqual(advanceCarousel(3000, 1000, true), { elapsed: 4000, advance: false });
  assert.deepEqual(advanceCarousel(3000, 60000, true), { elapsed: 0, advance: true });
  assert.deepEqual(stageCapacity(1920, 1080), { columns: 3, rows: 2, items: 6, players: 6 });
  assert.deepEqual(stageCapacity(720, 440), { columns: 2, rows: 1, items: 2, players: 4 });
  assert.equal(stageCapacity(720, 600).items, 4);
});

test('native fullscreen synchronizes state and handles F11 repeats and Escape', () => {
  const window = new EventEmitter();
  window.webContents = new EventEmitter();
  let fullscreen = false;
  const published = [];
  const requested = [];
  window.isFullScreen = () => fullscreen;
  window.setFullScreen = value => { requested.push(value); };
  window.webContents.send = (event, state) => published.push({ event, state });
  const mode = bindWindowMode(window);
  let prevented = 0;
  const event = { preventDefault: () => prevented++ };
  window.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'F11' });
  window.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'F11', isAutoRepeat: true });
  assert.deepEqual(requested, [true]);
  fullscreen = true;
  window.emit('enter-full-screen');
  assert.deepEqual(mode.getState(), { fullscreen: true });
  assert.deepEqual(published.at(-1), { event: 'homeauction:window-mode', state: { fullscreen: true } });
  window.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });
  assert.deepEqual(requested, [true, false]);
  fullscreen = false;
  window.emit('leave-full-screen');
  window.webContents.emit('before-input-event', event, { type: 'keyDown', key: 'Escape' });
  assert.equal(prevented, 3);
  mode.toggle();
  mode.exit();
  assert.deepEqual(requested, [true, false, true, false]);
});

function audioContextMock() {
  const scheduled = [];
  const param = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime(value) { this.value = value; } });
  const node = () => ({ connect(other) { return other; }, disconnect() {} });
  const context = {
    state: 'running', currentTime: 1, sampleRate: 100, destination: node(),
    createGain: () => ({ ...node(), gain: param() }),
    createDynamicsCompressor: () => ({ ...node(), threshold: param(), knee: param(), ratio: param() }),
    createConvolver: node,
    createBuffer: (_channels, length) => ({ getChannelData: () => new Float32Array(length) }),
    createStereoPanner: () => ({ ...node(), pan: param() }),
    createOscillator: () => ({ ...node(), frequency: param(), start(time) { scheduled.push(time); }, stop() {} }),
    createBufferSource: () => ({ ...node(), start(time) { scheduled.push(time); }, stop() {} }),
    createBiquadFilter: () => ({ ...node(), Q: param(), frequency: param() })
  };
  return { context, scheduled };
}

test('stage sound persists mute, gates hidden screens and bounds repeated reaction bursts', async () => {
  const { StageSound } = await audio;
  const values = new Map([['homeauction-stage-muted', 'true']]);
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const { context, scheduled } = audioContextMock();
  let created = 0;
  const sound = new StageSound({ storage, contextFactory: () => { created++; return context; } });
  await sound.unlock();
  assert.equal(created, 0);
  assert.equal(sound.play('lot'), false);
  sound.setMuted(false);
  await sound.unlock();
  assert.equal(created, 1);
  assert.equal(values.get('homeauction-stage-muted'), 'false');
  assert.equal(sound.play('up'), true);
  const count = scheduled.length;
  assert.equal(sound.play('up'), false);
  assert.equal(scheduled.length, count);
  sound.setActive(false);
  context.currentTime++;
  assert.equal(sound.play('ready'), false);
  assert.equal(sound.master.gain.value, 0);
  sound.setActive(true);
  sound.setMuted(true);
  assert.equal(sound.play('all-ready'), false);
  assert.equal(sound.master.gain.value, 0);
  assert.equal(new StageSound({ storage }).muted, true);
});

test('all stage cues schedule finite audio without requiring localStorage access', async () => {
  const { StageSound } = await audio;
  for (const kind of ['lot', 'up', 'down', 'ready', 'all-ready', 'page', 'elimination', 'countdown']) {
    const { context, scheduled } = audioContextMock();
    const sound = new StageSound({ storage: { getItem() { throw new Error('Disabled'); }, setItem() { throw new Error('Disabled'); } }, contextFactory: () => context });
    await sound.unlock();
    assert.equal(sound.play(kind), true, kind);
    assert.ok(scheduled.length > 0 && scheduled.every(Number.isFinite), kind);
    sound.setMuted(true);
    assert.equal(sound.play(kind), false);
  }
});

test('reveal grid fits every lot and wheel view excludes merged-out zero and eliminated lots', async () => {
  const { revealLayout, stageLotColor, stageWheelItems, riskLabel } = await model;
  for (const count of [0, 1, 6, 7, 18, 48]) {
    const layout = revealLayout(count, 1600, 760);
    assert.ok(layout.columns * layout.rows >= count);
  }
  const items = [
    { id: 'a', roundElimShare: 40 }, { id: 'b', eliminated: true },
    { id: 'c', droppedZero: true }, { id: 'd', roundElimShare: 60 }
  ];
  const slices = stageWheelItems({ items });
  assert.deepEqual(slices.map(item => item.id), ['a', 'd']);
  assert.equal(slices.reduce((sum, item) => sum + item.share, 0), 1);
  const after = stageWheelItems({ items: items.map(item => ({ ...item, eliminated: item.id === 'a' || item.eliminated })) });
  assert.equal(after[0].color, slices[1].color, 'A lot retains its color between rounds');
  const poolColor = stageLotColor({ id: 'd', colorIndex: 3 }, 0);
  assert.equal(poolColor, slices[1].color, 'Pool ranking does not influence the color');
  assert.equal(stageWheelItems({ items: [{ id: 'd', colorIndex: 3 }] })[0].color, poolColor,
    'Removing preceding lots from a reveal snapshot does not change the color');
  assert.equal(riskLabel(12.3456789), '12,3%');
  assert.equal(riskLabel(undefined), 'нет данных');
});

test('stage wheel lands on server target and reconstructs an in-progress rotation', async () => {
  const { spinRotation, pointerSector, TAU } = await import('../public/js/wheel-canvas.js');
  const spin = { targetFraction: .63, extraSpins: 7, durationSec: 12 };
  const slices = [{ share: .3 }, { share: .5 }, { share: .2 }];
  let previous = 1.7;
  for (let time = 0; time <= 12000; time += 100) {
    const rotation = spinRotation(spin, 1.7, time);
    assert.ok(rotation >= previous);
    previous = rotation;
  }
  const end = spinRotation(spin, 1.7, 12000);
  assert.equal(pointerSector(slices, end), 1);
  assert.ok(Math.abs((end % TAU) / TAU - .37) < 1e-10);
  assert.equal(spinRotation(spin, 1.7, 15000), end);
  assert.ok(spinRotation(spin, 1.7, 6500) > 1.7);
});

test('wheel ticks support pitch, duel and mute without replay bursts', async () => {
  const { StageSound } = await audio;
  const { context, scheduled } = audioContextMock();
  const sound = new StageSound({ contextFactory: () => context });
  await sound.unlock();
  assert.equal(sound.tick(.9, true), true);
  assert.equal(sound.tick(.9, true), false);
  context.currentTime += .04;
  assert.equal(sound.tick(.1, false), true);
  assert.equal(scheduled.length, 2);
  sound.setMuted(true);
  assert.equal(sound.tick(.1, false), false);
});

test('pointer catches narrow boundaries and full revolutions between frames', async () => {
  const { crossedBoundaries, TAU } = await import('../public/js/wheel-canvas.js');
  const slices = [{ share: .001 }, { share: .002 }, { share: .997 }];
  assert.equal(crossedBoundaries(slices, 0, TAU), 3);
  assert.equal(crossedBoundaries(slices, TAU - .03, TAU + .001), 3);
  assert.equal(crossedBoundaries(slices, 0, 3 * TAU), 9);
  assert.equal(crossedBoundaries(slices, 1, 1), 0);
});

test('pointer spring is frame-rate independent and settles after repeated impacts', async () => {
  const { stepPointerSpring } = await import('../public/js/wheel-canvas.js');
  const simulate = fps => {
    let value = { angle: 0, velocity: -240 };
    for (let frame = 0; frame < fps; frame++) value = stepPointerSpring(value, 1 / fps);
    return value;
  };
  const slow = simulate(30), fast = simulate(120);
  assert.ok(Math.abs(slow.angle - fast.angle) < 1e-9);
  assert.ok(Math.abs(slow.velocity - fast.velocity) < 1e-9);
  assert.ok(Math.abs(slow.angle) + Math.abs(slow.velocity) < .001);
  let spring = { angle: 0, velocity: 0 };
  for (let frame = 0; frame < 120; frame++) {
    if (frame % 4 === 0) spring.velocity = Math.max(-400, spring.velocity - 220);
    spring = stepPointerSpring(spring, 1 / 60);
    assert.ok(Number.isFinite(spring.angle) && Math.abs(spring.angle) < 20);
  }
});

test('sector settling closes a middle gap without shifting colors or changing the total share', async () => {
  const { interpolateSectorShares } = await import('../public/js/wheel-canvas.js');
  const slices = [
    { id: 'a', share: .25, color: 'red' },
    { id: 'b', share: .5, color: 'green' },
    { id: 'c', share: .25, color: 'blue' }
  ];
  const targetShares = new Map([['a', .5], ['c', .5]]);
  assert.deepEqual(interpolateSectorShares(slices, targetShares, 0), slices);
  const halfway = interpolateSectorShares(slices, targetShares, .5);
  assert.deepEqual(halfway.map(slice => slice.share), [.484375, .03125, .484375]);
  assert.deepEqual(halfway.map(slice => slice.color), slices.map(slice => slice.color));
  assert.equal(halfway.reduce((total, slice) => total + slice.share, 0), 1);
  assert.deepEqual(interpolateSectorShares(slices, targetShares, 1).map(slice => slice.share), [.5, 0, .5]);
});


test('stage spin accelerates briefly and coasts continuously to rest', async () => {
  const { spinRotation } = await import('../public/js/wheel-canvas.js');
  for (const durationSec of [3, 12, 60]) {
    const spin = { targetFraction: .37, extraSpins: 7, durationSec };
    const duration = durationSec * 1000;
    const speed = t => (spinRotation(spin, 0, t + 1) - spinRotation(spin, 0, t)) * 1000;
    const peakTime = Math.min(duration * .08, 650);
    assert.ok(speed(1) < speed(peakTime / 2));
    assert.ok(speed(peakTime / 2) < speed(peakTime));
    assert.ok(speed(peakTime) > speed(duration * .5));
    assert.ok(speed(duration * .5) > speed(duration * .8));
    assert.ok(speed(duration * .8) > speed(duration - 2));
    assert.ok(speed(duration - 2) < .0001);
  }
});


test('background parallax damps speed independently of frame rate and preserves distance between rounds', async () => {
  const { stepBackgroundParallax, backgroundPhase, BACKGROUND_PERIOD } = await import('../public/js/stage-parallax.js');
  const run = fps => {
    let state = { offset: 0, velocity: 0 };
    for (let i = 0; i < fps; i++) state = stepBackgroundParallax(state, 10, 1 / fps);
    assert.ok(state.velocity > 0 && state.velocity < .22);
    for (let i = 0; i < fps * 4; i++) state = stepBackgroundParallax(state, 0, 1 / fps);
    assert.equal(state.velocity, 0);
    const stopped = state.offset;
    for (let i = 0; i < fps; i++) state = stepBackgroundParallax(state, 0, 1 / fps);
    assert.equal(state.offset, stopped);
    state = stepBackgroundParallax(state, 10, 1 / fps);
    assert.ok(state.offset > stopped, 'Next round continues forward from the saved height');
    return stopped;
  };
  assert.ok(Math.abs(run(30) - run(120)) < .00004);
  for (const depth of [.72, .82, .92, 1.02, 1.12]) {
    const offset = 75.123;
    assert.ok(Math.abs(backgroundPhase(offset, depth) - backgroundPhase(offset + BACKGROUND_PERIOD / depth, depth)) < 1e-12);
    assert.ok(backgroundPhase(offset, depth) >= 0 && backgroundPhase(offset, depth) < BACKGROUND_PERIOD);
  }
  assert.deepEqual(stepBackgroundParallax({ offset: 7, velocity: 0 }, 0, 60), { offset: 7, velocity: 0 });
});
