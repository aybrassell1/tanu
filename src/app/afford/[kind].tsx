import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { BudgetBar, CashTiles, ChecksCard, SnapshotCard, VerdictCard } from '@/components/afford/Results';
import { Button, Card, EmptyState, Field, HBarList, Money, MoneyField, NavHeader, NumberField, Screen, Section, Segmented, SwitchRow, Text, useOverlay } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import {
  carAffordability,
  carScenario,
  financialSnapshot,
  houseAffordability,
  houseScenario,
  purchaseAffordability,
  purchaseScenario,
  rentAffordability,
  rentScenario,
  type AffordabilityResult,
  type CarInput,
  type FinancialSnapshot,
  type HouseInput,
  type PurchaseInput,
  type RentInput,
} from '@/domain/affordability';
import type { Cents, ScenarioChange } from '@/domain/types';
import { useData, useDerived, useMoney } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, series, spacing } from '@/theme/tokens';

const $ = (d: number): Cents => Math.round(d * 100);
const round = (cents: Cents, step: number) => Math.max(step, Math.round(cents / step) * step);

type Kind = 'car' | 'rent' | 'house' | 'purchase';
const TITLES: Record<Kind, { title: string; emoji: string; question: string }> = {
  car: { title: 'Car', emoji: 'automobile', question: 'Can I afford this car?' },
  rent: { title: 'Rent', emoji: 'key', question: 'Can I afford this rent?' },
  house: { title: 'Home', emoji: 'house-with-garden', question: 'Can I afford this home?' },
  purchase: { title: 'Big purchase', emoji: 'shopping-bags', question: 'Can I afford this?' },
};

function Grid({ children }: { children: ReactNode }) {
  return <View style={styles.grid}>{children}</View>;
}
function Cell({ children }: { children: ReactNode }) {
  return <View style={styles.cell}>{children}</View>;
}

export default function AffordCalculatorScreen() {
  const { kind } = useLocalSearchParams<{ kind: Kind }>();
  const info = TITLES[kind as Kind];
  const snapshot = useDerived(financialSnapshot);
  if (!info) {
    return (
      <Screen header={<NavHeader title="Calculator" />}>
        <EmptyState icon="search" title="Calculator not found" />
      </Screen>
    );
  }
  return (
    <Screen header={<NavHeader title={info.title} />}>
      {kind === 'car' && <CarCalculator s={snapshot} />}
      {kind === 'rent' && <RentCalculator s={snapshot} />}
      {kind === 'house' && <HouseCalculator s={snapshot} />}
      {kind === 'purchase' && <PurchaseCalculator s={snapshot} />}
    </Screen>
  );
}

/** Shared results stack: verdict → budget bar → checks → breakdown → cash. */
function Results({ kind, s, result, extras, changes, scenarioName }: { kind: Kind; s: FinancialSnapshot; result: AffordabilityResult; extras?: ReactNode; changes: () => ScenarioChange[]; scenarioName: string }) {
  const router = useRouter();
  const money = useMoney();
  const { toast } = useOverlay();
  const toScenario = () => {
    const r = ledger.saveScenario({ name: scenarioName, horizonMonths: kind === 'house' ? 60 : 36, changes: changes() });
    if (!r.ok) return toast({ message: Object.values(r.errors)[0], tone: 'error' });
    router.push(`/scenarios/${r.id}`);
  };
  return (
    <>
      <VerdictCard result={result} title={TITLES[kind].question} />
      <BudgetBar result={result} snapshot={s} />
      {extras}
      <Section title="Rules of thumb">
        <ChecksCard checks={result.checks} />
      </Section>
      {result.breakdown.length > 1 && (
        <Section title="Monthly cost" accessory={<Money cents={result.monthlyCost} weight="semibold" whole />}>
          <Card>
            <HBarList items={result.breakdown.map((b, i) => ({ key: b.key, label: b.label, value: b.amount, valueLabel: money(b.amount, { whole: true }), color: series[i % series.length] }))} />
            {result.replaces > 0 && (
              <Text variant="small" color={colors.textSecondary} style={{ marginTop: spacing.md }}>
                Replaces {money(result.replaces, { whole: true })}/mo you pay now · net change {money(result.netMonthlyChange, { whole: true, signed: true })}/mo
              </Text>
            )}
          </Card>
        </Section>
      )}
      <CashTiles result={result} />
      <Button label="Project it over time" icon="git-branch" variant="secondary" size="lg" fullWidth onPress={toScenario} accessibilityHint="Creates a hypothetical scenario" />
      <SnapshotCard snapshot={s} />
    </>
  );
}

function Hero({ kind }: { kind: Kind }) {
  return (
    <View style={styles.hero}>
      <EmojiIcon name={TITLES[kind].emoji} size={56} />
    </View>
  );
}

// ─── Car ─────────────────────────────────────────────────────────────────────

function CarCalculator({ s }: { s: FinancialSnapshot }) {
  const money = useMoney();
  const [input, setInput] = useState<CarInput>({
    price: $(25_000),
    downPayment: $(5_000),
    tradeIn: 0,
    salesTaxPct: 7,
    fees: $(500),
    apr: 7,
    termMonths: 60,
    insurance: $(150),
    fuel: $(140),
    maintenance: $(60),
    replaceCurrent: s.currentCar > 0,
  });
  const set = <K extends keyof CarInput>(k: K, v: CarInput[K]) => setInput((i) => ({ ...i, [k]: v }));
  const result = useMemo(() => carAffordability(s, input), [s, input]);

  return (
    <>
      <Hero kind="car" />
      <Grid>
        <Cell><MoneyField label="Price" value={input.price} onChange={(v) => set('price', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Down payment" value={input.downPayment} onChange={(v) => set('downPayment', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Trade-in" value={input.tradeIn || undefined} onChange={(v) => set('tradeIn', v ?? 0)} optional /></Cell>
        <Cell><NumberField label="APR" value={input.apr} onChange={(v) => set('apr', v ?? 0)} suffix="%" /></Cell>
      </Grid>
      <Field label="Loan length">
        <Segmented items={['36', '48', '60', '72', '84'].map((m) => ({ value: m, label: `${m} mo` }))} value={String(input.termMonths)} onChange={(v) => set('termMonths', Number(v))} size="sm" />
      </Field>
      <Grid>
        <Cell><MoneyField label="Insurance / mo" value={input.insurance} onChange={(v) => set('insurance', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Gas / mo" value={input.fuel} onChange={(v) => set('fuel', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Upkeep / mo" value={input.maintenance} onChange={(v) => set('maintenance', v ?? 0)} /></Cell>
        <Cell><NumberField label="Sales tax" value={input.salesTaxPct} onChange={(v) => set('salesTaxPct', v ?? 0)} suffix="%" /></Cell>
      </Grid>
      {s.currentCar > 0 && (
        <Card variant="muted" padding={spacing.md}>
          <SwitchRow label="Replaces my current car" description={`About ${money(s.currentCar, { whole: true })}/mo today`} value={input.replaceCurrent} onChange={(v) => set('replaceCurrent', v)} />
        </Card>
      )}
      <Results
        kind="car"
        s={s}
        result={result}
        scenarioName="Buy a car"
        changes={() => carScenario(input, result)}
        extras={
          <View style={styles.tiles}>
            <Mini label="Loan" value={money(result.financed, { whole: true })} />
            <Mini label="Interest" value={money(result.totalInterest, { whole: true })} />
            <Mini label="True cost" value={money(result.totalCost, { whole: true })} />
          </View>
        }
      />
    </>
  );
}

// ─── Rent ────────────────────────────────────────────────────────────────────

function RentCalculator({ s }: { s: FinancialSnapshot }) {
  const money = useMoney();
  const [input, setInput] = useState<RentInput>({
    rent: s.currentHousing > 0 ? round(s.currentHousing, $(50)) : $(1_500),
    utilities: $(150),
    insurance: $(15),
    other: 0,
    moveInCosts: $(3_500),
    replaceCurrent: s.currentHousing > 0,
  });
  const set = <K extends keyof RentInput>(k: K, v: RentInput[K]) => setInput((i) => ({ ...i, [k]: v }));
  const result = useMemo(() => rentAffordability(s, input), [s, input]);
  const data = useData();

  return (
    <>
      <Hero kind="rent" />
      <Grid>
        <Cell><MoneyField label="Rent / mo" value={input.rent} onChange={(v) => set('rent', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Utilities / mo" value={input.utilities} onChange={(v) => set('utilities', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Insurance / mo" value={input.insurance} onChange={(v) => set('insurance', v ?? 0)} /></Cell>
        <Cell><MoneyField label="Parking, pets…" value={input.other || undefined} onChange={(v) => set('other', v ?? 0)} optional /></Cell>
      </Grid>
      <MoneyField label="Move-in costs" value={input.moveInCosts} onChange={(v) => set('moveInCosts', v ?? 0)} hint="Deposit, first month, movers, furniture" />
      {s.currentHousing > 0 && (
        <Card variant="muted" padding={spacing.md}>
          <SwitchRow label="Replaces my current housing" description={`About ${money(s.currentHousing, { whole: true })}/mo today`} value={input.replaceCurrent} onChange={(v) => set('replaceCurrent', v)} />
        </Card>
      )}
      <Results
        kind="rent"
        s={s}
        result={result}
        scenarioName="New rent"
        changes={() => rentScenario(data, input, result)}
        extras={
          <View style={styles.tiles}>
            <Mini label="Max rent at 30%" value={money(result.maxRentAt30, { whole: true })} />
            <Mini label="Income for this rent" value={`${money(result.incomeNeededYearly, { whole: true, compact: true })}/yr`} />
          </View>
        }
      />
    </>
  );
}

// ─── House ───────────────────────────────────────────────────────────────────

function HouseCalculator({ s }: { s: FinancialSnapshot }) {
  const money = useMoney();
  const [input, setInput] = useState<HouseInput>({
    price: $(350_000),
    downPayment: $(35_000),
    apr: 6.5,
    termYears: 30,
    propertyTaxPct: 1.1,
    insuranceYearly: $(1_800),
    hoaMonthly: 0,
    pmiPct: 0.5,
    closingPct: 3,
    maintenancePct: 1,
    replaceCurrent: s.currentHousing > 0,
  });
  const set = <K extends keyof HouseInput>(k: K, v: HouseInput[K]) => setInput((i) => ({ ...i, [k]: v }));
  const result = useMemo(() => houseAffordability(s, input), [s, input]);
  const downPct = input.price > 0 ? Math.round((input.downPayment / input.price) * 100) : 0;

  return (
    <>
      <Hero kind="house" />
      <Grid>
        <Cell><MoneyField label="Home price" value={input.price} onChange={(v) => set('price', v ?? 0)} /></Cell>
        <Cell><MoneyField label={`Down payment · ${downPct}%`} value={input.downPayment} onChange={(v) => set('downPayment', v ?? 0)} /></Cell>
        <Cell><NumberField label="Interest rate" value={input.apr} onChange={(v) => set('apr', v ?? 0)} suffix="%" /></Cell>
        <Cell><MoneyField label="HOA / mo" value={input.hoaMonthly || undefined} onChange={(v) => set('hoaMonthly', v ?? 0)} optional /></Cell>
      </Grid>
      <Field label="Mortgage length">
        <Segmented items={[{ value: '15', label: '15 years' }, { value: '20', label: '20 years' }, { value: '30', label: '30 years' }]} value={String(input.termYears)} onChange={(v) => set('termYears', Number(v))} size="sm" />
      </Field>
      <Grid>
        <Cell><NumberField label="Property tax / yr" value={input.propertyTaxPct} onChange={(v) => set('propertyTaxPct', v ?? 0)} suffix="%" /></Cell>
        <Cell><MoneyField label="Insurance / yr" value={input.insuranceYearly} onChange={(v) => set('insuranceYearly', v ?? 0)} /></Cell>
        <Cell><NumberField label="Closing costs" value={input.closingPct} onChange={(v) => set('closingPct', v ?? 0)} suffix="%" /></Cell>
        <Cell><NumberField label="Upkeep / yr" value={input.maintenancePct} onChange={(v) => set('maintenancePct', v ?? 0)} suffix="%" /></Cell>
      </Grid>
      {s.currentHousing > 0 && (
        <Card variant="muted" padding={spacing.md}>
          <SwitchRow label="Replaces my current housing" description={`About ${money(s.currentHousing, { whole: true })}/mo today`} value={input.replaceCurrent} onChange={(v) => set('replaceCurrent', v)} />
        </Card>
      )}
      <Results
        kind="house"
        s={s}
        result={result}
        scenarioName="Buy a home"
        changes={() => houseScenario(input, result)}
        extras={
          <View style={styles.tiles}>
            <Mini label="Max price at 28%" value={money(result.maxPriceAt28, { whole: true, compact: true })} />
            <Mini label="Payment" value={`${money(result.housingPayment, { whole: true })}/mo`} />
            <Mini label="Lifetime interest" value={money(result.totalInterest, { whole: true, compact: true })} />
          </View>
        }
      />
    </>
  );
}

// ─── Big purchase ────────────────────────────────────────────────────────────

function PurchaseCalculator({ s }: { s: FinancialSnapshot }) {
  const money = useMoney();
  const [input, setInput] = useState<PurchaseInput>({
    cost: $(2_000),
    method: 'save',
    monthlySaving: Math.max($(50), round(Math.max(0, s.surplus) / 2, $(25))),
    apr: 0,
    termMonths: 12,
  });
  const set = <K extends keyof PurchaseInput>(k: K, v: PurchaseInput[K]) => setInput((i) => ({ ...i, [k]: v }));
  const result = useMemo(() => purchaseAffordability(s, input), [s, input]);

  return (
    <>
      <Hero kind="purchase" />
      <MoneyField label="Cost" value={input.cost} onChange={(v) => set('cost', v ?? 0)} />
      <Field label="How would you pay?">
        <Segmented items={[{ value: 'cash', label: 'Cash now' }, { value: 'save', label: 'Save up' }, { value: 'finance', label: 'Finance' }]} value={input.method} onChange={(v) => set('method', v)} />
      </Field>
      {input.method === 'save' && <MoneyField label="Put aside each month" value={input.monthlySaving} onChange={(v) => set('monthlySaving', v ?? 0)} />}
      {input.method === 'finance' && (
        <Grid>
          <Cell><NumberField label="APR" value={input.apr} onChange={(v) => set('apr', v ?? 0)} suffix="%" /></Cell>
          <Cell><NumberField label="Months" value={input.termMonths} onChange={(v) => set('termMonths', v ?? 0)} integer /></Cell>
        </Grid>
      )}
      <Results
        kind="purchase"
        s={s}
        result={result}
        scenarioName="Big purchase"
        changes={() => purchaseScenario(input, 'Big purchase')}
        extras={
          <View style={styles.tiles}>
            {input.method === 'save' && <Mini label="Ready in" value={Number.isFinite(result.monthsToSave) ? `${result.monthsToSave} mo` : 'Never'} />}
            {input.method === 'finance' && <Mini label="Payment" value={`${money(result.payment, { whole: true })}/mo`} />}
            {input.method === 'finance' && <Mini label="Interest" value={money(result.totalInterest, { whole: true })} />}
            <Mini label="Months of take-home" value={s.takeHome > 0 ? (input.cost / s.takeHome).toFixed(1) : '—'} />
          </View>
        }
      />
    </>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <Card variant="muted" padding={spacing.md} style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
        {label}
      </Text>
      <Text variant="h3" tabular numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: -spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  cell: { width: '47%', flexGrow: 1 },
  tiles: { flexDirection: 'row', gap: spacing.sm },
});
