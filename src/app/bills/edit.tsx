import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { USAGE_OPTIONS } from '@/components/bills/helpers';
import { AccountSelect, CategorySelect, FrequencySelect } from '@/components/finance/Pickers';
import { Banner, Button, ChipSelect, DateField, MoneyField, NavHeader, Screen, Stack, SwitchRow, TagInput, TextField, useOverlay } from '@/components/ui';
import { icon } from '@/data/icons';
import { accountGroup, accountNature, isInvestment, RECURRING_KINDS } from '@/domain/catalog';
import { primaryCashAccount } from '@/domain/schedule';
import { allTags } from '@/domain/search';
import type { Account, Cents, ID, RecurringItem, RecurringKind } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

type Draft = Omit<RecurringItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

const KIND_ORDER: RecurringKind[] = ['bill', 'subscription', 'debt_payment', 'transfer', 'savings', 'investment'];

const KIND_HINT: Record<RecurringKind, string> = {
  bill: 'Rent, utilities, insurance, phone. Counts as spending when paid.',
  subscription: 'Streaming, apps, memberships. Counts as spending, with usage tracking.',
  debt_payment: 'A regular payment to a card or loan. Lowers what you owe; not spending.',
  transfer: 'Moves money between your own accounts. Not income or spending.',
  savings: 'An automatic move into savings. Not spending.',
  investment: 'A regular contribution to a brokerage or retirement account. Not spending.',
};

const isAsset = (a: Account) => accountNature(a.type) === 'asset';

const TO_FILTER: Partial<Record<RecurringKind, (a: Account) => boolean>> = {
  debt_payment: (a) => accountNature(a.type) === 'liability',
  investment: (a) => isInvestment(a.type),
  savings: (a) => accountGroup(a.type) === 'savings',
};

const TO_LABEL: Partial<Record<RecurringKind, string>> = {
  debt_payment: 'Card or loan',
  investment: 'Investment account',
  savings: 'Savings account',
  transfer: 'Goes to',
};

export default function RecurringFormScreen() {
  const params = useLocalSearchParams<{ id?: string; kind?: RecurringKind; name?: string; categoryId?: string; unit?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const existing = params.id ? data.recurring.find((r) => r.id === params.id) : undefined;

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return { ...existing };
    const kind = params.kind && params.kind in RECURRING_KINDS ? params.kind : 'bill';
    return {
      name: params.name ?? '',
      kind,
      categoryId: params.categoryId && data.categories.some((c) => c.id === params.categoryId) ? params.categoryId : undefined,
      amount: 0,
      variable: false,
      frequency: { unit: params.unit === 'year' ? 'year' : 'month', interval: 1 },
      startDate: today,
      accountId: primaryCashAccount(data)?.id ?? '',
      autopay: false,
      essential: kind === 'bill',
      active: true,
      skipped: [],
      tags: [],
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const spending = draft.kind === 'bill' || draft.kind === 'subscription';
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);
  const toFilter = useMemo(() => {
    const base = TO_FILTER[draft.kind];
    return (a: Account) => a.id !== draft.accountId && (base ? base(a) : true);
  }, [draft.kind, draft.accountId]);

  const changeKind = (kind: RecurringKind) => {
    setErrors({});
    setDraft((d) => {
      const next: Draft = { ...d, kind };
      const nextSpending = kind === 'bill' || kind === 'subscription';
      if (nextSpending) next.toAccountId = undefined;
      else {
        next.categoryId = undefined;
        const to = d.toAccountId ? data.accounts.find((a) => a.id === d.toAccountId) : undefined;
        if (to && TO_FILTER[kind] && !TO_FILTER[kind]!(to)) next.toAccountId = undefined;
      }
      if (kind !== 'subscription') next.usage = undefined;
      // Only flip the default while creating; keep what the user chose when editing.
      if (!existing && (kind === 'bill' || kind === 'subscription')) next.essential = kind === 'bill';
      return next;
    });
  };

  const save = () => {
    const result = ledger.saveRecurring({
      ...draft,
      toAccountId: spending ? undefined : draft.toAccountId,
      categoryId: draft.categoryId || undefined,
      payee: draft.payee?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
      usage: draft.kind === 'subscription' ? draft.usage : undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(existing ? `${draft.name.trim()} updated` : `${draft.name.trim()} added`);
    goBackOr(router, existing ? `/bills/${existing.id}` : '/bills');
  };

  const title = existing ? 'Edit recurring payment' : draft.kind === 'subscription' ? 'New subscription' : 'New recurring payment';

  return (
    <Screen header={<NavHeader title={title} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      <ChipSelect
        label="Kind"
        options={KIND_ORDER.map((k) => ({ value: k, label: RECURRING_KINDS[k].label, icon: icon(RECURRING_KINDS[k].icon) }))}
        value={draft.kind}
        onChange={changeKind}
        hint={KIND_HINT[draft.kind]}
      />

      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}
      {existing && <Banner tone="muted" icon="info" title="Past payments stay as they are" message="Changing the amount or schedule only affects due dates that haven't been paid yet." />}

      <Stack gap={spacing.lg}>
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(t) => set('name', t)}
          placeholder={draft.kind === 'subscription' ? 'e.g. Netflix' : draft.kind === 'bill' ? 'e.g. Rent' : draft.kind === 'debt_payment' ? 'e.g. Car loan payment' : 'e.g. Monthly savings'}
          error={errors.name}
          autoFocus={!existing}
        />
        <MoneyField
          label={draft.variable ? 'Estimated amount' : 'Amount'}
          value={draft.amount || undefined}
          onChange={(c) => set('amount', (c ?? 0) as Cents)}
          error={errors.amount}
          hint={draft.variable ? 'Used for forecasts. You enter the actual amount when you pay.' : undefined}
        />
        <View style={styles.group}>
          <SwitchRow label="Amount varies" description="Utilities, usage-based plans. Treated as an estimate." value={draft.variable} onChange={(v) => set('variable', v)} />
        </View>
        <FrequencySelect value={draft.frequency} onChange={(f) => set('frequency', f)} error={errors.frequency} />
        <DateField label="First due date" value={draft.startDate} onChange={(d) => set('startDate', d ?? today)} error={errors.startDate} hint="Later due dates are calculated from this one." />
        <DateField label="Ends" value={draft.endDate} onChange={(d) => set('endDate', d)} error={errors.endDate} optional clearable hint="Leave empty if it continues indefinitely." />
      </Stack>

      <Stack gap={spacing.lg}>
        <AccountSelect label="Paid from" value={draft.accountId || undefined} onChange={(id) => set('accountId', id)} filter={spending ? undefined : isAsset} error={errors.accountId} />
        {!spending && <AccountSelect label={TO_LABEL[draft.kind] ?? 'Goes to'} value={draft.toAccountId} onChange={(id) => set('toAccountId', id)} filter={toFilter} error={errors.toAccountId} />}
        {spending && <CategorySelect kind="expense" value={draft.categoryId} onChange={(id) => set('categoryId', id)} error={errors.categoryId} optional />}
        <TextField label="Payee" value={draft.payee ?? ''} onChangeText={(t) => set('payee', t)} optional placeholder="Who gets paid" />
      </Stack>

      <View style={styles.group}>
        <SwitchRow label="Autopay" description={draft.autopay ? 'Paid automatically. Still mark it paid to keep balances right.' : 'You pay this manually.'} value={draft.autopay} onChange={(v) => set('autopay', v)} />
        {spending && <SwitchRow label="Essential" description={draft.essential ? 'Needed expense' : 'Discretionary: nice to have'} value={draft.essential} onChange={(v) => set('essential', v)} />}
      </View>

      {draft.kind === 'subscription' && (
        <ChipSelect label="How often do you use it?" options={USAGE_OPTIONS} value={draft.usage} onChange={(u) => set('usage', draft.usage === u ? undefined : u)} hint="Rarely used subscriptions are flagged on the Subscriptions screen." />
      )}

      <Stack gap={spacing.lg}>
        <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional placeholder="Account number hint, cancellation steps…" />
      </Stack>
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
});
