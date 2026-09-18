import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { LinesCard, ResultHero, useTaxYear, YearSwitch } from '@/components/taxes/TaxParts';
import { Banner, Button, Card, Disclosure, ListCard, ListRow, Money, MoneyField, NavHeader, Pill, Screen, Section, SelectField, Sheet, Text, TextField, useOverlay } from '@/components/ui';
import { estimateTaxes, taxRecord } from '@/domain/taxes';
import type { TaxAdjustment, TaxAdjustmentKind } from '@/domain/types';
import { useData, useDerived } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const ADJUSTMENT_KINDS: { value: TaxAdjustmentKind; label: string; description: string }[] = [
  { value: 'capital_gain_long', label: 'Long-term capital gain or loss', description: 'Investments held over a year (1099-B). Losses are negative.' },
  { value: 'capital_gain_short', label: 'Short-term capital gain or loss', description: 'Held a year or less; taxed like wages.' },
  { value: 'other_income', label: 'Other taxable income', description: 'Anything not recorded as a transaction' },
  { value: 'other_deduction', label: 'Other itemized deduction', description: 'e.g. gambling losses, casualty losses' },
  { value: 'credit', label: 'Tax credit', description: 'e.g. education, energy or dependent care credits' },
  { value: 'federal_withholding', label: 'Extra federal withholding', description: 'From a W-2, 1099-R or other form' },
  { value: 'state_withholding', label: 'Extra state withholding', description: 'State tax withheld elsewhere' },
];

export default function TaxEstimateScreen() {
  const data = useData();
  const { confirm, toast } = useOverlay();
  const { year, years, today } = useTaxYear();
  const current = year === Number(today.slice(0, 4));
  const e = useDerived((d, t) => estimateTaxes(d, year, t, current ? 'projected' : 'ytd'), [year, current]);
  const adjustments = taxRecord(data, year).adjustments;
  const [editing, setEditing] = useState<Partial<TaxAdjustment> | null>(null);

  const deductionCompare = Math.max(e.standardDeduction, e.itemizedTotal, 1);

  return (
    <Screen header={<NavHeader title={`${year} estimate`} right={<YearSwitch year={year} years={years} />} />}>
      {current && <Pill label="Full-year projection" tone="projected" size="sm" style={{ alignSelf: 'flex-start' }} />}
      <Card padding={spacing.xl}>
        <ResultHero estimate={e} />
      </Card>

      {data.taxProfile.deduction === 'itemized' && e.itemizedTotal < e.standardDeduction && (
        <Banner tone="warning" icon="alert-triangle" title="Itemizing costs you more" message="Your itemized total is below the standard deduction. Switch to “Pick the bigger one” in your tax profile." />
      )}

      {e.missingPaycheckDetail > 0 && (
        <Banner tone="warning" icon="alert-triangle" title="Some paychecks lack gross pay" message="Add gross pay and withholding on your income source so wages and tax withheld are right." />
      )}

      <Section title="Income" accessory={<Money cents={e.totalIncome} weight="semibold" whole />}>
        <LinesCard lines={e.income} />
      </Section>

      {e.adjustments.length > 0 && (
        <Section title="Adjustments">
          <LinesCard lines={e.adjustments} negative total={e.agi} totalLabel="Adjusted gross income (AGI)" />
        </Section>
      )}

      <Section title="Deductions" accessory={<Text variant="caption" color={colors.textSecondary}>{e.usedItemized ? 'Itemizing' : 'Standard'}</Text>}>
        <Card style={{ gap: spacing.md }}>
          {[
            { key: 'standard', label: 'Standard deduction', amount: e.standardDeduction, used: !e.usedItemized },
            { key: 'itemized', label: 'Itemized total', amount: e.itemizedTotal, used: e.usedItemized },
          ].map((row) => (
            <View key={row.key} style={{ gap: 4 }}>
              <View style={styles.between}>
                <Text variant="small" weight={row.used ? 'semibold' : 'regular'}>
                  {row.label} {row.used ? '✓' : ''}
                </Text>
                <Money cents={row.amount} variant="small" whole />
              </View>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round((row.amount / deductionCompare) * 100)}%`, backgroundColor: row.used ? colors.primary : colors.borderStrong }]} />
              </View>
            </View>
          ))}
          {e.itemized.length > 0 && (
            <Disclosure label="Itemized details" count={e.itemized.length}>
              <LinesCard lines={e.itemized} />
            </Disclosure>
          )}
        </Card>
        {e.otherDeductions.length > 0 && <LinesCard lines={e.otherDeductions} negative />}
      </Section>

      <Section title="Tax">
        <LinesCard
          lines={[
            { key: 'taxable', label: 'Taxable income', amount: e.taxableIncome },
            { key: 'income_tax', label: 'Income tax', amount: e.incomeTax },
            ...e.credits.map((c) => ({ ...c, amount: -c.amount })),
            ...(e.selfEmploymentTax > 0 ? [{ key: 'se', label: 'Self-employment tax', amount: e.selfEmploymentTax }] : []),
            ...(e.additionalMedicare > 0 ? [{ key: 'addl', label: 'Additional Medicare tax', amount: e.additionalMedicare }] : []),
          ]}
          total={e.totalTax}
          totalLabel="Total federal tax"
        />
      </Section>

      <Section title={current ? 'Withholding & payments by year-end' : 'Withholding & payments'}>
        <LinesCard lines={e.payments} total={e.totalPayments} totalLabel="Total payments" />
      </Section>

      {e.state && (
        <Section title="State (rough)">
          <LinesCard
            lines={[
              { key: 'tax', label: `${data.taxProfile.stateRate}% of AGI`, amount: e.state.tax },
              { key: 'paid', label: 'Withheld & paid', amount: e.state.paid },
            ]}
            total={Math.abs(e.state.refund)}
            totalLabel={e.state.refund >= 0 ? 'Estimated state refund' : 'Estimated state owed'}
          />
        </Section>
      )}

      <Section title="Things not in your transactions" action="Add" onAction={() => setEditing({ kind: 'capital_gain_long' })}>
        {adjustments.length === 0 ? (
          <Text variant="small" color={colors.textTertiary}>
            Investment sales, credits or withholding from other forms.
          </Text>
        ) : (
          <ListCard>
            {adjustments.map((a) => (
              <ListRow
                key={a.id}
                title={a.label}
                subtitle={a.label === ADJUSTMENT_KINDS.find((k) => k.value === a.kind)?.label ? undefined : ADJUSTMENT_KINDS.find((k) => k.value === a.kind)?.label}
                trailing={<Money cents={a.amount} weight="semibold" whole />}
                chevron
                onPress={() => setEditing(a)}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <Disclosure label="What this estimate leaves out">
        <Card variant="muted" style={{ gap: 6 }}>
          {e.notModeled.map((n) => (
            <Text key={n} variant="small" color={colors.textSecondary}>
              • {n}
            </Text>
          ))}
        </Card>
      </Disclosure>

      <Text variant="caption" color={colors.textTertiary} align="center">
        Uses IRS {year} brackets and limits. A planning estimate, not tax advice.
      </Text>

      <AdjustmentSheet
        value={editing}
        onClose={() => setEditing(null)}
        onSave={(input) => {
          const r = ledger.saveTaxAdjustment(year, input);
          if (r.ok) setEditing(null);
          return r;
        }}
        onDelete={async (id) => {
          if (await confirm({ title: 'Remove this item?', confirmLabel: 'Remove', destructive: true })) {
            ledger.deleteTaxAdjustment(year, id);
            setEditing(null);
            toast({ message: 'Removed', actionLabel: 'Undo', onAction: () => ledger.undo() });
          }
        }}
      />
    </Screen>
  );
}

function AdjustmentSheet({
  value,
  onClose,
  onSave,
  onDelete,
}: {
  value: Partial<TaxAdjustment> | null;
  onClose: () => void;
  onSave: (input: Omit<TaxAdjustment, 'id'> & { id?: string }) => { ok: true; id: string } | { ok: false; errors: Record<string, string> };
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState<Partial<TaxAdjustment>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [openedFor, setOpenedFor] = useState<Partial<TaxAdjustment> | null>(null);
  if (value !== openedFor) {
    setOpenedFor(value);
    setDraft(value ?? {});
    setErrors({});
  }
  const kind = ADJUSTMENT_KINDS.find((k) => k.value === draft.kind);
  const allowNegative = draft.kind === 'capital_gain_long' || draft.kind === 'capital_gain_short';
  const save = () => {
    const r = onSave({ id: draft.id, kind: draft.kind ?? 'other_income', label: draft.label ?? kind?.label ?? '', amount: draft.amount ?? 0 });
    if (!r.ok) setErrors(r.errors);
  };
  return (
    <Sheet
      visible={value !== null}
      onClose={onClose}
      title={draft.id ? 'Edit item' : 'Add a tax item'}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          {draft.id && <Button label="Remove" variant="secondary" onPress={() => onDelete(draft.id!)} />}
          <Button label="Save" onPress={save} style={{ flex: 1 }} />
        </View>
      }
    >
      <SelectField label="Type" value={draft.kind} onChange={(k) => setDraft((d) => ({ ...d, kind: k }))} options={ADJUSTMENT_KINDS} />
      <TextField label="Label" value={draft.label ?? ''} onChangeText={(label) => setDraft((d) => ({ ...d, label }))} placeholder={kind?.label} error={errors.label} />
      <MoneyField label="Amount" value={draft.amount} onChange={(amount) => setDraft((d) => ({ ...d, amount }))} allowNegative={allowNegative} error={errors.amount} hint={kind?.description} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  track: { height: 8, borderRadius: 999, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 999 },
});
