const crypto = require('crypto');

const DEFAULT_SETTINGS = Object.freeze({
  maxPoints: 50,
  maxItems: 5,
  keepZeroItems: false,
  zeroItemWeight: 0.5,
  spinDuration: 5.5,
  restrictOwnPoints: false,
  foreignOnlyPoints: 0,
  allowFreeItemsForAll: false,
  allowReactions: false
});

const ROOM_PRESETS = Object.freeze({
  basic: { ...DEFAULT_SETTINGS },
  diplomacy: {
    ...DEFAULT_SETTINGS,
    restrictOwnPoints: true,
    foreignOnlyPoints: 25,
    allowReactions: true
  },
  chaos: {
    ...DEFAULT_SETTINGS,
    maxPoints: 100,
    maxItems: 10,
    keepZeroItems: true,
    zeroItemWeight: 5,
    allowFreeItemsForAll: false,
    allowReactions: true
  }
});

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { DEFAULT_SETTINGS, ROOM_PRESETS, generateId };
