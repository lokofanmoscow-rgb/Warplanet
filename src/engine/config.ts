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
    happiness: 70,
    tax: 60,
  },

  neutral: {
    // Ополчение нейтральной провинции = население / militiaPer.
    militiaPer: 1000,
    // Доля целевого ополчения, восстанавливаемая за ход после боёв.
    militiaRegen: 0.1,
    // При покупке ополчение распускается (true — переходит к покупателю).
    buyKeepsMilitia: false,
  },

  economy: {
    taxMin: 0,
    taxMax: 200,
    taxStep: 10,
    // доход = население / popPerGold × налог / 100 × k
    popPerGold: 1000,
    // k = 1 при счастье ≥ fullAt, partialK при счастье ≥ partialAt, иначе 0.
    fullAt: 50,
    partialAt: 25,
    partialK: 0.25,
    // цель счастья = 100 − happinessPerTax × налог
    happinessBase: 100,
    happinessPerTax: 0.4,
    happinessStep: 5,
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
  },

  ap: {
    base: 5,
    // +1 ОД за каждые perProvinces своих провинций.
    perProvinces: 10,
  },

  actions: {
    recruit: { ap: 1, goldPerSoldier: 2, popPerSoldier: 100, maxPopShare: 0.1 },
    fortify: { ap: 2, gold: 30, defenseMult: 2 },
    buy: { ap: 1, popPerGold: 200 },
    loot: { ap: 1, popPerGold: 200, popLoss: 0.1, happinessLoss: 20 },
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
    minHappiness: 55,
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
    protocolVersion: 1,
    pingIntervalMs: 5000,
    // Нет данных дольше этого — соединение считается потерянным.
    timeoutMs: 15000,
    // Сколько хост ждёт отвалившегося игрока, прежде чем поставить паузу.
    reconnectWaitMs: 120000,
  },
} as const;

export type Difficulty = keyof typeof CONFIG.ai.difficulties;
export const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard'];
