import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { MoneyDelta } from '@/components/reports/shared';
import type { ChangeType } from '@/components/scenarios/ChangeSheet';
import { Banner, EmptyState, IconButton, IconTile, ListCard, ListRow, NavHeader, Pill, Screen, Section, Text, useOverlay } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { compareScenario } from '@/domain/scenarios';
import { useDerived, useMoney } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const IDEAS: { label: string; name: string; add?: ChangeType; icon: IconName }[] = [
  { label: 'My income changes', name: 'Income changes', add: 'income_change', icon: 'briefcase' },
  { label: 'I move / rent changes', name: 'Moving', add: 'change_recurring', icon: 'home' },
  { label: 'Pay extra toward debt', name: 'Extra debt payments', add: 'extra_debt_payment', icon: 'trending-down' },
  { label: 'Buy a car', name: 'Buy a car', add: 'new_loan', icon: 'truck' },
  { label: 'Cancel a subscription', name: 'Cancel a subscription', add: 'cancel_recurring', icon: 'x-circle' },
  { label: 'Insurance changes', name: 'Insurance changes', add: 'change_recurring', icon: 'umbrella' },
  { label: 'Save more per paycheck', name: 'Save more', add: 'savings_contribution', icon: 'shield' },
  { label: 'Blank scenario', name: 'New scenario', icon: 'plus' },
];

export default function ScenariosScreen() {
  const router = useRouter();
  const money = useMoney();
  const { toast } = useOverlay();
  const rows = useDerived((d, today) =>
    [...d.scenarios]
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
      .map((s) => {
        const c = compareScenario(d, s.changes, s.horizonMonths, today);
        return { s, netWorth: c.scenario.end.netWorth - c.baseline.end.netWorth, surplus: c.scenario.averageSurplus - c.baseline.averageSurplus };
      }),
  );

  const create = (idea: (typeof IDEAS)[number]) => {
    const result = ledger.saveScenario({ name: idea.name, horizonMonths: 24, changes: [] });
    if (!result.ok) {
      toast({ message: Object.values(result.errors)[0] ?? 'Could not create the scenario.', tone: 'error' });
      return;
    }
    router.push({ pathname: `/scenarios/${result.id}`, params: idea.add ? { add: idea.add, fresh: '1' } : { fresh: '1' } });
  };
  const blank = IDEAS[IDEAS.length - 1];

  return (
    <Screen header={<NavHeader title="What-if scenarios" right={<IconButton icon="plus" accessibilityLabel="New scenario" onPress={() => create(blank)} />} />}>
      <Banner tone="projected" icon="git-branch" title="Scenarios are hypothetical. They never change your real data." message="Try a change and compare your projected future with and without it." />

      <Section title="Your scenarios">
        {rows.length === 0 ? (
          <EmptyState icon="git-branch" title="No scenarios yet" message="Start from an idea below, or begin with a blank scenario." actionLabel="Blank scenario" onAction={() => create(blank)} />
        ) : (
          <ListCard>
            {rows.map(({ s, netWorth, surplus }) => (
              <ListRow
                key={s.id}
                title={s.name}
                subtitle={`${s.changes.length} ${s.changes.length === 1 ? 'change' : 'changes'} · ${s.horizonMonths} months`}
                leading={<IconTile icon="git-branch" color={colors.projected} />}
                trailing={
                  <View style={{ alignItems: 'flex-end' }}>
                    <MoneyDelta cents={netWorth} good="up" compact />
                    <Text variant="caption" color={colors.textTertiary}>
                      net worth
                    </Text>
                  </View>
                }
                trailingCaption={`${money(surplus, { signed: true, whole: true })}/mo surplus`}
                chevron
                onPress={() => router.push(`/scenarios/${s.id}`)}
                accessibilityLabel={`${s.name}, net worth ${money(netWorth, { signed: true, whole: true })} at the end, average monthly surplus ${money(surplus, { signed: true, whole: true })}`}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="Start from an idea">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
          {IDEAS.map((idea) => (
            <Pill key={idea.label} label={idea.label} icon={idea.icon} tone={idea.add ? 'projected' : 'light'} onPress={() => create(idea)} />
          ))}
        </View>
      </Section>
    </Screen>
  );
}
