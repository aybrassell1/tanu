import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';

import { IconButton, SelectField, Text, type SelectOption } from '@/components/ui';
import { icon } from '@/data/icons';
import { ACCOUNT_EMOJI, categoryEmoji } from '@/data/visuals';
import { ACCOUNT_GROUPS, ACCOUNT_TYPES } from '@/domain/catalog';
import { childrenOf, rootCategories } from '@/domain/categories';
import { addMonthsToMonth, formatMonth } from '@/domain/dates';
import { balanceOn, indexLedger } from '@/domain/ledger';
import { formatMoney } from '@/domain/money';
import { FREQUENCY_PRESETS, frequencyLabel } from '@/domain/recurrence';
import type { Account, CategoryKind, Frequency, ID, ISOMonth, LedgerData } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export function accountOptions(
  data: LedgerData,
  today: string,
  filter?: (a: Account) => boolean,
  includeArchived = false,
  money: (c: number) => string = (c) => formatMoney(c, { currency: data.settings.currency }),
): SelectOption<ID>[] {
  const index = indexLedger(data);
  const out: SelectOption<ID>[] = [];
  for (const g of ACCOUNT_GROUPS) {
    for (const a of data.accounts) {
      if (!g.types.includes(a.type) || (!includeArchived && a.archived) || (filter && !filter(a))) continue;
      const bal = balanceOn(index, a.id, today);
      out.push({
        value: a.id,
        label: a.name,
        description: `${ACCOUNT_TYPES[a.type].label} · ${money(bal)}${ACCOUNT_TYPES[a.type].nature === 'liability' ? ' owed' : ''}`,
        icon: icon(a.icon, 'credit-card'),
        emoji: ACCOUNT_EMOJI[a.type],
        color: a.color,
        group: g.label,
      });
    }
  }
  return out;
}

type AccountSelectProps = {
  label: string;
  value: ID | undefined;
  onChange: (id: ID) => void;
  filter?: (a: Account) => boolean;
  error?: string;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
};

export function AccountSelect({ label, value, onChange, filter, error, hint, optional, placeholder = 'Choose an account' }: AccountSelectProps) {
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const options = useMemo(() => accountOptions(data, today, filter, false, money), [data, today, filter, money]);
  return <SelectField label={label} value={value} onChange={onChange} options={options} error={error} hint={hint} optional={optional} placeholder={options.length ? placeholder : 'Add an account first'} searchable={options.length > 8} />;
}

export function categoryOptions(data: LedgerData, kind: CategoryKind | 'all', only?: (id: ID) => boolean): SelectOption<ID>[] {
  const kinds: CategoryKind[] = kind === 'all' ? ['expense', 'income'] : [kind];
  const out: SelectOption<ID>[] = [];
  for (const k of kinds) {
    for (const root of rootCategories(data, k)) {
      if (!only || only(root.id)) out.push({ value: root.id, label: `All ${root.name}`, icon: icon(root.icon), emoji: categoryEmoji(root.id), color: root.color, group: root.name });
      for (const sub of childrenOf(data, root.id)) {
        if (only && !only(sub.id)) continue;
        out.push({ value: sub.id, label: sub.name, icon: icon(sub.icon), emoji: categoryEmoji(sub.id), color: sub.color, group: root.name, indent: true });
      }
    }
  }
  return out;
}

type CategorySelectProps = {
  label?: string;
  kind: CategoryKind | 'all';
  value: ID | undefined;
  onChange: (id: ID) => void;
  error?: string;
  hint?: string;
  optional?: boolean;
};

export function CategorySelect({ label = 'Category', kind, value, onChange, error, hint, optional }: CategorySelectProps) {
  const data = useData();
  const options = useMemo(() => categoryOptions(data, kind), [data, kind]);
  return <SelectField label={label} value={value} onChange={onChange} options={options} error={error} hint={hint} optional={optional} placeholder="Choose a category" searchable />;
}

const CUSTOM = 'custom';

export function FrequencySelect({ value, onChange, label = 'Repeats', error }: { value: Frequency; onChange: (f: Frequency) => void; label?: string; error?: string }) {
  const presetKey = FREQUENCY_PRESETS.find((p) => p.frequency.unit === value.unit && p.frequency.interval === value.interval)?.key ?? CUSTOM;
  const options: SelectOption[] = [
    ...FREQUENCY_PRESETS.map((p) => ({ value: p.key, label: p.label })),
    { value: 'custom_days', label: 'Every N days' },
    { value: 'custom_weeks', label: 'Every N weeks' },
    { value: 'custom_months', label: 'Every N months' },
  ];
  const customValue = presetKey === CUSTOM ? `custom_${value.unit}s` : presetKey;
  return (
    <View style={{ gap: spacing.sm }}>
      <SelectField
        label={label}
        value={customValue}
        onChange={(key) => {
          const preset = FREQUENCY_PRESETS.find((p) => p.key === key);
          if (preset) onChange(preset.frequency);
          else if (key === 'custom_days') onChange({ unit: 'day', interval: Math.max(1, value.unit === 'day' ? value.interval : 10) });
          else if (key === 'custom_weeks') onChange({ unit: 'week', interval: Math.max(1, value.unit === 'week' ? value.interval : 3) });
          else if (key === 'custom_months') onChange({ unit: 'month', interval: Math.max(1, value.unit === 'month' ? value.interval : 2) });
        }}
        options={options}
        error={error}
      />
      {presetKey === CUSTOM && (
        <View style={styles.stepper}>
          <IconButton icon="minus" size={34} accessibilityLabel="Fewer" onPress={() => onChange({ ...value, interval: Math.max(1, value.interval - 1) })} />
          <Text weight="medium" style={{ flex: 1 }} align="center">
            {frequencyLabel(value)}
          </Text>
          <IconButton icon="plus" size={34} accessibilityLabel="More" onPress={() => onChange({ ...value, interval: value.interval + 1 })} />
        </View>
      )}
    </View>
  );
}

export function MonthSwitcher({ month, onChange, max }: { month: ISOMonth; onChange: (m: ISOMonth) => void; max?: ISOMonth }) {
  return (
    <View style={styles.month}>
      <IconButton icon="chevron-left" size={36} accessibilityLabel="Previous month" onPress={() => onChange(addMonthsToMonth(month, -1))} />
      <Text variant="h3" style={{ flex: 1 }} align="center">
        {formatMonth(month)}
      </Text>
      <IconButton icon="chevron-right" size={36} accessibilityLabel="Next month" disabled={!!max && month >= max} onPress={() => onChange(addMonthsToMonth(month, 1))} />
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.surfaceMuted, borderRadius: 12, padding: 6 },
  month: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
