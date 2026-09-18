import Feather from '@expo/vector-icons/Feather';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Card, Money, SplitBar, StatTile, StatusBadge, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import type { AffordabilityCheck, AffordabilityResult, FinancialSnapshot, Verdict } from '@/domain/affordability';
import { formatPercent } from '@/domain/money';
import { useMoney } from '@/store/hooks';
import { colors, radius, series, spacing, status } from '@/theme/tokens';

export const VERDICT: Record<Verdict, { label: string; emoji: string; tone: 'positive' | 'primary' | 'warning' | 'negative'; color: string }> = {
  comfortable: { label: 'Comfortable', emoji: 'check-mark-button', tone: 'positive', color: colors.positive },
  manageable: { label: 'Manageable', emoji: 'thinking-face', tone: 'primary', color: colors.primary },
  stretch: { label: 'A stretch', emoji: 'warning', tone: 'warning', color: colors.warning },
  not_affordable: { label: 'Not yet', emoji: 'hourglass-not-done', tone: 'negative', color: colors.negative },
};

const CHECK_TONE = { good: 'positive', stretch: 'warning', over: 'negative' } as const;
const CHECK_ICON = { good: 'check-circle', stretch: 'alert-circle', over: 'x-circle' } as const;

/** Verdict hero: one glance answer, one line of numbers. */
export function VerdictCard({ result, title }: { result: AffordabilityResult; title: string }) {
  const money = useMoney();
  const v = VERDICT[result.verdict];
  return (
    <Card style={styles.verdict} padding={spacing.xl}>
      <EmojiIcon name={v.emoji} size={44} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" color={colors.textSecondary}>
          {title}
        </Text>
        <Text variant="h2" color={v.color}>
          {v.label}
        </Text>
        <Text variant="small" color={colors.textSecondary} tabular>
          {money(result.monthlyCost, { whole: true })}/mo · {result.newSurplus >= 0 ? `${money(result.newSurplus, { whole: true })} left over` : `${money(-result.newSurplus, { whole: true })} short`}
        </Text>
      </View>
    </Card>
  );
}

/** Where each month's take-home would go afterwards. */
export function BudgetBar({ result, snapshot }: { result: AffordabilityResult; snapshot: FinancialSnapshot }) {
  const money = useMoney();
  const short = result.newSurplus < 0;
  const segments = [
    // The comparison grey is a chart-furniture step; as the biggest segment of
    // this bar it needs to be a mark you can actually see on either surface.
    { key: 'spending', label: 'Everyday spending', value: result.budget.spending, color: colors.textTertiary },
    { key: 'debts', label: 'Debt payments', value: result.budget.debts, color: series[1] },
    { key: 'new', label: 'This purchase', value: result.budget.newCost, color: series[0] },
    { key: 'left', label: 'Left over', value: result.budget.leftover, color: status.good },
  ];
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.rowBetween}>
        <Text weight="semibold">Your monthly take-home</Text>
        <Money cents={snapshot.takeHome} weight="semibold" whole />
      </View>
      <SplitBar segments={segments.map((s) => ({ key: s.key, value: s.value, color: s.color }))} height={16} />
      <View style={styles.legend}>
        {segments.map((s) => (
          <View key={s.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: s.color }]} />
            <Text variant="caption" color={colors.textSecondary}>
              {s.label}
            </Text>
            <Text variant="caption" weight="semibold" tabular>
              {money(s.value, { whole: true })}
            </Text>
          </View>
        ))}
      </View>
      {short && (
        <View style={styles.inline}>
          <Feather name="alert-triangle" size={14} color={colors.negative} />
          <Text variant="small" color={colors.negative}>
            {money(-result.newSurplus, { whole: true })} more than you bring home each month
          </Text>
        </View>
      )}
    </Card>
  );
}

function formatCheck(c: AffordabilityCheck) {
  if (c.unit === 'months') return Number.isFinite(c.value) ? `${c.value.toFixed(c.value < 10 ? 1 : 0)} mo` : '—';
  return Number.isFinite(c.value) ? formatPercent(c.value) : '—';
}

/** Rule-of-thumb checks as compact status rows. */
export function ChecksCard({ checks }: { checks: AffordabilityCheck[] }) {
  return (
    <Card padding={spacing.lg} style={{ paddingVertical: 4 }}>
      {checks.map((c, i) => (
        <View key={c.key} style={[styles.check, i > 0 && styles.divider]}>
          <Feather name={CHECK_ICON[c.status]} size={18} color={c.status === 'good' ? colors.positive : c.status === 'stretch' ? colors.warning : colors.negative} />
          <View style={{ flex: 1 }}>
            <Text weight="medium">{c.label}</Text>
            <Text variant="caption" color={colors.textTertiary}>
              Guide: {c.target}
            </Text>
          </View>
          <StatusBadge tone={CHECK_TONE[c.status]} label={formatCheck(c)} />
        </View>
      ))}
    </Card>
  );
}

export function CashTiles({ result }: { result: AffordabilityResult }) {
  return (
    <View style={styles.tiles}>
      <StatTile label="Cash needed now" icon="dollar-sign" value={<Money cents={result.upfront} variant="h3" whole />} />
      <StatTile
        label="Savings after"
        icon="shield"
        value={<Money cents={result.savingsAfter} variant="h3" whole tone="balance" />}
        caption={Number.isFinite(result.emergencyMonthsAfter) ? `${result.emergencyMonthsAfter.toFixed(1)} months of essentials` : undefined}
      />
    </View>
  );
}

/** Collapsible "numbers this is based on", keeps the main view uncluttered. */
export function SnapshotCard({ snapshot, extra }: { snapshot: FinancialSnapshot; extra?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const money = useMoney();
  const rows: [string, string][] = [
    ['Take-home / month', money(snapshot.takeHome, { whole: true })],
    [`Gross / month${snapshot.grossEstimated ? ' (estimated)' : ''}`, money(snapshot.gross, { whole: true })],
    ['Average spending (3 mo)', money(snapshot.spending, { whole: true })],
    ['Debt payments', money(snapshot.debtPayments, { whole: true })],
    ['Left over today', money(snapshot.surplus, { whole: true })],
    ['Cash & savings', money(snapshot.liquidSavings, { whole: true })],
  ];
  return (
    <Card variant="muted" padding={spacing.md}>
      <Pressable onPress={() => setOpen(!open)} style={styles.rowBetween} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <View style={styles.inline}>
          <Feather name="database" size={14} color={colors.textSecondary} />
          <Text variant="small" weight="medium" color={colors.textSecondary}>
            Based on your numbers
          </Text>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
      </Pressable>
      {open && (
        <View style={{ marginTop: spacing.sm, gap: 6 }}>
          {rows.map(([label, value]) => (
            <View key={label} style={styles.rowBetween}>
              <Text variant="small" color={colors.textSecondary}>
                {label}
              </Text>
              <Text variant="small" weight="medium" tabular>
                {value}
              </Text>
            </View>
          ))}
          {extra}
          <Text variant="caption" color={colors.textTertiary}>
            Rules of thumb for exploring options, not financial advice.
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  verdict: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  legend: { gap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  radius: { borderRadius: radius.md },
});
