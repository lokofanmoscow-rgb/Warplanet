import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { CONFIG, getMap } from '../../engine';
import { MatchController } from '../../game/controller';
import { createHost } from '../../game/sessions';
import { getPlayerName } from '../../game/storage';
import { DEFAULT_MAP_ID } from '../../maps';
import type { GameHost } from '../../net/host';
import { getLocalIp } from '../../net/platform';
import { Button, Field, Row, Swatch, T } from '../components';
import { useNav } from '../nav';
import { COLORS, useLayout } from '../theme';
import { LobbyLayout } from './LobbyLayout';
import { SettingsForm } from './SettingsForm';

const noop = () => () => {};

/** Лобби хоста: настройки партии, IP и порт, статус второго игрока, выбор стартовой точки. */
export function HostLobby() {
  const { go } = useNav();
  const { s } = useLayout();
  const [host, setHost] = useState<GameHost | null>(null);
  const [ip, setIp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const handed = useRef(false);
  const unpublishRef = useRef<() => void>(() => {});
  useSyncExternalStore(host ? (fn) => host.subscribe(fn) : noop, () => (host ? JSON.stringify(host.lobby) : ''));
  // Карту выбирают в настройках лобби; хост создаётся один раз с картой по умолчанию.
  const mapId = host?.lobby.settings.mapId ?? DEFAULT_MAP_ID;
  const map = getMap(mapId);

  useEffect(() => {
    let created: GameHost | null = null;
    let alive = true;
    (async () => {
      try {
        const name = await getPlayerName();
        const { host: h, unpublish } = await createHost(name, DEFAULT_MAP_ID);
        created = h;
        unpublishRef.current = unpublish;
        if (!alive) {
          h.stop();
          unpublish();
          return;
        }
        setHost(h);
        setIp(await getLocalIp());
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Не удалось создать игру');
      }
    })();
    return () => {
      alive = false;
      // Если партия началась — хост живёт дальше в контроллере.
      if (!handed.current) {
        created?.stop();
        unpublishRef.current();
      }
    };
  }, []);

  const lobby = host?.lobby;
  const start = () => {
    if (!host) return;
    host.startGame();
    handed.current = true;
    const controller = new MatchController('host', host.game!, { host });
    const dispose = controller.dispose.bind(controller);
    const unpublish = unpublishRef.current;
    controller.dispose = () => {
      unpublish();
      dispose();
    };
    go({ name: 'game', controller });
  };

  const markers = map.startPoints.map((cell) => {
    if (lobby?.starts[0] === cell) return { cell, color: CONFIG.players.colors[0], label: lobby.hostName };
    if (lobby?.starts[1] === cell) return { cell, color: CONFIG.players.colors[1], label: lobby.clientName ?? 'Игрок 2' };
    return { cell, color: null };
  });

  return (
    <LobbyLayout
      title="Создать игру"
      mapId={mapId}
      markers={markers}
      onPickStart={(cell) => host?.setHostStart(lobby?.starts[0] === cell ? null : cell)}
      onBack={() => go({ name: 'menu' })}
      footer={
        <Button
          label={lobby?.clientConnected ? 'Начать' : 'Ждём второго игрока…'}
          variant="primary"
          icon="swords"
          disabled={!lobby?.clientConnected}
          onPress={start}
        />
      }
    >
      {error && <T style={{ color: COLORS.danger, marginBottom: 10 * s }}>{error}</T>}
      {!host && !error && <ActivityIndicator color={COLORS.gold} />}
      {host && lobby && (
        <>
          <Field label="Адрес для подключения" hint="Второй телефон в той же Wi-Fi сети найдёт игру сам или по этому адресу">
            <T bold size={20} selectable>
              {ip ?? 'IP неизвестен'}:{host.port}
            </T>
          </Field>
          <Field label="Игроки">
            <View style={{ gap: 6 * s }}>
              <Row>
                <Swatch color={CONFIG.players.colors[0]} />
                <T bold>{lobby.hostName}</T>
                <T dim>· {lobby.starts[0] !== null ? map.cells[lobby.starts[0]].name : 'столица случайно'}</T>
              </Row>
              <Row>
                <Swatch color={CONFIG.players.colors[1]} />
                {lobby.clientConnected ? (
                  <>
                    <T bold>{lobby.clientName}</T>
                    <T dim>· {lobby.starts[1] !== null ? map.cells[lobby.starts[1]].name : 'столица случайно'}</T>
                  </>
                ) : (
                  <T dim>ждём подключения…</T>
                )}
              </Row>
            </View>
          </Field>
          <SettingsForm value={lobby.settings} onChange={(p) => host.setSettings(p)} maxAI={Math.min(CONFIG.players.maxAI, map.startPoints.length - 2)} />
        </>
      )}
    </LobbyLayout>
  );
}
