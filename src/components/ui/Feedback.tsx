import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { IconName } from '@/data/icons';
import { colors, radius, spacing } from '@/theme/tokens';
import { Button } from './Button';
import { Card } from './Card';
import { PILL_TONES, type PillTone } from './Pill';
import { Text } from './Text';

type EmptyStateProps = {
  icon: IconName;
  title: string;
  message?: string;
  actionLabel?: string;
  /** Defaults to a plus; set it when the action is not "add something". */
  actionIcon?: IconName;
  onAction?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  compact?: boolean;
};

export function EmptyState({ icon, title, message, actionLabel, actionIcon = 'plus', onAction, secondaryLabel, onSecondary, compact }: EmptyStateProps) {
  return (
    <Card variant="muted" padding={compact ? spacing.lg : spacing.xxl} style={styles.empty}>
      <View style={styles.emptyIcon}>
        <Feather name={icon} size={22} color={colors.primary} />
      </View>
      <View style={{ gap: 4, alignItems: 'center' }}>
        <Text variant="h3" align="center">
          {title}
        </Text>
        {!!message && (
          <Text variant="small" color={colors.textSecondary} align="center">
            {message}
          </Text>
        )}
      </View>
      {(actionLabel || secondaryLabel) && (
        <View style={styles.emptyActions}>
          {actionLabel && <Button label={actionLabel} onPress={onAction} icon={actionIcon} />}
          {secondaryLabel && <Button label={secondaryLabel} onPress={onSecondary} variant="secondary" />}
        </View>
      )}
    </Card>
  );
}

type BannerProps = {
  tone?: Extract<PillTone, 'primary' | 'positive' | 'negative' | 'warning' | 'projected' | 'muted'>;
  icon?: IconName;
  title: string;
  message?: string;
  action?: ReactNode;
};

/** Inline notice; tone always comes with an icon so meaning never rests on color. */
export function Banner({ tone = 'primary', icon = 'info', title, message, action }: BannerProps) {
  const t = PILL_TONES[tone];
  return (
    <View style={[styles.banner, { backgroundColor: t.bg }]} accessibilityRole="summary">
      <Feather name={icon} size={18} color={t.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" weight="semibold" color={tone === 'muted' ? colors.ink : t.fg}>
          {title}
        </Text>
        {!!message && (
          <Text variant="small" color={colors.textSecondary}>
            {message}
          </Text>
        )}
        {action && <View style={{ marginTop: spacing.sm, flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' }}>{action}</View>}
      </View>
    </View>
  );
}

type StatTileProps = {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  icon?: IconName;
  onPress?: () => void;
  tone?: 'default' | 'muted';
};

/** Compact number with a label, for grids of headline figures. */
export function StatTile({ label, value, caption, icon, onPress, tone = 'default' }: StatTileProps) {
  return (
    <Card variant={tone === 'muted' ? 'muted' : 'outlined'} onPress={onPress} style={{ flex: 1, gap: 6, minWidth: 96 }} padding={spacing.md} accessibilityLabel={label}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {icon && <Feather name={icon} size={13} color={colors.textTertiary} />}
        <Text variant="small" color={colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
          {label}
        </Text>
      </View>
      {typeof value === 'string' ? <Text variant="h2">{value}</Text> : value}
      {typeof caption === 'string' ? (
        <Text variant="caption" color={colors.textTertiary} numberOfLines={2}>
          {caption}
        </Text>
      ) : (
        caption
      )}
    </Card>
  );
}

const STATUS_ICON = { positive: 'check-circle', warning: 'alert-circle', negative: 'alert-triangle', muted: 'minus-circle', primary: 'info', projected: 'trending-up' } as const;

/** Status label with icon; e.g. On track / Approaching / Over budget. */
export function StatusBadge({ tone, label }: { tone: keyof typeof STATUS_ICON; label: string }) {
  const t = PILL_TONES[tone];
  return (
    <View style={[styles.status, { backgroundColor: t.bg }]}>
      <Feather name={STATUS_ICON[tone]} size={11} color={t.fg} />
      <Text variant="caption" weight="semibold" color={t.fg}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', gap: spacing.md },
  emptyIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  emptyActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap', justifyContent: 'center' },
  banner: { flexDirection: 'row', gap: spacing.md, padding: spacing.md, borderRadius: radius.md },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
});
