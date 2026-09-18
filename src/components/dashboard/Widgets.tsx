import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState, type ComponentType } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { EventRow, TransactionRow } from '@/components/finance/Rows';
import { GoalStatusBadge } from '@/components/goals/GoalCard';
import {
  Button,
  Card,
  IconButton,
  GradientCard,
  ListCard,
  ListRow,
  Money,
  Pill,
  ProgressBar,
  Section,
  Sparkline,
  SplitBar,
  StatTile,
  StatusBadge,
  Text,
  useOverlay,
} from '@/components/ui';
import { icon } from '@/data/icons';
import type { FinanceAlert } from '@/domain/alerts';
import type { BudgetLine } from '@/domain/budgets';
import { formatDate, formatMonth, monthOf } from '@/domain/dates';
import type { Forecast } from '@/domain/forecast';
import type { GoalProgress } from '@/domain/goals';
import type { HealthMetric } from '@/domain/health';
import { CheckupGrid } from '@/components/health/Checkup';
import type { MoneyMap, NetWorth } from '@/domain/position';
import type { PeriodStats } from '@/domain/reports';
import type { ScheduledEvent } from '@/domain/schedule';
import type { Cents, DashboardWidgetId, ISODate, Transaction } from '@/domain/types';
import { useMoney, usePercent } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, series, spacing, status } from '@/theme/tokens';

export const WIDGET_INFO: Record<DashboardWidgetId, { title: string; description: string }> = {
  overview: { title: 'Money overview', description: 'Available to spend, what you own and owe' },
  alerts: { title: 'Alerts & reminders', description: 'Past-due bills, budgets, promos and more' },
  health: { title: 'Money checkup', description: 'Emergency cushion, savings rate, debt and credit at a glance' },
  upcoming: { title: 'Upcoming', description: 'Bills, debt payments and paychecks in the next 2 weeks' },
  cashflow: { title: 'This month', description: 'Income, spending and savings so far' },
  cash: { title: 'Cash', description: 'Checking, savings, cash and emergency fund' },
  netWorth: { title: 'Net worth', description: 'Total and 12-month trend' },
  debt: { title: 'Debt', description: 'Cards, loans and payoff progress' },
  investments: { title: 'Investments', description: 'Value, gains and contributions' },
  goals: { title: 'Goals', description: 'Progress on active goals' },
  budgets: { title: 'Budgets', description: 'Categories closest to their limit' },
  forecast: { title: '30-day forecast', description: 'Projected spendable cash' },
  recent: { title: 'Recent transactions', description: 'The latest activity' },
};

export interface DashboardModel {
  today: ISODate;
  map: MoneyMap;
  alerts: FinanceAlert[];
  upcoming: ScheduledEvent[];
  month: PeriodStats;
  /** Null when nothing was tracked at this point last month. */
  lastMonthToDate: PeriodStats | null;
  cash: { checking: Cents; savings: Cents; cash: Cents; emergency: { current: Cents; target: Cents } };
  netWorthHistory: NetWorth[];
  /** Change excluding opening balances; `since` is set when tracking began within the last 12 months. */
  netWorthChange: { change: Cents; since: ISODate | null; hasData: boolean };
  debt: { total: Cents; creditCards: Cents; loans: Cents; monthChange: Cents; utilization: number; principalPaidYtd: Cents; payoffRatio: number | null; count: number };
  investments: { value: Cents; gain: Cents; contributionsThisMonth: Cents; count: number };
  goals: GoalProgress[];
  budgets: BudgetLine[];
  forecast: Forecast;
  recent: Transaction[];
  hasAccounts: boolean;
  checkup: { metrics: HealthMetric[]; strong: number; rated: number };
}

function Delta({ current, previous, invert, label }: { current: Cents; previous: Cents; invert?: boolean; label: string }) {
  const money = useMoney();
  const diff = current - previous;
  if (previous === 0 && current === 0) return null;
  const good = invert ? diff <= 0 : diff >= 0;
  return (
    <View style={styles.delta}>
      <Feather name={diff >= 0 ? 'arrow-up-right' : 'arrow-down-right'} size={12} color={good ? colors.positive : colors.negative} />
      <Text variant="caption" color={colors.textSecondary}>
        {money(Math.abs(diff), { whole: true })} {diff >= 0 ? 'more' : 'less'} {label}
      </Text>
    </View>
  );
}

export function OverviewWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  const p = m.map.position;
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: spacing.md }}>
      <GradientCard style={{ gap: spacing.md }}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text variant="small" weight="medium" color="rgba(255,255,255,0.85)">
                Available to spend
              </Text>
              <Money cents={p.available} variant="display" color={colors.onPrimary} />
              <Text variant="small" color="rgba(255,255,255,0.85)">
                {p.horizonReason === 'payday' ? `Until payday ${formatDate(p.horizon, 'weekday', m.today)}` : `Through ${formatDate(p.horizon, 'short', m.today)}`}
              </Text>
            </View>
            <IconButton icon={open ? 'chevron-up' : 'info'} variant="glass" size={34} accessibilityLabel={open ? 'Hide calculation' : 'How this is calculated'} onPress={() => setOpen(!open)} />
          </View>
          {open && (
            <View style={styles.equation}>
              <EquationRow label="Spendable cash" value={money(p.spendableCash)} />
              <EquationRow label={`Committed ${p.horizonLabel}`} value={`− ${money(p.committed)}`} />
              <EquationRow label="Set aside for goals" value={`− ${money(p.setAside)}`} />
              {p.reserved > 0 && <EquationRow label="Reserved for irregular costs" value={`− ${money(p.reserved)}`} />}
              {p.buffer > 0 && <EquationRow label="Safety buffer" value={`− ${money(p.buffer)}`} />}
              <View style={styles.equationRule} />
              <EquationRow label="Available" value={money(p.available)} strong />
              {p.expectedIncome > 0 && (
                <Text variant="caption" color="rgba(255,255,255,0.8)">
                  {money(p.expectedIncome)} of expected income isn't counted until it arrives.
                </Text>
              )}
            </View>
          )}
          <View style={styles.heroChips}>
            <Pill tone="glass" size="sm" icon="lock" label={`${money(p.committed, { whole: true })} committed`} onPress={() => setOpen(true)} />
            {p.setAside > 0 && <Pill tone="glass" size="sm" icon="shield" label={`${money(p.setAside, { whole: true })} set aside`} onPress={() => router.push('/savings')} />}
            {p.reserved > 0 && <Pill tone="glass" size="sm" icon="archive" label={`${money(p.reserved, { whole: true })} reserved`} onPress={() => router.push('/sinking')} />}
            <Pill tone="glass" size="sm" icon="activity" label="Forecast" onPress={() => router.push('/forecast')} />
          </View>
        </GradientCard>
      <View style={styles.tiles}>
        <StatTile label="You own" icon="plus-circle" value={<Money cents={m.map.own} variant="h3" compact />} onPress={() => router.push('/net-worth')} />
        <StatTile label="You owe" icon="minus-circle" value={<Money cents={m.map.owe} variant="h3" compact />} onPress={() => router.push('/debt')} />
        <StatTile label="Net worth" icon="bar-chart-2" value={<Money cents={m.map.netWorth} variant="h3" compact tone="balance" />} onPress={() => router.push('/net-worth')} />
      </View>
    </View>
  );
}

function EquationRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.equationRow}>
      <Text variant="small" color={colors.onPrimary} weight={strong ? 'semibold' : 'regular'} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="small" color={colors.onPrimary} weight={strong ? 'semibold' : 'medium'} tabular>
        {value}
      </Text>
    </View>
  );
}

const SEVERITY = {
  critical: { color: status.critical, icon: 'alert-triangle' },
  warning: { color: colors.warning, icon: 'alert-circle' },
  info: { color: colors.primary, icon: 'info' },
} as const;

export function AlertsWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  if (m.alerts.length === 0) {
    return (
      <Section title="Alerts">
        <Card variant="muted" style={styles.inline}>
          <Feather name="check-circle" size={18} color={colors.positive} />
          <Text color={colors.textSecondary}>Nothing needs your attention.</Text>
        </Card>
      </Section>
    );
  }
  const shown = expanded ? m.alerts : m.alerts.slice(0, 3);
  return (
    <Section title="Alerts" action={m.alerts.length > 3 ? (expanded ? 'Show less' : `All ${m.alerts.length}`) : undefined} onAction={() => setExpanded(!expanded)}>
      <ListCard>
        {shown.map((a) => (
          <ListRow
            key={a.id}
            dense
            title={a.title}
            subtitle={a.detail}
            leading={<Feather name={icon(a.icon, SEVERITY[a.severity].icon)} size={18} color={SEVERITY[a.severity].color} />}
            chevron={!!a.href}
            onPress={a.href ? () => router.push(a.href as never) : undefined}
          />
        ))}
      </ListCard>
    </Section>
  );
}

export function UpcomingWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const { toast } = useOverlay();
  const money = useMoney();
  const outflow = m.upcoming.filter((e) => e.kind !== 'income' && e.status === 'upcoming').reduce((s, e) => s + e.amount, 0);
  return (
    <Section title="Upcoming" subtitle={m.upcoming.length ? `${money(outflow)} going out in the next 14 days` : undefined} action="Calendar" onAction={() => router.push('/calendar')}>
      {m.upcoming.length === 0 ? (
        <Card variant="muted">
          <Text color={colors.textSecondary}>No bills, payments or paychecks in the next two weeks.</Text>
        </Card>
      ) : (
        <ListCard>
          {m.upcoming.slice(0, 6).map((e) => (
            <EventRow
              key={e.key}
              event={e}
              onPress={() => router.push((e.source === 'recurring' ? `/bills/${e.sourceId}` : e.source === 'income' ? `/income/${e.sourceId}` : e.source === 'debt' ? `/accounts/${e.sourceId}` : `/transactions/${e.sourceId}`) as never)}
              onAction={
                e.source === 'transaction'
                  ? undefined
                  : () => {
                      if (e.source === 'recurring') {
                        const r = ledger.payOccurrence(e.sourceId, e.date, { date: m.today < e.date ? m.today : e.date });
                        if (r.ok) toast({ message: `${e.name} marked paid`, actionLabel: 'Undo', onAction: ledger.undo });
                        else toast({ message: Object.values(r.errors)[0], tone: 'error' });
                      } else if (e.source === 'income') router.push({ pathname: '/quick-add', params: { mode: 'income', sourceId: e.sourceId, occurrenceDate: e.date } });
                      else router.push({ pathname: '/quick-add', params: { mode: 'debt', toAccountId: e.sourceId } });
                    }
              }
            />
          ))}
        </ListCard>
      )}
    </Section>
  );
}

export function CashflowWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const percent = usePercent();
  const s = m.month;
  return (
    <Section title={formatMonth(monthOf(m.today))} subtitle="So far this month" action="Review" onAction={() => router.push('/review')}>
      <Card style={{ gap: spacing.lg }}>
        <View style={styles.flowRow}>
          <FlowStat label="Earned" cents={s.income} color={colors.positive} />
          <FlowStat label="Spent" cents={s.spending} />
          <FlowStat label="Saved" cents={s.saved} caption={s.income > 0 ? `${percent(s.savingsRate)} of income` : undefined} />
        </View>
        <WhereItWent s={s} />
        <View style={styles.legendRow}>
          {m.lastMonthToDate && <DeltaPill label="Spending" current={s.spending} previous={m.lastMonthToDate.spending} lowerIsBetter />}
          {m.lastMonthToDate && <DeltaPill label="Income" current={s.income} previous={m.lastMonthToDate.income} />}
        </View>
      </Card>
    </Section>
  );
}

/** One bar showing where this month's income went. */
function WhereItWent({ s }: { s: PeriodStats }) {
  const base = Math.max(s.income, s.spending + s.debtPayments + s.investmentContributions + Math.max(0, s.toSavings));
  if (base <= 0) return null;
  const used = s.essential + s.discretionary + s.debtPayments + s.investmentContributions + Math.max(0, s.toSavings);
  const parts = [
    { key: 'essential', label: 'Essentials', value: s.essential, color: series[0] },
    { key: 'fun', label: 'Everything else', value: s.discretionary, color: series[1] },
    { key: 'debt', label: 'Debt payments', value: s.debtPayments, color: series[7] },
    { key: 'saved', label: 'To savings', value: Math.max(0, s.toSavings), color: series[2] },
    { key: 'invested', label: 'Invested', value: s.investmentContributions, color: series[6] },
    { key: 'left', label: 'Not yet used', value: Math.max(0, s.income - used), color: colors.track },
  ].filter((x) => x.value > 0);
  return (
    <View style={{ gap: 8 }}>
      <SplitBar segments={parts} height={14} />
      <View style={styles.legendRow}>
        {parts.map((x) => (
          <LegendDot key={x.key} color={x.color} label={x.label} cents={x.value} />
        ))}
      </View>
    </View>
  );
}

function DeltaPill({ label, current, previous, lowerIsBetter }: { label: string; current: Cents; previous: Cents; lowerIsBetter?: boolean }) {
  const money = useMoney();
  const diff = current - previous;
  if (previous === 0 || diff === 0) return null;
  const good = lowerIsBetter ? diff < 0 : diff > 0;
  return <Pill size="sm" tone={good ? 'positive' : 'warning'} icon={diff > 0 ? 'arrow-up-right' : 'arrow-down-right'} label={`${label} ${money(Math.abs(diff), { whole: true })} vs last month`} />;
}

function FlowStat({ label, cents, color, caption }: { label: string; cents: Cents; color?: string; caption?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="small" color={colors.textSecondary}>
        {label}
      </Text>
      <Money cents={cents} variant="h3" compact color={color} tone="balance" />
      {!!caption && (
        <Text variant="caption" color={colors.textTertiary}>
          {caption}
        </Text>
      )}
    </View>
  );
}

function LegendDot({ color, label, cents }: { color: string; label: string; cents: Cents }) {
  const money = useMoney();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption" color={colors.textSecondary}>
        {label} {money(cents, { whole: true })}
      </Text>
    </View>
  );
}

export function CashWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  const ef = m.cash.emergency;
  return (
    <Section title="Cash" action="Accounts" onAction={() => router.push('/money')}>
      <ListCard>
        <ListRow dense title="Checking" icon="credit-card" trailing={<Money cents={m.cash.checking} weight="semibold" />} />
        <ListRow dense title="Savings" icon="shield" iconColor={colors.positive} trailing={<Money cents={m.cash.savings} weight="semibold" />} onPress={() => router.push('/savings')} />
        <ListRow dense title="Cash on hand" icon="dollar-sign" iconColor={colors.textSecondary} trailing={<Money cents={m.cash.cash} weight="semibold" />} />
        <View style={{ paddingVertical: 12, gap: 8 }}>
          <View style={styles.flowRow}>
            <Text weight="medium" style={{ flex: 1 }}>
              Emergency fund
            </Text>
            <Text weight="semibold" tabular>
              {ef.target > 0 ? `${money(ef.current, { whole: true })} of ${money(ef.target, { whole: true })}` : 'Not set up'}
            </Text>
          </View>
          {ef.target > 0 ? (
            <ProgressBar value={ef.current / ef.target} color={colors.positive} accessibilityLabel="Emergency fund progress" />
          ) : (
            <Button label="Create emergency fund goal" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/goals/edit', params: { template: 'emergency' } })} />
          )}
        </View>
      </ListCard>
    </Section>
  );
}

export function NetWorthWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  const values = m.netWorthHistory.map((h) => h.netWorth);
  const last = values[values.length - 1] ?? 0;
  const { change, since } = m.netWorthChange;
  const period = since ? `since ${formatDate(since, 'short', m.today)}` : 'over 12 months';
  return (
    <Section title="Net worth" action="Details" onAction={() => router.push('/net-worth')}>
      <Card style={styles.inlineBetween} onPress={() => router.push('/net-worth')} accessibilityLabel="Net worth details">
        <View style={{ gap: 4, flex: 1 }}>
          <Money cents={last} variant="h2" tone="balance" />
          <Text variant="small" color={change === 0 ? colors.textSecondary : change > 0 ? colors.positive : colors.negative}>
            {change === 0 ? `No change ${period}` : `${change > 0 ? '▲' : '▼'} ${money(Math.abs(change), { whole: true })} ${period}`}
          </Text>
        </View>
        <Sparkline values={values} width={110} height={44} />
      </Card>
    </Section>
  );
}

export function DebtWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  const d = m.debt;
  if (d.count === 0) {
    return (
      <Section title="Debt">
        <Card variant="muted" style={styles.inline}>
          <Feather name="check-circle" size={18} color={colors.positive} />
          <Text color={colors.textSecondary}>No debts tracked.</Text>
        </Card>
      </Section>
    );
  }
  return (
    <Section title="Debt" action="Details" onAction={() => router.push('/debt')}>
      <Card style={{ gap: spacing.md }} onPress={() => router.push('/debt')} accessibilityLabel="Debt details">
        <View style={styles.flowRow}>
          <View style={{ flex: 1 }}>
            <Money cents={d.total} variant="h2" />
            <Text variant="small" color={d.monthChange <= 0 ? colors.positive : colors.negative}>
              {d.monthChange <= 0 ? `▼ ${money(-d.monthChange, { whole: true })} this month` : `▲ ${money(d.monthChange, { whole: true })} this month`}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end', gap: 2 }}>
            <Text variant="caption" color={colors.textTertiary}>
              Cards {money(d.creditCards, { whole: true })}
            </Text>
            <Text variant="caption" color={colors.textTertiary}>
              Loans {money(d.loans, { whole: true })}
            </Text>
            <Text variant="caption" color={colors.textTertiary}>
              {Math.round(d.utilization * 100)}% credit used
            </Text>
          </View>
        </View>
        {d.payoffRatio !== null && (
          <View style={{ gap: 6 }}>
            <ProgressBar value={d.payoffRatio} color={colors.positive} accessibilityLabel="Loan payoff progress" />
            <Text variant="caption" color={colors.textSecondary}>
              {Math.round(d.payoffRatio * 100)}% of original loan balances paid off · {money(d.principalPaidYtd, { whole: true })} principal this year
            </Text>
          </View>
        )}
      </Card>
    </Section>
  );
}

export function InvestmentsWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  const inv = m.investments;
  if (inv.count === 0) return null;
  return (
    <Section title="Investments" action="Details" onAction={() => router.push('/investments')}>
      <Card style={styles.inlineBetween} onPress={() => router.push('/investments')} accessibilityLabel="Investment details">
        <View style={{ gap: 4 }}>
          <Money cents={inv.value} variant="h2" />
          <Text variant="small" color={inv.gain >= 0 ? colors.positive : colors.negative}>
            {`${inv.gain >= 0 ? '+' : '−'}${money(Math.abs(inv.gain), { whole: true })} total gain`}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" color={colors.textTertiary}>
            Contributed this month
          </Text>
          <Money cents={inv.contributionsThisMonth} weight="semibold" />
        </View>
      </Card>
    </Section>
  );
}

export function GoalsWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  return (
    <Section title="Goals" action="All goals" onAction={() => router.push('/goals')}>
      {m.goals.length === 0 ? (
        <Card variant="muted" style={styles.inlineBetween}>
          <Text color={colors.textSecondary}>No active goals yet.</Text>
          <Button label="Add goal" size="sm" icon="plus" onPress={() => router.push('/goals/edit')} />
        </Card>
      ) : (
        <ListCard>
          {m.goals.slice(0, 3).map((g) => (
            <Pressable key={g.goal.id} onPress={() => router.push(`/goals/${g.goal.id}`)} style={{ paddingVertical: 12, gap: 8 }} accessibilityRole="button">
              <View style={styles.flowRow}>
                <Text weight="medium" style={{ flex: 1 }} numberOfLines={1}>
                  {g.goal.name}
                </Text>
                <GoalStatusBadge progress={g} />
              </View>
              <ProgressBar value={g.ratio} color={g.goal.color} />
              <Text variant="caption" color={colors.textSecondary}>
                {money(g.current, { whole: true })} of {money(g.target, { whole: true })}
                {g.projectedDate && g.status !== 'complete' ? ` · est. ${formatDate(g.projectedDate, 'short', m.today)}` : ''}
              </Text>
            </Pressable>
          ))}
        </ListCard>
      )}
    </Section>
  );
}

export function BudgetsWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const money = useMoney();
  if (m.budgets.length === 0) return null;
  return (
    <Section title="Budgets" action="All budgets" onAction={() => router.push('/budgets')}>
      <ListCard>
        {m.budgets.slice(0, 3).map((b) => (
          <Pressable key={b.budget.id} onPress={() => router.push('/budgets')} style={{ paddingVertical: 12, gap: 8 }} accessibilityRole="button">
            <View style={styles.flowRow}>
              <Text weight="medium" style={{ flex: 1 }}>
                {b.category.name}
              </Text>
              {b.state !== 'ok' && b.budget.mode === 'limit' && <StatusBadge tone={b.state === 'over' ? 'negative' : 'warning'} label={b.state === 'over' ? 'Over' : 'Close'} />}
              <Text variant="small" color={colors.textSecondary} tabular>
                {money(b.spent, { whole: true })} / {money(b.amount, { whole: true })}
              </Text>
            </View>
            <ProgressBar value={b.ratio} color={b.state === 'over' && b.budget.mode === 'limit' ? colors.negative : b.state === 'approaching' ? colors.warning : colors.primary} />
          </Pressable>
        ))}
      </ListCard>
    </Section>
  );
}

export function ForecastWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const f = m.forecast;
  if (f.accountIds.length === 0) return null;
  const values = [...f.history.slice(0, -1).map((h) => h.balance), ...f.days.map((d) => d.balance)];
  return (
    <Section title="30-day forecast" action="Forecast" onAction={() => router.push('/forecast')}>
      <Card style={{ gap: spacing.md }} onPress={() => router.push('/forecast')} accessibilityLabel="Cash-flow forecast">
        <View style={styles.flowRow}>
          <FlowStat label="Today (actual)" cents={f.start} />
          <FlowStat label="Lowest (projected)" cents={f.lowest.balance} caption={formatDate(f.lowest.date, 'short', m.today)} />
          <FlowStat label="In 30 days" cents={f.end} caption="Projected" />
        </View>
        <Sparkline values={values} width={300} height={48} color={f.lowest.balance < 0 ? colors.negative : colors.primary} />
      </Card>
    </Section>
  );
}

export function RecentWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  return (
    <Section title="Recent transactions" action="See all" onAction={() => router.push('/transactions')}>
      {m.recent.length === 0 ? (
        <Card variant="muted">
          <Text color={colors.textSecondary}>No transactions yet. Tap + to add one.</Text>
        </Card>
      ) : (
        <ListCard>
          {m.recent.map((t) => (
            <TransactionRow key={t.id} tx={t} showDate />
          ))}
        </ListCard>
      )}
    </Section>
  );
}

export function HealthWidget({ m }: { m: DashboardModel }) {
  const router = useRouter();
  const metrics = m.checkup.metrics.filter((x) => x.status !== 'na').slice(0, 6);
  if (metrics.length === 0) return null;
  return (
    <Section title="Money checkup" subtitle={`${m.checkup.strong} of ${m.checkup.rated} looking strong`} action="Details" onAction={() => router.push('/health')}>
      <CheckupGrid metrics={metrics} compact />
    </Section>
  );
}

export const WIDGETS: Record<DashboardWidgetId, ComponentType<{ m: DashboardModel }>> = {
  overview: OverviewWidget,
  health: HealthWidget,
  alerts: AlertsWidget,
  upcoming: UpcomingWidget,
  cashflow: CashflowWidget,
  cash: CashWidget,
  netWorth: NetWorthWidget,
  debt: DebtWidget,
  investments: InvestmentsWidget,
  goals: GoalsWidget,
  budgets: BudgetsWidget,
  forecast: ForecastWidget,
  recent: RecentWidget,
};

const styles = StyleSheet.create({
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  heroChips: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  equation: { gap: 6, backgroundColor: 'rgba(12,4,7,0.14)', borderRadius: radius.md, padding: spacing.md },
  equationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  equationRule: { height: 1, backgroundColor: 'rgba(255,255,255,0.35)', marginVertical: 2 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  inlineBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md },
  flowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  delta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendRow: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 2 },
});
