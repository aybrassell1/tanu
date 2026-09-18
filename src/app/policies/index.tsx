import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { PolicyRow } from '@/components/policies/PolicyParts';
import { Banner, EmptyState, IconButton, ListCard, ListRow, Money, NavHeader, Screen, Section, StatTile, Text, VisualTile } from '@/components/ui';
import { isWarranty, POLICY_KINDS, policySummary, suggestedPolicies } from '@/domain/policies';
import type { Policy } from '@/domain/types';
import { useDerived, useMoney, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export default function PoliciesScreen() {
  const router = useRouter();
  const today = useToday();
  const money = useMoney();
  const model = useDerived((data, day) => ({
    summary: policySummary(data, day),
    suggestions: suggestedPolicies(data),
    total: data.policies.filter((p) => !p.archived).length,
  }));

  const { summary, suggestions } = model;
  const add = (kind?: string) => router.push(kind ? { pathname: '/policies/edit', params: { kind } } : '/policies/edit');
  const open = (p: Policy) => router.push(`/policies/${p.id}`);
  const header = <NavHeader title="Insurance & warranties" right={<IconButton icon="plus" accessibilityLabel="Add cover" onPress={() => add()} />} />;

  if (model.total === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="shield"
          title="No cover recorded yet"
          message="Keep your policies and warranties in one place: renewal dates, what you pay, and what you claimed."
          actionLabel="Add a policy"
          onAction={() => add()}
        />
        {suggestions.length > 0 && <Suggestions suggestions={suggestions} onAdd={add} />}
      </Screen>
    );
  }

  const insurance = [...summary.active, ...summary.expiringSoon, ...summary.undated].filter((p) => !isWarranty(p.kind));
  const warranties = [...summary.active, ...summary.expiringSoon, ...summary.undated].filter((p) => isWarranty(p.kind));

  return (
    <Screen header={header}>
      <View style={styles.tiles}>
        <StatTile label="Premiums" icon="repeat" value={<Money cents={summary.yearlyPremiums} variant="h3" compact />} caption="Per year, current cover" />
        <StatTile label="Coverage" icon="shield" value={<Money cents={summary.totalCoverage} variant="h3" compact />} caption="Limits you recorded" />
        <StatTile
          label="In force"
          icon="check-circle"
          value={<Text variant="h3">{`${summary.active.length + summary.expiringSoon.length + summary.undated.length}`}</Text>}
          caption={summary.expired.length > 0 ? `${summary.expired.length} expired` : 'Nothing expired'}
        />
      </View>

      {summary.expiringSoon.length > 0 && (
        <Banner
          tone="warning"
          icon="clock"
          title={`${summary.expiringSoon.length} ${summary.expiringSoon.length === 1 ? 'policy ends' : 'policies end'} within 60 days`}
          message={summary.expiringSoon.map((p) => p.name).join(', ')}
        />
      )}

      {summary.claims.outstanding > 0 && (
        <Banner tone="primary" icon="file-text" title={`${money(summary.claims.outstanding)} claimed and not yet reimbursed`} message={summary.claims.open === 1 ? '1 open claim.' : `${summary.claims.open} open claims.`} />
      )}

      <Section title="Insurance" subtitle={insurance.length ? `${insurance.length} recorded` : undefined}>
        {insurance.length === 0 ? (
          <EmptyState compact icon="shield" title="No insurance recorded" message="Auto, renters, health, life — whatever you pay for." actionLabel="Add insurance" onAction={() => add('auto')} />
        ) : (
          <ListCard>
            {insurance.map((p) => (
              <PolicyRow key={p.id} policy={p} today={today} onPress={() => open(p)} />
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="Warranties" subtitle={warranties.length ? `${warranties.length} recorded` : undefined}>
        {warranties.length === 0 ? (
          <EmptyState compact icon="file-text" title="No warranties recorded" message="Track what still has cover on it and when that cover runs out." actionLabel="Add a warranty" onAction={() => add('warranty')} />
        ) : (
          <ListCard>
            {warranties.map((p) => (
              <PolicyRow key={p.id} policy={p} today={today} onPress={() => open(p)} />
            ))}
          </ListCard>
        )}
      </Section>

      {summary.byKind.length > 1 && (
        <Section title="What does each kind cost per year?">
          <ListCard>
            {summary.byKind.map((k) => (
              <ListRow
                key={k.kind}
                title={POLICY_KINDS[k.kind].label}
                subtitle={`${k.count} ${k.count === 1 ? 'policy' : 'policies'}`}
                leading={<VisualTile emoji={POLICY_KINDS[k.kind].emoji} size={32} />}
                dense
                trailing={<Money cents={k.yearly} weight="semibold" />}
                trailingCaption={k.coverage > 0 ? `${money(k.coverage, { compact: true, whole: true })} cover` : undefined}
              />
            ))}
          </ListCard>
        </Section>
      )}

      {summary.expired.length > 0 && (
        <Section title="Expired" subtitle="Kept for your records">
          <ListCard>
            {summary.expired.map((p) => (
              <PolicyRow key={p.id} policy={p} today={today} onPress={() => open(p)} />
            ))}
          </ListCard>
        </Section>
      )}

      {suggestions.length > 0 && <Suggestions suggestions={suggestions} onAdd={add} />}
    </Screen>
  );
}

function Suggestions({ suggestions, onAdd }: { suggestions: ReturnType<typeof suggestedPolicies>; onAdd: (kind: string) => void }) {
  return (
    <Section title="Not recorded yet" subtitle="Based on what is already in your ledger">
      <ListCard>
        {suggestions.map((s) => (
          <ListRow
            key={s.key}
            title={s.title}
            subtitle={s.reason}
            leading={<VisualTile emoji={POLICY_KINDS[s.kind].emoji} />}
            chevron
            onPress={() => onAdd(s.kind)}
            accessibilityLabel={`${s.title}. ${s.reason} Add ${POLICY_KINDS[s.kind].label} cover.`}
          />
        ))}
      </ListCard>
      <Text variant="caption" color={colors.textTertiary}>
        These only point out what is missing from your records. They are not advice about what to buy.
      </Text>
    </Section>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
