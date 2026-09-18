import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventRow, TransactionRow } from '@/components/finance/Rows';
import { Banner, Button, Card, DateField, EmptyState, IconButton, IconTile, KeyValue, LineChart, ListCard, Money, MoneyField, NavHeader, Pill, ProgressBar, Row, Screen, Section, Segmented, Sheet, Stack, StatTile, Text, TextField, useOverlay, VisualTile } from '@/components/ui';
import { ACCOUNT_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { ACCOUNT_TYPES, isCreditCard, isInvestment } from '@/domain/catalog';
import { addDays, addMonths, diffDays, formatDate } from '@/domain/dates';
import { effectiveApr } from '@/domain/debt';
import { balanceOn, balanceSeries, creditInfo, debtActivity, indexLedger, investmentInfo } from '@/domain/ledger';
import { formatMoney, formatPercent } from '@/domain/money';
import { defaultPlannedPayment, nextDebtDue, openEvents } from '@/domain/schedule';
import type { Transaction } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

type Range = '3m' | '6m' | '1y' | 'all';

export default function AccountDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [range, setRange] = useState<Range>('6m');
  const [updating, setUpdating] = useState(false);
  const [txLimit, setTxLimit] = useState(40);
  const [showRunning, setShowRunning] = useState(false);

  const index = indexLedger(data);
  const account = index.accounts.get(id);

  const model = useMemo(() => {
    if (!account) return null;
    const balance = balanceOn(index, account.id, today);
    const start = range === 'all' ? account.startingDate : addMonths(today, range === '3m' ? -3 : range === '6m' ? -6 : -12);
    const from = start < account.startingDate ? account.startingDate : start;
    const span = Math.max(1, diffDays(from, today));
    const step = span <= 100 ? 1 : span <= 400 ? 7 : 14;
    const dates: string[] = [];
    for (let d = today; d >= from; d = addDays(d, -step)) dates.unshift(d);
    if (dates[0] !== from) dates.unshift(from);
    const series = balanceSeries(index, account.id, dates);

    // Running balance after each transaction, newest first.
    const postings = index.postings.get(account.id) ?? [];
    let running = account.startingBalance;
    const after = new Map<string, number>();
    for (const p of postings) {
      if (p.date < account.startingDate) continue;
      running += p.delta;
      after.set(p.txId, running);
    }
    const txs = index.sorted.filter((t) => t.accountId === account.id || t.toAccountId === account.id);
    const year = today.slice(0, 4);
    return {
      balance,
      dates,
      series,
      txs,
      after,
      credit: creditInfo(account, balance),
      investment: investmentInfo(index, account, today),
      debtYear: debtActivity(index, account.id, `${year}-01-01`, today),
      nextDue: nextDebtDue(data, account.id, today),
      events: openEvents(data, today, addDays(today, 45), 30).filter((e) => e.accountId === account.id || e.toAccountId === account.id || e.sourceId === account.id),
    };
  }, [account, index, today, range, data]);

  if (!account || !model) {
    return (
      <Screen header={<NavHeader title="Account" />}>
        <EmptyState icon="search" title="Account not found" message="It may have been deleted." />
      </Screen>
    );
  }

  const info = ACCOUNT_TYPES[account.type];
  const liability = info.nature === 'liability';
  const apr = effectiveApr(account, today);
  const promoActive = account.promoApr !== undefined && account.promoExpires && today <= account.promoExpires;

  const remove = async () => {
    const count = model.txs.length;
    const ok = await confirm({
      title: `Delete ${account.name}?`,
      message: count ? `This also deletes ${count} transactions that involve this account, and changes balances on the other side of any transfers. Archiving keeps history instead.` : 'This account has no transactions.',
      confirmLabel: 'Delete',
      destructive: true,
      typeToConfirm: count ? 'delete' : undefined,
    });
    if (!ok) return;
    if (router.canGoBack()) router.back();
    else router.replace('/money');
    ledger.deleteAccount(account.id);
    toast({ message: 'Account deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const archive = () => {
    ledger.archiveAccount(account.id, !account.archived);
    toast(account.archived ? 'Account restored' : 'Account archived. History stays in reports and net worth.');
  };

  return (
    <Screen header={<NavHeader title={account.name} right={<IconButton icon="edit-2" accessibilityLabel="Edit account" onPress={() => router.push({ pathname: '/accounts/edit', params: { id: account.id } })} />} />}>
      {account.archived && <Banner tone="muted" icon="archive" title="Archived account" message="Hidden from lists and pickers but kept in history." />}

      <Card style={{ gap: spacing.md }} padding={spacing.xl}>
        <Row>
          <VisualTile emoji={ACCOUNT_EMOJI[account.type]} tint={`${account.color}1F`} />
          <View style={{ flex: 1 }}>
            <Text weight="semibold">{info.label}</Text>
            <Text variant="small" color={colors.textTertiary}>
              {[account.institution, liability ? 'Liability' : 'Asset'].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Row>
        <View style={{ gap: 2 }}>
          <Text variant="small" color={colors.textSecondary}>
            {liability ? 'Amount owed' : isInvestment(account.type) ? 'Current value' : 'Current balance'}
          </Text>
          <Money cents={model.balance} variant="display" tone="balance" />
        </View>
        {model.credit && (
          <View style={{ gap: 6 }}>
            <ProgressBar value={model.credit.utilization} marker={0.3} color={model.credit.utilization >= 0.7 ? colors.negative : model.credit.utilization >= 0.3 ? colors.warning : colors.primary} accessibilityLabel="Credit utilization" />
            <Text variant="small" color={colors.textSecondary}>
              {formatPercent(model.credit.utilization)} of {money(model.credit.limit, { whole: true })} used · {money(model.credit.available)} available
            </Text>
          </View>
        )}
        {model.investment && (
          <Text variant="small" color={model.investment.gain >= 0 ? colors.positive : colors.negative}>
            {`${model.investment.gain >= 0 ? '▲' : '▼'} ${money(Math.abs(model.investment.gain))} (${formatPercent(Math.abs(model.investment.gainPct), 1)}) vs ${money(model.investment.costBasis, { whole: true })} put in`}
          </Text>
        )}
        {promoActive && <Pill tone="warning" icon="percent" label={`${account.promoApr}% promo APR until ${formatDate(account.promoExpires!, 'short', today)}, then ${account.apr ?? 0}%`} />}
      </Card>

      <View style={styles.actions}>
        <Button label="Update balance" icon="sliders" variant="secondary" style={styles.action} onPress={() => setUpdating(true)} />
        {liability ? (
          <Button label="Record payment" icon="check-circle" style={styles.action} onPress={() => router.push({ pathname: '/quick-add', params: { mode: 'debt', toAccountId: account.id } })} />
        ) : (
          <Button label="Transfer" icon="repeat" variant="secondary" style={styles.action} onPress={() => router.push({ pathname: '/quick-add', params: { mode: 'transfer', accountId: account.id } })} />
        )}
        <Button label="Add transaction" icon="plus" variant={liability ? 'secondary' : 'primary'} style={styles.action} onPress={() => router.push({ pathname: '/transactions/edit', params: { accountId: account.id, type: isInvestment(account.type) ? 'investment_contribution' : 'expense' } })} />
      </View>

      <Section title="How has this balance changed?" accessory={<View style={{ width: 190 }}><Segmented size="sm" items={[{ value: '3m', label: '3M' }, { value: '6m', label: '6M' }, { value: '1y', label: '1Y' }, { value: 'all', label: 'All' }]} value={range} onChange={setRange} /></View>}>
        <Card>
          <LineChart
            accessibilityLabel={`${account.name} balance history`}
            series={[{ key: 'balance', label: liability ? 'Owed' : 'Balance', color: account.color === colors.ink ? colors.primary : account.color, area: true, points: model.series.map((y, i) => ({ x: i, y })) }]}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatX={(i) => formatDate(model.dates[Math.round(i)] ?? today, 'short', today)}
            xTicks={[...new Set([0, Math.floor((model.dates.length - 1) / 2), model.dates.length - 1])]}
            includeZero={liability}
          />
        </Card>
      </Section>

      {liability && (
        <Section title="This year">
          <View style={styles.tiles}>
            <StatTile label="Paid" value={<Money cents={model.debtYear.payments} variant="h3" />} />
            <StatTile label="Interest" value={<Money cents={model.debtYear.interest} variant="h3" />} />
            <StatTile label="Principal" value={<Money cents={model.debtYear.principal} variant="h3" />} caption="Paid down after interest & new charges" />
          </View>
          {account.originalBalance ? (
            <Card style={{ gap: 6 }}>
              <ProgressBar value={1 - Math.max(0, model.balance) / account.originalBalance} color={colors.positive} accessibilityLabel="Payoff progress" />
              <Text variant="small" color={colors.textSecondary}>
                {formatPercent(1 - Math.max(0, model.balance) / account.originalBalance)} of the original {money(account.originalBalance, { whole: true })} paid off
              </Text>
            </Card>
          ) : null}
          <Button label="Model payoff scenarios" icon="git-branch" variant="ghost" onPress={() => router.push('/debt/payoff')} />
        </Section>
      )}

      {model.events.length > 0 && (
        <Section title="Coming up">
          <ListCard>
            {model.events.slice(0, 5).map((e) => (
              <EventRow key={e.key} event={e} compact />
            ))}
          </ListCard>
        </Section>
      )}

      <Section title="Details">
        <ListCard>
          {account.institution && <KeyValue label="Institution" value={account.institution} />}
          <KeyValue label="Tracking since" value={`${formatDate(account.startingDate, 'medium')} · ${money(account.startingBalance)}`} />
          {account.creditLimit !== undefined && <KeyValue label="Credit limit" value={money(account.creditLimit)} />}
          {account.apr !== undefined && <KeyValue label={liability ? 'APR' : 'Interest rate'} value={`${account.apr}%${promoActive ? ` (now ${apr}%)` : ''}`} />}
          {account.promoApr !== undefined && account.promoExpires && <KeyValue label="Promo APR" value={`${account.promoApr}% until ${formatDate(account.promoExpires, 'medium')}`} />}
          {account.statementBalance !== undefined && <KeyValue label="Statement balance" value={money(account.statementBalance)} />}
          {account.statementClosingDay && <KeyValue label="Statement closes" value={`Day ${account.statementClosingDay}`} />}
          {account.minimumPayment !== undefined && <KeyValue label="Minimum payment" value={money(account.minimumPayment)} />}
          {liability && model.nextDue && (
            <KeyValue label="Next payment" value={`${formatDate(model.nextDue.date, 'short', today)} · ${model.nextDue.estimate ? '~' : ''}${money(model.nextDue.amount)}${model.nextDue.paidAmount ? ` left (${money(model.nextDue.paidAmount)} paid)` : ''}`} hint={defaultPlannedPayment(account) === 'statement' ? 'Statement balance' : defaultPlannedPayment(account) === 'minimum' ? 'Minimum payment' : 'Fixed payment'} />
          )}
          {account.originalBalance !== undefined && <KeyValue label="Original balance" value={money(account.originalBalance)} />}
          {model.investment && <KeyValue label="Contributed since tracking" value={money(model.investment.contributions)} />}
          {model.investment && model.investment.dividends > 0 && <KeyValue label="Dividends & interest" value={money(model.investment.dividends)} />}
          {info.group === 'cash' && <KeyValue label="Available for spending" value={account.spendable ? 'Yes' : 'No'} />}
        </ListCard>
        {account.tags.length > 0 && (
          <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
            {account.tags.map((t) => (
              <Pill key={t} tone="primary" label={`#${t}`} />
            ))}
          </Row>
        )}
        {!!account.notes && (
          <Card variant="muted">
            <Text color={colors.textSecondary}>{account.notes}</Text>
          </Card>
        )}
      </Section>

      <Section title="Transactions" accessory={model.txs.length ? <Pill size="sm" icon="bar-chart" label="Running balance" selected={showRunning} onPress={() => setShowRunning(!showRunning)} /> : undefined} action={model.txs.length ? 'Filter' : undefined} onAction={() => router.push({ pathname: '/transactions', params: { accountId: account.id } })}>
        {model.txs.length === 0 ? (
          <EmptyState compact icon="list" title="No transactions yet" message="The balance comes from the starting balance plus these transactions." />
        ) : (
          <>
            <ListCard>
              {model.txs.slice(0, txLimit).map((t: Transaction) => (
                <View key={t.id}>
                  <TransactionRow tx={t} showDate />
                  {showRunning && model.after.has(t.id) && t.date <= today && (
                    <Text variant="caption" color={colors.textTertiary} align="right" style={{ marginTop: -8, marginBottom: 8 }} tabular>
                      Balance after {money(model.after.get(t.id)!)}
                    </Text>
                  )}
                </View>
              ))}
            </ListCard>
            {model.txs.length > txLimit && <Button label="Show more" variant="secondary" fullWidth onPress={() => setTxLimit((n) => n + 60)} />}
          </>
        )}
      </Section>

      <Stack gap={spacing.sm}>
        <Button label={account.archived ? 'Restore account' : 'Archive account'} icon="archive" variant="secondary" fullWidth onPress={archive} />
        <Button label="Delete account" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>

      <UpdateBalanceSheet visible={updating} onClose={() => setUpdating(false)} accountId={account.id} />
    </Screen>
  );
}

function UpdateBalanceSheet({ visible, onClose, accountId }: { visible: boolean; onClose: () => void; accountId: string }) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const index = indexLedger(data);
  const account = index.accounts.get(accountId)!;
  const [date, setDate] = useState(today);
  const current = balanceOn(index, accountId, date);
  const [value, setValue] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const investment = isInvestment(account.type);
  const delta = value === undefined ? 0 : value - current;

  const save = () => {
    if (value === undefined) return;
    const r = ledger.updateBalance(accountId, value, date, investment ? 'valuation' : 'reconcile', note || undefined);
    if (!r.ok) return toast({ message: Object.values(r.errors)[0], tone: 'error' });
    toast(r.id === 0 ? 'Balance already matches' : { message: `Balance updated (${formatMoney(r.id, { signed: true, currency: data.settings.currency })})`, actionLabel: 'Undo', onAction: ledger.undo });
    setValue(undefined);
    setNote('');
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Update balance" subtitle={account.name} footer={<Button label="Save balance" size="lg" fullWidth onPress={save} disabled={value === undefined} />}>
      <Text color={colors.textSecondary}>
        Balance on {formatDate(date, 'short', today)} in Tanu: <Text weight="semibold">{money(current)}</Text>
      </Text>
      <MoneyField label={isCreditCard(account.type) || ACCOUNT_TYPES[account.type].nature === 'liability' ? 'Amount owed now' : investment ? 'Current market value' : 'Actual balance'} value={value} onChange={setValue} allowNegative autoFocus />
      <DateField label="As of" value={date} onChange={(d) => d && setDate(d)} shortcuts />
      {value !== undefined && delta !== 0 && (
        <Banner
          tone="muted"
          icon="info"
          title={`Records a ${formatMoney(delta, { signed: true, currency: data.settings.currency })} ${investment ? 'market value change' : 'adjustment'}`}
          message={investment ? 'Counts toward net worth, not income.' : 'Not counted as income or spending.'}
        />
      )}
      <TextField label="Note" value={note} onChangeText={setNote} optional />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  action: { flexGrow: 1 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
});
