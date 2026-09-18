import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AddedAccount, AddedThing, ordinal, StepDots, StepTitle, SuggestionChip } from '@/components/setup/Parts';
import {
  Button,
  Card,
  DateField,
  Money,
  MoneyField,
  NavHeader,
  NumberField,
  Screen,
  SelectField,
  Sheet,
  Text,
  TextField,
  useOverlay,
  type SelectOption,
} from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { ACCOUNT_EMOJI, categoryEmoji } from '@/data/visuals';
import { ACCOUNT_TYPES, isDebt, isLiquid } from '@/domain/catalog';
import { formatDate, nextDayOfMonth } from '@/domain/dates';
import { frequencyLabel } from '@/domain/recurrence';
import { BILL_PRESETS, SETUP_ACCOUNTS, setupSummary, startingBalanceLabel, type BillPreset } from '@/domain/setup';
import type { AccountType, Cents, Frequency, ID, ISODate } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

/**
 * First-run setup. Each step writes straight to the ledger as you go, so
 * nothing is lost if you stop halfway and everything can be edited later in
 * the normal screens. Every step can be skipped.
 */

const STEPS = ['Accounts', 'Debts', 'Income', 'Bills', 'Done'] as const;

const PAY_FREQUENCIES: { value: string; label: string; frequency: Frequency }[] = [
  { value: 'weekly', label: 'Every week', frequency: { unit: 'week', interval: 1 } },
  { value: 'biweekly', label: 'Every 2 weeks', frequency: { unit: 'week', interval: 2 } },
  { value: 'semimonthly', label: 'Twice a month', frequency: { unit: 'day', interval: 15 } },
  { value: 'monthly', label: 'Monthly', frequency: { unit: 'month', interval: 1 } },
];

export default function SetupScreen() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const data = useData();
  const accounts = data.accounts.filter((a) => !a.archived);
  const cash = accounts.filter((a) => isLiquid(a.type));
  const debts = accounts.filter((a) => isDebt(a.type));

  const finish = () => {
    ledger.completeOnboarding();
    router.replace('/');
  };

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => (step === 0 ? router.back() : setStep((s) => s - 1));

  return (
    <Screen
      header={<NavHeader title={`Set up · ${STEPS[step]}`} onBack={back} right={step < STEPS.length - 1 ? <Button label="Skip" variant="ghost" size="sm" onPress={finish} /> : undefined} />}
      footer={
        step === STEPS.length - 1 ? (
          <Button label="Start using Tanu" size="lg" fullWidth onPress={finish} />
        ) : (
          <Button label={stepIsEmpty(step, { cash: cash.length, debts: debts.length, income: data.incomeSources.length, bills: data.recurring.length }) ? 'Not now' : 'Next'} size="lg" fullWidth onPress={next} />
        )
      }
    >
      <StepDots step={step} total={STEPS.length} />
      {step === 0 && <AccountsStep />}
      {step === 1 && <DebtsStep />}
      {step === 2 && <IncomeStep />}
      {step === 3 && <BillsStep />}
      {step === 4 && <DoneStep />}
    </Screen>
  );
}

const stepIsEmpty = (step: number, counts: { cash: number; debts: number; income: number; bills: number }) =>
  (step === 0 && counts.cash === 0) || (step === 1 && counts.debts === 0) || (step === 2 && counts.income === 0) || (step === 3 && counts.bills === 0);

// ─── 1. Accounts ─────────────────────────────────────────────────────────────

function AccountsStep() {
  const data = useData();
  const [adding, setAdding] = useState<AccountType | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const mine = data.accounts.filter((a) => !a.archived && !isDebt(a.type));

  return (
    <>
      <StepTitle title="What do you have?" subtitle="Start with the account you spend from. Balances are today's, and you can change them any time." />

      <View style={styles.chips}>
        {SETUP_ACCOUNTS.filter((g) => g.group !== 'Cards' && g.group !== 'Loans').map((group) =>
          group.types.map((type) => (
            <SuggestionChip key={type} emoji={ACCOUNT_EMOJI[type]} label={ACCOUNT_TYPES[type].label} onPress={() => setAdding(type)} />
          )),
        )}
      </View>

      {mine.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {mine.map((a) => (
            <AddedAccount key={a.id} account={a} onPress={() => setEditing(a.id)} />
          ))}
        </View>
      )}

      <Text variant="caption" color={colors.textTertiary}>
        Cards and loans come next.
      </Text>

      <AccountSheet type={adding} id={editing} onClose={() => (setAdding(null), setEditing(null))} />
    </>
  );
}

// ─── 2. Cards & loans ────────────────────────────────────────────────────────

function DebtsStep() {
  const data = useData();
  const [adding, setAdding] = useState<AccountType | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const mine = data.accounts.filter((a) => !a.archived && isDebt(a.type));

  return (
    <>
      <StepTitle title="Anything you owe?" subtitle="Cards and loans. The due day is what lets Tanu warn you before a payment lands." />

      <View style={styles.chips}>
        {SETUP_ACCOUNTS.filter((g) => g.group === 'Cards' || g.group === 'Loans').map((group) =>
          group.types.map((type) => (
            <SuggestionChip key={type} emoji={ACCOUNT_EMOJI[type]} label={ACCOUNT_TYPES[type].label} onPress={() => setAdding(type)} />
          )),
        )}
      </View>

      {mine.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {mine.map((a) => (
            <AddedAccount key={a.id} account={a} onPress={() => setEditing(a.id)} />
          ))}
        </View>
      )}

      <AccountSheet type={adding} id={editing} onClose={() => (setAdding(null), setEditing(null))} />
    </>
  );
}

function AccountSheet({ type, id, onClose }: { type: AccountType | null; id: ID | null; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const { confirm } = useOverlay();
  const existing = id ? data.accounts.find((a) => a.id === id) : undefined;
  const kind = existing?.type ?? type;
  const [draft, setDraft] = useState<{ name: string; balance?: Cents; limit?: Cents; apr?: number; payment?: Cents; dueDay?: number }>({ name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = existing?.id ?? type ?? null;
  if (key !== openedFor) {
    setOpenedFor(key);
    setDraft(
      existing
        ? { name: existing.name, balance: existing.startingBalance, limit: existing.creditLimit, apr: existing.apr, payment: existing.paymentAmount, dueDay: existing.dueDay }
        : { name: kind ? ACCOUNT_TYPES[kind].label : '' },
    );
    setErrors({});
  }
  if (!kind) return null;

  const info = ACCOUNT_TYPES[kind];
  const card = info.group === 'credit';
  const loan = info.group === 'loan';

  const save = () => {
    const result = ledger.saveAccount({
      id: existing?.id,
      name: draft.name.trim(),
      type: kind,
      startingBalance: draft.balance ?? 0,
      startingDate: existing?.startingDate ?? today,
      creditLimit: card ? draft.limit : undefined,
      apr: draft.apr,
      paymentAmount: loan ? draft.payment : undefined,
      minimumPayment: loan ? draft.payment : undefined,
      dueDay: draft.dueDay,
      plannedPayment: card ? 'statement' : undefined,
      spendable: info.group === 'cash',
      color: colors.primary,
      icon: info.icon,
      tags: [],
      archived: false,
    });
    if (!result.ok) return setErrors(result.errors);
    onClose();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : `Add ${info.label.toLowerCase()}`}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {existing && (
            <Button
              label="Remove"
              variant="secondary"
              onPress={async () => {
                if (await confirm({ title: `Remove ${existing.name}?`, message: 'You can add it again later.', confirmLabel: 'Remove', destructive: true })) {
                  ledger.deleteAccount(existing.id);
                  onClose();
                }
              }}
            />
          )}
          <Button label="Save" fullWidth={!existing} style={{ flex: 1 }} onPress={save} />
        </View>
      }
    >
      <TextField label="Name" value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))} placeholder={info.label} error={errors.name} autoFocus />
      <MoneyField label={startingBalanceLabel(kind)} value={draft.balance} onChange={(balance) => setDraft((d) => ({ ...d, balance }))} error={errors.startingBalance} autoFocus={false} />
      {card && <MoneyField label="Credit limit" optional value={draft.limit} onChange={(limit) => setDraft((d) => ({ ...d, limit }))} />}
      {loan && <MoneyField label="Payment each month" optional value={draft.payment} onChange={(payment) => setDraft((d) => ({ ...d, payment }))} />}
      {(card || loan) && (
        <>
          <NumberField label="Due day of the month" optional integer value={draft.dueDay} onChange={(dueDay) => setDraft((d) => ({ ...d, dueDay }))} placeholder="15" hint={draft.dueDay ? `Due the ${ordinal(draft.dueDay)}` : undefined} />
          <NumberField label="Interest rate" optional value={draft.apr} onChange={(apr) => setDraft((d) => ({ ...d, apr }))} suffix="% APR" />
        </>
      )}
    </Sheet>
  );
}

// ─── 3. Income ───────────────────────────────────────────────────────────────

function IncomeStep() {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ID | null>(null);
  const deposits = data.accounts.filter((a) => !a.archived && isLiquid(a.type));

  return (
    <>
      <StepTitle title="How does money come in?" subtitle="Your take-home pay and when it lands. This is what payday and the forecast are built on." />

      {data.incomeSources.length === 0 ? (
        <Card variant="muted" style={{ gap: spacing.md, alignItems: 'flex-start' }}>
          <EmojiIcon name="money-with-wings" size={36} />
          <Text variant="small" color={colors.textSecondary}>
            Irregular income? Add roughly what you expect — you can record each payment as it arrives.
          </Text>
          <Button label="Add income" icon="plus" onPress={() => setOpen(true)} />
        </Card>
      ) : (
        <View style={{ gap: spacing.sm }}>
          {data.incomeSources.map((s) => (
            <AddedThing
              key={s.id}
              emoji="money-with-wings"
              name={s.name}
              detail={[s.frequency ? frequencyLabel(s.frequency) : 'Irregular', s.anchorDate ? `next ${formatDate(s.anchorDate, 'medium', today)}` : null].filter(Boolean).join(' · ')}
              amount={s.expectedNet}
              onPress={() => setEditing(s.id)}
            />
          ))}
          <Button label="Add another" icon="plus" variant="secondary" onPress={() => setOpen(true)} />
        </View>
      )}

      {deposits.length === 0 && (
        <Text variant="caption" color={colors.warning}>
          Add a checking account first so pay has somewhere to land.
        </Text>
      )}
      <Text variant="caption" color={colors.textTertiary}>
        Take-home is what actually reaches your account. {money(0) ? '' : ''}Gross pay and withholding can come later, on the income screen.
      </Text>

      <IncomeSheet visible={open || editing !== null} id={editing} onClose={() => (setOpen(false), setEditing(null))} today={today} />
    </>
  );
}

function IncomeSheet({ visible, id, onClose, today }: { visible: boolean; id: ID | null; onClose: () => void; today: ISODate }) {
  const data = useData();
  const existing = id ? data.incomeSources.find((s) => s.id === id) : undefined;
  const deposits = data.accounts.filter((a) => !a.archived && isLiquid(a.type));
  const [draft, setDraft] = useState<{ name: string; net?: Cents; pay: string; anchor?: ISODate; account?: ID }>({ name: '', pay: 'biweekly' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = visible ? (existing?.id ?? 'new') : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    setDraft(
      existing
        ? { name: existing.name, net: existing.expectedNet, pay: PAY_FREQUENCIES.find((f) => f.frequency.unit === existing.frequency?.unit && f.frequency.interval === existing.frequency?.interval)?.value ?? 'biweekly', anchor: existing.anchorDate, account: existing.depositAccountId }
        : { name: 'Paycheck', pay: 'biweekly', anchor: today, account: deposits[0]?.id },
    );
    setErrors({});
  }
  if (!visible) return null;

  const save = () => {
    const frequency = PAY_FREQUENCIES.find((f) => f.value === draft.pay)?.frequency;
    const result = ledger.saveIncomeSource({
      id: existing?.id,
      name: draft.name.trim() || 'Paycheck',
      type: 'salary',
      frequency,
      anchorDate: draft.anchor,
      expectedNet: draft.net,
      depositAccountId: draft.account ?? '',
      categoryId: 'income.paycheck',
      active: true,
      tags: [],
    });
    if (!result.ok) return setErrors(result.errors);
    onClose();
  };

  const accountOptions: SelectOption<ID>[] = deposits.map((a) => ({ value: a.id, label: a.name, emoji: ACCOUNT_EMOJI[a.type] }));

  return (
    <Sheet visible onClose={onClose} title={existing ? 'Edit income' : 'Add income'} footer={<Button label="Save" fullWidth onPress={save} />}>
      <TextField label="What is it?" value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))} placeholder="Paycheck" error={errors.name} />
      <MoneyField label="Take-home each time" value={draft.net} onChange={(net) => setDraft((d) => ({ ...d, net }))} error={errors.expectedNet} />
      <SelectField label="How often" value={draft.pay} onChange={(pay) => setDraft((d) => ({ ...d, pay }))} options={PAY_FREQUENCIES.map(({ value, label }) => ({ value, label }))} />
      <DateField label="Next payday" value={draft.anchor} onChange={(anchor) => setDraft((d) => ({ ...d, anchor }))} error={errors.anchorDate} />
      <SelectField label="Lands in" value={draft.account} onChange={(account) => setDraft((d) => ({ ...d, account }))} options={accountOptions} error={errors.depositAccountId} />
    </Sheet>
  );
}

// ─── 4. Bills ────────────────────────────────────────────────────────────────

function BillsStep() {
  const data = useData();
  const [preset, setPreset] = useState<BillPreset | null>(null);
  const [editing, setEditing] = useState<ID | null>(null);
  const bills = data.recurring.filter((r) => r.active);
  const addedKeys = useMemo(() => new Set(bills.map((b) => b.name.toLowerCase())), [bills]);

  return (
    <>
      <StepTitle title="What do you pay every month?" subtitle="Tap the ones you have. These become your committed money, so what's left really is spendable." />

      <View style={styles.chips}>
        {BILL_PRESETS.map((p) => (
          <SuggestionChip key={p.key} emoji={p.emoji} label={p.name} added={addedKeys.has(p.name.toLowerCase())} onPress={() => setPreset(p)} />
        ))}
        <SuggestionChip emoji="memo" label="Something else" onPress={() => setPreset({ key: 'custom', name: '', categoryId: 'other.misc', emoji: 'memo', essential: false })} />
      </View>

      {bills.length > 0 && (
        <View style={{ gap: spacing.sm }}>
          {bills.map((b) => (
            <AddedThing
              key={b.id}
              emoji={categoryEmoji(b.categoryId) ?? 'memo'}
              name={b.name}
              detail={`${frequencyLabel(b.frequency)} · due the ${ordinal(Number(b.startDate.slice(8)))}`}
              amount={b.amount}
              onPress={() => setEditing(b.id)}
            />
          ))}
        </View>
      )}

      <BillSheet preset={preset} id={editing} onClose={() => (setPreset(null), setEditing(null))} />
    </>
  );
}

function BillSheet({ preset, id, onClose }: { preset: BillPreset | null; id: ID | null; onClose: () => void }) {
  const data = useData();
  const today = useToday();
  const { confirm } = useOverlay();
  const existing = id ? data.recurring.find((r) => r.id === id) : undefined;
  const from = data.accounts.filter((a) => !a.archived && (isLiquid(a.type) || a.type === 'credit_card'));
  const [draft, setDraft] = useState<{ name: string; amount?: Cents; day?: number; account?: ID }>({ name: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const key = existing?.id ?? preset?.key ?? null;
  if (key !== openedFor) {
    setOpenedFor(key);
    setDraft(
      existing
        ? { name: existing.name, amount: existing.amount, day: Number(existing.startDate.slice(8)), account: existing.accountId }
        : { name: preset?.name ?? '', day: 1, account: from[0]?.id },
    );
    setErrors({});
  }
  if (!preset && !existing) return null;

  const meta = preset ?? BILL_PRESETS.find((p) => p.name === existing?.name);
  const yearly = meta?.yearly ?? existing?.frequency.unit === 'year';

  const save = () => {
    const day = Math.min(Math.max(draft.day ?? 1, 1), 28);
    const result = ledger.saveRecurring({
      id: existing?.id,
      name: draft.name.trim() || meta?.name || 'Bill',
      kind: 'bill',
      amount: draft.amount ?? 0,
      variable: meta?.variable ?? false,
      frequency: yearly ? { unit: 'year', interval: 1 } : { unit: 'month', interval: 1 },
      startDate: existing?.startDate ?? nextDayOfMonth(day, today),
      categoryId: meta?.categoryId,
      accountId: draft.account ?? '',
      autopay: false,
      essential: meta?.essential ?? true,
      active: true,
      skipped: existing?.skipped ?? [],
      tags: existing?.tags ?? [],
    });
    if (!result.ok) return setErrors(result.errors);
    onClose();
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : meta?.name ? `Add ${meta.name.toLowerCase()}` : 'Add a bill'}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {existing && (
            <Button
              label="Remove"
              variant="secondary"
              onPress={async () => {
                if (await confirm({ title: `Remove ${existing.name}?`, confirmLabel: 'Remove', destructive: true })) {
                  ledger.deleteRecurring(existing.id);
                  onClose();
                }
              }}
            />
          )}
          <Button label="Save" style={{ flex: 1 }} onPress={save} />
        </View>
      }
    >
      <TextField label="Name" value={draft.name} onChangeText={(name) => setDraft((d) => ({ ...d, name }))} placeholder={meta?.name ?? 'Bill'} error={errors.name} autoFocus={!meta?.name} />
      <MoneyField label={meta?.variable ? 'Typical amount' : 'Amount'} value={draft.amount} onChange={(amount) => setDraft((d) => ({ ...d, amount }))} error={errors.amount} hint={meta?.variable ? 'It varies — an estimate is fine.' : undefined} />
      <NumberField label={yearly ? 'Day of the month it renews' : 'Due day of the month'} integer value={draft.day} onChange={(day) => setDraft((d) => ({ ...d, day }))} placeholder="1" hint={draft.day ? `Due the ${ordinal(Math.min(draft.day, 28))}` : undefined} />
      <SelectField label="Paid from" value={draft.account} onChange={(account) => setDraft((d) => ({ ...d, account }))} options={from.map((a) => ({ value: a.id, label: a.name, emoji: ACCOUNT_EMOJI[a.type] }))} error={errors.accountId} />
    </Sheet>
  );
}

// ─── 5. Done ─────────────────────────────────────────────────────────────────

function DoneStep() {
  const data = useData();
  const summary = setupSummary(data);
  return (
    <>
      <StepTitle title="That's the hard part done" subtitle="Everything else in Tanu is built from this, and you can change any of it later." />
      <Card style={{ gap: spacing.md }}>
        <Row label="Accounts" value={String(summary.accounts)} />
        <Row label="Money you hold" money={summary.held} />
        {summary.owed > 0 && <Row label="Money you owe" money={summary.owed} />}
        <Row label="Bills set up" value={String(summary.bills)} />
        {summary.monthlyBills > 0 && <Row label="Committed each month" money={summary.monthlyBills} />}
      </Card>
      <Card variant="muted" style={{ gap: spacing.sm }}>
        <Text weight="medium">What next</Text>
        <Text variant="small" color={colors.textSecondary}>
          Record what you spend with the + button. Once a few days are in, the forecast, budgets and reports start to mean something.
        </Text>
        <Text variant="small" color={colors.textSecondary}>
          Your data lives on this device. Export a backup from Settings now and then.
        </Text>
      </Card>
    </>
  );
}

function Row({ label, value, money: cents }: { label: string; value?: string; money?: Cents }) {
  return (
    <View style={styles.summaryRow}>
      <Text color={colors.textSecondary} style={{ flex: 1 }}>
        {label}
      </Text>
      {cents !== undefined ? <Money cents={cents} weight="semibold" whole /> : <Text weight="semibold">{value}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
