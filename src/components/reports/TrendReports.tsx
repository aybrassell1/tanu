import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { ColumnChart, EmptyState, KeyValue, LineChart, ListCard, Money, Row, StatTile, Text } from '@/components/ui';
import { isDebt } from '@/domain/catalog';
import { diffDays, formatDate, formatMonth, lastMonths, monthOf } from '@/domain/dates';
import { debtHistory } from '@/domain/debt';
import { ledgerStartDate, monthEndDates, netWorthTrend, trackedDays, trackingStartDate } from '@/domain/position';
import { monthStats, yearOverYear } from '@/domain/reports';
import type { Cents, ISOMonth } from '@/domain/types';
import { useDerived, useMoney, usePercent } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

import { ChartCard, DataTable, Delta, MoneyCell, MoneyDelta, Muted, PartialNote, relativeChange, Takeaway, useAxisMoney, monthLabel } from './shared';

const monthWithYear = (m: ISOMonth) => `${formatMonth(m, 'short')} '${m.slice(2, 4)}`;

type Point = { month: ISOMonth; value: Cents };

/** Month-end balance trend: line chart + table of the same numbers. */
function BalanceTrend({ title, label, points, good, includeZero }: { title: string; label: string; points: Point[]; good: 'up' | 'down'; includeZero?: boolean }) {
  const axis = useAxisMoney();
  const last = points.length - 1;
  return (
    <ChartCard title={title}>
      <LineChart
        series={[{ key: 'value', label, color: series[0], points: points.map((p, i) => ({ x: i, y: p.value })) }]}
        formatY={axis}
        formatX={(x) => (points[x] ? monthWithYear(points[x].month) : '')}
        xTicks={last > 0 ? [0, Math.round(last / 2), last] : [0]}
        includeZero={includeZero}
        accessibilityLabel={`${label} at the end of each of the last ${points.length} months`}
      />
      <DataTable
        columns={[{ label: 'Month' }, { label }, { label: 'Change' }]}
        rows={points
          .map((p, i) => ({
            key: p.month,
            cells: [monthWithYear(p.month), <MoneyCell key="v" cents={p.value} />, i === 0 ? '—' : <MoneyDelta key="c" cents={p.value - points[i - 1].value} good={good} />],
          }))
          .reverse()}
        caption="Month-end values; this month is as of today."
      />
    </ChartCard>
  );
}

// ─── Is my debt going down? ──────────────────────────────────────────────────

export function DebtReport() {
  const router = useRouter();
  const money = useMoney();
  const percent = usePercent();
  const { points, hasDebt } = useDerived((d, today) => {
    // Months before tracking began have no data and would read as $0 debt.
    const start = ledgerStartDate(d);
    const months = lastMonths(monthOf(today), 12).filter((m) => !start || m >= monthOf(start));
    const history = debtHistory(d, monthEndDates(months, today));
    return { points: history.map((h, i) => ({ month: months[i], value: h.total })), hasDebt: d.accounts.some((a) => isDebt(a.type)) };
  });

  if (!hasDebt) {
    return <EmptyState icon="trending-down" title="No debts tracked" message="Add credit cards and loans to follow what you owe over time." actionLabel="Add an account" onAction={() => router.push('/accounts/edit')} />;
  }

  const first = points[0].value;
  const last = points[points.length - 1].value;
  const change = last - first;
  const rel = relativeChange(last, first);
  const period = points.length < 12 ? `since ${monthWithYear(points[0].month)}` : 'over the last 12 months';

  return (
    <>
      <BalanceTrend title="How much did I owe at each month-end?" label="Total debt" points={points} good="down" includeZero />
      <Takeaway>
        {first === 0 && last === 0
          ? 'You had no debt at any month-end in the last 12 months.'
          : change === 0
            ? `Your debt is unchanged ${period} at ${money(last, { whole: true })}.`
            : `Your debt went ${change < 0 ? 'down' : 'up'} by ${money(Math.abs(change), { whole: true })}${rel !== null ? ` (${percent(Math.abs(rel))})` : ''} ${period}, to ${money(last, { whole: true })}.`}
      </Takeaway>
    </>
  );
}

// ─── Is my net worth growing? ────────────────────────────────────────────────

export function NetWorthReport() {
  const router = useRouter();
  const money = useMoney();
  const { points, hasData, change, since } = useDerived((d, today) => {
    const months = lastMonths(monthOf(today), 12);
    const trend = netWorthTrend(d, monthEndDates(months, today));
    return {
      points: trend.points.map((h) => ({ month: monthOf(h.date), value: h.netWorth })),
      hasData: trend.points.length > 0,
      change: trend.change.change,
      since: trend.since ? formatMonth(monthOf(trend.since)) : null,
    };
  });

  if (!hasData) {
    return <EmptyState icon="bar-chart-2" title="Nothing to add up yet" message="Net worth is everything you own minus everything you owe. Add accounts to track it." actionLabel="Add an account" onAction={() => router.push('/accounts/edit')} />;
  }

  const last = points[points.length - 1].value;
  const period = since ? `since tracking began in ${since}` : 'over the last 12 months';

  return (
    <>
      <BalanceTrend title="What was my net worth at each month-end?" label="Net worth" points={points} good="up" includeZero={points.some((p) => p.value < 0)} />
      <Takeaway>
        {change === 0
          ? `Your net worth is unchanged ${period} at ${money(last, { whole: true })}.`
          : `Your net worth ${change > 0 ? 'grew' : 'fell'} by ${money(Math.abs(change), { whole: true })} ${period}, to ${money(last, { whole: true })}. Opening balances of newly added accounts don't count as change.`}
      </Takeaway>
    </>
  );
}

// ─── How does this year compare to last year? ────────────────────────────────

export function YearReport() {
  const router = useRouter();
  const money = useMoney();
  const percent = usePercent();
  const axis = useAxisMoney();
  const model = useDerived((d, today) => {
    const yoy = yearOverYear(d, today);
    const current = monthOf(today);
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const rows = months.map((mm) => {
      const month = `${yoy.year}-${mm}`;
      const future = month > current;
      return {
        month,
        future,
        thisYear: future ? 0 : monthStats(d, month, today).spending,
        lastYear: monthStats(d, `${yoy.year - 1}-${mm}`).spending,
      };
    });
    const spanEnd = yoy.lastYearToDate.to;
    const spanDays = diffDays(`${yoy.year - 1}-01-01`, spanEnd) + 1;
    // Last year may have been tracked for only part of the same span.
    const partial = yoy.lastYearHasData && trackedDays(d, `${yoy.year - 1}-01-01`, spanEnd) < spanDays * 0.9;
    return { yoy, rows, current, partial, trackedFrom: trackingStartDate(d) };
  });
  const { yoy, rows, current, partial, trackedFrom } = model;
  const ty = yoy.thisYear;
  const ly = yoy.lastYearToDate;
  const full = yoy.lastYearFull;

  if (ty.transactionCount === 0 && full.transactionCount === 0) {
    return <EmptyState icon="layers" title="No activity this year or last" message="Once you record income and spending, you can compare years here." actionLabel="Add a transaction" onAction={() => router.push('/transactions/edit')} />;
  }

  const compare = yoy.lastYearHasData;
  // Last year may have been tracked for only part of the same span.
  const spendChange = compare ? relativeChange(ty.spending, ly.spending) : null;
  const ratePoints = Math.round((ty.savingsRate - ly.savingsRate) * 100);
  const vs = `vs ${yoy.year - 1} to date`;
  const lastLabel = String(yoy.year - 1);

  return (
    <>
      <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
        <PartialNote label={`Jan 1 – today, both years`} />
        {partial && !!trackedFrom && <PartialNote label={`${yoy.year - 1} tracked from ${formatDate(trackedFrom, 'medium')}`} />}
      </Row>
      <View style={{ gap: spacing.sm }}>
        <Row gap={spacing.sm}>
          <StatTile label="Income" icon="briefcase" value={<Money cents={ty.income} variant="h3" whole />} caption={compare ? <YearDelta cents={ty.income - ly.income} good="up" vs={vs} /> : <NoCompare year={yoy.year - 1} />} />
          <StatTile label="Spending" icon="shopping-bag" value={<Money cents={ty.spending} variant="h3" whole />} caption={compare ? <YearDelta cents={ty.spending - ly.spending} good="down" vs={vs} /> : <NoCompare year={yoy.year - 1} />} />
        </Row>
        <Row gap={spacing.sm}>
          <StatTile label="Saved" icon="shield" value={<Money cents={ty.saved} variant="h3" whole tone="balance" />} caption={compare ? <YearDelta cents={ty.saved - ly.saved} good="up" vs={vs} /> : <NoCompare year={yoy.year - 1} />} />
          <StatTile
            label="Savings rate"
            icon="percent"
            value={<Text variant="h3">{ty.income > 0 ? percent(ty.savingsRate) : '—'}</Text>}
            caption={
              !compare || ty.income <= 0 || ly.income <= 0 ? (
                <NoCompare year={yoy.year - 1} />
              ) : (
              <View style={{ gap: 2 }}>
                <Delta value={ratePoints} good="up" variant="caption" format={(abs) => `${abs} pts`} />
                <Text variant="caption" color={colors.textTertiary}>
                  {vs}
                </Text>
              </View>
              )
            }
          />
        </Row>
      </View>

      <ChartCard title={`Did I spend more each month than in ${lastLabel}?`}>
        <ColumnChart
          data={rows.map((r) => ({ key: r.month, label: monthLabel(r.month, 12), values: [r.thisYear, r.lastYear] }))}
          series={[
            { label: String(yoy.year), color: series[0] },
            { label: lastLabel, color: series[1] },
          ]}
          formatY={axis}
          formatTitle={(d) => formatMonth(d.key, 'short')}
          highlightKey={current}
          accessibilityLabel={`Monthly spending in ${yoy.year} compared with ${lastLabel}`}
        />
        {current < `${yoy.year}-12` && <Muted>{`Months after ${formatMonth(current, 'short')} haven't happened yet, so ${yoy.year} shows ${money(0, { whole: true })} for them.`}</Muted>}
        <DataTable
          columns={[{ label: 'Month' }, { label: String(yoy.year) }, { label: lastLabel }, { label: 'Change' }]}
          rows={rows.map((r) => ({
            key: r.month,
            cells: [
              formatMonth(r.month, 'short'),
              r.future ? '—' : <MoneyCell key="t" cents={r.thisYear} />,
              <MoneyCell key="l" cents={r.lastYear} />,
              r.future ? '—' : <MoneyDelta key="c" cents={r.thisYear - r.lastYear} good="down" />,
            ],
          }))}
          caption={`${formatMonth(current, 'short')} ${yoy.year} is so far.`}
        />
      </ChartCard>

      <ChartCard title={`What did all of ${lastLabel} look like?`}>
        <ListCard>
          <KeyValue label={`Annual income ${lastLabel}`}>
            <Money cents={full.income} weight="semibold" />
          </KeyValue>
          <KeyValue label={`Annual spending ${lastLabel}`}>
            <Money cents={full.spending} weight="semibold" />
          </KeyValue>
          <KeyValue label="Saved">
            <Money cents={full.saved} weight="semibold" tone="balance" />
          </KeyValue>
          <KeyValue label="Savings rate" value={full.income > 0 ? percent(full.savingsRate) : '—'} />
        </ListCard>
      </ChartCard>

      <Takeaway>
        {spendChange === null
          ? `So far this year you've spent ${money(ty.spending, { whole: true })}; nothing was recorded for the same period last year.`
          : `So far this year you've spent ${money(ty.spending, { whole: true })}, ${spendChange === 0 ? 'the same as' : `${percent(Math.abs(spendChange))} ${spendChange > 0 ? 'more than' : 'less than'}`} by this date last year (${money(ly.spending, { whole: true })}).`}
      </Takeaway>
    </>
  );
}

function NoCompare({ year }: { year: number }) {
  return (
    <Text variant="caption" color={colors.textTertiary}>
      {`No ${year} data to compare`}
    </Text>
  );
}

function YearDelta({ cents, good, vs }: { cents: Cents; good: 'up' | 'down'; vs: string }) {
  return (
    <View style={{ gap: 2 }}>
      <MoneyDelta cents={cents} good={good} variant="caption" compact />
      <Text variant="caption" color={colors.textTertiary}>
        {vs}
      </Text>
    </View>
  );
}
