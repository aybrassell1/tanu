import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Money, Segmented, SplitBar, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { formatDate } from '@/domain/dates';
import { formatPercent } from '@/domain/money';
import type { ContributionLimit, QuarterPlan, TaxEstimate, TaxLine } from '@/domain/taxes';
import { taxYears } from '@/domain/taxes';
import { useDerived, useMoney, useToday } from '@/store/hooks';
import { colors, radius, series, spacing, status as statusColors } from '@/theme/tokens';

/** Tax year from the `year` route param, defaulting to the current year. */
export function useTaxYear() {
  const today = useToday();
  const { year } = useLocalSearchParams<{ year?: string }>();
  const years = useDerived(taxYears);
  const parsed = Number(year);
  return { year: years.includes(parsed) ? parsed : Number(today.slice(0, 4)), years, today };
}

export function YearSwitch({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  if (years.length < 2) return null;
  const items = years.slice(0, 3).map((y) => ({ value: String(y), label: String(y) }));
  return (
    <View style={{ width: 56 * items.length }}>
      <Segmented items={items} value={String(year)} onChange={(v) => router.setParams({ year: v })} size="sm" />
    </View>
  );
}

/** Big refund/owe number. */
export function ResultHero({ estimate, compact }: { estimate: TaxEstimate; compact?: boolean }) {
  const money = useMoney();
  const refund = estimate.refund >= 0;
  return (
    <View style={styles.hero}>
      <EmojiIcon name={refund ? 'money-with-wings' : 'receipt'} size={compact ? 40 : 52} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="small" color={colors.textSecondary}>
          {refund ? 'Estimated refund' : 'Estimated to owe'}
        </Text>
        <Money cents={Math.abs(estimate.refund)} variant={compact ? 'h2' : 'h1'} whole color={refund ? colors.positive : colors.negative} />
        <Text variant="caption" color={colors.textTertiary}>
          {money(estimate.totalTax, { whole: true })} tax · {formatPercent(estimate.effectiveRate, 1)} effective · {formatPercent(estimate.marginalRate)} bracket
        </Text>
      </View>
    </View>
  );
}

/** Where gross income goes: taxes, pre-tax savings and what you keep. */
export function IncomeSplit({ estimate }: { estimate: TaxEstimate }) {
  const money = useMoney();
  const gross = estimate.totalIncome + estimate.preTaxSavings;
  if (gross <= 0) return null;
  const federal = estimate.totalTax;
  const state = estimate.state?.tax ?? 0;
  const parts = [
    { key: 'federal', label: 'Federal tax', value: federal, color: series[0] },
    { key: 'fica', label: 'Social Security & Medicare', value: estimate.fica, color: series[1] },
    { key: 'state', label: 'State tax', value: state, color: series[3] },
    { key: 'saved', label: 'Pre-tax savings', value: estimate.preTaxSavings, color: series[2] },
  ].filter((p) => p.value > 0);
  const kept = Math.max(0, gross - parts.reduce((s, p) => s + p.value, 0));
  const all = [...parts, { key: 'kept', label: 'Yours to keep', value: kept, color: colors.textTertiary }];
  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.between}>
        <Text variant="small" color={colors.textSecondary}>
          Where {money(gross, { whole: true })} of income goes
        </Text>
      </View>
      <SplitBar segments={all} height={14} />
      <View style={styles.legend}>
        {all.map((p) => (
          <View key={p.key} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: p.color }]} />
            <Text variant="caption" color={colors.textSecondary}>
              {p.label}
            </Text>
            <Text variant="caption" weight="semibold" tabular>
              {money(p.value, { whole: true })}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const QUARTER_STYLE: Record<QuarterPlan['status'], { label: string; color: string; emoji: string }> = {
  paid: { label: 'Paid', color: statusColors.good, emoji: 'check-mark-button' },
  due_soon: { label: 'Due soon', color: statusColors.warning, emoji: 'hourglass-not-done' },
  // A border colour is invisible as a mark on either surface, so the two
  // "nothing to do" states use the muted text step instead.
  upcoming: { label: 'Upcoming', color: colors.textTertiary, emoji: 'spiral-calendar' },
  missed: { label: 'Missed', color: statusColors.critical, emoji: 'warning' },
  not_needed: { label: 'Not needed', color: colors.textTertiary, emoji: 'check-mark-button' },
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function QuarterStrip({ quarters, today }: { quarters: QuarterPlan[]; today: string }) {
  const money = useMoney();
  return (
    <View style={styles.quarters}>
      {quarters.map((q) => {
        const s = QUARTER_STYLE[q.status];
        return (
          <View key={q.quarter} style={styles.quarter} accessible accessibilityLabel={`Quarter ${q.quarter}, due ${formatDate(q.due, 'medium', today)}, ${s.label}`}>
            <View style={[styles.quarterBar, { backgroundColor: s.color }]} />
            <Text variant="caption" weight="semibold">
              Q{q.quarter} · {MONTHS[Number(q.due.slice(5, 7)) - 1]} {Number(q.due.slice(8))}
            </Text>
            <Text variant="small" weight="semibold" tabular numberOfLines={1}>
              {q.paid > 0 ? money(q.paid, { whole: true }) : q.suggested > 0 ? money(q.suggested, { whole: true }) : '—'}
            </Text>
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {q.paid > 0 && q.status === 'paid' ? 'Paid' : q.suggested > 0 ? (q.status === 'missed' ? 'Missed' : 'Suggested') : s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export function LimitBars({ limits }: { limits: ContributionLimit[] }) {
  const money = useMoney();
  const shown = limits.filter((l) => l.applicable);
  if (shown.length === 0) return null;
  return (
    <Card style={{ gap: spacing.lg }}>
      {shown.map((l, i) => {
        const share = l.limit > 0 ? Math.min(1, l.contributed / l.limit) : 0;
        return (
          <View key={l.key} style={{ gap: 6 }}>
            <View style={styles.between}>
              <Text variant="small" weight="medium">
                {l.label}
              </Text>
              <Text variant="caption" color={colors.textSecondary} tabular>
                {money(l.contributed, { whole: true })} / {money(l.limit, { whole: true })}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.round(share * 100)}%`, backgroundColor: series[i] }]} />
            </View>
            <Text variant="caption" color={colors.textTertiary}>
              {l.contributed >= l.limit ? 'Limit reached' : `${money(l.limit - l.contributed, { whole: true })} of room left`}
            </Text>
          </View>
        );
      })}
    </Card>
  );
}

/** Worksheet section: rows of labelled amounts and an optional total. */
export function LinesCard({ lines, total, totalLabel, negative }: { lines: TaxLine[]; total?: number; totalLabel?: string; negative?: boolean }) {
  return (
    <Card padding={spacing.lg} style={{ gap: 2 }}>
      {lines.length === 0 && (
        <Text variant="small" color={colors.textTertiary}>
          None
        </Text>
      )}
      {lines.map((l) => (
        <View key={l.key} style={styles.line}>
          <View style={{ flex: 1 }}>
            <Text variant="small">{l.label}</Text>
            {l.note && (
              <Text variant="caption" color={colors.textTertiary}>
                {l.note}
              </Text>
            )}
          </View>
          <Money cents={negative ? -l.amount : l.amount} variant="small" whole />
        </View>
      ))}
      {total !== undefined && (
        <View style={[styles.line, styles.totalLine]}>
          <Text variant="small" weight="semibold" style={{ flex: 1 }}>
            {totalLabel}
          </Text>
          <Money cents={total} variant="small" weight="semibold" whole />
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: 6 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  quarters: { flexDirection: 'row', gap: spacing.sm },
  quarter: { flex: 1, gap: 2, minWidth: 0 },
  quarterBar: { height: 6, borderRadius: radius.pill, marginBottom: 4 },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  line: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 7 },
  totalLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, marginTop: 4, paddingTop: 10 },
});
