import { store, writeSetting } from './store.js';
import { dom } from './dom.js';
import { ELIMINATION_EFFECTS, THEME_WHEEL_PALETTES } from './constants.js';
import { initAudio, playUiClickSound, playUiSliderSound } from './audio.js';
import { renderAllItemsModal } from './ui-modals.js';
import { showToast } from './ui-notifications.js';

function updatePointsSplitPreview() {
  const total = Math.max(1, Number(dom.setMaxPoints.value) || 100);
  dom.setForeignOnly.max = total;
  dom.setFreePointsBudget.max = total;
  const perOpponent = dom.setReserveOpponent.checked;
  dom.totalReserveGroup.classList.toggle('hidden', perOpponent);
  dom.opponentReserveGroup.classList.toggle('hidden', !perOpponent);
  const activeCount = (store.appState?.players || []).filter(player => !player.isSpectator).length;
  const opponents = Math.max(0, activeCount - 1);
  const freeBudget = Math.max(0, Math.min(total, Math.floor(Number(dom.setFreePointsBudget.value) || 0)));
  const quota = opponents > 0 ? Math.floor((total - freeBudget) / opponents) : 0;
  const effectiveFree = total - quota * opponents;
  dom.opponentReservePreview.textContent = `Соперников: ${opponents} | Квота на каждого: ${quota} очков | Свободных: ${effectiveFree} очков`;
  if (perOpponent) {
    dom.setMinimumBid.max = total;
    if (Number(dom.setMinimumBid.value) > total) dom.setMinimumBid.value = String(total);
    return;
  }
  const reserve = dom.setRestrictOwn.checked
    ? Math.max(0, Math.min(total, Number(dom.setForeignOnly.value) || 0)) : 0;
  const freePoints = total - reserve;
  dom.setMinimumBid.max = freePoints;
  if (Number(dom.setMinimumBid.value) > freePoints) dom.setMinimumBid.value = String(freePoints);
  dom.pointsSplitPreview.textContent = `${total - reserve} очк. — на свои и чужие; ${reserve} очк. — только на чужие.`;
}

function updateJoinPresetVisibility(state = store.appState) {
  const roomHasPlayers = Boolean(state?.hasPlayers || state?.hasHost);
  const isHidden = roomHasPlayers || dom.inputSpectator.checked;
  dom.joinPresetGroup.classList.toggle('hidden', isHidden);
  if (isHidden) document.dispatchEvent(new Event('auction:initial-save-unavailable'));
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

  // Если мы Хост — показываем форму настроек
  if (state.me.isHost) {
    dom.hostSettingsForm.classList.remove('hidden');
    if (document.activeElement !== dom.setMaxPoints &&
        document.activeElement !== dom.setMaxItems &&
        document.activeElement !== dom.setForeignOnly &&
        document.activeElement !== dom.setFreePointsBudget &&
        document.activeElement !== dom.setMinimumBid &&
        document.activeElement !== dom.setZeroWeight) {
      dom.setMaxPoints.value = state.settings.maxPoints;
      dom.setMinimumBid.value = Number.isSafeInteger(state.settings.minimumBid) ? state.settings.minimumBid : 0;
      dom.setMaxItems.value = state.settings.maxItems;
      dom.setAllowFreeAll.checked = Boolean(state.settings.allowFreeItemsForAll);
      dom.setAllowReactions.checked = Boolean(state.settings.allowReactions);
      dom.setRestrictOwn.checked = state.settings.foreignReserveMode !== 'per_opponent';
      dom.setReserveOpponent.checked = state.settings.foreignReserveMode === 'per_opponent';
      dom.setForeignOnly.value = state.settings.foreignOnlyPoints || 0;
      dom.setFreePointsBudget.value = state.settings.freePointsBudget ?? 20;
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
  if (state.settings.allowReactions) {
    visibleItems = visibleItems
      .map((item, index) => ({ item, index }))
      .sort((a, b) =>
        (b.item.reactionScore - a.item.reactionScore) ||
        (b.item.upvotes - a.item.upvotes) ||
        (a.index - b.index)
      )
      .map(({ item }) => item);
  }
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
    card.dataset.itemId = item.id;

    const left = document.createElement('div');
    left.className = 'pool-item-left';

    const titleSpan = document.createElement('span');
    titleSpan.className = 'pool-item-title';
    titleSpan.textContent = item.title;
    left.appendChild(titleSpan);
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

    card.appendChild(left);
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
            if (store.soundEnabled) initAudio();
            playUiClickSound();
            store.socket.emit('toggle_reaction', { itemId: item.id, type });
          });
        }
        reactions.appendChild(reactionButton);
      }
      card.appendChild(reactions);
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
      dom.poolItemsList.appendChild(card);
      return;
    }

    const controls = document.createElement('div');
    controls.className = 'pool-item-controls';

    const ownLimit = state.settings.maxPoints - reserve;
    const minimumBid = Number(state.settings.minimumBid) || 0;
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
        let points = Math.max(0, item.myPoints + delta);
        if (points > 0 && points < minimumBid) points = delta < 0 ? 0 : minimumBid;
        if (points > maxPossibleForThisItem) points = 0;
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
    slider.max = maxPossibleForThisItem;
    slider.value = item.myPoints;
    slider.disabled = isLocked;
    slider.addEventListener('input', () => {
      initAudio();
      playUiSliderSound();
      let clamped = Math.min(Number(slider.value), maxPossibleForThisItem);
      if (clamped > 0 && clamped < minimumBid) clamped = minimumBid <= maxPossibleForThisItem ? minimumBid : 0;
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

    card.appendChild(controls);
    dom.poolItemsList.appendChild(card);
  });

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

export { updatePointsSplitPreview, updateJoinPresetVisibility, renderEffectsControls, setAllEffects, applyTheme, updateSoundButton, renderSidebar, renderMainArea, renderPoolView, renderRevealView, showToast };
export { openAllItemsModal, closeAllItemsModal, openHelpModal, closeHelpModal, renderHelpModal, switchHistoryTab, copyResultSummary } from './ui-modals.js';
export { renderAllItemsModal };
