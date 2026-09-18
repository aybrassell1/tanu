import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { accountOptions } from '@/components/finance/Pickers';
import { Banner, Button, IconTile, ListCard, ListRow, MoneyField, NumberField, Row, Segmented, SelectField, Sheet, Text, TextField, type SelectOption } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { isDebt } from '@/domain/catalog';
import { addMonthsToMonth, formatMonth } from '@/domain/dates';
import { createId } from '@/domain/factory';
import { frequencyLabel } from '@/domain/recurrence';
import type { Baseline } from '@/domain/scenarios';
import type { Cents, ID, ScenarioChange } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export type ChangeType = ScenarioChange['type'];

export const CHANGE_TYPES: { type: ChangeType; label: string; description: string; icon: IconName }[] = [
  { type: 'income_change', label: 'Income changes', description: 'A raise, a pay cut or a new job', icon: 'briefcase' },
  { type: 'expense_change', label: 'Spending changes', description: 'A new monthly cost, or spending less', icon: 'shopping-bag' },
  { type: 'change_recurring', label: 'A bill changes', description: 'Rent, insurance or a plan costs a different amount', icon: 'edit-3' },
  { type: 'cancel_recurring', label: 'Cancel a bill or subscription', description: 'Stop paying for something', icon: 'x-circle' },
  { type: 'extra_debt_payment', label: 'Pay extra toward debt', description: 'An extra amount every month', icon: 'trending-down' },
  { type: 'one_time', label: 'One-time expense or windfall', description: 'A trip, a repair, a bonus or a tax refund', icon: 'zap' },
  { type: 'new_loan', label: 'Take out a loan', description: 'Buy a car or finance a big purchase', icon: 'truck' },
  { type: 'savings_contribution', label: 'Save more per paycheck', description: 'Move more into savings each payday', icon: 'shield' },
];

export const isChangeType = (value: string | undefined): value is ChangeType => CHANGE_TYPES.some((t) => t.type === value);
export const changeTypeInfo = (type: ChangeType) => CHANGE_TYPES.find((t) => t.type === type)!;

const ALL_DEBTS = 'all';

type Draft = {
  mode: 'amount' | 'percent';
  amount?: Cents;
  percent?: number;
  label: string;
  recurringId?: ID;
  accountId: string;
  sign: 'expense' | 'windfall';
  price?: Cents;
  down?: Cents;
  principal?: Cents;
  principalEdited: boolean;
  apr?: number;
  term?: number;
  /** 1-based month in the UI; stored 0-based. */
  start?: number;
};

function draftFrom(type: ChangeType, change?: ScenarioChange): Draft {
  const base: Draft = { mode: 'amount', label: type === 'new_loan' ? 'Car' : '', accountId: ALL_DEBTS, sign: 'expense', principalEdited: false, start: 1, term: type === 'new_loan' ? 60 : undefined };
  if (!change) return base;
  switch (change.type) {
    case 'income_change':
      return { ...base, mode: change.mode, amount: change.mode === 'amount' ? change.value : undefined, percent: change.mode === 'percent' ? change.value : undefined, start: change.startMonth + 1 };
    case 'expense_change':
      return { ...base, label: change.label, amount: change.monthlyAmount, start: change.startMonth + 1 };
    case 'cancel_recurring':
      return { ...base, recurringId: change.recurringId, start: change.startMonth + 1 };
    case 'change_recurring':
      return { ...base, recurringId: change.recurringId, amount: change.newAmount, start: change.startMonth + 1 };
    case 'extra_debt_payment':
      return { ...base, amount: change.monthlyAmount, accountId: change.accountId ?? ALL_DEBTS, start: change.startMonth + 1 };
    case 'one_time':
      return { ...base, label: change.label, amount: Math.abs(change.amount), sign: change.amount < 0 ? 'expense' : 'windfall', start: change.month + 1 };
    case 'new_loan':
      return { ...base, label: change.label, price: change.assetValue, down: change.downPayment, principal: change.principal, principalEdited: true, apr: change.apr, term: change.termMonths, start: change.startMonth + 1 };
    case 'savings_contribution':
      return { ...base, amount: change.perPaycheck, start: change.startMonth + 1 };
  }
}

type Errors = Partial<Record<'amount' | 'label' | 'recurringId' | 'accountId' | 'price' | 'down' | 'principal' | 'apr' | 'term' | 'start', string>>;

function buildChange(type: ChangeType, d: Draft, id: ID, horizon: number): { change?: ScenarioChange; errors: Errors } {
  const errors: Errors = {};
  const start = (d.start ?? 1) - 1;
  if (d.start === undefined || !Number.isInteger(d.start) || d.start < 1 || d.start > horizon) errors.start = `Pick a month from 1 to ${horizon}.`;
  const needLabel = () => {
    if (!d.label.trim()) errors.label = 'Give this a name.';
  };
  const positive = (value: number | undefined, key: keyof Errors, message = 'Enter an amount above zero.') => {
    if (value === undefined || value <= 0) errors[key] = message;
  };

  let change: ScenarioChange | undefined;
  switch (type) {
    case 'income_change':
      if (d.mode === 'amount') {
        if (!d.amount) errors.amount = 'Enter how much monthly income changes (negative for a cut).';
      } else if (d.percent === undefined || d.percent === 0 || d.percent <= -100) errors.amount = 'Enter a percent change, e.g. 5 or -10.';
      change = { id, type, mode: d.mode, value: d.mode === 'amount' ? d.amount ?? 0 : d.percent ?? 0, startMonth: start };
      break;
    case 'expense_change':
      needLabel();
      if (!d.amount) errors.amount = 'Enter a monthly amount (negative to spend less).';
      change = { id, type, label: d.label.trim(), monthlyAmount: d.amount ?? 0, startMonth: start };
      break;
    case 'cancel_recurring':
      if (!d.recurringId) errors.recurringId = 'Choose what to cancel.';
      change = { id, type, recurringId: d.recurringId ?? '', startMonth: start };
      break;
    case 'change_recurring':
      if (!d.recurringId) errors.recurringId = 'Choose which bill changes.';
      if (d.amount === undefined || d.amount < 0) errors.amount = 'Enter the new amount.';
      change = { id, type, recurringId: d.recurringId ?? '', newAmount: d.amount ?? 0, startMonth: start };
      break;
    case 'extra_debt_payment':
      positive(d.amount, 'amount');
      change = { id, type, monthlyAmount: d.amount ?? 0, accountId: d.accountId === ALL_DEBTS ? undefined : d.accountId, startMonth: start };
      break;
    case 'one_time':
      needLabel();
      positive(d.amount, 'amount');
      change = { id, type, label: d.label.trim(), amount: d.sign === 'expense' ? -(d.amount ?? 0) : d.amount ?? 0, month: start };
      break;
    case 'new_loan':
      needLabel();
      if (d.price === undefined) errors.price = 'Enter the price.';
      if ((d.down ?? 0) > (d.price ?? 0)) errors.down = "The down payment can't be more than the price.";
      if (d.principal === undefined) errors.principal = 'Enter the loan amount.';
      if (d.apr === undefined || d.apr < 0 || d.apr > 100) errors.apr = 'Enter an APR between 0 and 100.';
      if (d.term === undefined || !Number.isInteger(d.term) || d.term < 1 || d.term > 480) errors.term = 'Enter a term in whole months.';
      change = { id, type, label: d.label.trim(), principal: d.principal ?? 0, apr: d.apr ?? 0, termMonths: d.term ?? 1, downPayment: d.down ?? 0, assetValue: d.price ?? 0, startMonth: start };
      break;
    case 'savings_contribution':
      positive(d.amount, 'amount');
      change = { id, type, perPaycheck: d.amount ?? 0, startMonth: start };
      break;
  }
  return Object.keys(errors).length ? { errors } : { change, errors };
}

type ChangeSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** Open straight on this change type's form. */
  initialType?: ChangeType;
  editing?: ScenarioChange;
  horizon: number;
  baseline: Baseline;
  onSave: (change: ScenarioChange) => void;
};

export function ChangeSheet({ visible, onClose, initialType, editing, horizon, baseline, onSave }: ChangeSheetProps) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const [type, setType] = useState<ChangeType | null>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFrom('income_change'));
  const [errors, setErrors] = useState<Errors>({});

  useEffect(() => {
    if (!visible) return;
    const t = editing?.type ?? initialType ?? null;
    setType(t);
    setDraft(draftFrom(t ?? 'income_change', editing));
    setErrors({});
  }, [visible, editing, initialType]);

  const choose = (t: ChangeType) => {
    setType(t);
    setDraft(draftFrom(t));
    setErrors({});
  };
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const recurringOptions = useMemo<SelectOption<ID>[]>(
    () => baseline.recurring.map((r) => ({ value: r.id, label: r.name, description: `${money(r.monthly)} a month · ${frequencyLabel(r.frequency)}` })),
    [baseline.recurring, money],
  );
  const debtOptions = useMemo<SelectOption<string>[]>(
    () => [{ value: ALL_DEBTS, label: 'All debts (split by balance)', icon: 'layers' }, ...accountOptions(data, today, (a) => isDebt(a.type))],
    [data, today],
  );

  const save = () => {
    if (!type) return;
    const result = buildChange(type, draft, editing?.id ?? createId('chg'), horizon);
    setErrors(result.errors);
    if (result.change) onSave(result.change);
  };

  const startHint = (label: string) =>
    draft.start && draft.start >= 1 && draft.start <= horizon ? `${label} ${formatMonth(addMonthsToMonth(baseline.startMonth, draft.start - 1))}` : `Month 1 is ${formatMonth(baseline.startMonth)}`;
  const startField = (label = 'Starting in month') => (
    <NumberField label={label} value={draft.start} onChange={(n) => set('start', n)} integer error={errors.start} hint={startHint(label === 'In month' ? 'Happens in' : 'Starts')} />
  );

  const info = type ? changeTypeInfo(type) : null;
  const selectedRecurring = draft.recurringId ? data.recurring.find((r) => r.id === draft.recurringId) : undefined;

  const noRecurring = (
    <Banner
      tone="muted"
      icon="info"
      title="No active bills or subscriptions"
      message="Add them under Bills & recurring, or model the cost as a spending change."
      action={<Button label="Use a spending change" size="sm" variant="secondary" onPress={() => choose('expense_change')} />}
    />
  );

  const form = () => {
    switch (type) {
      case 'income_change':
        return (
          <>
            <Segmented
              items={[
                { value: 'amount', label: '$ per month' },
                { value: 'percent', label: '%' },
              ]}
              value={draft.mode}
              onChange={(m) => set('mode', m)}
            />
            {draft.mode === 'amount' ? (
              <MoneyField label="Change in monthly income" value={draft.amount} onChange={(c) => set('amount', c)} allowNegative error={errors.amount} hint={`Use a negative amount for a pay cut. Today: ${money(baseline.monthlyIncome)} a month.`} />
            ) : (
              <NumberField label="Change in income" suffix="%" value={draft.percent} onChange={(n) => set('percent', n)} error={errors.amount} hint="e.g. 5 for a 5% raise, -10 for a 10% cut" />
            )}
            {startField()}
          </>
        );
      case 'expense_change':
        return (
          <>
            <TextField label="What is it?" value={draft.label} onChangeText={(t) => set('label', t)} placeholder="e.g. Gym, childcare, eating out less" error={errors.label} />
            <MoneyField label="Change per month" value={draft.amount} onChange={(c) => set('amount', c)} allowNegative error={errors.amount} hint="Use a negative amount to spend less." />
            {startField()}
          </>
        );
      case 'cancel_recurring':
        return (
          <>
            {recurringOptions.length === 0 ? noRecurring : <SelectField label="Cancel" value={draft.recurringId} onChange={(v) => set('recurringId', v)} options={recurringOptions} placeholder="Choose a bill or subscription" error={errors.recurringId} />}
            {startField('Cancelled from month')}
          </>
        );
      case 'change_recurring':
        return (
          <>
            {recurringOptions.length === 0 ? noRecurring : <SelectField label="Which bill?" value={draft.recurringId} onChange={(v) => set('recurringId', v)} options={recurringOptions} placeholder="Choose a bill or subscription" error={errors.recurringId} />}
            <MoneyField
              label="New amount each time"
              value={draft.amount}
              onChange={(c) => set('amount', c)}
              error={errors.amount}
              hint={selectedRecurring ? `Currently ${money(selectedRecurring.amount)} ${frequencyLabel(selectedRecurring.frequency).toLowerCase()}` : 'Per occurrence, on the same schedule'}
            />
            {startField()}
          </>
        );
      case 'extra_debt_payment':
        return (
          <>
            {baseline.debts.length === 0 && <Banner tone="muted" icon="info" title="No debts with a balance" message="Extra payments only matter once there's something owed." />}
            <MoneyField label="Extra each month" value={draft.amount} onChange={(c) => set('amount', c)} error={errors.amount} />
            <SelectField label="Toward" value={draft.accountId} onChange={(v) => set('accountId', v)} options={debtOptions} error={errors.accountId} />
            {startField()}
          </>
        );
      case 'one_time':
        return (
          <>
            <TextField label="What is it?" value={draft.label} onChangeText={(t) => set('label', t)} placeholder="e.g. Vacation, tax refund" error={errors.label} />
            <Segmented
              items={[
                { value: 'expense', label: 'Expense' },
                { value: 'windfall', label: 'Windfall' },
              ]}
              value={draft.sign}
              onChange={(v) => set('sign', v)}
            />
            <MoneyField label="Amount" value={draft.amount} onChange={(c) => set('amount', c)} error={errors.amount} />
            {startField('In month')}
          </>
        );
      case 'new_loan': {
        const updateLoan = (patch: Partial<Draft>) =>
          setDraft((d) => {
            const next = { ...d, ...patch };
            if (!next.principalEdited) next.principal = Math.max(0, (next.price ?? 0) - (next.down ?? 0));
            return next;
          });
        return (
          <>
            <TextField label="What are you buying?" value={draft.label} onChangeText={(t) => set('label', t)} placeholder="Car" error={errors.label} />
            <MoneyField label="Price" value={draft.price} onChange={(c) => updateLoan({ price: c })} error={errors.price} hint="Counted as an asset at this value, held constant." />
            <MoneyField label="Down payment" value={draft.down} onChange={(c) => updateLoan({ down: c })} error={errors.down} optional />
            <MoneyField label="Loan amount" value={draft.principal} onChange={(c) => setDraft((d) => ({ ...d, principal: c, principalEdited: true }))} error={errors.principal} hint="Price minus down payment unless you change it." />
            <Row gap={spacing.sm} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <NumberField label="APR" suffix="%" value={draft.apr} onChange={(n) => set('apr', n)} error={errors.apr} placeholder="7.5" />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField label="Term" suffix="months" value={draft.term} onChange={(n) => set('term', n)} integer error={errors.term} />
              </View>
            </Row>
            {startField('Buy in month')}
          </>
        );
      }
      case 'savings_contribution':
        return (
          <>
            <MoneyField label="Extra per paycheck" value={draft.amount} onChange={(c) => set('amount', c)} error={errors.amount} hint={`About ${baseline.paychecksPerMonth.toFixed(1)} paychecks a month.`} />
            {startField()}
          </>
        );
      default:
        return null;
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={info ? info.label : 'Add a change'}
      subtitle={info ? 'Hypothetical — your real data never changes.' : 'What would you like to try?'}
      footer={
        type ? (
          <Row gap={spacing.sm}>
            {!editing && <Button label="Back" variant="secondary" size="lg" onPress={() => setType(null)} />}
            <Button label={editing ? 'Save change' : 'Add change'} size="lg" onPress={save} style={{ flex: 1 }} />
          </Row>
        ) : undefined
      }
    >
      {type ? (
        form()
      ) : (
        <ListCard>
          {CHANGE_TYPES.map((t) => (
            <ListRow key={t.type} title={t.label} subtitle={t.description} leading={<IconTile icon={t.icon} color={colors.projected} />} chevron onPress={() => choose(t.type)} />
          ))}
        </ListCard>
      )}
      {type && (
        <Text variant="caption" color={colors.textTertiary}>
          {`Month 1 is ${formatMonth(baseline.startMonth)}. This scenario looks ${horizon} months ahead.`}
        </Text>
      )}
    </Sheet>
  );
}
