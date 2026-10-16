import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Pressable, TextInput, View } from 'react-native';
import { CONFIG, getMap } from '../../engine';
import { MatchController } from '../../game/controller';
import { getClientId, getPlayerName } from '../../game/storage';
import { DEFAULT_MAP_ID } from '../../maps';
import { GameClient } from '../../net/client';
import { useGameScan } from '../../net/discovery';
import { getNet } from '../../net/platform';
import { Button, Field, Row, Swatch, T } from '../components';
import { useNav } from '../nav';
import { COLORS, FONTS, useLayout } from '../theme';
import { LobbyLayout } from './LobbyLayout';
import { SettingsForm } from './SettingsForm';

const noop = () => () => {};

/** Поиск игры: найденные хосты в сети и ручной ввод IP; после подключения — лобби клиента. */
export function FindGame() {
  const { go } = useNav();
  const { s } = useLayout();
  const [client, setClient] = useState<GameClient | null>(null);
  const [ip, setIp] = useState('');
  const [port, setPort] = useState(String(CONFIG.net.port));
  const handed = useRef(false);
  const { hosts, scanning, error } = useGameScan(client === null);

  useSyncExternalStore(client ? (fn) => client.subscribe(fn) : noop, () =>
    client ? `${client.status}|${JSON.stringify(client.lobby)}|${client.game?.turn ?? 0}` : '',
  );

  useEffect(() => () => {
    if (!handed.current) client?.close();
  }, [client]);

  // Хост начал партию — переходим к карте.
  useEffect(() => {
    if (client?.game && !handed.current) {
      handed.current = true;
      go({ name: 'game', controller: new MatchController('client', client.game, { client }) });
    }
  });

  const connect = async (host: string, p: number) => {
    const [name, clientId] = await Promise.all([getPlayerName(), getClientId()]);
    const c = new GameClient({ net: getNet(), host, port: p, name, clientId });
    setClient(c);
    c.connect();
  };

  const lobby = client?.lobby ?? null;
  const mapId = lobby?.settings.mapId ?? DEFAULT_MAP_ID;
  const map = getMap(mapId);
  const markers = map.startPoints.map((cell) => {
    if (lobby?.starts[0] === cell) return { cell, color: CONFIG.players.colors[0], label: lobby.hostName };
    if (lobby?.starts[1] === cell) return { cell, color: CONFIG.players.colors[1], label: lobby.clientName ?? 'Вы' };
    return { cell, color: null };
  });

  const disconnected = client && (client.status === 'closed' || client.status === 'rejected');

  return (
    <LobbyLayout
      title={lobby ? 'Лобби' : 'Найти игру'}
      mapId={mapId}
      markers={markers}
      onPickStart={(cell) => {
        if (!client || !lobby) return;
        client.setStart(lobby.starts[1] === cell ? null : cell);
      }}
      onBack={() => go({ name: 'menu' })}
    >
      {!client || disconnected ? (
        <>
          {disconnected && (
            <T style={{ color: COLORS.danger, marginBottom: 10 * s }}>{client?.reason ?? 'Соединение закрыто'}</T>
          )}
          <Field label="Игры в сети" hint="Оба телефона должны быть в одной Wi-Fi сети">
            {hosts.length === 0 ? (
              <Row>
                {scanning || !error ? <ActivityIndicator color={COLORS.gold} /> : null}
                <T dim>{error ? `Поиск недоступен: ${error}` : 'Ищем игры…'}</T>
              </Row>
            ) : (
              <View style={{ gap: 8 * s }}>
                {hosts.map((h) => (
                  <Pressable
                    key={h.key}
                    onPress={() => void connect(h.host, h.port)}
                    style={({ pressed }) => ({
                      padding: 10 * s,
                      borderRadius: 8 * s,
                      borderWidth: 1.5,
                      borderColor: COLORS.gold,
                      backgroundColor: pressed ? COLORS.panelLight : COLORS.panelDeep,
                    })}
                  >
                    <T bold>{h.name}</T>
                    <T dim size={12}>
                      {h.host}:{h.port}
                    </T>
                  </Pressable>
                ))}
              </View>
            )}
          </Field>
          <Field label="Подключиться по адресу" hint="IP и порт показаны в лобби хоста">
            <Row gap={8}>
              <TextInput
                value={ip}
                onChangeText={setIp}
                placeholder="192.168.0.10"
                placeholderTextColor={COLORS.textDim}
                keyboardType="numbers-and-punctuation"
                autoCapitalize="none"
                style={{ flex: 1, color: COLORS.text, fontFamily: FONTS.bold, fontSize: 16 * s, borderBottomWidth: 1.5, borderBottomColor: COLORS.goldDark, paddingVertical: 6 * s }}
              />
              <TextInput
                value={port}
                onChangeText={setPort}
                keyboardType="number-pad"
                style={{ width: 70 * s, color: COLORS.text, fontFamily: FONTS.bold, fontSize: 16 * s, borderBottomWidth: 1.5, borderBottomColor: COLORS.goldDark, paddingVertical: 6 * s }}
              />
            </Row>
            <Button
              label="Подключиться"
              icon="wifi"
              disabled={!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim()) || !Number(port)}
              onPress={() => void connect(ip.trim(), Number(port))}
              style={{ marginTop: 10 * s }}
            />
          </Field>
        </>
      ) : !lobby ? (
        <Row>
          <ActivityIndicator color={COLORS.gold} />
          <T>{client.status === 'reconnecting' ? 'Переподключение…' : 'Подключение…'}</T>
        </Row>
      ) : (
        <>
          <Field label="Хост">
            <Row>
              <Swatch color={CONFIG.players.colors[0]} />
              <T bold>{lobby.hostName}</T>
              <T dim>· {lobby.starts[0] !== null ? map.cells[lobby.starts[0]].name : 'столица случайно'}</T>
            </Row>
          </Field>
          <Field label="Вы" hint="Нажмите на кольцо на карте, чтобы выбрать столицу">
            <Row>
              <Swatch color={CONFIG.players.colors[1]} />
              <T bold>{lobby.clientName}</T>
              <T dim>· {lobby.starts[1] !== null ? map.cells[lobby.starts[1]].name : 'столица случайно'}</T>
            </Row>
          </Field>
          <SettingsForm value={lobby.settings} readOnly />
          <Row>
            <ActivityIndicator color={COLORS.gold} />
            <T dim>Ждём, пока хост начнёт игру…</T>
          </Row>
        </>
      )}
    </LobbyLayout>
  );
}
