import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ContributionSheet } from '@/components/goals/ContributionSheet';
import { GoalStatusBadge, goalProjectionLine } from '@/components/goals/GoalCard';
import { Banner, Button, Card, ColumnChart, EmptyState, GradientCard, IconTile, ListRow, Money, NavHeader, Pill, ProgressBar, Row, Screen, Section, SplitBar, Text, VisualTile } from '@/components/ui';
import { ACCOUNT_EMOJI, GOAL_EMOJI, GOAL_KIND_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { accountGroup } from '@/domain/catalog';
import { formatMonth, monthOf, relativePhrase } from '@/domain/dates';
import { allocationsByAccount, emergencyFund, goalProgress, type AccountAllocation } from '@/domain/goals';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { categoryAverages, monthlySeries } from '@/domain/reports';
import { accountReserves, activeFunds, fundsDueSoon, monthlySetAsideTotal, overReservedAccounts, setAsideThisMonth, totalReserved } from '@/domain/sinking';
import type { Account, Goal } from '@/domain/types';
import { useDerived, useMoney, usePercent, useToday } from '@/store/hooks';
import { colors, radius, series as seriesColors, spacing } from '@/theme/tokens';

const onGradient = 'rgba(255,255,255,0.85)';
const pct = (ratio: number) => `${Math.round(ratio * 100)}%`;

export default function SavingsScreen() {
  const router = useRouter();
  const money = useMoney();
  const today = useToday();
  const [sheetGoal, setSheetGoal] = useState<Goal | null>(null);

  const m = useDerived((data, day) => {
    const index = indexLedger(data);
    const allocations = allocationsByAccount(data, day);
    const savingsAccounts = data.accounts.filter((a) => !a.archived && accountGroup(a.type) === 'savings');
    const balances = new Map(data.accounts.map((a) => [a.id, balanceOn(index, a.id, day)]));
    const total = sum(savingsAccounts.map((a) => balances.get(a.id) ?? 0));
    const assigned = sum(savingsAccounts.map((a) => allocations.get(a.id)?.allocated ?? 0));

    const holding: { account: Account; balance: number; alloc: AccountAllocation | undefined }[] = [];
    for (const a of data.accounts) {
      const alloc = allocations.get(a.id);
      if ((accountGroup(a.type) === 'savings' && !a.archived) || alloc) holding.push({ account: a, balance: balances.get(a.id) ?? 0, alloc });
    }

    const ef = emergencyFund(data, day);
    const essential = categoryAverages(data, monthOf(day), 3).essential;
    const goals = data.goals.filter((g) => g.kind === 'savings' && !g.archived && !g.completedAt).map((g) => goalProgress(data, g, day));
    const months = monthlySeries(data, monthOf(day), 6, day);

    const allocatedCents = new Map([...allocations].map(([id, a]) => [id, a.allocated]));
    // Sinking reserves claim part of the same balances, so they are not free either.
    const accountReserved = accountReserves(data, day, allocatedCents);
    const reservedIn = (accountId: string) => accountReserved.get(accountId)?.reserved ?? 0;
    const reservedInSavings = sum(savingsAccounts.map((a) => reservedIn(a.id)));
    const reserves = {
      funds: activeFunds(data).length,
      total: totalReserved(data),
      plan: monthlySetAsideTotal(data),
      thisMonth: setAsideThisMonth(data, day),
      dueSoon: fundsDueSoon(data, day).slice(0, 3),
      over: overReservedAccounts(data, day, allocatedCents).length,
    };
    return { allocations, savingsAccounts, total, assigned, reservedInSavings, reservedIn, holding, ef, essential, goals, months, reserves, goalsById: new Map(data.goals.map((g) => [g.id, g])) };
  });

  const unassigned = m.total - m.assigned - m.reservedInSavings;

  return (
    <Screen header={<NavHeader title="Savings" />}>
      <GradientCard style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Text variant="small" weight="medium" color={onGradient}>
            In savings accounts
          </Text>
          <Money cents={m.total} variant="display" color={colors.onGradient} />
        </View>
        <View style={styles.heroSplit}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={onGradient}>
              Assigned to goals
            </Text>
            <Money cents={m.assigned} variant="h3" color={colors.onGradient} />
          </View>
          {m.reservedInSavings > 0 && (
            <View style={{ flex: 1 }}>
              <Text variant="caption" color={onGradient}>
                Reserved for costs
              </Text>
              <Money cents={m.reservedInSavings} variant="h3" color={colors.onGradient} />
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={onGradient}>
              Not assigned or reserved
            </Text>
            <Money cents={unassigned} variant="h3" color={colors.onGradient} />
          </View>
        </View>
        <View style={styles.heroNote}>
          <Text variant="small" color={colors.ink}>
            Goals and sinking funds label money that's already in your accounts, so nothing is counted twice.
          </Text>
        </View>
      </GradientCard>

      <Section title="Emergency fund" action={m.ef.goals.length === 1 ? 'View goal' : undefined} onAction={() => m.ef.goals[0] && router.push(`/goals/${m.ef.goals[0].id}`)}>
        {m.ef.goals.length === 0 ? (
          <Card variant="muted" style={{ gap: spacing.md }}>
            <Row>
              <VisualTile emoji="umbrella" />
              <Text color={colors.textSecondary} style={{ flex: 1 }}>
                An emergency fund goal sets aside money for unexpected costs.
              </Text>
            </Row>
            <Button label="Create emergency fund goal" icon="plus" size="sm" onPress={() => router.push({ pathname: '/goals/edit', params: { template: 'emergency' } })} />
          </Card>
        ) : (
          <Card style={{ gap: spacing.sm }}>
            <Row>
              <Text weight="medium" style={{ flex: 1 }}>
                {m.ef.target > 0 ? `${pct(Math.min(1, m.ef.current / m.ef.target))} of target` : 'No target set'}
              </Text>
              <Text weight="semibold" tabular>
                {`${money(m.ef.current, { whole: true })} of ${money(m.ef.target, { whole: true })}`}
              </Text>
            </Row>
            <ProgressBar value={m.ef.target > 0 ? m.ef.current / m.ef.target : 0} color={colors.positive} accessibilityLabel="Emergency fund progress" />
            {m.essential > 0 && (
              <Text variant="small" color={colors.textSecondary}>
                {`Covers about ${formatMonthsCovered(m.ef.current / m.essential)} of essential spending (${money(m.essential, { whole: true })}/mo, 3-month average)`}
              </Text>
            )}
          </Card>
        )}
      </Section>

      <Section title="Where your savings are" subtitle="How each account's balance is split across goals">
        {m.holding.length === 0 ? (
          <EmptyState compact icon="shield" title="No savings accounts yet" message="Add a savings account to start setting money aside for goals." actionLabel="Add savings account" onAction={() => router.push({ pathname: '/accounts/edit', params: { type: 'savings' } })} />
        ) : (
          m.holding.map(({ account, balance, alloc }) => {
            const byGoal = alloc?.byGoal.filter((g) => g.amount !== 0) ?? [];
            const reserved = m.reservedIn(account.id);
            const free = balance - (alloc?.allocated ?? 0) - reserved;
            const claims = [alloc ? `${money(alloc.allocated, { whole: true })} assigned` : null, reserved > 0 ? `${money(reserved, { whole: true })} reserved` : null].filter(Boolean);
            return (
              <Card key={account.id} style={{ gap: spacing.sm }} padding={spacing.lg}>
                <ListRow
                  dense
                  title={account.name}
                  subtitle={claims.length ? claims.join(' · ') : 'Nothing assigned'}
                  leading={<VisualTile emoji={ACCOUNT_EMOJI[account.type]} tint={`${account.color}1F`} size={34} />}
                  trailing={<Money cents={balance} weight="semibold" tone="balance" />}
                  chevron
                  onPress={() => router.push(`/accounts/${account.id}`)}
                />
                <SplitBar
                  height={10}
                  segments={[
                    ...byGoal.map((g) => ({ key: g.goalId, value: g.amount, color: m.goalsById.get(g.goalId)?.color ?? colors.primary })),
                    { key: 'reserved', value: reserved, color: colors.borderStrong },
                    { key: 'unassigned', value: Math.max(0, free), color: colors.track },
                  ]}
                />
                <View style={{ gap: 4 }}>
                  {byGoal.map((g) => (
                    <LegendLine key={g.goalId} color={m.goalsById.get(g.goalId)?.color ?? colors.primary} label={m.goalsById.get(g.goalId)?.name ?? 'Goal'} value={money(g.amount)} />
                  ))}
                  {reserved > 0 && <LegendLine color={colors.borderStrong} label="Reserved for irregular costs" value={money(reserved)} />}
                  <LegendLine color={colors.track} label="Not assigned or reserved" value={money(free)} outlined />
                </View>
                {free < 0 && (
                  <Banner
                    tone="warning"
                    icon="alert-circle"
                    title="More is claimed than this account holds"
                    message={`Goals and funds claim ${money((alloc?.allocated ?? 0) + reserved)} here, but the balance is ${money(balance)}. Take money out of a goal or fund, or update the balance.`}
                  />
                )}
              </Card>
            );
          })
        )}
      </Section>

      <Section title="Reserved for irregular costs" subtitle="Sinking funds for costs that don't arrive monthly" action={m.reserves.funds > 0 ? 'All funds' : undefined} onAction={() => router.push('/sinking')}>
        {m.reserves.funds === 0 ? (
          <EmptyState
            compact
            icon="archive"
            title="No sinking funds yet"
            message="Set money aside each month for car registration, insurance or the holidays, so they never land as a surprise."
            actionLabel="Start a fund"
            onAction={() => router.push('/sinking/edit')}
          />
        ) : (
          <Card style={{ gap: spacing.sm }}>
            <Row>
              <VisualTile emoji="money-bag" size={34} />
              <View style={{ flex: 1 }}>
                <Text weight="medium">{`${money(m.reserves.total, { whole: true })} reserved across ${m.reserves.funds} ${m.reserves.funds === 1 ? 'fund' : 'funds'}`}</Text>
                <Text variant="small" color={colors.textSecondary}>
                  {`${money(m.reserves.thisMonth, { whole: true })} of a ${money(m.reserves.plan, { whole: true })} plan set aside this month`}
                </Text>
              </View>
            </Row>
            <ProgressBar
              value={m.reserves.plan > 0 ? m.reserves.thisMonth / m.reserves.plan : 0}
              color={colors.primary}
              accessibilityLabel="Share of this month's planned set-aside recorded"
            />
            {m.reserves.dueSoon.map((s) => (
              <Text key={s.fund.id} variant="caption" color={s.overdue ? colors.negative : colors.textTertiary}>
                {`${s.fund.name} · due ${s.fund.dueDate ? relativePhrase(s.fund.dueDate, today) : 'soon'}${s.shortfall > 0 ? ` · ${money(s.shortfall)} short` : ' · fully funded'}`}
              </Text>
            ))}
            {m.reserves.over > 0 && (
              <Banner
                tone="warning"
                icon="alert-circle"
                title="More is reserved than an account holds"
                message="Funds and goals together claim more than the balance. Open Sinking funds to free some up."
              />
            )}
            <Text variant="caption" color={colors.textTertiary}>
              A reserve labels money you already have — nothing moves. Reserves held in a spendable account lower what's available to spend.
            </Text>
          </Card>
        )}
      </Section>

      <Section title="Savings goals" action="All goals" onAction={() => router.push('/goals')}>
        {m.goals.length === 0 ? (
          <EmptyState compact icon="flag" title="No savings goals yet" message="Give your savings a purpose, like a vacation or a move." actionLabel="Create a goal" onAction={() => router.push('/goals/edit')} />
        ) : (
          m.goals.map((p) => (
            <Card key={p.goal.id} style={{ gap: spacing.md }}>
              <Pressable onPress={() => router.push(`/goals/${p.goal.id}`)} accessibilityRole="button" accessibilityLabel={`${p.goal.name}, ${pct(p.ratio)} complete`} style={({ pressed }) => [{ gap: spacing.sm }, pressed && { opacity: 0.7 }]}>
                <Row>
                  <VisualTile emoji={p.goal.template !== 'custom' ? GOAL_EMOJI[p.goal.template] : GOAL_KIND_EMOJI[p.goal.kind]} tint={`${p.goal.color}1A`} size={34} />
                  <Text weight="semibold" numberOfLines={1} style={{ flex: 1 }}>
                    {p.goal.name}
                  </Text>
                  <GoalStatusBadge progress={p} />
                </Row>
                <ProgressBar value={p.ratio} color={p.goal.color} accessibilityLabel={`${pct(p.ratio)} of target`} />
                <Text variant="small" weight="medium" tabular>
                  {`${money(p.current, { whole: true })} of ${money(p.target, { whole: true })}`}
                </Text>
                {!!goalProjectionLine(p, money, today) && (
                  <Text variant="caption" color={colors.textTertiary}>
                    {goalProjectionLine(p, money, today)}
                  </Text>
                )}
              </Pressable>
              <Button label="Add money" icon="plus" size="sm" variant="secondary" onPress={() => setSheetGoal(p.goal)} />
            </Card>
          ))
        )}
      </Section>

      <SavingRate months={m.months} />

      <ContributionSheet goal={sheetGoal} visible={!!sheetGoal} onClose={() => setSheetGoal(null)} />
    </Screen>
  );
}

function formatMonthsCovered(months: number) {
  if (months < 1) return 'less than a month';
  const rounded = months < 10 ? Math.round(months * 10) / 10 : Math.round(months);
  return `${rounded} ${rounded === 1 ? 'month' : 'months'}`;
}

function LegendLine({ color, label, value, outlined }: { color: string; label: string; value: string; outlined?: boolean }) {
  return (
    <View style={styles.legendLine}>
      <View style={[styles.swatch, { backgroundColor: color }, outlined && { borderWidth: 1, borderColor: colors.borderStrong }]} />
      <Text variant="small" color={colors.textSecondary} numberOfLines={1} style={{ flex: 1 }}>
        {label}
      </Text>
      <Text variant="small" weight="medium" tabular>
        {value}
      </Text>
    </View>
  );
}

type MonthRow = ReturnType<typeof monthlySeries>[number];

function SavingRate({ months }: { months: MonthRow[] }) {
  const router = useRouter();
  const money = useMoney();
  const pct = usePercent();
  const totalIncome = sum(months.map((x) => x.income));
  const totalSpending = sum(months.map((x) => x.spending));
  const current = months[months.length - 1];

  if (totalIncome === 0 && totalSpending === 0) {
    return (
      <Section title="How much am I saving?">
        <EmptyState compact icon="bar-chart-2" title="No income or spending yet" message="Record income and spending to see how much you keep each month." actionLabel="Add a transaction" onAction={() => router.push('/quick-add')} />
      </Section>
    );
  }

  const avgRate = totalIncome > 0 ? sum(months.map((x) => x.saved)) / totalIncome : null;
  const rateText = (x: MonthRow) => (x.income > 0 ? pct(x.savingsRate) : '—');
  let sentence: string;
  if (current.income <= 0) sentence = 'No income recorded yet this month, so there is no savings rate to compare.';
  else if (avgRate === null) sentence = `So far this month you've kept ${pct(current.savingsRate)} of your income.`;
  else {
    const diff = Math.round(current.savingsRate * 100) - Math.round(avgRate * 100);
    sentence = `So far this month you've kept ${pct(current.savingsRate)} of your income, ${diff === 0 ? 'the same as' : `${Math.abs(diff)} points ${diff > 0 ? 'above' : 'below'}`} your 6-month average of ${pct(avgRate)}.`;
  }

  return (
    <Section title="How much am I saving?" subtitle="Income minus spending each month">
      <Card style={{ gap: spacing.sm }}>
        <ColumnChart
          data={months.map((x) => ({ key: x.month, label: formatMonth(x.month, 'short'), values: [x.saved] }))}
          series={[{ label: 'Saved', color: seriesColors[0] }]}
          highlightKey={current.month}
          formatY={(v) => money(v, { compact: true, whole: true })}
          formatTitle={(d) => {
            const row = months.find((x) => x.month === d.key);
            return `${formatMonth(d.key)}${row ? ` · ${rateText(row)} saved` : ''}`;
          }}
          accessibilityLabel="Money saved in each of the last 6 months"
        />
        <View style={styles.rateRow}>
          {months.map((x) => (
            <Text key={x.month} variant="caption" color={x.month === current.month ? colors.ink : colors.textTertiary} align="center" style={{ flex: 1 }} tabular>
              {rateText(x)}
            </Text>
          ))}
        </View>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill size="sm" tone="muted" label="Savings rate = saved ÷ income" />
          <Pill size="sm" tone="light" label="This month is partial" />
        </Row>
        <Text variant="small" color={colors.textSecondary}>
          {sentence}
        </Text>
      </Card>
    </Section>
  );
}

const styles = StyleSheet.create({
  heroSplit: { flexDirection: 'row', gap: spacing.md, backgroundColor: 'rgba(12,4,7,0.12)', borderRadius: radius.md, padding: spacing.md },
  // Dark text on a light strip: the gradient fades to sky blue here, where white text loses contrast.
  heroNote: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  legendLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  // Matches the chart plot area (y-axis labels on the left).
  rateRow: { flexDirection: 'row', marginLeft: 46, marginRight: 8 },
});
