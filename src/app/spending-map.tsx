import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Button, Card, EmptyState, Money, NavHeader, Pill, ProgressRing, Row, Screen, Section, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { categoryEmoji } from '@/data/visuals';
import { spendingMap, type MapArea } from '@/domain/coverage';
import { activeFunds, fundBalance, fundKey } from '@/domain/sinking';
import { useDerived, useMoney } from '@/store/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

export default function SpendingMapScreen() {
  const router = useRouter();
  const money = useMoney();
  const { map, byCategory, byName } = useDerived((data, day) => {
    const funds = activeFunds(data).map((f) => ({ id: f.id, name: f.name, categoryId: f.categoryId, balance: fundBalance(f) }));
    return {
      map: spendingMap(data, day),
      byCategory: new Map(funds.filter((f) => f.categoryId).map((f) => [f.categoryId as string, f])),
      // Matched loosely, so "Holiday Gifts" covers "Holiday gifts".
      byName: new Map(funds.map((f) => [fundKey(f.name), f])),
    };
  });
  /** The fund already covering an irregular cost, if there is one. */
  const fundFor = (categoryId: string, label: string) => byCategory.get(categoryId) ?? byName.get(fundKey(label)) ?? null;
  const startFund = (params: Record<string, string>) => router.push({ pathname: '/sinking/edit', params });
  const [open, setOpen] = useState<string | null>(null);
  const max = Math.max(1, ...map.areas.map((a) => a.total));
  const sorted = [...map.areas].sort((a, b) => b.total - a.total);

  if (map.total === 0) {
    return (
      <Screen header={<NavHeader title="Spending map" />}>
        <EmptyState icon="map" title="Nothing to map yet" message="Record some spending and this shows every area of your life it goes to." actionLabel="Add a transaction" onAction={() => router.push('/quick-add')} />
      </Screen>
    );
  }

  return (
    <Screen header={<NavHeader title="Spending map" />}>
      <Card style={styles.hero} padding={spacing.xl}>
        <ProgressRing value={map.trackedAreas / map.areas.length} size={72} stroke={7}>
          <Text variant="small" weight="semibold" tabular>
            {map.trackedAreas}/{map.areas.length}
          </Text>
        </ProgressRing>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="small" color={colors.textSecondary}>
            {map.months >= 11.5 ? 'Past year' : `Last ${Math.max(1, Math.round(map.months))} months`}
          </Text>
          <Money cents={map.total} variant="h2" whole />
          <Text variant="caption" color={colors.textTertiary}>
            in {map.trackedAreas} of {map.areas.length} areas of life
          </Text>
        </View>
      </Card>

      {map.irregular.length > 0 && (
        <Section
          title="Irregular costs"
          subtitle="Reserve a little each month so these never land as a surprise"
          action="Sinking funds"
          onAction={() => router.push('/sinking')}
          accessory={<Text variant="caption" color={colors.textSecondary}>{money(map.setAsideMonthly, { whole: true })}/mo</Text>}
        >
          {map.irregular.map((i) => {
            const fund = fundFor(i.categoryId, i.label);
            return (
              <Card key={i.categoryId} padding={spacing.md} style={{ gap: spacing.sm }}>
                <Pressable
                  onPress={() => router.push(`/transactions?category=${encodeURIComponent(i.categoryId)}`)}
                  accessibilityRole="button"
                  accessibilityLabel={`${i.label}, ${money(i.yearly)} a year. See these transactions`}
                  style={({ pressed }) => [styles.irregular, pressed && { opacity: 0.7 }]}
                >
                  <EmojiIcon name={categoryEmoji(i.categoryId) ?? 'spiral-calendar'} size={28} />
                  <View style={{ flex: 1 }}>
                    <Text weight="medium">{i.label}</Text>
                    <Text variant="caption" color={colors.textTertiary}>
                      {i.cadence}
                    </Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Money cents={i.yearly} weight="semibold" whole />
                    <Text variant="caption" color={colors.textTertiary}>
                      {`${money(i.monthlySetAside, { whole: true })}/mo`}
                    </Text>
                  </View>
                </Pressable>
                {fund ? (
                  <Row>
                    <Pill
                      size="sm"
                      tone="positive"
                      icon="check"
                      label={`${fund.name} holds ${money(fund.balance, { whole: true })}`}
                      onPress={() => router.push(`/sinking/${fund.id}`)}
                    />
                  </Row>
                ) : (
                  <Button
                    label="Start a fund"
                    icon="plus"
                    size="sm"
                    variant="secondary"
                    onPress={() => startFund({ name: i.label, categoryId: i.categoryId, yearlyTarget: String(i.yearly), monthly: String(i.monthlySetAside) })}
                  />
                )}
              </Card>
            );
          })}
        </Section>
      )}

      {map.missing.length > 0 && (
        <Section title="Easy to forget" subtitle="Nothing recorded in the past year">
          {map.missing.map((m) => {
            const fund = fundFor(m.categoryId, m.label);
            return (
              <Card key={m.categoryId} padding={spacing.md} style={{ gap: spacing.sm }}>
                <Row gap={spacing.sm}>
                  <EmojiIcon name={categoryEmoji(m.categoryId) ?? 'spiral-calendar'} size={22} />
                  <View style={{ flex: 1 }}>
                    <Text variant="small" weight="medium">
                      {m.label}
                    </Text>
                    <Text variant="caption" color={colors.textTertiary}>
                      {m.cadence}
                    </Text>
                  </View>
                </Row>
                <Row gap={spacing.sm}>
                  {fund ? (
                    <Pill
                      size="sm"
                      tone="positive"
                      icon="check"
                      label={`${fund.name} holds ${money(fund.balance, { whole: true })}`}
                      onPress={() => router.push(`/sinking/${fund.id}`)}
                    />
                  ) : (
                    <Button
                      label="Start a fund"
                      icon="plus"
                      size="sm"
                      variant="secondary"
                      style={{ flex: 1 }}
                      onPress={() => startFund({ name: m.label, categoryId: m.categoryId })}
                    />
                  )}
                  <Button
                    label="Add as a bill"
                    icon="calendar"
                    size="sm"
                    variant="ghost"
                    style={{ flex: 1 }}
                    onPress={() => router.push(`/bills/edit?kind=bill&categoryId=${encodeURIComponent(m.categoryId)}&name=${encodeURIComponent(m.label)}&unit=year`)}
                  />
                </Row>
              </Card>
            );
          })}
        </Section>
      )}

      <Section title="Every area" subtitle="Dots are subcategories you spend in">
        <View style={{ gap: spacing.sm }}>
          {sorted.map((area) => (
            <AreaRow key={area.id} area={area} max={max} open={open === area.id} onToggle={() => setOpen(open === area.id ? null : area.id)} />
          ))}
        </View>
      </Section>
    </Screen>
  );
}

function AreaRow({ area, max, open, onToggle }: { area: MapArea; max: number; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const money = useMoney();
  const empty = area.total === 0 && area.trackedSubs === 0;
  const subs = [...area.subs].sort((a, b) => b.total - a.total);
  return (
    <Card padding={spacing.md} style={[{ gap: spacing.sm }, empty && { opacity: 0.6 }]}>
      <Pressable onPress={onToggle} style={styles.areaHead} accessibilityRole="button" accessibilityState={{ expanded: open }} accessibilityLabel={`${area.name}, ${money(area.total, { whole: true })}`}>
        <EmojiIcon name={categoryEmoji(area.id) ?? 'package'} size={30} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.between}>
            <Text weight="medium">{area.name}</Text>
            <Money cents={area.total} weight="semibold" whole />
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.round((area.total / max) * 100)}%`, backgroundColor: area.color }]} />
          </View>
          {/* One dot per subcategory: filled when it has activity. */}
          <View style={styles.dots}>
            {area.subs.map((s) => (
              <View key={s.id} style={[styles.dot, { backgroundColor: s.count > 0 || s.recurring ? area.color : colors.surfaceSunken }]} />
            ))}
            <Text variant="caption" color={colors.textTertiary} style={{ marginLeft: 4 }}>
              {area.monthly > 0 ? `${money(area.monthly, { whole: true })}/mo` : 'Not tracked'}
            </Text>
          </View>
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textTertiary} />
      </Pressable>
      {open && (
        <View>
          {subs.map((s) => (
            <Pressable key={s.id} style={styles.sub} onPress={() => router.push(`/transactions?category=${encodeURIComponent(s.id)}`)} accessibilityRole="button">
              <EmojiIcon name={categoryEmoji(s.id) ?? 'package'} size={18} />
              <Text variant="small" style={{ flex: 1 }} color={s.count || s.recurring ? colors.ink : colors.textTertiary}>
                {s.name}
                {s.recurring ? ' · recurring' : ''}
              </Text>
              {s.total > 0 ? <Money cents={s.total} variant="small" whole /> : <Text variant="caption" color={colors.textTertiary}>—</Text>}
            </Pressable>
          ))}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  irregular: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  areaHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  track: { height: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
  dots: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 3 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  sub: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingLeft: 42 },
});
