import { store, writeSetting } from './store.js';
import { dom } from './dom.js';
import { ELIMINATION_EFFECTS, THEME_WHEEL_PALETTES } from './constants.js';
import { initAudio, playUiClickSound, playUiSliderSound } from './audio.js';
import { renderAllItemsModal } from './ui-modals.js';
import { showToast } from './ui-notifications.js';
import { triggerHaptic } from './haptics.js';
import { getSettingsRuleGroups } from './settings-layout.js';

function updatePointsSplitPreview() {
  const total = Math.max(1, Number(dom.setMaxPoints.value) || 100);
  dom.setForeignOnly.max = total;
  const mode = dom.setReserveMode.value;
  dom.reserveParameters.classList.toggle('hidden', mode === 'none');
  const activeCount = (store.appState?.players || []).filter(player => !player.isSpectator).length;
  const opponents = Math.max(0, activeCount - 1);
  const requestedReserve = Math.max(0, Math.min(total, Math.floor(Number(dom.setForeignOnly.value) || 0)));
  if (mode === 'per_opponent') {
    const quota = opponents > 0 ? Math.floor(requestedReserve / opponents) : 0;
    const foreignTotal = quota * opponents;
    dom.pointsSplitPreview.textContent = `${opponents} соперников • по ${quota} очков на каждого (${foreignTotal} очков на чужих + ${total - foreignTotal} свободных)`;
    dom.setMinimumBid.max = total;
    if (Number(dom.setMinimumBid.value) > total) dom.setMinimumBid.value = String(total);
    return;
  }
  const reserve = mode === 'total' ? requestedReserve : 0;
  const freePoints = total - reserve;
  dom.setMinimumBid.max = freePoints;
  if (Number(dom.setMinimumBid.value) > freePoints) dom.setMinimumBid.value = String(freePoints);
  dom.pointsSplitPreview.textContent = `${reserve} очков на чужие • ${freePoints} свободных`;
}

function updateJoinPresetVisibility(state = store.appState) {
  const roomHasPlayers = Boolean(state?.hasPlayers || state?.hasHost);
  const isHidden = roomHasPlayers || dom.inputSpectator.checked;
  dom.joinPresetGroup.classList.toggle('hidden', isHidden);
  if (isHidden) document.dispatchEvent(new Event('auction:initial-save-unavailable'));
}

function renderSettingsRuleGroups(settings) {
  const rows = {
    minimumBid: dom.roMinimumBid.closest('.stat-row'),
    freeItems: dom.roFreeItems.closest('.stat-row'),
    flexiblePoints: dom.roFlexiblePoints.closest('.stat-row'),
    foreignPoints: dom.roForeignPoints.closest('.stat-row'),
    support: dom.ruleZeroItems.closest('.stat-row'),
    reactions: dom.ruleReactions.closest('.stat-row'),
    distributionMode: dom.roDistributionMode.closest('.stat-row')
  };
  const groups = getSettingsRuleGroups(settings);
  const equalSplit = settings.distributionMode === 'equal_split';
  rows.flexiblePoints.hidden = equalSplit;
  rows.foreignPoints.hidden = equalSplit;
  rows.distributionMode.hidden = !equalSplit;
  for (const key of groups.primary) {
    const row = rows[key];
    if (row.parentElement !== dom.settingsPrimaryOptions) dom.settingsPrimaryOptions.appendChild(row);
  }
  for (const key of groups.additional) {
    const row = rows[key];
    if (row.parentElement !== dom.settingsAdditionalContent) dom.settingsAdditionalContent.appendChild(row);
  }
  const visibleAdditionalRows = [...dom.settingsAdditionalContent.querySelectorAll('.stat-row')]
    .filter(row => !row.hidden).length;
  dom.settingsAdditional.hidden = visibleAdditionalRows === 0;
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

let awardsRevealTimer = null;
let displayedAwards = null;

function renderSidebar(state) {
  if (state.phase !== 'FINISHED') {
    displayedAwards = null;
    if (awardsRevealTimer) clearTimeout(awardsRevealTimer);
    awardsRevealTimer = null;
  } else if (!displayedAwards && state.wheel?.awards && !awardsRevealTimer) {
    awardsRevealTimer = setTimeout(() => {
      awardsRevealTimer = null;
      displayedAwards = state.wheel?.awards || null;
      if (store.appState) renderSidebar(store.appState);
    }, 700);
  }
  const activePlayers = state.players.filter((p) => !p.isSpectator);
  const readyCount = activePlayers.filter((p) => p.ready).length;
  dom.readyCounterEl.textContent = `${readyCount} / ${activePlayers.length} готовы`;
  dom.mobilePlayersLabel.textContent = `${readyCount} / ${activePlayers.length} готовы`;
  dom.mobileOpenSettings.classList.toggle('hidden', !state.me.isHost);
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
      const award = displayedAwards?.[p.id];
      status.className = `player-status ${award ? 'status-award' : (p.ready ? 'status-ready' : 'status-wait')}`;
      status.textContent = award?.title || (p.ready ? 'ГОТОВ' : 'ДУМАЕТ');
      if (award) status.title = award.hint;
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
  dom.roMinimumBid.textContent = state.settings.minimumBid > 0 ? `${state.settings.minimumBid} очк.` : 'Выключена';
  dom.roMaxItems.textContent = state.settings.maxItems;
  dom.roFreeItems.textContent = state.settings.allowFreeItemsForAll ? 'Разрешены всем' : 'Только Хост';
  const foreignReserve = state.settings.restrictOwnPoints ? state.settings.foreignOnlyPoints : 0;
  dom.roFlexiblePoints.textContent = state.settings.restrictOwnPoints
    ? `${state.settings.maxPoints - foreignReserve} очк.` : `Все ${state.settings.maxPoints} очк.`;
  dom.roForeignPoints.textContent = state.settings.restrictOwnPoints ? `${foreignReserve} очк.` : 'Нет ограничений';
  dom.ruleZeroItems.textContent = state.settings.keepZeroItems
    ? `До ${state.settings.zeroItemWeight} очк.`
    : 'Выключена';
  dom.ruleReactions.textContent = state.settings.allowReactions ? 'Включены' : 'Выключены';
  renderSettingsRuleGroups(state.settings);

  // Если мы Хост — показываем форму настроек
  if (state.me.isHost) {
    dom.hostSettingsForm.classList.remove('hidden');
    if (document.activeElement !== dom.setMaxPoints &&
        document.activeElement !== dom.setMaxItems &&
        document.activeElement !== dom.setDistributionMode &&
        document.activeElement !== dom.setForeignOnly &&
        document.activeElement !== dom.setMinimumBid &&
        document.activeElement !== dom.setZeroWeight) {
      dom.setMaxPoints.value = state.settings.maxPoints;
      dom.setDistributionMode.value = state.settings.distributionMode || 'manual';
      dom.setMinimumBid.value = Number.isSafeInteger(state.settings.minimumBid) ? state.settings.minimumBid : 0;
      dom.setMaxItems.value = state.settings.maxItems;
      dom.setAllowFreeAll.checked = Boolean(state.settings.allowFreeItemsForAll);
      dom.setAllowReactions.checked = Boolean(state.settings.allowReactions);
      dom.setReserveMode.value = !state.settings.restrictOwnPoints
        ? 'none'
        : state.settings.foreignReserveMode === 'per_opponent' ? 'per_opponent' : 'total';
      dom.setForeignOnly.value = state.settings.foreignOnlyPoints || 0;
      updatePointsSplitPreview();
      dom.setKeepZero.checked = state.settings.keepZeroItems;
      dom.setZeroWeight.value = state.settings.zeroItemWeight;
      dom.zeroWeightGroup.classList.toggle('hidden', !state.settings.keepZeroItems);
    }
  } else {
    dom.hostSettingsForm.classList.add('hidden');
  }
}

function initializeMobileBottomSheets() {
  const media = window.matchMedia('(max-width: 640px)');
  const sheets = [dom.sheetPlayers, dom.sheetSettings];
  const placePanels = () => {
    if (media.matches) {
      dom.sheetPlayersSlot.append(dom.sidebarPlayersPanel);
      dom.sheetSettingsSlot.append(dom.sidebarSettingsPanel);
    } else {
      dom.sidebar.append(dom.sidebarPlayersPanel, dom.sidebarSettingsPanel);
    }
  };
  const closeSheet = (sheet, restoreFocus = true) => {
    if (!sheet.classList.contains('is-open')) return;
    sheet.classList.remove('is-open');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.inert = true;
    const trigger = document.getElementById(sheet.dataset.triggerId);
    trigger?.setAttribute('aria-expanded', 'false');
    delete sheet.dataset.triggerId;
    if (!sheets.some((candidate) => candidate.classList.contains('is-open'))) {
      document.body.classList.remove('bottom-sheet-open');
    }
    if (restoreFocus && media.matches) trigger?.focus();
  };
  const openSheet = (sheet, trigger) => {
    if (!media.matches || trigger.classList.contains('hidden')) return;
    sheets.forEach((candidate) => closeSheet(candidate, false));
    sheet.inert = false;
    sheet.setAttribute('aria-hidden', 'false');
    sheet.dataset.triggerId = trigger.id;
    sheet.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    document.body.classList.add('bottom-sheet-open');
    sheet.querySelector('[data-sheet-close]')?.focus();
  };
  placePanels();
  media.addEventListener('change', () => {
    sheets.forEach((sheet) => closeSheet(sheet, false));
    placePanels();
  });
  dom.mobileOpenPlayers.addEventListener('click', () => openSheet(dom.sheetPlayers, dom.mobileOpenPlayers));
  dom.mobileOpenSettings.addEventListener('click', () => openSheet(dom.sheetSettings, dom.mobileOpenSettings));
  sheets.forEach((sheet) => {
    sheet.querySelector('[data-sheet-close]').addEventListener('click', () => closeSheet(sheet));
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) closeSheet(sheet);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') sheets.forEach((sheet) => closeSheet(sheet));
  });
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

function renderMobileDock(state, override = null) {
  const maxPoints = Number(state.settings.maxPoints) || 0;
  const mode = state.settings.foreignReserveMode;
  const totalReserve = state.settings.restrictOwnPoints && mode === 'total'
    ? Math.max(0, Number(state.settings.foreignOnlyPoints) || 0)
    : 0;
  const hasReserve = mode === 'per_opponent' || totalReserve > 0;
  const equalSplit = state.settings.distributionMode === 'equal_split';
  const ownItems = state.items.filter(item => item.isOwn && !item.isFreeSlot && !item.isSystem);
  const perItemBudget = ownItems.length
    ? Number(ownItems[0].myPoints) || 0
    : Math.round((maxPoints || 0) * 10) / 10;
  let ownSpent = 0;
  let foreignSpent = 0;
  const spentByAuthor = new Map();

  for (const item of state.items) {
    const points = override?.itemId === item.id ? override.points : Number(item.myPoints) || 0;
    if (item.isOwn) {
      ownSpent += points;
    } else {
      foreignSpent += points;
      const author = item.authorKey || item.id;
      spentByAuthor.set(author, (spentByAuthor.get(author) || 0) + points);
    }
  }

  const remaining = Math.max(0, maxPoints - ownSpent - foreignSpent);
  let freeRemaining = remaining;
  let foreignRemaining = 0;
  if (mode === 'per_opponent') {
    const quota = Math.max(0, Number(state.quotaPerOpponent) || 0);
    const reserveUsed = [...spentByAuthor.values()].reduce((sum, spent) => sum + Math.min(quota, spent), 0);
    const freeSpent = ownSpent + [...spentByAuthor.values()].reduce((sum, spent) => sum + Math.max(0, spent - quota), 0);
    freeRemaining = Math.max(0, (Number(state.effectiveFreePoints) || 0) - freeSpent);
    foreignRemaining = Math.max(0, (Number(state.opponentsCount) || 0) * quota - reserveUsed);
  } else if (totalReserve > 0) {
    const freeBudget = Math.max(0, maxPoints - totalReserve);
    freeRemaining = Math.max(0, freeBudget - ownSpent - Math.max(0, foreignSpent - totalReserve));
    foreignRemaining = Math.max(0, totalReserve - foreignSpent);
  }

  dom.myRemainingPointsEl.textContent = remaining;
  dom.mobileFreeLabel.textContent = equalSplit ? 'На вариант:' : hasReserve ? 'Свободно:' : 'Осталось:';
  dom.mobileFreePoints.textContent = equalSplit ? perItemBudget : hasReserve ? freeRemaining : remaining;
  dom.mobileForeignPoints.textContent = foreignRemaining;
  dom.mobileForeignLine.classList.toggle('hidden', equalSplit || !hasReserve);
}

function renderPoolView(state) {
  const isSpectator = Boolean(state.me.isSpectator);
  dom.poolDashboard.classList.toggle('hidden', isSpectator);
  dom.mobilePoolDock.classList.toggle('hidden', isSpectator);
  dom.addItemCard.classList.toggle('hidden', isSpectator);

  dom.myRemainingPointsEl.textContent = state.me.remainingPoints;
  renderMobileDock(state);
  dom.myMaxPointsEl.textContent = state.settings.maxPoints;
  dom.myItemsCountEl.textContent = state.me.myItemsCount;
  dom.myMaxItemsEl.textContent = state.settings.maxItems;
  const equalSplit = state.settings.distributionMode === 'equal_split';
  const reserve = state.settings.restrictOwnPoints && state.settings.foreignReserveMode !== 'per_opponent' ? state.settings.foreignOnlyPoints : 0;
  if (state.settings.foreignReserveMode === 'per_opponent') {
    dom.poolFlexiblePoints.textContent = `${state.effectiveFreeSpent} / ${state.effectiveFreePoints}`;
    dom.poolFlexibleNote.textContent = 'Свободные очки';
    dom.poolForeignPoints.textContent = state.quotaPerOpponent;
    dom.poolForeignUnit.textContent = ' очк.';
    dom.poolForeignNote.textContent = 'Квота на каждого соперника';
  } else {
  dom.poolFlexiblePoints.textContent = state.settings.maxPoints - reserve;
  dom.poolFlexibleNote.textContent = reserve
    ? 'Максимум, доступный для собственных лотов'
    : 'Все очки доступны для любых ставок';
  dom.poolForeignPoints.textContent = reserve ? reserve : '—';
  dom.poolForeignUnit.textContent = reserve ? ' очк.' : '';
  dom.poolForeignNote.textContent = reserve
    ? 'Резерв: можно тратить только на чужие лоты'
    : 'Ограничения отключены';
  }
  dom.poolFlexibleLabel.textContent = equalSplit ? 'БАЛЛЫ НА ВАРИАНТ' : 'СВОБОДНЫЕ БАЛЛЫ';
  if (equalSplit) {
    const ownItems = state.items.filter(item => item.isOwn && !item.isFreeSlot && !item.isSystem);
    const perItemBudget = ownItems.length
      ? Number(ownItems[0].myPoints) || 0
      : Math.round((Number(state.settings.maxPoints) || 0) * 10) / 10;
    dom.poolFlexiblePoints.textContent = Number(perItemBudget.toFixed(1)).toLocaleString('ru-RU');
    dom.poolFlexibleNote.textContent = 'Очки делятся равно на все свои варианты';
  }
  dom.poolForeignPoints.closest('.stat-box').classList.toggle('hidden', equalSplit);

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
  dom.btnReadyMobile.textContent = isLocked ? '✓ ГОТОВЫ' : 'Я ГОТОВ';
  dom.btnReadyMobile.classList.toggle('is-ready', isLocked);

  dom.poolItemCount.textContent = state.items.length;
  dom.poolItemFilters.querySelectorAll('[data-pool-filter]').forEach((button) => {
    const isActive = button.dataset.poolFilter === store.poolFilter;
    button.classList.toggle('is-active', isActive);
    button.setAttribute('aria-pressed', String(isActive));
  });
  const oldPositions = new Map();
  if (!dom.motionReduced.matches) {
    dom.poolItemsList.querySelectorAll('.pool-item-card[data-item-id]').forEach((card) => {
      oldPositions.set(card.dataset.itemId, card.getBoundingClientRect().top);
    });
  }
  dom.poolItemsList.innerHTML = '';
  let visibleItems = state.items.filter((item) => {
    if (store.poolFilter === 'own') return item.isOwn;
    if (store.poolFilter === 'others') return !item.isOwn;
    return true;
  });
  const sortByReaction = (items) => state.settings.allowReactions
    ? items.map((item, index) => ({ item, index }))
      .sort((a, b) => (b.item.reactionScore - a.item.reactionScore) ||
        (b.item.upvotes - a.item.upvotes) || (a.index - b.index))
      .map(({ item }) => item)
    : items;
  const grouped = state.settings.foreignReserveMode === 'per_opponent';
  let renderGroups;
  if (grouped) {
    const slotForAuthor = (key) => {
      if (!store.poolAuthorSlots.has(key)) {
        store.poolAuthorSlots.set(key, store.nextPoolAuthorSlot++);
      }
      return store.poolAuthorSlots.get(key);
    };
    const opponents = (state.players || []).filter(player => !player.isSpectator && !player.isMe)
      .map(player => ({ ...player, displaySlot: slotForAuthor(player.authorKey) }))
      .sort((a, b) => a.displaySlot - b.displaySlot);
    const groups = new Map([[0, { title: 'Мои варианты', items: [], own: true }]]);
    opponents.forEach(player => groups.set(player.displaySlot, {
      title: `Игрок ${player.displaySlot}`, items: [], own: false, slot: player.displaySlot
    }));
    visibleItems.forEach(item => {
      const slot = item.isOwn ? 0 : slotForAuthor(item.authorKey);
      if (!groups.has(slot)) groups.set(slot, { title: `Игрок ${slot}`, items: [], own: false, slot });
      groups.get(slot).items.push(item);
    });
    renderGroups = [...groups.values()];
  } else {
    renderGroups = [{ items: sortByReaction(visibleItems) }];
  }
  if (!grouped && visibleItems.length === 0) {
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

  for (const group of renderGroups) {
    let groupContainer = dom.poolItemsList;
    if (grouped) {
      const section = document.createElement('section');
      section.className = `pool-author-group${group.own ? ' is-own-group' : ''}`;
      const heading = document.createElement('div');
      heading.className = 'pool-author-heading';
      const title = document.createElement('span');
      title.textContent = group.own
        ? `Мои варианты (свободных очков: ${state.effectiveFreePoints - state.effectiveFreeSpent})`
        : group.title;
      heading.appendChild(title);
      if (!group.own) {
        const used = group.items.reduce((max, item) => Math.max(max, item.opponentPointsUsed || 0), 0);
        const remaining = Math.max(0, state.quotaPerOpponent - used);
        const badge = document.createElement('span');
        badge.className = 'pool-quota-badge';
        badge.textContent = used > state.quotaPerOpponent
          ? 'Осталось: 0 (тратятся свободные)'
          : `Осталось: ${remaining} очков`;
        heading.appendChild(badge);
      }
      section.appendChild(heading);
      groupContainer = document.createElement('div');
      groupContainer.className = 'pool-author-items';
      section.appendChild(groupContainer);
      dom.poolItemsList.appendChild(section);
    }
    const groupItems = grouped ? sortByReaction(group.items) : group.items;
    for (const item of groupItems) {
    const card = document.createElement('div');
    card.className = `pool-item-card ${item.myPoints > 0 ? 'has-my-points' : ''}`;
    card.dataset.itemId = item.id;

    const header = document.createElement('div');
    header.className = 'pool-item-header';
    const left = document.createElement('div');
    left.className = 'pool-item-left';
    const actions = document.createElement('div');
    actions.className = 'pool-item-actions';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pool-item-title';
    titleSpan.textContent = item.title;
    left.appendChild(titleSpan);
    const autoSplitOwnItem = state.settings.distributionMode === 'equal_split' && item.isOwn &&
      !item.isFreeSlot && !item.isSystem;
    if (autoSplitOwnItem) {
      const authorItemCount = state.items.filter(candidate => candidate.isOwn &&
        !candidate.isFreeSlot && !candidate.isSystem).length;
      const shareBadge = document.createElement('span');
      shareBadge.className = 'equal-split-badge';
      const amount = Number(item.myPoints.toFixed(1)).toLocaleString('ru-RU');
      shareBadge.textContent = `${amount} очк. · 1/${authorItemCount}`;
      shareBadge.title = `Равная доля: ${Number((100 / authorItemCount).toFixed(1))}% бюджета`;
      left.appendChild(shareBadge);
    }
    if (state.settings.foreignReserveMode === 'per_opponent' && !item.isOwn) {
      const quotaHint = document.createElement('span');
      quotaHint.className = 'allocation-rule-note';
      quotaHint.textContent = `${item.opponentPointsUsed} / ${state.quotaPerOpponent} очк.`;
      quotaHint.title = 'Ставки на все лоты этого автора';
      left.appendChild(quotaHint);
    }

    if (item.isFreeSlot) {
      const freeBadge = document.createElement('span');
      freeBadge.className = 'extra-lot-badge';
      freeBadge.textContent = '+ ДОП';
      freeBadge.title = 'Добавлен вне лимита вариантов';
      left.appendChild(freeBadge);
    }

    header.append(left, actions);
    card.appendChild(header);
    if (state.settings.allowReactions) {
      const reactions = document.createElement('div');
      reactions.className = 'item-reactions';
      for (const [type, symbol, count, activeClass] of [
        ['up', '▲', item.upvotes, 'active-up'],
        ['down', '▼', item.downvotes, 'active-down']
      ]) {
        const reactionButton = document.createElement('button');
        reactionButton.type = 'button';
        reactionButton.className = `reaction-btn ${item.myReaction === type ? activeClass : ''}`;
        reactionButton.textContent = `${symbol} ${count}`;
        reactionButton.disabled = Boolean(item.isOwn);
        if (item.isOwn) reactionButton.title = 'Нельзя оценивать свой вариант';
        else {
          reactionButton.setAttribute(
            'aria-label',
            `${item.myReaction === type ? 'Снять' : 'Поставить'} ${type === 'up' ? 'положительную' : 'отрицательную'} реакцию`
          );
          reactionButton.addEventListener('click', () => {
            triggerHaptic('light');
            if (store.soundEnabled) initAudio();
            playUiClickSound();
            store.socket.emit('toggle_reaction', { itemId: item.id, type });
          });
        }
        reactions.appendChild(reactionButton);
      }
      actions.appendChild(reactions);
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
      actions.appendChild(delBtn);
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
      actions.appendChild(hostDelBtn);
    }

    if (isSpectator) {
      groupContainer.appendChild(card);
      continue;
    }

    if (autoSplitOwnItem) {
      groupContainer.appendChild(card);
      continue;
    }

    const controls = document.createElement('div');
    controls.className = 'pool-item-controls';

    const ownLimit = state.settings.maxPoints - reserve;
    const minimumBid = Number(state.settings.minimumBid) || 0;
    const allowedByOwnership = item.canDelete
      ? Math.max(0, ownLimit - (state.me.mySpentOwnPoints - item.myPoints))
      : state.settings.maxPoints;
    let maxPossibleForThisItem = Math.max(0, Math.min(item.myPoints + state.me.remainingPoints, allowedByOwnership));
    if (state.settings.foreignReserveMode === 'per_opponent') {
      const freeRemaining = Math.max(0, state.effectiveFreePoints - state.effectiveFreeSpent);
      const authorQuotaRemaining = item.isOwn
        ? 0
        : Math.max(0, state.quotaPerOpponent - (item.opponentPointsUsed || 0));
      const additionalCapacity = item.isOwn
        ? freeRemaining
        : authorQuotaRemaining + freeRemaining;
      maxPossibleForThisItem = Math.max(item.myPoints, Math.min(
        item.myPoints + state.me.remainingPoints,
        item.myPoints + additionalCapacity
      ));
    }

    const makeStepBtn = (label, delta, reset = false, stepClass = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `btn btn-sm pool-step-btn ${stepClass}${reset ? ' pool-reset-btn' : ''}`;
      b.textContent = label;
      b.disabled = isLocked;
      b.addEventListener('click', () => {
        triggerHaptic(reset || Math.abs(delta) >= 10 ? 'medium' : 'light');
        initAudio();
        playUiSliderSound();
        let points = reset ? 0 : Math.max(0, (Number(numInput.value) || 0) + delta);
        if (!reset) points = Math.min(points, maxPossibleForThisItem);
        if (!reset && points > 0 && points < minimumBid) {
          points = delta < 0 ? 0 : minimumBid <= maxPossibleForThisItem ? minimumBid : 0;
        }
        numInput.value = points;
        slider.value = points;
        renderMobileDock(state, { itemId: item.id, points });
        store.socket.emit('set_points', {
          itemId: item.id,
          points
        });
      });
      return b;
    };

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'pts-slider';
    slider.min = 0;
    const reserveMode = !state.settings.restrictOwnPoints
      ? 'none'
      : state.settings.foreignReserveMode === 'per_opponent' ? 'per_opponent' : 'total';
    slider.max = reserveMode === 'per_opponent'
      ? maxPossibleForThisItem
      : item.canDelete && reserveMode === 'total'
        ? Math.max(0, state.settings.maxPoints - state.settings.foreignOnlyPoints)
        : state.settings.maxPoints;
    slider.value = item.myPoints;
    slider.disabled = isLocked;
    slider.addEventListener('input', () => {
      initAudio();
      playUiSliderSound();
      let clamped = Math.min(Number(slider.value), maxPossibleForThisItem);
      if (clamped > 0 && clamped < minimumBid) clamped = minimumBid <= maxPossibleForThisItem ? minimumBid : 0;
      slider.value = clamped;
      numInput.value = clamped;
      renderMobileDock(state, { itemId: item.id, points: clamped });
    });
    slider.addEventListener('change', () => {
      triggerHaptic('light');
      store.socket.emit('set_points', { itemId: item.id, points: Number(slider.value) });
    });

    const numInput = document.createElement('input');
    numInput.type = 'number';
    numInput.className = 'input-text pts-input';
    numInput.min = 0;
    numInput.max = maxPossibleForThisItem;
    numInput.value = item.myPoints;
    numInput.disabled = isLocked;
    numInput.addEventListener('input', () => {
      let preview = Math.max(0, Math.min(Number(numInput.value) || 0, maxPossibleForThisItem));
      if (preview > 0 && preview < minimumBid) preview = minimumBid <= maxPossibleForThisItem ? minimumBid : 0;
      renderMobileDock(state, { itemId: item.id, points: preview });
    });
    numInput.addEventListener('change', () => {
      triggerHaptic('light');
      let points = Math.max(0, Math.min(Number(numInput.value) || 0, maxPossibleForThisItem));
      if (points > 0 && points < minimumBid) points = minimumBid <= maxPossibleForThisItem ? minimumBid : 0;
      numInput.value = points;
      slider.value = points;
      renderMobileDock(state, { itemId: item.id, points });
      store.socket.emit('set_points', { itemId: item.id, points });
    });

    slider.classList.add('stake-slider');
    numInput.classList.add('stake-value');
    const stakeRow = document.createElement('div');
    stakeRow.className = 'pool-stake-row';
    stakeRow.append(slider, numInput);
    const quickActions = document.createElement('div');
    quickActions.className = 'pool-quick-actions';
    quickActions.append(
      makeStepBtn('-10', -10, false, 'step-minus-10'),
      makeStepBtn('-1', -1, false, 'step-minus-1'),
      makeStepBtn('0', 0, true, 'step-reset'),
      makeStepBtn('+1', 1, false, 'step-plus-1'),
      makeStepBtn('+10', 10, false, 'step-plus-10')
    );
    controls.append(stakeRow, quickActions);

    card.appendChild(controls);
    groupContainer.appendChild(card);
    }
  }

  if (!dom.motionReduced.matches && oldPositions.size > 0) {
    const movedCards = [];
    dom.poolItemsList.querySelectorAll('.pool-item-card[data-item-id]').forEach((card) => {
      const oldTop = oldPositions.get(card.dataset.itemId);
      if (oldTop === undefined) return;
      const deltaY = oldTop - card.getBoundingClientRect().top;
      if (Math.abs(deltaY) <= 2) return;
      card.style.transform = `translateY(${deltaY}px)`;
      card.style.transition = 'none';
      card.getBoundingClientRect();
      card.classList.add(deltaY > 0 ? 'reaction-move-up' : 'reaction-move-down');
      movedCards.push(card);
    });
    if (movedCards.length > 0) {
      requestAnimationFrame(() => {
        movedCards.forEach((card) => {
          card.style.transition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
          card.style.transform = 'translateY(0)';
        });
        setTimeout(() => movedCards.forEach((card) => {
          card.style.transition = '';
          card.style.transform = '';
          card.classList.remove('reaction-move-up', 'reaction-move-down');
        }), 300);
      });
    }
  }
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
    const totalPoints = document.createElement('strong');
    totalPoints.textContent = it.totalPoints;
    tdTotal.appendChild(totalPoints);
    if (it.totalPoints < it.effectivePoints) {
      const supportNote = document.createElement('span');
      supportNote.className = 'muted-text small-text';
      supportNote.textContent = ` очк. (поддержка до ${it.effectivePoints})`;
      tdTotal.appendChild(supportNote);
    }

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

export { updatePointsSplitPreview, updateJoinPresetVisibility, renderEffectsControls, setAllEffects, applyTheme, updateSoundButton, renderSidebar, renderMainArea, renderPoolView, renderRevealView, showToast, initializeMobileBottomSheets };
export { openAllItemsModal, closeAllItemsModal, openHelpModal, closeHelpModal, renderHelpModal, switchHistoryTab, copyResultSummary } from './ui-modals.js';
export { renderAllItemsModal };
