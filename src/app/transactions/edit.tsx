import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { AccountSelect, CategorySelect } from '@/components/finance/Pickers';
import { SplitEditor } from '@/components/finance/SplitEditor';
import {
  Banner,
  Button,
  Disclosure,
  DateField,
  Field,
  MoneyField,
  NavHeader,
  Pill,
  Screen,
  SelectField,
  Stack,
  SwitchRow,
  TagInput,
  Text,
  TextField,
  useOverlay,
  type SelectOption,
} from '@/components/ui';
import { icon } from '@/data/icons';
import { accountNature, isInvestment, RECURRING_KINDS, TRANSACTION_TYPES } from '@/domain/catalog';
import { formatDate, localDateOf } from '@/domain/dates';
import { SYSTEM_CATEGORY } from '@/domain/defaultCategories';
import { indexLedger } from '@/domain/ledger';
import { allTags } from '@/domain/search';
import { INCOME_TAX_LABEL, TAX_TAGS } from '@/domain/taxes';
import type { Account, Attachment, Cents, ID, ISODate, TaxTag, Transaction, TransactionType } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { pickAttachment } from '@/store/fileIO';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';
import { createId } from '@/domain/factory';

const TYPE_ORDER: TransactionType[] = ['expense', 'income', 'transfer', 'debt_payment', 'investment_contribution', 'investment_withdrawal', 'refund', 'reimbursement', 'interest', 'adjustment'];

const TO_FILTER: Partial<Record<TransactionType, (a: Account) => boolean>> = {
  debt_payment: (a) => accountNature(a.type) === 'liability',
  investment_contribution: (a) => isInvestment(a.type),
  investment_withdrawal: (a) => accountNature(a.type) === 'asset' && !isInvestment(a.type),
};
const FROM_FILTER: Partial<Record<TransactionType, (a: Account) => boolean>> = {
  income: (a) => accountNature(a.type) === 'asset',
  debt_payment: (a) => accountNature(a.type) === 'asset',
  investment_contribution: (a) => accountNature(a.type) === 'asset' && !isInvestment(a.type),
  investment_withdrawal: (a) => isInvestment(a.type),
  interest: (a) => accountNature(a.type) === 'liability',
};

type Draft = Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

const TAX_TAG_OPTIONS = (Object.keys(TAX_TAGS) as TaxTag[]).map((k) => ({ value: k, label: TAX_TAGS[k].label, emoji: TAX_TAGS[k].emoji, description: TAX_TAGS[k].hint }));

export default function TransactionFormScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: TransactionType; accountId?: string; toAccountId?: string; duplicate?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const index = indexLedger(data);
  const existing = params.id ? index.transactions.get(params.id) : undefined;
  // Interest charges belong in the built-in interest category unless the user picks another.
  const interestCategory = index.categories.has(SYSTEM_CATEGORY.interest) ? SYSTEM_CATEGORY.interest : undefined;

  const [draft, setDraft] = useState<Draft>(() =>
    existing
      ? { ...existing, ...(params.duplicate ? { id: undefined, date: today, recurringId: undefined, occurrenceDate: undefined, attachments: [] } : {}) }
      : {
          type: params.type ?? 'expense',
          amount: 0,
          date: today,
          description: '',
          accountId: params.accountId ?? '',
          toAccountId: params.toAccountId,
          categoryId: params.type === 'interest' ? interestCategory : undefined,
          tags: [],
          attachments: [],
        },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const info = TRANSACTION_TYPES[draft.type];
  const isSpending = ['expense', 'refund', 'reimbursement', 'interest'].includes(draft.type);
  const category = draft.categoryId ? index.categories.get(draft.categoryId) : undefined;
  const suggestedTax = category?.taxTag;
  const taxOn = draft.taxRelated ?? !!suggestedTax;
  const essential = draft.essential ?? category?.essential ?? false;

  const recurringOptions = useMemo<SelectOption<ID>[]>(
    () => [
      { value: '', label: 'Not recurring' },
      ...data.recurring
        .filter((r) => RECURRING_KINDS[r.kind].txType === draft.type || (draft.type === 'transfer' && r.kind === 'savings'))
        .map((r) => ({ value: r.id, label: r.name, description: RECURRING_KINDS[r.kind].label, icon: icon(RECURRING_KINDS[r.kind].icon) })),
    ],
    [data.recurring, draft.type],
  );
  const incomeOptions = useMemo<SelectOption<ID>[]>(() => [{ value: '', label: 'No source' }, ...data.incomeSources.map((s) => ({ value: s.id, label: s.name }))], [data.incomeSources]);
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);

  const changeType = (type: TransactionType) => {
    setErrors({});
    setDraft((d) => {
      const next = { ...d, type };
      const nextInfo = TRANSACTION_TYPES[type];
      if (!nextInfo.twoAccounts) next.toAccountId = undefined;
      const cat = next.categoryId ? index.categories.get(next.categoryId) : undefined;
      if (!nextInfo.category || (cat && cat.kind !== nextInfo.category)) next.categoryId = undefined;
      if (type === 'interest' && !next.categoryId) next.categoryId = interestCategory;
      if (type !== 'income') next.incomeSourceId = undefined;
      if (type === 'adjustment') next.adjustmentKind = next.adjustmentKind ?? 'reconcile';
      return next;
    });
  };

  const save = () => {
    const result = ledger.saveTransaction({
      ...draft,
      categoryId: draft.type === 'interest' ? draft.categoryId || interestCategory : draft.categoryId,
      essential: isSpending ? draft.essential : undefined,
      recurringId: draft.recurringId || undefined,
      occurrenceDate: draft.recurringId ? draft.occurrenceDate ?? draft.date : undefined,
      incomeSourceId: draft.incomeSourceId || undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast({ message: existing && !params.duplicate ? 'Transaction updated' : 'Transaction saved', actionLabel: 'Undo', onAction: ledger.undo });
    goBackOr(router, existing && !params.duplicate ? `/transactions/${existing.id}` : '/transactions');
  };

  const addAttachment = async () => {
    try {
      const file = await pickAttachment();
      if (file) set('attachments', [...draft.attachments, { id: createId('att'), ...file } as Attachment]);
    } catch (e) {
      toast({ message: e instanceof Error ? e.message : 'Could not add that file.', tone: 'error' });
    }
  };

  const title = existing && !params.duplicate ? 'Edit transaction' : params.duplicate ? 'Duplicate transaction' : 'New transaction';

  return (
    <Screen header={<NavHeader title={title} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      <Stack gap={spacing.sm}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {TYPE_ORDER.map((t) => (
            <Pill key={t} label={TRANSACTION_TYPES[t].label} icon={icon(TRANSACTION_TYPES[t].icon)} selected={draft.type === t} onPress={() => changeType(t)} />
          ))}
        </ScrollView>
        <Text variant="small" color={colors.textSecondary}>
          {info.description}
        </Text>
      </Stack>

      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <MoneyField
          label={draft.type === 'adjustment' ? 'Change in balance' : 'Amount'}
          value={draft.amount || undefined}
          onChange={(c) => set('amount', (c ?? 0) as Cents)}
          allowNegative={draft.type === 'adjustment'}
          hint={draft.type === 'adjustment' ? 'Positive raises the balance (or what is owed); negative lowers it. To set an exact balance, use Update balance.' : undefined}
          error={errors.amount}
          autoFocus={!existing}
        />
        <DateField label="Date" value={draft.date} onChange={(d) => set('date', (d ?? today) as ISODate)} shortcuts error={errors.date} hint={draft.date > today ? 'Future-dated: counts toward forecasts, not your current balance.' : undefined} />
        <TextField label={draft.type === 'income' ? 'Payer' : 'Merchant / payee'} value={draft.payee ?? ''} onChangeText={(t) => set('payee', t)} optional placeholder="e.g. Trader Joe's" />
        <TextField label="Description" value={draft.description} onChangeText={(t) => set('description', t)} error={errors.description} placeholder={info.label} optional={!!draft.payee} />
      </Stack>

      <Stack gap={spacing.lg}>
        <AccountSelect
          label={info.twoAccounts ? 'From account' : draft.type === 'income' || draft.type === 'refund' || draft.type === 'reimbursement' ? 'Into account' : draft.type === 'interest' ? 'Charged to' : 'Account'}
          value={draft.accountId || undefined}
          onChange={(id) => set('accountId', id)}
          filter={FROM_FILTER[draft.type]}
          error={errors.accountId}
        />
        {info.twoAccounts && <AccountSelect label="To account" value={draft.toAccountId} onChange={(id) => set('toAccountId', id)} filter={TO_FILTER[draft.type]} error={errors.toAccountId} />}
        {info.category && !draft.splits?.length && (
          <CategorySelect kind={info.category} value={draft.categoryId} onChange={(id) => set('categoryId', id)} error={errors.categoryId} optional={draft.type !== 'expense'} />
        )}
        {isSpending && draft.type !== 'interest' && (
          <SplitEditor total={draft.amount} splits={draft.splits} onChange={(splits) => set('splits', splits)} categoryId={draft.categoryId} error={errors.splits} />
        )}
        {draft.type === 'income' && data.incomeSources.length > 0 && (
          <SelectField label="Income source" value={draft.incomeSourceId ?? ''} onChange={(id) => set('incomeSourceId', id || undefined)} options={incomeOptions} optional />
        )}
        {draft.type === 'adjustment' && (
          <SelectField
            label="Kind of adjustment"
            value={draft.adjustmentKind ?? 'reconcile'}
            onChange={(k) => set('adjustmentKind', k)}
            options={[
              { value: 'reconcile', label: 'Balance correction', description: 'Match what your bank or app shows' },
              { value: 'valuation', label: 'Market value change', description: 'Investment gains or losses' },
              { value: 'other', label: 'Other' },
            ]}
          />
        )}
      </Stack>

      {isSpending && (
        <View style={styles.group}>
          <SwitchRow label="Essential" description={essential ? 'Needed expense (rent, groceries, insurance)' : 'Discretionary: nice to have'} value={essential} onChange={(v) => set('essential', v)} />
        </View>
      )}

      <Disclosure label="More details" initiallyOpen={!!(draft.taxRelated || draft.recurringId || draft.tags.length || draft.notes || draft.attachments.length)}>
        <Stack gap={spacing.lg}>
          {isSpending && (
            <View style={styles.group}>
              <SwitchRow
                label="Counts for taxes"
                description={suggestedTax && draft.taxRelated === undefined ? `Suggested by category: ${TAX_TAGS[suggestedTax].label}` : 'Shows in the Taxes hub and tax export'}
                value={taxOn}
                onChange={(v) => setDraft((d) => ({ ...d, taxRelated: v, taxCategory: v ? (d.taxCategory && d.taxCategory in TAX_TAGS ? d.taxCategory : suggestedTax ?? 'other') : undefined }))}
              />
              {taxOn && (
                <SelectField
                  label="Tax item"
                  value={draft.taxCategory && draft.taxCategory in TAX_TAGS ? (draft.taxCategory as TaxTag) : suggestedTax ?? 'other'}
                  onChange={(tag) => setDraft((d) => ({ ...d, taxRelated: true, taxCategory: tag }))}
                  options={TAX_TAG_OPTIONS}
                  hint={TAX_TAGS[(draft.taxCategory as TaxTag) in TAX_TAGS ? (draft.taxCategory as TaxTag) : suggestedTax ?? 'other'].hint}
                />
              )}
            </View>
          )}
          {draft.type === 'income' && category?.incomeTax && (
            <Text variant="small" color={colors.textSecondary}>
              Taxed as: {INCOME_TAX_LABEL[category.incomeTax]}
            </Text>
          )}
          {recurringOptions.length > 1 && (
            <>
              <SelectField label="Recurring payment" value={draft.recurringId ?? ''} onChange={(id) => set('recurringId', id || undefined)} options={recurringOptions} optional hint="Linking marks that bill's occurrence as paid so it isn't counted twice." />
              {!!draft.recurringId && <DateField label="Which due date does this pay?" value={draft.occurrenceDate ?? draft.date} onChange={(d) => set('occurrenceDate', d)} />}
            </>
          )}
          <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
          <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional />
          <Field label="Receipts & attachments" optional>
            <View style={{ gap: spacing.sm }}>
              {draft.attachments.map((a) => (
                <View key={a.id} style={styles.attachment}>
                  <Feather name={a.mimeType?.startsWith('image') ? 'image' : 'file'} size={16} color={colors.textSecondary} />
                  <Text style={{ flex: 1 }} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Pressable onPress={() => set('attachments', draft.attachments.filter((x) => x.id !== a.id))} accessibilityLabel={`Remove ${a.name}`} hitSlop={8}>
                    <Feather name="x" size={16} color={colors.textTertiary} />
                  </Pressable>
                </View>
              ))}
              <Button label="Attach receipt" icon="paperclip" variant="secondary" onPress={addAttachment} />
            </View>
          </Field>
        </Stack>
      </Disclosure>

      {existing && !params.duplicate && (
        <Text variant="caption" color={colors.textTertiary} align="center">
          Created {formatDate(localDateOf(existing.createdAt), 'medium')}
        </Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  attachment: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md },
});
