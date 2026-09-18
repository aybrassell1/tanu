import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { useEventActions } from '@/components/bills/EventActions';
import { nextDueDate, USAGE_OPTIONS } from '@/components/bills/helpers';
import { EventRow, TransactionRow } from '@/components/finance/Rows';
import { Button, Card, ChipSelect, EmptyState, IconButton, KeyValue, ListCard, Money, NavHeader, Pill, Row, Screen, Section, Stack, Text, useOverlay , VisualTile } from '@/components/ui';
import { recurringVisual } from '@/data/visuals';
import { icon } from '@/data/icons';
import { RECURRING_KINDS } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import { addDays, formatDate, parseISODate, relativeDay, relativePhrase } from '@/domain/dates';
import { indexLedger } from '@/domain/ledger';
import { sum } from '@/domain/money';
import { annualEquivalent, frequencyLabel, monthlyEquivalent } from '@/domain/recurrence';
import { scheduledEvents } from '@/domain/schedule';
import type { ID, RecurringItem } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

export default function BillDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const actions = useEventActions();
  const live = data.recurring.find((r) => r.id === id);
  // Keep rendering the last known item while the screen closes after a delete,
  // so it never flashes "not found".
  const last = useRef(live);
  const leaving = useRef(false);
  if (live) last.current = live;
  const item = live ?? (leaving.current ? last.current : undefined);

  const model = useMemo(() => {
    if (!item) return null;
    const upcoming = scheduledEvents(data, { from: addDays(today, -60), to: addDays(today, 365), today })
      .filter((e) => e.source === 'recurring' && e.sourceId === item.id && e.status !== 'paid')
      .slice(0, 6);
    const history = data.transactions.filter((t) => t.recurringId === item.id).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    const year = parseISODate(today).year;
    return {
      upcoming,
      history,
      paidThisYear: sum(history.filter((t) => parseISODate(t.date).year === year).map((t) => t.amount)),
      next: item.active ? nextDueDate(data, item, today) : null,
    };
  }, [data, item, today]);

  if (!item || !model) {
    return (
      <Screen header={<NavHeader title="Recurring payment" />}>
        <EmptyState icon="search" title="Recurring payment not found" message="It may have been deleted." actionLabel="Go to bills" onAction={() => router.replace('/bills')} />
      </Screen>
    );
  }

  const index = indexLedger(data);
  const kind = RECURRING_KINDS[item.kind];
  const account = index.accounts.get(item.accountId);
  const to = item.toAccountId ? index.accounts.get(item.toAccountId) : undefined;
  const spending = item.kind === 'bill' || item.kind === 'subscription';

  const save = (patch: Partial<RecurringItem>, message?: string, undoPatch?: Partial<RecurringItem>) => {
    const result = ledger.saveRecurring({ ...item, ...patch });
    if (!result.ok) return toast({ message: Object.values(result.errors)[0] ?? 'Could not save.', tone: 'error' });
    if (message) toast(undoPatch ? { message, actionLabel: 'Undo', onAction: () => ledger.saveRecurring({ ...item, ...undoPatch }) } : message);
  };

  const togglePaused = () =>
    save({ active: !item.active }, item.active ? `${item.name} paused` : `${item.name} resumed`, { active: item.active });

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${item.name}?`,
      message: 'The schedule is removed. Past payments stay as ordinary transactions.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    leaving.current = true;
    goBackOr(router, '/bills');
    ledger.deleteRecurring(item.id);
    toast({ message: 'Recurring payment deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const accountLink = (accountId: ID | undefined, name: string | undefined) => (
    <Text weight="medium" color={colors.primary} onPress={() => accountId && router.push(`/accounts/${accountId}`)} style={{ flexShrink: 1 }} align="right">
      {name ?? 'Missing account'}
    </Text>
  );

  const nextLabel = model.next ? (relativeDay(model.next, today) === formatDate(model.next, 'short', today) ? formatDate(model.next, 'weekday', today) : `${relativeDay(model.next, today)} · ${formatDate(model.next, 'short', today)}`) : item.active ? 'No more due dates' : 'Paused';

  return (
    <Screen header={<NavHeader title={item.name} right={<IconButton icon="edit-2" accessibilityLabel="Edit" onPress={() => router.push({ pathname: '/bills/edit', params: { id: item.id } })} />} />}>
      <Card variant="muted" padding={spacing.xl} style={styles.hero}>
        <VisualTile {...recurringVisual(item)} size={60} />
        <Money cents={item.amount} variant="display" color={item.active ? colors.ink : colors.textSecondary} />
        <Text color={colors.textSecondary}>{frequencyLabel(item.frequency)}</Text>
        <Row gap={spacing.sm} style={styles.pills}>
          <Pill tone="primary" icon={icon(kind.icon)} label={kind.label} />
          {item.autopay && <Pill tone="positive" icon="zap" label="Autopay" />}
          {item.variable && <Pill tone="projected" icon="trending-up" label="Variable (estimate)" />}
          {!item.active && <Pill tone="warning" icon="pause" label="Paused" />}
        </Row>
      </Card>

      <ListCard>
        <KeyValue label="Next due" value={nextLabel} />
        <KeyValue label="Paid from">{accountLink(account?.id, account?.name)}</KeyValue>
        {!spending && <KeyValue label="Pays to">{accountLink(to?.id, to?.name)}</KeyValue>}
        {!!item.categoryId && <KeyValue label="Category" value={categoryPath(index.categories, item.categoryId)} />}
        {!!item.payee && <KeyValue label="Payee" value={item.payee} />}
        <KeyValue label="Monthly equivalent" hint={item.variable ? 'Based on the estimate' : undefined}>
          <Money cents={monthlyEquivalent(item.amount, item.frequency)} weight="medium" />
        </KeyValue>
        <KeyValue label="Yearly cost">
          <Money cents={annualEquivalent(item.amount, item.frequency)} weight="medium" />
        </KeyValue>
        <KeyValue label="Starts" value={formatDate(item.startDate, 'medium', today)} />
        <KeyValue label="Ends" value={item.endDate ? formatDate(item.endDate, 'medium', today) : 'No end date'} />
        {spending && <KeyValue label="Type of spending" value={item.essential ? 'Essential' : 'Discretionary'} />}
      </ListCard>

      {(item.tags.length > 0 || !!item.notes) && (
        <Stack gap={spacing.sm}>
          {item.tags.length > 0 && (
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {item.tags.map((t) => (
                <Pill key={t} tone="primary" label={`#${t}`} onPress={() => router.push({ pathname: '/search', params: { q: `#${t}` } })} />
              ))}
            </Row>
          )}
          {!!item.notes && (
            <Card variant="muted">
              <Text color={colors.textSecondary}>{item.notes}</Text>
            </Card>
          )}
        </Stack>
      )}

      <Section title="Upcoming due dates" subtitle="Expected until you mark them paid">
        {!item.active ? (
          <EmptyState compact icon="pause-circle" title="Paused" message="Resume to see upcoming due dates." actionLabel="Resume" onAction={togglePaused} />
        ) : model.upcoming.length === 0 ? (
          <EmptyState compact icon="calendar" title="No upcoming due dates" message={item.endDate ? `This schedule ended ${formatDate(item.endDate, 'short', today)}.` : 'Everything in the next year is settled.'} actionLabel="Edit schedule" onAction={() => router.push({ pathname: '/bills/edit', params: { id: item.id } })} />
        ) : (
          <ListCard>
            {model.upcoming.map((e) => (
              <View key={e.key} style={styles.occurrence}>
                <View style={{ flex: 1 }}>
                  <EventRow event={e} onAction={() => actions.act(e)} />
                </View>
                {e.status === 'skipped' ? (
                  <Button label="Unskip" variant="ghost" size="sm" onPress={() => actions.setSkipped(e, false)} />
                ) : (
                  <Button label="Skip" variant="ghost" size="sm" onPress={() => actions.setSkipped(e, true)} />
                )}
              </View>
            ))}
          </ListCard>
        )}
      </Section>

      {item.kind === 'subscription' && (
        <Section title="Usage" subtitle="Helps spot subscriptions that might not be worth it">
          <Card style={{ gap: spacing.md }}>
            <ChipSelect options={USAGE_OPTIONS} value={item.usage} onChange={(usage) => save({ usage })} />
            <Row>
              <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                {item.lastUsed ? `Last used ${relativePhrase(item.lastUsed, today)}` : 'No usage logged yet'}
              </Text>
              <Button label="Used today" icon="check" variant="secondary" size="sm" disabled={item.lastUsed === today} onPress={() => save({ lastUsed: today }, 'Logged as used today')} />
            </Row>
          </Card>
        </Section>
      )}

      <Section title="Payment history" subtitle={model.history.length ? `${money(model.paidThisYear)} paid this year` : undefined}>
        {model.history.length === 0 ? (
          <EmptyState
            compact
            icon="clock"
            title="No payments recorded yet"
            message="Payments you mark as paid are linked here."
            actionLabel={model.upcoming.some((e) => e.status !== 'skipped') ? 'Pay next due date' : undefined}
            onAction={() => {
              const next = model.upcoming.find((e) => e.status !== 'skipped');
              if (next) actions.act(next);
            }}
          />
        ) : (
          <ListCard>
            {model.history.map((t) => (
              <TransactionRow key={t.id} tx={t} showDate />
            ))}
          </ListCard>
        )}
      </Section>

      <Stack gap={spacing.sm}>
        <Button label={item.active ? 'Pause' : 'Resume'} icon={item.active ? 'pause' : 'play'} variant="secondary" fullWidth onPress={togglePaused} />
        <Button label="Delete recurring payment" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>

      {actions.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  pills: { flexWrap: 'wrap', justifyContent: 'center', marginTop: spacing.xs },
  occurrence: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
