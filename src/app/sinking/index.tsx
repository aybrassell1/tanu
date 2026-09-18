import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  DateField,
  EmptyState,
  GradientCard,
  IconButton,
  Money,
  MoneyField,
  NavHeader,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  SelectField,
  Sheet,
  Text,
  TextField,
  VisualTile,
  useOverlay,
  type SelectOption,
} from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { addDays, formatDate, formatMonth, monthOf, relativePhrase } from '@/domain/dates';
import { allocatedAmounts } from '@/domain/goals';
import { spendingAmount } from '@/domain/ledger';
import { sum } from '@/domain/money';
import {
  fundStatuses,
  fundsMissingThisMonth,
  monthlySetAsideTotal,
  overReservedAccounts,
  setAsideThisMonth,
  suggestFundsFrom,
  totalReserved,
  unreservedIn,
  type FundStatus,
} from '@/domain/sinking';
import type { Cents, ID, ISODate, SinkingFund } from '@/domain/types';
import { useData, useDerived, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

const onGradient = 'rgba(255,255,255,0.85)';

type EntryMode = 'add' | 'use';

export default function SinkingFundsScreen() {
  const router = useRouter();
  const money = useMoney();
  const today = useToday();
  const { toast } = useOverlay();
  const [sheet, setSheet] = useState<{ fund: SinkingFund; mode: EntryMode } | null>(null);

  const m = useDerived((data, day) => {
    const allocated = allocatedAmounts(data, day);
    const statuses = fundStatuses(data, day).sort((a, b) => {
      const ad = a.daysUntilDue ?? Number.MAX_SAFE_INTEGER;
      const bd = b.daysUntilDue ?? Number.MAX_SAFE_INTEGER;
      return ad === bd ? b.shortfall - a.shortfall : ad - bd;
    });
    return {
      statuses,
      reserved: totalReserved(data),
      monthlyPlan: monthlySetAsideTotal(data),
      thisMonth: setAsideThisMonth(data, day),
      missing: fundsMissingThisMonth(data, day),
      over: overReservedAccounts(data, day, allocated),
      suggestions: suggestFundsFrom(data, day).slice(0, 6),
      accountNames: new Map(data.accounts.map((a) => [a.id, a.name])),
    };
  });

  const month = formatMonth(monthOf(today));

  const setAsideAll = () => {
    const created: { fundId: ID; entryId: ID }[] = [];
    let total = 0;
    for (const fund of m.missing) {
      const result = ledger.addSinkingEntry(fund.id, { date: today, amount: fund.monthly, note: `${month} set-aside` });
      if (result.ok) {
        created.push({ fundId: fund.id, entryId: result.id });
        total += fund.monthly;
      }
    }
    if (created.length === 0) return;
    toast({
      message: `Set aside ${money(total)} across ${created.length} ${created.length === 1 ? 'fund' : 'funds'}`,
      actionLabel: 'Undo',
      onAction: () => created.forEach((c) => ledger.deleteSinkingEntry(c.fundId, c.entryId)),
    });
  };

  const startFund = (params: Record<string, string>) => router.push({ pathname: '/sinking/edit', params });

  return (
    <Screen
      header={<NavHeader title="Sinking funds" right={<IconButton icon="plus" accessibilityLabel="New fund" onPress={() => router.push('/sinking/edit')} />} />}
    >
      <GradientCard style={{ gap: spacing.md }}>
        <View style={{ gap: 4 }}>
          <Text variant="small" weight="medium" color={onGradient}>
            Reserved for irregular costs
          </Text>
          <Money cents={m.reserved} variant="display" color={colors.onGradient} />
        </View>
        <View style={styles.heroSplit}>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={onGradient}>
              Plan each month
            </Text>
            <Money cents={m.monthlyPlan} variant="h3" color={colors.onGradient} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="caption" color={onGradient}>
              Set aside in {formatMonth(monthOf(today), 'short')}
            </Text>
            <Money cents={m.thisMonth} variant="h3" color={colors.onGradient} />
          </View>
        </View>
        <View style={styles.heroNote}>
          <Text variant="small" color={colors.ink}>
            A reserve labels money you already have — nothing moves. Reserves held in a spendable account lower what's available to spend.
          </Text>
        </View>
      </GradientCard>

      {m.over.map((a) => (
        <Banner
          key={a.accountId}
          tone="warning"
          icon="alert-circle"
          title="More is reserved than this account holds"
          message={`${m.accountNames.get(a.accountId) ?? 'An account'} holds ${money(a.balance)}, but funds and goals claim ${money(a.reserved + a.allocated)}. Use some of a fund or update the balance.`}
        />
      ))}

      {m.missing.length > 0 && (
        <Card variant="muted" style={{ gap: spacing.md }}>
          <Row>
            <VisualTile emoji="spiral-calendar" />
            <View style={{ flex: 1 }}>
              <Text weight="medium">{`${m.missing.length} ${m.missing.length === 1 ? 'fund has' : 'funds have'} nothing set aside in ${month}`}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {`Records this month's planned amount for each of them (${money(sum(m.missing.map((f) => f.monthly)))} in total).`}
              </Text>
            </View>
          </Row>
          <Button label="Set aside for all funds this month" icon="check" size="sm" onPress={setAsideAll} />
        </Card>
      )}

      <Section title="Your funds" subtitle={m.statuses.length ? 'Money waiting for a cost that is not monthly' : undefined}>
        {m.statuses.length === 0 ? (
          <EmptyState
            icon="archive"
            title="No sinking funds yet"
            message="Reserve a little each month for costs that arrive once or twice a year, like car registration, insurance or the holidays."
            actionLabel="Start a fund"
            onAction={() => router.push('/sinking/edit')}
          />
        ) : (
          m.statuses.map((s) => (
            <FundCard
              key={s.fund.id}
              status={s}
              today={today}
              accountName={s.fund.accountId ? m.accountNames.get(s.fund.accountId) : undefined}
              onOpen={() => router.push(`/sinking/${s.fund.id}`)}
              onAdd={() => setSheet({ fund: s.fund, mode: 'add' })}
              onUse={() => setSheet({ fund: s.fund, mode: 'use' })}
            />
          ))
        )}
      </Section>

      {m.suggestions.length > 0 && (
        <Section title="Worth a fund" subtitle="Irregular costs from your spending map">
          {m.suggestions.map((s) => (
            <Card key={s.categoryId} style={{ gap: spacing.md }} padding={spacing.lg}>
              <Row>
                <VisualTile emoji={categoryEmoji(s.categoryId) ?? 'spiral-calendar'} size={34} />
                <View style={{ flex: 1 }}>
                  <Text weight="medium">{s.name}</Text>
                  <Text variant="small" color={colors.textSecondary}>
                    {`${money(s.yearlyTarget, { whole: true })} a year · ${s.cadence}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Money cents={s.monthly} weight="semibold" whole />
                  <Text variant="caption" color={colors.textTertiary}>
                    a month
                  </Text>
                </View>
              </Row>
              <Button
                label="Start a fund"
                icon="plus"
                size="sm"
                variant="secondary"
                onPress={() =>
                  startFund({ name: s.name, categoryId: s.categoryId, yearlyTarget: String(s.yearlyTarget), monthly: String(s.monthly) })
                }
              />
            </Card>
          ))}
        </Section>
      )}

      <EntrySheet fund={sheet?.fund ?? null} mode={sheet?.mode ?? 'add'} visible={!!sheet} onClose={() => setSheet(null)} />
    </Screen>
  );
}

export function statusPill(s: FundStatus) {
  if (s.overdue) return { label: 'Overdue', tone: 'negative' as const, icon: 'alert-triangle' as const };
  if (s.shortfall === 0) return { label: 'Funded', tone: 'positive' as const, icon: 'check' as const };
  if (s.monthsUntilDue !== null && s.onTrack < 0.95) return { label: 'Behind', tone: 'warning' as const, icon: 'alert-circle' as const };
  return { label: 'On track', tone: 'muted' as const, icon: 'trending-up' as const };
}

function FundCard({
  status,
  today,
  accountName,
  onOpen,
  onAdd,
  onUse,
}: {
  status: FundStatus;
  today: ISODate;
  accountName?: string;
  onOpen: () => void;
  onAdd: () => void;
  onUse: () => void;
}) {
  const money = useMoney();
  const { fund } = status;
  const pill = statusPill(status);
  // relativePhrase falls back to the same short date beyond two weeks, so only add it when it says something new.
  const due = fund.dueDate ? { on: formatDate(fund.dueDate, 'short', today), soon: relativePhrase(fund.dueDate, today) } : null;
  const dueLine = !due ? 'No due date yet' : due.soon === due.on ? `Due ${due.on}` : `Due ${due.on} · ${due.soon}`;
  const monthLine = `${money(status.savedThisMonth)} set aside this month of a ${money(fund.monthly)} plan`;

  return (
    <Card style={{ gap: spacing.md }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${fund.name}, ${money(status.balance)} of ${money(status.target)} reserved, ${pill.label}`}
        style={({ pressed }) => [{ gap: spacing.sm }, pressed && { opacity: 0.7 }]}
      >
        <Row>
          <VisualTile emoji={fund.emoji ?? categoryEmoji(fund.categoryId) ?? 'money-bag'} size={34} />
          <View style={{ flex: 1 }}>
            <Text weight="semibold" numberOfLines={1}>
              {fund.name}
            </Text>
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {accountName ? `Held in ${accountName}` : 'No account named'}
            </Text>
          </View>
          <Pill size="sm" tone={pill.tone} icon={pill.icon} label={pill.label} />
        </Row>
        <ProgressBar
          value={status.ratio}
          color={status.overdue ? colors.negative : status.shortfall === 0 ? colors.positive : colors.primary}
          accessibilityLabel={`${Math.round(status.ratio * 100)}% of the yearly target`}
        />
        <Row>
          <Text variant="small" weight="medium" tabular style={{ flex: 1 }}>
            {`${money(status.balance, { whole: true })} of ${money(status.target, { whole: true })}`}
          </Text>
          <Text variant="caption" color={colors.textTertiary}>
            {dueLine}
          </Text>
        </Row>
        <Text variant="caption" color={status.fundedThisMonth ? colors.textTertiary : colors.textSecondary}>
          {monthLine}
        </Text>
        {status.suggestedCatchUp > 0 && (
          <Text variant="caption" color={colors.warning}>
            {`${money(status.requiredMonthly ?? 0)} a month gets there in time — ${money(status.suggestedCatchUp)} more than the plan.`}
          </Text>
        )}
      </Pressable>
      <Row gap={spacing.sm}>
        <Button label="Set aside" icon="plus" size="sm" variant="secondary" style={{ flex: 1 }} onPress={onAdd} />
        <Button label="Use it" icon="minus" size="sm" variant="secondary" style={{ flex: 1 }} disabled={status.balance <= 0} onPress={onUse} />
      </Row>
    </Card>
  );
}

/** Records money set aside in a fund, or spent out of it. Shared with the fund detail screen. */
export function EntrySheet({ fund, mode, visible, onClose }: { fund: SinkingFund | null; mode: EntryMode; visible: boolean; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();

  const [amount, setAmount] = useState<Cents | undefined>();
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState('');
  const [txId, setTxId] = useState<ID | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const key = `${fund?.id ?? ''}:${mode}:${visible}`;
  const [lastKey, setLastKey] = useState(key);
  if (key !== lastKey) {
    setLastKey(key);
    setAmount(visible && fund && mode === 'add' ? fund.monthly || undefined : undefined);
    setDate(today);
    setNote('');
    setTxId(undefined);
    setErrors({});
  }

  // Money in the fund's account that no other fund or goal has claimed.
  const free = useMemo(() => (fund?.accountId ? unreservedIn(data, fund.accountId, today, allocatedAmounts(data, today)) : null), [data, fund, today]);

  const txOptions = useMemo<SelectOption<ID>[]>(() => {
    if (!fund || mode !== 'use') return [];
    const from = addDays(today, -120);
    return data.transactions
      .filter((t) => t.date >= from && t.date <= today && spendingAmount(t) > 0 && (!fund.categoryId || t.categoryId === fund.categoryId))
      .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1))
      .slice(0, 20)
      .map((t) => ({ value: t.id, label: t.description, description: `${formatDate(t.date, 'short', today)} · ${money(spendingAmount(t))}` }));
  }, [data, fund, mode, today, money]);

  if (!fund) return null;

  const balance = fund.entries.reduce((total, e) => total + e.amount, 0);

  const save = () => {
    if (!amount || amount <= 0) return setErrors({ amount: 'Enter an amount.' });
    if (mode === 'add' && free !== null && amount > free) {
      return setErrors({ amount: `Only ${money(Math.max(0, free))} in that account isn't already reserved or assigned.` });
    }
    if (mode === 'use' && amount > balance) {
      return setErrors({ amount: `That's ${money(amount - balance)} more than the fund has. Use ${money(balance)} or less.` });
    }

    const result = ledger.addSinkingEntry(fund.id, {
      date,
      amount: mode === 'add' ? amount : -amount,
      note: note.trim() || undefined,
      txId: mode === 'use' ? txId : undefined,
    });
    if (!result.ok) return setErrors(result.errors);
    onClose();
    toast({
      message: mode === 'add' ? `Set aside ${money(amount)} for ${fund.name}` : `Used ${money(amount)} from ${fund.name}`,
      actionLabel: 'Undo',
      onAction: () => ledger.deleteSinkingEntry(fund.id, result.id),
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={fund.name}
      subtitle={mode === 'add' ? 'Reserve money that is already in your accounts.' : 'Spend part of what this fund holds.'}
      footer={<Button label={mode === 'add' ? 'Set aside' : 'Use it'} size="lg" fullWidth onPress={save} />}
    >
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}
      <MoneyField label="Amount" value={amount} onChange={setAmount} error={errors.amount} autoFocus />
      <Text variant="caption" color={colors.textSecondary} tabular>
        {mode === 'add'
          ? free === null
            ? `This fund holds ${money(balance)}`
            : `Not assigned or reserved in that account: ${money(Math.max(0, free))} · fund holds ${money(balance)}`
          : `This fund holds ${money(balance)}`}
      </Text>
      {mode === 'use' && (
        <Text variant="caption" color={colors.textTertiary}>
          This only releases the reserve. No transaction is created — record the spending itself as usual.
        </Text>
      )}
      <DateField label="Date" value={date} onChange={(d) => setDate(d ?? today)} shortcuts error={errors.date} />
      {mode === 'use' && txOptions.length > 0 && (
        <SelectField
          label="Link a transaction"
          value={txId}
          onChange={setTxId}
          options={txOptions}
          optional
          placeholder="Choose the spending this paid for"
          searchable={txOptions.length > 8}
          hint="Keeps the reserve tied to what it actually paid for."
        />
      )}
      <TextField label="Note" value={note} onChangeText={setNote} optional placeholder={mode === 'add' ? 'e.g. September set-aside' : 'e.g. Renewal paid'} />
      <View style={{ height: spacing.xs }} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  heroSplit: { flexDirection: 'row', gap: spacing.md, backgroundColor: 'rgba(12,4,7,0.12)', borderRadius: radius.md, padding: spacing.md },
  // Dark text on a light strip: the gradient fades to sky blue here, where white text loses contrast.
  heroNote: { backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
});
