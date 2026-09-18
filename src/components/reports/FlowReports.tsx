import { useRouter } from 'expo-router';

import { ColumnChart, EmptyState, HBarList, KeyValue, ListCard, Money } from '@/components/ui';
import { formatMonth, monthOf } from '@/domain/dates';
import { monthlySeries, periodStats } from '@/domain/reports';
import { useDerived, useMoney, usePercent } from '@/store/hooks';
import { series } from '@/theme/tokens';

import { ChartCard, DataTable, MoneyCell, MoneyDelta, Muted, PeriodControl, relativeChange, shareOf, Takeaway, useAxisMoney, useRange, monthLabel } from './shared';

const useTwelveMonths = () => useDerived((d, today) => monthlySeries(d, monthOf(today), 12, today));

// ─── Am I cash-flow positive? ────────────────────────────────────────────────

export function CashFlowReport() {
  const router = useRouter();
  const money = useMoney();
  const axis = useAxisMoney();
  const months = useTwelveMonths();
  const active = months.filter((m) => m.income !== 0 || m.spending !== 0);

  if (active.length === 0) {
    return <EmptyState icon="activity" title="No income or spending yet" message="Record income and expenses to see whether more comes in than goes out." actionLabel="Add a transaction" onAction={() => router.push('/transactions/edit')} />;
  }

  const positive = active.filter((m) => m.saved > 0).length;
  const avgNet = Math.round(active.reduce((s, m) => s + m.saved, 0) / active.length);
  const current = months[months.length - 1];

  return (
    <>
      <ChartCard title="Did more come in than went out each month?">
        <ColumnChart
          data={months.map((m) => ({ key: m.month, label: monthLabel(m.month, months.length), values: [m.income, m.spending] }))}
          series={[
            { label: 'Income', color: series[0] },
            { label: 'Spending', color: series[1] },
          ]}
          formatY={axis}
          formatTitle={(d) => formatMonth(d.key)}
          highlightKey={current.month}
          accessibilityLabel="Monthly income and spending for the last 12 months"
        />
        <DataTable
          columns={[{ label: 'Month', flex: 1.1 }, { label: 'Income' }, { label: 'Spending' }, { label: 'Net', flex: 1.1 }]}
          rows={[...months].reverse().map((m) => ({
            key: m.month,
            cells: [formatMonth(m.month, 'short') + ` '${m.month.slice(2, 4)}`, <MoneyCell key="i" cents={m.income} />, <MoneyCell key="s" cents={m.spending} />, <MoneyDelta key="n" cents={m.saved} good="up" />],
          }))}
          caption="This month is so far. Transfers, debt payments and investment contributions are not spending."
        />
      </ChartCard>
      <Takeaway>
        {`You were cash-flow positive in ${positive} of the last ${active.length} ${active.length === 1 ? 'month' : 'months'} with activity, keeping ${avgNet >= 0 ? 'an average of' : 'an average shortfall of'} ${money(Math.abs(avgNet), { whole: true })} a month.`}
      </Takeaway>
    </>
  );
}

// ─── How is my income trending? ──────────────────────────────────────────────

export function IncomeReport() {
  const router = useRouter();
  const money = useMoney();
  const percent = usePercent();
  const axis = useAxisMoney();
  const months = useTwelveMonths();
  const { key, setKey, range } = useRange('3m');
  const { current, previous } = useDerived((d) => ({ current: periodStats(d, range.from, range.to), previous: periodStats(d, range.previous.from, range.previous.to) }), [range.from, range.to]);
  const withIncome = months.filter((m) => m.income > 0);

  if (withIncome.length === 0 && current.income === 0) {
    return (
      <EmptyState
        icon="briefcase"
        title="No income recorded"
        message="Paychecks and other income you record will show up here."
        actionLabel="Add income"
        onAction={() => router.push({ pathname: '/transactions/edit', params: { type: 'income' } })}
      />
    );
  }

  const avg = withIncome.length ? Math.round(withIncome.reduce((s, m) => s + m.income, 0) / withIncome.length) : 0;
  const change = relativeChange(current.income, previous.income);

  return (
    <>
      <ChartCard title="How much did I earn each month?">
        <ColumnChart
          data={months.map((m) => ({ key: m.month, label: monthLabel(m.month, months.length), values: [m.income] }))}
          series={[{ label: 'Income', color: series[0] }]}
          formatY={axis}
          formatTitle={(d) => formatMonth(d.key)}
          reference={avg > 0 ? { value: avg, label: `Avg ${money(avg, { compact: true, whole: true })}` } : undefined}
          accessibilityLabel="Monthly income for the last 12 months"
        />
        <DataTable
          columns={[{ label: 'Month' }, { label: 'Income' }, { label: 'vs average' }]}
          rows={[...months].reverse().map((m) => ({
            key: m.month,
            cells: [formatMonth(m.month, 'short') + ` '${m.month.slice(2, 4)}`, <MoneyCell key="i" cents={m.income} />, <MoneyDelta key="d" cents={m.income - avg} good="up" />],
          }))}
          caption={`Average of months with income: ${money(avg, { whole: true })}. This month is so far.`}
        />
      </ChartCard>

      <PeriodControl value={key} onChange={setKey} range={range} />
      <ChartCard title="Where does my income come from?">
        {current.incomeBySource.length === 0 ? (
          <Muted>{`No income recorded ${range.phrase}.`}</Muted>
        ) : (
          <HBarList
            items={current.incomeBySource.map((s, i) => ({
              key: s.key,
              label: s.label,
              value: s.amount,
              valueLabel: money(s.amount),
              color: series[i % series.length],
              caption: `${percent(shareOf(s.amount, current.income))} of income`,
            }))}
          />
        )}
      </ChartCard>
      <Takeaway>
        {change === null
          ? `You earned ${money(current.income, { whole: true })} ${range.phrase}; there's no income recorded for ${range.previous.phrase} to compare with.`
          : `You earned ${money(current.income, { whole: true })} ${range.phrase}, ${change === 0 ? 'the same as' : `${percent(Math.abs(change))} ${change > 0 ? 'more than' : 'less than'}`} ${range.previous.phrase} (${money(previous.income, { whole: true })}).`}
      </Takeaway>
    </>
  );
}

// ─── How much am I saving? ───────────────────────────────────────────────────

export function SavingsRateReport() {
  const router = useRouter();
  const money = useMoney();
  const percent = usePercent();
  const axis = useAxisMoney();
  const months = useTwelveMonths();
  const { key, setKey, range } = useRange();
  const stats = useDerived((d) => periodStats(d, range.from, range.to), [range.from, range.to]);
  const withIncome = months.filter((m) => m.income > 0);

  if (months.every((m) => m.income === 0 && m.spending === 0) && stats.transactionCount === 0) {
    return <EmptyState icon="shield" title="Nothing to measure yet" message="Your savings rate is income minus spending, as a share of income. Record both to see it." actionLabel="Add income" onAction={() => router.push({ pathname: '/transactions/edit', params: { type: 'income' } })} />;
  }

  const totalIncome = withIncome.reduce((s, m) => s + m.income, 0);
  const totalSaved = withIncome.reduce((s, m) => s + m.saved, 0);
  const avgRate = shareOf(totalSaved, totalIncome);
  const current = months[months.length - 1];

  return (
    <>
      <ChartCard title="How much did I keep each month?">
        <ColumnChart
          data={months.map((m) => ({ key: m.month, label: monthLabel(m.month, months.length), values: [m.saved] }))}
          series={[{ label: 'Saved', color: series[0] }]}
          formatY={axis}
          formatTitle={(d) => formatMonth(d.key)}
          highlightKey={current.month}
          accessibilityLabel="Income minus spending for each of the last 12 months"
        />
        <DataTable
          columns={[{ label: 'Month' }, { label: 'Saved', flex: 1.2 }, { label: 'Rate', flex: 0.7 }]}
          rows={[...months].reverse().map((m) => ({
            key: m.month,
            cells: [formatMonth(m.month, 'short') + ` '${m.month.slice(2, 4)}`, <MoneyDelta key="s" cents={m.saved} good="up" />, m.income > 0 ? percent(m.savingsRate) : '—'],
          }))}
          caption="Saved = income − spending. Rate is saved as a share of income. This month is so far."
        />
      </ChartCard>

      <PeriodControl value={key} onChange={setKey} range={range} />
      <ChartCard title="Where did the money I kept go?">
        <ListCard>
          <KeyValue label="Kept (income − spending)" hint={stats.income > 0 ? `${percent(stats.savingsRate)} of income` : undefined}>
            <Money cents={stats.saved} weight="semibold" signed tone="balance" />
          </KeyValue>
          <KeyValue label="Moved to savings accounts" hint="Net of withdrawals from savings">
            <Money cents={stats.toSavings} weight="medium" />
          </KeyValue>
          <KeyValue label="Invested">
            <Money cents={stats.investmentContributions} weight="medium" />
          </KeyValue>
          <KeyValue label="Debt payments" hint="Includes required payments">
            <Money cents={stats.debtPayments} weight="medium" />
          </KeyValue>
        </ListCard>
      </ChartCard>

      <Takeaway>
        {totalIncome > 0
          ? `Over the last 12 months you kept ${percent(avgRate)} of your income on average.${current.income > 0 ? ` This month so far it's ${percent(current.savingsRate)}, ${current.savingsRate > avgRate + 0.005 ? 'above' : current.savingsRate < avgRate - 0.005 ? 'below' : 'close to'} your average.` : ''}`
          : `No income was recorded in the last 12 months, so there's no savings rate to show yet.`}
      </Takeaway>
    </>
  );
}

