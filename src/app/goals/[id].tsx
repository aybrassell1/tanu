import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountRow } from '@/components/finance/Rows';
import { ContributionSheet, type ContributionMode } from '@/components/goals/ContributionSheet';
import { GoalStatusBadge, goalProjectionLine } from '@/components/goals/GoalCard';
import {
  Button,
  Card,
  EmptyState,
  GradientCard,
  IconButton,
  LineChart,
  ListCard,
  ListRow,
  Money,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  Stack,
  StatTile,
  Text,
  useOverlay,
} from '@/components/ui';
import { GOAL_KINDS } from '@/domain/catalog';
import { diffDays, formatDate, formatMonth, monthOf } from '@/domain/dates';
import { goalHistory, goalProgress } from '@/domain/goals';
import { balanceOn, indexLedger } from '@/domain/ledger';
import type { Goal } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, series as seriesColors, spacing } from '@/theme/tokens';

const onGradient = 'rgba(255,255,255,0.85)';

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [sheet, setSheet] = useState<ContributionMode | null>(null);

  const goal = data.goals.find((g) => g.id === id);
  if (!goal) {
    return (
      <Screen header={<NavHeader title="Goal" />}>
        <EmptyState icon="search" title="Goal not found" message="It may have been deleted." actionLabel="All goals" onAction={() => router.replace('/goals')} />
      </Screen>
    );
  }

  const index = indexLedger(data);
  const p = goalProgress(data, goal, today);
  const history = goalHistory(data, goal, today, 12);
  const pct = Math.round(p.ratio * 100);
  const isDebt = goal.kind === 'debt_payoff';
  const funded = goal.kind === 'savings' || goal.kind === 'custom';
  const contributions = data.goalContributions.filter((c) => c.goalId === goal.id).sort((a, b) => (a.date === b.date ? (a.createdAt < b.createdAt ? 1 : -1) : a.date < b.date ? 1 : -1));
  const projection = goalProjectionLine(p, money, today);

  const setCompleted = (completedAt: string | undefined) => {
    const previous: Goal = goal;
    const result = ledger.saveGoal({ ...goal, completedAt });
    if (!result.ok) return toast({ message: Object.values(result.errors)[0] ?? 'Could not update goal.', tone: 'error' });
    // saveGoal isn't recorded for ledger.undo, so restore the previous version directly.
    toast({ message: completedAt ? 'Goal marked complete' : 'Goal reopened', actionLabel: 'Undo', onAction: () => ledger.saveGoal(previous) });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete goal?',
      message: funded ? 'Its contribution history is removed too. The money stays in your accounts.' : 'Your accounts are not affected.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    if (router.canGoBack()) router.back();
    else router.replace('/goals');
    ledger.deleteGoal(goal.id);
    toast({ message: 'Goal deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const removeContribution = async (contributionId: string, label: string) => {
    const ok = await confirm({ title: 'Remove this entry?', message: `${label} will no longer count toward ${goal.name}.`, confirmLabel: 'Remove', destructive: true });
    if (!ok) return;
    ledger.deleteContribution(contributionId);
    toast({ message: 'Contribution removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen header={<NavHeader title={goal.name} right={<IconButton icon="edit-2" accessibilityLabel="Edit goal" onPress={() => router.push({ pathname: '/goals/edit', params: { id: goal.id } })} />} />}>
      <GradientCard style={{ gap: spacing.md }}>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" label={GOAL_KINDS[goal.kind].label} />
          {goal.completedAt && <Pill tone="glass" size="sm" icon="check" label="Completed" />}
        </Row>
        <View style={{ gap: 2 }}>
          <Text variant="small" color={onGradient}>
            {isDebt ? 'Paid off so far' : goal.kind === 'net_worth' ? 'Net worth now' : goal.kind === 'investment' ? 'Value now' : 'Saved so far'}
          </Text>
          <Money cents={p.current} variant="display" color={colors.onPrimary} />
          <Text variant="small" color={onGradient} tabular>
            {`of ${money(p.target)}`}
          </Text>
        </View>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" label={`${pct}% there`} />
          <Pill tone="glass" size="sm" label={p.remaining > 0 ? `${money(p.remaining, { whole: true })} to go` : 'Target reached'} />
          {isDebt && p.owed !== undefined && <Pill tone="glass" size="sm" label={`${money(p.owed, { whole: true })} still owed`} />}
        </Row>
      </GradientCard>

      <View style={{ gap: spacing.sm }}>
        <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
          <StatTile label="Monthly pace" icon="activity" value={<Money cents={p.monthlyRate} variant="h3" compact />} caption={diffDays(p.goal.startDate, today) < 90 ? 'Average since the goal started' : 'Average, last 3 months incl. this month'} />
          <StatTile
            label="Projected completion"
            icon="trending-up"
            value={<Text variant="h3">{p.status === 'complete' ? 'Done' : p.projectedDate ? formatMonth(monthOf(p.projectedDate)) : '—'}</Text>}
            caption={p.status === 'complete' ? 'Target reached' : p.projectedDate ? 'Projected at current pace' : 'Not enough recent progress'}
          />
        </Row>
        <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
          <StatTile
            label="Needed per month"
            icon="target"
            value={goal.targetDate && p.requiredMonthly !== null ? <Money cents={p.requiredMonthly} variant="h3" compact /> : <Text variant="h3">—</Text>}
            caption={goal.targetDate ? (p.remaining > 0 ? 'To finish by the target date' : 'Nothing left to add') : 'Set a target date to see this'}
          />
          <StatTile label="Target date" icon="calendar" value={<Text variant="h3">{goal.targetDate ? formatDate(goal.targetDate, 'short', today) : 'None'}</Text>} caption={<GoalStatusBadge progress={p} />} />
        </Row>
        {!!projection && (
          <Text variant="small" color={colors.textSecondary}>
            {projection}
          </Text>
        )}
      </View>

      <Section title="Am I getting closer?" subtitle="Progress at the end of each month">
        <Card>
          {history.length < 2 ? (
            <Text color={colors.textSecondary}>The chart fills in as this goal builds history over the coming months.</Text>
          ) : (
            <LineChart
              series={[
                { key: 'progress', label: 'Progress', color: seriesColors[0], area: true, points: history.map((h, i) => ({ x: i, y: h.value })) },
                { key: 'target', label: 'Target', color: seriesColors[1], dashed: true, points: history.map((_, i) => ({ x: i, y: p.target })) },
              ]}
              formatY={(v) => money(v, { compact: true, whole: true })}
              formatX={(i) => formatMonth(monthOf(history[i]?.date ?? today), 'short')}
              includeZero
              accessibilityLabel={`${goal.name}: ${money(p.current)} of ${money(p.target)}`}
            />
          )}
        </Card>
      </Section>

      {funded && (
        <>
          <Row gap={spacing.sm}>
            <Button label="Add money" icon="plus" style={{ flex: 1 }} onPress={() => setSheet('add')} />
            <Button label="Take out" icon="minus" variant="secondary" style={{ flex: 1 }} onPress={() => setSheet('remove')} disabled={p.current <= 0} />
          </Row>
          <Section title="Contribution history">
            {contributions.length === 0 ? (
              <EmptyState compact icon="plus-circle" title="No contributions yet" message={goal.kind === 'savings' ? 'Assign money from one of your accounts to this goal.' : 'Record progress toward this goal.'} actionLabel="Add money" onAction={() => setSheet('add')} />
            ) : (
              <ListCard>
                {contributions.map((c) => {
                  const account = c.accountId ? index.accounts.get(c.accountId) : undefined;
                  const label = `${money(c.amount, { signed: true })} on ${formatDate(c.date, 'short', today)}`;
                  return (
                    <View key={c.id} style={styles.contribution}>
                      <View style={{ flex: 1, gap: 2 }}>
                        <Row gap={spacing.sm}>
                          <Text weight="medium">{formatDate(c.date, 'short', today)}</Text>
                          {c.date > today && <Pill size="sm" tone="projected" label="Scheduled" />}
                        </Row>
                        <Text variant="small" color={colors.textTertiary} numberOfLines={2}>
                          {[account?.name ?? (c.accountId ? 'Missing account' : null), c.note].filter(Boolean).join(' · ') || (c.amount > 0 ? 'Added' : 'Taken out')}
                        </Text>
                      </View>
                      <Money cents={c.amount} signed tone="flow" weight="semibold" />
                      <IconButton icon="trash-2" size={32} variant="plain" accessibilityLabel={`Remove ${label}`} onPress={() => removeContribution(c.id, label)} />
                    </View>
                  );
                })}
              </ListCard>
            )}
          </Section>
        </>
      )}

      {(isDebt || goal.kind === 'investment') && (
        <Section title={isDebt ? 'Linked debts' : 'Linked accounts'}>
          {goal.linkedAccountIds.length === 0 ? (
            <EmptyState compact icon="link" title="No linked accounts" message="Link accounts so progress follows their balances." actionLabel="Edit goal" onAction={() => router.push({ pathname: '/goals/edit', params: { id: goal.id } })} />
          ) : (
            <ListCard>
              {goal.linkedAccountIds.map((accountId) => {
                const account = index.accounts.get(accountId);
                if (!account) return <ListRow key={accountId} title="Missing account" subtitle="This account was deleted" icon="alert-circle" iconColor={colors.textTertiary} />;
                return <AccountRow key={accountId} account={account} balance={balanceOn(index, accountId, today)} />;
              })}
            </ListCard>
          )}
        </Section>
      )}

      {goal.kind === 'net_worth' && (
        <ListCard>
          <ListRow title="Net worth details" subtitle="Everything you own minus everything you owe" icon="bar-chart-2" chevron onPress={() => router.push('/net-worth')} />
        </ListCard>
      )}

      {(!!goal.notes || goal.tags.length > 0) && (
        <Card variant="muted" style={{ gap: spacing.sm }}>
          {!!goal.notes && <Text color={colors.textSecondary}>{goal.notes}</Text>}
          {goal.tags.length > 0 && (
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {goal.tags.map((t) => (
                <Pill key={t} size="sm" tone="primary" label={`#${t}`} />
              ))}
            </Row>
          )}
        </Card>
      )}

      <Stack gap={spacing.sm}>
        {goal.completedAt ? (
          <Button label="Reopen goal" icon="rotate-ccw" variant="secondary" fullWidth onPress={() => setCompleted(undefined)} />
        ) : (
          <Button label="Mark complete" icon="check" variant="secondary" fullWidth onPress={() => setCompleted(today)} />
        )}
        <Button label="Delete goal" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>

      {funded && <ContributionSheet goal={goal} visible={sheet !== null} onClose={() => setSheet(null)} initialMode={sheet ?? 'add'} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  contribution: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
});
