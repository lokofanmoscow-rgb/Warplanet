import React from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Icon, type IconName } from './icons';
import { COLORS, FONTS, useLayout } from './theme';

// Тёмные панели с золотой рамкой, кнопки, переключатели.

export function T({ style, bold, dim, size, ...rest }: TextProps & { bold?: boolean; dim?: boolean; size?: number }) {
  const { s } = useLayout();
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: bold ? FONTS.bold : FONTS.text, color: dim ? COLORS.textDim : COLORS.text, fontSize: (size ?? 15) * s },
        style,
      ]}
    />
  );
}

export function Title({ style, size = 22, ...rest }: TextProps & { size?: number }) {
  const { s } = useLayout();
  return <Text {...rest} style={[{ fontFamily: FONTS.title, color: COLORS.goldLight, fontSize: size * s }, style]} />;
}

export function Panel({ style, children, tight }: { style?: StyleProp<ViewStyle>; children?: React.ReactNode; tight?: boolean }) {
  const { s } = useLayout();
  return (
    <View style={[styles.panelOuter, { borderRadius: 14 * s }, style]}>
      <View style={[styles.panelInner, { borderRadius: 11 * s, padding: (tight ? 8 : 14) * s }]}>{children}</View>
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  label,
  onPress,
  disabled,
  variant = 'secondary',
  icon,
  style,
  small,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  icon?: IconName;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
}) {
  const { s } = useLayout();
  const primary = variant === 'primary';
  const textColor = primary ? COLORS.panel : variant === 'danger' ? '#FFD9D2' : COLORS.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: (small ? 36 : 48) * s,
          paddingHorizontal: (small ? 12 : 18) * s,
          borderRadius: 10 * s,
          backgroundColor: primary ? COLORS.gold : variant === 'danger' ? '#5A231C' : COLORS.panelLight,
          borderColor: primary ? COLORS.goldLight : COLORS.gold,
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.97 : 1 }],
        },
        style,
      ]}
    >
      {icon && <Icon name={icon} size={(small ? 16 : 20) * s} color={textColor} />}
      <Text style={{ fontFamily: FONTS.bold, color: textColor, fontSize: (small ? 14 : 17) * s }} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Круглая кнопка в золотой оправе, как на настольной карте. */
export function RoundButton({
  icon,
  onPress,
  disabled,
  size = 56,
  active,
  label,
  badge,
}: {
  icon: IconName;
  onPress?: () => void;
  disabled?: boolean;
  size?: number;
  active?: boolean;
  label?: string;
  badge?: React.ReactNode;
}) {
  const { s } = useLayout();
  const d = size * s;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.round,
        {
          width: d,
          height: d,
          borderRadius: d / 2,
          borderWidth: Math.max(2, 3 * s),
          backgroundColor: active ? '#2E7FB3' : COLORS.panel,
          borderColor: active ? '#9ED8FF' : COLORS.gold,
          opacity: disabled ? 0.45 : 1,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Icon name={icon} size={d * 0.5} color={active ? '#FFFFFF' : COLORS.goldLight} />
      {badge}
    </Pressable>
  );
}

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  format,
  big,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  big?: number;
}) {
  const { s } = useLayout();
  const btn = (delta: number, label: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={delta < 0 ? value <= min : value >= max}
      onPress={() => onChange(Math.max(min, Math.min(max, value + delta)))}
      style={({ pressed }) => [
        styles.stepBtn,
        { width: 40 * s, height: 40 * s, borderRadius: 8 * s, opacity: (delta < 0 ? value <= min : value >= max) ? 0.35 : pressed ? 0.7 : 1 },
      ]}
    >
      <Text style={{ color: COLORS.goldLight, fontFamily: FONTS.bold, fontSize: (Math.abs(delta) > step ? 13 : 20) * s }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {big ? btn(-big, `−${big}`) : null}
      {btn(-step, '−')}
      <Text style={{ minWidth: 64 * s, textAlign: 'center', color: COLORS.text, fontFamily: FONTS.bold, fontSize: 18 * s }}>
        {format ? format(value) : value}
      </Text>
      {btn(step, '+')}
      {big ? btn(big, `+${big}`) : null}
    </View>
  );
}

export function Segmented<V extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { value: V; label: string }[];
  value: V;
  onChange: (v: V) => void;
}) {
  const { s } = useLayout();
  return (
    <View style={[styles.row, { flexWrap: 'wrap', gap: 6 * s }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={String(o.value)}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[
              styles.seg,
              {
                paddingHorizontal: 12 * s,
                paddingVertical: 8 * s,
                borderRadius: 8 * s,
                backgroundColor: on ? COLORS.gold : COLORS.panelDeep,
                borderColor: on ? COLORS.goldLight : COLORS.goldDark,
              },
            ]}
          >
            <Text style={{ color: on ? COLORS.panel : COLORS.text, fontFamily: FONTS.bold, fontSize: 14 * s }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Row({ children, style, gap = 8 }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; gap?: number }) {
  const { s } = useLayout();
  return <View style={[styles.row, { gap: gap * s }, style]}>{children}</View>;
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const { s } = useLayout();
  return (
    <View style={{ marginBottom: 14 * s, gap: 6 * s }}>
      <T bold size={14} style={{ color: COLORS.goldLight }}>
        {label}
      </T>
      {children}
      {hint ? (
        <T dim size={12}>
          {hint}
        </T>
      ) : null}
    </View>
  );
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Swatch({ color, size = 14 }: { color: string; size?: number }) {
  const { s } = useLayout();
  return (
    <View
      style={{
        width: size * s,
        height: size * s,
        borderRadius: (size * s) / 2,
        backgroundColor: color,
        borderWidth: 1.5,
        borderColor: COLORS.text,
      }}
    />
  );
}

export const textStyles = StyleSheet.create({
  center: { textAlign: 'center' } as TextStyle,
});

const styles = StyleSheet.create({
  panelOuter: {
    flexShrink: 1,
    backgroundColor: COLORS.gold,
    padding: 2.5,
    shadowColor: '#000',
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 8,
  },
  panelInner: {
    flexShrink: 1,
    overflow: 'hidden',
    backgroundColor: COLORS.panel,
    borderWidth: 1,
    borderColor: COLORS.goldDark,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
  },
  round: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  stepBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.panelDeep,
    borderWidth: 1.5,
    borderColor: COLORS.goldDark,
    marginHorizontal: 3,
  },
  row: { flexDirection: 'row', alignItems: 'center' },
  seg: { borderWidth: 1.5 },
  divider: { height: 1, backgroundColor: COLORS.goldDark, opacity: 0.6, marginVertical: 10 },
});
