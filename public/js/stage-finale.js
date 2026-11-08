const byId = id => document.getElementById(id);
const number = new Intl.NumberFormat('ru-RU');
const awards = {
  'ТРИУМФАТОР': ['Триумфатор', 'gold'],
  'ИНВЕСТОР': ['Инвестор', 'mint'],
  'ВА-БАНК': ['Ва-банк', 'orange'],
  'ДИПЛОМАТ': ['Дипломат', 'blue'],
  'ПРОМАХ': ['Промах', 'pink'],
  'БАЛАНСИР': ['Балансир', 'lilac'],
  'НАБЛЮДАТЕЛЬ': ['Наблюдатель', 'silver']
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function card(player, award) {
  const [title, tone] = awards[award?.title] || awards.НАБЛЮДАТЕЛЬ;
  const entry = element('li', 'finale-card');
  entry.dataset.tone = tone;
  const avatar = element('span', 'finale-avatar', player.name.match(/[\p{L}\p{N}]/u)?.[0].toUpperCase() || '');
  avatar.setAttribute('aria-hidden', 'true');
  const name = element('strong', 'finale-player-name', player.name);
  name.title = player.name;
  const invested = player.investedPoints || 0;
  const winnerPoints = player.winnerPoints || 0;
  const summary = award?.hint || (invested
    ? `Вложено ${number.format(invested)} очк. · в победителя ${number.format(winnerPoints)}`
    : 'Без вложений в этом раунде');
  const detail = element('span', 'finale-summary', summary);
  detail.title = summary;
  entry.append(avatar, name, element('span', 'finale-award', title), detail);
  return entry;
}

export class StageFinale {
  constructor() {
    this.scene = byId('finale-scene');
    this.hero = byId('finale-hero');
    this.viewport = byId('finale-viewport');
    this.list = byId('finale-players');
    this.page = 0;
    byId('finale-previous').addEventListener('click', () => this.changePage(-1));
    byId('finale-next').addEventListener('click', () => this.changePage(1));
    new ResizeObserver(() => this.renderPage()).observe(this.viewport);
  }

  render(state) {
    const winner = state.wheel.winner;
    const winningItem = state.items.find(item => item.id === winner.id);
    const backers = (winningItem?.contributors || []).slice(0, 3);
    const heroSignature = JSON.stringify([winner, backers]);
    if (this.heroSignature !== heroSignature) {
      this.heroSignature = heroSignature;
      byId('finale-title').textContent = winner.title;
      byId('finale-title').title = winner.title;
      const chips = backers.map(person => {
        const chip = element('span', 'finale-backer');
        chip.title = `${person.name} · ${number.format(person.points)} очк.`;
        chip.append(element('span', 'finale-backer-name', person.name),
          element('b', '', `${number.format(person.points)} очк.`));
        return chip;
      });
      if (!chips.length) {
        const status = winner.author ? `Автор: ${winner.author}`
          : winner.totalPoints ? `Стартовые очки · ${number.format(winner.totalPoints)}` : 'Стартовый лот';
        chips.push(element('span', 'finale-backer finale-backer-status', status));
      }
      byId('finale-backers').replaceChildren(...chips);
    }
    const results = state.players.map(player => [
      player.name, player.investedPoints, player.winnerPoints, state.wheel.awards?.[player.id]
    ]);
    const resultsSignature = JSON.stringify(results);
    if (this.resultsSignature !== resultsSignature) {
      this.resultsSignature = resultsSignature;
      this.cards = state.players.map((player, index) => card(player, results[index][3]));
      this.pageSignature = null;
    }
    this.renderPage();
  }

  renderPage() {
    if (!this.cards || !this.viewport.clientHeight || this.scene.inert) return;
    const columns = this.cards.length >= 6 ? 2 : 1;
    this.list.dataset.columns = columns;
    const style = getComputedStyle(this.list);
    const gap = parseFloat(style.rowGap);
    const row = parseFloat(style.gridAutoRows);
    const rows = Math.max(1, Math.floor((this.viewport.clientHeight + gap) / (row + gap)));
    const pageSize = columns * rows;
    this.pages = Math.max(1, Math.ceil(this.cards.length / pageSize));
    this.page = Math.min(this.page, this.pages - 1);
    const signature = `${this.page}/${pageSize}`;
    if (signature !== this.pageSignature) {
      this.pageSignature = signature;
      const visible = this.cards.slice(this.page * pageSize, (this.page + 1) * pageSize);
      if (!visible.length) visible.push(element('li', 'finale-empty', 'Нет участников раунда'));
      this.list.replaceChildren(...visible);
    }
    byId('finale-pagination').hidden = this.pages <= 1;
    const label = `${this.page + 1} / ${this.pages}`;
    if (byId('finale-page').textContent !== label) byId('finale-page').textContent = label;
  }

  changePage(step) {
    this.page = (this.page + step + this.pages) % this.pages;
    this.renderPage();
  }

  reset() {
    this.page = 0;
    this.pageSignature = null;
  }
}
