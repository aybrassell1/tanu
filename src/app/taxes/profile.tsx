import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Button, Card, ChipSelect, Disclosure, MoneyField, NavHeader, NumberField, Screen, Section, SelectField, SwitchRow, Text, useOverlay } from '@/components/ui';
import { FILING_STATUS_LABEL } from '@/domain/taxTables';
import type { FilingStatus, TaxProfile } from '@/domain/types';
import { goBackOr } from '@/lib/navigation';
import { useData } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

function Stepper({ label, value, onChange, max = 10 }: { label: string; value: number; onChange: (n: number) => void; max?: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 6 }}>
      <Text style={{ flex: 1 }}>{label}</Text>
      <Button label="−" variant="secondary" size="sm" onPress={() => onChange(Math.max(0, value - 1))} disabled={value === 0} accessibilityHint={`Decrease ${label}`} />
      <Text variant="h3" tabular style={{ minWidth: 24, textAlign: 'center' }}>
        {value}
      </Text>
      <Button label="+" variant="secondary" size="sm" onPress={() => onChange(Math.min(max, value + 1))} disabled={value >= max} accessibilityHint={`Increase ${label}`} />
    </View>
  );
}

export default function TaxProfileScreen() {
  const router = useRouter();
  const { toast } = useOverlay();
  const saved = useData().taxProfile;
  const [p, setP] = useState<TaxProfile>(saved);
  const set = <K extends keyof TaxProfile>(key: K, value: TaxProfile[K]) => setP((x) => ({ ...x, [key]: value }));
  const joint = p.filingStatus === 'married_joint';

  const save = () => {
    ledger.updateTaxProfile({ ...p, seniors: Math.min(p.seniors, joint ? 2 : 1), stateRate: Math.max(0, Math.min(15, p.stateRate || 0)) });
    toast('Tax profile saved');
    goBackOr(router, '/taxes');
  };

  return (
    <Screen header={<NavHeader title="Tax profile" />} footer={<Button label="Save" size="lg" fullWidth onPress={save} />}>
      <Section title="Filing">
        <Card style={{ gap: spacing.md }}>
          <SelectField<FilingStatus>
            label="Filing status"
            value={p.filingStatus}
            onChange={(v) => set('filingStatus', v)}
            options={(Object.keys(FILING_STATUS_LABEL) as FilingStatus[]).map((k) => ({ value: k, label: FILING_STATUS_LABEL[k] }))}
          />
          <Stepper label="Children under 17" value={p.dependentsUnder17} onChange={(n) => set('dependentsUnder17', n)} />
          <Stepper label="Other dependents" value={p.otherDependents} onChange={(n) => set('otherDependents', n)} />
          <Stepper label={joint ? 'Filers 65 or older' : 'Age 65 or older'} value={p.seniors} onChange={(n) => set('seniors', n)} max={joint ? 2 : 1} />
        </Card>
      </Section>

      <Section title="Deductions">
        <Card style={{ gap: spacing.sm }}>
          <ChipSelect
            options={[
              { value: 'auto', label: 'Pick the bigger one' },
              { value: 'standard', label: 'Standard' },
              { value: 'itemized', label: 'Itemize' },
            ]}
            value={p.deduction}
            onChange={(v) => set('deduction', v as TaxProfile['deduction'])}
          />
          <SwitchRow label="Car loan qualifies for the interest deduction" description="New, US-assembled vehicle bought after 2024" value={p.carLoanQualifies} onChange={(v) => set('carLoanQualifies', v)} />
        </Card>
      </Section>

      <Section title="Savings accounts">
        <Card style={{ gap: spacing.sm }}>
          <SwitchRow label="Age 50 or older" description="Higher 401(k) and IRA limits" value={p.age50Plus} onChange={(v) => set('age50Plus', v)} />
          <ChipSelect
            label="HSA coverage"
            options={[
              { value: 'none', label: 'No HSA' },
              { value: 'self', label: 'Self-only' },
              { value: 'family', label: 'Family' },
            ]}
            value={p.hsaCoverage}
            onChange={(v) => set('hsaCoverage', v as TaxProfile['hsaCoverage'])}
          />
        </Card>
      </Section>

      <Section title="State">
        <Card>
          <NumberField label="Approximate state income tax rate" value={p.stateRate || undefined} onChange={(v) => set('stateRate', v ?? 0)} suffix="%" placeholder="0" hint="Leave at 0 for states without income tax" />
        </Card>
      </Section>

      <Disclosure label="Last year (for estimated payments)">
        <Card style={{ gap: spacing.md }}>
          <MoneyField label="Total federal tax last year" optional value={p.priorYearTax} onChange={(v) => set('priorYearTax', v)} hint="Form 1040, line 24" />
          <MoneyField label="AGI last year" optional value={p.priorYearAgi} onChange={(v) => set('priorYearAgi', v)} hint="Form 1040, line 11" />
        </Card>
      </Disclosure>

      <Text variant="caption" color={colors.textTertiary} align="center">
        Stored only on this device.
      </Text>
    </Screen>
  );
}
