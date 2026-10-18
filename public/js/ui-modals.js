import { store } from './store.js';
import { dom } from './dom.js';
import { initAudio, playUiClickSound } from './audio.js';
import { showToast } from './ui-notifications.js';

let copyResultResetTimer = null;

function openAllItemsModal() {
  if (!store.appState) return;
  renderAllItemsModal(store.appState);
  dom.modalAllItems.classList.remove('hidden');
}

function closeAllItemsModal() {
  dom.modalAllItems.classList.add('hidden');
}

function renderHelpModal(state) {
  const isHost = Boolean(state.me && state.me.isHost);
  const isSpectator = Boolean(state.me && state.me.isSpectator);
  const steps = isHost
    ? [
        {
          title: 'Этап 1. Подготовьте тайный пул',
          items: [
            'Задайте правила игры: бюджет очков, лимит вариантов и ограничения ставок. Их можно менять, пока идёт сбор пула.',
            'Как участник, добавьте свои варианты, распределите между лотами очки и нажмите «Я готов», когда закончите.',
            'Следите за готовностью игроков. При необходимости удалите чужой вариант или исключите игрока.'
          ]
        },
        {
          title: 'Этап 2. Откройте пул и запустите колесо',
          items: [
            'Когда готовы все участники, ставки раскроются. До первого вращения можно объединить дубликаты.',
            'При необходимости настройте длительность, затем запускайте отдельные вращения или авто-крутку до победителя.',
            'После каждого раунда выбывает один вариант; участники наблюдают за колесом и историей выбывания.'
          ]
        },
        {
          title: 'Этап 3. Завершите игру',
          items: [
            'Когда останется один вариант, он станет победителем. Откройте «Историю», чтобы посмотреть варианты и статистику.',
            'Чтобы начать следующий раунд, выберите нужный сброс в панели ведущего: сохранить лоты, очистить лоты или полностью очистить комнату.'
          ]
        }
      ]
    : isSpectator
      ? [
          {
            title: 'Этап 1. Наблюдайте за сбором пула',
            items: [
              'Участники добавляют варианты и распределяют между ними очки. До готовности всех игроков чужие ставки скрыты.',
              'Когда все участники будут готовы, пул и ставки откроются. Зрителю не нужно добавлять варианты или отмечать готовность.'
            ]
          },
          {
            title: 'Этап 2. Следите за колесом',
            items: [
              'После раскрытия пула ведущий запускает колесо. В каждом раунде один вариант выбывает; наблюдать за ходом игры можно на колесе и в истории выбывания.'
            ]
          },
          {
            title: 'Этап 3. Посмотрите результат',
            items: [
              'Когда останется один вариант, он станет победителем. В «Истории» доступны варианты, а после финала — статистика.'
            ]
          }
        ]
    : [
        {
          title: 'Этап 1. Предложите варианты и распределите очки',
          items: [
            'Добавьте свои варианты в общий пул, пока не достигнут лимит.',
            'Распределите свой бюджет очков между вариантами с учётом правил ведущего. До готовности всех игроков чужие ставки скрыты.',
            'Когда закончите, нажмите «Я готов». После этого все участники увидят общий пул и ставки.'
          ]
        },
        {
          title: 'Этап 2. Следите за колесом',
          items: [
            'После раскрытия ставок колесо по очереди исключает варианты. Чем меньше у варианта очков, тем выше риск выбывания.',
            'Вращение запускает ведущий; вы можете наблюдать за раундами и историей выбывания.'
          ]
        },
        {
          title: 'Этап 3. Посмотрите результат',
          items: [
            'Когда останется один вариант, он станет победителем. В «Истории» доступны все варианты и, после финала, статистика.'
          ]
        }
      ];

  dom.modalHelpTitle.textContent = isHost
    ? 'КАК ПРОВЕСТИ АУКЦИОН — ВЕДУЩЕМУ'
    : isSpectator ? 'КАК СЛЕДИТЬ ЗА АУКЦИОНОМ — ЗРИТЕЛЮ' : 'КАК ПРОЙТИ АУКЦИОН — УЧАСТНИКУ';
  dom.modalHelpSubtitle.textContent = isHost
    ? 'Ведущий настраивает ход игры и тоже может участвовать: добавлять варианты, ставить очки и отмечать готовность.'
    : isSpectator
      ? 'Зритель наблюдает за игрой и не участвует в добавлении вариантов, ставках и готовности.'
      : 'Памятка участника: от заполнения тайного пула до просмотра результата.';
  dom.modalHelpContent.replaceChildren();

  for (const step of steps) {
    const section = document.createElement('section');
    section.className = 'help-step';
    const heading = document.createElement('h3');
    heading.textContent = step.title;
    const list = document.createElement('ol');
    for (const text of step.items) {
      const item = document.createElement('li');
      item.textContent = text;
      list.appendChild(item);
    }
    section.append(heading, list);
    dom.modalHelpContent.appendChild(section);
  }
}

function openHelpModal() {
  if (!store.appState || !store.appState.me) return;
  renderHelpModal(store.appState);
  dom.modalHelp.classList.remove('hidden');
}

function closeHelpModal() {
  dom.modalHelp.classList.add('hidden');
}

function switchHistoryTab(tab) {
  const showStats = tab === 'stats' && !dom.tabBtnStats.disabled;
  dom.tabBtnAll.classList.toggle('active', !showStats);
  dom.tabBtnStats.classList.toggle('active', showStats);
  dom.tabBtnAll.setAttribute('aria-selected', String(!showStats));
  dom.tabBtnStats.setAttribute('aria-selected', String(showStats));
  dom.modalTabAll.classList.toggle('hidden', showStats);
  dom.modalTabStats.classList.toggle('hidden', !showStats);
  if (showStats) {
    dom.modalAllItemsSubtitle.textContent = 'Итоги матча, вкладчики в победный вариант, выживаемость лотов и распределение эффективных очков:';
  } else if (store.appState) {
    const isRevealed = store.appState.phase === 'REVEAL' || store.appState.phase === 'FINISHED';
    const showingStats = dom.tabBtnStats.classList.contains('active') && isFinished;
    dom.modalAllItemsSubtitle.textContent = showingStats
      ? 'Итоги матча, вкладчики в победный вариант, выживаемость лотов и распределение эффективных очков:'
      : isRevealed
        ? 'Полный список всех предложенных вариантов (включая нулевые и объединённые) и кто сколько очков вложил:'
        : 'Полный список всех добавленных вариантов в пуле (ставки других участников откроются на этапе колеса):';
  }
}

function buildResultSummaryText(state) {
  const allItems = state.allItems || [];
  const history = state.wheel.history || [];
  const winner = state.wheel.winner || allItems.find(item => item.isWinner);
  const winningItem = winner && allItems.find(item => item.id === winner.id);
  const winnerTitle = winner ? winner.title : 'Не определён';
  const winnerPoints = winner ? Number(winner.totalPoints) || 0 : 0;
  const winnerAuthor = winningItem ? winningItem.createdByName || 'Удалённый игрок' : 'Неизвестен';
  const contributors = winningItem ? [...(winningItem.contributors || [])]
    .sort((a, b) => (Number(b.points) || 0) - (Number(a.points) || 0))
    .slice(0, 3) : [];
  const contributorLines = contributors.length
    ? contributors.map(contributor => `• ${contributor.name} — ${contributor.points} очк.`)
    : ['Без ставок (0 очк.)'];
  const lastEliminations = history.slice(-3);
  const eliminationLines = lastEliminations.length
    ? lastEliminations.map((item, index) => {
      const round = history.length - lastEliminations.length + index + 1;
      return `• Раунд ${round}: «${item.title}» — ${item.totalPoints} очк.`;
    })
    : ['• Выбывших вариантов нет.'];

  return [
    '🎡 ИТОГИ АУКЦИОНА НА ВЫБЫВАНИЕ',
    '',
    `🏆 Победитель: «${winnerTitle}» — ${winnerPoints} очк. (Автор: ${winnerAuthor})`,
    '',
    '💰 Главные вкладчики в победителя:',
    ...contributorLines,
    '',
    '🥈 Дошли до финала (последние выбывшие):',
    ...eliminationLines
  ].join('\n');
}

function copyTextWithFallback(text) {
  const copyWithTextarea = () => {
    if (typeof document.execCommand !== 'function') return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    try {
      textarea.select();
      return document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  };

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    return navigator.clipboard.writeText(text).catch(error => {
      if (copyWithTextarea()) return;
      throw error;
    });
  }
  if (copyWithTextarea()) return Promise.resolve();
  return Promise.reject(new Error('Clipboard API and document.execCommand are unavailable'));
}

async function copyResultSummary() {
  const state = store.appState;
  if (!state || state.phase !== 'FINISHED') return;

  initAudio();
  playUiClickSound();
  try {
    await copyTextWithFallback(buildResultSummaryText(state));
    showToast('Скопировано в буфер обмена');
    clearTimeout(copyResultResetTimer);
    dom.btnCopyResult.textContent = '✓ Скопировано';
    dom.btnCopyResult.classList.add('copied');
    copyResultResetTimer = setTimeout(() => {
      dom.btnCopyResult.textContent = '📋 Результат';
      dom.btnCopyResult.classList.remove('copied');
      copyResultResetTimer = null;
    }, 1500);
  } catch (error) {
    console.warn('Не удалось скопировать сводку результатов', error);
    showToast('Не удалось скопировать результат');
  }
}

function renderAllItemsModal(state) {
  const allItems = state.allItems || [];
  dom.allItemsCountEl.textContent = String(allItems.length);
  const isFinished = state.phase === 'FINISHED';
  dom.tabBtnStats.disabled = !isFinished;
  dom.tabBtnStats.title = isFinished
    ? 'Показать статистику и графики аукциона'
    : 'Доступно после определения победителя';
  dom.btnCopyResult.disabled = !isFinished;
  dom.btnCopyResult.title = isFinished
    ? 'Скопировать красивую сводку результатов в буфер обмена'
    : 'Доступно после определения победителя';
  if (!isFinished) switchHistoryTab('all');

  const isRevealed = state.phase === 'REVEAL' || state.phase === 'FINISHED';
  dom.modalAllItemsSubtitle.textContent = isRevealed
    ? 'Полный список всех предложенных вариантов (включая нулевые и объединённые) и кто сколько очков вложил:'
    : 'Полный список всех добавленных вариантов в пуле (ставки других участников откроются на этапе колеса):';

  dom.allItemsModalList.replaceChildren();

  if (allItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted-text';
    empty.textContent = 'Пока не добавлено ни одного варианта.';
    dom.allItemsModalList.appendChild(empty);
  } else allItems.forEach((item, index) => {
    const row = document.createElement('div');
    row.className = 'all-item-row';

    const top = document.createElement('div');
    top.className = 'all-item-top';

    const title = document.createElement('span');
    title.className = 'all-item-title';
    title.textContent = `${index + 1}. ${item.title}`;

    const badges = document.createElement('div');
    badges.className = 'all-item-badges';

    if (item.isFreeSlot) {
      const freeBadge = document.createElement('span');
      freeBadge.className = 'extra-lot-badge';
      freeBadge.textContent = '+ ДОП';
      badges.appendChild(freeBadge);
    }

    if (!isRevealed) {
      if (item.myPoints > 0) {
        const myBadge = document.createElement('span');
        myBadge.className = 'badge';
        myBadge.textContent = `Мои очки: ${item.myPoints}`;
        badges.appendChild(myBadge);
      }
    } else {
      const totalBadge = document.createElement('span');
      totalBadge.className = 'badge';
      totalBadge.textContent = `Всего: ${item.totalPoints} очк.`;
      badges.appendChild(totalBadge);

      const statusBadge = document.createElement('span');
      statusBadge.className = 'badge';
      if (item.isWinner) {
        statusBadge.textContent = '🏆 Победитель';
      } else if (item.isMerged) {
        statusBadge.textContent = `Влит в «${item.mergedIntoTitle || 'другой лот'}»`;
      } else if (item.droppedZero) {
        statusBadge.textContent = '0 очков (не на колесе)';
      } else if (item.eliminated) {
        statusBadge.textContent = 'Выбыл';
      } else {
        statusBadge.textContent = 'На колесе';
      }
      badges.appendChild(statusBadge);
    }

    top.append(title, badges);
    row.appendChild(top);

    // На этапе колеса показываем кто именно сколько очков закинул в этот вариант
    if (isRevealed) {
      const contribWrap = document.createElement('div');
      contribWrap.className = 'all-item-contributors';

      if (!item.contributors || item.contributors.length === 0) {
        const none = document.createElement('span');
        none.className = 'muted-text small-text';
        none.textContent = 'Никто не вложил очки (0 очк.)';
        contribWrap.appendChild(none);
      } else {
        item.contributors.forEach((c) => {
          const chip = document.createElement('span');
          chip.className = `contributor-chip ${c.isMe ? 'is-me' : ''}`;
          chip.textContent = `${c.name}: ${c.points} очк.`;
          contribWrap.appendChild(chip);
        });
      }
      row.appendChild(contribWrap);
    }

    dom.allItemsModalList.appendChild(row);
  });

  renderHistoryStats(state);
}

function renderHistoryStats(state) {
  dom.modalTabStats.replaceChildren();
  if (state.phase !== 'FINISHED') return;

  const allItems = state.allItems || [];
  const history = state.wheel.history || [];
  const winner = state.wheel.winner || allItems.find(item => item.isWinner);
  const uniqueItems = allItems.filter(item => !item.isMerged);
  const totalPoints = uniqueItems.reduce((sum, item) => sum + (Number(item.totalPoints) || 0), 0);
  const eliminationRounds = new Map(history.map((item, index) => [item.id, index + 1]));
  const stats = document.createElement('div');
  stats.className = 'history-stats';

  const summary = document.createElement('section');
  summary.className = 'history-stat-card';
  const summaryTitle = document.createElement('h3');
  summaryTitle.textContent = 'Итоги аукциона';
  const summaryValues = document.createElement('div');
  summaryValues.className = 'history-summary';
  for (const [label, value] of [
    ['Победитель', winner ? winner.title : 'Не определён'],
    ['Пул очков', `${totalPoints} очк.`],
    ['Раунды / выбывшие', `${history.length} / ${history.length}`]
  ]) {
    const entry = document.createElement('div');
    entry.className = 'history-summary-item';
    const caption = document.createElement('span');
    caption.textContent = label;
    const result = document.createElement('strong');
    result.textContent = value;
    entry.append(caption, result);
    summaryValues.appendChild(entry);
  }
  summary.append(summaryTitle, summaryValues);
  stats.appendChild(summary);

  const contributorsCard = document.createElement('section');
  contributorsCard.className = 'history-stat-card';
  const contributorsTitle = document.createElement('h3');
  contributorsTitle.textContent = 'Вкладчики в победный вариант';
  const contributors = document.createElement('ol');
  contributors.className = 'history-stat-list';
  const winningItem = allItems.find(item => winner && item.id === winner.id);
  const winnerContributors = winningItem ? winningItem.contributors || [] : [];
  if (winnerContributors.length) {
    [...winnerContributors]
      .sort((a, b) => b.points - a.points)
      .forEach(contributor => {
        const entry = document.createElement('li');
        entry.textContent = `${contributor.name}: ${contributor.points} очк.`;
        contributors.appendChild(entry);
      });
  } else {
    const entry = document.createElement('li');
    entry.textContent = 'В победный вариант никто не вложил очки.';
    contributors.appendChild(entry);
  }
  contributorsCard.append(contributorsTitle, contributors);
  stats.appendChild(contributorsCard);

  const survivalCard = document.createElement('section');
  survivalCard.className = 'history-stat-card';
  const survivalTitle = document.createElement('h3');
  survivalTitle.textContent = 'Выживаемость лотов';
  const survival = document.createElement('ol');
  survival.className = 'history-stat-list';
  allItems.forEach(item => {
    const entry = document.createElement('li');
    const round = eliminationRounds.get(item.id);
    if (round) entry.textContent = `${item.title} — выбыл в раунде ${round}`;
    else if (winner && item.id === winner.id) entry.textContent = `${item.title} — победитель, пережил ${history.length} раундов`;
    else if (item.droppedZero) entry.textContent = `${item.title} — не участвовал (0 очков)`;
    else if (item.isMerged) entry.textContent = `${item.title} — объединён с «${item.mergedIntoTitle || 'другим лотом'}»`;
    else entry.textContent = `${item.title} — продержался ${history.length} раундов`;
    survival.appendChild(entry);
  });
  survivalCard.append(survivalTitle, survival);
  stats.appendChild(survivalCard);

  const playerStats = new Map();
  const playerKey = (id, name) => id || `name:${name}`;
  const ensurePlayer = (id, name) => {
    const key = playerKey(id, name);
    if (!playerStats.has(key)) {
      playerStats.set(key, { id, name, invested: 0, returned: 0, earlyOut: 0, finalist: 0, other: 0 });
    }
    return playerStats.get(key);
  };
  (state.players || []).filter(player => !player.isSpectator).forEach(player => {
    ensurePlayer(player.id, player.name);
  });
  uniqueItems.forEach(item => {
    (item.contributors || []).forEach(contributor => {
      ensurePlayer(contributor.playerId, contributor.name).invested += Number(contributor.points) || 0;
    });
  });

  if (winner) {
    const mergedSources = allItems.filter(item => item.isMerged && item.mergedIntoId === winner.id);
    const winnerPoints = Math.max(0, Number(winner.totalPoints) || 0);
    const mergedPoints = mergedSources.reduce((sum, item) => sum + (Number(item.totalPoints) || 0), 0);
    const origins = [
      ...mergedSources.map(item => ({
        playerId: item.createdByPlayerId,
        name: item.createdByName || 'Участник',
        points: Number(item.totalPoints) || 0
      })),
      {
        playerId: winningItem && winningItem.createdByPlayerId,
        name: winningItem && winningItem.createdByName || 'Участник',
        points: Math.max(0, winnerPoints - mergedPoints)
      }
    ];
    origins.forEach(origin => {
      if (winnerPoints > 0 && origin.points > 0) {
        ensurePlayer(origin.playerId, origin.name).returned += origin.points;
      }
    });
  }

  const roiCard = document.createElement('section');
  roiCard.className = 'history-stat-card';
  const roiTitle = document.createElement('h3');
  roiTitle.textContent = 'Эффективность инвестиций (КПД поинтов)';
  const roiNote = document.createElement('p');
  roiNote.className = 'muted-text small-text';
  roiNote.textContent = 'КПД = возврат очков победного лота / вложенные очки × 100%. При отсутствии вложений значение не рассчитывается.';
  const roiTable = document.createElement('div');
  roiTable.className = 'stats-table';
  const roiHeader = document.createElement('div');
  roiHeader.className = 'stats-table-row stats-table-header';
  ['Участник', 'Вложено', 'Возврат', 'КПД'].forEach(label => {
    const cell = document.createElement('strong');
    cell.textContent = label;
    roiHeader.appendChild(cell);
  });
  roiTable.appendChild(roiHeader);
  [...playerStats.values()]
    .sort((a, b) => {
      const efficiencyA = a.invested ? a.returned / a.invested : -1;
      const efficiencyB = b.invested ? b.returned / b.invested : -1;
      return efficiencyB - efficiencyA || b.returned - a.returned;
    })
    .forEach(player => {
      const row = document.createElement('div');
      row.className = 'stats-table-row';
      const efficiency = player.invested
        ? Math.max(0, (player.returned / player.invested) * 100)
        : null;
      const values = [
        player.name,
        `${player.invested} очк.`,
        `${player.returned.toFixed(1)} очк.`,
        efficiency === null ? '—' : `${efficiency.toFixed(0)}%`
      ];
      values.forEach(value => {
        const cell = document.createElement('span');
        cell.textContent = value;
        row.appendChild(cell);
      });
      roiTable.appendChild(row);
    });
  roiCard.append(roiTitle, roiNote, roiTable);
  stats.appendChild(roiCard);

  const precisionCard = document.createElement('section');
  precisionCard.className = 'history-stat-card';
  const precisionTitle = document.createElement('h3');
  precisionTitle.textContent = 'Индекс меткого выбора (удача vs ставки)';
  const precisionNote = document.createElement('p');
  precisionNote.className = 'muted-text small-text';
  precisionNote.textContent = 'Ранние выбывания — первая половина раундов; финалисты — победитель и лот, выбывший последним.';
  const precisionRows = document.createElement('div');
  precisionRows.className = 'stats-precision-list';
  const lastRound = history.length;
  const earlyRoundLimit = Math.floor(lastRound / 2);
  uniqueItems.forEach(item => {
    const round = eliminationRounds.get(item.id);
    const category = item.isWinner || round === lastRound
      ? 'finalist'
      : round && round <= earlyRoundLimit ? 'earlyOut' : 'other';
    (item.contributors || []).forEach(contributor => {
      const player = ensurePlayer(contributor.playerId, contributor.name);
      player[category] += Number(contributor.points) || 0;
    });
  });
  [...playerStats.values()]
    .filter(player => player.earlyOut + player.finalist + player.other > 0)
    .sort((a, b) => (b.finalist - b.earlyOut) - (a.finalist - a.earlyOut))
    .forEach(player => {
      const total = player.earlyOut + player.finalist + player.other;
      const row = document.createElement('div');
      row.className = 'stats-precision-row';
      const name = document.createElement('strong');
      name.textContent = player.name;
      const track = document.createElement('div');
      track.className = 'stats-progress-bar stats-stacked-bar';
      for (const [amount, tone] of [
        [player.earlyOut, 'early-out'],
        [player.finalist, 'finalist'],
        [player.other, 'other']
      ]) {
        const fill = document.createElement('span');
        fill.className = `stats-progress-fill ${tone}`;
        fill.style.width = `${total ? (amount / total) * 100 : 0}%`;
        track.appendChild(fill);
      }
      const detail = document.createElement('span');
      detail.className = 'stats-precision-detail';
      detail.textContent = `Аутсайдеры: ${player.earlyOut} · Финалисты: ${player.finalist} · Остальные: ${player.other}`;
      row.append(name, track, detail);
      precisionRows.appendChild(row);
    });
  precisionCard.append(precisionTitle, precisionNote, precisionRows);
  stats.appendChild(precisionCard);

  const timelineCard = document.createElement('section');
  timelineCard.className = 'history-stat-card';
  const timelineTitle = document.createElement('h3');
  timelineTitle.textContent = 'Динамика шансов победы по раундам';
  const timelineNote = document.createElement('p');
  timelineNote.className = 'muted-text small-text';
  timelineNote.textContent = 'Линии показывают вероятность победы среди оставшихся вариантов; на раунде вылета линия заканчивается крестиком.';
  const timeline = document.createElement('div');
  timeline.className = 'stats-timeline';
  const alive = new Map((state.items || [])
    .filter(item => Number(item.effectivePoints) > 0)
    .map(item => [item.id, item]));
  const chartItems = [...alive.values()]
    .sort((a, b) => (Number(b.effectivePoints) || 0) - (Number(a.effectivePoints) || 0));
  const snapshots = [new Map(alive)];
  history.forEach((eliminated, index) => {
    alive.delete(eliminated.id);
    snapshots.push(new Map(alive));
  });
  const graphWidth = 800;
  const graphHeight = 320;
  const graphLeft = 48;
  const graphRight = 780;
  const graphTop = 20;
  const graphBottom = 270;
  const plotWidth = graphRight - graphLeft;
  const plotHeight = graphBottom - graphTop;
  const graph = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  graph.setAttribute('viewBox', `0 0 ${graphWidth} ${graphHeight}`);
  graph.setAttribute('role', 'img');
  graph.setAttribute('aria-label', 'График вероятности победы вариантов по раундам');
  graph.classList.add('stats-probability-chart');

  for (const percentage of [0, 25, 50, 75, 100]) {
    const y = graphBottom - (percentage / 100) * plotHeight;
    const gridLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    gridLine.setAttribute('x1', String(graphLeft));
    gridLine.setAttribute('x2', String(graphRight));
    gridLine.setAttribute('y1', String(y));
    gridLine.setAttribute('y2', String(y));
    gridLine.classList.add('stats-chart-gridline');
    graph.appendChild(gridLine);

    const axisLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    axisLabel.setAttribute('x', String(graphLeft - 8));
    axisLabel.setAttribute('y', String(y + 4));
    axisLabel.setAttribute('text-anchor', 'end');
    axisLabel.classList.add('stats-chart-axis-label');
    axisLabel.textContent = `${percentage}%`;
    graph.appendChild(axisLabel);
  }

  const labelInterval = Math.max(1, Math.ceil((snapshots.length - 1) / 8));
  snapshots.forEach((snapshot, roundIndex) => {
    if (roundIndex !== 0 && roundIndex !== snapshots.length - 1 && roundIndex % labelInterval !== 0) return;
    const x = graphLeft + (snapshots.length > 1 ? (roundIndex / (snapshots.length - 1)) * plotWidth : plotWidth / 2);
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', String(x));
    label.setAttribute('y', '296');
    label.setAttribute('text-anchor', 'middle');
    label.classList.add('stats-chart-axis-label');
    label.textContent = roundIndex === 0 ? 'Старт' : `Раунд ${roundIndex}`;
    graph.appendChild(label);
  });

  const legend = document.createElement('div');
  legend.className = 'stats-chart-legend';
  const chartColors = [
    '#e57373', '#64b5f6', '#81c784', '#ffb74d', '#ba68c8',
    '#4dd0e1', '#f06292', '#aed581', '#7986cb', '#ffd54f'
  ];
  const xForRound = roundIndex =>
    graphLeft + (snapshots.length > 1 ? (roundIndex / (snapshots.length - 1)) * plotWidth : plotWidth / 2);
  chartItems.forEach((item, itemIndex) => {
    const color = chartColors[itemIndex % chartColors.length];
    const eliminationRound = history.findIndex(eliminated => eliminated.id === item.id) + 1;
    const lastVisibleRound = eliminationRound ? eliminationRound - 1 : snapshots.length - 1;
    const points = snapshots.slice(0, lastVisibleRound + 1).map((snapshot, roundIndex) => {
      const totalWeight = [...snapshot.values()].reduce(
        (sum, snapshotItem) => sum + (Number(snapshotItem.effectivePoints) || 0), 0
      );
      const current = snapshot.get(item.id);
      const probability = current && totalWeight
        ? (Number(current.effectivePoints) / totalWeight) * 100
        : 0;
      const x = xForRound(roundIndex);
      const y = graphBottom - (probability / 100) * plotHeight;
      return { x, y };
    });
    if (eliminationRound && points.length > 0) {
      points.push({ x: xForRound(eliminationRound), y: points[points.length - 1].y });
    }
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    line.setAttribute('points', points.map(point => `${point.x},${point.y}`).join(' '));
    line.setAttribute('stroke', color);
    line.classList.add('stats-chart-series');
    graph.appendChild(line);
    points.slice(0, lastVisibleRound + 1).forEach(point => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      dot.setAttribute('cx', String(point.x));
      dot.setAttribute('cy', String(point.y));
      dot.setAttribute('r', '3');
      dot.setAttribute('fill', color);
      dot.classList.add('stats-chart-point');
      graph.appendChild(dot);
    });
    if (eliminationRound && points.length > 0) {
      const exitPoint = points[points.length - 1];
      const cross = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const crossSize = 4;
      cross.setAttribute(
        'd',
        `M ${exitPoint.x - crossSize} ${exitPoint.y - crossSize} L ${exitPoint.x + crossSize} ${exitPoint.y + crossSize} ` +
        `M ${exitPoint.x + crossSize} ${exitPoint.y - crossSize} L ${exitPoint.x - crossSize} ${exitPoint.y + crossSize}`
      );
      cross.setAttribute('stroke', color);
      cross.classList.add('stats-chart-elimination-cross');
      graph.appendChild(cross);
    }

    const legendEntry = document.createElement('span');
    legendEntry.className = 'stats-chart-legend-entry';
    const swatch = document.createElement('span');
    swatch.className = 'stats-chart-legend-swatch';
    swatch.style.backgroundColor = color;
    const itemName = document.createElement('span');
    itemName.textContent = item.title;
    legendEntry.append(swatch, itemName);
    legend.appendChild(legendEntry);
  });
  timeline.append(graph, legend);
  timelineCard.append(timelineTitle, timelineNote, timeline);
  stats.appendChild(timelineCard);
  dom.modalTabStats.appendChild(stats);
}

export { openAllItemsModal, closeAllItemsModal, renderHelpModal, openHelpModal, closeHelpModal, switchHistoryTab, copyResultSummary, renderAllItemsModal };
