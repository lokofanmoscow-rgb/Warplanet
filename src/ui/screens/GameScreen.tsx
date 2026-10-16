import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getMap, type CellId } from '../../engine';
import type { MatchController } from '../../game/controller';
import { clearSave } from '../../game/storage';
import { Button, Panel, RoundButton, T } from '../components';
import { GameMenu, HandoffScreen, LogDialog, MoveDialog, TaxDialog } from '../game/Dialogs';
import { ProvincePanel } from '../game/ProvincePanel';
import { TopBar } from '../game/TopBar';
import { Icon } from '../icons';
import { buildPlates, MapView } from '../map/MapView';
import { useNav } from '../nav';
import { COLORS, useLayout } from '../theme';

function useController(c: MatchController): number {
  return useSyncExternalStore(c.subscribe, c.getVersion, c.getVersion);
}

/** Основной экран: карта, верхняя панель, панель провинции, приказы и «Готово». */
export function GameScreen({ controller: c }: { controller: MatchController }) {
  useController(c);
  const { go } = useNav();
  const { s, landscape, width, height } = useLayout();
  const insets = useSafeAreaInsets();
  const game = c.game;
  const map = getMap(game.mapId);
  const player = c.active;
  const me = game.players[player];
  const plan = c.plan();
  const orders = c.orders();
  const editable = c.canEdit();
  const hidden = c.handoff !== null;

  const [selected, setSelected] = useState<CellId | null>(null);
  const [moveFrom, setMoveFrom] = useState<CellId | null>(null);
  const [moveDialog, setMoveDialog] = useState<{ from: CellId; to: CellId } | null>(null);
  const [taxOpen, setTaxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<CellId | null>(me?.capital ?? null);
  const [now, setNow] = useState(Date.now());

  // Новый ход — снимаем выделение и показываем журнал.
  useEffect(() => {
    setSelected(null);
    setMoveFrom(null);
    setMoveDialog(null);
    if (c.log && game.turn > 1) setLogOpen(true);
  }, [game.turn, game.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // После передачи телефона — к столице нового игрока.
  useEffect(() => {
    if (!hidden) setFocus(game.players[player]?.capital ?? null);
  }, [hidden, player]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Таймер для отсчёта ожидания отвалившегося игрока.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const exit = useCallback(() => {
    c.dispose();
    go({ name: 'menu' });
  }, [c, go]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (moveDialog || taxOpen || logOpen) {
        setMoveDialog(null);
        setTaxOpen(false);
        setLogOpen(false);
      } else if (selected !== null) setSelected(null);
      else setMenuOpen((v) => !v);
      return true;
    });
    return () => sub.remove();
  }, [moveDialog, taxOpen, logOpen, selected]);

  // Конец партии — итоги.
  const finishedSeen = game.finished && !logOpen;
  useEffect(() => {
    if (!finishedSeen) return;
    void clearSave();
    const viewer = c.localPlayers()[0] ?? null;
    const t = setTimeout(() => {
      c.dispose();
      go({ name: 'results', game, mode: c.mode, viewer });
    }, 400);
    return () => clearTimeout(t);
  }, [finishedSeen]); // eslint-disable-line react-hooks/exhaustive-deps

  const plates = useMemo(
    () => (hidden ? buildPlates(game, null, null, []) : buildPlates(game, player, plan.projected, orders.moves)),
    [game, player, plan, orders.moves, hidden, c.version], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const draggable = useMemo(
    () => (editable ? plan.available.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0) : []),
    [editable, plan],
  );
  const targets = moveFrom !== null ? map.cells[moveFrom].neighbors : [];

  const openMove = (from: CellId, to: CellId) => {
    if (!editable) return;
    if (!map.cells[from].neighbors.includes(to)) {
      setToast('Армия идёт только на соседнюю клетку');
      return;
    }
    if ((plan.available[from] ?? 0) <= 0) return;
    setMoveDialog({ from, to });
  };

  const onTapCell = (cell: CellId | null) => {
    if (cell === null) {
      setSelected(null);
      setMoveFrom(null);
      return;
    }
    if (moveFrom !== null && cell !== moveFrom && map.cells[moveFrom].neighbors.includes(cell)) {
      openMove(moveFrom, cell);
      return;
    }
    setMoveFrom(null);
    setSelected(cell === selected ? null : cell);
  };

  const humans = game.players.filter((p) => p.kind === 'human' && p.alive);
  const ready = c.readyFlags();
  const submitted = c.isSubmitted();
  const wide = landscape && width >= 700;
  const panelW = Math.min(340 * s, width * 0.42);

  // Сетевые подсказки.
  let banner: string | null = null;
  if (c.mode === 'host' && c.host && !game.finished) {
    if (!c.host.clientConnected) {
      if (c.host.paused) banner = 'Пауза: второй игрок не вернулся. Партия сохранена — можно выйти и продолжить позже.';
      else if (c.host.disconnectedAt !== null) {
        const left = Math.max(0, 120 - Math.floor((now - c.host.disconnectedAt) / 1000));
        banner = `Второй игрок отключился. Ждём ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
      }
    } else if (submitted) banner = 'Приказы отданы. Ждём второго игрока…';
  }
  if (c.mode === 'client' && c.client) {
    if (c.client.status === 'reconnecting') banner = 'Связь с хостом потеряна, переподключение…';
    else if (c.client.status === 'closed' || c.client.status === 'rejected') banner = `Соединение закрыто${c.client.reason ? `: ${c.client.reason}` : ''}`;
    else if (submitted && !game.finished) banner = 'Приказы отданы. Ждём хоста…';
  }

  const panel =
    selected !== null && !hidden ? (
      <ProvincePanel
        controller={c}
        map={map}
        game={game}
        plan={plan}
        cell={selected}
        player={player}
        onMove={(from) => {
          setMoveFrom(from);
          setSelected(null);
          setToast('Выберите соседнюю клетку или перетащите армию');
        }}
        onClose={() => setSelected(null)}
        onError={setToast}
      />
    ) : null;

  return (
    <View style={styles.root}>
      <MapView
        map={map}
        game={game}
        plates={plates}
        moves={hidden ? [] : orders.moves}
        moveColor={me?.color}
        selected={moveFrom ?? selected}
        targets={targets}
        draggable={draggable}
        onTapCell={onTapCell}
        onDragMove={openMove}
        focusCell={focus}
        insets={{ top: insets.top + 70 * s, bottom: insets.bottom, left: insets.left, right: insets.right }}
      />

      {/* Верхняя панель */}
      <View style={[styles.top, { top: insets.top + 6 * s, left: insets.left + 6 * s, right: insets.right + 6 * s }]} pointerEvents="box-none">
        <TopBar game={game} player={player} plan={plan} tax={orders.tax} onTax={() => setTaxOpen(true)} onMenu={() => setMenuOpen(true)} />
      </View>

      {/* Подсказки */}
      {(banner || toast || moveFrom !== null) && (
        <View style={[styles.bannerWrap, { top: insets.top + (landscape ? 70 : 118) * s }]} pointerEvents="none">
          <View style={[styles.banner, { paddingHorizontal: 14 * s, paddingVertical: 8 * s, borderRadius: 10 * s }]}>
            <T size={14} style={{ textAlign: 'center' }}>
              {toast ?? banner ?? 'Выберите клетку, куда идёт армия'}
            </T>
          </View>
        </View>
      )}

      {/* Панель провинции: справа на широком экране, снизу на узком */}
      {panel &&
        (wide ? (
          <View style={[styles.side, { width: panelW, top: insets.top + 74 * s, bottom: insets.bottom + 8 * s, right: insets.right + 8 * s }]}>
            <Panel style={{ maxHeight: '100%' }}>{panel}</Panel>
          </View>
        ) : (
          <View style={[styles.sheet, { left: insets.left + 6 * s, right: insets.right + 6 * s, bottom: insets.bottom + 84 * s, maxHeight: height * 0.48 }]}>
            <Panel style={{ maxHeight: '100%' }}>{panel}</Panel>
          </View>
        ))}

      {/* Кнопки внизу */}
      <View style={[styles.bottomLeft, { left: insets.left + 10 * s, bottom: insets.bottom + 10 * s, gap: 10 * s }]}>
        <RoundButton icon="log" label="Журнал хода" size={52} disabled={game.turn <= 1} onPress={() => setLogOpen(true)} />
      </View>
      <View
        style={[
          styles.bottomRight,
          // Широкая панель провинции занимает правый край — кнопки сдвигаются левее.
          { right: insets.right + (panel && wide ? panelW + 18 * s : 10 * s), bottom: insets.bottom + 10 * s, gap: 10 * s },
        ]}
      >
        {humans.length > 1 && (
          <View style={[styles.readyRow, { gap: 6 * s, padding: 6 * s, borderRadius: 10 * s }]}>
            {humans.map((p) => (
              <View key={p.id} style={[styles.readyItem, { gap: 4 * s }]}>
                <View style={{ width: 12 * s, height: 12 * s, borderRadius: 6 * s, backgroundColor: p.color }} />
                {ready[p.id] ? <Icon name="check" size={14 * s} color={COLORS.ok} /> : <T size={12}>…</T>}
              </View>
            ))}
          </View>
        )}
        <RoundButton icon="undo" label="Отменить последний" size={52} disabled={!c.canUndo} onPress={() => c.undo()} />
        <RoundButton icon="check" label="Готово" size={68} active={editable} disabled={!editable} onPress={() => c.ready()} />
      </View>

      {c.busy && (
        <View style={[StyleSheet.absoluteFill, styles.busy]}>
          <Panel>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 * s }}>
              <ActivityIndicator color={COLORS.gold} />
              <T bold>Расчёт хода…</T>
            </View>
          </Panel>
        </View>
      )}

      {moveDialog && (
        <MoveDialog
          map={map}
          from={moveDialog.from}
          to={moveDialog.to}
          available={plan.available[moveDialog.from] ?? 0}
          onCancel={() => setMoveDialog(null)}
          onConfirm={(count) => {
            const err = c.addMove({ from: moveDialog.from, to: moveDialog.to, count });
            if (err) setToast(err);
            setMoveDialog(null);
            setMoveFrom(null);
          }}
        />
      )}
      {taxOpen && (
        <TaxDialog
          game={game}
          player={player}
          value={orders.tax}
          editable={editable}
          onCancel={() => setTaxOpen(false)}
          onConfirm={(tax) => {
            c.setTax(tax);
            setTaxOpen(false);
          }}
        />
      )}
      {logOpen && <LogDialog game={game} map={map} viewer={c.mode === 'hotseat' ? null : player} onClose={() => setLogOpen(false)} />}
      {c.handoff !== null && !logOpen && !game.finished && <HandoffScreen game={game} player={c.handoff} onReady={() => c.takeOver()} />}
      {menuOpen && (
        <GameMenu
          canSave={c.mode !== 'client'}
          onResume={() => setMenuOpen(false)}
          onLog={() => {
            setMenuOpen(false);
            setLogOpen(true);
          }}
          onExit={exit}
        />
      )}
      {c.mode === 'client' && (c.client?.status === 'closed' || c.client?.status === 'rejected') && !game.finished && (
        <View style={[styles.bottomCenter, { bottom: insets.bottom + 90 * s }]}>
          <Button label="В главное меню" onPress={exit} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.seaDeep },
  top: { position: 'absolute', alignItems: 'center' },
  bannerWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  banner: { backgroundColor: 'rgba(43,33,24,0.92)', borderWidth: 1.5, borderColor: COLORS.gold, maxWidth: '90%' },
  side: { position: 'absolute' },
  sheet: { position: 'absolute' },
  bottomLeft: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end' },
  bottomRight: { position: 'absolute', flexDirection: 'row', alignItems: 'flex-end' },
  bottomCenter: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  readyRow: { flexDirection: 'row', backgroundColor: 'rgba(43,33,24,0.9)', borderWidth: 1, borderColor: COLORS.goldDark, alignSelf: 'center' },
  readyItem: { flexDirection: 'row', alignItems: 'center' },
  busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(20,14,9,0.45)' },
});
