// Все числа баланса из ТЗ. Баланс подкручивается только здесь.

export const CONFIG = {
  players: {
    max: 8,
    maxHumans: 2,
    maxAI: 6,
    // Первые два цвета — живые игроки.
    colors: ['#C8423B', '#3D6FD1', '#4E9A51', '#8A5BB8', '#E08A2E', '#2AA6A0', '#D96BA8', '#CDB532'],
  },

  start: {
    gold: 50,
    army: 30,
    // Кроме столицы игрок получает столько соседних провинций.
    extraProvinces: 2,
    // «Карта поделена»: гарнизон провинции = доля ополчения, которое там было бы, но не меньше минимума.
    dividedGarrisonShare: 0.5,
    dividedGarrisonMin: 3,
    // Порог превосходства должен быть выше начальной доли — иначе победа на первом же ходу.
    dividedSuperiorityMargin: 10,
    happiness: 70,
    tax: 60,
  },

  neutral: {
    // Ополчение нейтральной провинции = население / militiaPer, но не меньше militiaMin и не больше militiaMax.
    militiaPer: 3000,
    militiaMin: 4,
    militiaMax: 15,
    // Доля целевого ополчения, восстанавливаемая за ход после боёв.
    militiaRegen: 0.1,
    // При покупке ополчение распускается (true — переходит к покупателю).
    buyKeepsMilitia: false,
  },

  economy: {
    taxMin: 0,
    taxMax: 90,
    taxStep: 10,
    // доход = население / popPerGold × налог / 100 × k
    popPerGold: 1000,
    // k = 1 при счастье ≥ fullAt, partialK при счастье ≥ partialAt, иначе 0.
    fullAt: 50,
    partialAt: 25,
    partialK: 0.25,
    // цель счастья = 100 − happinessPerTax × налог − happinessPerTax2 × налог²:
    // 30% → 81, 50% → 64, 60% → 54, 90% → 19.
    happinessBase: 100,
    happinessPerTax: 0.5,
    happinessPerTax2: 0.0045,
    // Растёт счастье на happinessStep за ход, а падает быстрее: на долю разрыва, не меньше шага.
    happinessStep: 5,
    happinessFallShare: 0.35,
    // Рост населения.
    growthAt: 50,
    growth: 0.02,
    declineBelow: 25,
    decline: 0.01,
    popCapMult: 2,
    // Содержание: 1 золото за каждые soldiersPerGold солдат, в море ×seaUpkeepMult.
    soldiersPerGold: 10,
    seaUpkeepMult: 2,
    // Не хватает золота — каждая армия теряет эту долю.
    unpaidLoss: 0.1,
    // Захваченная провинция.
    capturedHappiness: 40,
    capturedPopLoss: 0.1,
    // Хозяйство: +devIncome к доходу провинции за уровень, до devMax; при захвате теряется уровень.
    devIncome: 0.25,
    devMax: 3,
    // Торговля: +tradePerPartner к доходу за каждого соседа (по суше или через одно море), с кем мир,
    // но не больше tradeMax.
    tradePerPartner: 0.08,
    tradeMax: 0.32,
  },

  // Войска: сила в атаке и обороне (пехота = 1), цена найма, содержание (пехота = 1),
  // дальность по своей земле. Смешанная армия идёт со скоростью самого медленного.
  units: {
    inf: { label: 'Пехота', short: 'пех.', attack: 1, defense: 1, gold: 2, upkeep: 1, range: 4 },
    cav: { label: 'Кавалерия', short: 'кав.', attack: 1.5, defense: 1, gold: 4, upkeep: 2, range: 6 },
    art: { label: 'Артиллерия', short: 'арт.', attack: 1.6, defense: 0.7, gold: 5, upkeep: 2, range: 3 },
    // Если артиллерии в атакующей армии не меньше этой доли — укрепление защитника не действует,
    // меньше — действует частично.
    siegeShare: 0.2,
  },

  ap: {
    base: 5,
    // +1 ОД за каждые perProvinces своих провинций.
    perProvinces: 10,
  },

  actions: {
    recruit: { ap: 1, goldPerSoldier: 2, popPerSoldier: 100, maxPopShare: 0.1 },
    fortify: { ap: 1.5, gold: 30, defenseMult: 2 },
    buy: { ap: 1, popPerGold: 200 },
    loot: { ap: 1, popPerGold: 200, popLoss: 0.1, happinessLoss: 20 },
    // Праздник: +happiness счастья в провинции; цена — население / popPerGold, не меньше minGold.
    festival: { ap: 0.5, popPerGold: 2000, minGold: 5, happiness: 20 },
    // Развитие хозяйства: цена уровня 1, 2, 3.
    develop: { ap: 1, gold: [40, 80, 120] },
  },

  move: {
    // Каждый приказ на перемещение стоит столько ОД (ОД бывают дробными).
    ap: 0.5,
    // Армия идёт по своей земле до landRange клеток; в чужую — только последним шагом.
    landRange: 4,
    // Флот проходит до seaRange морских клеток (высадка — последним шагом).
    seaRange: 5,
    // Посадка на корабли: золото за каждого солдата.
    embarkGoldPerSoldier: 2,
  },

  vision: {
    // Чужие армии видно не дальше стольких клеток от своей земли и своих армий.
    range: 2,
  },

  revolt: {
    // Ниже этого счастья возможны восстания: шанс за ход = (порог − счастье) × chancePerPoint.
    below: 40,
    chancePerPoint: 0.015,
    // Повстанцев: население / popPerRebel; гарнизон бьётся с ними (укрепление помогает).
    popPerRebel: 700,
  },

  war: {
    // Объявивший войну теряет столько счастья во всех своих провинциях; на кого напали — нет.
    happinessLoss: 10,
    // Усталость от войны снижает цель счастья у обеих сторон: за каждую войну wearyBase,
    // +1 за каждые wearyEvery ходов войны, не больше wearyPerWar за войну и wearyMax всего.
    wearyBase: 2,
    wearyEvery: 4,
    wearyPerWar: 8,
    wearyMax: 15,
    // После мира столько ходов нельзя снова объявить войну друг другу.
    truceTurns: 10,
  },

  battle: {
    // Случайный множитель силы: 1 ± randomSpread.
    randomSpread: 0.05,
    // Потери победителя = сила проигравшего × winnerLossShare / множитель укрепления.
    winnerLossShare: 0.5,
    // В море сила армии умножается на это число.
    seaStrength: 0.5,
  },

  ai: {
    // ИИ ставит налог, при котором счастье держится не ниже этого.
    minHappiness: 52,
    // Характеры ИИ. attack — множитель нужного перевеса для атаки; warRatio — во сколько раз армия должна
    // быть больше, чтобы начать новую войну; fronts — сколько войн сразу; develop — доля свободного золота
    // на хозяйство; peaceAccept — принимает мир, пока его армия меньше вражеской × peaceAccept;
    // peaceOffer — сам предлагает мир, если его армия меньше вражеской × peaceOffer; cav и art — доля
    // кавалерии и артиллерии в найме для атаки.
    characters: {
      aggressive: { label: 'Агрессор', attack: 0.92, warRatio: 1.0, fronts: 2, develop: 0.15, peaceAccept: 0.8, peaceOffer: 0.5, cav: 0.4, art: 0.15 },
      trader: { label: 'Торговец', attack: 1.1, warRatio: 1.7, fronts: 1, develop: 0.6, peaceAccept: 2.2, peaceOffer: 1.0, cav: 0.15, art: 0.05 },
      defender: { label: 'Оборонщик', attack: 1.05, warRatio: 1.4, fronts: 1, develop: 0.35, peaceAccept: 1.6, peaceOffer: 0.85, cav: 0.1, art: 0.25 },
    },
    // Без характера (старые сохранения) — как раньше.
    balanced: { label: 'Обычный', attack: 1, warRatio: 1.2, fronts: 2, develop: 0.25, peaceAccept: 1.2, peaceOffer: 0.7, cav: 0.25, art: 0.1 },
    // Минимальный гарнизон столицы.
    capitalMinGarrison: 5,
    difficulties: {
      easy: { label: 'Лёгкий', attackRatio: 1.5, incomeMult: 0.8, maxActions: 2 },
      medium: { label: 'Средний', attackRatio: 1.25, incomeMult: 1, maxActions: Infinity },
      hard: { label: 'Тяжёлый', attackRatio: 1.1, incomeMult: 1.2, maxActions: Infinity },
    },
  },

  victory: {
    superiorityDefault: 82,
    superiorityMin: 50,
    superiorityMax: 95,
    flagTurnsDefault: 5,
  },

  net: {
    port: 47630,
    serviceType: 'conquest',
    protocolVersion: 8,
    pingIntervalMs: 5000,
    // Нет данных дольше этого — соединение считается потерянным.
    timeoutMs: 15000,
    // Сколько ждать ответа хоста при подключении.
    connectTimeoutMs: 10000,
    // Поиск перебором: сколько ждать соединения с одним адресом и сколько адресов опрашивать сразу.
    // На Android сетевой модуль выполняет подключения по два, лишние встают в очередь
    // и задерживают настоящее подключение к игре.
    probeConnectMs: 600,
    probeParallel: 2,
    // Сколько хост ждёт отвалившегося игрока, прежде чем поставить паузу.
    reconnectWaitMs: 120000,
  },
} as const;

export type Difficulty = keyof typeof CONFIG.ai.difficulties;
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
