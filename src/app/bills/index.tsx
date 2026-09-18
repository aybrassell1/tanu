import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventLine, useEventActions } from '@/components/bills/EventActions';
import { RECURRING_GROUPS } from '@/components/bills/helpers';
import { RecurringRow } from '@/components/bills/RecurringRow';
import { Button, EmptyState, IconButton, ListCard, Money, NavHeader, Screen, Section, Segmented, StatTile, Text, useOverlay } from '@/components/ui';
import { addDays, monthOf } from '@/domain/dates';
import { sum } from '@/domain/money';
import { monthlyEquivalent } from '@/domain/recurrence';
import { monthlyObligations, openEvents, scheduledEvents, type ScheduledEvent } from '@/domain/schedule';
import type { RecurringItem } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Tab = 'upcoming' | 'all';

const monthlyTotal = (items: RecurringItem[]) => sum(items.map((r) => monthlyEquivalent(r.amount, r.frequency)));


export default function BillsScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const actions = useEventActions();
  const [tab, setTab] = useState<Tab>('upcoming');
  const [showPaid, setShowPaid] = useState(false);

  const model = useMemo(() => {
    const active = data.recurring.filter((r) => r.active);
    const outflow = (e: ScheduledEvent) => e.kind !== 'income';
    const next30 = openEvents(data, today, addDays(today, 30)).filter(outflow);
    const open = openEvents(data, today, addDays(today, 45), 45).filter(outflow);
    const weekEnd = addDays(today, 7);
    const groups = [
      { key: 'overdue', title: 'Past due', events: open.filter((e) => e.status === 'overdue') },
      { key: 'week', title: 'Next 7 days', events: open.filter((e) => e.status !== 'overdue' && e.date <= weekEnd) },
      { key: 'month', title: 'Later this month', events: open.filter((e) => e.status !== 'overdue' && e.date > weekEnd && monthOf(e.date) === monthOf(today)) },
      { key: 'later', title: 'Next month & beyond', events: open.filter((e) => e.status !== 'overdue' && e.date > weekEnd && monthOf(e.date) !== monthOf(today)) },
    ].filter((g) => g.events.length > 0);
    const recentlyPaid = scheduledEvents(data, { from: addDays(today, -14), to: today, today })
      .filter((e) => e.status === 'paid' && outflow(e))
      .reverse();
    return {
      active,
      paused: data.recurring.filter((r) => !r.active),
      monthly: monthlyObligations(data, today),
      next30: sum(next30.map((e) => e.amount)),
      next30Overdue: next30.some((e) => e.status === 'overdue'),
      autopay: active.filter((r) => r.autopay).length,
      groups,
      recentlyPaid,
    };
  }, [data, today]);

  const add = () => router.push('/bills/edit');

  return (
    <Screen header={<NavHeader title="Bills & recurring" right={<IconButton icon="plus" accessibilityLabel="Add recurring payment" onPress={add} />} />}>
      <View style={styles.tiles}>
        <StatTile label="Monthly" icon="file-text" value={<Money cents={model.monthly} variant="h3" whole />} caption="All recurring" />
        <StatTile label="Next 30d" icon="calendar" value={<Money cents={model.next30} variant="h3" whole />} caption={model.next30Overdue ? 'Expected · incl. past due' : 'Expected'} />
        <StatTile label="Autopay" icon="zap" value={`${model.autopay} of ${model.active.length}`} caption="Active items" />
      </View>

      <Segmented
        items={[
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'all', label: 'All recurring' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'upcoming' ? (
        <>
          {model.groups.length === 0 ? (
            <EmptyState
              icon="check-circle"
              title={data.recurring.length ? 'Nothing due soon' : 'No bills yet'}
              message={data.recurring.length ? 'No bills or payments are due in the next 45 days.' : 'Add rent, utilities, subscriptions and loan payments to see what is coming up.'}
              actionLabel="Add a bill"
              onAction={add}
            />
          ) : (
            model.groups.map((g) => (
              <Section key={g.key} title={g.title} subtitle={`${money(sum(g.events.map((e) => e.amount)))} expected`}>
                {g.key === 'overdue' && g.events.some((e) => e.autopay && e.source === 'recurring') && (
                  <Button
                    label="Confirm autopay charges"
                    icon="check-square"
                    variant="secondary"
                    fullWidth
                    onPress={() => {
                      const r = ledger.confirmAutopay(today);
                      if (r.ok && r.id > 0) toast({ message: `${r.id} autopay charge${r.id > 1 ? 's' : ''} recorded`, actionLabel: 'Undo', onAction: ledger.undo });
                    }}
                  />
                )}
                <ListCard>
                  {g.events.map((e) => (
                    <EventLine key={e.key} event={e} actions={actions} />
                  ))}
                </ListCard>
              </Section>
            ))
          )}

          <Section
            title="Recently paid"
            subtitle={model.recentlyPaid.length ? `${model.recentlyPaid.length} in the last 14 days` : 'Last 14 days'}
            action={showPaid ? 'Hide' : 'Show'}
            onAction={() => setShowPaid(!showPaid)}
          >
            {showPaid &&
              (model.recentlyPaid.length === 0 ? (
                <EmptyState compact icon="clock" title="No payments in the last two weeks" message="Paid bills show up here once you mark them paid." />
              ) : (
                <ListCard>
                  {model.recentlyPaid.map((e) => (
                    <EventLine key={e.key} event={e} actions={actions} />
                  ))}
                </ListCard>
              ))}
          </Section>
        </>
      ) : data.recurring.length === 0 ? (
        <EmptyState icon="repeat" title="No recurring payments" message="Track bills, subscriptions, debt payments and automatic transfers in one place." actionLabel="Add recurring payment" onAction={add} />
      ) : (
        <>
          {RECURRING_GROUPS.map((g) => {
            const items = model.active.filter((r) => g.kinds.includes(r.kind)).sort((a, b) => monthlyEquivalent(b.amount, b.frequency) - monthlyEquivalent(a.amount, a.frequency));
            if (items.length === 0) return null;
            return (
              <Section key={g.key} title={g.title} subtitle={`${money(monthlyTotal(items))} a month`}>
                <ListCard>
                  {items.map((r) => (
                    <RecurringRow key={r.id} item={r} />
                  ))}
                </ListCard>
              </Section>
            );
          })}
          {model.active.length === 0 && <EmptyState compact icon="pause-circle" title="Everything is paused" message="Resume an item below or add a new one." actionLabel="Add recurring payment" onAction={add} />}
          {model.paused.length > 0 && (
            <Section title="Paused" subtitle="Not counted in totals or forecasts">
              <ListCard>
                {model.paused.map((r) => (
                  <RecurringRow key={r.id} item={r} />
                ))}
              </ListCard>
            </Section>
          )}
        </>
      )}

      {tab === 'all' && (
        <Text variant="caption" color={colors.textTertiary} align="center">
          Card and loan due dates set on an account also appear in Upcoming.
        </Text>
      )}

      {actions.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.sm },
});
