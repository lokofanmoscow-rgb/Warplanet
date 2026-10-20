import React from 'react';
import { CONFIG, DIFFICULTIES, getMap, type Difficulty, type StartMode, type VictoryType } from '../../engine';
import { MAPS } from '../../maps';
import type { LobbySettings } from '../../net/protocol';
import { Field, Segmented, Stepper, T } from '../components';

export const VICTORY_LABEL: Record<VictoryType, string> = {
  superiority: 'Превосходство',
  domination: 'Доминирование',
  annihilation: 'Уничтожение',
  flag: 'Захват флага',
};

export const VICTORY_HINT: Record<VictoryType, string> = {
  superiority: 'Контроль заданной доли провинций суши',
  domination: 'Контроль всех провинций суши',
  annihilation: 'Все соперники, включая ИИ, выбыли',
  flag: 'Удерживать отмеченную провинцию N ходов подряд',
};

const LIMITS = [0, 30, 50, 100];

export const START_LABEL: Record<StartMode, string> = {
  classic: 'Обычное',
  divided: 'Карта поделена',
};

const START_HINT: Record<StartMode, string> = {
  classic: 'У каждого столица и две провинции, остальная суша ничейная',
  divided: 'Вся суша сразу поровну поделена между игроками, ничейных клеток нет; в каждой провинции небольшой гарнизон',
};

const MAP_HINT: Record<string, string> = {
  europe: 'Страны поделены на провинции, рядом моря и проливы',
  africa: 'Каждая страна — одна клетка, вокруг только океан',
  usa: 'Каждый штат — одна клетка, вокруг только океан и Великие озёра',
  russia: 'Клетка — область или край, огромные края поделены на части; вокруг только вода',
  world: 'Все материки: мелкие страны объединены, крупные поделены на провинции',
};

/** Настройки партии: карта, число и сложность ИИ, условие победы, лимит ходов. */
export function SettingsForm({
  value,
  onChange,
  minAI = 0,
  maxAI = CONFIG.players.maxAI,
  readOnly,
}: {
  value: LobbySettings;
  onChange?: (patch: Partial<LobbySettings>) => void;
  minAI?: number;
  maxAI?: number;
  readOnly?: boolean;
}) {
  const set = (patch: Partial<LobbySettings>) => !readOnly && onChange?.(patch);
  if (readOnly) {
    return (
      <>
        <Field label="Карта">
          <T>{getMap(value.mapId).name}</T>
        </Field>
        <Field label="Начало партии" hint={START_HINT[value.startMode]}>
          <T>{START_LABEL[value.startMode]}</T>
        </Field>
        <Field label="Соперники">
          <T>
            ИИ: {value.aiCount}, сложность: {CONFIG.ai.difficulties[value.aiDifficulty].label.toLowerCase()}
          </T>
        </Field>
        <Field label="Условие победы" hint={VICTORY_HINT[value.victory]}>
          <T>
            {VICTORY_LABEL[value.victory]}
            {value.victory === 'superiority' ? ` · ${value.superiority}%` : ''}
            {value.victory === 'flag' ? ` · ${value.flagTurns} ход.` : ''}
          </T>
        </Field>
        <Field label="Лимит ходов">
          <T>{value.turnLimit > 0 ? value.turnLimit : 'без лимита'}</T>
        </Field>
      </>
    );
  }
  return (
    <>
      <Field label="Карта" hint={MAP_HINT[value.mapId]}>
        <Segmented<string> options={MAPS.map((m) => ({ value: m.id, label: m.name }))} value={value.mapId} onChange={(mapId) => set({ mapId })} />
      </Field>
      <Field
        label="Начало партии"
        hint={START_HINT[value.startMode] + (value.startMode === 'divided' && value.victory === 'flag' ? '. Ничейной останется только клетка с флагом' : '')}
      >
        <Segmented<StartMode>
          options={(Object.keys(START_LABEL) as StartMode[]).map((m) => ({ value: m, label: START_LABEL[m] }))}
          value={value.startMode}
          onChange={(startMode) => set({ startMode })}
        />
      </Field>
      <Field label="Число ИИ-соперников">
        <Stepper value={value.aiCount} min={minAI} max={maxAI} onChange={(aiCount) => set({ aiCount })} />
      </Field>
      <Field label="Сложность ИИ">
        <Segmented<Difficulty>
          options={DIFFICULTIES.map((d) => ({ value: d, label: CONFIG.ai.difficulties[d].label }))}
          value={value.aiDifficulty}
          onChange={(aiDifficulty) => set({ aiDifficulty })}
        />
      </Field>
      <Field label="Условие победы" hint={VICTORY_HINT[value.victory]}>
        <Segmented<VictoryType>
          options={(Object.keys(VICTORY_LABEL) as VictoryType[]).map((v) => ({ value: v, label: VICTORY_LABEL[v] }))}
          value={value.victory}
          onChange={(victory) => set({ victory })}
        />
      </Field>
      {value.victory === 'superiority' && (
        <Field
          label="Порог превосходства"
          hint={value.startMode === 'divided' ? 'На поделённой карте порог не ниже начальной доли самого крупного игрока + 10%' : undefined}
        >
          <Stepper
            value={value.superiority}
            min={CONFIG.victory.superiorityMin}
            max={CONFIG.victory.superiorityMax}
            step={1}
            big={5}
            format={(v) => `${v}%`}
            onChange={(superiority) => set({ superiority })}
          />
        </Field>
      )}
      {value.victory === 'flag' && (
        <Field label="Сколько ходов держать флаг">
          <Stepper value={value.flagTurns} min={1} max={20} onChange={(flagTurns) => set({ flagTurns })} />
        </Field>
      )}
      <Field label="Лимит ходов" hint="Без победителя к лимиту выигрывает тот, у кого больше провинций">
        <Segmented<number>
          options={LIMITS.map((l) => ({ value: l, label: l === 0 ? 'Нет' : String(l) }))}
          value={value.turnLimit}
          onChange={(turnLimit) => set({ turnLimit })}
        />
      </Field>
    </>
  );
}
