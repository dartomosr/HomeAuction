const { getEffectivePoints } = require('./state');

function pickPredeterminedWinner(aliveItems) {
  const totalWeight = aliveItems.reduce((sum, item) => sum + getEffectivePoints(item), 0);
  let rand = Math.random() * totalWeight;
  for (const item of aliveItems) {
    rand -= getEffectivePoints(item);
    if (rand <= 0) return item.id;
  }
  return aliveItems[aliveItems.length - 1].id;
}

// Выбор выбывающего среди остальных вариантов (вес вылета = 1 / Очки)
function pickEliminatedItem(candidates) {
  const weights = candidates.map(item => 1 / getEffectivePoints(item));
  const totalInv = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * totalInv;
  for (let i = 0; i < candidates.length; i++) {
    rand -= weights[i];
    if (rand <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

module.exports = { pickPredeterminedWinner, pickEliminatedItem };
