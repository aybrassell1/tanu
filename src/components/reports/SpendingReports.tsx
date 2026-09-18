import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TransactionRow } from '@/components/finance/Rows';
import { ColumnChart, EmptyState, HBarList, KeyValue, ListCard, ListRow, Money, Row, Segmented, StatTile, Text } from '@/components/ui';
import { RECURRING_KINDS } from '@/domain/catalog';
import { formatDate, formatMonth, monthOf } from '@/domain/dates';
import { annualEquivalent, frequencyLabel, monthlyEquivalent } from '@/domain/recurrence';
import { categoryAverages, largestExpenses, periodStats } from '@/domain/reports';
import { periodHasData } from '@/domain/position';
import type { RecurringKind } from '@/domain/types';
import { useDerived, useMoney } from '@/store/hooks';
import { colors, radius, series, spacing } from '@/theme/tokens';

import { ChartCard, Muted, MoneyDelta, PeriodControl, percent, rangeFor, shareOf, Takeaway, useAxisMoney, useRange, type DateRange } from './shared';

function useDrill() {
  const router = useRouter();
  return (range: { from: string; to: string }, extra: { category?: string; accountId?: string }) => {
    const params: Record<string, string> = { from: range.from, to: range.to };
    if (extra.category && extra.category !== 'uncategorized') params.category = extra.category;
    if (extra.accountId) params.accountId = extra.accountId;
    router.push({ pathname: '/transactions', params });
  };
}

function NoSpending({ range }: { range?: DateRange }) {
  const router = useRouter();
  return (
    <EmptyState
      icon="shopping-bag"
      title={range ? `No spending ${range.phrase}` : 'No spending yet'}
      message="Expenses you record show up here, grouped and compared."
      actionLabel="Add expense"
      onAction={() => router.push('/transactions/edit')}
    />
  );
}

// ─── Where is my money going? ────────────────────────────────────────────────

export function SpendingCategoriesReport() {
  const money = useMoney();
  const drill = useDrill();
  const { key, setKey, range } = useRange();
  const stats = useDerived((d) => periodStats(d, range.from, range.to), [range.from, range.to]);
  const [open, setOpen] = useState<string | null>(null);
  const top = Math.max(1, ...stats.byCategory.map((c) => c.amount));
  const lead = stats.byCategory[0];

  return (
    <>
      <PeriodControl value={key} onChange={setKey} range={range} />
      {stats.spending <= 0 ? (
        <NoSpending range={range} />
      ) : (
        <>
          <ChartCard title="Which categories take the most?">
            <Muted>{`${money(stats.spending)} spent ${range.phrase}. Tap a category for its subcategories.`}</Muted>
            <View style={{ gap: spacing.lg }}>
              {stats.byCategory.map((c) => {
                const expanded = open === c.key;
                return (
                  <View key={c.key} style={{ gap: spacing.sm }}>
                    <HBarList
                      max={top}
                      items={[
                        {
                          key: c.key,
                          label: c.label,
                          value: c.amount,
                          valueLabel: money(c.amount),
                          color: c.color ?? series[0],
                          caption: `${percent(shareOf(c.amount, stats.spending))} of spending · ${expanded ? 'Hide details' : c.subs.length > 1 ? `${c.subs.length} subcategories` : 'Show details'}`,
                          onPress: () => setOpen(expanded ? null : c.key),
                        },
                      ]}
                    />
                    {expanded && (
                      <View style={styles.subs}>
                        {c.subs.map((s) => (
                          <ListRow
                            key={s.key}
                            dense
                            title={s.key === c.key ? `${c.label} (general)` : s.label}
                            trailing={<Money cents={s.amount} weight="semibold" />}
                            trailingCaption={`${percent(shareOf(s.amount, c.amount))} of ${c.label}`}
                            chevron
                            onPress={() => drill(range, { category: s.key })}
                          />
                        ))}
                        <ListRow dense title={`See ${c.label} transactions`} icon="list" chevron onPress={() => drill(range, { category: c.key })} />
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </ChartCard>
          {lead && <Takeaway>{`${lead.label} took the biggest share of your spending ${range.phrase}: ${percent(shareOf(lead.amount, stats.spending))} (${money(lead.amount, { whole: true })} of ${money(stats.spending, { whole: true })}).`}</Takeaway>}
        </>
      )}
    </>
  );
}

// ─── Am I spending more than last month? ─────────────────────────────────────

export function MonthVsMonthReport() {
  const money = useMoney();
  const axis = useAxisMoney();
  const model = useDerived((d, today) => {
    const range = rangeFor('this_month', today);
    const current = periodStats(d, range.from, range.to);
    const previous = periodStats(d, range.previous.from, range.previous.to);
    const map = new Map<string, { key: string; label: string; now: number; before: number }>();
    for (const c of current.byCategory) map.set(c.key, { key: c.key, label: c.label, now: c.amount, before: 0 });
    for (const c of previous.byCategory) {
      const e = map.get(c.key) ?? { key: c.key, label: c.label, now: 0, before: 0 };
      e.before = c.amount;
      map.set(c.key, e);
    }
    const all = [...map.values()].sort((a, b) => Math.max(b.now, b.before) - Math.max(a.now, a.before));
    const rows = all.slice(0, 6);
    const rest = all.slice(6);
    if (rest.length) rows.push({ key: 'other', label: 'Other', now: rest.reduce((s, r) => s + r.now, 0), before: rest.reduce((s, r) => s + r.before, 0) });
    const mover = [...all].sort((a, b) => Math.abs(b.now - b.before) - Math.abs(a.now - a.before))[0];
    return { range, today, current, previous, rows, mover, hasPrevious: periodHasData(d, range.previous.from, range.previous.to) };
  });
  const { range, today, current, previous, rows, mover, hasPrevious } = model;
  const diff = current.spending - previous.spending;

  if (current.spending <= 0 && previous.spending <= 0) return <NoSpending />;
  if (!hasPrevious) {
    return (
      <Takeaway>{`You've spent ${money(current.spending, { whole: true })} so far this month. Nothing was tracked at this point last month, so there's nothing to compare with yet.`}</Takeaway>
    );
  }

  return (
    <>
      <Muted>{`${formatDate(range.from, 'short', today)} – ${formatDate(range.to, 'short', today)} compared with ${formatDate(range.previous.from, 'short', today)} – ${formatDate(range.previous.to, 'short', today)}.`}</Muted>
      <ChartCard title="Which categories changed?">
        <ColumnChart
          data={rows.map((r) => ({ key: r.key, label: r.label, values: [r.before, r.now] }))}
          series={[
            { label: 'Last month', color: series[1] },
            { label: 'This month', color: series[0] },
          ]}
          formatY={axis}
          formatTitle={(d) => d.label}
          accessibilityLabel="Spending by category, last month compared with this month"
        />
        <ListCard>
          {rows.map((r) => (
            <ListRow key={r.key} dense title={r.label} subtitle={`Last month ${money(r.before, { whole: true })} · This month ${money(r.now, { whole: true })}`} trailing={<MoneyDelta cents={r.now - r.before} good="down" />} />
          ))}
          <ListRow dense title="Total" subtitle={`Last month ${money(previous.spending, { whole: true })} · This month ${money(current.spending, { whole: true })}`} trailing={<MoneyDelta cents={diff} good="down" />} />
        </ListCard>
      </ChartCard>
      <Takeaway>
        {`${diff === 0 ? "You've spent the same as at this point last month" : `You've spent ${money(Math.abs(diff), { whole: true })} ${diff > 0 ? 'more' : 'less'} than at this point last month`} (${money(current.spending, { whole: true })} vs ${money(previous.spending, { whole: true })}).${
          mover && mover.now !== mover.before ? ` The biggest change is ${mover.label}, ${mover.now > mover.before ? 'up' : 'down'} ${money(Math.abs(mover.now - mover.before), { whole: true })}.` : ''
        }`}
      </Takeaway>
    </>
  );
}

// ─── What does a normal month cost? ──────────────────────────────────────────

export function NormalMonthReport() {
  const router = useRouter();
  const money = useMoney();
  const [n, setN] = useState<'3' | '6' | '12'>('3');
  const avg = useDerived((d, today) => categoryAverages(d, monthOf(today), Number(n)), [n]);
  const first = avg.months[0];
  const last = avg.months[avg.months.length - 1];

  return (
    <>
      <View style={{ gap: spacing.xs }}>
        <Segmented
          items={[
            { value: '3', label: '3 months' },
            { value: '6', label: '6 months' },
            { value: '12', label: '12 months' },
          ]}
          value={n}
          onChange={setN}
        />
        <Text variant="caption" color={colors.textTertiary}>
          {`Average of complete months, ${formatMonth(first)} – ${formatMonth(last)}`}
        </Text>
      </View>
      {avg.total <= 0 && avg.income <= 0 ? (
        <EmptyState
          icon="calendar"
          title="Not enough history yet"
          message="Averages use complete months before this one. Record a full month of activity to see them."
          actionLabel="Add a transaction"
          onAction={() => router.push('/transactions/edit')}
        />
      ) : (
        <>
          <View style={{ gap: spacing.sm }}>
            <Row gap={spacing.sm}>
              <StatTile label="Spending" icon="shopping-bag" value={<Money cents={avg.total} variant="h3" whole />} caption="per month" />
              <StatTile label="Income" icon="briefcase" value={<Money cents={avg.income} variant="h3" whole />} caption="per month" />
            </Row>
            <Row gap={spacing.sm}>
              <StatTile label="Essential" icon="home" value={<Money cents={avg.essential} variant="h3" whole />} caption={`${percent(shareOf(avg.essential, avg.total))} of spending`} />
              <StatTile label="Discretionary" icon="coffee" value={<Money cents={avg.discretionary} variant="h3" whole />} caption={`${percent(shareOf(avg.discretionary, avg.total))} of spending`} />
            </Row>
          </View>
          {avg.byCategory.length > 0 && (
            <ChartCard title="Which categories cost the most in a typical month?">
              <HBarList
                items={avg.byCategory.map((c) => ({
                  key: c.key,
                  label: c.label,
                  value: c.amount,
                  valueLabel: money(c.amount, { whole: true }),
                  color: c.color ?? series[0],
                  caption: `${percent(shareOf(c.amount, avg.total))} of a typical month`,
                }))}
              />
            </ChartCard>
          )}
          <Takeaway>{`A typical month costs about ${money(avg.total, { whole: true })}; ${money(avg.essential, { whole: true })} of it is essential.${avg.income > 0 ? ` You bring in about ${money(avg.income, { whole: true })}.` : ''}`}</Takeaway>
        </>
      )}
    </>
  );
}

// ─── What do my recurring costs add up to? ───────────────────────────────────

const RECURRING_GROUPS: { kind: RecurringKind; label: string }[] = [
  { kind: 'bill', label: 'Bills' },
  { kind: 'subscription', label: 'Subscriptions' },
  { kind: 'debt_payment', label: 'Debt payments' },
  { kind: 'savings', label: 'Savings' },
  { kind: 'investment', label: 'Investments' },
];

export function RecurringReport() {
  const router = useRouter();
  const money = useMoney();
  const model = useDerived((d, today) => {
    const kinds = new Set(RECURRING_GROUPS.map((g) => g.kind));
    const items = d.recurring
      .filter((r) => r.active && kinds.has(r.kind) && (!r.endDate || r.endDate >= today))
      .map((r) => ({ r, monthly: monthlyEquivalent(r.amount, r.frequency), annual: annualEquivalent(r.amount, r.frequency) }))
      .sort((a, b) => b.monthly - a.monthly);
    const groups = RECURRING_GROUPS.map((g, i) => {
      const list = items.filter((x) => x.r.kind === g.kind);
      return { ...g, color: series[i], count: list.length, monthly: list.reduce((s, x) => s + x.monthly, 0), annual: list.reduce((s, x) => s + x.annual, 0) };
    }).filter((g) => g.count > 0);
    const income = categoryAverages(d, monthOf(today), 3).income;
    return { items, groups, income, monthly: items.reduce((s, x) => s + x.monthly, 0), annual: items.reduce((s, x) => s + x.annual, 0) };
  });

  if (model.items.length === 0) {
    return <EmptyState icon="repeat" title="No recurring items" message="Add bills, subscriptions and planned payments to see what they cost each month and year." actionLabel="Add a bill" onAction={() => router.push('/bills')} />;
  }

  return (
    <>
      <ChartCard title="Which kinds of recurring costs are biggest?">
        <HBarList
          items={model.groups.map((g) => ({
            key: g.kind,
            label: g.label,
            value: g.monthly,
            valueLabel: `${money(g.monthly, { whole: true })}/mo`,
            color: g.color,
            caption: `${g.count} ${g.count === 1 ? 'item' : 'items'} · ${money(g.annual, { whole: true })} a year`,
          }))}
        />
        <ListCard>
          <KeyValue label="Monthly total">
            <Money cents={model.monthly} weight="semibold" />
          </KeyValue>
          <KeyValue label="Annual total">
            <Money cents={model.annual} weight="semibold" />
          </KeyValue>
        </ListCard>
      </ChartCard>

      <ChartCard title="Which items cost the most?">
        <ListCard>
          {model.items.slice(0, 10).map(({ r, monthly, annual }) => (
            <ListRow
              key={r.id}
              dense
              title={r.name}
              subtitle={`${RECURRING_KINDS[r.kind].label} · ${money(r.amount)} ${frequencyLabel(r.frequency).toLowerCase()}`}
              trailing={<Text weight="semibold" tabular>{`${money(monthly)}/mo`}</Text>}
              trailingCaption={`${money(annual, { whole: true })}/yr`}
              chevron
              onPress={() => router.push(`/bills/${r.id}`)}
            />
          ))}
        </ListCard>
      </ChartCard>

      <Takeaway>
        {model.income > 0
          ? `Recurring obligations add up to ${money(model.monthly, { whole: true })} a month (${money(model.annual, { whole: true })} a year), about ${percent(shareOf(model.monthly, model.income))} of your average monthly income.`
          : `Recurring obligations add up to ${money(model.monthly, { whole: true })} a month (${money(model.annual, { whole: true })} a year). Record income to see what share of your pay that is.`}
      </Takeaway>
    </>
  );
}

// ─── What were my biggest expenses? ──────────────────────────────────────────

export function LargestExpensesReport() {
  const { key, setKey, range } = useRange('3m');
  const money = useMoney();
  const { list, spending } = useDerived((d) => ({ list: largestExpenses(d, range.from, range.to, 15), spending: periodStats(d, range.from, range.to).spending }), [range.from, range.to]);
  const top3 = list.slice(0, 3).reduce((s, t) => s + t.amount, 0);

  return (
    <>
      <PeriodControl value={key} onChange={setKey} range={range} />
      {list.length === 0 ? (
        <NoSpending range={range} />
      ) : (
        <>
          <ListCard>
            {list.map((tx, i) => (
              <View key={tx.id} style={styles.ranked}>
                <View style={styles.rank}>
                  <Text variant="caption" weight="semibold" color={colors.textSecondary} tabular>
                    {i + 1}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <TransactionRow tx={tx} showDate />
                </View>
              </View>
            ))}
          </ListCard>
          <Takeaway>
            {spending > 0
              ? `Your ${Math.min(3, list.length) === 1 ? 'biggest expense was' : `${Math.min(3, list.length)} biggest expenses were`} ${percent(Math.min(1, shareOf(top3, spending)))} of your spending ${range.phrase} (${money(top3, { whole: true })} of ${money(spending, { whole: true })}).`
              : `Your biggest expense ${range.phrase} was ${money(list[0].amount, { whole: true })}.`}
          </Takeaway>
        </>
      )}
    </>
  );
}

// ─── Which accounts do I spend from? ─────────────────────────────────────────

export function AccountsReport() {
  const money = useMoney();
  const drill = useDrill();
  const { key, setKey, range } = useRange();
  const stats = useDerived((d) => periodStats(d, range.from, range.to), [range.from, range.to]);
  const lead = stats.byAccount[0];

  return (
    <>
      <PeriodControl value={key} onChange={setKey} range={range} />
      {stats.spending <= 0 ? (
        <NoSpending range={range} />
      ) : (
        <>
          <ChartCard title="How much did each account spend?">
            <Muted>Tap an account to see its transactions.</Muted>
            <HBarList
              items={stats.byAccount.map((a, i) => ({
                key: a.key,
                label: a.label,
                value: a.amount,
                valueLabel: money(a.amount),
                color: a.color ?? series[i % series.length],
                caption: `${percent(shareOf(a.amount, stats.spending))} of spending`,
                onPress: () => drill(range, { accountId: a.key }),
              }))}
            />
          </ChartCard>
          {lead && <Takeaway>{`Most of your spending ${range.phrase} came from ${lead.label}: ${money(lead.amount, { whole: true })}, or ${percent(shareOf(lead.amount, stats.spending))} of the total.`}</Takeaway>}
        </>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  subs: { marginLeft: spacing.md, paddingLeft: spacing.md, borderLeftWidth: 2, borderLeftColor: colors.border, borderRadius: radius.xs },
  ranked: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rank: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' },
});
