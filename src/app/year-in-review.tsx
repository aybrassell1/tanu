import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BigNumberCard, FactsCard, HeadlineCard, MerchantList, PurchaseNote, RankedCard, YearSwitcher } from '@/components/review/YearCards';
import { Banner, Button, Card, ColumnChart, EmptyState, IconButton, KeyValue, ListCard, Money, NavHeader, Pill, Row, Screen, Section, Text, useOverlay } from '@/components/ui';
import { formatDate, formatMonth } from '@/domain/dates';
import { leanMonthLabel, yearReview, yearReviewText, yearsWithData } from '@/domain/yearReview';
import { exportTextFile } from '@/store/fileIO';
import { useData, useMoney, usePercent, useSettings, useToday } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

export default function YearInReviewScreen() {
  const params = useLocalSearchParams<{ year?: string }>();
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();
  const percent = usePercent();
  const settings = useSettings();
  const { toast } = useOverlay();

  const years = useMemo(() => yearsWithData(data), [data]);
  const thisYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(() => {
    const asked = Number(params.year);
    if (Number.isInteger(asked) && years.includes(asked)) return asked;
    return years.includes(thisYear) ? thisYear : (years[0] ?? thisYear);
  });

  const review = useMemo(() => yearReview(data, year, today), [data, year, today]);
  const s = review.stats;
  const previous = review.previous;

  const share = async () => {
    try {
      await exportTextFile(`${review.year}-in-review.txt`, yearReviewText(review, settings.currency), 'text/plain');
    } catch (error) {
      toast({ message: error instanceof Error ? error.message : 'Could not export the summary.', tone: 'error' });
    }
  };

  const columns = review.months.map((m) => ({ key: m.month, label: m.label.charAt(0), values: [m.income, m.spending] }));
  // Only compare with a previous year that covers a span of the same length
  // and was tracked for most of it; anything else reads as a real change when
  // it is only a difference in how long the ledger existed.
  const against = review.isPartial ? `vs the same span of ${review.previousYear}` : `vs ${review.previousYear}`;
  const versus = (now: number, before: number) => {
    if (!review.comparable || !previous) return undefined;
    if (now === before) return `Same as ${review.previousYear}`;
    return `${now > before ? '▲ +' : '▼ −'}${money(Math.abs(now - before), { whole: true })} ${against}`;
  };

  if (years.length === 0 || !review.hasData) {
    return (
      <Screen header={<NavHeader title="Year in review" />}>
        {years.length > 1 && <YearSwitcher years={years} value={year} onChange={setYear} />}
        <EmptyState
          icon="award"
          title={`Nothing recorded in ${year}`}
          message="Once a year has income and spending in it, this page sums it up: where the money went, your best month and a few true facts."
          actionLabel="Add a transaction"
          onAction={() => router.push('/transactions/edit')}
        />
      </Screen>
    );
  }

  return (
    <Screen header={<NavHeader title="Year in review" right={<IconButton icon="share" accessibilityLabel="Export summary" onPress={share} />} />}>
      {years.length > 1 && <YearSwitcher years={years} value={year} onChange={setYear} />}
      {(review.isPartial || !review.fullyTracked) && (
        <Row gap={spacing.sm} style={{ justifyContent: 'center', flexWrap: 'wrap' }}>
          {review.isPartial && <Pill size="sm" tone="muted" icon="clock" label="Year to date" />}
          {!review.fullyTracked && <Pill size="sm" tone="muted" icon="calendar" label={`Tracked from ${formatDate(review.trackedFrom, 'medium')}`} />}
        </Row>
      )}

      <HeadlineCard review={review} />

      <Section title="The year in numbers">
        <View style={styles.tiles}>
          <BigNumberCard label="Money in" value={<Money cents={s.income} variant="h2" compact whole tone="flow" />} caption={versus(s.income, previous?.income ?? 0)} />
          <BigNumberCard label="Money out" value={<Money cents={s.spending} variant="h2" compact whole />} caption={versus(s.spending, previous?.spending ?? 0)} />
        </View>
        <View style={styles.tiles}>
          <BigNumberCard label="Savings rate" value={s.income > 0 ? percent(s.savingsRate) : '—'} caption={`${money(s.saved, { whole: true })} kept`} />
          <BigNumberCard label="Transactions" value={String(review.transactionCount)} caption={review.merchantCount ? `across ${review.merchantCount} merchants` : 'this year'} />
        </View>
        <View style={styles.tiles}>
          <BigNumberCard
            label="Net worth change"
            value={<Money cents={review.netWorth.change} variant="h2" compact whole signed tone="balance" />}
            caption={`${money(review.netWorth.start, { compact: true, whole: true })} → ${money(review.netWorth.end, { compact: true, whole: true })}`}
          />
          <BigNumberCard
            label={review.debt.paidDown >= 0 ? 'Debt paid down' : 'Debt added'}
            value={<Money cents={Math.abs(review.debt.paidDown)} variant="h2" compact whole />}
            caption={review.debt.interest > 0 ? `${money(review.debt.interest, { whole: true })} of interest charged` : 'No interest charged'}
          />
        </View>
      </Section>

      <Section title="How did each month go?" subtitle="Money in against money out">
        <Card style={{ gap: spacing.md }}>
          <ColumnChart
            data={columns}
            series={[
              { label: 'Income', color: series[0] },
              { label: 'Spending', color: series[1] },
            ]}
            height={180}
            formatY={(v) => money(v, { compact: true, whole: true })}
            formatTitle={(d) => formatMonth(d.key)}
            accessibilityLabel={`Income and spending for each month of ${review.year}`}
          />
        </Card>
        {review.bestMonth && review.worstMonth && (
          <View style={styles.tiles}>
            <BigNumberCard
              label={`Best month · ${review.bestMonth.label}`}
              value={<Money cents={review.bestMonth.saved} variant="h2" compact whole signed tone="balance" />}
              caption="kept the most"
            />
            <BigNumberCard
              label={`${leanMonthLabel(review.worstMonth).label} · ${review.worstMonth.label}`}
              value={<Money cents={review.worstMonth.saved} variant="h2" compact whole signed tone="balance" />}
              caption={leanMonthLabel(review.worstMonth).caption}
            />
          </View>
        )}
      </Section>

      {review.topCategories.length > 0 && (
        <Section
          title="Where did it all go?"
          subtitle={review.comparable ? `Bars are ${review.year}; captions compare with ${review.previousYear}` : 'Biggest categories first'}
        >
          <RankedCard
            title="Biggest categories"
            items={review.topCategories.slice(0, 6).map((c) => {
              const before = review.comparable ? previous?.byCategory.find((p) => p.key === c.key)?.amount : undefined;
              return {
                key: c.key,
                label: c.label,
                amount: c.amount,
                color: c.color,
                caption: before === undefined ? undefined : `${review.previousYear}: ${money(before, { whole: true })}`,
              };
            })}
          />
        </Section>
      )}

      {review.topMerchants.length > 0 && (
        <Section title="Who got the most?" subtitle="Merchants by total spent">
          <MerchantList merchants={review.topMerchants.slice(0, 6)} />
        </Section>
      )}

      {review.biggestPurchase && (
        <Section title="The big one">
          <Card style={{ gap: spacing.sm }}>
            <Text variant="small" color={colors.textSecondary}>
              Most expensive single purchase
            </Text>
            <Money cents={review.biggestPurchase.amount} variant="h1" />
            <PurchaseNote date={review.biggestPurchase.date} description={review.biggestPurchase.payee || review.biggestPurchase.description} today={today} />
            <Row>
              <Button label="Open it" size="sm" variant="secondary" onPress={() => router.push(`/transactions/${review.biggestPurchase!.id}`)} />
            </Row>
          </Card>
        </Section>
      )}

      <Section title="Fun but true" subtitle="All computed from what you recorded">
        {review.facts.length > 0 ? (
          <FactsCard facts={review.facts} />
        ) : (
          <Card variant="muted">
            <Text color={colors.textSecondary}>Not enough spending recorded this year to find any patterns.</Text>
          </Card>
        )}
      </Section>

      <Section title="The rest of the ledger">
        <ListCard>
          <KeyValue label="Subscriptions paid" hint={review.subscriptions.count ? `${review.subscriptions.count} tracked` : 'None linked to a subscription'}>
            <Money cents={review.subscriptions.total} weight="medium" whole />
          </KeyValue>
          <KeyValue label="Invested" hint="Moved into investment accounts">
            <Money cents={review.investments.contributions} weight="medium" whole />
          </KeyValue>
          <KeyValue label="Moved to savings">
            <Money cents={s.toSavings} weight="medium" whole />
          </KeyValue>
          <KeyValue label="Debt payments">
            <Money cents={s.debtPayments} weight="medium" whole />
          </KeyValue>
          <KeyValue label="Goals completed" value={review.goalsCompleted.length ? review.goalsCompleted.map((g) => g.name).join(', ') : 'None yet'} />
        </ListCard>
      </Section>

      {!previous ? (
        <Banner tone="muted" icon="info" title={`Nothing was tracked in ${review.previousYear}`} message="Comparisons appear once there is a full year to compare with." />
      ) : (
        !review.comparable && (
          <Banner
            tone="muted"
            icon="info"
            title={`${review.previousYear} isn't comparable yet`}
            message={`Only ${review.previousTrackedDays} of the ${review.trackedDays} days being compared were tracked in ${review.previousYear}, so year-on-year figures would say more about when you started than about your money.`}
          />
        )
      )}

      <Button label="Export as text" icon="share" variant="secondary" fullWidth onPress={share} accessibilityHint="Saves or shares a plain-text summary of this year" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
