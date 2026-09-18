import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { MonthSwitcher } from '@/components/finance/Pickers';
import { Delta, MoneyDelta, shareOf } from '@/components/reports/shared';
import { Card, EmptyState, HBarList, KeyValue, ListCard, Money, NavHeader, Pill, Row, Screen, Section, SplitBar, Text } from '@/components/ui';
import { isDebt, isInvestment } from '@/domain/catalog';
import { addMonthsToMonth, formatMonth, monthOf } from '@/domain/dates';
import { monthlyReview } from '@/domain/reports';
import type { Cents } from '@/domain/types';
import { useData, useMoney, usePercent, useToday } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export default function MonthlyReviewScreen() {
  const params = useLocalSearchParams<{ month?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const percent = usePercent();
  const current = monthOf(today);
  const [month, setMonth] = useState(() => (params.month && MONTH_RE.test(params.month) && params.month <= current ? params.month : current));
  const r = useMemo(() => monthlyReview(data, month, today), [data, month, today]);

  const s = r.stats;
  const p = r.previous;
  const prevName = formatMonth(addMonthsToMonth(month, -1), 'short');
  const against = r.isPartial ? `all of ${prevName}` : prevName;
  const whole = (abs: number) => money(abs, { whole: true });
  const compare = r.previousHasData;
  const hint = (now: Cents, before: Cents) => (!compare || (now === 0 && before === 0) ? undefined : now === before ? `Same as ${against}` : `${now > before ? '▲ +' : '▼ −'}${whole(Math.abs(now - before))} vs ${against}`);

  const hasDebt = data.accounts.some((a) => isDebt(a.type)) || r.debt.start !== 0 || r.debt.end !== 0;
  const hasInvestments = data.accounts.some((a) => isInvestment(a.type)) || r.investments.start !== 0 || r.investments.end !== 0;
  const openedThisMonth = data.accounts.some((a) => monthOf(a.startingDate) === month);
  const marketChange = r.investments.end - r.investments.start - r.investments.contributions + r.investments.withdrawals;

  const prevByCategory = new Map(p.byCategory.map((c) => [c.key, c.amount]));
  const categoryItems = [
    ...s.byCategory.map((c) => ({ key: c.key, label: c.label, color: c.color, amount: c.amount })),
    ...(compare ? p.byCategory : []).filter((c) => !s.byCategory.some((x) => x.key === c.key)).map((c) => ({ key: c.key, label: c.label, color: c.color, amount: 0 })),
  ];

  const summary = () => {
    const name = formatMonth(month);
    const lead = r.isPartial ? `So far in ${name}` : `In ${name}`;
    let first: string;
    if (s.income > 0 && s.saved >= 0) first = `${lead} you earned ${whole(s.income)}, spent ${whole(s.spending)} and saved ${percent(s.savingsRate)} of your income.`;
    else if (s.income > 0) first = `${lead} you earned ${whole(s.income)} and spent ${whole(s.spending)}, ${whole(-s.saved)} more than you brought in.`;
    else first = `${lead} you spent ${whole(s.spending)} with no income recorded.`;
    const nw = r.netWorth.change;
    const second = nw === 0 ? 'Net worth held steady.' : `Net worth ${nw > 0 ? 'rose' : 'fell'} ${whole(Math.abs(nw))}.`;
    return `${first} ${second}`;
  };

  return (
    <Screen header={<NavHeader title="Monthly review" />}>
      <View style={{ gap: spacing.sm }}>
        <MonthSwitcher month={month} onChange={setMonth} max={current} />
        {r.isPartial && (
          <Row style={{ justifyContent: 'center' }}>
            <Pill size="sm" tone="muted" icon="clock" label="Month to date" />
          </Row>
        )}
      </View>

      {s.transactionCount === 0 ? (
        <EmptyState
          icon="book-open"
          title={`Nothing recorded in ${formatMonth(month)}`}
          message="Once this month has income, spending or transfers, its review appears here."
          actionLabel="Add a transaction"
          onAction={() => router.push('/transactions/edit')}
        />
      ) : (
        <>
          <Card variant="muted" style={{ gap: spacing.sm }} padding={spacing.xl}>
            <Text variant="small" weight="medium" color={colors.textSecondary}>
              Summary
            </Text>
            <Text variant="h3" weight="medium">
              {summary()}
            </Text>
          </Card>

          <Section title="Income">
            <ListCard>
              <KeyValue label="Total income" hint={hint(s.income, p.income)}>
                <Money cents={s.income} weight="semibold" tone="flow" />
              </KeyValue>
            </ListCard>
            {s.incomeBySource.length > 0 && (
              <Card style={{ gap: spacing.md }}>
                <Text variant="h3">By source</Text>
                <HBarList
                  items={s.incomeBySource.map((x, i) => ({
                    key: x.key,
                    label: x.label,
                    value: x.amount,
                    valueLabel: money(x.amount),
                    color: series[i % series.length],
                    caption: `${percent(shareOf(x.amount, s.income))} of income`,
                  }))}
                />
              </Card>
            )}
          </Section>

          <Section title="Expenses">
            <ListCard>
              <KeyValue label="Total spending" hint={hint(s.spending, p.spending)}>
                <Money cents={s.spending} weight="semibold" />
              </KeyValue>
              <KeyValue label="Essential" hint={hint(s.essential, p.essential)}>
                <Money cents={s.essential} weight="medium" />
              </KeyValue>
              <KeyValue label="Discretionary" hint={hint(s.discretionary, p.discretionary)}>
                <Money cents={s.discretionary} weight="medium" />
              </KeyValue>
            </ListCard>
            {s.spending > 0 && (
              <View style={{ gap: spacing.sm }}>
                <SplitBar
                  segments={[
                    { key: 'essential', value: s.essential, color: series[0] },
                    { key: 'discretionary', value: s.discretionary, color: series[1] },
                  ]}
                />
                <Row gap={spacing.lg}>
                  <LegendDot color={series[0]} label={`Essential ${percent(shareOf(s.essential, s.spending))}`} />
                  <LegendDot color={series[1]} label={`Discretionary ${percent(shareOf(s.discretionary, s.spending))}`} />
                </Row>
              </View>
            )}
            {categoryItems.length > 0 && (
              <Card style={{ gap: spacing.md }}>
                <View>
                  <Text variant="h3">By category</Text>
                  <Text variant="caption" color={colors.textTertiary}>
                    {compare ? `Tick marks show ${against}.` : `Nothing was tracked in ${prevName} to compare with.`}
                  </Text>
                </View>
                <HBarList
                  items={categoryItems.map((c) => {
                    const before = prevByCategory.get(c.key) ?? 0;
                    return {
                      key: c.key,
                      label: c.label,
                      value: c.amount,
                      valueLabel: money(c.amount),
                      color: c.color ?? series[0],
                      compare: compare ? before : undefined,
                      caption: compare ? `${prevName}: ${whole(before)}` : undefined,
                    };
                  })}
                />
              </Card>
            )}
          </Section>

          <Section title="Savings">
            <ListCard>
              <KeyValue label="Saved (income − spending)" hint={hint(s.saved, p.saved)}>
                <Money cents={s.saved} weight="semibold" signed tone="balance" />
              </KeyValue>
              <KeyValue
                label="Savings rate"
                hint={compare && s.income > 0 && p.income > 0 ? ratePhrase(Math.round((s.savingsRate - p.savingsRate) * 100), against) : undefined}
                value={s.income > 0 ? percent(s.savingsRate) : '—'}
              />
              <KeyValue label="Moved to savings accounts" hint={hint(s.toSavings, p.toSavings)}>
                <Money cents={s.toSavings} weight="medium" />
              </KeyValue>
              <KeyValue label="Invested" hint={hint(s.investmentContributions, p.investmentContributions)}>
                <Money cents={s.investmentContributions} weight="medium" />
              </KeyValue>
            </ListCard>
          </Section>

          <Section title="Debt">
            {hasDebt ? (
              <ListCard>
                <KeyValue label="Starting debt" hint={openedThisMonth ? 'Includes opening balances of accounts added this month' : undefined}>
                  <Money cents={r.debt.start} weight="medium" />
                </KeyValue>
                <KeyValue label="New charges" hint="Purchases on cards and loans, less refunds">
                  <Money cents={r.debt.newCharges} weight="medium" />
                </KeyValue>
                <KeyValue label="Interest & fees">
                  <Money cents={r.debt.interest} weight="medium" />
                </KeyValue>
                <KeyValue label="Payments" hint={hint(r.debt.payments, p.debtPayments)}>
                  <Money cents={r.debt.payments} weight="medium" />
                </KeyValue>
                <KeyValue label={r.isPartial ? 'Debt today' : 'Ending debt'}>
                  <Money cents={r.debt.end} weight="semibold" />
                </KeyValue>
                <KeyValue label="Change">
                  <MoneyDelta cents={r.debt.end - r.debt.start} good="down" whole={false} />
                </KeyValue>
              </ListCard>
            ) : (
              <Muted text="No debts tracked." />
            )}
          </Section>

          <Section title="Investments">
            {hasInvestments ? (
              <ListCard>
                <KeyValue label="Starting value" hint={openedThisMonth ? 'Includes opening balances of accounts added this month' : undefined}>
                  <Money cents={r.investments.start} weight="medium" />
                </KeyValue>
                <KeyValue label="Contributions">
                  <Money cents={r.investments.contributions} weight="medium" />
                </KeyValue>
                <KeyValue label="Withdrawals">
                  <Money cents={r.investments.withdrawals} weight="medium" />
                </KeyValue>
                <KeyValue label="Market & other change" hint="Value change not explained by money in or out">
                  <MoneyDelta cents={marketChange} good="up" whole={false} />
                </KeyValue>
                <KeyValue label={r.isPartial ? 'Value today' : 'Ending value'}>
                  <Money cents={r.investments.end} weight="semibold" />
                </KeyValue>
              </ListCard>
            ) : (
              <Muted text="No investment accounts tracked." />
            )}
          </Section>

          <Section title="Net worth">
            <ListCard>
              <KeyValue label="Beginning of month" hint={openedThisMonth ? 'Opening balances count as the starting point, not as change' : undefined}>
                <Money cents={r.netWorth.start} weight="medium" tone="balance" />
              </KeyValue>
              <KeyValue label={r.isPartial ? 'Today' : 'End of month'}>
                <Money cents={r.netWorth.end} weight="semibold" tone="balance" />
              </KeyValue>
              <KeyValue label="Change">
                <Delta value={r.netWorth.change} good="up" format={(abs) => money(abs)} />
              </KeyValue>
            </ListCard>
          </Section>
        </>
      )}
    </Screen>
  );
}

function ratePhrase(points: number, against: string) {
  if (points === 0) return `Same as ${against}`;
  return `${points > 0 ? '▲ +' : '▼ −'}${Math.abs(points)} pts vs ${against}`;
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={6}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text variant="caption" color={colors.textSecondary}>
        {label}
      </Text>
    </Row>
  );
}

function Muted({ text }: { text: string }) {
  return (
    <Card variant="muted">
      <Text color={colors.textSecondary}>{text}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  dot: { width: 8, height: 8, borderRadius: 4 },
});
