const assert = require('node:assert/strict');
const { test } = require('node:test');
const { EventEmitter } = require('node:events');
const { bindWindowMode } = require('../desktop/window-mode');
const model = import('../public/js/stage-model.js');
const audio = import('../public/js/stage-audio.js');

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
  const { revealLayout, stageWheelItems, riskLabel } = await model;
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
