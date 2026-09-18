import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, ProgressBar, StatusBadge, Text, VisualTile } from '@/components/ui';
import { GOAL_EMOJI, GOAL_KIND_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { GOAL_KINDS } from '@/domain/catalog';
import { diffDays, formatDate, formatMonth, monthOf } from '@/domain/dates';
import type { GoalProgress } from '@/domain/goals';
import type { ISODate } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export const GOAL_STATUS = {
  complete: { tone: 'positive', label: 'Complete' },
  on_track: { tone: 'positive', label: 'On track' },
  behind: { tone: 'warning', label: 'Behind' },
  no_date: { tone: 'primary', label: 'No target date' },
  stalled: { tone: 'muted', label: 'No recent progress' },
} as const;

export function goalStatusOf(p: GoalProgress) {
  return p.goal.completedAt ? GOAL_STATUS.complete : GOAL_STATUS[p.status];
}

export function GoalStatusBadge({ progress }: { progress: GoalProgress }) {
  const s = goalStatusOf(progress);
  return <StatusBadge tone={s.tone} label={s.label} />;
}

type MoneyFn = ReturnType<typeof useMoney>;

/** One-line projection or requirement. Projections are always prefixed "Est.". */
export function goalProjectionLine(p: GoalProgress, money: MoneyFn, today: ISODate): string {
  const { goal } = p;
  if (goal.completedAt) return `Completed ${formatDate(goal.completedAt, 'short', today)}`;
  if (p.status === 'complete') return 'Target reached';
  if (p.status === 'stalled') {
    const stalledLabel = diffDays(goal.startDate, today) < 90 ? 'No progress yet' : 'No progress in the last 3 months';
    return goal.targetDate && p.requiredMonthly ? `${stalledLabel} · needs ${money(p.requiredMonthly, { whole: true })}/mo to finish by ${formatDate(goal.targetDate, 'short', today)}` : stalledLabel;
  }
  if (p.status === 'behind' && goal.targetDate && p.requiredMonthly) {
    return `Needs ${money(p.requiredMonthly, { whole: true })}/mo to finish by ${formatDate(goal.targetDate, 'short', today)}`;
  }
  if (p.projectedDate && p.monthlyRate > 0) {
    return `Est. ${formatMonth(monthOf(p.projectedDate))} at ${money(p.monthlyRate, { whole: true })}/mo`;
  }
  if (goal.targetDate && p.requiredMonthly) return `Needs ${money(p.requiredMonthly, { whole: true })}/mo to finish by ${formatDate(goal.targetDate, 'short', today)}`;
  return '';
}

export function GoalCard({ progress, today }: { progress: GoalProgress; today: ISODate }) {
  const router = useRouter();
  const money = useMoney();
  const p = progress;
  const g = p.goal;
  const pct = Math.round(p.ratio * 100);
  const line = goalProjectionLine(p, money, today);
  return (
    <Card onPress={() => router.push(`/goals/${g.id}`)} accessibilityLabel={`${g.name}, ${pct}% complete`} style={{ gap: spacing.md }}>
      <View style={styles.top}>
        <VisualTile emoji={g.template !== 'custom' ? GOAL_EMOJI[g.template] : GOAL_KIND_EMOJI[g.kind]} tint={`${g.color}1A`} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" numberOfLines={1}>
            {g.name}
          </Text>
          <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
            {GOAL_KINDS[g.kind].label}
          </Text>
        </View>
        <GoalStatusBadge progress={p} />
      </View>
      <ProgressBar value={p.ratio} color={g.color} accessibilityLabel={`${pct}% of target`} />
      <View style={{ gap: 2 }}>
        <Text variant="small" weight="medium" tabular>
          {`${money(p.current, { whole: true })} of ${money(p.target, { whole: true })} · ${pct}%`}
        </Text>
        {g.kind === 'debt_payoff' && p.owed !== undefined && (
          <Text variant="small" color={colors.textSecondary} tabular>
            {`${money(p.owed, { whole: true })} left to pay`}
          </Text>
        )}
        {!!line && (
          <Text variant="caption" color={colors.textTertiary}>
            {line}
          </Text>
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
