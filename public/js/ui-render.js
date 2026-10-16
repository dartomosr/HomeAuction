import { store, writeSetting } from './store.js';
import { dom } from './dom.js';
import { ELIMINATION_EFFECTS, THEME_WHEEL_PALETTES } from './constants.js';
import { initAudio, playUiSliderSound, playUiMessageSound } from './audio.js';

function updatePointsSplitPreview() {
  const total = Math.max(1, Number(dom.setMaxPoints.value) || 100);
  dom.setForeignOnly.max = total;
  const reserve = dom.setRestrictOwn.checked
    ? Math.max(0, Math.min(total, Number(dom.setForeignOnly.value) || 0)) : 0;
  dom.pointsSplitPreview.textContent = `${total - reserve} очк. — на свои и чужие; ${reserve} очк. — только на чужие.`;
}

function renderEffectsControls() {
  dom.effectsCheckboxes.replaceChildren();
  for (const [id, label] of ELIMINATION_EFFECTS) {
    const wrapper = document.createElement('label');
    wrapper.className = 'fx-checkbox-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = id;
    checkbox.checked = store.enabledEffects.includes(id);
    checkbox.disabled = !store.effectsEnabled;
    checkbox.addEventListener('change', () => {
      store.enabledEffects = checkbox.checked
        ? [...new Set([...store.enabledEffects, id])]
        : store.enabledEffects.filter(effect => effect !== id);
      writeSetting('auction_effect_list', JSON.stringify(store.enabledEffects));
      dom.effectsMasterToggle.checked = store.enabledEffects.length === ELIMINATION_EFFECTS.length;
      dom.effectsMasterToggle.indeterminate = store.enabledEffects.length > 0 && !dom.effectsMasterToggle.checked;
    });
    wrapper.append(checkbox, document.createTextNode(label));
    dom.effectsCheckboxes.appendChild(wrapper);
  }
  dom.effectsMasterToggle.checked = store.enabledEffects.length === ELIMINATION_EFFECTS.length;
  dom.effectsMasterToggle.indeterminate = store.enabledEffects.length > 0 && !dom.effectsMasterToggle.checked;
  dom.btnToggleEffects.textContent = store.effectsEnabled ? '✨ Эффекты: ВКЛ' : '◌ Эффекты: ВЫКЛ';
  dom.btnToggleEffects.setAttribute('aria-pressed', String(store.effectsEnabled));
}

function setAllEffects(enabled) {
  store.enabledEffects = enabled ? ELIMINATION_EFFECTS.map(([id]) => id) : [];
  writeSetting('auction_effect_list', JSON.stringify(store.enabledEffects));
  renderEffectsControls();
}

function applyTheme(themeName) {
  if (!THEME_WHEEL_PALETTES[themeName]) themeName = 'anime';
  store.currentTheme = themeName;
  document.documentElement.setAttribute('data-theme', themeName);
  const supportsBackgroundAnimation = ['anime', 'casino', 'terminal', 'paper', 'coffee', 'pastel-soft', 'nordic'].includes(themeName);
  dom.themeAnimationControl.classList.toggle('hidden', !supportsBackgroundAnimation);
  dom.themeAnimationToggle.checked = store.themeAnimationEnabled;
  document.body.classList.toggle(
    'has-animated-background-pattern',
    supportsBackgroundAnimation && store.themeAnimationEnabled
  );
  store.wheelLabelFont = getComputedStyle(document.body).fontFamily;
  writeSetting('auction_theme', themeName);
  if (dom.themeSelect.value !== themeName) dom.themeSelect.value = themeName;
  document.dispatchEvent(new Event('auction:theme-change'));
}

function updateSoundButton() {
  dom.btnSound.textContent = store.soundEnabled ? 'Звук: ВКЛ' : 'Звук: ВЫКЛ';
}

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

function renderAllItemsModal(state) {
  const allItems = state.allItems || [];
  dom.allItemsCountEl.textContent = String(allItems.length);
  const isFinished = state.phase === 'FINISHED';
  dom.tabBtnStats.disabled = !isFinished;
  dom.tabBtnStats.title = isFinished
    ? 'Показать статистику и графики аукциона'
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
  const effectivePoints = new Map(
    (state.items || []).map(item => [item.id, Number(item.effectivePoints) || 0])
  );
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

  const distributionCard = document.createElement('section');
  distributionCard.className = 'history-stat-card';
  const distributionTitle = document.createElement('h3');
  distributionTitle.textContent = 'Суммарные очки и эффективный вес';
  const distributionNote = document.createElement('p');
  distributionNote.className = 'muted-text small-text';
  distributionNote.textContent = 'Суммарные очки показаны отдельно от веса, определяющего шанс победы; для лота с нулём очков может учитываться настроенный вес.';
  const bars = document.createElement('div');
  bars.className = 'history-bar-list';
  const chartItems = [...uniqueItems].sort((a, b) =>
    (effectivePoints.get(b.id) || 0) - (effectivePoints.get(a.id) || 0)
  );
  const maxLotPoints = Math.max(0, ...chartItems.map(item => Number(item.totalPoints) || 0));
  const maxEffectivePoints = Math.max(0, ...chartItems.map(item => effectivePoints.get(item.id) || 0));
  chartItems.forEach(item => {
    const row = document.createElement('div');
    row.className = 'history-bar-row stats-chart-row';
    const title = document.createElement('span');
    title.className = 'history-bar-title';
    title.textContent = item.title;
    const measures = document.createElement('div');
    measures.className = 'stats-chart-measures';
    for (const [label, points, max, tone] of [
      ['Сумма', Number(item.totalPoints) || 0, maxLotPoints, 'raw'],
      ['Вес', effectivePoints.get(item.id) || 0, maxEffectivePoints, 'effective']
    ]) {
      const measure = document.createElement('div');
      measure.className = 'stats-chart-measure';
      const caption = document.createElement('span');
      caption.textContent = `${label}: ${points}`;
      const track = document.createElement('div');
      track.className = 'stats-progress-bar';
      const fill = document.createElement('div');
      fill.className = `stats-progress-fill ${tone}`;
      fill.style.width = `${max ? (points / max) * 100 : 0}%`;
      track.appendChild(fill);
      measure.append(caption, track);
      measures.appendChild(measure);
    }
    row.append(title, measures);
    bars.appendChild(row);
  });
  distributionCard.append(distributionTitle, distributionNote, bars);
  stats.appendChild(distributionCard);

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
  roiTitle.textContent = 'Эффективность инвестиций (ROI поинтов)';
  const roiNote = document.createElement('p');
  roiNote.className = 'muted-text small-text';
  roiNote.textContent = 'Возврат — доля очков победного лота, начисленная создателю исходного варианта; ROI = (возврат − вложения) / вложения.';
  const roiTable = document.createElement('div');
  roiTable.className = 'stats-table';
  const roiHeader = document.createElement('div');
  roiHeader.className = 'stats-table-row stats-table-header';
  ['Участник', 'Вложено', 'Возврат', 'ROI'].forEach(label => {
    const cell = document.createElement('strong');
    cell.textContent = label;
    roiHeader.appendChild(cell);
  });
  roiTable.appendChild(roiHeader);
  [...playerStats.values()]
    .sort((a, b) => {
      const roiA = a.invested ? (a.returned - a.invested) / a.invested : (a.returned ? Infinity : 0);
      const roiB = b.invested ? (b.returned - b.invested) / b.invested : (b.returned ? Infinity : 0);
      return roiB - roiA || b.returned - a.returned;
    })
    .forEach(player => {
      const row = document.createElement('div');
      row.className = 'stats-table-row';
      const roi = player.invested ? ((player.returned - player.invested) / player.invested) * 100 : null;
      const values = [
        player.name,
        `${player.invested} очк.`,
        `${player.returned.toFixed(1)} очк.`,
        roi === null ? '—' : `${roi.toFixed(0)}%`
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
  timelineNote.textContent = 'Вероятность каждого оставшегося лота рассчитывается как его эффективный вес относительно суммарного веса оставшихся.';
  const timeline = document.createElement('div');
  timeline.className = 'stats-timeline';
  const alive = new Map((state.items || [])
    .filter(item => Number(item.effectivePoints) > 0)
    .map(item => [item.id, item]));
  const snapshots = [{
    label: 'До первого раунда',
    eliminated: null,
    items: [...alive.values()]
  }];
  history.forEach((eliminated, index) => {
    alive.delete(eliminated.id);
    snapshots.push({
      label: `После раунда ${index + 1}`,
      eliminated,
      items: [...alive.values()]
    });
  });
  snapshots.forEach(snapshot => {
    const round = document.createElement('div');
    round.className = 'stats-round';
    const heading = document.createElement('strong');
    heading.textContent = snapshot.eliminated
      ? `${snapshot.label} · выбыл: ${snapshot.eliminated.title}`
      : snapshot.label;
    round.appendChild(heading);
    const roundItems = snapshot.items;
    const totalWeight = roundItems.reduce((sum, item) => sum + (Number(item.effectivePoints) || 0), 0);
    roundItems.sort((a, b) => (Number(b.effectivePoints) || 0) - (Number(a.effectivePoints) || 0));
    roundItems.forEach(item => {
      const probability = totalWeight ? (Number(item.effectivePoints) / totalWeight) * 100 : 0;
      const line = document.createElement('div');
      line.className = 'stats-probability-row';
      const label = document.createElement('span');
      label.textContent = item.title;
      const track = document.createElement('div');
      track.className = 'stats-progress-bar';
      const fill = document.createElement('span');
      fill.className = 'stats-progress-fill probability';
      fill.style.width = `${probability}%`;
      track.appendChild(fill);
      const value = document.createElement('strong');
      value.textContent = `${probability.toFixed(1)}%`;
      line.append(label, track, value);
      round.appendChild(line);
    });
    timeline.appendChild(round);
  });
  timelineCard.append(timelineTitle, timelineNote, timeline);
  stats.appendChild(timelineCard);
  dom.modalTabStats.appendChild(stats);
}

// Уведомления

function showToast(msg) {
  playUiMessageSound();
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  dom.toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function renderSidebar(state) {
  const activePlayers = state.players.filter((p) => !p.isSpectator);
  const readyCount = activePlayers.filter((p) => p.ready).length;
  dom.readyCounterEl.textContent = `${readyCount} / ${activePlayers.length} готовы`;
  dom.mySpectatorBadge.classList.toggle('hidden', !state.me.isSpectator);

  dom.playersListEl.innerHTML = '';
  state.players.forEach((p) => {
    const li = document.createElement('li');
    li.className = `player-item ${p.online ? '' : 'is-offline'}`;

    const left = document.createElement('div');
    left.className = 'player-name-wrap';
    left.textContent = p.name + (p.isMe ? ' (Вы)' : '');

    if (p.isHost) {
      const hBadge = document.createElement('span');
      hBadge.className = 'host-tag';
      hBadge.textContent = 'HOST';
      left.appendChild(hBadge);
    }

    const rightWrap = document.createElement('div');
    rightWrap.className = 'player-right-wrap';

    if (p.isSpectator) {
      const spectatorTag = document.createElement('span');
      spectatorTag.className = 'spectator-tag';
      spectatorTag.textContent = '👁 ЗРИТЕЛЬ';
      rightWrap.appendChild(spectatorTag);
    } else {
      const status = document.createElement('span');
      status.className = `player-status ${p.ready ? 'status-ready' : 'status-wait'}`;
      status.textContent = p.ready ? 'ГОТОВ' : 'ДУМАЕТ';
      rightWrap.appendChild(status);
    }

    // Кнопка кика пользователя из лобби для Хоста
    if (p.canKick && !state.wheel.isSpinning) {
      const kickBtn = document.createElement('button');
      kickBtn.type = 'button';
      kickBtn.className = 'btn-kick-player';
      kickBtn.textContent = '✕';
      kickBtn.title = `Удалить игрока «${p.name}» из лобби`;
      kickBtn.addEventListener('click', () => {
        if (confirm(`Удалить участника «${p.name}» из лобби?`)) {
          store.socket.emit('kick_player', { playerId: p.id });
        }
      });
      rightWrap.appendChild(kickBtn);
    }

    li.appendChild(left);
    li.appendChild(rightWrap);
    dom.playersListEl.appendChild(li);
  });

// Сводка настроек
  dom.roMaxPoints.textContent = state.settings.maxPoints;
  dom.roMaxItems.textContent = state.settings.maxItems;
  dom.roFreeItems.textContent = state.settings.allowFreeItemsForAll ? 'Разрешены всем' : 'Только Хост';
  const foreignReserve = state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0;
  dom.roFlexiblePoints.textContent = state.settings.restrictOwnPoints
    ? `${state.settings.maxPoints - foreignReserve} очк.` : `Все ${state.settings.maxPoints} очк.`;
  dom.roForeignPoints.textContent = state.settings.restrictOwnPoints ? `${foreignReserve} очк.` : 'Нет ограничений';
  dom.roKeepZero.textContent = state.settings.keepZeroItems
    ? `На колесе (вес ${state.settings.zeroItemWeight})`
    : 'Удаляются';

  // Если мы Хост — показываем форму настроек
  if (state.me.isHost) {
    dom.hostSettingsForm.classList.remove('hidden');
    if (document.activeElement !== dom.setMaxPoints &&
        document.activeElement !== dom.setMaxItems &&
        document.activeElement !== dom.setForeignOnly &&
        document.activeElement !== dom.setZeroWeight) {
      dom.setMaxPoints.value = state.settings.maxPoints;
      dom.setMaxItems.value = state.settings.maxItems;
      dom.setAllowFreeAll.checked = Boolean(state.settings.allowFreeItemsForAll);
      dom.setRestrictOwn.checked = Boolean(state.settings.restrictOwnPoints);
      dom.setForeignOnly.value = state.settings.foreignOnlyPoints || 0;
      dom.ownLimitGroup.classList.toggle('hidden', !dom.setRestrictOwn.checked);
      updatePointsSplitPreview();
      dom.setKeepZero.checked = state.settings.keepZeroItems;
      dom.setZeroWeight.value = state.settings.zeroItemWeight;
      dom.zeroWeightGroup.classList.toggle('hidden', !state.settings.keepZeroItems);
    }
  } else {
    dom.hostSettingsForm.classList.add('hidden');
  }
}

function renderMainArea(state) {
  if (state.phase === 'POOL') {
    dom.viewPool.classList.remove('hidden');
    dom.viewReveal.classList.add('hidden');
    dom.wheelDurationPanel.classList.add('hidden');
    renderPoolView(state);
  } else {
    dom.viewPool.classList.add('hidden');
    dom.viewReveal.classList.remove('hidden');
    renderRevealView(state);
  }
}

function renderPoolView(state) {
  const isSpectator = Boolean(state.me.isSpectator);
  dom.poolDashboard.classList.toggle('hidden', isSpectator);
  dom.addItemCard.classList.toggle('hidden', isSpectator);

  dom.myRemainingPointsEl.textContent = state.me.remainingPoints;
  dom.myMaxPointsEl.textContent = state.settings.maxPoints;
  dom.myItemsCountEl.textContent = state.me.myItemsCount;
  dom.myMaxItemsEl.textContent = state.settings.maxItems;
  const reserve = state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0;
  dom.poolFlexiblePoints.textContent = state.settings.maxPoints - reserve;
  dom.poolFlexibleNote.textContent = reserve
    ? 'Максимум, доступный для собственных лотов'
    : 'Все очки доступны для любых ставок';
  dom.poolForeignPoints.textContent = reserve ? reserve : '—';
  dom.poolForeignUnit.textContent = reserve ? ' очк.' : '';
  dom.poolForeignNote.textContent = reserve
    ? 'Резерв: можно тратить только на чужие лоты'
    : 'Ограничения отключены';

  const isLocked = state.me.ready;
  const canUseFreeSlot = Boolean(state.me.isHost || state.settings.allowFreeItemsForAll);
  const limitReached = state.me.myItemsCount >= state.settings.maxItems;

  dom.inputItemTitle.disabled = isLocked || (limitReached && !canUseFreeSlot);
  dom.btnAddItem.disabled = isLocked || limitReached;
  dom.btnAddFreeItem.classList.toggle('hidden', !canUseFreeSlot);
  dom.btnAddFreeItem.disabled = isLocked;
  dom.btnDistributeEven.disabled = isLocked || state.items.length === 0;
  dom.btnClearPoints.disabled = isLocked || state.me.mySpentPoints === 0;

  dom.btnReady.textContent = isLocked ? '✓ ВЫ ГОТОВЫ (ОТМЕНИТЬ)' : 'Я ГОТОВ';
  dom.btnReady.classList.toggle('is-ready', isLocked);

  dom.poolItemCount.textContent = state.items.length;
  dom.poolItemFilters.querySelectorAll('[data-pool-filter]').forEach((button) => {
    const isActive = button.dataset.poolFilter === store.poolFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  dom.poolItemsList.innerHTML = '';
  const visibleItems = state.items.filter((item) => {
    if (store.poolFilter === 'own') return item.isOwn;
    if (store.poolFilter === 'others') return !item.isOwn;
    return true;
  });
  if (visibleItems.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted-text';
    empty.textContent = state.items.length === 0
      ? (isSpectator
        ? 'В пуле пока нет вариантов.'
        : 'Пока никто не добавил ни одного варианта. Будьте первым!')
      : (store.poolFilter === 'own'
        ? 'У вас пока нет своих вариантов.'
        : store.poolFilter === 'others'
          ? 'Чужих вариантов пока нет.'
          : 'В пуле пока нет вариантов.');
    dom.poolItemsList.appendChild(empty);
    return;
  }

  visibleItems.forEach((item) => {
    const card = document.createElement('div');
    card.className = `pool-item-card ${item.myPoints > 0 ? 'has-my-points' : ''}`;

    const left = document.createElement('div');
    left.className = 'pool-item-left';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pool-item-title';
    titleSpan.textContent = item.title;
    left.appendChild(titleSpan);

    if (item.isFreeSlot) {
      const freeBadge = document.createElement('span');
      freeBadge.className = 'extra-lot-badge';
      freeBadge.textContent = '+ ДОП';
      freeBadge.title = 'Добавлен вне лимита вариантов';
      left.appendChild(freeBadge);
    }

    // 1) Свой вариант: обычный красный крестик ✕
    if (!isSpectator && item.canDelete && !isLocked) {
      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'btn btn-danger btn-sm';
      delBtn.textContent = '✕';
      delBtn.title = 'Удалить мой вариант';
      delBtn.addEventListener('click', () => {
        store.socket.emit('delete_item', { itemId: item.id });
      });
      left.appendChild(delBtn);
    }
    // 2) Чужой вариант (для Хоста): другой значок ⊘ Хост с пунктирной рамкой
    else if (!isSpectator && item.canHostDelete) {
      const hostDelBtn = document.createElement('button');
      hostDelBtn.type = 'button';
      hostDelBtn.className = 'btn btn-host-delete btn-sm';
      hostDelBtn.textContent = '⊘ Хост';
      hostDelBtn.title = 'Удалить чужой вариант (право Хоста)';
      hostDelBtn.addEventListener('click', () => {
        if (confirm(`Удалить чужой вариант «${item.title}»?`)) {
          store.socket.emit('delete_item', { itemId: item.id });
        }
      });
      left.appendChild(hostDelBtn);
    }

    if (isSpectator) {
      card.appendChild(left);
      dom.poolItemsList.appendChild(card);
      return;
    }

    const controls = document.createElement('div');
    controls.className = 'pool-item-controls';

    const ownLimit = state.settings.maxPoints - reserve;
    const allowedByOwnership = item.canDelete
      ? Math.max(0, ownLimit - (state.me.mySpentOwnPoints - item.myPoints))
      : state.settings.maxPoints;
    const maxPossibleForThisItem = Math.max(0, Math.min(item.myPoints + state.me.remainingPoints, allowedByOwnership));

    const makeStepBtn = (label, delta) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn btn-sm';
      b.textContent = label;
      b.disabled = isLocked;
      b.addEventListener('click', () => {
        initAudio();
        playUiSliderSound();
        store.socket.emit('set_points', {
          itemId: item.id,
          points: Math.max(0, item.myPoints + delta)
        });
      });
      return b;
    };

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pts-slider';
    slider.min = 0;
    slider.max = state.settings.maxPoints;
    slider.value = item.myPoints;
    slider.disabled = isLocked;
    slider.addEventListener('input', () => {
      initAudio();
      playUiSliderSound();
      const clamped = Math.min(Number(slider.value), maxPossibleForThisItem);
      slider.value = clamped;
      numInput.value = clamped;
    });
    slider.addEventListener('change', () => {
      store.socket.emit('set_points', { itemId: item.id, points: Number(slider.value) });
    });

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'input-text pts-input';
    numInput.min = 0;
    numInput.max = maxPossibleForThisItem;
    numInput.value = item.myPoints;
    numInput.disabled = isLocked;
    numInput.addEventListener('change', () => {
      store.socket.emit('set_points', { itemId: item.id, points: Number(numInput.value) });
    });

    controls.appendChild(makeStepBtn('-10', -10));
    controls.appendChild(makeStepBtn('-1', -1));
    controls.appendChild(slider);
    controls.appendChild(numInput);
    controls.appendChild(makeStepBtn('+1', 1));
    controls.appendChild(makeStepBtn('+10', 10));

    card.appendChild(left);
    card.appendChild(controls);
    dom.poolItemsList.appendChild(card);
  });
}

// Добавление варианта (обычное или вне лимита + ДОП)

function renderRevealView(state) {
  dom.wheelDurationPanel.classList.remove('hidden');
  const canEditDuration = state.me.isHost && state.phase === 'REVEAL';
  dom.hostDurationControl.classList.toggle('hidden', !canEditDuration);
  dom.durationReadonly.classList.toggle('hidden', canEditDuration);
  dom.durationReadonly.textContent = `${state.settings.spinDuration} сек.`;
  const lockedDuration = state.wheel.isSpinning || store.isAnimatingWheel || Boolean(store.activeElimination);
  [dom.setSpinDuration, dom.durationApply, dom.durationMinus, dom.durationPlus].forEach(el => el.disabled = lockedDuration);
  if (document.activeElement !== dom.setSpinDuration) dom.setSpinDuration.value = state.settings.spinDuration;
  const aliveItems = state.items.filter((i) => !i.eliminated);
  dom.aliveCounter.textContent = `В игре: ${aliveItems.length} из ${state.items.length}`;

  // Баннер победителя
  if (state.phase === 'FINISHED' && state.wheel.winner) {
    dom.winnerBanner.classList.remove('hidden');
    dom.winnerTitle.textContent = state.wheel.winner.title;
    dom.winnerPoints.textContent = `Суммарный пул варианта: ${state.wheel.winner.totalPoints} очков`;
    dom.wheelStatusBox.textContent = `Победитель аукциона: «${state.wheel.winner.title}»!`;
  } else {
    dom.winnerBanner.classList.add('hidden');
    if (!state.wheel.isSpinning && !store.isAnimatingWheel) {
      dom.wheelStatusBox.textContent =
        'Стрелка справа указывает на выбывающий сектор. Последний оставшийся вариант побеждает!';
    }
  }

  // Кнопки управления колесом для Хоста
  if (state.me.isHost && state.phase === 'REVEAL') {
    dom.hostWheelControls.classList.remove('hidden');
    dom.btnSpinWheel.disabled = state.wheel.isSpinning || store.isAnimatingWheel || Boolean(store.activeElimination) || aliveItems.length < 1;
    dom.btnAutoSpin.textContent = store.autoSpinActive ? 'Остановить авто-крутку' : 'Авто-крутка до победителя';
  } else {
    dom.hostWheelControls.classList.add('hidden');
  }

  // Панель объединения дубликатов (доступна Хосту до первого вращения колеса)
  if (state.me.isHost && state.phase === 'REVEAL' && !state.wheel.hasStarted && aliveItems.length >= 2) {
    dom.hostMergeCard.classList.remove('hidden');
    const prevSource = dom.mergeSource.value;
    const prevTarget = dom.mergeTarget.value;
    dom.mergeSource.innerHTML = '';
    dom.mergeTarget.innerHTML = '';

    aliveItems.forEach((it) => {
      const opt1 = document.createElement('option');
      opt1.value = it.id;
      opt1.textContent = `${it.title} (${it.totalPoints} очк.)`;
      dom.mergeSource.appendChild(opt1);

      const opt2 = document.createElement('option');
      opt2.value = it.id;
      opt2.textContent = `${it.title} (${it.totalPoints} очк.)`;
      dom.mergeTarget.appendChild(opt2);
    });

    if (prevSource) dom.mergeSource.value = prevSource;
    if (prevTarget && prevTarget !== dom.mergeSource.value) {
      dom.mergeTarget.value = prevTarget;
    } else if (aliveItems.length > 1) {
      dom.mergeTarget.selectedIndex = 1;
    }
  } else {
    dom.hostMergeCard.classList.add('hidden');
  }

  // Сортируем варианты в таблице по убыванию очков
  const sortedItems = [...state.items].sort((a, b) => b.effectivePoints - a.effectivePoints);
  dom.revealItemsTbody.innerHTML = '';

  sortedItems.forEach((it) => {
    const tr = document.createElement('tr');
    const isWinner = state.phase === 'FINISHED' && state.wheel.winner && state.wheel.winner.id === it.id;
    if (it.eliminated) tr.classList.add('is-eliminated');
    if (isWinner) tr.classList.add('is-winner');

  const tdTitle = document.createElement('td');
    const titleWrap = document.createElement('div');
    titleWrap.className = 'reveal-title-wrap';
    const titleText = document.createElement('span');
    titleText.textContent = it.title;
    titleWrap.appendChild(titleText);
    if (it.isFreeSlot) {
      const freeBadge = document.createElement('span');
      freeBadge.className = 'extra-lot-badge';
      freeBadge.textContent = '+ ДОП';
      titleWrap.appendChild(freeBadge);
    }
    tdTitle.appendChild(titleWrap);

    const tdTotal = document.createElement('td');
    tdTotal.innerHTML = `<strong>${it.totalPoints}</strong>`;

    const tdMy = document.createElement('td');
    tdMy.textContent = it.myPoints;

    const tdWinProb = document.createElement('td');
    tdWinProb.textContent = `${it.winProbability.toFixed(1)}%`;

    const tdElimShare = document.createElement('td');
    tdElimShare.textContent = it.eliminated ? '—' : `${it.roundElimShare.toFixed(1)}%`;

    const tdStatus = document.createElement('td');
    if (isWinner) {
      tdStatus.textContent = '🏆 ПОБЕДИТЕЛЬ';
    } else if (it.eliminated) {
      tdStatus.textContent = 'Выбыл';
    } else {
      tdStatus.textContent = 'В игре';
    }

    const weightRate = Math.min(1, it.effectivePoints / Math.max(1, ...sortedItems.map(x => x.effectivePoints)));
    const winRate = Math.max(0, Math.min(1, it.winProbability / 100));
    const riskRate = Math.max(0, Math.min(1, it.roundElimShare / 100));
    tr.style.setProperty('--weight-alpha', (0.025 + weightRate * 0.15).toFixed(3));
    tdWinProb.classList.add('chance-cell');
    tdWinProb.style.setProperty('--prob-alpha', (0.06 + winRate * 0.32).toFixed(3));
    tdElimShare.classList.add('risk-cell');
    tdElimShare.style.setProperty('--risk-alpha', (0.04 + riskRate * 0.26).toFixed(3));
    tr.append(tdTitle, tdTotal, tdMy, tdWinProb, tdElimShare, tdStatus);
    dom.revealItemsTbody.appendChild(tr);
  });

  // Лог выбывания
  dom.eliminationHistory.innerHTML = '';
  if (state.wheel.history.length === 0) {
    const li = document.createElement('li');
    li.className = 'muted-text';
    li.textContent = 'Пока никто не выбыл';
    dom.eliminationHistory.appendChild(li);
  } else {
    state.wheel.history.forEach((h) => {
      const li = document.createElement('li');
      li.textContent = `${h.title} (${h.totalPoints} очк.)`;
      const peak = Math.max(1, ...state.wheel.history.map(item => item.totalPoints));
      li.style.setProperty('--history-alpha', (0.055 + h.totalPoints / peak * 0.2).toFixed(3));
      dom.eliminationHistory.appendChild(li);
    });
  }
}

export { updatePointsSplitPreview, renderEffectsControls, setAllEffects, applyTheme, updateSoundButton, openAllItemsModal, closeAllItemsModal, renderAllItemsModal, openHelpModal, closeHelpModal, renderHelpModal, switchHistoryTab, showToast, renderSidebar, renderMainArea, renderPoolView, renderRevealView };
