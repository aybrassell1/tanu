import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChangeLabel, isOwned } from '@/components/assets/Change';
import { Card, EmptyState, GradientCard, HBarList, IconTile, LineChart, ListCard, Money, NavHeader, Screen, Section, Segmented, SwitchRow, Text, type HBarItem } from '@/components/ui';
import { addDays, addMonths, formatDate, formatMonth, lastMonths, monthOf, monthRange } from '@/domain/dates';
import { ledgerStartDate, monthEndDates, netWorthChange, netWorthOn, netWorthTrend } from '@/domain/position';
import type { Cents, ISODate } from '@/domain/types';
import { useData, useMoney, usePercent, useToday } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

type Range = '1M' | '3M' | '1Y' | 'All';
const RANGES: Range[] = ['1M', '3M', '1Y', 'All'];
const MAX_MONTHS = 60;

function rangeDates(range: Range, today: ISODate, start: ISODate | null): ISODate[] {
  if (range === '1M' || range === '3M') {
    const from = addMonths(today, range === '1M' ? -1 : -3);
    const out: ISODate[] = [];
    for (let d = today; d > from; d = addDays(d, -7)) out.push(d);
    out.push(from);
    return out.reverse();
  }
  if (range === '1Y') return monthEndDates(lastMonths(monthOf(today), 13), today);
  const first = start && start < today ? start : today;
  let months = monthRange(monthOf(first), monthOf(today));
  if (months.length > MAX_MONTHS) months = months.slice(-MAX_MONTHS);
  const dates = monthEndDates(months, today);
  if (months.length < MAX_MONTHS && first < dates[0]) dates.unshift(first);
  return dates;
}

function rangePhrase(range: Range, from: ISODate, today: ISODate) {
  switch (range) {
    case '1M':
      return 'over the last month';
    case '3M':
      return 'over 3 months';
    case '1Y':
      return 'over 12 months';
    case 'All':
      return `since ${formatDate(from, 'short', today)}`;
  }
}

export default function NetWorthScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const percent = usePercent();
  const [range, setRange] = useState<Range>('1Y');
  const [showParts, setShowParts] = useState(false);

  const start = useMemo(() => ledgerStartDate(data), [data]);
  const trend = useMemo(() => netWorthTrend(data, rangeDates(range, today, start)), [data, today, range, start]);
  // Month-end values only from when tracking began; months before have no data.
  const monthly = useMemo(() => netWorthTrend(data, monthEndDates(lastMonths(monthOf(today), 7), today)).points, [data, today]);
  const physical = useMemo(() => data.assets.filter((a) => isOwned(a, today)), [data, today]);

  const header = <NavHeader title="Net worth" />;

  if (data.accounts.length === 0 && data.assets.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="bar-chart-2"
          title="Nothing to add up yet"
          message="Add your accounts, debts and things you own to see your net worth and how it changes."
          actionLabel="Add an account"
          onAction={() => router.push('/accounts/edit')}
          secondaryLabel="Add an asset"
          onSecondary={() => router.push('/belongings/edit')}
        />
      </Screen>
    );
  }

  const history = trend.points.length ? trend.points : [{ date: today, ...netWorthOn(data, today) }];
  const now = history[history.length - 1];
  const first = history[0];
  const change = trend.change.change;
  const changePct = trend.change.start !== 0 ? change / Math.abs(trend.change.start) : null;
  const phrase = trend.since ? `since tracking began ${formatDate(trend.since, 'short', today)}` : rangePhrase(range, first.date, today);
  const b = now.breakdown;
  const weekly = range === '1M' || range === '3M';

  const formatX = (x: number) => {
    const i = Math.round(x);
    const d = history[i]?.date ?? today;
    if (range !== '1Y') return formatDate(d, 'short', today);
    const label = formatMonth(monthOf(d), 'short');
    // The 13-point year starts and ends in the same calendar month.
    return i === 0 && history.length > 1 && label === formatMonth(monthOf(now.date), 'short') ? `${label} '${d.slice(2, 4)}` : label;
  };

  const ownItems: (HBarItem & { show: boolean })[] = [
    {
      key: 'cash',
      label: 'Cash & checking',
      value: b.cash,
      valueLabel: money(b.cash),
      color: series[0],
      onPress: () => router.push('/money'),
      show: true,
    },
    {
      key: 'savings',
      label: 'Savings',
      value: b.savings,
      valueLabel: money(b.savings),
      color: series[0],
      onPress: () => router.push('/money'),
      show: true,
    },
    {
      key: 'investments',
      label: 'Investments',
      value: b.investments,
      valueLabel: money(b.investments),
      color: series[0],
      onPress: () => router.push('/investments'),
      show: true,
    },
    {
      key: 'physical',
      label: 'Physical assets',
      value: b.physicalAssets,
      valueLabel: money(b.physicalAssets),
      color: series[0],
      onPress: () => router.push('/belongings'),
      show: true,
    },
    {
      key: 'other',
      label: 'Other',
      value: b.otherAccountAssets,
      valueLabel: money(b.otherAccountAssets),
      color: series[0],
      onPress: () => router.push('/money'),
      show: b.otherAccountAssets !== 0,
    },
  ];
  const oweItems: (HBarItem & { show: boolean })[] = [
    {
      key: 'cards',
      label: 'Credit cards',
      value: b.creditCards,
      valueLabel: money(b.creditCards),
      color: series[1],
      onPress: () => router.push('/debt'),
      show: true,
    },
    {
      key: 'loans',
      label: 'Loans',
      value: b.loans,
      valueLabel: money(b.loans),
      color: series[1],
      onPress: () => router.push('/debt'),
      show: true,
    },
    {
      key: 'other',
      label: 'Other debts',
      value: b.otherLiabilities,
      valueLabel: money(b.otherLiabilities),
      color: series[1],
      onPress: () => router.push('/debt'),
      show: b.otherLiabilities !== 0,
    },
  ];
  const withShare = (items: (HBarItem & { show: boolean })[], total: Cents): HBarItem[] =>
    items
      .filter((i) => i.show)
      .map(({ show: _show, ...i }) => ({
        ...i,
        caption: total > 0 && i.value > 0 ? `${percent(i.value / total)} of total` : undefined,
      }));

  // Newest first: up to 6 month-ends, each compared with the month before (or
  // with opening balances in the month tracking began).
  const shown = monthly.length > 6 ? monthly.slice(1) : monthly;
  const months = shown
    .map((m) => {
      const prevEnd = addDays(`${monthOf(m.date)}-01`, -1);
      return {
        ...m,
        change: netWorthChange(data, start && prevEnd < start ? addDays(start, -1) : prevEnd, m.date).change,
        current: monthOf(m.date) === monthOf(today),
        firstTracked: !!start && prevEnd < start,
      };
    })
    .reverse();

  return (
    <Screen header={header}>
      <GradientCard style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Text variant="small" weight="medium" color="rgba(255,255,255,0.85)">
            Net worth today
          </Text>
          <Money cents={now.netWorth} variant="display" color={colors.onGradient} />
          <ChangeLabel cents={change} pct={changePct} suffix={phrase} color={colors.onGradient} />
        </View>
        <Segmented items={RANGES} value={range} onChange={setRange} size="sm" />
      </GradientCard>

      <Section title="Is my net worth growing?" subtitle={weekly ? 'Weekly' : 'Month-end values'}>
        <Card style={{ gap: spacing.sm }}>
          <LineChart
            accessibilityLabel={`Net worth ${phrase}`}
            series={[
              {
                key: 'nw',
                label: 'Net worth',
                color: series[0],
                area: true,
                points: history.map((h, x) => ({ x, y: h.netWorth })),
              },
              ...(showParts
                ? [
                    {
                      key: 'assets',
                      label: 'Assets',
                      color: series[1],
                      points: history.map((h, x) => ({ x, y: h.assets })),
                    },
                    {
                      key: 'liabilities',
                      label: 'Liabilities',
                      color: series[2],
                      points: history.map((h, x) => ({ x, y: h.liabilities })),
                    },
                  ]
                : []),
            ]}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatX={formatX}
            includeZero
          />
          <SwitchRow label="Show assets & liabilities" value={showParts} onChange={setShowParts} />
        </Card>
      </Section>

      <Section title="What you own" subtitle={`${money(now.assets)} in total`}>
        <Card>
          <HBarList items={withShare(ownItems, now.assets)} />
        </Card>
      </Section>

      <Section title="What you owe" subtitle={`${money(now.liabilities)} in total`}>
        <Card>
          {oweItems.every((i) => i.value === 0) ? (
            <View style={styles.inline}>
              <Feather name="check-circle" size={18} color={colors.positive} />
              <Text color={colors.textSecondary}>No debts tracked.</Text>
            </View>
          ) : (
            <HBarList items={withShare(oweItems, now.liabilities)} />
          )}
        </Card>
      </Section>

      <Card onPress={() => router.push('/belongings')} accessibilityLabel="Physical assets" style={styles.inline}>
        <IconTile icon="box" />
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="medium">Physical assets</Text>
          <Text variant="small" color={colors.textTertiary}>
            {physical.length === 0 ? 'Track your car, computer or jewelry' : `${physical.length} ${physical.length === 1 ? 'asset' : 'assets'}`}
          </Text>
        </View>
        <Money cents={b.physicalAssets} weight="semibold" />
        <Feather name="chevron-right" size={18} color={colors.textTertiary} />
      </Card>

      <Section title="Month by month">
        <ListCard>
          {months.map((m) => (
            <View key={m.date} style={styles.monthRow}>
              <View style={{ flex: 1 }}>
                <Text weight="medium">{formatMonth(monthOf(m.date))}</Text>
                <Text variant="caption" color={colors.textTertiary}>
                  {m.current ? 'So far' : `As of ${formatDate(m.date, 'short', today)}`}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 2 }}>
                <Money cents={m.netWorth} weight="semibold" tone="balance" />
                <ChangeLabel cents={m.change} variant="caption" suffix={m.firstTracked ? 'since tracking began' : 'vs prior month'} />
              </View>
            </View>
          ))}
        </ListCard>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 12,
  },
});
