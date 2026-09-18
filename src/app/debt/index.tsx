import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { EventRow, TransactionRow } from '@/components/finance/Rows';
import { Card, EmptyState, IconButton, LineChart, ListCard, Money, NavHeader, Pill, ProgressBar, Row, Screen, Section, StatTile, Text } from '@/components/ui';
import { isCreditCard } from '@/domain/catalog';
import { addDays, formatDate, formatMonth, lastMonths, monthOf } from '@/domain/dates';
import { debtHistory, debtSummary, type DebtLine } from '@/domain/debt';
import { creditInfo, indexLedger } from '@/domain/ledger';
import { ledgerStartDate, monthEndDates, overallUtilization } from '@/domain/position';
import { nextDebtDue, openEvents, type ScheduledEvent } from '@/domain/schedule';
import type { ISODate } from '@/domain/types';
import { useDerived, useMoney, useToday } from '@/store/hooks';
import { colors, radius, series as seriesColors, spacing } from '@/theme/tokens';

function utilizationTone(u: number) {
  if (u >= 0.7) return { color: colors.negative, label: 'High' };
  if (u >= 0.3) return { color: colors.warning, label: 'Above 30%' };
  return { color: colors.positive, label: 'Under 30%' };
}

function Fact({ label, value, children }: { label: string; value?: string; children?: ReactNode }) {
  return (
    <View style={styles.fact}>
      <Text variant="caption" color={colors.textTertiary}>
        {label}
      </Text>
      {children ?? (
        <Text variant="small" weight="medium" tabular>
          {value}
        </Text>
      )}
    </View>
  );
}

const aprLabel = (apr: number) => `${Number(apr.toFixed(2))}% APR`;

export default function DebtScreen() {
  const router = useRouter();
  const money = useMoney();
  const today = useToday();

  const model = useDerived((data, day) => {
    const s = debtSummary(data, day);
    // Only months since tracking began; earlier months have no data.
    const start = ledgerStartDate(data);
    const months = lastMonths(monthOf(day), 12).filter((m) => !start || m >= monthOf(start));
    const history = debtHistory(data, monthEndDates(months, day));
    const upcoming = openEvents(data, day, addDays(day, 45), 30).filter((e) => e.kind === 'debt_payment');
    const recent = indexLedger(data).sorted.filter((t) => t.type === 'debt_payment' && t.date <= day).slice(0, 10);
    const nextDue = new Map(s.lines.map((l) => [l.account.id, nextDebtDue(data, l.account.id, day)]));
    return { s, months, history, upcoming, recent, nextDue, overall: overallUtilization(data, day) };
  });
  const { s, months, history, upcoming, recent, nextDue, overall } = model;

  const addDebt = () => router.push({ pathname: '/accounts/edit', params: { type: 'credit_card' } });
  const header = <NavHeader title="Debt" right={<IconButton icon="plus" accessibilityLabel="Add a credit card or loan" onPress={addDebt} />} />;

  if (s.lines.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="credit-card"
          title="No debts tracked"
          message="Add a credit card or loan to track payoff progress"
          actionLabel="Add a credit card"
          onAction={addDebt}
          secondaryLabel="Add a loan"
          onSecondary={() => router.push({ pathname: '/accounts/edit', params: { type: 'auto_loan' } })}
        />
      </Screen>
    );
  }

  const cards = s.lines.filter((l) => isCreditCard(l.account.type));
  const loans = s.lines.filter((l) => !isCreditCard(l.account.type));
  const hasBalance = s.lines.some((l) => l.balance > 0);
  const down = s.monthChange < 0;
  const flat = s.monthChange === 0;

  const payDebt = (e: ScheduledEvent) => {
    const toAccountId = e.toAccountId ?? (e.source === 'debt' ? e.sourceId : undefined);
    router.push({ pathname: '/quick-add', params: toAccountId ? { mode: 'debt', toAccountId } : { mode: 'debt' } });
  };
  const openEvent = (e: ScheduledEvent) => {
    if (e.source === 'recurring') router.push(`/bills/${e.sourceId}`);
    else if (e.source === 'debt') router.push(`/accounts/${e.sourceId}`);
    else if (e.source === 'transaction') router.push(`/transactions/${e.sourceId}`);
  };

  return (
    <Screen header={header}>
      <Card variant="muted" padding={spacing.xl} style={{ gap: spacing.sm }}>
        <Text variant="small" weight="medium" color={colors.textSecondary}>
          Total debt
        </Text>
        <Money cents={s.total} variant="display" />
        <Row gap={6}>
          <Feather name={flat ? 'minus' : down ? 'arrow-down-right' : 'arrow-up-right'} size={16} color={flat ? colors.textSecondary : down ? colors.positive : colors.negative} />
          <Text variant="small" weight="medium" color={flat ? colors.textSecondary : down ? colors.positive : colors.negative}>
            {flat ? 'No change this month' : `${down ? 'Down' : 'Up'} ${money(Math.abs(s.monthChange))} this month`}
          </Text>
        </Row>
      </Card>

      <View style={{ gap: spacing.sm }}>
        <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
          <StatTile label="Principal paid" icon="check-circle" value={<Money cents={s.principalPaidYtd} variant="h3" compact />} caption="This year" />
          <StatTile label="Interest paid" icon="percent" value={<Money cents={s.interestYtd} variant="h3" compact />} caption="This year" />
        </Row>
        <Row gap={spacing.sm} style={{ alignItems: 'stretch' }}>
          <StatTile label="Interest per month now" icon="trending-up" value={<Money cents={s.monthlyInterest} variant="h3" compact />} caption="Estimate at current balances and APRs" />
          <StatTile label="Payments" icon="calendar" value={<Money cents={s.paymentsThisMonth} variant="h3" compact />} caption="This month" />
        </Row>
      </View>

      <Section title="Is my debt going down?" subtitle="Total owed at the end of each month">
        <Card>
          <LineChart
            series={[{ key: 'debt', label: 'Total debt', color: seriesColors[0], area: true, points: history.map((h, i) => ({ x: i, y: h.total })) }]}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatX={(i) => formatMonth(months[i] ?? months[0], 'short')}
            xTicks={[...new Set([0, Math.floor((months.length - 1) / 2), months.length - 1])]}
            includeZero
            accessibilityLabel={`Total debt over the last 12 months, now ${money(s.total)}`}
          />
        </Card>
      </Section>

      {cards.length > 0 && (
        <Section title="Credit cards">
          {overall.limit > 0 && (
            <Card style={{ gap: spacing.sm }}>
              <Row>
                <Text weight="medium" style={{ flex: 1 }}>
                  Overall utilization
                </Text>
                <Text weight="semibold" tabular>
                  {`${Math.round(overall.utilization * 100)}% · ${utilizationTone(overall.utilization).label}`}
                </Text>
              </Row>
              <ProgressBar value={overall.utilization} marker={0.3} color={utilizationTone(overall.utilization).color} accessibilityLabel={`${Math.round(overall.utilization * 100)}% of total credit limits used`} />
              <Text variant="caption" color={colors.textTertiary}>
                {`${money(overall.balance, { whole: true })} of ${money(overall.limit, { whole: true })} · Keeping under 30% is commonly recommended`}
              </Text>
            </Card>
          )}
          {cards.map((l) => (
            <CreditCardRow key={l.account.id} line={l} today={today} nextDue={nextDue.get(l.account.id)} onPress={() => router.push(`/accounts/${l.account.id}`)} />
          ))}
        </Section>
      )}

      {loans.length > 0 && (
        <Section title="Loans">
          {loans.map((l) => (
            <LoanRow key={l.account.id} line={l} today={today} nextDue={nextDue.get(l.account.id)} onPress={() => router.push(`/accounts/${l.account.id}`)} />
          ))}
        </Section>
      )}

      <Section title="Upcoming payments" subtitle="Expected in the next 45 days">
        {upcoming.length === 0 ? (
          <EmptyState compact icon="calendar" title="No debt payments due soon" message="Set a due day on a card or loan to see payments here." actionLabel="Record a payment" onAction={() => router.push({ pathname: '/quick-add', params: { mode: 'debt' } })} />
        ) : (
          <ListCard>
            {upcoming.map((e) => (
              <EventRow key={e.key} event={e} onPress={() => openEvent(e)} onAction={e.source === 'transaction' ? undefined : () => payDebt(e)} actionLabel="Pay" />
            ))}
          </ListCard>
        )}
      </Section>

      {hasBalance && (
        <Card onPress={() => router.push('/debt/payoff')} accessibilityLabel="Model payoff scenarios" style={styles.cta}>
          <View style={styles.ctaIcon}>
            <Feather name="sliders" size={18} color={colors.projected} />
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text weight="semibold">Model payoff scenarios</Text>
            <Text variant="small" color={colors.textSecondary}>
              Compare different ways of paying down your debts.
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </Card>
      )}

      <Section title="Recent payments">
        {recent.length === 0 ? (
          <EmptyState compact icon="check-circle" title="No debt payments recorded" actionLabel="Record a payment" onAction={() => router.push({ pathname: '/quick-add', params: { mode: 'debt' } })} />
        ) : (
          <ListCard>
            {recent.map((t) => (
              <TransactionRow key={t.id} tx={t} showDate />
            ))}
          </ListCard>
        )}
      </Section>
    </Screen>
  );
}

const dueLabel = (e: ScheduledEvent | undefined, today: ISODate) => (e ? `${formatDate(e.date, 'short', today)}${e.status === 'overdue' ? ' · overdue' : ''}` : '—');

function CreditCardRow({ line, today, nextDue, onPress }: { line: DebtLine; today: ISODate; nextDue?: ScheduledEvent; onPress: () => void }) {
  const money = useMoney();
  const a = line.account;
  const credit = creditInfo(a, line.balance);
  const promoActive = a.promoApr !== undefined && !!a.promoExpires && today <= a.promoExpires;
  const tone = credit ? utilizationTone(credit.utilization) : null;
  return (
    <Card onPress={onPress} accessibilityLabel={`${a.name}, ${money(line.balance)} owed`} style={{ gap: spacing.md }}>
      <Row>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" numberOfLines={1}>
            {a.name}
          </Text>
          {!!a.institution && (
            <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
              {a.institution}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Money cents={line.balance} weight="semibold" tone="balance" />
          <Text variant="caption" color={colors.textTertiary}>
            {line.balance > 0 ? 'owed' : line.balance < 0 ? 'credit' : 'paid off'}
          </Text>
        </View>
      </Row>
      {credit && tone && (
        <View style={{ gap: 4 }}>
          <ProgressBar value={credit.utilization} height={6} color={tone.color} accessibilityLabel={`${Math.round(credit.utilization * 100)}% of limit used`} />
          <Text variant="caption" color={colors.textSecondary} tabular>
            {`${Math.round(credit.utilization * 100)}% of ${money(credit.limit, { whole: true })} limit used`}
          </Text>
        </View>
      )}
      <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
        {a.apr !== undefined && <Pill size="sm" tone="muted" label={aprLabel(a.apr)} />}
        {promoActive && <Pill size="sm" tone="primary" icon="clock" label={`${Number(a.promoApr!.toFixed(2))}% until ${formatDate(a.promoExpires!, 'short', today)}`} />}
      </Row>
      <View style={styles.facts}>
        <Fact label="Statement balance" value={a.statementBalance !== undefined ? money(a.statementBalance) : '—'} />
        <Fact label="Minimum payment" value={a.minimumPayment !== undefined ? money(a.minimumPayment) : '—'} />
        <Fact label="Next due" value={dueLabel(nextDue, today)} />
        <Fact label="Available credit" value={credit ? money(credit.available) : '—'} />
      </View>
    </Card>
  );
}

function LoanRow({ line, today, nextDue, onPress }: { line: DebtLine; today: ISODate; nextDue?: ScheduledEvent; onPress: () => void }) {
  const money = useMoney();
  const a = line.account;
  const monthly = line.plannedPayment || a.paymentAmount || a.minimumPayment;
  return (
    <Card onPress={onPress} accessibilityLabel={`${a.name}, ${money(line.balance)} owed`} style={{ gap: spacing.md }}>
      <Row>
        <View style={{ flex: 1, gap: 2 }}>
          <Text weight="semibold" numberOfLines={1}>
            {a.name}
          </Text>
          {!!a.institution && (
            <Text variant="small" color={colors.textTertiary} numberOfLines={1}>
              {a.institution}
            </Text>
          )}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Money cents={line.balance} weight="semibold" tone="balance" />
          <Text variant="caption" color={colors.textTertiary}>
            {line.balance > 0 ? 'owed' : 'paid off'}
          </Text>
        </View>
      </Row>
      {line.paidOffRatio !== null && a.originalBalance ? (
        <View style={{ gap: 4 }}>
          <ProgressBar value={line.paidOffRatio} height={6} color={colors.positive} accessibilityLabel={`${Math.round(line.paidOffRatio * 100)}% paid off`} />
          <Text variant="caption" color={colors.textSecondary} tabular>
            {`${Math.round(line.paidOffRatio * 100)}% paid off of ${money(a.originalBalance, { whole: true })}`}
          </Text>
        </View>
      ) : null}
      <View style={styles.facts}>
        <Fact label="APR" value={line.apr || a.apr !== undefined ? `${Number(line.apr.toFixed(2))}%` : '—'} />
        <Fact label="Monthly payment" value={monthly ? money(monthly) : '—'} />
        <Fact label="Next due" value={dueLabel(nextDue, today)} />
        <Fact label="Interest per month" value={`${money(line.monthlyInterest)} est.`} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  facts: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  fact: { width: '50%', gap: 2, paddingRight: spacing.sm },
  cta: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  ctaIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.projectedSoft, alignItems: 'center', justifyContent: 'center' },
});
