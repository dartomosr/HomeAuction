export function getSettingsRuleGroups(settings = {}) {
  const equalSplit = settings.distributionMode === 'equal_split';
  const maxPoints = Math.max(0, Number(settings.maxPoints) || 0);
  const foreignOnlyPoints = Math.max(0, Number(settings.foreignOnlyPoints) || 0);
  const perOpponentReserve = settings.foreignReserveMode === 'per_opponent' &&
    Math.max(0, Number(settings.freePointsBudget) || 0) < maxPoints;
  const hasForeignReserve = (Boolean(settings.restrictOwnPoints) && foreignOnlyPoints > 0) ||
    perOpponentReserve;
  const active = {
    minimumBid: Number(settings.minimumBid) > 0,
    freeItems: Boolean(settings.allowFreeItemsForAll),
    flexiblePoints: !equalSplit && hasForeignReserve,
    foreignPoints: !equalSplit && hasForeignReserve,
    support: Boolean(settings.keepZeroItems),
    reactions: Boolean(settings.allowReactions),
    distributionMode: equalSplit
  };
  const hiddenInEqualSplit = equalSplit ? new Set(['flexiblePoints', 'foreignPoints']) : new Set();
  return {
    primary: Object.keys(active).filter(key => active[key]),
    additional: Object.keys(active).filter(key => !active[key] && key !== 'distributionMode' &&
      !hiddenInEqualSplit.has(key))
  };
}
