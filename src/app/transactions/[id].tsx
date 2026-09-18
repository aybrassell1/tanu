import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { transactionDisplay } from '@/components/finance/Rows';
import { Button, Card, EmptyState, IconButton, KeyValue, ListCard, Money, NavHeader, Pill, Row, Screen, Stack, Text, useOverlay } from '@/components/ui';
import { icon } from '@/data/icons';
import { TRANSACTION_TYPES } from '@/domain/catalog';
import { categoryPath } from '@/domain/categories';
import { formatDate } from '@/domain/dates';
import { indexLedger } from '@/domain/ledger';
import { isEssential } from '@/domain/reports';
import { effectiveTaxTag, TAX_TAGS } from '@/domain/taxes';
import type { PaycheckWithholding } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useToday } from '@/store/hooks';
import { openAttachment } from '@/store/fileIO';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const WITHHOLDING_LABELS: [keyof PaycheckWithholding, string][] = [
  ['federal', 'Federal tax'],
  ['state', 'State tax'],
  ['socialSecurity', 'Social Security'],
  ['medicare', 'Medicare'],
  ['retirement', '401(k)'],
  ['hsa', 'HSA'],
  ['benefits', 'Benefits'],
];

export default function TransactionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { confirm, toast } = useOverlay();
  const index = indexLedger(data);
  const live = index.transactions.get(id);
  // While leaving after a delete, keep showing the last known transaction so
  // the closing screen never flashes "not found".
  const last = useRef(live);
  const leaving = useRef(false);
  if (live) last.current = live;
  const tx = live ?? (leaving.current ? last.current : undefined);

  if (!tx) {
    return (
      <Screen header={<NavHeader title="Transaction" />}>
        <EmptyState icon="search" title="Transaction not found" message="It may have been deleted." actionLabel="Go to activity" onAction={() => router.replace('/transactions')} />
      </Screen>
    );
  }

  const info = TRANSACTION_TYPES[tx.type];
  const display = transactionDisplay(tx);
  const account = index.accounts.get(tx.accountId);
  const to = tx.toAccountId ? index.accounts.get(tx.toAccountId) : undefined;
  const recurring = tx.recurringId ? data.recurring.find((r) => r.id === tx.recurringId) : undefined;
  const source = tx.incomeSourceId ? data.incomeSources.find((s) => s.id === tx.incomeSourceId) : undefined;
  const spending = ['expense', 'interest', 'refund', 'reimbursement'].includes(tx.type);
  const taxTag = tx.type === 'income' ? null : effectiveTaxTag(data, tx);

  const remove = async () => {
    const ok = await confirm({ title: 'Delete transaction?', message: 'Balances, reports and forecasts will update immediately.', confirmLabel: 'Delete', destructive: true });
    if (!ok) return;
    leaving.current = true;
    goBackOr(router, '/transactions');
    ledger.deleteTransaction(tx.id);
    toast({ message: 'Transaction deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const favoriteLabel = tx.payee || tx.description;
  const existingFavorite = data.favorites.find(
    (f) => f.type === tx.type && f.label === favoriteLabel && f.amount === tx.amount && f.categoryId === tx.categoryId && f.accountId === tx.accountId && f.toAccountId === tx.toAccountId,
  );
  // Toggles, so tapping twice never creates a duplicate favorite.
  const favorite = () => {
    if (existingFavorite) {
      ledger.deleteFavorite(existingFavorite.id);
      toast({ message: 'Removed from quick-add favorites', actionLabel: 'Undo', onAction: ledger.undo });
      return;
    }
    ledger.saveFavorite({ label: favoriteLabel, type: tx.type, amount: tx.amount, categoryId: tx.categoryId, accountId: tx.accountId, toAccountId: tx.toAccountId, payee: tx.payee, tags: tx.tags });
    toast('Added to quick-add favorites');
  };

  const classification =
    tx.type === 'expense' || tx.type === 'interest'
      ? 'Counts as spending'
      : tx.type === 'refund' || tx.type === 'reimbursement'
        ? 'Reduces spending in its category'
        : tx.type === 'income'
          ? 'Counts as income'
          : tx.type === 'adjustment'
            ? 'Balance adjustment — not income or spending'
            : 'Moves money between your accounts — not income or spending';

  return (
    <Screen
      header={<NavHeader title={info.label} right={<IconButton icon="edit-2" accessibilityLabel="Edit" onPress={() => router.push({ pathname: '/transactions/edit', params: { id: tx.id } })} />} />}
    >
      <Card variant="muted" style={styles.hero} padding={spacing.xl}>
        <View style={styles.heroIcon}>
          <Feather name={icon(info.icon)} size={22} color={colors.primary} />
        </View>
        <Text variant="h3" align="center">
          {tx.payee || tx.description}
        </Text>
        <Money cents={display.cents} signed={display.signed} color={display.color} variant="display" />
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {tx.date > today && <Pill tone="projected" icon="clock" label="Scheduled" />}
          <Pill tone="muted" label={classification} />
        </Row>
      </Card>

      <ListCard>
        <KeyValue label="Date" value={formatDate(tx.date, 'long', today)} />
        {tx.payee && tx.description && tx.payee !== tx.description && <KeyValue label="Description" value={tx.description} />}
        {info.twoAccounts ? (
          <>
            <KeyValue label="From">
              <Text weight="medium" color={colors.primary} onPress={() => account && router.push(`/accounts/${account.id}`)}>
                {account?.name ?? 'Missing account'}
              </Text>
            </KeyValue>
            <KeyValue label="To">
              <Text weight="medium" color={colors.primary} onPress={() => to && router.push(`/accounts/${to.id}`)}>
                {to?.name ?? 'Missing account'}
              </Text>
            </KeyValue>
          </>
        ) : (
          <KeyValue label="Account">
            <Text weight="medium" color={colors.primary} onPress={() => account && router.push(`/accounts/${account.id}`)}>
              {account?.name ?? 'Missing account'}
            </Text>
          </KeyValue>
        )}
        {(tx.categoryId || info.category) && !tx.splits?.length && <KeyValue label="Category" value={categoryPath(index.categories, tx.categoryId)} />}
        {!!tx.splits?.length && (
          <View style={styles.splits}>
            <Text color={colors.textSecondary}>Split across</Text>
            {tx.splits.map((s) => (
              <View key={s.id} style={styles.splitLine}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="medium">{categoryPath(index.categories, s.categoryId) || 'Uncategorized'}</Text>
                  {!!s.note && (
                    <Text variant="caption" color={colors.textTertiary}>
                      {s.note}
                    </Text>
                  )}
                </View>
                <Money cents={s.amount} weight="medium" />
              </View>
            ))}
            <View style={styles.splitTotal}>
              <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                {tx.splits.length} lines
              </Text>
              <Money cents={tx.amount} variant="small" weight="semibold" />
            </View>
          </View>
        )}
        {spending && <KeyValue label="Type of spending" value={isEssential(data, tx) ? 'Essential' : 'Discretionary'} />}
        {taxTag && <KeyValue label="Taxes" value={`${TAX_TAGS[taxTag].label}${tx.taxRelated === undefined ? ' (suggested)' : ''}`} />}
        {tx.adjustmentKind && <KeyValue label="Adjustment" value={tx.adjustmentKind === 'valuation' ? 'Market value change' : tx.adjustmentKind === 'reconcile' ? 'Balance correction' : 'Other'} />}
        {recurring && (
          <KeyValue label="Recurring">
            <Text weight="medium" color={colors.primary} onPress={() => router.push(`/bills/${recurring.id}`)}>
              {recurring.name}
              {tx.occurrenceDate ? ` · due ${formatDate(tx.occurrenceDate, 'short', today)}` : ''}
            </Text>
          </KeyValue>
        )}
        {source && (
          <KeyValue label="Income source">
            <Text weight="medium" color={colors.primary} onPress={() => router.push(`/income/${source.id}`)}>
              {source.name}
            </Text>
          </KeyValue>
        )}
        {tx.grossAmount !== undefined && (
          <KeyValue label="Gross pay">
            <Money cents={tx.grossAmount} weight="medium" />
          </KeyValue>
        )}
        {tx.withholding &&
          WITHHOLDING_LABELS.filter(([k]) => (tx.withholding?.[k] ?? 0) > 0).map(([k, label]) => (
            <KeyValue key={k} label={label}>
              <Money cents={-(tx.withholding?.[k] ?? 0)} color={colors.textSecondary} />
            </KeyValue>
          ))}
      </ListCard>

      {(tx.tags.length > 0 || tx.notes || tx.attachments.length > 0) && (
        <Stack>
          {tx.tags.length > 0 && (
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {tx.tags.map((t) => (
                <Pill key={t} tone="primary" label={`#${t}`} onPress={() => router.push({ pathname: '/search', params: { q: `#${t}` } })} />
              ))}
            </Row>
          )}
          {!!tx.notes && (
            <Card variant="muted">
              <Text color={colors.textSecondary}>{tx.notes}</Text>
            </Card>
          )}
          {tx.attachments.map((a) => (
            <Button key={a.id} label={a.name} icon="paperclip" variant="secondary" fullWidth onPress={() => openAttachment(a.uri, a.mimeType).catch((e) => toast({ message: e instanceof Error ? e.message : 'Could not open the file.', tone: 'error' }))} />
          ))}
        </Stack>
      )}

      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm}>
          <Button label="Duplicate" icon="copy" variant="secondary" style={{ flex: 1 }} onPress={() => router.push({ pathname: '/transactions/edit', params: { id: tx.id, duplicate: '1' } })} />
          <Button label={existingFavorite ? 'Favorited' : 'Favorite'} icon="star" variant={existingFavorite ? 'primary' : 'secondary'} style={{ flex: 1 }} onPress={favorite} accessibilityHint={existingFavorite ? 'Removes it from quick-add favorites' : 'Adds it to quick-add favorites'} />
        </Row>
        <Button label="Delete transaction" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  splits: { paddingVertical: 10, gap: 8 },
  splitLine: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  splitTotal: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, paddingTop: 8 },
  hero: { alignItems: 'center', gap: spacing.sm },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
