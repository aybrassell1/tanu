import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { CategorySelect } from '@/components/finance/Pickers';
import { Button, Card, IconButton, Money, MoneyField, Text, TextField } from '@/components/ui';
import { createId } from '@/domain/factory';
import type { Cents, TransactionSplit } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

/**
 * Splits one purchase across categories. The lines always add up to the
 * transaction total, so the split can never change what was spent.
 */
export function SplitEditor({
  total,
  splits,
  onChange,
  categoryId,
  error,
}: {
  total: Cents;
  splits: TransactionSplit[] | undefined;
  onChange: (splits: TransactionSplit[] | undefined) => void;
  categoryId?: string;
  error?: string;
}) {
  const money = useMoney();
  const [notesShown, setNotesShown] = useState(false);
  const showNotes = notesShown || !!splits?.some((s) => s.note);
  const assigned = (splits ?? []).reduce((sum, s) => sum + s.amount, 0);
  const left = total - assigned;

  const start = () => {
    const first = Math.max(0, total);
    onChange([
      { id: createId('sp'), categoryId, amount: first },
      { id: createId('sp'), amount: 0 },
    ]);
  };

  if (!splits?.length) {
    return <Button label="Split across categories" icon="scissors" variant="ghost" size="sm" onPress={start} disabled={total <= 0} accessibilityHint="Divide this purchase between several categories" />;
  }

  const update = (id: string, patch: Partial<TransactionSplit>) => onChange(splits.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const blank = splits.filter((s) => !s.amount).length;
  const remove = (id: string) => {
    const next = splits.filter((s) => s.id !== id);
    onChange(next.length > 1 ? next : undefined);
  };

  return (
    <Card style={{ gap: spacing.md }}>
      <View style={styles.header}>
        <Text weight="medium">Split across categories</Text>
        <Button label="Remove split" variant="ghost" size="sm" onPress={() => onChange(undefined)} />
      </View>

      {splits.map((s, i) => (
        <View key={s.id} style={styles.line}>
          <View style={{ flex: 1, gap: spacing.sm }}>
            <CategorySelect kind="expense" value={s.categoryId} onChange={(id) => update(s.id, { categoryId: id })} optional label={`Category ${i + 1}`} />
            <MoneyField label="Amount" value={s.amount || undefined} onChange={(c) => update(s.id, { amount: (c ?? 0) as Cents })} />
            {showNotes && <TextField label="Note" optional value={s.note ?? ''} onChangeText={(note) => update(s.id, { note })} placeholder="e.g. birthday gift" />}
          </View>
          <IconButton icon="x" size={32} accessibilityLabel={`Remove line ${i + 1}`} onPress={() => remove(s.id)} />
        </View>
      ))}

      <View style={styles.footer}>
        <Button label="Add a line" icon="plus" variant="ghost" size="sm" onPress={() => onChange([...splits, { id: createId('sp'), amount: Math.max(0, left) }])} />
        <Button label={showNotes ? 'Hide notes' : 'Add notes'} variant="ghost" size="sm" onPress={() => setNotesShown((v) => !v)} />
      </View>

      <View style={styles.total}>
        <Text variant="small" color={left === 0 && !blank ? colors.positive : colors.warning} style={{ flex: 1 }}>
          {left !== 0
            ? left > 0
              ? `${money(left)} still to assign`
              : `${money(-left)} over the total`
            : blank
              ? `${blank} line${blank > 1 ? 's' : ''} still needs an amount`
              : 'Adds up to the total'}
        </Text>
        <Money cents={assigned} weight="semibold" />
        <Text variant="small" color={colors.textTertiary}>
          {' '}
          / {money(total)}
        </Text>
      </View>
      {!!left && (
        <Button
          label={left > 0 ? `Put the rest on the last line` : 'Fix the last line'}
          variant="secondary"
          size="sm"
          onPress={() => update(splits[splits.length - 1].id, { amount: Math.max(0, splits[splits.length - 1].amount + left) })}
        />
      )}
      {!!error && (
        <Text variant="small" color={colors.negative}>
          {error}
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  total: { flexDirection: 'row', alignItems: 'center', gap: 2 },
});
