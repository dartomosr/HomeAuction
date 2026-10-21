const test = require('node:test');
const assert = require('node:assert/strict');

let randomMode;
test('random mode behavior', async t => {
  randomMode = await import('../public/js/random-mode.js');
  const modes = [{ id: 'basic' }, { id: 'diplomacy' }, { id: 'chaos' }];

  await t.test('each enabled preset occupies an equal deterministic random interval', () => {
    assert.equal(randomMode.selectRandomPreset(modes, () => 0).id, 'basic');
    assert.equal(randomMode.selectRandomPreset(modes, () => 0.3333333333333333).id, 'diplomacy');
    assert.equal(randomMode.selectRandomPreset(modes, () => 0.6666666666666666).id, 'chaos');
    assert.equal(randomMode.selectRandomPreset([modes[1]], () => 0.99).id, 'diplomacy');
    assert.equal(randomMode.selectRandomPreset([], () => 0.5), null);
  });

  await t.test('repeat results are allowed and disabled presets cannot be selected', () => {
    const enabled = modes.filter(mode => mode.id !== 'chaos');
    assert.equal(randomMode.selectRandomPreset(enabled, () => 0.99).id, 'diplomacy');
    assert.equal(randomMode.selectRandomPreset(enabled, () => 0.99).id, 'diplomacy');
    assert.equal(enabled.some(mode => mode.id === 'chaos'), false);
  });

  await t.test('invalid, stale, unknown, and empty saved selections restore available presets', () => {
    assert.deepEqual(randomMode.normalizePresetIds('{bad', modes), ['basic', 'diplomacy', 'chaos']);
    assert.deepEqual(randomMode.normalizePresetIds('["removed"]', modes), ['basic', 'diplomacy', 'chaos']);
    assert.deepEqual(randomMode.normalizePresetIds('["chaos","removed","chaos"]', modes), ['chaos']);
    assert.deepEqual(randomMode.normalizePresetIds(null, modes), ['basic', 'diplomacy', 'chaos']);
  });

  await t.test('settings load and save only valid local IDs and reject an empty save', () => {
    const values = new Map();
    const storage = {
      getItem: key => values.has(key) ? values.get(key) : null,
      setItem: (key, value) => values.set(key, value)
    };
    assert.deepEqual(randomMode.loadPresetIds(storage, modes), ['basic', 'diplomacy', 'chaos']);
    assert.equal(randomMode.savePresetIds(storage, ['diplomacy', 'removed', 'diplomacy'], modes), true);
    assert.deepEqual(randomMode.loadPresetIds(storage, modes), ['diplomacy']);
    assert.equal(randomMode.savePresetIds(storage, [], modes), false);
    const brokenStorage = { getItem: () => { throw new Error('corrupt'); }, setItem() { throw new Error('readonly'); } };
    assert.deepEqual(randomMode.loadPresetIds(brokenStorage, modes), ['basic', 'diplomacy', 'chaos']);
    assert.equal(randomMode.savePresetIds(brokenStorage, ['basic'], modes), false);
  });

  await t.test('cancelled settings drafts do not persist and explicit save commits them', () => {
    const values = new Map([[randomMode.RANDOM_PRESET_STORAGE_KEY, '["basic"]']]);
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    };
    const cancelled = randomMode.createPresetDraft(['basic']);
    cancelled.set('chaos', true);
    cancelled.cancel();
    assert.deepEqual(randomMode.loadPresetIds(storage, modes), ['basic']);

    const saved = randomMode.createPresetDraft(['basic']);
    saved.set('diplomacy', true);
    assert.equal(saved.commit(storage, modes), true);
    assert.deepEqual(randomMode.loadPresetIds(storage, modes), ['basic', 'diplomacy']);
  });

  await t.test('spin plan ends exactly on the chosen card and moves the strip downward', () => {
    for (const winner of modes) {
      const plan = randomMode.createSpinPlan(modes.map(mode => mode.id), winner.id);
      assert.equal(plan.sequence[plan.endIndex], winner.id);
      assert.ok(plan.startIndex > plan.endIndex);
      assert.equal(plan.duration, 3600);
    }
    const oneMode = randomMode.createSpinPlan(['diplomacy'], 'diplomacy');
    assert.deepEqual(oneMode.sequence, ['diplomacy']);
    assert.equal(oneMode.duration < 1000, true);
    const reduced = randomMode.createSpinPlan(modes.map(mode => mode.id), 'chaos', true);
    assert.equal(reduced.sequence.includes('chaos'), true);
    assert.equal(reduced.startIndex, reduced.endIndex);
    assert.ok(reduced.duration < 1000);
  });

  await t.test('empty choices do not start a spin', async () => {
    let animations = 0;
    const flow = randomMode.createRandomModeFlow({ getPresets: () => [], animate: () => { animations++; } });
    assert.equal(await flow.open(), false);
    assert.equal(animations, 0);
    assert.equal(flow.getState().phase, 'closed');
  });

  await t.test('result is preliminary until Begin and applies exactly once', async () => {
    let applied = [];
    let random = 0;
    const flow = randomMode.createRandomModeFlow({
      getPresets: () => modes,
      random: () => random,
      animate: async () => {},
      canApply: () => true,
      onApply: mode => applied.push(mode.id)
    });
    await flow.open();
    assert.deepEqual(applied, []);
    assert.equal(flow.getState().winner.id, 'basic');
    assert.equal(flow.begin(), true);
    assert.equal(flow.begin(), false);
    assert.deepEqual(applied, ['basic']);
  });

  await t.test('reroll is independent and exit does not apply a result', async () => {
    let randomIndex = 0;
    const values = [0, 0.99, 0];
    const applied = [];
    const flow = randomMode.createRandomModeFlow({
      getPresets: () => modes,
      random: () => values[randomIndex++],
      animate: async () => {},
      canApply: () => true,
      onApply: mode => applied.push(mode.id)
    });
    await flow.open();
    assert.equal(flow.getState().winner.id, 'basic');
    await flow.reroll();
    assert.equal(flow.getState().winner.id, 'chaos');
    flow.exit();
    assert.deepEqual(applied, []);
  });

  await t.test('late animation completion after exit cannot restore a stale result', async () => {
    let finish;
    let cancelled = 0;
    const flow = randomMode.createRandomModeFlow({
      getPresets: () => modes,
      animate: () => new Promise(resolve => { finish = resolve; }),
      cancelAnimation: () => { cancelled++; }
    });
    const pending = flow.open();
    assert.equal(await flow.open(), false);
    assert.equal(flow.getState().phase, 'spinning');
    flow.exit();
    finish();
    await pending;
    assert.equal(cancelled, 1);
    assert.deepEqual(flow.getState(), { phase: 'closed', winner: null });
  });

  await t.test('stale room state prevents applying a finished roll', async () => {
    let canApply = true;
    let applied = 0;
    let unavailable = 0;
    const flow = randomMode.createRandomModeFlow({
      getPresets: () => modes,
      animate: async () => {},
      canApply: () => canApply,
      onApply: () => { applied++; },
      onUnavailable: () => { unavailable++; }
    });
    await flow.open();
    canApply = false;
    assert.equal(flow.begin(), false);
    assert.equal(applied, 0);
    assert.equal(unavailable, 1);
  });
});
