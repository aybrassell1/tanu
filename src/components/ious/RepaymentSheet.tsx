import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { AccountSelect, CategorySelect } from '@/components/finance/Pickers';
import { Banner, Button, DateField, MoneyField, Sheet, SwitchRow, Text, TextField, useOverlay } from '@/components/ui';
import { accountNature } from '@/domain/catalog';
import { iouBalance, maxRepayment, moneyMovePlan, moneyMoveTransaction, principalTransaction } from '@/domain/ious';
import type { Account, Cents, ID, ISODate, Iou } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const assetFilter = (a: Account) => accountNature(a.type) === 'asset';

type Props = {
  iou: Iou | null;
  visible: boolean;
  onClose: () => void;
  /** Prefill the whole outstanding amount ("Mark settled"). */
  fullAmount?: boolean;
};

/**
 * Records a repayment on an IOU and, when the user asks for it, the real money
 * movement that goes with it. The transaction's id is stored on the entry so
 * the same money is never counted twice.
 */
export function RepaymentSheet({ iou, visible, onClose, fullAmount }: Props) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();

  const [amount, setAmount] = useState<Cents | undefined>();
  const [date, setDate] = useState<ISODate>(today);
  const [note, setNote] = useState('');
  const [record, setRecord] = useState(false);
  const [accountId, setAccountId] = useState<ID | undefined>();
  const [categoryId, setCategoryId] = useState<ID | undefined>();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const outstanding = iou ? maxRepayment(iou) : 0;
  const principalRecorded = useMemo(() => (iou ? !!principalTransaction(data, iou) : false), [data, iou]);
  const plan = useMemo(() => moneyMovePlan(iou?.direction ?? 'owed_to_me', 'repayment', { principalRecorded }), [iou?.direction, principalRecorded]);

  useEffect(() => {
    if (!visible || !iou) return;
    setAmount(fullAmount ? outstanding : undefined);
    setDate(today);
    setNote('');
    setRecord(false);
    setAccountId(data.accounts.find((a) => !a.archived && a.spendable && assetFilter(a))?.id ?? data.accounts.find((a) => !a.archived && assetFilter(a))?.id);
    setCategoryId(undefined);
    setErrors({});
    // Reset only when the sheet opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, iou?.id, fullAmount]);

  if (!iou) return null;
  const balance = iouBalance(iou);

  const save = () => {
    if (!amount || amount <= 0) return setErrors({ amount: 'Enter an amount.' });
    if (amount > outstanding) return setErrors({ amount: `That is more than the ${money(outstanding)} still outstanding.` });
    if (record && !accountId) return setErrors({ accountId: 'Choose the account the money moved through.' });

    // The transaction is saved first so its id can be stored on the entry.
    let txId: ID | undefined;
    if (record && accountId) {
      const result = ledger.saveTransaction(
        moneyMoveTransaction({
          direction: iou.direction,
          kind: 'repayment',
          amount,
          date,
          accountId,
          person: iou.person,
          reason: iou.reason,
          categoryId: plan.category ? categoryId : undefined,
          tags: iou.tags,
          principalRecorded,
        }),
      );
      if (!result.ok) return setErrors(result.errors);
      txId = result.id;
    }

    const entry = ledger.addIouEntry(iou.id, { date, amount, note: note.trim() || undefined, txId });
    if (!entry.ok) {
      // Never leave a transaction behind for a repayment that was not recorded.
      if (txId) ledger.deleteTransaction(txId);
      return setErrors(entry.errors);
    }

    onClose();
    toast({
      message: amount >= outstanding ? `Settled up with ${iou.person}` : `${money(amount)} repayment recorded`,
      actionLabel: 'Undo',
      onAction: () => {
        ledger.deleteIouEntry(iou.id, entry.id);
        if (txId) ledger.deleteTransaction(txId);
      },
    });
  };

  const incoming = iou.direction === 'owed_to_me';

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={incoming ? `${iou.person} paid you back` : `You paid ${iou.person} back`}
      subtitle={`${money(balance.outstanding)} outstanding of ${money(balance.amount)}`}
      footer={<Button label="Record repayment" size="lg" fullWidth onPress={save} />}
    >
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}
      <MoneyField label="Amount" value={amount} onChange={setAmount} error={errors.amount} autoFocus hint={`Up to ${money(outstanding)}.`} />
      <DateField label="Date" value={date} onChange={(d) => setDate(d ?? today)} shortcuts error={errors.date} />
      <TextField label="Note" value={note} onChangeText={setNote} optional placeholder={incoming ? 'e.g. Venmo' : 'e.g. Cash'} />

      <View style={{ gap: 6 }}>
        <SwitchRow label={plan.title} description={plan.explain} value={record} onChange={setRecord} icon="link" />
        {!record && (
          <Text variant="caption" color={colors.textTertiary}>
            Leave this off if no money actually moved through an account you track, or if you already logged it.
          </Text>
        )}
      </View>

      {record && (
        <>
          <AccountSelect label={incoming ? 'Money arrived in' : 'Money left'} value={accountId} onChange={setAccountId} filter={assetFilter} error={errors.accountId} />
          {plan.category && <CategorySelect label="Category" kind="expense" value={categoryId} onChange={setCategoryId} optional error={errors.categoryId} hint={incoming ? 'The category the original spending came from, so it is cancelled out there.' : undefined} />}
        </>
      )}
      <View style={{ height: spacing.xs }} />
    </Sheet>
  );
}
