import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { IncomeSplit, LimitBars, QuarterStrip, ResultHero, useTaxYear, YearSwitch } from '@/components/taxes/TaxParts';
import { Banner, Button, Card, NavHeader, Pill, Screen, Section, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { formatDate } from '@/domain/dates';
import { TAX_TAGS, contributionLimits, documentChecklist, estimatedPaymentPlan, estimateTaxes, taxCalendar, taxRecord, taxTaggedTransactions } from '@/domain/taxes';
import { FILING_STATUS_LABEL } from '@/domain/taxTables';
import { useData, useDerived, useMoney } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

export default function TaxesScreen() {
  const router = useRouter();
  const money = useMoney();
  const data = useData();
  const { year, years, today } = useTaxYear();
  const current = year === Number(today.slice(0, 4));
  const effectiveBasis = current ? 'projected' : 'ytd';

  const estimate = useDerived((d, t) => estimateTaxes(d, year, t, effectiveBasis), [year, effectiveBasis]);
  const plan = useDerived((d, t) => estimatedPaymentPlan(d, estimateTaxes(d, year, t, 'projected'), t), [year]);
  const limits = useDerived((d) => contributionLimits(d, year), [year]);
  const deductions = useDerived((d) => taxTaggedTransactions(d, year), [year]);
  const documents = useDerived((d) => documentChecklist(d, year), [year]);
  const record = taxRecord(data, year);
  const miles = record.mileage.reduce((s, m) => s + m.miles, 0);
  const received = documents.filter((d) => d.status !== 'expected').length;
  const filed = (y: number) => !!taxRecord(data, y).filedOn;
  const dates = [...taxCalendar(year - 1).map((d) => ({ ...d, y: year - 1 })), ...taxCalendar(year).map((d) => ({ ...d, y: year }))]
    .filter((d) => d.date >= today)
    .filter((d) => !((d.kind === 'filing' || d.kind === 'extension') && filed(d.y)))
    .filter((d) => !(d.kind === 'estimated' && d.y === year && !plan.needsPayments))
    .slice(0, 3);
  const q = `?year=${year}`;

  const tiles = [
    { key: 'estimate', emoji: 'abacus', title: 'Estimate', value: money(estimate.taxableIncome, { whole: true, compact: true }), caption: 'taxable income', href: `/taxes/estimate${q}` },
    { key: 'deductions', emoji: 'bookmark-tabs', title: 'Deductions', value: money(deductions.groups.filter((g) => TAX_TAGS[g.tag].group !== 'payment').reduce((s, g) => s + g.total, 0), { whole: true, compact: true }), caption: deductions.possible.length ? `${deductions.possible.length} to review` : 'tax-tagged', href: `/taxes/deductions${q}` },
    { key: 'documents', emoji: 'card-index-dividers', title: 'Documents', value: `${received}/${documents.length}`, caption: 'forms in hand', href: `/taxes/documents${q}` },
    { key: 'mileage', emoji: 'oncoming-automobile', title: 'Mileage', value: `${Number(miles.toFixed(1)).toLocaleString()} mi`, caption: `${record.mileage.length} ${record.mileage.length === 1 ? 'trip' : 'trips'}`, href: `/taxes/deductions${q}&tab=mileage` },
  ];

  return (
    <Screen header={<NavHeader title="Taxes" right={<YearSwitch year={year} years={years} />} />}>
      {!data.taxProfile.configured && (
        <Banner
          tone="primary"
          icon="user"
          title="Set up your tax profile"
          message="Filing status and dependents make the estimate far more accurate."
          action={<Button label="Set up" size="sm" onPress={() => router.push('/taxes/profile')} />}
        />
      )}

      <Card padding={spacing.xl} style={{ gap: spacing.lg }} onPress={() => router.push(`/taxes/estimate${q}`)} accessibilityLabel="Open the tax estimate">
        <ResultHero estimate={estimate} />
        <View style={styles.chips}>
          {current && <Pill label={`Projected for ${year}`} tone="projected" size="sm" />}
          <Text variant="caption" color={colors.textSecondary}>
            {FILING_STATUS_LABEL[data.taxProfile.filingStatus]} · {estimate.usedItemized ? 'Itemizing' : 'Standard deduction'}
          </Text>
          {!estimate.exactTables && (
            <Text variant="caption" color={colors.warning}>
              Using latest IRS amounts
            </Text>
          )}
        </View>
      </Card>

      <IncomeSplit estimate={estimate} />

      <View style={styles.grid}>
        {tiles.map((t) => (
          <Card key={t.key} style={styles.tile} padding={spacing.lg} onPress={() => router.push(t.href as never)} accessibilityLabel={`${t.title}: ${t.value} ${t.caption}`}>
            <View style={styles.tileTop}>
              <EmojiIcon name={t.emoji} size={30} />
              <Feather name="arrow-up-right" size={16} color={colors.textTertiary} />
            </View>
            <Text variant="h3" tabular numberOfLines={1}>
              {t.value}
            </Text>
            <Text variant="small" weight="medium">
              {t.title}
            </Text>
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {t.caption}
            </Text>
          </Card>
        ))}
      </View>

      {(plan.needsPayments || plan.paid > 0) && (
        <Section title="Quarterly estimated payments" accessory={<Text variant="caption" color={colors.textTertiary}>{money(plan.paid, { whole: true })} paid</Text>}>
          <Card>
            <QuarterStrip quarters={plan.quarters} today={today} />
          </Card>
        </Section>
      )}

      {limits.some((l) => l.applicable) && (
        <Section title="Tax-advantaged room">
          <LimitBars limits={limits} />
        </Section>
      )}

      {dates.length > 0 && (
        <Section title="Key dates">
          <Card style={{ gap: spacing.md }}>
            {dates.map((d) => (
              <View key={`${d.date}-${d.label}`} style={styles.dateRow}>
                <EmojiIcon name={d.kind === 'estimated' ? 'money-with-wings' : d.kind === 'documents' ? 'file-folder' : 'spiral-calendar'} size={24} />
                <Text variant="small" style={{ flex: 1 }}>
                  {d.label}
                </Text>
                <Text variant="small" color={colors.textSecondary}>
                  {formatDate(d.date, 'medium', today)}
                </Text>
              </View>
            ))}
          </Card>
        </Section>
      )}

      {!current && (
        <Button
          label={record.filedOn ? `Filed ${formatDate(record.filedOn, 'medium', today)} · Undo` : `Mark ${year} as filed`}
          icon={record.filedOn ? 'check-circle' : 'send'}
          variant="secondary"
          fullWidth
          onPress={() => ledger.setTaxYearFiled(year, record.filedOn ? undefined : today)}
        />
      )}
      <Button label="Tax profile" icon="user" variant="secondary" fullWidth onPress={() => router.push('/taxes/profile')} />
      <Text variant="caption" color={colors.textTertiary} align="center">
        A US federal planning estimate from your records. Not tax advice or a filed return.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: spacing.sm },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: { width: '48%', flexGrow: 1, gap: 2 },
  tileTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  dateRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
});
