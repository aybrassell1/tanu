import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  DateField,
  Field,
  MoneyField,
  NavHeader,
  NumberField,
  Screen,
  Section,
  Segmented,
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
import { ACCOUNT_GROUPS, ACCOUNT_TYPES, ENTITY_COLORS } from '@/domain/catalog';
import { allTags } from '@/domain/search';
import type { Account, AccountType, ID } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

type Draft = Omit<Account, 'id' | 'createdAt' | 'updatedAt'> & { id?: ID };

const GROUP_DEFAULT_COLOR: Record<string, string> = {
  cash: ENTITY_COLORS[0],
  savings: ENTITY_COLORS[2],
  credit: ENTITY_COLORS[1],
  loan: ENTITY_COLORS[3],
  investment: ENTITY_COLORS[8],
  other_asset: ENTITY_COLORS[9],
  other_liability: ENTITY_COLORS[4],
};

export default function AccountFormScreen() {
  const params = useLocalSearchParams<{ id?: string; type?: AccountType }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const { toast } = useOverlay();
  const existing = params.id ? data.accounts.find((a) => a.id === params.id) : undefined;

  const initialType: AccountType = existing?.type ?? (params.type && params.type in ACCOUNT_TYPES ? params.type : 'checking');
  const [draft, setDraft] = useState<Draft>(
    () =>
      existing ?? {
        name: '',
        type: initialType,
        startingBalance: 0,
        startingDate: today,
        color: GROUP_DEFAULT_COLOR[ACCOUNT_TYPES[initialType].group],
        icon: ACCOUNT_TYPES[initialType].icon,
        spendable: ['checking', 'cash'].includes(initialType),
        tags: [],
        archived: false,
      },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const info = ACCOUNT_TYPES[draft.type];
  const liability = info.nature === 'liability';
  const credit = info.group === 'credit';

  const typeOptions = useMemo<SelectOption<AccountType>[]>(
    () =>
      ACCOUNT_GROUPS.flatMap((g) =>
        g.types.map((t) => ({ value: t, label: ACCOUNT_TYPES[t].label, group: g.label, icon: icon(ACCOUNT_TYPES[t].icon), description: ACCOUNT_TYPES[t].nature === 'liability' ? 'Liability — money you owe' : 'Asset — money you own' })),
      ),
    [],
  );
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);

  const changeType = (type: AccountType) => {
    setDraft((d) => {
      const prev = ACCOUNT_TYPES[d.type];
      const next = ACCOUNT_TYPES[type];
      return {
        ...d,
        type,
        icon: d.icon === prev.icon ? next.icon : d.icon,
        color: d.color === GROUP_DEFAULT_COLOR[prev.group] ? GROUP_DEFAULT_COLOR[next.group] : d.color,
        spendable: next.group === 'cash' ? (d.spendable ?? true) : false,
        plannedPayment: next.group === 'credit' ? d.plannedPayment : undefined,
      };
    });
  };

  const save = () => {
    const f = info.fields;
    const result = ledger.saveAccount({
      ...draft,
      creditLimit: f.creditLimit ? draft.creditLimit : undefined,
      apr: f.apr ? draft.apr : undefined,
      promoApr: f.promo ? draft.promoApr : undefined,
      promoExpires: f.promo && draft.promoApr !== undefined ? draft.promoExpires : undefined,
      minimumPayment: f.payment ? draft.minimumPayment : undefined,
      paymentAmount: f.payment ? draft.paymentAmount : undefined,
      dueDay: f.payment ? draft.dueDay : undefined,
      statementBalance: f.statement ? draft.statementBalance : undefined,
      statementClosingDay: f.statement ? draft.statementClosingDay : undefined,
      originalBalance: f.originalBalance ? draft.originalBalance : undefined,
      startingCostBasis: f.costBasis ? draft.startingCostBasis : undefined,
      spendable: info.group === 'cash' ? draft.spendable : false,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(existing ? 'Account updated' : 'Account added');
    if (existing) router.back();
    else router.replace(`/accounts/${result.id}`);
  };

  return (
    <Screen header={<NavHeader title={existing ? 'Edit account' : 'New account'} backIcon="x" />} footer={<Button label={existing ? 'Save' : 'Add account'} size="lg" fullWidth onPress={save} />}>
      <Stack gap={spacing.lg}>
        <SelectField label="Account type" value={draft.type} onChange={changeType} options={typeOptions} searchable />
        <Text variant="small" color={colors.textSecondary}>
          {liability ? 'Tracked as money you owe. It lowers your net worth.' : info.group === 'investment' ? 'Tracked as an investment. Contributions and market changes are kept separate from income.' : 'Tracked as money you own.'}
        </Text>
        <TextField label="Name" value={draft.name} onChangeText={(t) => set('name', t)} placeholder={`e.g. ${info.label}`} error={errors.name} />
        <TextField label="Institution" value={draft.institution ?? ''} onChangeText={(t) => set('institution', t || undefined)} optional placeholder="Bank, card issuer or lender" />
      </Stack>

      <Section title="Balance">
        {existing ? (
          <Stack gap={spacing.lg}>
            <Banner tone="muted" icon="info" title="To change today's balance, use Update balance on the account page." message="It records the difference as an adjustment so your history stays accurate." />
            <MoneyField label={liability ? 'Amount owed when you started tracking' : 'Balance when you started tracking'} value={draft.startingBalance} onChange={(c) => set('startingBalance', c ?? 0)} allowNegative error={errors.startingBalance} />
            <DateField label="Tracking started" value={draft.startingDate} onChange={(d) => d && set('startingDate', d)} error={errors.startingDate} />
          </Stack>
        ) : (
          <Stack gap={spacing.lg}>
            <MoneyField label={liability ? 'Current amount owed' : 'Current balance'} value={draft.startingBalance || undefined} onChange={(c) => set('startingBalance', c ?? 0)} allowNegative error={errors.startingBalance} hint="As shown by your bank or statement today." />
            <DateField label="As of" value={draft.startingDate} onChange={(d) => d && set('startingDate', d)} hint="Transactions before this date are already included in the balance." />
          </Stack>
        )}
        {info.group === 'cash' && (
          <SwitchRow label="Available for everyday spending" description="Counts toward 'available to spend' on your dashboard." value={!!draft.spendable} onChange={(v) => set('spendable', v)} />
        )}
      </Section>

      {(info.fields.creditLimit || info.fields.apr || info.fields.originalBalance || info.fields.costBasis) && (
        <Section title={liability ? 'Terms' : info.group === 'investment' ? 'Investment details' : 'Interest'}>
          <Stack gap={spacing.lg}>
            {info.fields.creditLimit && <MoneyField label="Credit limit" value={draft.creditLimit} onChange={(c) => set('creditLimit', c)} optional error={errors.creditLimit} />}
            {info.fields.originalBalance && <MoneyField label="Original loan amount" value={draft.originalBalance} onChange={(c) => set('originalBalance', c)} optional hint="Used to show payoff progress." />}
            {info.fields.apr && <NumberField label={liability ? 'APR' : 'Interest rate (APY)'} value={draft.apr} onChange={(n) => set('apr', n)} suffix="%" optional error={errors.apr} />}
            {info.fields.promo && (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <NumberField label="Promo APR" value={draft.promoApr} onChange={(n) => set('promoApr', n)} suffix="%" optional error={errors.promoApr} />
                </View>
                <View style={{ flex: 1 }}>
                  <DateField label="Promo ends" value={draft.promoExpires} onChange={(d) => set('promoExpires', d)} optional clearable error={errors.promoExpires} />
                </View>
              </View>
            )}
            {info.fields.costBasis && (
              <MoneyField label="Amount you've put in (cost basis)" value={draft.startingCostBasis} onChange={(c) => set('startingCostBasis', c)} optional hint="Total contributions as of the tracking date. Used to calculate gains." />
            )}
          </Stack>
        </Section>
      )}

      {info.fields.payment && (
        <Section title="Payments" subtitle="Due dates put payments on your calendar and in cash-flow forecasts.">
          <Stack gap={spacing.lg}>
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <NumberField label="Due day of month" value={draft.dueDay} onChange={(n) => set('dueDay', n)} integer optional error={errors.dueDay} placeholder="e.g. 15" />
              </View>
              <View style={{ flex: 1 }}>
                <MoneyField label="Minimum payment" value={draft.minimumPayment} onChange={(c) => set('minimumPayment', c)} optional />
              </View>
            </View>
            {credit ? (
              <>
                <Field label="How you usually pay">
                  <Segmented
                    items={[
                      { value: 'statement', label: 'Statement' },
                      { value: 'minimum', label: 'Minimum' },
                      { value: 'fixed', label: 'Fixed amount' },
                    ]}
                    value={draft.plannedPayment ?? 'statement'}
                    onChange={(v) => set('plannedPayment', v)}
                  />
                </Field>
                {(draft.plannedPayment ?? 'statement') === 'fixed' && <MoneyField label="Payment amount" value={draft.paymentAmount} onChange={(c) => set('paymentAmount', c)} />}
              </>
            ) : (
              <MoneyField label="Monthly payment" value={draft.paymentAmount} onChange={(c) => set('paymentAmount', c)} optional hint="What you actually pay each month, if more than the minimum." />
            )}
            {info.fields.statement && (
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <MoneyField label="Statement balance" value={draft.statementBalance} onChange={(c) => set('statementBalance', c)} optional />
                </View>
                <View style={{ flex: 1 }}>
                  <NumberField label="Statement closes on day" value={draft.statementClosingDay} onChange={(n) => set('statementClosingDay', n)} integer optional error={errors.statementClosingDay} />
                </View>
              </View>
            )}
          </Stack>
        </Section>
      )}

      <Section title="Appearance & notes">
        <Stack gap={spacing.lg}>
          <Field label="Color">
            <View style={styles.colors}>
              {ENTITY_COLORS.map((c) => (
                <Pressable key={c} onPress={() => set('color', c)} accessibilityRole="radio" accessibilityState={{ checked: draft.color === c }} accessibilityLabel={`Color ${c}`} style={[styles.swatch, { backgroundColor: c }, draft.color === c && styles.swatchActive]} />
              ))}
            </View>
          </Field>
          <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
          <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t || undefined)} multiline optional placeholder="Account number hints, rewards, promo details…" />
        </Stack>
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.sm },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 34, height: 34, borderRadius: radius.pill, borderWidth: 3, borderColor: colors.surface },
  swatchActive: { borderColor: colors.primaryMuted, boxShadow: `0px 0px 0px 2px ${colors.primary}` },
});
