import Feather from '@expo/vector-icons/Feather';
import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import type { IconName } from '@/data/icons';
import { colors, spacing } from '@/theme/tokens';
import { Card } from './Card';
import { Text } from './Text';

type IconTileProps = { icon: IconName; color?: string; size?: number; tint?: string };

/** Icon inside a softly tinted rounded square. */
export function IconTile({ icon, color = colors.primary, size = 40, tint }: IconTileProps) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: size * 0.3, backgroundColor: tint ?? `${color}1A` }]}>
      <Feather name={icon} size={Math.round(size * 0.44)} color={color} />
    </View>
  );
}

type ListRowProps = {
  title: string;
  subtitle?: string;
  icon?: IconName;
  iconColor?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  /** Secondary line under the trailing value. */
  trailingCaption?: string;
  chevron?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  dense?: boolean;
  accessibilityLabel?: string;
};

/** Icon tile + two lines + trailing slot, as in the template's "My assignments" list. */
export function ListRow({ title, subtitle, icon, iconColor, leading, trailing, trailingCaption, chevron, onPress, onLongPress, dense, accessibilityLabel }: ListRowProps) {
  return (
    <Pressable
      disabled={!onPress && !onLongPress}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.row, dense && styles.dense, pressed && { opacity: 0.6 }]}
    >
      {leading ?? (icon && <IconTile icon={icon} color={iconColor} size={dense ? 34 : 40} />)}
      <View style={styles.body}>
        <Text variant="body" weight="medium" numberOfLines={1}>
          {title}
        </Text>
        {!!subtitle && (
          <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
            {subtitle}
          </Text>
        )}
      </View>
      {(trailing || trailingCaption) && (
        <View style={styles.trailing}>
          {typeof trailing === 'string' ? <Text weight="semibold">{trailing}</Text> : trailing}
          {!!trailingCaption && (
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {trailingCaption}
            </Text>
          )}
        </View>
      )}
      {chevron && <Feather name="chevron-right" size={18} color={colors.textTertiary} />}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

/** A card whose children are separated by hairline dividers. */
export function ListCard({ children, style, inset }: { children: ReactNode; style?: StyleProp<ViewStyle>; inset?: number }) {
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <Card padding={spacing.lg} style={[{ paddingVertical: 2 }, style]}>
      {items.map((child, i) => (
        <Fragment key={child.key ?? i}>
          {i > 0 && <Divider inset={inset} />}
          {child}
        </Fragment>
      ))}
    </Card>
  );
}

/** Label on the left, value on the right. */
export function KeyValue({ label, value, children, hint }: { label: string; value?: string; children?: ReactNode; hint?: string }) {
  return (
    <View style={styles.kv}>
      <View style={{ flex: 1 }}>
        <Text color={colors.textSecondary}>{label}</Text>
        {!!hint && (
          <Text variant="caption" color={colors.textTertiary}>
            {hint}
          </Text>
        )}
      </View>
      {children ?? (
        <Text weight="medium" align="right" style={{ flexShrink: 1 }}>
          {value}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  dense: { paddingVertical: 9 },
  tile: { alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, gap: 2 },
  trailing: { alignItems: 'flex-end', gap: 2 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  kv: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md, paddingVertical: 13 },
});

