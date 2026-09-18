import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { TransactionRow } from '@/components/finance/Rows';
import { DIRECTION_LABEL, IOU_EMOJI } from '@/components/ious/IouRow';
import { RepaymentSheet } from '@/components/ious/RepaymentSheet';
import {
  Banner,
  Button,
  Card,
  EmptyState,
  GradientCard,
  IconButton,
  KeyValue,
  ListCard,
  Money,
  NavHeader,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  Stack,
  Text,
  VisualTile,
  useOverlay,
} from '@/components/ui';
import { formatDate } from '@/domain/dates';
import { daysOutstanding, iouBalance, isOverdue, moneyMovePlan, relatedTransactions } from '@/domain/ious';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';



export default function IouDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [sheet, setSheet] = useState<'repay' | 'settle' | null>(null);

  const iou = data.ious.find((x) => x.id === id);
  if (!iou) {
    return (
      <Screen header={<NavHeader title="IOU" />}>
        <EmptyState icon="search" title="IOU not found" message="It may have been deleted." actionLabel="All IOUs" onAction={() => router.replace('/ious')} />
      </Screen>
    );
  }

  const balance = iouBalance(iou);
  const overdue = isOverdue(iou, today);
  const incoming = iou.direction === 'owed_to_me';
  const entries = [...iou.entries].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  const linked = relatedTransactions(data, iou);
  const days = daysOutstanding(iou, today);

  const remove = async () => {
    const ok = await confirm({
      title: 'Delete this IOU?',
      message: 'Its repayment history goes with it. Any transactions you recorded for it stay in your ledger.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    if (router.canGoBack()) router.back();
    else router.replace('/ious');
    ledger.deleteIou(iou.id);
    toast({ message: 'IOU deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const removeEntry = async (entryId: string, amount: number, date: string, txId?: string) => {
    const ok = await confirm({
      title: 'Remove this repayment?',
      message: txId ? `${money(amount)} goes back to outstanding. The transaction it created stays in your ledger — delete that separately if it never happened.` : `${money(amount)} goes back to outstanding.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    ledger.deleteIouEntry(iou.id, entryId);
    toast({ message: `Repayment from ${formatDate(date, 'short', today)} removed`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen
      header={<NavHeader title={iou.person} right={<IconButton icon="edit-2" accessibilityLabel="Edit IOU" onPress={() => router.push({ pathname: '/ious/edit', params: { id: iou.id } })} />} />}
    >
      <GradientCard style={{ gap: spacing.md }}>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" emoji={IOU_EMOJI[iou.direction]} label={DIRECTION_LABEL[iou.direction]} />
          {balance.settled && <Pill tone="glass" size="sm" icon="check" label="Settled" />}
          {overdue && <Pill tone="glass" size="sm" icon="alert-circle" label="Overdue" />}
        </Row>
        <View style={{ gap: 2 }}>
          <Text variant="small" color={colors.onGradientMuted}>
            {balance.settled ? 'Settled in full' : incoming ? 'Still owed to you' : 'You still owe'}
          </Text>
          <Money cents={balance.settled ? balance.amount : balance.outstanding} variant="display" color={colors.onGradient} />
          <Text variant="small" color={colors.onGradientMuted} tabular>
            {/* Only the verb is lowercased; the person's name stays exactly as entered. */}
            {balance.repaid > 0
              ? `${money(balance.repaid)} of ${money(balance.amount)} repaid`
              : `${money(balance.amount)} ${incoming ? 'lent to' : 'borrowed from'} ${iou.person}`}
          </Text>
        </View>
        {balance.repaid > 0 && !balance.settled && <ProgressBar value={balance.ratio} color={colors.onGradientMuted} accessibilityLabel={`${Math.round(balance.ratio * 100)}% repaid`} />}
      </GradientCard>

      {!balance.settled && (
        <Row gap={spacing.sm}>
          {/* Short labels: side by side at 390px these truncate otherwise. */}
          <Button label="Add repayment" icon="plus" style={{ flex: 1 }} onPress={() => setSheet('repay')} accessibilityHint="Record money paid back on this IOU" />
          <Button label="Mark settled" icon="check" variant="secondary" style={{ flex: 1 }} onPress={() => setSheet('settle')} />
        </Row>
      )}

      <Card variant="muted" style={{ gap: spacing.sm }}>
        <KeyValue label={incoming ? 'Lent on' : 'Borrowed on'} value={`${formatDate(iou.date, 'medium', today)}${days > 0 ? ` · ${days} ${days === 1 ? 'day' : 'days'} ago` : ''}`} />
        {!!iou.dueDate && <KeyValue label="Due" value={formatDate(iou.dueDate, 'medium', today)} hint={overdue ? 'Past due' : undefined} />}
        {!!iou.reason?.trim() && <KeyValue label="What for" value={iou.reason.trim()} />}
        {!!iou.settledOn && <KeyValue label="Settled on" value={formatDate(iou.settledOn, 'medium', today)} />}
        <KeyValue label="Original amount" value={money(balance.amount)} />
      </Card>

      <Section title="Repayments" subtitle={balance.settled ? 'Fully repaid' : `${money(balance.outstanding)} to go`}>
        {entries.length === 0 ? (
          <EmptyState
            compact
            icon="corner-down-left"
            title="No repayments yet"
            message={incoming ? `Nothing back from ${iou.person} so far.` : `You have not paid ${iou.person} back yet.`}
            actionLabel="Record a repayment"
            onAction={() => setSheet('repay')}
          />
        ) : (
          <ListCard>
            {entries.map((entry) => (
              <View key={entry.id} style={styles.entry}>
                <VisualTile emoji="coin" size={32} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="medium">{formatDate(entry.date, 'short', today)}</Text>
                  <Text variant="small" color={colors.textTertiary} numberOfLines={2}>
                    {[entry.note, entry.txId ? 'Linked to a transaction' : 'IOU only — no money recorded'].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <Money cents={entry.amount} weight="semibold" />
                <IconButton
                  icon="trash-2"
                  size={32}
                  variant="plain"
                  accessibilityLabel={`Remove the ${money(entry.amount)} repayment from ${formatDate(entry.date, 'short', today)}`}
                  onPress={() => removeEntry(entry.id, entry.amount, entry.date, entry.txId)}
                />
              </View>
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="Money that actually moved" subtitle="Transactions recorded from this IOU">
        {linked.length === 0 ? (
          <Banner
            tone="muted"
            icon="info"
            title="No transactions linked"
            message={`This IOU has not changed any account balance. ${moneyMovePlan(iou.direction, 'repayment').explain}`}
          />
        ) : (
          <ListCard>
            {linked.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} showDate onPress={() => router.push(`/transactions/${tx.id}`)} />
            ))}
          </ListCard>
        )}
      </Section>

      {(!!iou.notes?.trim() || iou.tags.length > 0) && (
        <Card variant="muted" style={{ gap: spacing.sm }}>
          {!!iou.notes?.trim() && <Text color={colors.textSecondary}>{iou.notes.trim()}</Text>}
          {iou.tags.length > 0 && (
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {iou.tags.map((t) => (
                <Pill key={t} size="sm" tone="primary" label={`#${t}`} />
              ))}
            </Row>
          )}
        </Card>
      )}

      <Stack gap={spacing.sm}>
        <Button label="Delete IOU" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>

      <RepaymentSheet iou={iou} visible={sheet !== null} onClose={() => setSheet(null)} fullAmount={sheet === 'settle'} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12 },
});
