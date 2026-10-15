const crypto = require('crypto');

const DEFAULT_SETTINGS = Object.freeze({
  maxPoints: 50,
  maxItems: 5,
  keepZeroItems: false,
  zeroItemWeight: 0.5,
  spinDuration: 5.5,
  restrictOwnPoints: false,
  foreignOnlyPoints: 0,
  allowFreeItemsForAll: false
});

function generateId() {
  return crypto.randomBytes(6).toString('hex');
}

module.exports = { DEFAULT_SETTINGS, generateId };
