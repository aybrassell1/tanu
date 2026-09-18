import Feather from '@expo/vector-icons/Feather';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { Card, GradientCard, HBarList, ListCard, ListRow, Money, Pill, Row, Text } from '@/components/ui';
import { icon as featherIcon } from '@/data/icons';
import { formatDate } from '@/domain/dates';
import type { Cents } from '@/domain/types';
import type { MerchantSpend, YearFact, YearMonth, YearReview } from '@/domain/yearReview';
import { useMoney, usePercent } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

/** The headline card: what came in, what went out and what stayed. */
export function HeadlineCard({ review }: { review: YearReview }) {
  const money = useMoney();
  const percent = usePercent();
  const s = review.stats;
  return (
    <GradientCard style={{ gap: spacing.lg }}>
      <Row>
        <Pill label={review.isPartial ? `${review.year} so far` : String(review.year)} tone="glass" size="sm" icon="calendar" />
      </Row>
      <View style={{ gap: 4 }}>
        <Text variant="small" color="rgba(255,255,255,0.85)">
          You kept
        </Text>
        <Text variant="display" color={colors.onPrimary} tabular>
          {money(s.saved, { compact: true, whole: true })}
        </Text>
        <Text variant="h3" weight="medium" color={colors.onPrimary}>
          {s.income > 0 ? `${percent(s.savingsRate)} of everything you earned` : 'No income recorded this year'}
        </Text>
      </View>
      <View style={styles.heroSplit}>
        <HeroFigure label="Earned" value={money(s.income, { compact: true, whole: true })} />
        <HeroFigure label="Spent" value={money(s.spending, { compact: true, whole: true })} />
        <HeroFigure label="Net worth" value={money(review.netWorth.change, { compact: true, whole: true, signed: true })} />
      </View>
    </GradientCard>
  );
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text variant="caption" color="rgba(255,255,255,0.8)">
        {label.toUpperCase()}
      </Text>
      <Text variant="h3" color={colors.onPrimary} tabular numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** One big number with a caption; the building block of the scrollable cards. */
export function BigNumberCard({ label, value, caption, tone = 'default' }: { label: string; value: ReactNode; caption?: string; tone?: 'default' | 'muted' }) {
  return (
    <Card variant={tone === 'muted' ? 'muted' : 'outlined'} style={{ flex: 1, gap: 6, minWidth: 140 }}>
      <Text variant="small" color={colors.textSecondary} numberOfLines={2}>
        {label}
      </Text>
      {typeof value === 'string' ? <Text variant="h2">{value}</Text> : value}
      {!!caption && (
        <Text variant="caption" color={colors.textTertiary} numberOfLines={2}>
          {caption}
        </Text>
      )}
    </Card>
  );
}

/** Ranked bars for categories or merchants. */
export function RankedCard({
  title,
  subtitle,
  items,
  onPress,
}: {
  title: string;
  subtitle?: string;
  items: { key: string; label: string; amount: Cents; color?: string; caption?: string }[];
  onPress?: (key: string) => void;
}) {
  const money = useMoney();
  return (
    <Card style={{ gap: spacing.md }}>
      <View>
        <Text variant="h3" accessibilityRole="header">
          {title}
        </Text>
        {!!subtitle && (
          <Text variant="caption" color={colors.textTertiary}>
            {subtitle}
          </Text>
        )}
      </View>
      <HBarList
        items={items.map((item, i) => ({
          key: item.key,
          label: item.label,
          value: item.amount,
          valueLabel: money(item.amount, { whole: true }),
          color: item.color ?? series[i % series.length],
          caption: item.caption,
          onPress: onPress ? () => onPress(item.key) : undefined,
        }))}
      />
    </Card>
  );
}

/** Best and worst months, side by side. */
export function FactsCard({ facts }: { facts: YearFact[] }) {
  return (
    <ListCard>
      {facts.map((fact) => (
        <ListRow
          key={fact.key}
          icon={featherIcon(fact.icon)}
          title={fact.label}
          subtitle={fact.detail}
          trailing={
            <Text weight="semibold" numberOfLines={1}>
              {fact.value}
            </Text>
          }
        />
      ))}
    </ListCard>
  );
}

/** Merchants with how often you paid them. */
export function MerchantList({ merchants }: { merchants: MerchantSpend[] }) {
  return (
    <ListCard>
      {merchants.map((m) => (
        <ListRow key={m.key} icon="shopping-bag" title={m.label} subtitle={`${m.count} purchase${m.count === 1 ? '' : 's'}`} trailing={<Money cents={m.amount} weight="semibold" whole />} />
      ))}
    </ListCard>
  );
}

/** Year picker chip row; only years with data appear. */
export function YearSwitcher({ years, value, onChange }: { years: number[]; value: number; onChange: (year: number) => void }) {
  return (
    <View style={styles.years}>
      {years.map((year) => (
        <Pill key={year} label={String(year)} selected={year === value} tone="muted" onPress={() => onChange(year)} accessibilityLabel={`Show ${year}`} />
      ))}
    </View>
  );
}

/** A dated note under a card, e.g. the biggest purchase. */
export function PurchaseNote({ date, description, today }: { date: string; description: string; today: string }) {
  return (
    <Row gap={6}>
      <Feather name="tag" size={12} color={colors.textTertiary} />
      <Text variant="caption" color={colors.textTertiary} numberOfLines={1} style={{ flex: 1 }}>
        {`${description} · ${formatDate(date, 'medium', today)}`}
      </Text>
    </Row>
  );
}

const styles = StyleSheet.create({
  heroSplit: { flexDirection: 'row', gap: spacing.md, borderTopWidth: 1, borderTopColor: colors.glassBorder, paddingTop: spacing.md },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  years: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
