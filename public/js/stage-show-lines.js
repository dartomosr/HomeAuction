function line(text, pose, fallbackText) {
  return { text, pose, fallbackText };
}

export const showLines = {
  POOL: {
    waiting: { idle: line('Добро пожаловать на вечерний аукцион!', '02-welcome'), variants: [
      { ...line('Зал открыт! Занимайте места по QR-коду!', '02-welcome'), requiresQr: true },
      line('Добро пожаловать на наш вечерний аукцион!', '02-welcome'),
      line('Гости вечера, ваши места ждут!', '02-welcome'),
      line('Проходите, друзья! Зал уже открыт.', '02-welcome'),
      line('Сегодня за столом есть место каждому.', '02-welcome'),
      line('Добрый вечер! Располагайтесь поудобнее.', '02-welcome'),
      line('Занавес поднят. Ждём вас в зале!', '02-welcome'),
      line('Заглядывайте, друзья! Вечер только начинается.', '02-welcome'),
      { ...line('Ваш пропуск на аукцион в QR-коде.', '02-welcome'), requiresQr: true }
    ] },
    empty: { idle: line('Жду ваши идеи для витрины!', '12-thinking'), variants: [
      line('Друзья, кто откроет наш аукцион?', '12-thinking'),
      line('Смелее, друзья, жду первый лот!', '12-thinking'),
      line('Занавес поднят! Чья идея первая?', '12-thinking'),
      line('Кто предложит первый лот вечера?', '12-thinking'),
      line('Самое время для неожиданной идеи.', '12-thinking'),
      line('Первое место на витрине свободно.', '12-thinking'),
      line('Сегодня смелым идеям почётное место.', '12-thinking'),
      line('С чего начнём наш аукцион?', '12-thinking'),
      line('На витрине ждут вашу идею.', '12-thinking')
    ] },
    quiet: { idle: line('Обдумайте свой следующий ход.', '01-idle'), variants: [
      line('Тайные ставки любят красивый блеф!', '01-idle'),
      line('Чья идея сегодня покорит колесо?', '12-thinking'),
      line('Колесо уже ждёт своего выхода!', '01-idle'),
      line('Каждая фишка может изменить вечер.', '01-idle'),
      line('На витрине есть над чем подумать.', '12-thinking'),
      line('Пусть ваш фаворит пока останется тайной.', '01-idle'),
      line('Люблю эту паузу перед развязкой.', '12-thinking'),
      line('Кому сегодня улыбнётся фортуна?', '12-thinking'),
      line('Ставки меняются, интрига остаётся.', '01-idle')
    ] },
    joined: { group: 'joined', priority: 50, batchMs: 800, cooldownMs: 8000, variants: [
      line('А вот и [Имя]! Встречаем!', '02-welcome', 'К нам присоединился новый гость!'),
      line('Добро пожаловать за стол, [Имя]!', '02-welcome', 'Добро пожаловать за наш стол!')
    ], grouped: [line('Рады видеть новых гостей за столом!', '02-welcome')] },
    added: { group: 'lots', priority: 50, batchMs: 600, cooldownMs: 6000, variants: [
      line('Какая прекрасная заявка! Лот принят!', '03-new-idea'),
      line('Интрига закручивается! Что ещё?', '03-new-idea'),
      line('Записала! Становится всё интереснее!', '03-new-idea')
    ], grouped: [line('Сразу несколько идей! Вот это темп!', '03-new-idea')] },
    extra: { group: 'lots', priority: 65, rank: 1, batchMs: 600, cooldownMs: 6000, ownCooldownMs: 12000, variants: [
      line('Особый лот сверх программы!', '17-bonus-lot'),
      line('А вот и сюрприз вечера!', '17-bonus-lot')
    ] },
    showcaseFull: { group: 'lots', priority: 65, rank: 2, batchMs: 600, cooldownMs: 6000, once: true, variants: [
      line('Аншлаг! Все шесть мест витрины заняты!', '16-showcase-full'),
      line('Шесть лотов уже на витрине!', '16-showcase-full')
    ] },
    firstLot: { group: 'lots', priority: 65, rank: 3, batchMs: 600, cooldownMs: 6000, once: true, variants: [
      line('Есть первый лот! Начало положено!', '03-new-idea'),
      line('У вечера появился первый лот!', '03-new-idea')
    ] },
    bankStarted: { group: 'bank', priority: 30, rank: 1, batchMs: 1500, cooldownMs: 15000, once: true, variants: [
      line('Первые фишки пошли в игру!', '18-bank-grows'),
      line('Фишки в игре! Вечер набирает ход!', '18-bank-grows')
    ] },
    bankLarge: { group: 'bank', priority: 30, rank: 2, batchMs: 1500, cooldownMs: 15000, ttlMs: 18000, once: true, variants: [
      line('Банк растёт! Вот это размах!', '18-bank-grows'),
      line('Чувствую настоящий азарт за столом!', '18-bank-grows')
    ] },
    stakesCleared: { group: 'bank', priority: 30, batchMs: 1500, cooldownMs: 15000, variants: [
      line('Кажется, за столом меняют тактику!', '19-tactical-pause'),
      line('У этого вечера новый поворот!', '19-tactical-pause')
    ] },
    ready: { group: 'ready', priority: 50, batchMs: 600, cooldownMs: 8000, variants: [
      line('[Имя] в деле! Отличный темп!', '04-approval', 'Ещё один выбор сделан!'),
      line('Ещё один выбор до развязки!', '04-approval')
    ], grouped: [line('Готовых всё больше! Интрига растёт!', '04-approval')] },
    firstReady: { group: 'ready', priority: 65, batchMs: 600, cooldownMs: 8000, once: true, variants: [
      line('[Имя] открывает список готовых!', '04-approval', 'Первый выбор уже сделан!')
    ], grouped: [line('Первые участники уже сделали выбор!', '04-approval')] },
    lastReady: { group: 'ready', priority: 75, batchMs: 600, once: true, variants: [
      line('Остался один шаг до развязки!', '20-last-ready'),
      line('Ещё один выбор, и начнём!', '20-last-ready')
    ] },
    timerStarted: { group: 'timer', priority: 50, variants: [
      line('Время пошло! Обдумайте свой ход!', '05-timer'),
      line('Часы пошли, друзья, делайте ставки!', '05-timer')
    ] },
    timerEnding: { group: 'timer', priority: 90, variants: [
      line('Последние секунды на раздумья, друзья!', '21-final-countdown'),
      line('Пора сделать финальный ход!', '21-final-countdown')
    ] }
  },
  REVEAL: {
    ready: { priority: 100, variants: [
      line('Ставки сделаны! Поднимаем занавес!', '13-before-reveal'),
      line('Все готовы! Открываем конверты!', '13-before-reveal')
    ] },
    timer: { priority: 100, variants: [line('Время вышло! Поднимаем занавес!', '13-before-reveal')] }
  }
};
