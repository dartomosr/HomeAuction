const crypto = require('crypto');

const DEFAULT_SETTINGS = Object.freeze({
  maxPoints: 50,
  maxItems: 5,
  minimumBid: 0,
  keepZeroItems: false,
  zeroItemWeight: 0.5,
  spinDuration: 5.5,
  restrictOwnPoints: false,
  foreignOnlyPoints: 0,
  foreignReserveMode: 'total',
  freePointsBudget: 20,
  allowFreeItemsForAll: false,
  allowReactions: false
});

const PRESET_GROUPS = Object.freeze([
  Object.freeze({ id: 'standard', name: 'Стандартные режимы' }),
  Object.freeze({ id: 'experimental', name: 'Экспериментальные режимы' })
]);

const PRESET_CATALOG = Object.freeze([
  Object.freeze({
    id: 'basic',
    name: 'Базовый',
    group: 'standard',
    settings: Object.freeze({ ...DEFAULT_SETTINGS })
  }),
  Object.freeze({
    id: 'diplomacy',
    name: 'Дипломатия',
    group: 'standard',
    settings: Object.freeze({
      ...DEFAULT_SETTINGS,
      restrictOwnPoints: true,
      foreignOnlyPoints: 25,
      allowReactions: true
    })
  }),
  Object.freeze({
    id: 'chaos',
    name: 'Хаос',
    group: 'standard',
    settings: Object.freeze({
      ...DEFAULT_SETTINGS,
      maxPoints: 100,
      maxItems: 10,
      keepZeroItems: true,
      zeroItemWeight: 5,
      allowFreeItemsForAll: false,
      allowReactions: true
    })
  }),
  Object.freeze({
    id: 'all-or-nothing',
    name: 'Всё или ничего',
    group: 'experimental',
    settings: Object.freeze({ ...DEFAULT_SETTINGS, minimumBid: 50 })
  })
]);

const ROOM_PRESETS = Object.freeze(Object.fromEntries(
  PRESET_CATALOG.map(({ id, settings }) => [id, settings])
));

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { DEFAULT_SETTINGS, PRESET_GROUPS, PRESET_CATALOG, ROOM_PRESETS, generateId };
