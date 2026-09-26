import Feather from '@expo/vector-icons/Feather';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, MoneyField, Pill, Sheet, Text, TextField } from '@/components/ui';
import { FEE_PRESETS, newFee } from '@/domain/places';
import { createId } from '@/domain/factory';
import type { Cents, FeeWhen, PlaceFee } from '@/domain/types';
import { colors, spacing } from '@/theme/tokens';

/**
 * Costs on top of the rent, one named line at a time.
 *
 * A single "other fees: $155" is useless a week later. Valet trash $35,
 * amenity $45, parking $75 is a conversation you can have with the leasing
 * office — and with yourself, when you compare two places on Sunday.
 */
export function FeeEditor({
  when,
  fees,
  onChange,
  emptyHint,
}: {
  when: FeeWhen;
  fees: PlaceFee[];
  onChange: (fees: PlaceFee[]) => void;
  emptyHint: string;
}) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState('');
  const mine = fees.filter((f) => f.when === when);
  const used = new Set(mine.map((f) => f.label.toLowerCase()));
  const presets = FEE_PRESETS.filter((p) => p.when === when && !used.has(p.label.toLowerCase()));

  const add = (preset: { label: string; utility?: boolean }) => {
    onChange([...fees, { id: createId('fee'), ...newFee(preset.label, when, preset.utility ? { utility: true } : {}) }]);
  };
  const update = (id: string, patch: Partial<PlaceFee>) => onChange(fees.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  const remove = (id: string) => onChange(fees.filter((f) => f.id !== id));

  const addCustom = () => {
    const name = label.trim();
    if (!name) return;
    add({ label: name });
    setLabel('');
    setAdding(false);
  };

  return (
    <View style={{ gap: spacing.md }}>
      {mine.length === 0 ? (
        <Text variant="small" color={colors.textSecondary}>
          {emptyHint}
        </Text>
      ) : (
        mine.map((fee) => (
          <View key={fee.id} style={styles.line}>
            <View style={{ flex: 1, gap: 6 }}>
              <TextField value={fee.label} onChangeText={(v) => update(fee.id, { label: v })} placeholder="What is it called?" accessibilityLabel="Fee name" />
              <View style={styles.flags}>
                <Pill
                  size="sm"
                  label="Estimate"
                  icon={fee.estimated ? 'check' : 'help-circle'}
                  selected={!!fee.estimated}
                  onPress={() => update(fee.id, { estimated: !fee.estimated })}
                />
                {when === 'monthly' && (
                  <Pill size="sm" label="Utility" icon="zap" selected={!!fee.utility} onPress={() => update(fee.id, { utility: !fee.utility })} />
                )}
              </View>
            </View>
            <View style={{ width: 118 }}>
              <MoneyField value={fee.amount || undefined} onChange={(v: Cents | undefined) => update(fee.id, { amount: v ?? 0 })} />
            </View>
            <Pressable onPress={() => remove(fee.id)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Remove ${fee.label}`} style={styles.remove}>
              <Feather name="x" size={16} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))
      )}

      <View style={styles.presets}>
        {presets.map((p) => (
          <Pill key={p.label} size="sm" icon="plus" label={p.label} onPress={() => add(p)} />
        ))}
        <Pill size="sm" icon="edit-2" label="Something else" onPress={() => setAdding(true)} />
      </View>

      <Sheet visible={adding} onClose={() => setAdding(false)} title={when === 'monthly' ? 'Add a monthly cost' : 'Add a cost at signing'}>
        <View style={{ gap: spacing.md }}>
          <TextField label="What did they call it?" value={label} onChangeText={setLabel} placeholder="Trash valet, front desk fee…" autoFocus onSubmitEditing={addCustom} />
          <Button label="Add it" size="lg" fullWidth onPress={addCustom} />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  flags: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  remove: { paddingTop: 14 },
});
