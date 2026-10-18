const HEADER = '==HOME AUCTION==';

function parseSaveFile(text) {
    const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
    const firstNonEmpty = lines.find(line => line.trim() !== '');
    if (firstNonEmpty !== HEADER) {
      throw new Error('Файл не является сохранением Home Auction: отсутствует заголовок ==HOME AUCTION==.');
    }

    const titleLine = lines.slice(lines.indexOf(firstNonEmpty) + 1)
      .find(line => /^\s*#\s+/.test(line));
    const label = titleLine ? titleLine.replace(/^\s*#\s+/, '').trim() : '';
    const items = [];

    for (const sourceLine of lines.slice(lines.indexOf(firstNonEmpty) + 1)) {
      let line = sourceLine.trim();
      if (!line || line.startsWith('#')) continue;
      line = line.replace(/^(?:[-*]\s+|\d+\.\s+)/, '').trim();
      if (!line) continue;

      const [rawTitle, ...parameters] = line.split('|');
      const title = rawTitle.trim().slice(0, 80);
      if (!title) continue;

      let points = 0;
      let isFreeSlot = false;
      for (const rawParameter of parameters) {
        const parameter = rawParameter.trim();
        if (/^(?:ДОП|\+|free)$/i.test(parameter)) {
          isFreeSlot = true;
        } else if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(parameter)) {
          points = Number(parameter);
        }
      }
      items.push({ title, points, isFreeSlot });
    }

    return { items, label };
}

function serializeSaveFile(items) {
  return `${HEADER}\n${items.map(item => {
    const parts = [item.title];
    if (item.points > 0) parts.push(String(item.points));
    if (item.isFreeSlot) parts.push('ДОП');
    return parts.join(' | ');
  }).join('\n')}\n`;
}

globalThis.HomeAuctionSaveParser = { HEADER, parseSaveFile, serializeSaveFile };

export { HEADER, parseSaveFile, serializeSaveFile };
