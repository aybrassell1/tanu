import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChangeLabel, yearStart } from '@/components/assets/Change';
import { Banner, Button, Card, EmptyState, HBarList, IconButton, IconTile, LineChart, ListCard, ListRow, Money, MoneyField, NavHeader, Row, Screen, Section, Sheet, StatTile, Text, useOverlay, VisualTile } from '@/components/ui';
import { ACCOUNT_EMOJI } from '@/data/visuals';
import { icon } from '@/data/icons';
import { ACCOUNT_TYPES, isInvestment } from '@/domain/catalog';
import { formatMonth, lastMonths, monthOf } from '@/domain/dates';
import { balanceOn, indexLedger, investmentInfo } from '@/domain/ledger';
import { centsToInput, formatPercent, sum } from '@/domain/money';
import { monthEndDates } from '@/domain/position';
import { investmentActivity } from '@/domain/reports';
import type { Account, Cents, ID } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger, useLedgerStore } from '@/store/ledger';
import { colors, series, spacing } from '@/theme/tokens';

export default function InvestmentsScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const [updating, setUpdating] = useState(false);

  const model = useMemo(() => {
    const index = indexLedger(data);
    const accounts = data.accounts.filter((a) => !a.archived && isInvestment(a.type));
    const rows = accounts.map((account) => ({ account, info: investmentInfo(index, account, today)! }));
    const value = sum(rows.map((r) => r.info.value));
    const costBasis = sum(rows.map((r) => r.info.costBasis));
    const gain = value - costBasis;
    const gainPct = costBasis > 0 ? gain / costBasis : null;

    // Payroll 401(k)/HSA lines are typed `income` but are contributions, so
    // they count once — as money put in, never as money the market paid out.
    const from = yearStart(today);
    const activity = investmentActivity(data, from, today);

    const dates = monthEndDates(lastMonths(monthOf(today), 12), today);
    const valueSeries = dates.map((d) => sum(accounts.map((a) => balanceOn(index, a.id, d))));
    const basisSeries = dates.map((d) => sum(accounts.map((a) => (d < a.startingDate ? 0 : (investmentInfo(index, a, d)?.costBasis ?? 0)))));

    const byType = new Map<string, Cents>();
    for (const r of rows) {
      const label = ACCOUNT_TYPES[r.account.type].label;
      byType.set(label, (byType.get(label) ?? 0) + r.info.value);
    }
    const split = [...byType.entries()].map(([label, v]) => ({ label, value: v })).sort((a, b) => b.value - a.value);

    return { rows, value, costBasis, gain, gainPct, activity, dates, valueSeries, basisSeries, split };
  }, [data, today]);

  const addAccount = () => router.push({ pathname: '/accounts/edit', params: { type: 'brokerage' } });
  const header = <NavHeader title="Investments" right={<IconButton icon="plus" accessibilityLabel="Add investment account" onPress={addAccount} />} />;

  if (model.rows.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="trending-up"
          title="No investment accounts yet"
          message="Add a brokerage, IRA, 401(k) or HSA to track its value, contributions and gains."
          actionLabel="Add investment account"
          onAction={addAccount}
        />
      </Screen>
    );
  }

  const firstAccountId = model.rows[0].account.id;
  const positiveSplit = model.split.filter((s) => s.value > 0);
  const splitTotal = sum(positiveSplit.map((s) => s.value));

  return (
    <Screen header={header}>
      <Card variant="muted" padding={spacing.xl} style={{ gap: spacing.sm }}>
        <Text variant="small" weight="medium" color={colors.textSecondary}>
          Total value
        </Text>
        <Money cents={model.value} variant="display" />
        <ChangeLabel cents={model.gain} pct={model.gainPct} suffix="total gain" variant="body" />
        <Text variant="caption" color={colors.textTertiary}>
          Cost basis {money(model.costBasis)} · what you put in, including reinvested dividends
        </Text>
      </Card>

      <View style={styles.tiles}>
        <StatTile
          label="Contributed this year"
          icon="arrow-down-left"
          value={<Money cents={model.activity.contributions} variant="h3" compact />}
          caption={model.activity.payroll > 0 ? `includes ${money(model.activity.payroll, { whole: true })} from payroll` : undefined}
        />
        <StatTile label="Withdrawn this year" icon="arrow-up-right" value={<Money cents={model.activity.withdrawals} variant="h3" compact />} />
        <StatTile label="Dividends & interest this year" icon="percent" value={<Money cents={model.activity.income} variant="h3" compact />} caption="paid out by your investments" />
      </View>

      <View style={{ gap: spacing.md }}>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Button label="Update values" icon="edit-3" variant="secondary" size="sm" onPress={() => setUpdating(true)} />
          <Button label="Record contribution" icon="plus" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/quick-add', params: { mode: 'transfer' } })} />
          <Button label="Record dividend" icon="percent" variant="secondary" size="sm" onPress={() => router.push({ pathname: '/transactions/edit', params: { type: 'income', accountId: firstAccountId } })} />
        </Row>
        <Banner tone="muted" icon="info" title="Market changes are recorded as value updates. They change your net worth but never count as income." />
      </View>

      <Section title="How has my portfolio grown?" subtitle="Last 12 months">
        <Card>
          <LineChart
            accessibilityLabel="Portfolio value and contributed amount over the last 12 months"
            series={[
              { key: 'value', label: 'Value', color: series[0], area: true, points: model.valueSeries.map((y, x) => ({ x, y })) },
              { key: 'basis', label: 'Contributed (cost basis)', color: series[1], dashed: true, points: model.basisSeries.map((y, x) => ({ x, y })) },
            ]}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatX={(x) => formatMonth(monthOf(model.dates[Math.round(x)] ?? today), 'short')}
            includeZero
          />
        </Card>
      </Section>

      <Section title="Accounts">
        <ListCard>
          {model.rows.map(({ account, info }) => (
            <ListRow
              key={account.id}
              title={account.name}
              subtitle={[ACCOUNT_TYPES[account.type].label, account.institution].filter(Boolean).join(' · ')}
              leading={<VisualTile emoji={ACCOUNT_EMOJI[account.type]} tint={`${account.color}1F`} />}
              onPress={() => router.push(`/accounts/${account.id}`)}
              accessibilityLabel={`${account.name}, ${money(info.value)}`}
              trailing={
                <View style={styles.trailing}>
                  <Money cents={info.value} weight="semibold" />
                  <ChangeLabel cents={info.gain} pct={info.costBasis > 0 ? info.gainPct : null} variant="caption" />
                  <Text variant="caption" color={colors.textTertiary}>
                    Contributed {money(info.costBasis, { whole: true })}
                  </Text>
                </View>
              }
            />
          ))}
        </ListCard>
      </Section>

      {positiveSplit.length > 0 && (
        <Section title="How is it split?" subtitle="By account type">
          <Card>
            <HBarList
              items={positiveSplit.map((s, i) => ({
                key: s.label,
                label: s.label,
                value: s.value,
                valueLabel: money(s.value),
                color: series[i % series.length],
                caption: `${formatPercent(splitTotal > 0 ? s.value / splitTotal : 0)} of total`,
              }))}
            />
          </Card>
        </Section>
      )}

      <UpdateValuesSheet visible={updating} onClose={() => setUpdating(false)} accounts={model.rows.map((r) => ({ account: r.account, value: r.info.value }))} />
    </Screen>
  );
}

function UpdateValuesSheet({ visible, onClose, accounts }: { visible: boolean; onClose: () => void; accounts: { account: Account; value: Cents }[] }) {
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const [drafts, setDrafts] = useState<Record<ID, Cents | undefined>>({});

  const save = (account: Account, current: Cents) => {
    const next = drafts[account.id];
    if (next === undefined || next === current) return;
    const before = new Set(useLedgerStore.getState().data.transactions.map((t) => t.id));
    const result = ledger.updateBalance(account.id, next, today, 'valuation');
    if (!result.ok) {
      toast({ message: Object.values(result.errors)[0] ?? 'Could not update the value.', tone: 'error' });
      return;
    }
    const created = useLedgerStore.getState().data.transactions.find((t) => !before.has(t.id));
    setDrafts((d) => ({ ...d, [account.id]: undefined }));
    toast({
      message: `${account.name} updated to ${money(next)}`,
      // Undo removes only this adjustment, never an unrelated earlier change.
      ...(created ? { actionLabel: 'Undo', onAction: () => ledger.deleteTransaction(created.id) } : {}),
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Update values"
      subtitle="Enter what each account is worth today. The difference is recorded as a market value change."
      footer={<Button label="Done" size="lg" fullWidth onPress={onClose} />}
    >
      {accounts.map(({ account, value }) => {
        const draft = drafts[account.id];
        const changed = draft !== undefined && draft !== value;
        return (
          <View key={account.id} style={styles.updateRow}>
            <Row gap={spacing.md}>
              <VisualTile emoji={ACCOUNT_EMOJI[account.type]} tint={`${account.color}1F`} size={34} />
              <View style={{ flex: 1 }}>
                <Text weight="medium" numberOfLines={1}>
                  {account.name}
                </Text>
                <Text variant="caption" color={colors.textTertiary}>
                  Current value {money(value)}
                </Text>
              </View>
            </Row>
            <Row gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <MoneyField value={draft} onChange={(c) => setDrafts((d) => ({ ...d, [account.id]: c }))} placeholder={centsToInput(value)} />
              </View>
              <Button label="Save" size="md" disabled={!changed} onPress={() => save(account, value)} style={{ height: 48 }} />
            </Row>
            {changed && <ChangeLabel cents={(draft ?? 0) - value} pct={value > 0 ? ((draft ?? 0) - value) / value : null} variant="caption" suffix="market change" />}
          </View>
        );
      })}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  trailing: { alignItems: 'flex-end', gap: 2, maxWidth: 170 },
  updateRow: { gap: spacing.sm },
});
