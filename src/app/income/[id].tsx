import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DateBadge, TransactionRow } from '@/components/finance/Rows';
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  KeyValue,
  ListCard,
  Money,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  Stack,
  StatusBadge,
  Text,
  useOverlay,
} from '@/components/ui';
import { INCOME_TYPES } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import { addDays, formatDate, relativePhrase } from '@/domain/dates';
import { incomeAmount, indexLedger } from '@/domain/ledger';
import { formatPercent, sum } from '@/domain/money';
import { frequencyLabel } from '@/domain/recurrence';
import { expectedGross, expectedNet, scheduledEvents, type ScheduledEvent } from '@/domain/schedule';
import type { IncomeSource } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

const RECEIVED_PAGE = 12;

export default function IncomeSourceScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [showAll, setShowAll] = useState(false);
  const source = data.incomeSources.find((s) => s.id === id);

  const model = useMemo(() => {
    if (!source) return null;
    const history = scheduledEvents(data, { from: addDays(today, -120), to: addDays(today, 30), today })
      .filter((e) => e.source === 'income' && e.sourceId === source.id)
      .reverse();
    const next = scheduledEvents(data, { from: today, to: addDays(today, 400), today }).find((e) => e.kind === 'income' && e.sourceId === source.id && e.status === 'upcoming');
    const received = data.transactions.filter((t) => t.incomeSourceId === source.id).sort((a, b) => (a.date === b.date ? b.createdAt.localeCompare(a.createdAt) : a.date < b.date ? 1 : -1));
    const yearStart = `${today.slice(0, 4)}-01-01`;
    const ytd = sum(received.filter((t) => t.date >= yearStart && t.date <= today).map(incomeAmount));
    return { history, next, received, ytd };
  }, [data, today, source]);

  if (!source || !model) {
    return (
      <Screen header={<NavHeader title="Income source" />}>
        <EmptyState icon="search" title="Income source not found" message="It may have been deleted." actionLabel="All income" onAction={() => router.replace('/income')} />
      </Screen>
    );
  }

  const index = indexLedger(data);
  const info = INCOME_TYPES[source.type];
  const account = index.accounts.get(source.depositAccountId);
  const net = expectedNet(source);
  const gross = expectedGross(source);
  const record = () => router.push({ pathname: '/quick-add', params: { mode: 'income', sourceId: source.id } });

  const toggleActive = () => {
    const { createdAt: _c, updatedAt: _u, ...rest } = source;
    const result = ledger.saveIncomeSource({ ...rest, active: !source.active });
    if (result.ok) toast(source.active ? `${source.name} paused — no longer in forecasts` : `${source.name} is active again`);
    else toast({ message: Object.values(result.errors)[0] ?? 'Could not update this source.', tone: 'error' });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${source.name}?`,
      message: 'Its schedule stops appearing in forecasts. Past paychecks stay as ordinary income transactions.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    router.back();
    ledger.deleteIncomeSource(source.id);
    toast({ message: 'Income source deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const shown = showAll ? model.received : model.received.slice(0, RECEIVED_PAGE);

  return (
    <Screen header={<NavHeader title={source.name} right={<IconButton icon="edit-2" accessibilityLabel="Edit income source" onPress={() => router.push({ pathname: '/income/edit', params: { id: source.id } })} />} />}>
      <Card variant="muted" padding={spacing.xl} style={styles.hero}>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          <Pill label="Expected" tone="projected" icon="clock" size="sm" />
          {!source.active && <StatusBadge tone="muted" label="Inactive" />}
        </Row>
        <Text variant="small" color={colors.textSecondary}>
          Take-home per paycheck
        </Text>
        <Money cents={net} variant="display" />
        <Text color={colors.textSecondary} align="center">
          {source.frequency ? frequencyLabel(source.frequency) : 'Irregular income'}
          {model.next ? ` · next ${relativePhrase(model.next.date, today)}` : ''}
        </Text>
        {model.next && (
          <Text variant="small" color={colors.textTertiary}>
            {formatDate(model.next.date, 'long', today)}
          </Text>
        )}
        {gross !== undefined && gross > 0 && (
          <View style={styles.grossRow}>
            <View style={styles.grossCell}>
              <Text variant="caption" color={colors.textTertiary}>
                GROSS
              </Text>
              <Money cents={gross} weight="semibold" />
            </View>
            <View style={styles.grossDivider} />
            <View style={styles.grossCell}>
              <Text variant="caption" color={colors.textTertiary}>
                TAKE-HOME RATE
              </Text>
              <Text weight="semibold" tabular>
                {source.expectedNet !== undefined ? formatPercent(net / gross) : '—'}
              </Text>
            </View>
          </View>
        )}
      </Card>

      <ListCard>
        <KeyValue label="Type" value={info.label} />
        {!!source.employer && <KeyValue label="Employer" value={source.employer} />}
        {source.hourlyRate !== undefined && (
          <KeyValue label="Hourly rate" value={source.expectedHours !== undefined ? `${money(source.hourlyRate)}/hr × ${source.expectedHours} hrs` : `${money(source.hourlyRate)}/hr`} />
        )}
        <KeyValue label="Deposit account">
          <Text weight="medium" color={account ? colors.primary : colors.negative} onPress={account ? () => router.push(`/accounts/${account.id}`) : undefined} suppressHighlighting>
            {account?.name ?? 'Missing account'}
          </Text>
        </KeyValue>
        <KeyValue label="Category" value={categoryPath(index.categories, source.categoryId)} />
        {source.frequency && source.anchorDate && <KeyValue label="Pay schedule" hint="Anchored to this pay date" value={`${frequencyLabel(source.frequency)} from ${formatDate(source.anchorDate, 'medium', today)}`} />}
        <KeyValue label="Ends" value={source.endDate ? formatDate(source.endDate, 'medium', today) : 'No end date'} />
        {source.tags.length > 0 && <KeyValue label="Tags" value={source.tags.map((t) => `#${t}`).join(' ')} />}
      </ListCard>

      {!!source.notes && (
        <Card variant="muted">
          <Text color={colors.textSecondary}>{source.notes}</Text>
        </Card>
      )}

      <Section title="Expected vs actual" subtitle="Last 120 days and the next 30">
        {model.history.length === 0 ? (
          <EmptyState
            compact
            icon="calendar"
            title={!source.active ? 'This source is paused' : !source.frequency ? 'No pay schedule' : 'No pay dates in this window'}
            message={!source.active ? 'Activate it to see expected paychecks again.' : !source.frequency ? 'Irregular income has no expected dates. Add a schedule to compare expected and actual pay.' : 'Pay dates will appear here once the schedule starts.'}
            actionLabel={!source.active ? 'Activate' : 'Edit schedule'}
            onAction={!source.active ? toggleActive : () => router.push({ pathname: '/income/edit', params: { id: source.id } })}
          />
        ) : (
          <ListCard>
            {model.history.map((e) => (
              <ComparisonRow key={e.key} event={e} source={source} onRecord={record} onOpen={(txId) => router.push(`/transactions/${txId}`)} />
            ))}
          </ListCard>
        )}
      </Section>

      <Section title="Received" subtitle={model.received.length ? `${money(model.ytd)} so far in ${today.slice(0, 4)}` : undefined} action={model.received.length > RECEIVED_PAGE ? (showAll ? 'Show less' : `All ${model.received.length}`) : undefined} onAction={() => setShowAll(!showAll)}>
        {model.received.length === 0 ? (
          <EmptyState compact icon="download" title="No paychecks recorded yet" message="Record a paycheck when it lands so reports and forecasts stay accurate." actionLabel="Record paycheck" onAction={record} />
        ) : (
          <ListCard>
            {shown.map((t) => (
              <TransactionRow key={t.id} tx={t} showDate />
            ))}
          </ListCard>
        )}
      </Section>

      <Stack gap={spacing.sm}>
        <Button label="Record paycheck" icon="plus" size="lg" fullWidth onPress={record} />
        <Button label={source.active ? 'Deactivate' : 'Activate'} icon={source.active ? 'pause-circle' : 'play-circle'} variant="secondary" fullWidth onPress={toggleActive} />
        <Button label="Delete income source" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>
    </Screen>
  );
}

function ComparisonRow({ event, source, onRecord, onOpen }: { event: ScheduledEvent; source: IncomeSource; onRecord: () => void; onOpen: (txId: string) => void }) {
  const money = useMoney();
  const today = useToday();
  const expected = expectedNet(source);
  const dateLine = formatDate(event.date, 'weekday', today);

  if (event.status === 'paid' && event.transactionId) {
    const diff = event.amount - expected;
    const diffColor = diff > 0 ? colors.positive : diff < 0 ? colors.negative : colors.textSecondary;
    const txId = event.transactionId;
    return (
      <Pressable onPress={() => onOpen(txId)} accessibilityRole="button" accessibilityLabel={`${dateLine}, received ${money(event.amount)}`} style={({ pressed }) => [styles.compareRow, pressed && { opacity: 0.6 }]}>
        <DateBadge date={event.date} muted />
        <View style={styles.compareBody}>
          <Text weight="medium">{dateLine}</Text>
          <Text variant="small" color={colors.textTertiary}>
            Expected {money(expected)}
          </Text>
        </View>
        <View style={styles.compareTrailing}>
          <Money cents={event.amount} weight="semibold" color={colors.positive} />
          <View style={styles.diff}>
            <Feather name={diff > 0 ? 'arrow-up-right' : diff < 0 ? 'arrow-down-right' : 'check'} size={12} color={diffColor} />
            <Text variant="caption" color={diffColor} tabular>
              {diff === 0 ? 'As expected' : `${money(diff, { signed: true })} vs expected`}
            </Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <View style={styles.compareRow}>
      <DateBadge date={event.date} />
      <View style={styles.compareBody}>
        <Text weight="medium">{dateLine}</Text>
        {event.status === 'overdue' ? <StatusBadge tone="negative" label="Not recorded" /> : <Pill label="Expected" tone="projected" size="sm" />}
      </View>
      <View style={styles.compareTrailing}>
        <Text weight="semibold" tabular color={colors.textSecondary}>
          {money(expected)}
        </Text>
        {event.status === 'overdue' && <Button label="Record" size="sm" variant="secondary" onPress={onRecord} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: spacing.sm },
  grossRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.sm, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing.md, alignSelf: 'stretch' },
  grossCell: { flex: 1, alignItems: 'center', gap: 2 },
  grossDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', backgroundColor: colors.border },
  compareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 12 },
  compareBody: { flex: 1, gap: 4, alignItems: 'flex-start' },
  compareTrailing: { alignItems: 'flex-end', gap: 6 },
  diff: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
