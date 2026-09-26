import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Banner, Button, Card, EmptyState, ListRow, Money, NavHeader, Pill, Row, Screen, Section, StatTile, Text, useOverlay } from '@/components/ui';
import { formatDate } from '@/domain/dates';
import { isSandbox, planSync, type SyncResult, type SyncRow } from '@/domain/plaidSync';
import { bankBalanceOf } from '@/domain/balanceCheck';
import { accounts as fetchAccounts, PlaidError, syncAll, type BankApi } from '@/lib/plaid';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

/**
 * A sync, shown before it happens.
 *
 * The bank's list is turned into transactions, paired where a transfer arrived
 * twice, and checked against what you already have. Then you look at it. The
 * ledger changes when you say so and not before, and the whole thing is one
 * undo afterwards.
 */
export default function SyncScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();

  const connection = data.connections.find((c) => c.id === id);
  const api = data.settings.bankApi as BankApi | undefined;

  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [plan, setPlan] = useState<SyncResult | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());

  const run = async () => {
    if (!api || !connection) return;
    setState('loading');
    setError(null);
    try {
      const payload = await syncAll(api, connection.accessToken, connection.cursor);
      // What each account holds, noted beside it. Nothing is adjusted here.
      try {
        const info = await fetchAccounts(api, connection.accessToken);
        const balances = info.accounts
          .map((a) => ({ externalId: a.account_id, balance: bankBalanceOf(a.balances) }))
          .filter((b): b is { externalId: string; balance: number } => b.balance !== undefined);
        if (balances.length) ledger.recordBalances(connection.id, balances);
      } catch {
        // A bank that won't give balances still gives transactions.
      }
      setPlan(planSync(data, connection.id, payload));
      setCursor(payload.next_cursor);
      setState('ready');
    } catch (e) {
      const message = e instanceof PlaidError ? e.message : 'The sync could not finish.';
      setError(message);
      // A bank that wants a new sign-in says so here, so the list shows it.
      if (e instanceof PlaidError && e.code === 'ITEM_LOGIN_REQUIRED') ledger.flagConnection(connection.id, 'Your bank ended the connection. Reconnect to keep syncing.');
      setState('error');
    }
  };

  useEffect(() => {
    if (state === 'idle' && api && connection) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, api, connection?.id]);

  if (!connection) {
    return (
      <Screen header={<NavHeader title="Sync" />}>
        <EmptyState icon="search" title="Bank not found" message="It may have been disconnected." actionLabel="Back" onAction={() => router.push('/connect')} />
      </Screen>
    );
  }

  const toApply = (plan?.rows ?? []).filter((r) => r.draft && !skipped.has(r.externalId));
  const toggle = (row: SyncRow) =>
    setSkipped((s) => {
      const next = new Set(s);
      if (next.has(row.externalId)) next.delete(row.externalId);
      else next.add(row.externalId);
      return next;
    });

  const apply = () => {
    const add = toApply.filter((r) => !r.replaces).map((r) => r.draft!);
    const replace = toApply.filter((r) => r.replaces).map((r) => ({ id: r.replaces!, with: r.draft! }));
    const result = ledger.applySync(connection.id, { add, replace, removeIds: plan?.removed ?? [], cursor });
    if (!result.ok) return;
    toast({
      message: result.id === 1 ? 'Added 1 transaction' : `Added ${result.id} transactions`,
      actionLabel: 'Undo',
      onAction: ledger.undo,
    });
    router.push('/connect');
  };

  const nothingToDo = state === 'ready' && (plan?.rows.length ?? 0) === 0 && (plan?.removed.length ?? 0) === 0;

  return (
    <Screen
      header={<NavHeader title={connection.institutionName} />}
      footer={
        state === 'ready' && !nothingToDo ? (
          <Button
            label={toApply.length === 0 ? 'Nothing selected' : toApply.length === 1 ? 'Add 1 transaction' : `Add ${toApply.length} transactions`}
            size="lg"
            fullWidth
            onPress={apply}
          />
        ) : undefined
      }
    >
      {state === 'loading' && <Banner tone="primary" icon="refresh-cw" title="Asking your bank" message="Everything since the last sync. This can take a moment the first time." />}

      {state === 'error' && (
        <>
          <Banner tone="negative" icon="alert-triangle" title="The sync stopped" message={error ?? ''} />
          <Button label="Try again" icon="refresh-cw" fullWidth onPress={run} />
        </>
      )}

      {nothingToDo && (
        <EmptyState icon="check-circle" title="Nothing new" message="Your bank has nothing since the last sync." actionLabel="Back to banks" actionIcon="arrow-left" onAction={() => router.push('/connect')} />
      )}

      {state === 'ready' && !nothingToDo && plan && (
        <>
          {isSandbox(connection.accessToken) && (
            <Banner
              tone="warning"
              icon="alert-triangle"
              title="These transactions are made up"
              message="This is Plaid's test bank. Adding them puts invented charges in your ledger, where they will look real later. Only do it if you are testing."
            />
          )}
          <View style={styles.tiles}>
            <StatTile label="To add" value={String(plan.counts.new + plan.counts.transfer)} icon="download" caption={plan.counts.transfer > 0 ? `${plan.counts.transfer} paired as transfers` : undefined} />
            <StatTile label="Already here" value={String(plan.counts.duplicate)} icon="check" caption="Left alone" />
          </View>

          {plan.counts.unmapped > 0 && (
            <Banner
              tone="muted"
              icon="link"
              title={`${plan.counts.unmapped} from accounts you haven't linked`}
              message="Point those accounts at yours on the previous screen, then sync again."
            />
          )}
          {plan.counts.pending > 0 && (
            <Banner tone="muted" icon="clock" title={`${plan.counts.pending} still pending`} message="Pending charges change before they settle, so they arrive on a later sync." />
          )}
          {plan.removed.length > 0 && (
            <Banner tone="warning" icon="trash-2" title={`${plan.removed.length} the bank took back`} message="These were reversed or never settled. Adding will remove them here too." />
          )}

          <Section title="New" subtitle="Tap one to leave it out">
            {plan.rows.filter((r) => r.draft).length === 0 ? (
              <Card variant="muted">
                <Text color={colors.textSecondary}>Nothing new to add — everything below is already in your ledger.</Text>
              </Card>
            ) : (
              plan.rows
                .filter((r) => r.draft)
                .map((row) => {
                  const off = skipped.has(row.externalId);
                  return (
                    <Card key={row.externalId} onPress={() => toggle(row)} accessibilityLabel={`${row.label}, ${off ? 'skipped' : 'will be added'}`}>
                      <ListRow
                        icon={off ? 'square' : row.kind === 'transfer' ? 'repeat' : 'check-square'}
                        title={row.label || 'No description'}
                        subtitle={`${formatDate(row.date, 'short', today)} · ${row.accountName}`}
                        trailing={<Money cents={row.amount} weight="semibold" />}
                        trailingCaption={row.replaces ? 'correction' : undefined}
                      />
                      {row.kind === 'transfer' && (
                        <Pill size="sm" icon="repeat" label="Both sides of one move — counted once" />
                      )}
                    </Card>
                  );
                })
            )}
          </Section>

          {plan.counts.duplicate > 0 && (
            <Section title="Already in your ledger" subtitle="Recognised, so nothing is counted twice">
              {plan.rows
                .filter((r) => r.kind === 'duplicate')
                .slice(0, 20)
                .map((row) => (
                  <ListRow
                    key={row.externalId}
                    icon="check"
                    title={row.label || 'No description'}
                    subtitle={`${formatDate(row.date, 'short', today)} · ${row.accountName}${row.pairedWith ? ' · other half of a transfer' : ''}`}
                    trailing={<Money cents={row.amount} color={colors.textTertiary} />}
                    dense
                  />
                ))}
            </Section>
          )}

          <Row>
            <Button label="Sync again" icon="refresh-cw" variant="ghost" size="sm" onPress={run} />
          </Row>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.md },
});
