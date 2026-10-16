import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { happinessTarget, type GameState, type PlanResult, type PlayerId } from '../../engine';
import { T } from '../components';
import { Icon, type IconName } from '../icons';
import { COLORS, FONTS, useLayout } from '../theme';

function Stat({ icon, value, sub, onPress, label }: { icon: IconName; value: string; sub?: string; onPress?: () => void; label: string }) {
  const { s } = useLayout();
  const body = (
    <View style={[styles.stat, { paddingHorizontal: 8 * s, paddingVertical: 4 * s, borderRadius: 8 * s, gap: 5 * s }]}>
      <Icon name={icon} size={18 * s} color={COLORS.goldLight} />
      <View>
        <T bold size={15} style={{ fontFamily: FONTS.bold }}>
          {value}
        </T>
        {sub ? (
          <T size={10} dim style={{ marginTop: -2 * s }}>
            {sub}
          </T>
        ) : null}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
      {body}
    </Pressable>
  ) : (
    <View accessibilityLabel={label}>{body}</View>
  );
}

/** Верхняя панель: цвет и имя игрока, золото, доход, ОД, налог, среднее счастье, номер хода. */
export function TopBar({
  game,
  player,
  plan,
  tax,
  onTax,
  onMenu,
}: {
  game: GameState;
  player: PlayerId;
  plan: PlanResult;
  tax: number;
  onTax: () => void;
  onMenu: () => void;
}) {
  const { s } = useLayout();
  const p = game.players[player];
  const own = game.cells.filter((c) => c.owner === player && c.pop > 0);
  const happy = own.length ? own.reduce((sum, c) => sum + c.happiness, 0) / own.length : 0;
  const net = plan.economy.income - plan.economy.upkeep;
  const limit = game.settings.turnLimit;
  return (
    <View style={[styles.bar, { padding: 4 * s, borderRadius: 14 * s, gap: 4 * s }]}>
      <View style={[styles.who, { paddingHorizontal: 8 * s, gap: 8 * s }]}>
        <View style={{ width: 22 * s, height: 22 * s, borderRadius: 11 * s, backgroundColor: p.color, borderWidth: 2, borderColor: COLORS.goldLight }} />
        <T bold size={16} numberOfLines={1} style={{ maxWidth: 150 * s, fontFamily: FONTS.title, color: COLORS.goldLight }}>
          {p.name}
        </T>
      </View>
      <Stat
        icon="gold"
        label="Золото"
        value={`${p.gold}`}
        sub={plan.goldLeft !== p.gold + net ? `доступно ${plan.goldLeft}` : `${net >= 0 ? '+' : ''}${net} за ход`}
      />
      <Stat icon="ap" label="Очки действия" value={`${plan.apLeft}/${plan.apTotal}`} sub="ОД" />
      <Stat icon="tax" label="Налог" value={`${tax}%`} sub="налог ›" onPress={onTax} />
      <Stat icon="happiness" label="Счастье" value={`${Math.round(happy)}%`} sub={`цель ${Math.round(happinessTarget(tax))}%`} />
      <Stat icon="turn" label="Ход" value={`${game.turn}`} sub={limit > 0 ? `из ${limit}` : 'ход'} />
      <Pressable accessibilityRole="button" accessibilityLabel="Меню" onPress={onMenu} style={[styles.menu, { width: 40 * s, height: 40 * s, borderRadius: 20 * s }]}>
        <Icon name="menu" size={22 * s} color={COLORS.goldLight} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: COLORS.panel,
    borderWidth: 2.5,
    borderColor: COLORS.gold,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  who: { flexDirection: 'row', alignItems: 'center' },
  stat: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.panelDeep },
  menu: { alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: COLORS.gold, backgroundColor: COLORS.panelLight },
});
