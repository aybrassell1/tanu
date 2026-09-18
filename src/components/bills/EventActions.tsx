import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { EventRow } from '@/components/finance/Rows';
import { Button, DateField, IconButton, MoneyField, Sheet, Text, useOverlay } from '@/components/ui';
import { formatDate, minDate } from '@/domain/dates';
import type { ScheduledEvent } from '@/domain/schedule';
import type { Cents, ISODate, RecurringItem } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const isOpen = (e: ScheduledEvent) => e.status === 'upcoming' || e.status === 'overdue';

/** Where tapping an event leads. */
export function eventHref(e: ScheduledEvent) {
  switch (e.source) {
    case 'recurring':
      return `/bills/${e.sourceId}`;
    case 'debt':
      return `/accounts/${e.sourceId}`;
    case 'income':
      return `/income/${e.sourceId}`;
    case 'transaction':
      return `/transactions/${e.sourceId}`;
  }
}

/**
 * Pay / record / skip behaviour shared by Bills, Calendar and bill detail.
 * Render `sheet` once in the screen.
 */
export function useEventActions() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const [target, setTarget] = useState<ScheduledEvent | null>(null);
  const [visible, setVisible] = useState(false);

  const pay = (e: ScheduledEvent, overrides: { amount?: Cents; date?: ISODate } = {}) => {
    const result = ledger.payOccurrence(e.sourceId, e.date, { date: minDate(today, e.date), ...overrides });
    if (!result.ok) {
      toast({ message: Object.values(result.errors)[0] ?? 'Could not record that payment.', tone: 'error' });
      return false;
    }
    // Reverse precisely: the store's generic undo isn't set by saves.
    toast({ message: `${e.name} marked paid`, actionLabel: 'Undo', onAction: () => ledger.deleteTransaction(result.id) });
    return true;
  };

  const setSkipped = (e: ScheduledEvent, skipped: boolean) => {
    ledger.setOccurrenceSkipped(e.sourceId, e.date, skipped);
    toast({
      message: skipped ? `Skipped ${e.name} on ${formatDate(e.date, 'short', today)}` : `${e.name} is due again`,
      actionLabel: 'Undo',
      onAction: () => ledger.setOccurrenceSkipped(e.sourceId, e.date, !skipped),
    });
  };

  const openSheet = (e: ScheduledEvent) => {
    setTarget(e);
    setVisible(true);
  };

  const recurringItem = (e: ScheduledEvent): RecurringItem | undefined => (e.source === 'recurring' ? data.recurring.find((r) => r.id === e.sourceId) : undefined);

  /** Primary action for an open event (the row's button). */
  const act = (e: ScheduledEvent) => {
    switch (e.source) {
      case 'recurring':
        if (recurringItem(e)?.variable) openSheet(e);
        else pay(e);
        return;
      case 'debt':
        router.push({ pathname: '/quick-add', params: { mode: 'debt', toAccountId: e.sourceId } });
        return;
      case 'income':
        router.push({ pathname: '/quick-add', params: { mode: 'income', sourceId: e.sourceId, occurrenceDate: e.date } });
        return;
      case 'transaction':
        router.push(`/transactions/${e.sourceId}`);
    }
  };

  const actionLabel = (e: ScheduledEvent) => (e.source === 'transaction' ? 'View' : e.kind === 'income' ? 'Record' : 'Pay');

  const sheet = (
    <Sheet visible={visible} onClose={() => setVisible(false)} title={target ? `Pay ${target.name}` : 'Pay'} subtitle={target ? `Due ${formatDate(target.date, 'weekday', today)}` : undefined}>
      {target && (
        <PayForm
          key={target.key}
          event={target}
          today={today}
          estimateHint={recurringItem(target)?.variable ? `Estimated ${money(target.amount)}. Enter what you actually paid.` : undefined}
          onPay={(amount, date) => pay(target, { amount, date }) && setVisible(false)}
          onSkip={() => {
            setSkipped(target, true);
            setVisible(false);
          }}
        />
      )}
    </Sheet>
  );

  return { act, actionLabel, openSheet, pay, setSkipped, sheet, href: eventHref, isOpen };
}

function PayForm({ event, today, estimateHint, onPay, onSkip }: { event: ScheduledEvent; today: ISODate; estimateHint?: string; onPay: (amount: Cents, date: ISODate) => void; onSkip: () => void }) {
  const [amount, setAmount] = useState<Cents | undefined>(event.amount);
  const [date, setDate] = useState<ISODate>(minDate(today, event.date));
  const [error, setError] = useState<string>();
  return (
    <View style={{ gap: spacing.lg }}>
      <MoneyField label="Amount paid" value={amount} onChange={setAmount} hint={estimateHint} error={error} />
      <DateField label="Paid on" value={date} onChange={(d) => setDate(d ?? today)} shortcuts />
      <Button
        label="Mark paid"
        size="lg"
        fullWidth
        icon="check"
        onPress={() => {
          if (!amount || amount <= 0) return setError('Enter the amount you paid.');
          onPay(amount, date);
        }}
      />
      <View style={{ alignItems: 'center', gap: 4 }}>
        <Button label="Skip this one" variant="ghost" size="sm" onPress={onSkip} />
        <Text variant="caption" color={colors.textTertiary} align="center">
          Skipping marks this due date as not needed. Nothing is recorded.
        </Text>
      </View>
    </View>
  );
}

type EventLineProps = {
  event: ScheduledEvent;
  actions: ReturnType<typeof useEventActions>;
  compact?: boolean;
};

/** EventRow wired to shared actions, plus a sibling "more" button for recurring items (pay a different amount, skip). */
export function EventLine({ event, actions, compact }: EventLineProps) {
  const router = useRouter();
  const open = isOpen(event);
  const canMore = open && event.source === 'recurring';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.xs }}>
      <View style={{ flex: 1 }}>
        <EventRow
          event={event}
          compact={compact}
          onPress={() => router.push(eventHref(event))}
          onAction={open ? () => actions.act(event) : undefined}
          actionLabel={actions.actionLabel(event)}
        />
      </View>
      {canMore && <IconButton icon="more-vertical" variant="plain" size={30} accessibilityLabel={`More options for ${event.name}`} onPress={() => actions.openSheet(event)} />}
    </View>
  );
}
