import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, EmptyState, ListRow, Money, NavHeader, Pill, Row, Screen, Section, StatTile, Text, VisualTile, useOverlay } from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { formatDate, relativePhrase } from '@/domain/dates';
import { frequencyLabel } from '@/domain/recurrence';
import { candidateTotals, detectRecurring, type RecurringCandidate } from '@/domain/recurringDetect';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

/**
 * Charges that arrive on a rhythm but aren't tracked yet. Until one is tracked
 * it is missing from the forecast and from what's left to spend, so this is the
 * shortest path from "I pay this" to "the app knows I pay this".
 */
export default function DetectedScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();

  const found = useMemo(() => detectRecurring(data, today), [data, today]);
  const totals = candidateTotals(found);
  const active = found.filter((c) => c.status === 'active');
  const lapsed = found.filter((c) => c.status === 'lapsed');

  const track = (c: RecurringCandidate) =>
    router.push({
      pathname: '/bills/edit',
      params: {
        kind: c.kind,
        name: c.name,
        payee: c.name,
        amount: String(c.amount),
        unit: c.frequency.unit,
        interval: String(c.frequency.interval),
        startDate: c.nextDate,
        accountId: c.accountId,
        variable: String(c.variable),
        essential: String(c.essential),
        ...(c.categoryId ? { categoryId: c.categoryId } : {}),
      },
    });

  const dismiss = (c: RecurringCandidate) => {
    ledger.ignoreRecurringSuggestion(c.key);
    toast({ message: `${c.name} won't be suggested again`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  const card = (c: RecurringCandidate) => (
    <Card key={c.key} style={{ gap: spacing.sm }}>
      <ListRow
        leading={c.categoryId ? <VisualTile emoji={categoryEmoji(c.categoryId) ?? undefined} /> : undefined}
        icon={c.categoryId ? undefined : 'repeat'}
        title={c.name}
        subtitle={`${frequencyLabel(c.frequency)} · ${c.charges} charges since ${formatDate(c.firstDate, 'short', today)}`}
        trailing={<Money cents={c.amount} weight="semibold" />}
        trailingCaption={c.variable ? 'typical' : undefined}
        onPress={() => router.push({ pathname: '/search', params: { q: c.name } })}
      />
      <Row>
        <Pill
          size="sm"
          icon={c.status === 'lapsed' ? 'alert-circle' : 'calendar'}
          label={c.status === 'lapsed' ? `Last one ${relativePhrase(c.lastDate, today)}` : `Next ${relativePhrase(c.nextDate, today)}`}
        />
        {c.variable && <Pill size="sm" icon="activity" label="Amount varies" />}
        {c.monthly !== c.amount && <Pill size="sm" label={`${money(c.monthly)}/mo`} />}
      </Row>
      <Row>
        <Button label={c.kind === 'subscription' ? 'Track as subscription' : 'Track as bill'} icon="plus" size="sm" onPress={() => track(c)} style={{ flex: 1 }} />
        <Button label="Not recurring" variant="ghost" size="sm" onPress={() => dismiss(c)} />
      </Row>
    </Card>
  );

  return (
    <Screen header={<NavHeader title="Found in your spending" />}>
      {found.length === 0 ? (
        <EmptyState
          icon="check-circle"
          title="Nothing new to track"
          message="Every charge that arrives on a rhythm is already tracked as a bill or subscription."
          actionLabel="Back to bills"
          actionIcon="arrow-left"
          onAction={() => router.push('/bills')}
        />
      ) : (
        <>
          <View style={styles.tiles}>
            <StatTile label="Look recurring" value={String(totals.count)} icon="repeat" caption={lapsed.length > 0 ? `${lapsed.length} may have stopped` : undefined} />
            <StatTile label="Not in your forecast" value={money(totals.monthly, { whole: true })} icon="alert-circle" caption="A month, if you track them" />
          </View>

          <Banner
            tone="primary"
            icon="info"
            title="These come from charges you already recorded"
            message="A bill only counts toward the forecast and what's left to spend once it is tracked. Tracking one opens the normal form with the fields filled in — nothing is saved until you do."
          />

          {active.length > 0 && <Section title="Still arriving">{active.map(card)}</Section>}

          {lapsed.length > 0 && (
            <Section title="Looks like it stopped" subtitle="Cancelled, or a payment that never came">
              {lapsed.map(card)}
            </Section>
          )}

          <Text variant="caption" color={colors.textTertiary}>
            A charge is offered here after three on a steady rhythm. Anything you dismiss stays dismissed, and clearing that list lives in Settings.
          </Text>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
});
