import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AccountSelect } from '@/components/finance/Pickers';
import { Banner, Button, DateField, MoneyField, Segmented, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { accountNature, accountGroup } from '@/domain/catalog';
import { allocationsByAccount } from '@/domain/goals';
import { balanceOn, indexLedger } from '@/domain/ledger';
import type { Account, Cents, Goal, ID, ISODate } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

export type ContributionMode = 'add' | 'remove';

const assetFilter = (a: Account) => accountNature(a.type) === 'asset';

/** The account a goal's money most often sits in, else the first savings account. */
export function defaultGoalAccount(accounts: Account[], contributions: { goalId: ID; accountId?: ID }[], goalId: ID | undefined): ID | undefined {
  const live = new Set(accounts.filter((a) => !a.archived && assetFilter(a)).map((a) => a.id));
  if (goalId) {
    const counts = new Map<ID, number>();
    for (const c of contributions) if (c.goalId === goalId && c.accountId && live.has(c.accountId)) counts.set(c.accountId, (counts.get(c.accountId) ?? 0) + 1);
    const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) return best[0];
  }
  return accounts.find((a) => !a.archived && accountGroup(a.type) === 'savings')?.id ?? accounts.find((a) => !a.archived && assetFilter(a))?.id;
}

type Props = {
  goal: Goal | null;
  visible: boolean;
  onClose: () => void;
  initialMode?: ContributionMode;
};

export function ContributionSheet({ goal, visible, onClose, initialMode = 'add' }: Props) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();

  const [mode, setMode] = useState<ContributionMode>(initialMode);
  const [amount, setAmount] = useState<Cents | undefined>();
  const [accountId, setAccountId] = useState<ID | undefined>();
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!visible || !goal) return;
    setMode(initialMode);
    setAmount(undefined);
    setAccountId(defaultGoalAccount(data.accounts, data.goalContributions, goal.id));
    setDate(today);
    setNote('');
    setErrors({});
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, goal?.id]);

  const needsAccount = goal?.kind === 'savings';
  const info = useMemo(() => {
    if (!goal || !accountId) return null;
    const alloc = allocationsByAccount(data, today).get(accountId);
    const balance = balanceOn(indexLedger(data), accountId, today);
    return { unassigned: alloc ? alloc.unallocated : balance, inGoal: alloc?.byGoal.find((g) => g.goalId === goal.id)?.amount ?? 0 };
  }, [data, today, accountId, goal]);

  if (!goal) return null;

  const save = () => {
    if (!amount || amount <= 0) return setErrors({ amount: 'Enter an amount.' });
    const sign = mode === 'add' ? 1 : -1;
    const result = ledger.addContribution({ goalId: goal.id, date, amount: sign * amount, accountId: needsAccount ? accountId : undefined, note: note.trim() || undefined });
    if (!result.ok) return setErrors(result.errors);
    onClose();
    // addContribution isn't recorded for ledger.undo, so undo removes exactly this entry.
    toast({
      message: mode === 'add' ? `Added ${money(amount)} to ${goal.name}` : `Took ${money(amount)} out of ${goal.name}`,
      actionLabel: 'Undo',
      onAction: () => ledger.deleteContribution(result.id),
    });
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={goal.name}
      subtitle={needsAccount ? 'Assign money that is already in one of your accounts.' : 'Record progress toward this goal.'}
      footer={<Button label={mode === 'add' ? 'Add money' : 'Take out'} size="lg" fullWidth onPress={save} />}
    >
      <Segmented
        items={[
          { value: 'add', label: 'Add' },
          { value: 'remove', label: 'Take out' },
        ]}
        value={mode}
        onChange={(m) => {
          setMode(m);
          setErrors({});
        }}
      />
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}
      <MoneyField label="Amount" value={amount} onChange={setAmount} error={errors.amount} autoFocus />
      {needsAccount && (
        <View style={{ gap: 6 }}>
          <AccountSelect label="Held in" value={accountId} onChange={setAccountId} filter={assetFilter} error={errors.accountId} />
          {info && (
            <Text variant="caption" color={colors.textSecondary} tabular>
              {mode === 'add'
                ? `Unassigned in this account: ${money(Math.max(0, info.unassigned))}`
                : `This goal holds ${money(info.inGoal)} in this account`}
            </Text>
          )}
        </View>
      )}
      <DateField label="Date" value={date} onChange={(d) => setDate(d ?? today)} shortcuts error={errors.date} />
      <TextField label="Note" value={note} onChangeText={setNote} optional placeholder={mode === 'add' ? 'e.g. Tax refund' : 'e.g. Paid for flights'} />
      <View style={{ height: spacing.xs }} />
    </Sheet>
  );
}
