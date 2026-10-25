export const PAGE_DURATION = 10000;

export function rankStageItems(items) {
  // Stable ties preserve the order of proposals, rather than making equal cards jitter.
  return [...items].sort((a, b) =>
    ((b.upvotes || 0) - (b.downvotes || 0)) - ((a.upvotes || 0) - (a.downvotes || 0)) ||
    (b.upvotes || 0) - (a.upvotes || 0));
}

export function stageCapacity(width, height) {
  const columns = width < 760 ? 2 : 3;
  const rows = height < 470 ? 1 : 2;
  return { columns, rows, items: columns * rows, players: width < 1100 ? 4 : 6 };
}

export function stageChanges(previous, next) {
  const result = { added: [], reactions: [], joined: [], ready: [], allReady: false };
  if (!previous) return result;
  const oldItems = new Map(previous.items.map(item => [item.id, item]));
  const oldPlayers = new Map(previous.players.map(player => [player.id, player]));
  for (const item of next.items) {
    const old = oldItems.get(item.id);
    if (!old) result.added.push(item);
    else if (old.upvotes !== item.upvotes || old.downvotes !== item.downvotes) {
      result.reactions.push({ id: item.id, up: item.upvotes - old.upvotes, down: item.downvotes - old.downvotes });
    }
  }
  for (const player of next.players) {
    const old = oldPlayers.get(player.id);
    if (!old) result.joined.push(player);
    else if (!old.ready && player.ready) result.ready.push(player);
  }
  const allReady = players => players.length > 0 && players.every(player => player.ready);
  result.allReady = allReady(next.players) && !allReady(previous.players);
  return result;
}

export function advanceCarousel(elapsed, delta, running, duration = PAGE_DURATION) {
  if (!running) return { elapsed, advance: false };
  const next = elapsed + Math.max(0, delta);
  // A delayed frame must never skip several pages the audience has not seen.
  return next >= duration ? { elapsed: 0, advance: true } : { elapsed: next, advance: false };
}
