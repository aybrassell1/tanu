import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import type { HealthMetric, HealthStatus } from '@/domain/health';
import { colors, radius, spacing, status as statusColors } from '@/theme/tokens';

export const HEALTH_LABEL: Record<HealthStatus, { label: string; color: string }> = {
  strong: { label: 'Strong', color: statusColors.good },
  okay: { label: 'Okay', color: statusColors.warning },
  weak: { label: 'Needs work', color: statusColors.critical },
  na: { label: 'No data yet', color: colors.borderStrong },
};

export function MetricTile({ metric, compact }: { metric: HealthMetric; compact?: boolean }) {
  const router = useRouter();
  const s = HEALTH_LABEL[metric.status];
  return (
    <Card style={[styles.tile, compact && styles.compact]} padding={compact ? spacing.md : spacing.lg} onPress={() => router.push(metric.href)} accessibilityLabel={`${metric.label}: ${metric.display}, ${s.label}`}>
      <View style={styles.top}>
        <EmojiIcon name={metric.emoji} size={compact ? 24 : 30} />
        <View style={styles.status}>
          <View style={[styles.dot, { backgroundColor: s.color }]} />
          <Text variant="caption" color={colors.textSecondary}>
            {s.label}
          </Text>
        </View>
      </View>
      <Text variant={compact ? 'h3' : 'h2'} tabular numberOfLines={1}>
        {metric.display}
      </Text>
      <Text variant="small" color={colors.textSecondary} numberOfLines={1}>
        {metric.label}
      </Text>
      {metric.meter !== null && (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.round(metric.meter * 100)}%`, backgroundColor: s.color }]} />
        </View>
      )}
      {!compact && (
        <Text variant="caption" color={colors.textTertiary}>
          Guide: {metric.target}
        </Text>
      )}
    </Card>
  );
}

export function CheckupGrid({ metrics, compact }: { metrics: HealthMetric[]; compact?: boolean }) {
  return (
    <View style={styles.grid}>
      {metrics.map((m) => (
        <MetricTile key={m.key} metric={m} compact={compact} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', flexGrow: 1, gap: 4 },
  compact: { width: '31%' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, marginTop: 6, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
