import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AccountSelect, CategorySelect, FrequencySelect } from '@/components/finance/Pickers';
import {
  Banner,
  Button,
  DateField,
  Disclosure,
  MoneyField,
  NavHeader,
  NumberField,
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
import { accountNature, INCOME_TYPES } from '@/domain/catalog';
import { formatPercent } from '@/domain/money';
import { frequencyLabel } from '@/domain/recurrence';
import { expectedGross, primaryCashAccount } from '@/domain/schedule';
import { allTags } from '@/domain/search';
import type { Account, Cents, Frequency, ID, IncomeSource, IncomeType, ISODate, PaycheckWithholding, TaxForm } from '@/domain/types';
import { useData, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, radius, spacing } from '@/theme/tokens';

const DEFAULT_CATEGORY: Record<IncomeType, ID> = {
  salary: 'income.paycheck',
  hourly: 'income.paycheck',
  overtime: 'income.overtime',
  bonus: 'income.bonus',
  freelance: 'income.freelance',
  side_business: 'income.side_business',
  reselling: 'income.reselling',
  interest: 'income.interest',
  dividends: 'income.dividends',
  investment_income: 'income.investment',
  gift: 'income.gifts',
  refund: 'income.tax_refund',
  other: 'income.other',
};

const TYPE_OPTIONS: SelectOption<IncomeType>[] = (Object.keys(INCOME_TYPES) as IncomeType[]).map((t) => ({
  value: t,
  label: INCOME_TYPES[t].label,
  icon: icon(INCOME_TYPES[t].icon),
  color: colors.positive,
}));

const BIWEEKLY: Frequency = { unit: 'week', interval: 2 };
const isHourly = (t: IncomeType) => t === 'hourly' || t === 'overtime';
const depositFilter = (a: Account) => accountNature(a.type) === 'asset';

type Draft = Omit<IncomeSource, 'id' | 'createdAt' | 'updatedAt' | 'frequency' | 'anchorDate' | 'depositAccountId'> & {
  scheduled: boolean;
  frequency: Frequency;
  anchorDate?: ISODate;
  depositAccountId?: ID;
};

export default function IncomeSourceFormScreen() {
  const params = useLocalSearchParams<{ id?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const { toast } = useOverlay();
  const existing = params.id ? data.incomeSources.find((s) => s.id === params.id) : undefined;

  const [draft, setDraft] = useState<Draft>(() => {
    if (existing) {
      const { id: _id, createdAt: _c, updatedAt: _u, frequency, anchorDate, ...rest } = existing;
      return { ...rest, scheduled: !!frequency, frequency: frequency ?? BIWEEKLY, anchorDate: anchorDate ?? today };
    }
    return {
      name: '',
      type: 'salary',
      scheduled: true,
      frequency: BIWEEKLY,
      anchorDate: today,
      depositAccountId: primaryCashAccount(data)?.id,
      categoryId: DEFAULT_CATEGORY.salary,
      active: true,
      tags: [],
    };
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    if (errors[key as string]) setErrors((e) => ({ ...e, [key as string]: '' }));
  };

  const info = INCOME_TYPES[draft.type];
  const hourly = isHourly(draft.type);
  const tagSuggestions = useMemo(() => allTags(data).map((t) => t.tag), [data]);

  const gross: Cents | undefined = hourly
    ? expectedGross({ hourlyRate: draft.hourlyRate, expectedHours: draft.expectedHours } as IncomeSource)
    : draft.expectedGross;
  const takeHomeRate = gross && draft.expectedNet !== undefined ? draft.expectedNet / gross : undefined;

  const changeType = (type: IncomeType) =>
    setDraft((d) => ({
      ...d,
      type,
      // Follow the type's default category unless the user picked something else.
      categoryId: !d.categoryId || d.categoryId === DEFAULT_CATEGORY[d.type] ? DEFAULT_CATEGORY[type] : d.categoryId,
    }));

  const save = () => {
    const local: Record<string, string> = {};
    if (gross !== undefined && draft.expectedNet !== undefined && draft.expectedNet > gross) local.expectedNet = 'Take-home is usually less than gross pay. Check both amounts.';
    if (draft.scheduled && draft.expectedNet === undefined && !gross) local.expectedNet = 'Add the amount you expect per paycheck so forecasts can include it.';
    if (draft.endDate && draft.scheduled && draft.anchorDate && draft.endDate < draft.anchorDate) local.endDate = 'The end date is before the pay date.';
    if (Object.keys(local).length) {
      setErrors(local);
      return;
    }

    const { scheduled, frequency, anchorDate, depositAccountId, ...rest } = draft;
    const result = ledger.saveIncomeSource({
      ...rest,
      id: existing?.id,
      name: draft.name,
      employer: info.employment ? draft.employer?.trim() || undefined : undefined,
      frequency: scheduled ? frequency : undefined,
      anchorDate: scheduled ? anchorDate : undefined,
      hourlyRate: hourly ? draft.hourlyRate : undefined,
      expectedHours: hourly ? draft.expectedHours : undefined,
      expectedGross: hourly ? undefined : draft.expectedGross,
      depositAccountId: depositAccountId ?? '',
      notes: draft.notes?.trim() || undefined,
    });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    toast(existing ? 'Income source updated' : 'Income source added');
    router.back();
  };

  return (
    <Screen header={<NavHeader title={existing ? 'Edit income' : 'New income source'} backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      {!!errors.form && <Banner tone="negative" icon="alert-triangle" title={errors.form} />}

      <Stack gap={spacing.lg}>
        <TextField label="Name" value={draft.name} onChangeText={(t) => set('name', t)} placeholder="e.g. Acme paycheck" error={errors.name} autoFocus={!existing} />
        <SelectField label="Type" value={draft.type} onChange={changeType} options={TYPE_OPTIONS} />
        {info.employment && <TextField label="Employer" value={draft.employer ?? ''} onChangeText={(t) => set('employer', t)} optional placeholder="Company name" />}
      </Stack>

      <View style={styles.group}>
        <SwitchRow
          label="Paid on a schedule"
          description={draft.scheduled ? 'Expected paychecks appear in forecasts and the calendar' : 'Irregular: only recorded income counts'}
          value={draft.scheduled}
          onChange={(v) => set('scheduled', v)}
        />
        {draft.scheduled && (
          <Stack gap={spacing.lg} style={{ paddingBottom: spacing.md }}>
            <FrequencySelect label="How often" value={draft.frequency} onChange={(f) => set('frequency', f)} />
            <DateField
              label="A recent or upcoming pay date"
              value={draft.anchorDate}
              onChange={(d) => set('anchorDate', d)}
              error={errors.anchorDate}
              hint={`Future pay dates repeat ${frequencyLabel(draft.frequency).toLowerCase()} from this date.`}
            />
          </Stack>
        )}
      </View>

      <Stack gap={spacing.lg}>
        {hourly ? (
          <>
            <View style={styles.pair}>
              <View style={{ flex: 1 }}>
                <MoneyField label="Hourly rate" value={draft.hourlyRate} onChange={(c) => set('hourlyRate', c)} optional />
              </View>
              <View style={{ flex: 1 }}>
                <NumberField label="Hours per paycheck" value={draft.expectedHours} onChange={(n) => set('expectedHours', n)} suffix="hrs" optional placeholder="80" />
              </View>
            </View>
            {gross !== undefined && (
              <View style={styles.computed}>
                <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                  Estimated gross per paycheck
                </Text>
                <Text weight="semibold" tabular>
                  {money(gross)}
                </Text>
              </View>
            )}
          </>
        ) : (
          <MoneyField label="Expected gross pay" value={draft.expectedGross} onChange={(c) => set('expectedGross', c)} optional hint="Before taxes and deductions, per paycheck." />
        )}
        <MoneyField
          label="Take-home deposited"
          value={draft.expectedNet}
          onChange={(c) => set('expectedNet', c)}
          error={errors.expectedNet}
          hint={takeHomeRate !== undefined ? `${formatPercent(takeHomeRate)} of gross pay reaches your account.` : 'What actually lands in your account each time. Forecasts use this amount.'}
        />
        {info.employment && gross !== undefined && <PaycheckBreakdown gross={gross} net={draft.expectedNet} value={draft.withholding} onChange={(w) => set('withholding', w)} taxForm={draft.taxForm} onTaxForm={(f) => set('taxForm', f)} />}
        <AccountSelect label="Deposited into" value={draft.depositAccountId} onChange={(id) => set('depositAccountId', id)} filter={depositFilter} error={errors.depositAccountId} />
        <CategorySelect kind="income" value={draft.categoryId} onChange={(id) => set('categoryId', id)} optional />
        <DateField label="Ends" value={draft.endDate} onChange={(d) => set('endDate', d)} optional clearable error={errors.endDate} hint="For a job or contract with a known last paycheck." />
      </Stack>

      <View style={styles.group}>
        <SwitchRow label="Active" description={draft.active ? 'Included in forecasts and available-to-spend' : 'Paused: kept for history only'} value={draft.active} onChange={(v) => set('active', v)} />
      </View>

      <Stack gap={spacing.lg}>
        <TagInput value={draft.tags} onChange={(t) => set('tags', t)} suggestions={tagSuggestions} />
        <TextField label="Notes" value={draft.notes ?? ''} onChangeText={(t) => set('notes', t)} multiline optional />
      </Stack>
    </Screen>
  );
}

const WITHHOLDING_FIELDS: { key: keyof PaycheckWithholding; label: string }[] = [
  { key: 'federal', label: 'Federal tax' },
  { key: 'state', label: 'State tax' },
  { key: 'socialSecurity', label: 'Social Security' },
  { key: 'medicare', label: 'Medicare' },
  { key: 'retirement', label: '401(k) pre-tax' },
  { key: 'hsa', label: 'HSA' },
  { key: 'benefits', label: 'Health & other pre-tax' },
];

const TAX_FORMS: SelectOption<TaxForm>[] = [
  { value: 'W-2', label: 'W-2 employee' },
  { value: '1099-NEC', label: '1099-NEC contractor' },
  { value: '1099-K', label: '1099-K payment app' },
  { value: '1099-MISC', label: '1099-MISC other' },
  { value: 'none', label: 'No tax form' },
];

/** Pay stub deductions, used for tax estimates and copied onto recorded paychecks. */
function PaycheckBreakdown({ gross, net, value, onChange, taxForm, onTaxForm }: { gross: Cents; net?: Cents; value?: PaycheckWithholding; onChange: (w: PaycheckWithholding | undefined) => void; taxForm?: TaxForm; onTaxForm: (f: TaxForm) => void }) {
  const money = useMoney();
  const w = value ?? {};
  const total = WITHHOLDING_FIELDS.reduce((s, f) => s + (w[f.key] ?? 0), 0);
  const filled = WITHHOLDING_FIELDS.some((f) => w[f.key] !== undefined);
  const update = (key: keyof PaycheckWithholding, cents: Cents | undefined) => {
    const next = { ...w, [key]: cents };
    onChange(WITHHOLDING_FIELDS.some((f) => next[f.key] !== undefined) ? next : undefined);
  };
  // Social Security and Medicare apply after HSA and health premiums, but not after 401(k).
  const estimateFica = () => {
    const base = gross - (w.hsa ?? 0) - (w.benefits ?? 0);
    onChange({ ...w, socialSecurity: Math.round(base * 0.062), medicare: Math.round(base * 0.0145) });
  };
  const gap = net !== undefined && filled ? gross - total - net : undefined;
  return (
    <Disclosure label="Pay stub breakdown (for taxes)" initiallyOpen={filled}>
      <Stack gap={spacing.md}>
        <SelectField label="Tax form" value={taxForm} onChange={onTaxForm} options={TAX_FORMS} optional />
        <View style={styles.wrap}>
          {WITHHOLDING_FIELDS.map((f) => (
            <View key={f.key} style={styles.half}>
              <MoneyField label={f.label} value={w[f.key]} onChange={(c) => update(f.key, c)} optional />
            </View>
          ))}
        </View>
        <Button label="Estimate Social Security & Medicare" icon="zap" variant="ghost" size="sm" onPress={estimateFica} />
        {filled && (
          <View style={styles.computed}>
            <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
              {money(gross)} − {money(total)} deductions
            </Text>
            <Text weight="semibold" tabular color={gap !== undefined && Math.abs(gap) > 100 ? colors.warning : colors.ink}>
              {money(gross - total)}
            </Text>
          </View>
        )}
        {gap !== undefined && Math.abs(gap) > 100 && (
          <Text variant="caption" color={colors.warning}>
            {gap > 0 ? `${money(gap)} unaccounted for. Check for a missing deduction.` : `Deductions are ${money(-gap)} too high. Check for a typo or double entry.`}
          </Text>
        )}
      </Stack>
    </Disclosure>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  half: { width: '47%', flexGrow: 1 },
  group: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.md },
  computed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.md, paddingVertical: spacing.md },
});
