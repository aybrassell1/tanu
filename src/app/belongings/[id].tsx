import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ChangeLabel, latestValuation, yearStart } from '@/components/assets/Change';
import { TransactionRow } from '@/components/finance/Rows';
import { OwnershipCard } from '@/components/ownership/OwnershipCard';
import { PolicyRow } from '@/components/policies/PolicyParts';
import {
  Banner,
  Button,
  Card,
  DateField,
  EmptyState,
  IconButton,
  IconTile,
  KeyValue,
  LineChart,
  ListCard,
  Money,
  MoneyField,
  NavHeader,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  Sheet,
  Stack,
  Text,
  TextField,
  useOverlay,
} from '@/components/ui';
import { icon } from '@/data/icons';
import { ACCOUNT_TYPES, ASSET_TYPES } from '@/domain/catalog';
import { addDays, diffDays, formatDate } from '@/domain/dates';
import { balanceOn, indexLedger, spendingAmount } from '@/domain/ledger';
import { formatPercent, sum } from '@/domain/money';
import { policiesForAsset } from '@/domain/policies';
import type { Asset, Cents, ISODate } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger, useLedgerStore } from '@/store/ledger';
import { colors, series, spacing } from '@/theme/tokens';

export default function AssetDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();
  const [updating, setUpdating] = useState(false);

  const live = data.assets.find((a) => a.id === id);
  // Keep rendering the last known asset while the screen closes after a delete.
  const last = useRef(live);
  const leaving = useRef(false);
  if (live) last.current = live;
  const asset = live ?? (leaving.current ? last.current : undefined);

  const related = useMemo(() => {
    if (!asset?.expenseTag) return null;
    const tag = asset.expenseTag;
    const index = indexLedger(data);
    const tagged = index.sorted.filter((t) => t.tags.includes(tag) && t.date <= today);
    const from = yearStart(today);
    const total = sum(tagged.filter((t) => t.date >= from).map(spendingAmount));
    return { tag, total, recent: tagged.slice(0, 5) };
  }, [asset?.expenseTag, data, today]);

  if (!asset) {
    return (
      <Screen header={<NavHeader title="Asset" />}>
        <EmptyState icon="search" title="Asset not found" message="It may have been deleted." actionLabel="All assets" onAction={() => router.replace('/belongings')} />
      </Screen>
    );
  }

  const type = ASSET_TYPES[asset.type];
  const sold = !!asset.soldDate && asset.soldDate <= today;
  const valuations = [...asset.valuations].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const latest = latestValuation(asset, sold ? asset.soldDate! : today);
  const value: Cents = latest?.value ?? 0;
  const change = asset.purchasePrice !== undefined ? value - asset.purchasePrice : null;

  const index = indexLedger(data);
  const loan = asset.linkedLiabilityId ? index.accounts.get(asset.linkedLiabilityId) : undefined;
  const loanBalance = loan ? balanceOn(index, loan.id, today) : 0;
  const equity = value - loanBalance;

  const cover = policiesForAsset(data, asset.id);
  // Pre-pick the kind that fits this sort of thing; the form can still change it.
  const coverKind = asset.type === 'vehicle' ? 'auto' : asset.type === 'property' ? 'home' : 'warranty';
  const addCover = () => router.push({ pathname: '/policies/edit', params: { assetId: asset.id, kind: coverKind } });

  // Chart: purchase price (if known and earlier) followed by each valuation; one point per day.
  const chartPoints = (() => {
    const byDate = new Map<ISODate, Cents>();
    if (asset.purchaseDate && asset.purchasePrice !== undefined && (!valuations[0] || asset.purchaseDate < valuations[0].date)) byDate.set(asset.purchaseDate, asset.purchasePrice);
    for (const v of valuations) byDate.set(v.date, v.value);
    const dates = [...byDate.keys()].sort();
    const origin = dates[0];
    return {
      origin,
      points: dates.map((d) => ({ x: diffDays(origin, d), y: byDate.get(d)! })),
    };
  })();

  const removeValuation = async (valuationId: string, date: ISODate) => {
    const ok = await confirm({
      title: 'Delete this value?',
      message: `The value recorded on ${formatDate(date, 'medium')} will be removed from this asset's history and net worth.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    const removed = asset.valuations.find((v) => v.id === valuationId);
    ledger.deleteValuation(asset.id, valuationId);
    toast({
      message: 'Value deleted',
      ...(removed
        ? {
            actionLabel: 'Undo',
            onAction: () =>
              ledger.addValuation(asset.id, {
                date: removed.date,
                value: removed.value,
                note: removed.note,
              }),
          }
        : {}),
    });
  };

  const setSold = (soldDate: ISODate | undefined) => {
    const previous = asset.soldDate;
    const { id: assetId, createdAt: _c, updatedAt: _u, ...rest } = asset;
    const result = ledger.saveAsset({ ...rest, id: assetId, soldDate });
    if (!result.ok) {
      toast({
        message: Object.values(result.errors)[0] ?? 'Could not update this asset.',
        tone: 'error',
      });
      return;
    }
    toast({
      message: soldDate ? `${asset.name} marked as sold` : `${asset.name} marked as owned`,
      actionLabel: 'Undo',
      onAction: () => {
        const current = useLedgerStore.getState().data.assets.find((a) => a.id === assetId);
        if (!current) return;
        const { createdAt: _cc, updatedAt: _uu, ...latest } = current;
        ledger.saveAsset({ ...latest, soldDate: previous });
      },
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${asset.name}?`,
      message: 'Its value history is removed and your net worth history will change.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    leaving.current = true;
    goBackOr(router, '/belongings');
    ledger.deleteAsset(asset.id);
    toast({
      message: 'Asset deleted',
      actionLabel: 'Undo',
      onAction: ledger.undo,
    });
  };

  return (
    <Screen
      header={
        <NavHeader
          title={asset.name}
          right={
            <IconButton
              icon="edit-2"
              accessibilityLabel="Edit asset"
              onPress={() =>
                router.push({
                  pathname: '/belongings/edit',
                  params: { id: asset.id },
                })
              }
            />
          }
        />
      }
    >
      <Card variant="muted" padding={spacing.xl} style={{ gap: spacing.sm }}>
        <Row gap={spacing.sm}>
          <IconTile icon={icon(type.icon, 'box')} size={32} />
          <Text variant="small" weight="medium" color={colors.textSecondary} style={{ flex: 1 }}>
            {sold ? 'Value when sold' : 'Current value'}
          </Text>
          {sold && <Pill tone="muted" size="sm" icon="check" label={`Sold ${formatDate(asset.soldDate!, 'short', today)}`} />}
        </Row>
        <Money cents={value} variant="display" />
        {change !== null && <ChangeLabel cents={change} pct={asset.purchasePrice ? change / asset.purchasePrice : null} suffix="since purchase" variant="body" />}
        <Text variant="caption" color={colors.textTertiary}>
          {[latest ? `Updated ${formatDate(latest.date, 'short', today)}` : 'No value recorded yet', asset.purchasePrice !== undefined ? `Paid ${money(asset.purchasePrice)}` : null].filter(Boolean).join(' · ')}
        </Text>
      </Card>

      {!sold && <Button label="Update value" icon="edit-3" size="lg" fullWidth onPress={() => setUpdating(true)} />}

      <Section title="How has its value changed?">
        <Card>
          {chartPoints.points.length >= 2 ? (
            <LineChart
              accessibilityLabel={`${asset.name} value over time`}
              series={[
                {
                  key: 'value',
                  label: 'Value',
                  color: series[0],
                  area: true,
                  points: chartPoints.points,
                },
              ]}
              formatY={(v) => money(v, { compact: true, whole: true })}
              formatX={(x) => formatDate(addDays(chartPoints.origin, Math.round(x)), 'short', today)}
              includeZero
            />
          ) : (
            <Text color={colors.textSecondary}>Record another value over time to see how it changes.</Text>
          )}
        </Card>
      </Section>

      <Section title="Value history">
        {valuations.length === 0 && (
          <EmptyState compact icon="clock" title="No values recorded" message="Record what it's worth so it counts toward net worth." actionLabel="Update value" onAction={() => setUpdating(true)} />
        )}
        {valuations.length > 0 && (
          <ListCard>
            {[...valuations].reverse().map((v) => (
              <View key={v.id} style={styles.historyRow}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="medium">{formatDate(v.date, 'medium', today)}</Text>
                  {!!v.note && (
                    <Text variant="small" color={colors.textTertiary} numberOfLines={2}>
                      {v.note}
                    </Text>
                  )}
                  {v.date > today && <Pill tone="projected" size="sm" label="Future date" />}
                </View>
                <Money cents={v.value} weight="semibold" />
                <IconButton
                  icon="trash-2"
                  size={32}
                  variant="plain"
                  accessibilityLabel={`Delete value from ${formatDate(v.date, 'medium')}`}
                  disabled={valuations.length <= 1}
                  onPress={() => removeValuation(v.id, v.date)}
                />
              </View>
            ))}
          </ListCard>
        )}
        {valuations.length === 1 && (
          <Text variant="caption" color={colors.textTertiary}>
            An asset keeps at least one value. Update the value instead.
          </Text>
        )}
      </Section>

      {loan && (
        <Card style={{ gap: spacing.md }}>
          <Text variant="h3">Loan & equity</Text>
          <KeyValue label="Loan balance">
            <Text weight="medium" color={colors.primary} onPress={() => router.push(`/accounts/${loan.id}`)} accessibilityRole="link">
              {`${loan.name} · ${money(loanBalance)}`}
            </Text>
          </KeyValue>
          <KeyValue label="Equity" hint="Value minus what you still owe">
            <Money cents={equity} weight="semibold" tone="balance" />
          </KeyValue>
          <ProgressBar value={value > 0 ? Math.max(0, equity) / value : 0} color={colors.positive} accessibilityLabel={`You own ${formatPercent(value > 0 ? Math.max(0, equity) / value : 0)} of this asset`} />
          <Text variant="caption" color={colors.textSecondary}>
            {value > 0 ? `You own ${formatPercent(Math.max(0, equity) / value)} · the lender's share is ${formatPercent(Math.min(1, loanBalance / value))}` : 'Record a value to see your equity.'}
          </Text>
          {equity < 0 && <Banner tone="warning" icon="alert-circle" title="You owe more than it's worth" message={`Underwater by ${money(-equity)}.`} />}
        </Card>
      )}

      <OwnershipCard asset={asset} />

      <Section title="Is it covered?">
        {cover.length === 0 ? (
          <EmptyState compact icon="shield" title="No cover recorded" message="Record the policy or warranty that covers this, so you know when it runs out." actionLabel="Add cover" onAction={addCover} />
        ) : (
          <Stack gap={spacing.sm}>
            <ListCard>
              {cover.map((p) => (
                <PolicyRow key={p.id} policy={p} today={today} onPress={() => router.push(`/policies/${p.id}`)} />
              ))}
            </ListCard>
            <Button label="Add cover" icon="plus" variant="secondary" fullWidth onPress={addCover} />
          </Stack>
        )}
      </Section>

      {related && (
        <Section title="Related costs this year" subtitle={`Transactions tagged #${related.tag}`}>
          <Card variant="muted" style={styles.inline}>
            <Text color={colors.textSecondary} style={{ flex: 1 }}>
              Spent since Jan 1
            </Text>
            <Money cents={related.total} variant="h3" />
          </Card>
          {related.recent.length === 0 ? (
            <EmptyState
              compact
              icon="tag"
              title="No tagged costs yet"
              message={`Add #${related.tag} to fuel, repairs or insurance transactions to see them here.`}
              actionLabel="Add expense"
              onAction={() =>
                router.push({
                  pathname: '/transactions/edit',
                  params: { type: 'expense' },
                })
              }
            />
          ) : (
            <>
              <ListCard>
                {related.recent.map((t) => (
                  <TransactionRow key={t.id} tx={t} showDate />
                ))}
              </ListCard>
              <Button
                label="View all"
                variant="secondary"
                fullWidth
                trailingIcon="arrow-right"
                onPress={() =>
                  router.push({
                    pathname: '/search',
                    params: { q: `#${related.tag}` },
                  })
                }
              />
            </>
          )}
        </Section>
      )}

      <ListCard>
        <KeyValue label="Type" value={type.label} />
        <KeyValue label="Purchased" value={asset.purchaseDate ? formatDate(asset.purchaseDate, 'medium', today) : 'Not set'} />
        {asset.purchasePrice !== undefined && (
          <KeyValue label="Purchase price">
            <Money cents={asset.purchasePrice} weight="medium" />
          </KeyValue>
        )}
        {loan && <KeyValue label="Loan" value={`${loan.name} · ${ACCOUNT_TYPES[loan.type].label}`} />}
        <KeyValue label="Expense tag" value={asset.expenseTag ? `#${asset.expenseTag}` : 'None'} />
        {sold && <KeyValue label="Sold" value={formatDate(asset.soldDate!, 'medium', today)} />}
      </ListCard>

      {(asset.tags.length > 0 || !!asset.notes) && (
        <Stack>
          {asset.tags.length > 0 && (
            <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
              {asset.tags.map((t) => (
                <Pill key={t} tone="primary" label={`#${t}`} onPress={() => router.push({ pathname: '/search', params: { q: `#${t}` } })} />
              ))}
            </Row>
          )}
          {!!asset.notes && (
            <Card variant="muted">
              <Text color={colors.textSecondary}>{asset.notes}</Text>
            </Card>
          )}
        </Stack>
      )}

      <Stack gap={spacing.sm}>
        {asset.soldDate ? (
          <Button label="Mark as owned" icon="rotate-ccw" variant="secondary" fullWidth onPress={() => setSold(undefined)} />
        ) : (
          <Button label="Mark as sold" icon="check-circle" variant="secondary" fullWidth onPress={() => setSold(today)} />
        )}
        <Button label="Delete asset" icon="trash-2" variant="danger" fullWidth onPress={remove} />
      </Stack>

      <UpdateValueSheet asset={asset} current={value} visible={updating} onClose={() => setUpdating(false)} />
    </Screen>
  );
}

function UpdateValueSheet({ asset, current, visible, onClose }: { asset: Asset; current: Cents; visible: boolean; onClose: () => void }) {
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const [value, setValue] = useState<Cents | undefined>(undefined);
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();

  const close = () => {
    setValue(undefined);
    setDate(today);
    setNote('');
    setError(undefined);
    onClose();
  };

  const save = () => {
    if (value === undefined) return setError('Enter a value.');
    const result = ledger.addValuation(asset.id, {
      date,
      value,
      note: note.trim() || undefined,
    });
    if (!result.ok) return setError(Object.values(result.errors)[0]);
    const newId = result.id;
    const undoEntry = useLedgerStore.getState().undo;
    close();
    const replaced = asset.valuations.some((v) => v.date === date);
    toast({
      message: replaced ? `Replaced the ${formatDate(date, 'short', today)} value with ${money(value)}` : `${asset.name} valued at ${money(value)}`,
      actionLabel: 'Undo',
      // Restores exactly what was there, including a value this one replaced.
      onAction: () => {
        if (useLedgerStore.getState().undo === undoEntry) ledger.undo();
        else ledger.deleteValuation(asset.id, newId);
      },
    });
  };

  return (
    <Sheet visible={visible} onClose={close} title="Update value" subtitle={`Currently ${money(current)}`} footer={<Button label="Save value" size="lg" fullWidth onPress={save} />}>
      <MoneyField
        label="What is it worth?"
        value={value}
        onChange={(c) => {
          setValue(c);
          setError(undefined);
        }}
        error={error}
        autoFocus
        hint="Use a resale estimate, e.g. from a pricing guide or listings."
      />
      <DateField label="As of" value={date} onChange={(d) => setDate(d ?? today)} shortcuts hint={asset.valuations.some((v) => v.date === date) ? 'Replaces the value already recorded on this date.' : undefined} />
      <TextField label="Note" value={note} onChangeText={setNote} optional placeholder="e.g. Kelley Blue Book estimate" />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: 10,
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
