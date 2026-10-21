export const RANDOM_PRESET_STORAGE_KEY = 'auction_random_preset_ids';

function getPresetIds(presets) {
  return Array.from(new Set((Array.isArray(presets) ? presets : [])
    .map(preset => typeof preset === 'string' ? preset : preset?.id)
    .filter(id => typeof id === 'string' && id.length > 0)));
}

export function filterEnabledPresets(presets, enabledIds) {
  if (!Array.isArray(presets) || !Array.isArray(enabledIds)) return [];
  const enabled = new Set(enabledIds);
  return presets.filter(preset => enabled.has(typeof preset === 'string' ? preset : preset?.id));
}

export function selectRandomPreset(presets, random = Math.random) {
  if (!Array.isArray(presets) || presets.length === 0) return null;
  const value = Number(random());
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('Источник случайных значений должен возвращать число от 0 включительно до 1 не включительно.');
  }
  return presets[Math.floor(value * presets.length)];
}

export function normalizePresetIds(rawValue, presets) {
  const ids = getPresetIds(presets);
  if (!ids.length) return [];
  let parsed;
  try {
    parsed = typeof rawValue === 'string' ? JSON.parse(rawValue) : rawValue;
  } catch {
    return ids;
  }
  if (!Array.isArray(parsed)) return ids;
  const available = new Set(ids);
  const selected = Array.from(new Set(parsed.filter(id => typeof id === 'string' && available.has(id))));
  return selected.length ? selected : ids;
}

export function loadPresetIds(storage, presets, key = RANDOM_PRESET_STORAGE_KEY) {
  const allIds = getPresetIds(presets);
  try {
    return normalizePresetIds(storage.getItem(key), allIds);
  } catch {
    return allIds;
  }
}

export function savePresetIds(storage, selectedIds, presets, key = RANDOM_PRESET_STORAGE_KEY) {
  const allIds = getPresetIds(presets);
  const available = new Set(allIds);
  const selected = Array.from(new Set((Array.isArray(selectedIds) ? selectedIds : [])
    .filter(id => typeof id === 'string' && available.has(id))));
  if (!selected.length) return false;
  try {
    storage.setItem(key, JSON.stringify(selected));
    return true;
  } catch {
    return false;
  }
}

export function createPresetDraft(initialIds) {
  let selected = new Set(Array.isArray(initialIds) ? initialIds.filter(id => typeof id === 'string') : []);
  return {
    has: id => Boolean(selected?.has(id)),
    set: (id, checked) => {
      if (!selected) return;
      if (checked) selected.add(id);
      else selected.delete(id);
    },
    values: () => selected ? [...selected] : [],
    commit: (storage, presets, key = RANDOM_PRESET_STORAGE_KEY) => {
      if (!selected || !savePresetIds(storage, [...selected], presets, key)) return false;
      selected = null;
      return true;
    },
    cancel: () => { selected = null; }
  };
}

export function createSpinPlan(presetIds, winnerId, reducedMotion = false) {
  if (!Array.isArray(presetIds) || !presetIds.length || !presetIds.includes(winnerId)) return null;
  if (presetIds.length === 1) {
    return { sequence: [...presetIds], startIndex: 0, endIndex: 0, duration: 520 };
  }
  if (reducedMotion) {
    const winnerIndex = presetIds.indexOf(winnerId);
    return { sequence: [...presetIds], startIndex: winnerIndex, endIndex: winnerIndex, duration: 260 };
  }
  const reversed = [...presetIds].reverse();
  const reversedWinnerIndex = reversed.indexOf(winnerId);
  const endIndex = presetIds.length * 2 + reversedWinnerIndex;
  const startIndex = endIndex + presetIds.length * 5;
  const visibleRows = 7;
  const sequence = Array.from({ length: startIndex + visibleRows }, (_, index) => reversed[index % reversed.length]);
  return { sequence, startIndex, endIndex, duration: 3600 };
}

export function createRandomModeFlow(deps) {
  let phase = 'closed';
  let generation = 0;
  let winner = null;
  let applied = false;

  function publish() {
    deps.onState?.({ phase, winner });
  }

  async function spin() {
    if (phase === 'spinning') return false;
    const presets = deps.getPresets();
    if (!Array.isArray(presets) || !presets.length) return false;
    const selected = selectRandomPreset(presets, deps.random || Math.random);
    const run = ++generation;
    winner = null;
    phase = 'spinning';
    applied = false;
    publish();
    try {
      await deps.animate(selected, presets, run);
    } catch {
      // Cancellation is expected when the user exits during a spin.
    }
    if (generation !== run || phase !== 'spinning') return false;
    winner = selected;
    phase = 'result';
    publish();
    return true;
  }

  function open() {
    if (phase !== 'closed') return false;
    const presets = deps.getPresets();
    if (!Array.isArray(presets) || !presets.length) return false;
    phase = 'ready';
    publish();
    return spin();
  }

  function reroll() {
    if (phase !== 'result') return false;
    return spin();
  }

  function exit() {
    if (phase === 'closed') return false;
    ++generation;
    deps.cancelAnimation?.();
    winner = null;
    phase = 'closed';
    publish();
    deps.onExit?.();
    return true;
  }

  function begin() {
    if (phase !== 'result' || !winner || applied) return false;
    const selected = winner;
    if (!deps.canApply()) {
      exit();
      deps.onUnavailable?.();
      return false;
    }
    applied = true;
    ++generation;
    winner = null;
    phase = 'closed';
    publish();
    deps.onApply(selected);
    return true;
  }

  return {
    open,
    reroll,
    exit,
    begin,
    getState: () => ({ phase, winner })
  };
}
