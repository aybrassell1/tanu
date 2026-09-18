import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AssumptionFields } from '@/components/retirement/Assumptions';
import { FiProgress, PathHero, ProjectionChart, ReturnBand } from '@/components/retirement/Projection';
import { Banner, Card, EmptyState, KeyValue, ListCard, ListRow, Money, NavHeader, Pill, Row, Screen, Section, StatusBadge, Text } from '@/components/ui';
import { icon } from '@/data/icons';
import { ACCOUNT_TYPES } from '@/domain/catalog';
import { defaultAssumptions, retirementOutlook, type RetirementAssumptions } from '@/domain/retirement';
import { useData, useMoney, usePercent, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

const DISCLAIMER = 'These are projections from the assumptions above — not advice, and not a prediction. Real returns vary every year.';

export default function RetirementScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const percent = usePercent();

  // The screen is a calculator: assumptions live in local state and are never saved.
  const measuredDefaults = useMemo(() => defaultAssumptions(data, today), [data, today]);
  const [assumptions, setAssumptions] = useState<RetirementAssumptions>(measuredDefaults);
  const patch = (next: Partial<RetirementAssumptions>) => setAssumptions((a) => ({ ...a, ...next }));
  const reset = () => setAssumptions(measuredDefaults);
  // Any assumption, not just the three that come from the ledger.
  const untouched = (Object.keys(measuredDefaults) as (keyof RetirementAssumptions)[]).every((key) => assumptions[key] === measuredDefaults[key]);

  const outlook = useMemo(() => retirementOutlook(data, today, assumptions), [data, today, assumptions]);
  const { projection, fi, balance, contributions, spending } = outlook;

  const measuredParts = [
    contributions.fromTransfers ? `${money(contributions.fromTransfers)} transferred in` : null,
    contributions.fromPaycheck ? `${money(contributions.fromPaycheck)} withheld for retirement` : null,
    contributions.fromHsa ? `${money(contributions.fromHsa)} withheld for the HSA` : null,
  ].filter(Boolean);
  const contributionHint = measuredParts.length
    ? `Measured over 12 months: ${measuredParts.join(', ')} — ${money(contributions.monthly)}/mo.`
    : 'Measured from the last 12 months of money going into the accounts below.';
  const spendingHint = spending.annualized
    ? `Scaled up from ${spending.daysCovered} days of history.`
    : 'Your spending over the last 12 months.';

  const fiCaption = (years: number | null, year: number | null) =>
    years === null ? 'Not on this path' : years === 0 ? 'Already there' : `${years} yr${years === 1 ? '' : 's'} · ${year}`;

  if (outlook.isEmpty) {
    return (
      <Screen header={<NavHeader title="Retirement" />}>
        <EmptyState
          icon="trending-up"
          title="No retirement accounts yet"
          message="Add a 401(k), IRA, HSA or brokerage account and this projects where it lands, using your own contributions and spending."
          actionLabel="Add an account"
          onAction={() => router.push('/accounts/edit')}
          secondaryLabel="See investments"
          onSecondary={() => router.push('/investments')}
        />
        <Text variant="caption" color={colors.textTertiary}>
          {DISCLAIMER}
        </Text>
      </Screen>
    );
  }

  return (
    <Screen header={<NavHeader title="Retirement" right={<Pill label="Projection" tone="projected" size="sm" />} />}>
      <PathHero projection={projection} />

      <Section title="The path" subtitle={`From ${money(balance.total, { compact: true, whole: true })} today, adding ${money(assumptions.monthlyContribution)} a month`}>
        <ProjectionChart projection={projection} />
        <ReturnBand projection={projection} />
      </Section>

      <AssumptionFields
        value={assumptions}
        onChange={patch}
        onReset={reset}
        measured={untouched}
        contributionHint={contributionHint}
        spendingHint={spendingHint}
      />

      <Section title="What you have today" subtitle="Actual balances, not projected">
        {balance.accounts.length === 0 ? (
          <Card variant="muted">
            <Text color={colors.textSecondary}>No investment or retirement accounts yet — the projection starts from zero.</Text>
          </Card>
        ) : (
          <ListCard>
            {balance.accounts.map(({ account, balance: value }) => (
              <ListRow
                key={account.id}
                icon={icon(account.icon || ACCOUNT_TYPES[account.type].icon)}
                iconColor={account.color}
                title={account.name}
                subtitle={[account.institution, ACCOUNT_TYPES[account.type].label].filter(Boolean).join(' · ')}
                trailing={<Money cents={value} weight="semibold" />}
                onPress={() => router.push(`/accounts/${account.id}`)}
                chevron
              />
            ))}
          </ListCard>
        )}
        {balance.accounts.length > 0 && (
          <Text variant="caption" color={colors.textTertiary}>
            {`Counted: ${balance.accounts.map(({ account }) => account.name).join(', ')}. "Invested each month" is the money going into these same accounts, including pre-tax 401(k) and HSA payroll deductions.`}
          </Text>
        )}
        {contributions.employerMatch > 0 && (
          <Banner
            tone="muted"
            icon="gift"
            title={`Employer match adds about ${money(contributions.employerMatch)} a year`}
            message="It isn't recorded as a transaction, so it is not included in the projection above."
          />
        )}
      </Section>

      <Section title="Financial independence" subtitle={`${fi.multiple}× your yearly spending, in today's dollars`}>
        <FiProgress fi={fi} />
        <Text variant="caption" color={colors.textTertiary}>
          {`This countdown adds the same ${money(fi.monthlyContribution)} a month as the projection above — change "Invested each month" and both move.`}
        </Text>
        <ListCard>
          <KeyValue label="Yearly spending used" hint={spending.annualized ? 'Scaled up from a short history' : 'Last 12 months'}>
            <Money cents={fi.annualSpending} weight="medium" whole />
          </KeyValue>
          <KeyValue label={`Target (${fi.multiple}×)`}>
            <Money cents={fi.target} weight="semibold" whole />
          </KeyValue>
          <KeyValue label="Invested so far">
            <Money cents={fi.current} weight="medium" whole />
          </KeyValue>
          <KeyValue label="Invested each year" hint="The assumption above, twelve times over">
            <Money cents={fi.annualSavings} weight="medium" whole />
          </KeyValue>
          <KeyValue
            label="Share of income invested"
            hint={fi.hasIncome ? `${money(fi.annualSavings, { whole: true })} invested out of ${money(fi.annualIncome, { whole: true })} of income` : 'No income recorded in the last 12 months'}
            value={fi.hasIncome ? percent(fi.savingsRate) : '—'}
          />
          <KeyValue label="Real return used" hint="Return after inflation, compounded" value={`${(fi.realReturn * 100).toFixed(1)}%`} />
          <KeyValue label="At this pace">
            {fi.years === null ? (
              <StatusBadge tone="warning" label="Not on this path" />
            ) : (
              <Text weight="semibold">{fi.years === 0 ? 'Already there' : `${fi.years} yrs · ${fi.year}`}</Text>
            )}
          </KeyValue>
        </ListCard>

        {fi.hasIncome && (
          <Card style={{ gap: spacing.md }}>
            <Row>
              <Text variant="h3" style={{ flex: 1 }} accessibilityRole="header">
                What moving the savings rate does
              </Text>
              <Pill label="Hypothetical" tone="projected" size="sm" />
            </Row>
            <View style={{ gap: spacing.sm }}>
              {fi.scenarios.map((s) => (
                <Row key={s.label} style={{ gap: spacing.md }}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text weight="medium">{s.label}</Text>
                    <Text variant="caption" color={colors.textTertiary}>
                      {`${percent(s.savingsRate)} saved · ${money(s.annualSavings, { whole: true })} a year`}
                    </Text>
                  </View>
                  <Text weight="semibold" tabular align="right">
                    {fiCaption(s.years, s.year)}
                  </Text>
                </Row>
              ))}
            </View>
          </Card>
        )}
      </Section>

      <Text variant="caption" color={colors.textTertiary}>
        {DISCLAIMER}
      </Text>
    </Screen>
  );
}
