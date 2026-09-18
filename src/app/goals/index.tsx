import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { GoalCard } from '@/components/goals/GoalCard';
import { EmptyState, IconButton, NavHeader, Pill, Row, Screen, Segmented, Stack, Text } from '@/components/ui';
import { goalProgress } from '@/domain/goals';
import { useDerived, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

type Tab = 'active' | 'completed';

const QUICK_TEMPLATES = [
  { template: 'emergency', label: 'Emergency fund', icon: 'umbrella' },
  { template: 'debt_payoff', label: 'Pay off debt', icon: 'trending-down' },
  { template: 'vacation', label: 'Vacation', icon: 'map' },
  { template: 'net_worth', label: 'Reach a net worth', icon: 'bar-chart-2' },
] as const;

export default function GoalsScreen() {
  const router = useRouter();
  const today = useToday();
  const [tab, setTab] = useState<Tab>('active');

  const { active, completed } = useDerived((data, day) => {
    const all = data.goals.filter((g) => !g.archived).map((g) => goalProgress(data, g, day));
    return {
      active: all.filter((p) => p.status !== 'complete' && !p.goal.completedAt),
      completed: all.filter((p) => p.status === 'complete' || !!p.goal.completedAt),
    };
  });
  const list = tab === 'active' ? active : completed;
  const newGoal = (template?: string) => router.push(template ? { pathname: '/goals/edit', params: { template } } : '/goals/edit');

  return (
    <Screen header={<NavHeader title="Goals" right={<IconButton icon="plus" accessibilityLabel="New goal" onPress={() => newGoal()} />} />}>
      <Segmented
        items={[
          { value: 'active', label: `Active${active.length ? ` (${active.length})` : ''}` },
          { value: 'completed', label: `Completed${completed.length ? ` (${completed.length})` : ''}` },
        ]}
        value={tab}
        onChange={setTab}
      />

      {list.length === 0 ? (
        tab === 'active' ? (
          <Stack gap={spacing.lg}>
            <EmptyState icon="flag" title="No active goals" message="Save for something, pay down debt, or aim for a net worth. Progress updates from your accounts." actionLabel="Create a goal" onAction={() => newGoal()} />
            <View style={{ gap: spacing.sm }}>
              <Text variant="small" color={colors.textSecondary}>
                Start from a template
              </Text>
              <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
                {QUICK_TEMPLATES.map((t) => (
                  <Pill key={t.template} label={t.label} icon={t.icon} onPress={() => newGoal(t.template)} />
                ))}
              </Row>
            </View>
          </Stack>
        ) : (
          <EmptyState icon="award" title="No completed goals yet" message="Goals you finish or mark complete show up here." actionLabel="View active goals" onAction={() => setTab('active')} />
        )
      ) : (
        <Stack gap={spacing.md}>
          {list.map((p) => (
            <GoalCard key={p.goal.id} progress={p} today={today} />
          ))}
        </Stack>
      )}
    </Screen>
  );
}
