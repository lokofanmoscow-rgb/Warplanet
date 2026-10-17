import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, BackHandler, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CONFIG, getMap, isPeaceful, moveBlockReason, reachable, type CellId, type MoveKind } from '../../engine';
import type { MatchController } from '../../game/controller';
import { clearSave } from '../../game/storage';
import { Button, Panel, RoundButton, T } from '../components';
import { GameMenu, HandoffScreen, LogDialog, MoveDialog, TaxDialog } from '../game/Dialogs';
import { ProvincePanel } from '../game/ProvincePanel';
import { TopBar } from '../game/TopBar';
import { Icon } from '../icons';
import { BATTLE_MS, battleResult, battlesFor, BattleScene, PendingFills, RESULT_AT, useBattleClock, type BattleView } from '../map/battle';
import { buildUnits, MapView, WALK_STEP_MS, type WalkInfo } from '../map/MapView';
import type { UnitInfo } from '../map/units';
import { useNav } from '../nav';
import { COLORS, useLayout } from '../theme';

const NO_TARGETS: CellId[] = [];

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
  const [moveDialog, setMoveDialog] = useState<{ from: CellId; to: CellId; kind: MoveKind; steps: number } | null>(null);
  const [walk, setWalk] = useState<WalkInfo | null>(null);
  const walkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (walkTimer.current) clearTimeout(walkTimer.current);
  }, []);
  const [taxOpen, setTaxOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focus, setFocus] = useState<CellId | null>(me?.capital ?? null);
  const [now, setNow] = useState(Date.now());

  // Новый ход — снимаем выделение, показываем бои с участием игрока, затем журнал.
  const [replay, setReplay] = useState<{ list: BattleView[]; index: number; result: boolean } | null>(null);
  useEffect(() => {
    setSelected(null);
    setMoveFrom(null);
    setMoveDialog(null);
    if (!c.log || game.turn <= 1) return;
    const list = battlesFor(c.log, game, map, c.localPlayers());
    if (list.length > 0) setReplay({ list, index: 0, result: false });
    else setLogOpen(true);
  }, [game.turn, game.finished]); // eslint-disable-line react-hooks/exhaustive-deps

  const battle = replay ? replay.list[replay.index] : null;
  const clock = useBattleClock(replay ? `${game.turn}:${replay.index}` : null);
  const endReplay = useCallback(() => {
    setReplay(null);
    setLogOpen(true);
  }, []);
  // Бой за боем: камера на клетку, через RESULT_AT — итог, через BATTLE_MS — следующий.
  useEffect(() => {
    if (!replay || replay.result) return;
    setFocus(replay.list[replay.index].cell);
    const showResult = setTimeout(() => setReplay((r) => (r ? { ...r, result: true } : r)), RESULT_AT);
    const next = setTimeout(() => {
      setReplay((r) => (r && r.index + 1 < r.list.length ? { ...r, index: r.index + 1, result: false } : null));
      if (replay.index + 1 >= replay.list.length) setLogOpen(true);
    }, BATTLE_MS + 300);
    return () => {
      clearTimeout(showResult);
      clearTimeout(next);
    };
  }, [replay?.index, replay?.list]); // eslint-disable-line react-hooks/exhaustive-deps

  // После передачи телефона — к столице нового игрока.
  useEffect(() => {
    if (!hidden) setFocus(game.players[player]?.capital ?? null);
  }, [hidden, player]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);

  // Таймер отсчёта — только пока ждём отвалившегося игрока, чтобы не перерисовывать экран зря.
  const waitingClient = c.mode === 'host' && !!c.host && !c.host.clientConnected && !c.host.paused && c.host.disconnectedAt !== null;
  useEffect(() => {
    if (!waitingClient) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [waitingClient]);

  const exit = useCallback(() => {
    c.dispose();
    go({ name: 'menu' });
  }, [c, go]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (replay) endReplay();
      else if (moveDialog || taxOpen || logOpen) {
        setMoveDialog(null);
        setTaxOpen(false);
        setLogOpen(false);
      } else if (selected !== null) setSelected(null);
      else setMenuOpen((v) => !v);
      return true;
    });
    return () => sub.remove();
  }, [moveDialog, taxOpen, logOpen, selected, replay, endReplay]);

  // Конец партии — итоги.
  const finishedSeen = game.finished && !logOpen && !replay;
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

  const units = useMemo(() => {
    const list = hidden ? buildUnits(game, null, null, null) : buildUnits(game, player, plan, orders);
    return walk ? withoutWalker(list, walk) : list;
  }, [game, player, plan, orders, hidden, walk, c.version]); // eslint-disable-line react-hooks/exhaustive-deps
  const draggable = useMemo(
    () => (editable ? plan.available.map((n, i) => (n > 0 ? i : -1)).filter((i) => i >= 0) : []),
    [editable, plan],
  );
  // Куда может пойти выбранная армия — подсвечиваем.
  const reach = useMemo(() => (moveFrom !== null ? reachable(plan.projected, map, player, moveFrom) : null), [moveFrom, plan, map, player]);
  const targets = useMemo(() => (reach ? [...reach.keys()] : NO_TARGETS), [reach]);
  // Клетки боёв, которые ещё не показаны: армии там появятся после показа.
  const hiddenUnits = useMemo(() => (replay ? new Set(replay.list.slice(replay.index).map((b) => b.cell)) : undefined), [replay]);
  const mapInsets = useMemo(
    () => ({ top: insets.top + 70 * s, bottom: insets.bottom, left: insets.left, right: insets.right }),
    [insets.top, insets.bottom, insets.left, insets.right, s],
  );

  /** Открывает выбор числа солдат; если туда нельзя — объясняет почему. */
  const openMove = (from: CellId, to: CellId): boolean => {
    if (!editable || (plan.available[from] ?? 0) <= 0) return false;
    const r = reachable(plan.projected, map, player, from).get(to);
    if (!r) {
      setToast(moveBlockReason(plan.projected, map, player, from, to));
      return false;
    }
    setMoveDialog({ from, to, kind: r.kind, steps: r.path.length - 1 });
    return true;
  };

  const onTapCell = (cell: CellId | null) => {
    if (replay) return;
    if (cell === null) {
      setSelected(null);
      setMoveFrom(null);
      return;
    }
    if (moveFrom !== null && cell !== moveFrom) {
      setMoveFrom(null);
      // Нельзя туда — показываем причину и панель клетки (например, с кнопкой «Объявить войну»).
      if (openMove(moveFrom, cell)) return;
      setSelected(cell);
      return;
    }
    setMoveFrom(null);
    setSelected(cell === selected ? null : cell);
  };

  /** Приказ принят — армия сразу идёт по пути на карте. */
  const sendMove = (from: CellId, to: CellId, count: number) => {
    const err = c.addMove({ from, to, count });
    if (err) {
      setToast(err);
      return;
    }
    const next = c.plan();
    const i = c.orders().moves.findIndex((m) => m.from === from && m.to === to);
    const r = next.moveReach[i];
    if (!r) return;
    if (walkTimer.current) clearTimeout(walkTimer.current);
    setWalk({ id: Date.now(), owner: player, count, path: r.path, attack: !isPeaceful(r.kind) });
    walkTimer.current = setTimeout(() => setWalk(null), (r.path.length - 1) * WALK_STEP_MS + 60);
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
        const left = Math.max(0, Math.floor((CONFIG.net.reconnectWaitMs - (now - c.host.disconnectedAt)) / 1000));
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
    selected !== null && !hidden && !replay ? (
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
          setToast('Выберите подсвеченную клетку или перетащите армию');
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
        units={units}
        walk={hidden ? null : walk}
        hiddenUnits={hiddenUnits}
        overlay={
          replay && battle
            ? ({ geo, k, font, atlas }) => (
                <>
                  <PendingFills geo={geo} game={game} battles={replay.list} index={replay.index} t={clock} />
                  <BattleScene key={`${game.turn}:${replay.index}`} map={map} game={game} battle={battle} atlas={atlas} font={font} k={k} t={clock} />
                </>
              )
            : undefined
        }
        moveColor={me?.color}
        selected={moveFrom ?? selected}
        targets={targets}
        draggable={draggable}
        onTapCell={onTapCell}
        onDragMove={openMove}
        focusCell={focus}
        insets={mapInsets}
      />

      {/* Верхняя панель */}
      <View style={[styles.top, { top: insets.top + 6 * s, left: insets.left + 6 * s, right: insets.right + 6 * s }]} pointerEvents="box-none">
        <TopBar game={game} player={player} plan={plan} tax={orders.tax} onTax={() => setTaxOpen(true)} onMenu={() => setMenuOpen(true)} />
      </View>

      {/* Показ боя */}
      {replay && battle && (
        <BattleBanner
          battle={battle}
          index={replay.index}
          total={replay.list.length}
          result={replay.result}
          names={(p) => (p === null ? 'ополчение' : game.players[p]?.name ?? '?')}
          cellName={(id) => map.cells[id].name}
          sea={map.cells[battle.cell].kind === 'sea'}
          outcome={battleResult(battle, map, c.localPlayers(), (p) => (p === null ? 'ополчение' : game.players[p]?.name ?? '?'))}
          top={insets.top + (landscape ? 70 : 118) * s}
        />
      )}

      {/* Подсказки */}
      {!replay && (banner || toast || moveFrom !== null) && (
        <View
          style={[styles.bannerWrap, { top: insets.top + (landscape ? 70 : 118) * s, right: panel && wide ? panelW + 16 * s : 0 }]}
          pointerEvents="none"
        >
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
      {replay ? (
        <View style={[styles.bottomRight, { right: insets.right + 10 * s, bottom: insets.bottom + 14 * s }]}>
          <Button label="Пропустить" icon="close" onPress={endReplay} />
        </View>
      ) : (
        <>
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
        </>
      )}

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
          kind={moveDialog.kind}
          steps={moveDialog.steps}
          available={plan.available[moveDialog.from] ?? 0}
          goldLeft={plan.goldLeft}
          onCancel={() => setMoveDialog(null)}
          onConfirm={(count) => {
            sendMove(moveDialog.from, moveDialog.to, count);
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
      {c.handoff !== null && !logOpen && !replay && !game.finished && <HandoffScreen game={game} player={c.handoff} onReady={() => c.takeOver()} />}
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

/** Надпись над боем: кто с кем, затем итог. */
function BattleBanner({
  battle,
  index,
  total,
  result,
  names,
  cellName,
  sea,
  outcome,
  top,
}: {
  battle: BattleView;
  index: number;
  total: number;
  result: boolean;
  names: (p: number | null) => string;
  cellName: (id: CellId) => string;
  sea: boolean;
  outcome: { text: string; good: boolean };
  top: number;
}) {
  const { s } = useLayout();
  const title = battle.border ? 'Встречный бой' : sea ? 'Морской бой' : `Бой за провинцию ${cellName(battle.cell)}`;
  return (
    <View style={[styles.bannerWrap, { top }]} pointerEvents="none">
      <View style={[styles.banner, { paddingHorizontal: 16 * s, paddingVertical: 10 * s, borderRadius: 10 * s, alignItems: 'center', gap: 2 * s }]}>
        <T dim size={12}>
          {total > 1 ? `Бой ${index + 1} из ${total}` : 'Бой'}
        </T>
        <T bold size={16} style={{ textAlign: 'center', color: COLORS.goldLight }}>
          {result ? outcome.text : title}
        </T>
        <T size={13} style={{ textAlign: 'center', color: result ? (outcome.good ? COLORS.ok : COLORS.danger) : COLORS.text }}>
          {result
            ? `Осталось: ${names(battle.attacker)} — ${battle.attackerLeft}, ${names(battle.defender)} — ${battle.defenderLeft}`
            : `${names(battle.attacker)} (${battle.attack}) ⚔ ${names(battle.defender)} (${battle.defense})`}
        </T>
      </View>
    </View>
  );
}

/** Пока армия идёт по карте, на месте назначения её ещё нет. */
function withoutWalker(units: UnitInfo[], walk: WalkInfo): UnitInfo[] {
  const to = walk.path[walk.path.length - 1];
  const key = walk.attack ? `a${walk.path[walk.path.length - 2]}>${to}` : `c${to}`;
  return units.flatMap((u) => (u.key !== key ? [u] : u.troops > walk.count ? [{ ...u, troops: u.troops - walk.count }] : []));
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
