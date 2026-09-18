import { StyleSheet, View } from 'react-native';

import { Card, GradientCard, LineChart, Money, Pill, ProgressBar, Row, StatTile, Text, type LineSeries } from '@/components/ui';
import type { FiNumbers, RetirementProjection } from '@/domain/retirement';
import { useMoney, usePercent } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

/** "On this path you reach $X by 2061." Always labelled as a projection. */
export function PathHero({ projection }: { projection: RetirementProjection }) {
  const money = useMoney();
  const end = projection.atRetirement;
  return (
    <GradientCard palette="projected" style={{ gap: spacing.md }}>
      <Row>
        <Pill label="Projected" tone="glass" size="sm" icon="trending-up" />
      </Row>
      <View style={{ gap: 4 }}>
        <Text variant="small" color={colors.onGradient} style={styles.onGradientMuted}>
          On this path you reach
        </Text>
        <Text variant="display" color={colors.onGradient} tabular>
          {money(end.nominal, { compact: true, whole: true })}
        </Text>
        <Text variant="h3" weight="medium" color={colors.onGradient}>
          {projection.years > 0 ? `by ${end.year}, at age ${end.age}` : `today, at age ${end.age}`}
        </Text>
      </View>
      <Text variant="small" color={colors.onGradient} style={styles.onGradientMuted}>
        {`About ${money(end.real, { compact: true, whole: true })} in today's dollars, or ${money(projection.income.real, { whole: true })} a year at a ${projection.assumptions.withdrawalRate}% withdrawal rate.`}
      </Text>
    </GradientCard>
  );
}

/** Balance over time. Everything is dashed, because everything is projected. */
export function ProjectionChart({ projection }: { projection: RetirementProjection }) {
  const money = useMoney();
  const points = projection.points;
  const last = points[points.length - 1];
  const lines: LineSeries[] = [
    { key: 'nominal', label: 'Projected balance', color: series[0], dashed: true, points: points.map((p) => ({ x: p.offset, y: p.nominal })) },
    { key: 'real', label: "In today's dollars", color: series[1], dashed: true, points: points.map((p) => ({ x: p.offset, y: p.real })) },
  ];
  const ticks = [0, Math.round(last.offset / 2), last.offset];

  return (
    <Card style={{ gap: spacing.md }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">
          Where could this land?
        </Text>
        <Pill label="Projected" tone="projected" size="sm" />
      </Row>
      <LineChart
        series={lines}
        height={200}
        includeZero
        formatY={(v) => money(v, { compact: true, whole: true })}
        formatX={(x) => String(projection.startYear + x)}
        xTicks={ticks}
        accessibilityLabel={`Projected balance from ${money(projection.startBalance)} today to ${money(last.nominal)} in ${last.year}, or ${money(last.real)} in today's dollars.`}
      />
      <Text variant="caption" color={colors.textTertiary}>
        {`Dashed lines are projections at ${projection.assumptions.returnRate}% a year, not recorded balances.`}
      </Text>
    </Card>
  );
}

/**
 * The 4% / 6% / 8% spread, so the middle line never reads as a promise. The
 * labels are short so they survive a 390px-wide phone without truncating; the
 * "if" that used to sit in each one is said once, above the row.
 */
export function ReturnBand({ projection }: { projection: RetirementProjection }) {
  const { band, atRetirement } = projection;
  const by = `by ${atRetirement.year}`;
  return (
    <View style={{ gap: spacing.sm }}>
      <Text variant="caption" color={colors.textTertiary}>
        {`Same contributions, three different returns — all by ${atRetirement.year}`}
      </Text>
      <View style={styles.tiles}>
        <StatTile label={`${band.lowRate}% a year`} icon="trending-down" value={<Money cents={band.low} variant="h3" compact whole />} caption={by} />
        <StatTile label={`${band.midRate}% a year`} icon="minus" value={<Money cents={band.mid} variant="h3" compact whole />} caption={`${by} · your assumption`} />
        <StatTile label={`${band.highRate}% a year`} icon="trending-up" value={<Money cents={band.high} variant="h3" compact whole />} caption={by} />
      </View>
    </View>
  );
}

/** Target, progress and the countdown at the current savings rate. */
export function FiProgress({ fi }: { fi: FiNumbers }) {
  const money = useMoney();
  const percent = usePercent();
  const ratio = Math.min(1, fi.progress);
  return (
    <Card style={{ gap: spacing.md }}>
      <Row>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="h3" accessibilityRole="header">
            {`${fi.multiple}× your spending`}
          </Text>
          <Text variant="small" color={colors.textSecondary}>
            {`${money(fi.annualSpending, { whole: true })} a year at a ${fi.withdrawalRate}% withdrawal rate`}
          </Text>
        </View>
        <Pill label="Projected" tone="projected" size="sm" />
      </Row>
      <View style={{ gap: 6 }}>
        <ProgressBar value={ratio} accessibilityLabel={`${percent(fi.progress)} of the target`} />
        <Row>
          <Text variant="small" weight="semibold" style={{ flex: 1 }}>
            {`${money(fi.current, { compact: true, whole: true })} invested`}
          </Text>
          <Text variant="small" color={colors.textSecondary}>
            {`${percent(fi.progress)} of ${money(fi.target, { compact: true, whole: true })}`}
          </Text>
        </Row>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  /** Secondary text on a gradient: the same token, one step back. */
  onGradientMuted: { opacity: 0.85 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
