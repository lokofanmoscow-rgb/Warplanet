import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { CONFIG, getMap, type CellId } from '../../engine';
import { defaultSetup, newMatch, newSeed } from '../../game/match';
import { startLocal } from '../../game/sessions';
import { getPlayerName } from '../../game/storage';
import { DEFAULT_MAP_ID } from '../../maps';
import type { LobbySettings } from '../../net/protocol';
import { Button, Field, Swatch, T } from '../components';
import { useNav } from '../nav';
import { COLORS, FONTS, useLayout } from '../theme';
import { LobbyLayout } from './LobbyLayout';
import { SettingsForm } from './SettingsForm';

interface Human {
  name: string;
  start: CellId | null;
}

/** Партия против ИИ или вдвоём на одном телефоне. */
export function SetupScreen({ mode }: { mode: 'ai' | 'hotseat' }) {
  const { go } = useNav();
  const { s } = useLayout();
  const [settings, setSettings] = useState<LobbySettings>(() => ({
    ...defaultSetup(DEFAULT_MAP_ID),
    aiCount: mode === 'ai' ? 4 : 2,
  }));
  const mapId = settings.mapId;
  const map = getMap(mapId);
  const [humans, setHumans] = useState<Human[]>(() =>
    mode === 'ai'
      ? [{ name: 'Игрок', start: null }]
      : [
          { name: 'Игрок 1', start: null },
          { name: 'Игрок 2', start: null },
        ],
  );
  const [picker, setPicker] = useState(0);
  // Сид партии выбирается заранее: поделённая карта на превью та же, что будет в игре.
  const [seed, setSeed] = useState(newSeed);

  useEffect(() => {
    if (mode === 'ai') void getPlayerName().then((name) => setHumans((h) => [{ ...h[0], name }]));
  }, [mode]);

  const maxAI = Math.min(CONFIG.players.maxAI, map.startPoints.length - humans.length);

  const pick = (cell: CellId) => {
    setHumans((list) =>
      list.map((h, i) => {
        if (i === picker) return { ...h, start: h.start === cell ? null : cell };
        return h.start === cell ? { ...h, start: null } : h;
      }),
    );
    // На одном телефоне — следующий игрок выбирает следующим.
    if (mode === 'hotseat' && picker < humans.length - 1 && humans[picker + 1].start === null) setPicker(picker + 1);
  };

  const setHumanCount = (n: number) => {
    setHumans((list) => {
      const next = list.slice(0, n);
      while (next.length < n) next.push({ name: `Игрок ${next.length + 1}`, start: null });
      return next;
    });
    setPicker((p) => Math.min(p, n - 1));
    setSettings((st) => ({ ...st, aiCount: Math.min(st.aiCount, Math.min(CONFIG.players.maxAI, map.startPoints.length - n)) }));
  };

  const changeSettings = (patch: Partial<LobbySettings>) => {
    if (patch.mapId !== undefined && patch.mapId !== mapId) {
      // Новая карта: столицы выбираются заново, ИИ не больше её стартовых точек.
      const points = getMap(patch.mapId).startPoints.length;
      setHumans((list) => list.map((h) => ({ ...h, start: null })));
      setSettings((st) => ({ ...st, ...patch, aiCount: Math.min(st.aiCount, CONFIG.players.maxAI, points - humans.length) }));
      return;
    }
    setSettings((st) => ({ ...st, ...patch }));
  };

  const named = humans.map((h, i) => ({ name: h.name.trim() || `Игрок ${i + 1}`, start: h.start }));
  const divided = settings.startMode === 'divided';
  const canStart = mode === 'ai' ? settings.aiCount >= 1 : humans.length + settings.aiCount >= 2;
  // Имена на раздел не влияют — пересчёт только по столицам и настройкам.
  const startsKey = humans.map((h) => h.start).join(',');
  const preview = useMemo(
    () => (divided && canStart ? newMatch({ ...settings, humans: named, seed }) : null),
    [divided, canStart, settings, seed, startsKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = () => {
    const controller = startLocal(mode, { ...settings, humans: named, seed });
    go({ name: 'game', controller });
  };

  return (
    <LobbyLayout
      title={mode === 'ai' ? 'Против ИИ' : 'На одном телефоне'}
      mapId={mapId}
      markers={map.startPoints.map((cell) => {
        const idx = humans.findIndex((h) => h.start === cell);
        return { cell, color: idx >= 0 ? CONFIG.players.colors[idx] : null, label: idx >= 0 ? humans[idx].name : undefined };
      })}
      onPickStart={pick}
      preview={preview}
      onBack={() => go({ name: 'menu' })}
      footer={<Button label="Начать" variant="primary" icon="swords" disabled={!canStart} onPress={start} />}
    >
      {mode === 'hotseat' && (
        <Field label="Живых игроков" hint="Игроки по очереди передают телефон">
          <View style={{ flexDirection: 'row', gap: 8 * s }}>
            {[2, 3, 4].map((n) => (
              <Button key={n} label={String(n)} small variant={humans.length === n ? 'primary' : 'secondary'} onPress={() => setHumanCount(n)} />
            ))}
          </View>
        </Field>
      )}
      <Field label={mode === 'ai' ? 'Ваше имя и столица' : 'Игроки и столицы'} hint="Без выбора столица достанется случайно">
        {humans.map((h, i) => (
          <Pressable
            key={i}
            onPress={() => setPicker(i)}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8 * s,
              padding: 6 * s,
              borderRadius: 8 * s,
              borderWidth: 1.5,
              borderColor: picker === i ? COLORS.gold : 'transparent',
              backgroundColor: picker === i ? COLORS.panelLight : 'transparent',
            }}
          >
            <Swatch color={CONFIG.players.colors[i]} size={16} />
            <TextInput
              value={h.name}
              onChangeText={(name) => setHumans((list) => list.map((x, j) => (j === i ? { ...x, name } : x)))}
              onFocus={() => setPicker(i)}
              maxLength={24}
              style={{ flex: 1, color: COLORS.text, fontFamily: FONTS.bold, fontSize: 15 * s, paddingVertical: 2 }}
            />
            <T dim size={13}>
              {h.start !== null ? map.cells[h.start].name : 'случайно'}
            </T>
          </Pressable>
        ))}
      </Field>
      <SettingsForm value={settings} onChange={changeSettings} minAI={mode === 'ai' ? 1 : 0} maxAI={maxAI} />
      {divided && (
        <Field label="Раздел карты" hint="На карте слева — как будут поделены земли. Столицу можно выбрать кольцом.">
          <Button label="Поделить по-другому" small icon="flag" onPress={() => setSeed(newSeed())} />
        </Field>
      )}
    </LobbyLayout>
  );
}
