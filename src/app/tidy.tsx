import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { categoryOptions } from '@/components/finance/Pickers';
import { Banner, Button, Card, EmptyState, ListRow, Money, NavHeader, Pill, Row, Screen, SelectSheet, Section, StatTile, Text, VisualTile, useOverlay } from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { categoryPath } from '@/domain/categories';
import { formatDate } from '@/domain/dates';
import { indexLedger } from '@/domain/ledger';
import { groupNeedsCategory, needsCategory, tidySummary, type TidyGroup } from '@/domain/merchants';
import type { ID } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

/**
 * Everything that never got a category, grouped by merchant, with the app's
 * best guess from your own history beside it. Four unfiled Adobe charges are
 * one decision, not four — and every decision is one undo away.
 */
export default function TidyScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const [picking, setPicking] = useState<TidyGroup | null>(null);

  const index = useMemo(() => indexLedger(data), [data]);
  const items = useMemo(() => needsCategory(data), [data]);
  const groups = useMemo(() => groupNeedsCategory(items), [items]);
  const totals = tidySummary(items);

  const nameOf = (id: ID) => categoryPath(index.categories, id);

  const file = (group: TidyGroup, categoryId: ID) => {
    const result = ledger.categorizeTransactions(group.items.map((i) => ({ id: i.transaction.id, categoryId })));
    if (!result.ok) return;
    const message = result.id > 1 ? `Filed ${result.id} × ${group.name} under ${nameOf(categoryId)}` : `Filed under ${nameOf(categoryId)}`;
    toast({ message, actionLabel: 'Undo', onAction: ledger.undo });
  };

  const fileEverySuggestion = () => {
    const assignments = groups.flatMap((g) => (g.suggestion?.categoryId ? g.items.map((i) => ({ id: i.transaction.id, categoryId: g.suggestion!.categoryId! })) : []));
    const result = ledger.categorizeTransactions(assignments);
    if (result.ok && result.id > 0) toast({ message: result.id === 1 ? 'Filed 1 transaction' : `Filed ${result.id} transactions`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen header={<NavHeader title="Tidy up" />}>
      {items.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title="Everything has a category"
          message="Spending and income are all filed, so reports and budgets count every dollar."
          actionLabel="Back to activity"
          actionIcon="arrow-left"
          onAction={() => router.push('/transactions')}
        />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Without a category" value={String(totals.total)} icon="help-circle" caption={groups.length === totals.total ? undefined : `${groups.length} merchants`} />
            <StatTile label="Filed from history" value={String(totals.suggested)} icon="zap" caption="Your own past answers" />
          </View>

          {totals.suggested > 0 ? (
            <Card style={{ gap: spacing.md }}>
              <Banner
                tone="primary"
                icon="zap"
                title={`${totals.suggested} can be filed from your history`}
                message="Each suggestion is the category you have used most for that merchant. Nothing is guessed from outside your own ledger."
              />
              <Button label={totals.suggested === 1 ? 'File it' : `File all ${totals.suggested}`} icon="check" size="lg" fullWidth onPress={fileEverySuggestion} />
            </Card>
          ) : (
            <Banner tone="muted" icon="info" title="Nothing to suggest yet" message="Once you have filed the same merchant a couple of times, the rest fill themselves in." />
          )}

          <Section title="Waiting for a category" subtitle={groups.length === 1 ? '1 merchant' : `${groups.length} merchants`}>
            {groups.map((group) => {
              const guess = group.suggestion?.categoryId;
              const newest = group.items[0].transaction;
              const span = group.items.length === 1 ? formatDate(newest.date, 'short', today) : `${group.items.length} since ${formatDate(group.earliest, 'short', today)}`;
              const habit = group.suggestion?.categories[group.kind];
              return (
                <Card key={group.key} style={{ gap: spacing.sm }}>
                  <ListRow
                    leading={guess ? <VisualTile emoji={categoryEmoji(guess) ?? undefined} /> : undefined}
                    icon={guess ? undefined : 'help-circle'}
                    title={group.name}
                    subtitle={`${span} · ${index.accounts.get(newest.accountId)?.name ?? 'Account'}`}
                    trailing={<Money cents={group.total} weight="semibold" />}
                    trailingCaption={group.items.length > 1 ? 'in total' : undefined}
                    onPress={() => router.push(`/transactions/${newest.id}`)}
                  />
                  {guess ? (
                    <Row>
                      <Button label={nameOf(guess)} icon="check" size="sm" onPress={() => file(group, guess)} style={{ flex: 1 }} />
                      <Button label="Other" variant="ghost" size="sm" onPress={() => setPicking(group)} />
                    </Row>
                  ) : (
                    <Row>
                      <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                        {habit
                          ? `Seen ${group.suggestion!.seen}×, filed differently each time.`
                          : group.items.length > 1
                            ? `No history to go on — pick one and all ${group.items.length} get it.`
                            : 'No history to go on for this one yet.'}
                      </Text>
                      <Pill icon="tag" label="Choose" size="sm" onPress={() => setPicking(group)} />
                    </Row>
                  )}
                </Card>
              );
            })}
          </Section>
        </>
      )}

      <SelectSheet
        visible={!!picking}
        onClose={() => setPicking(null)}
        title={picking ? picking.name : 'Category'}
        options={categoryOptions(data, picking?.kind ?? 'expense')}
        value={undefined}
        onSelect={(id) => {
          if (picking) file(picking, id);
          setPicking(null);
        }}
        searchable
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
});
