import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import { Banner, Card, HBarList, Money, Pill, Row, Section, Segmented, SplitBar, Stack, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { formatDate } from '@/domain/dates';
import { ownershipCost, type OwnershipWindow } from '@/domain/ownership';
import type { Asset } from '@/domain/types';
import { useDerived, useMoney } from '@/store/hooks';
import { colors, series, spacing } from '@/theme/tokens';

type Range = 'last12' | 'since';

const RANGES: { value: Range; label: string }[] = [
  { value: 'last12', label: 'Last 12 months' },
  { value: 'since', label: 'Since purchase' },
];

/** What an asset costs to own: running costs, loan interest and lost value. */
export function OwnershipCard({ asset }: { asset: Asset }) {
  const router = useRouter();
  const money = useMoney();
  const [range, setRange] = useState<Range>('last12');
  const summary = useDerived((d, t) => ownershipCost(d, asset.id, t), [asset.id]);
  if (!summary) return null;

  const w: OwnershipWindow = range === 'last12' ? summary.last12 : summary.sincePurchase;
  const perMonth = range === 'last12' ? w.perMonth : summary.perMonthOwned;
  const costLines = w.lines.filter((l) => l.cost && l.amount > 0);
  const principal = w.lines.find((l) => l.kind === 'loan_principal');
  const maxBar = Math.max(1, Math.abs(w.depreciation), ...costLines.map((l) => l.amount));

  // A 12-month window's yearly rate *is* its total, so print the number once.
  const wholeYear = Math.abs(w.months - 12) < 0.5;
  const totalLine = [
    wholeYear ? `${money(w.total)} in total` : `${money(w.perYear)} a year · ${money(w.total)} in total`,
    w.depreciation > 0 ? `of which ${money(w.depreciation)} is value lost` : w.depreciation < 0 ? `after gaining ${money(-w.depreciation)} in value` : null,
  ]
    .filter(Boolean)
    .join(', ');

  const bars = [
    ...costLines.map((l) => ({
      key: l.kind,
      label: l.label,
      value: l.amount,
      valueLabel: money(l.amount),
      color: series[costLines.findIndex((x) => x.kind === l.kind) % series.length],
      leading: <EmojiIcon name={l.emoji} size={18} />,
    })),
    ...(w.depreciation > 0
      ? [
          {
            key: 'depreciation',
            label: 'Value lost',
            value: w.depreciation,
            valueLabel: money(w.depreciation),
            color: colors.textTertiary,
            caption: 'Not money you paid — worth you no longer have',
            leading: <EmojiIcon name="chart-decreasing" size={18} />,
          },
        ]
      : []),
  ];

  return (
    <Section title="What does it cost to own?" subtitle={`${formatDate(w.from, 'medium')} – ${formatDate(w.to, 'medium')}`}>
      <Segmented items={RANGES} value={range} onChange={setRange} size="sm" />

      <Card variant="muted" padding={spacing.xl} style={{ gap: spacing.sm }}>
        <Row gap={spacing.sm}>
          <EmojiIcon name="money-with-wings" size={24} />
          <Text variant="small" weight="medium" color={colors.textSecondary} style={{ flex: 1 }}>
            {range === 'last12' ? 'Cost per month, last 12 months' : `Cost per month over ${Math.round(summary.monthsOwned)} months owned`}
          </Text>
        </Row>
        <Money cents={perMonth} variant="display" />
        <Text variant="caption" color={colors.textTertiary}>
          {totalLine}
        </Text>
        <SplitBar
          segments={[
            { key: 'running', value: Math.max(0, w.running), color: colors.primary },
            { key: 'depreciation', value: Math.max(0, w.depreciation), color: colors.textTertiary },
          ]}
        />
        <Row gap={spacing.md}>
          <Row gap={4}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary }} />
            <Text variant="caption" color={colors.textSecondary}>
              {`Money spent ${money(w.running)}`}
            </Text>
          </Row>
          <Row gap={4}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textTertiary }} />
            <Text variant="caption" color={colors.textSecondary}>
              {`Value lost ${money(Math.max(0, w.depreciation))}`}
            </Text>
          </Row>
        </Row>
      </Card>

      {bars.length === 0 ? (
        <Card style={{ gap: spacing.sm }}>
          <Text weight="medium">Nothing costed yet</Text>
          <Text variant="small" color={colors.textSecondary}>
            {asset.expenseTag
              ? `Tag fuel, insurance and repairs with #${asset.expenseTag} and record a value over time to see the real cost.`
              : 'Give this asset an expense tag, then tag its running costs, to see the real cost of owning it.'}
          </Text>
        </Card>
      ) : (
        <Card>
          <HBarList items={bars} max={maxBar} />
        </Card>
      )}

      {principal && (
        <Banner
          tone="muted"
          icon="corner-down-right"
          title={`${money(principal.amount)} of loan principal is not a cost`}
          message={`It moved from cash into what you own. Of the ${money(w.cashOut)} that left your accounts, ${money(w.running)} was real cost — including ${money(w.loanInterest)} of loan interest.`}
        />
      )}

      {summary.loan && (
        <Card style={{ gap: spacing.sm }}>
          <Row gap={spacing.sm}>
            <EmojiIcon name="bank" size={22} />
            <Text weight="medium" style={{ flex: 1 }}>
              {summary.loan.name}
            </Text>
            <Pill
              size="sm"
              tone="primary"
              label="Open"
              trailingIcon="chevron-right"
              onPress={() => router.push(`/accounts/${summary.loan!.id}`)}
              accessibilityLabel={`Open ${summary.loan.name}`}
            />
          </Row>
          <Stack gap={4}>
            <Row gap={spacing.sm}>
              <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                Still owed
              </Text>
              <Money cents={summary.loan.balance} variant="small" weight="semibold" />
            </Row>
            <Row gap={spacing.sm}>
              <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                Interest paid
              </Text>
              <Money cents={w.loanInterest} variant="small" weight="semibold" />
            </Row>
            <Row gap={spacing.sm}>
              <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
                Principal paid off
              </Text>
              <Money cents={w.loanPrincipal} variant="small" weight="semibold" />
            </Row>
          </Stack>
        </Card>
      )}
    </Section>
  );
}
