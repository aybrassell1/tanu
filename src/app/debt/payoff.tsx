import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Card,
  ChipSelect,
  EmptyState,
  IconButton,
  LineChart,
  ListCard,
  Money,
  MoneyField,
  NavHeader,
  NumberField,
  Pill,
  Row,
  Screen,
  Section,
  Stack,
  StatTile,
  SwitchRow,
  Text,
} from '@/components/ui';
import { addMonthsToMonth, formatMonth, monthOf } from '@/domain/dates';
import { effectiveApr, payoffDebtsFrom, simulatePayoff, type PayoffOrder, type PayoffResult } from '@/domain/debt';
import type { Cents, ID, ISOMonth } from '@/domain/types';
import { useDerived, useMoney, useToday } from '@/store/hooks';
import { colors, radius, series as seriesColors, spacing } from '@/theme/tokens';

const ORDER_ITEMS: { value: PayoffOrder; label: string }[] = [
  { value: 'listed', label: 'Your order' },
  { value: 'highest_apr', label: 'Highest APR first' },
  { value: 'lowest_balance', label: 'Lowest balance first' },
];

const ORDER_HINT: Record<PayoffOrder, string> = {
  listed: 'Extra goes to your debts in the order you set below.',
  highest_apr: 'Extra goes to the debt with the highest interest rate first.',
  lowest_balance: 'Extra goes to the debt with the smallest balance first.',
};

const MAX_MONTHS = 600;

export default function PayoffPlannerScreen() {
  const router = useRouter();
  const money = useMoney();
  const today = useToday();
  const debts = useDerived((data, day) => payoffDebtsFrom(data, day));
  const startMonth = addMonthsToMonth(monthOf(today), 1);
  const thisYear = today.slice(0, 4);

  const [extra, setExtra] = useState<Cents | undefined>();
  const [order, setOrder] = useState<PayoffOrder>('listed');
  const [listed, setListed] = useState<ID[]>([]);
  const [showPerDebt, setShowPerDebt] = useState(false);
  const [perDebt, setPerDebt] = useState<Record<ID, Cents | undefined>>({});
  const [lumpAmount, setLumpAmount] = useState<Cents | undefined>();
  const [lumpMonth, setLumpMonth] = useState<number | undefined>(1);
  const [rollover, setRollover] = useState(true);

  // Keep the user's order, dropping paid-off debts and appending new ones.
  const effectiveOrder = useMemo(() => {
    const ids = debts.map((d) => d.id);
    return [...listed.filter((id) => ids.includes(id)), ...ids.filter((id) => !listed.includes(id))];
  }, [debts, listed]);

  const lumpError = lumpAmount && (lumpMonth === undefined || lumpMonth < 1 || lumpMonth > MAX_MONTHS) ? `Choose a month from 1 to ${MAX_MONTHS}.` : undefined;

  const { plan, minimums } = useMemo(() => {
    const perDebtExtra: Record<ID, Cents> = {};
    for (const [id, v] of Object.entries(perDebt)) if (v && v > 0) perDebtExtra[id] = v;
    const planResult = simulatePayoff(debts, {
      startMonth,
      extraMonthly: extra ?? 0,
      order,
      listedOrder: effectiveOrder,
      perDebtExtra,
      lumpSum: lumpAmount && lumpMonth && !lumpError ? { amount: lumpAmount, month: lumpMonth - 1 } : undefined,
      rollover,
    });
    const minResult = simulatePayoff(debts, { startMonth, extraMonthly: 0, order: 'listed', rollover: false });
    return { plan: planResult, minimums: minResult };
  }, [debts, startMonth, extra, order, effectiveOrder, perDebt, lumpAmount, lumpMonth, lumpError, rollover]);

  const header = <NavHeader title="Payoff planner" />;

  if (debts.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="check-circle"
          title="No debts with a balance"
          message="Add a credit card or loan with a balance to model payoff scenarios."
          actionLabel="Add a credit card or loan"
          onAction={() => router.push({ pathname: '/accounts/edit', params: { type: 'credit_card' } })}
        />
      </Screen>
    );
  }

  const move = (index: number, delta: number) => {
    const next = effectiveOrder.slice();
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setListed(next);
  };

  const monthLabel = (m: ISOMonth) => (m.slice(0, 4) === thisYear ? formatMonth(m, 'short') : `${formatMonth(m, 'short')} ’${m.slice(2, 4)}`);
  const debtFreeLabel = (r: PayoffResult) => (r.debtFreeMonth ? formatMonth(r.debtFreeMonth) : r.stuck ? 'Not at these payments' : 'Not within 50 years');
  const monthsLabel = (r: PayoffResult) => (r.months === null ? '—' : `${r.months}`);
  const bothFinish = plan.months !== null && minimums.months !== null;
  const interestSaved = minimums.totalInterest - plan.totalInterest;
  const monthsSooner = bothFinish ? minimums.months! - plan.months! : null;
  const byId = new Map(debts.map((d) => [d.id, d]));
  const planById = new Map(plan.perDebt.map((d) => [d.id, d]));
  const minById = new Map(minimums.perDebt.map((d) => [d.id, d]));
  const payoffLabel = (m: ISOMonth | null | undefined) => (m ? monthLabel(m) : '—');

  const toSeries = (r: PayoffResult) => r.series.map((p, i) => ({ x: i, y: p.total }));
  const lastIndex = Math.max(plan.series.length, minimums.series.length) - 1;
  const monthAt = (i: number) => addMonthsToMonth(startMonth, i - 1);

  return (
    <Screen header={header}>
      <Banner tone="projected" icon="sliders" title="This is a model, not advice." message="Try different approaches and compare them. Results assume today's balances and APRs and no new charges." />

      <Section title="Your inputs">
        <Stack gap={spacing.lg}>
          <MoneyField label="Extra each month" value={extra} onChange={setExtra} optional hint="On top of every debt's required payment." />

          <ChipSelect label="Where extra money goes" options={ORDER_ITEMS} value={order} onChange={setOrder} hint={ORDER_HINT[order]} />

          {order === 'listed' && (
            <ListCard>
              {effectiveOrder.map((id, i) => {
                const d = byId.get(id)!;
                return (
                  <View key={id} style={styles.orderRow}>
                    <View style={styles.rank}>
                      <Text variant="caption" weight="semibold">
                        {i + 1}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text weight="medium" numberOfLines={1}>
                        {d.name}
                      </Text>
                      <Text variant="caption" color={colors.textTertiary} tabular>
                        {`${money(d.balance, { whole: true })} · ${Number(effectiveApr(d, today).toFixed(2))}% APR`}
                      </Text>
                    </View>
                    <IconButton icon="arrow-up" size={32} accessibilityLabel={`Move ${d.name} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                    <IconButton icon="arrow-down" size={32} accessibilityLabel={`Move ${d.name} down`} disabled={i === effectiveOrder.length - 1} onPress={() => move(i, 1)} />
                  </View>
                );
              })}
            </ListCard>
          )}

          <View style={styles.group}>
            <Pressable onPress={() => setShowPerDebt(!showPerDebt)} accessibilityRole="button" accessibilityState={{ expanded: showPerDebt }} style={styles.expander}>
              <View style={{ flex: 1 }}>
                <Text weight="medium">Extra for a specific debt</Text>
                <Text variant="small" color={colors.textTertiary}>
                  Added to that debt every month
                </Text>
              </View>
              <Feather name={showPerDebt ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
            </Pressable>
            {showPerDebt && (
              <Stack gap={spacing.md} style={{ paddingBottom: spacing.md }}>
                {debts.map((d) => (
                  <MoneyField key={d.id} label={d.name} value={perDebt[d.id]} onChange={(v) => setPerDebt((p) => ({ ...p, [d.id]: v }))} optional />
                ))}
              </Stack>
            )}
          </View>

          <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 3 }}>
              <MoneyField label="One-time payment" value={lumpAmount} onChange={setLumpAmount} optional />
            </View>
            <View style={{ flex: 2 }}>
              <NumberField label="In month #" value={lumpMonth} onChange={setLumpMonth} integer error={lumpError} hint={lumpMonth && !lumpError ? monthLabel(monthAt(lumpMonth)) : undefined} />
            </View>
          </Row>

          <View style={styles.group}>
            <SwitchRow label="Roll freed-up payments into the next debt" description="When a debt is paid off, keep paying its amount toward the others." value={rollover} onChange={setRollover} />
          </View>
        </Stack>
      </Section>

      {(plan.stuck || minimums.stuck) && (
        <Banner
          tone="negative"
          icon="alert-triangle"
          title="Payments don't cover interest on at least one debt"
          message={`With ${plan.stuck && minimums.stuck ? 'both approaches' : plan.stuck ? 'your plan' : 'minimum payments only'}, a balance stops going down because its monthly payment is no more than the interest it adds. The model stops there, so totals below are incomplete.`}
        />
      )}

      <Section title="Results" accessory={<Pill size="sm" tone="projected" icon="trending-up" label="Projected" />}>
        <Card style={{ gap: 0 }} padding={spacing.lg}>
          <View style={[styles.tableRow, styles.tableHead]}>
            <Text variant="caption" color={colors.textTertiary} style={styles.labelCol} />
            <Text variant="caption" weight="semibold" color={colors.textSecondary} style={styles.valueCol} align="right">
              Minimum payments only
            </Text>
            <Text variant="caption" weight="semibold" color={colors.projected} style={styles.valueCol} align="right">
              Your plan
            </Text>
          </View>
          <CompareRow label="Debt-free" a={debtFreeLabel(minimums)} b={debtFreeLabel(plan)} />
          <CompareRow label="Months" a={monthsLabel(minimums)} b={monthsLabel(plan)} />
          <CompareRow label="Total interest" a={money(minimums.totalInterest)} b={money(plan.totalInterest)} />
          <CompareRow label="Total paid" a={money(minimums.totalPaid)} b={money(plan.totalPaid)} last />
        </Card>
        <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
          <StatTile
            label="Interest saved"
            icon="percent"
            value={bothFinish ? <Money cents={interestSaved} variant="h3" /> : <Text variant="h3">—</Text>}
            caption={bothFinish ? 'Projected, vs. minimums only' : 'Needs both approaches to finish'}
          />
          <StatTile
            label="Months sooner"
            icon="clock"
            value={<Text variant="h3" tabular>{monthsSooner === null ? '—' : String(monthsSooner)}</Text>}
            caption={monthsSooner === null ? 'Needs both approaches to finish' : 'Projected, vs. minimums only'}
          />
        </Row>
      </Section>

      <Section title="When will I be debt-free?" subtitle="Projected total owed each month" accessory={<Pill size="sm" tone="projected" label="Projected" />}>
        <Card>
          <LineChart
            series={[
              { key: 'plan', label: 'Your plan (projected)', color: seriesColors[0], dashed: true, points: toSeries(plan) },
              { key: 'min', label: 'Minimum payments only (projected)', color: seriesColors[1], dashed: true, points: toSeries(minimums) },
            ]}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatX={(i) => monthLabel(monthAt(i))}
            xTicks={lastIndex > 0 ? [0, Math.round(lastIndex / 2), lastIndex] : undefined}
            includeZero
            showLegend
            accessibilityLabel={`Projected debt payoff. Your plan: ${debtFreeLabel(plan)}. Minimum payments only: ${debtFreeLabel(minimums)}.`}
          />
        </Card>
      </Section>

      <Section title="By debt" subtitle="Paid-off months are projections">
        <ListCard>
          {debts.map((d) => {
            const p = planById.get(d.id);
            const m = minById.get(d.id);
            return (
              <View key={d.id} style={styles.debtRow}>
                <Row>
                  <Text weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                    {d.name}
                  </Text>
                  <Money cents={d.balance} weight="semibold" />
                </Row>
                <View style={styles.facts}>
                  <Fact label="APR" value={`${Number(effectiveApr(d, today).toFixed(2))}%`} />
                  <Fact label="Required payment" value={`${money(d.payment)}/mo`} />
                  <Fact label="Paid off · your plan" value={payoffLabel(p?.payoffMonth)} />
                  <Fact label="Paid off · minimums" value={payoffLabel(m?.payoffMonth)} />
                  <Fact label="Interest · your plan" value={p ? money(p.interest) : '—'} />
                  <Fact label="Interest · minimums" value={m ? money(m.interest) : '—'} />
                </View>
              </View>
            );
          })}
        </ListCard>
      </Section>
    </Screen>
  );
}

function CompareRow({ label, a, b, last }: { label: string; a: string; b: string; last?: boolean }) {
  return (
    <View style={[styles.tableRow, !last && styles.tableDivider]}>
      <Text variant="small" color={colors.textSecondary} style={styles.labelCol}>
        {label}
      </Text>
      <Text variant="small" weight="medium" tabular style={styles.valueCol} align="right">
        {a}
      </Text>
      <Text variant="small" weight="semibold" tabular style={styles.valueCol} align="right">
        {b}
      </Text>
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
      <Text variant="small" weight="medium" tabular>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  orderRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  rank: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.xs },
  expander: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  tableRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10 },
  tableHead: { paddingTop: 0, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  tableDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  labelCol: { flex: 1.1 },
  valueCol: { flex: 1 },
  debtRow: { paddingVertical: spacing.md, gap: spacing.sm },
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm },
  fact: { width: '50%', gap: 2, paddingRight: spacing.sm },
});
