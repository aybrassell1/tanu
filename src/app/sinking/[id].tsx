import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  GradientCard,
  IconButton,
  ListCard,
  Money,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  StatTile,
  Text,
  VisualTile,
  useOverlay,
} from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { formatDate, relativePhrase } from '@/domain/dates';
import { allocatedAmounts } from '@/domain/goals';
import { indexLedger } from '@/domain/ledger';
import { fundStatus, unreservedIn, type FundStatus } from '@/domain/sinking';
import type { ISODate, SinkingEntry } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

import { EntrySheet, statusPill } from './index';

const onGradient = 'rgba(255,255,255,0.85)';

/**
 * Caption under the due date. `relativePhrase` falls back to the same short
 * date beyond two weeks, so say how long there is to save instead.
 */
function dueLine(status: FundStatus, today: ISODate): string {
  const { fund, monthsUntilDue } = status;
  if (!fund.dueDate) return 'Add a due date to pace the fund';
  if (status.overdue) return 'Past due';
  const phrase = relativePhrase(fund.dueDate, today);
  if (phrase !== formatDate(fund.dueDate, 'short', today)) return phrase;
  if (!monthsUntilDue) return 'Due this month';
  return `${monthsUntilDue} ${monthsUntilDue === 1 ? 'month' : 'months'} to save`;
}

/** One fund: what it holds, when it is due, and every set-aside or use. */
export default function SinkingFundDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [sheet, setSheet] = useState<'add' | 'use' | null>(null);

  const fund = data.sinkingFunds.find((f) => f.id === id);
  if (!fund) {
    return (
      <Screen header={<NavHeader title="Fund" />}>
        <EmptyState icon="search" title="Fund not found" message="It may have been deleted." actionLabel="All funds" onAction={() => router.replace('/sinking')} />
      </Screen>
    );
  }

  const status = fundStatus(fund, today);
  const pill = statusPill(status);
  const index = indexLedger(data);
  const account = fund.accountId ? index.accounts.get(fund.accountId) : undefined;
  const free = fund.accountId ? unreservedIn(data, fund.accountId, today, allocatedAmounts(data, today)) : null;
  const category = fund.categoryId ? data.categories.find((c) => c.id === fund.categoryId) : undefined;
  // relativePhrase falls back to the same short date beyond two weeks, so only show it when it says something new.
  const dueCaption = dueLine(status, today);
  // Newest first; entries recorded on the same day keep the order they were added.
  const entries = [...fund.entries].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));

  const removeEntry = async (entry: SinkingEntry) => {
    const label = `${entry.amount > 0 ? 'Set aside' : 'Used'} ${money(Math.abs(entry.amount))} on ${formatDate(entry.date, 'short', today)}`;
    const ok = await confirm({
      title: 'Remove this entry?',
      message:
        entry.amount > 0
          ? `${label}. Removing it lowers what ${fund.name} holds; your transactions are untouched.`
          : `${label}. Removing it puts the money back into ${fund.name}; your transactions are untouched.`,
      confirmLabel: 'Remove',
      destructive: true,
    });
    if (!ok) return;
    ledger.deleteSinkingEntry(fund.id, entry.id);
    toast({ message: 'Entry removed', actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen
      header={
        <NavHeader
          title={fund.name}
          right={<IconButton icon="edit-2" accessibilityLabel="Edit fund" onPress={() => router.push({ pathname: '/sinking/edit', params: { id: fund.id } })} />}
        />
      }
    >
      <GradientCard style={{ gap: spacing.md }}>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" icon={pill.icon} label={pill.label} />
          {!!category && <Pill tone="glass" size="sm" label={category.name} />}
        </Row>
        <View style={{ gap: 2 }}>
          <Text variant="small" color={onGradient}>
            Reserved in this fund
          </Text>
          <Money cents={status.balance} variant="display" color={colors.onPrimary} />
          <Text variant="small" color={onGradient} tabular>
            {`of ${money(status.target)} a year`}
          </Text>
        </View>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" label={`${Math.round(status.ratio * 100)}% there`} />
          <Pill tone="glass" size="sm" label={status.shortfall > 0 ? `${money(status.shortfall, { whole: true })} to go` : 'Target reached'} />
          <Pill tone="glass" size="sm" icon="home" label={account ? `Held in ${account.name}` : 'No account named'} />
        </Row>
      </GradientCard>

      <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
        <StatTile
          label="Set aside each month"
          icon="repeat"
          value={<Money cents={fund.monthly} variant="h3" compact />}
          caption={`${money(status.savedThisMonth, { whole: true })} recorded this month`}
        />
        <StatTile
          label="Next due"
          icon="calendar"
          value={<Text variant="h3">{fund.dueDate ? formatDate(fund.dueDate, 'short', today) : 'None'}</Text>}
          caption={dueCaption}
        />
      </Row>

      {status.suggestedCatchUp > 0 && (
        <Banner
          tone="warning"
          icon="alert-circle"
          title={`${money(status.requiredMonthly ?? 0)} a month gets there in time`}
          message={`That is ${money(status.suggestedCatchUp)} more than the ${money(fund.monthly)} plan.`}
        />
      )}

      {free !== null && free < 0 && (
        <Banner
          tone="warning"
          icon="alert-triangle"
          title="More is claimed than this account holds"
          message={`Funds and goals claim ${money(-free)} more than ${account?.name ?? 'the account'} holds. Use some of a fund or update the balance.`}
        />
      )}

      <Row gap={spacing.sm}>
        <Button label="Set aside" icon="plus" style={{ flex: 1 }} onPress={() => setSheet('add')} />
        <Button label="Use it" icon="minus" variant="secondary" style={{ flex: 1 }} disabled={status.balance <= 0} onPress={() => setSheet('use')} />
      </Row>

      <Section title="History" subtitle={entries.length ? 'Every time money was set aside or used' : undefined}>
        {entries.length === 0 ? (
          <EmptyState
            compact
            icon="clock"
            title="Nothing recorded yet"
            message="Set money aside and it shows up here, so you can see how this fund filled up."
            actionLabel="Set aside"
            onAction={() => setSheet('add')}
          />
        ) : (
          <ListCard>
            {entries.map((e) => {
              const tx = e.txId ? data.transactions.find((t) => t.id === e.txId) : undefined;
              const detail = [e.note, tx?.description].filter(Boolean).join(' · ');
              return (
                <View key={e.id} style={styles.entry}>
                  <VisualTile emoji={fund.emoji ?? categoryEmoji(fund.categoryId) ?? 'money-bag'} size={30} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="medium">{formatDate(e.date, 'short', today)}</Text>
                    <Text variant="small" color={colors.textTertiary} numberOfLines={2}>
                      {detail || (e.amount > 0 ? 'Set aside' : 'Used')}
                    </Text>
                  </View>
                  <Money cents={e.amount} signed tone="flow" weight="semibold" />
                  <IconButton
                    icon="trash-2"
                    size={32}
                    variant="plain"
                    accessibilityLabel={`Remove ${e.amount > 0 ? 'set-aside' : 'use'} of ${money(Math.abs(e.amount))} on ${formatDate(e.date, 'short', today)}`}
                    onPress={() => removeEntry(e)}
                  />
                </View>
              );
            })}
          </ListCard>
        )}
      </Section>

      {!!fund.notes && (
        <Card variant="muted">
          <Text color={colors.textSecondary}>{fund.notes}</Text>
        </Card>
      )}

      <Text variant="caption" color={colors.textTertiary}>
        A reserve labels money you already have — nothing moves between accounts, and using a fund never records a transaction.
      </Text>

      <EntrySheet fund={sheet ? fund : null} mode={sheet ?? 'add'} visible={!!sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  entry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
});
