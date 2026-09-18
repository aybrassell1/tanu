import { StyleSheet, View } from 'react-native';

import { Button, Card, InfoButton, MoneyField, NumberField, Row, Text } from '@/components/ui';
import { MAX_AGE, MIN_AGE, type RetirementAssumptions } from '@/domain/retirement';
import { colors, spacing } from '@/theme/tokens';

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

type Props = {
  value: RetirementAssumptions;
  onChange: (patch: Partial<RetirementAssumptions>) => void;
  onReset: () => void;
  /** True when the contribution and spending figures are still the measured ones. */
  measured: boolean;
  contributionHint: string;
  spendingHint: string;
};

/**
 * Every number the projection rests on, in one editable panel. Nothing here
 * is saved to the ledger: the screen is a calculator, not a record.
 */
export function AssumptionFields({ value, onChange, onReset, measured, contributionHint, spendingHint }: Props) {
  const ageError = value.retirementAge <= value.currentAge ? 'Pick an age after your current age.' : undefined;
  const set = (patch: Partial<RetirementAssumptions>) => onChange(patch);

  return (
    <Card style={{ gap: spacing.lg }}>
      <Row>
        <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">
          Assumptions
        </Text>
        <InfoButton title="How this is worked out">
          {'Balances grow once a year at the return you set, with contributions earning half a year of growth. ' +
            "Today's dollars divide the result by inflation compounded over the same years. " +
            'The independence target is your yearly spending divided by the withdrawal rate — 4% gives the familiar 25×. ' +
            'Years to target count in real terms, so the target never moves.'}
        </InfoButton>
      </Row>

      <View style={styles.grid}>
        <View style={styles.half}>
          <NumberField
            label="Current age"
            integer
            value={value.currentAge}
            onChange={(n) => n !== undefined && n >= 0 && n <= 120 && set({ currentAge: n })}
            onBlur={() => set({ currentAge: clamp(Math.round(value.currentAge), MIN_AGE, MAX_AGE) })}
          />
        </View>
        <View style={styles.half}>
          <NumberField
            label="Retire at age"
            integer
            value={value.retirementAge}
            error={ageError}
            onChange={(n) => n !== undefined && n >= 0 && n <= 120 && set({ retirementAge: n })}
            onBlur={() => set({ retirementAge: clamp(Math.round(value.retirementAge), MIN_AGE, MAX_AGE) })}
          />
        </View>
      </View>

      <MoneyField
        label="Invested each month"
        value={value.monthlyContribution}
        onChange={(cents) => set({ monthlyContribution: cents ?? 0 })}
        hint={contributionHint}
      />

      <View style={styles.grid}>
        <View style={styles.half}>
          <NumberField
            label="Return a year %"
            value={value.returnRate}
            onChange={(n) => n !== undefined && n >= -20 && n <= 30 && set({ returnRate: n })}
            onBlur={() => set({ returnRate: clamp(value.returnRate, -20, 30) })}
          />
        </View>
        <View style={styles.half}>
          <NumberField
            label="Inflation %"
            value={value.inflation}
            onChange={(n) => n !== undefined && n >= 0 && n <= 20 && set({ inflation: n })}
            onBlur={() => set({ inflation: clamp(value.inflation, 0, 20) })}
          />
        </View>
      </View>

      <NumberField
        label="Withdrawal rate"
        value={value.withdrawalRate}
        suffix="%"
        hint={`A ${value.withdrawalRate}% rate means a target of ${(100 / Math.max(1, value.withdrawalRate)).toFixed(0)}× your yearly spending.`}
        onChange={(n) => n !== undefined && n > 0 && n <= 20 && set({ withdrawalRate: n })}
        onBlur={() => set({ withdrawalRate: clamp(value.withdrawalRate, 1, 20) })}
      />

      <MoneyField label="Spending a year" value={value.annualSpending} onChange={(cents) => set({ annualSpending: cents ?? 0 })} hint={spendingHint} />

      {!measured && (
        <Row>
          <Text variant="caption" color={colors.textTertiary} style={{ flex: 1 }}>
            Changed from what your ledger shows.
          </Text>
          <Button label="Reset" size="sm" variant="secondary" onPress={onReset} />
        </Row>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', gap: spacing.sm },
  half: { flex: 1 },
});
