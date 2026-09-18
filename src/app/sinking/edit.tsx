import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { AccountSelect, CategorySelect } from '@/components/finance/Pickers';
import {
  Banner,
  Button,
  DateField,
  EmojiIcon,
  Field,
  MoneyField,
  NavHeader,
  Screen,
  Stack,
  Text,
  TextField,
  useOverlay,
} from '@/components/ui';
import { categoryEmoji } from '@/data/visuals';
import { isLiquid } from '@/domain/catalog';
import { allocatedAmounts } from '@/domain/goals';
import { suggestedMonthly, unreservedIn } from '@/domain/sinking';
import type { Account, Cents, ID, SinkingFund } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

type Draft = Omit<SinkingFund, 'id' | 'entries' | 'createdAt' | 'updatedAt'> & { id?: ID };

/** Illustrations that exist in the generated icon set. */
const EMOJI_CHOICES = [
  'money-bag',
  'automobile',
  'wheel',
  'wrench',
  'house',
  'shield',
  'umbrella',
  'tooth',
  'glasses',
  'paw-prints',
  'christmas-tree',
  'wrapped-gift',
  'airplane',
  'beach-with-umbrella',
  'graduation-cap',
  'laptop',
  'mobile-phone',
  'birthday-cake',
  'receipt',
  'spiral-calendar',
];

// A reserve can only claim money that actually sits somewhere spendable:
// cash, checking or savings. Retirement and brokerage accounts are out.
const holdingFilter = (a: Account) => isLiquid(a.type);
const parseCents = (value: string | undefined): Cents => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

export default function SinkingFundFormScreen() {
  const params = useLocalSearchParams<{ id?: string; name?: string; categoryId?: string; yearlyTarget?: string; monthly?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { confirm, toast } = useOverlay();

  const existing = params.id ? data.sinkingFunds.find((f) => f.id === params.id) : undefined;

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) return { ...existing };
    const yearlyTarget = parseCents(params.yearlyTarget);
    return {
      name: params.name ?? '',
      emoji: (params.categoryId ? categoryEmoji(params.categoryId) : null) ?? 'money-bag',
      categoryId: params.categoryId,
      yearlyTarget,
      monthly: parseCents(params.monthly) || suggestedMonthly(yearlyTarget),
      archived: false,
    };
  });
  // Until the monthly amount is edited by hand it follows the yearly target.
  const [monthlyTouched, setMonthlyTouched] = useState(!!existing);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const free = useMemo(() => {
    if (!draft.accountId) return null;
    return unreservedIn(data, draft.accountId, today, allocatedAmounts(data, today));
  }, [data, draft.accountId, today]);

  const save = () => {
    const result = ledger.saveSinkingFund({
      ...draft,
      name: draft.name.trim(),
      notes: draft.notes?.trim() || undefined,
      entries: existing?.entries,
    });
    if (!result.ok) return setErrors(result.errors);
    toast({ message: existing ? 'Fund updated' : 'Fund created', actionLabel: 'Undo', onAction: ledger.undo });
    goBackOr(router, '/sinking');
  };

  const remove = async () => {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete ${existing.name}?`,
      message: 'The reserve is released, so the money counts as available again. Your transactions are untouched.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    goBackOr(router, '/sinking');
    ledger.deleteSinkingFund(existing.id);
    toast({ message: 'Fund deleted', actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen
      header={<NavHeader title={existing ? 'Edit fund' : 'New fund'} backIcon="x" />}
      footer={<Button label="Save" size="lg" fullWidth onPress={save} />}
    >
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <TextField
          label="Name"
          value={draft.name}
          onChangeText={(t) => set('name', t)}
          error={errors.name}
          placeholder="e.g. Car registration"
          autoFocus={!existing && !draft.name}
        />

        <Field label="Icon">
          <View style={styles.emojis}>
            {EMOJI_CHOICES.map((name) => {
              const selected = draft.emoji === name;
              return (
                <Pressable
                  key={name}
                  onPress={() => set('emoji', name)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={name.replace(/-/g, ' ')}
                  style={[styles.emoji, selected && styles.emojiSelected]}
                >
                  <EmojiIcon name={name} size={24} />
                </Pressable>
              );
            })}
          </View>
        </Field>

        <CategorySelect
          kind="expense"
          value={draft.categoryId}
          onChange={(id) => {
            setDraft((d) => ({ ...d, categoryId: id, emoji: d.emoji ?? categoryEmoji(id) ?? 'money-bag' }));
          }}
          optional
          hint="Ties the fund to the spending it will pay for."
        />

        <MoneyField
          label="Cost per year"
          value={draft.yearlyTarget || undefined}
          onChange={(c) => {
            const yearlyTarget = (c ?? 0) as Cents;
            setDraft((d) => ({ ...d, yearlyTarget, monthly: monthlyTouched ? d.monthly : suggestedMonthly(yearlyTarget) }));
          }}
          error={errors.yearlyTarget}
          hint="What this costs over a whole year, even if it arrives all at once."
        />

        <MoneyField
          label="Set aside each month"
          value={draft.monthly || undefined}
          onChange={(c) => {
            setMonthlyTouched(true);
            set('monthly', (c ?? 0) as Cents);
          }}
          error={errors.monthly}
          hint={monthlyTouched ? undefined : `A twelfth of the yearly cost (${money(suggestedMonthly(draft.yearlyTarget))}). Change it to set your own pace.`}
        />

        <View style={{ gap: 6 }}>
          <AccountSelect
            label="Money held in"
            value={draft.accountId}
            onChange={(id) => set('accountId', id)}
            filter={holdingFilter}
            optional
            error={errors.accountId}
            hint="Cash, checking or savings. The reserve claims part of this balance; it never moves money."
          />
          {free !== null && (
            <Text variant="caption" color={free < 0 ? colors.negative : colors.textSecondary} tabular>
              {free < 0
                ? `Funds and goals already claim ${money(-free)} more than this account holds.`
                : `Not assigned or reserved in this account: ${money(free)}`}
            </Text>
          )}
        </View>

        <DateField
          label="Next due"
          value={draft.dueDate}
          onChange={(d) => set('dueDate', d)}
          optional
          clearable
          hint="Used to work out whether the fund will be full in time."
        />

        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional />
      </Stack>

      {existing && <Button label="Delete fund" icon="trash-2" variant="danger" fullWidth onPress={remove} />}
    </Screen>
  );
}

const styles = StyleSheet.create({
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  emoji: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceMuted, borderWidth: 2, borderColor: 'transparent' },
  emojiSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
