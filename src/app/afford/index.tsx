import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Card, Money, NavHeader, Screen, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { financialSnapshot } from '@/domain/affordability';
import { useDerived } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

const CALCULATORS = [
  { kind: 'car', emoji: 'automobile', title: 'A car', subtitle: 'Payment, insurance, gas' },
  { kind: 'rent', emoji: 'key', title: 'Rent', subtitle: 'Move-in costs, 30% rule' },
  { kind: 'house', emoji: 'house-with-garden', title: 'A home', subtitle: 'Mortgage, taxes, PMI' },
  { kind: 'purchase', emoji: 'shopping-bags', title: 'Something big', subtitle: 'Cash, save up or finance' },
] as const;

export default function AffordHubScreen() {
  const router = useRouter();
  const snapshot = useDerived(financialSnapshot);

  return (
    <Screen header={<NavHeader title="Can I afford it?" />}>
      <Card variant="muted" style={styles.today}>
        <EmojiIcon name="balance-scale" size={36} />
        <View style={{ flex: 1 }}>
          <Text variant="small" color={colors.textSecondary}>
            Left over each month today
          </Text>
          <Money cents={snapshot.surplus} variant="h2" whole tone="balance" />
          <Text variant="caption" color={colors.textTertiary}>
            {snapshot.takeHomeBasis === 'measured' ? 'Last 3 months of income, spending and debt payments' : 'Your scheduled pay, less spending and debt payments'}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="small" color={colors.textSecondary}>
            Cash & savings
          </Text>
          <Money cents={snapshot.liquidSavings} variant="h3" whole />
        </View>
      </Card>

      <View style={styles.grid}>
        {CALCULATORS.map((c) => (
          <Card key={c.kind} style={styles.tile} padding={spacing.lg} onPress={() => router.push(`/afford/${c.kind}`)} accessibilityLabel={`Can I afford ${c.title}`}>
            <EmojiIcon name={c.emoji} size={48} />
            <View style={{ gap: 2 }}>
              <Text variant="h3">{c.title}</Text>
              <Text variant="caption" color={colors.textTertiary}>
                {c.subtitle}
              </Text>
            </View>
            <Feather name="arrow-up-right" size={16} color={colors.textTertiary} style={styles.arrow} />
          </Card>
        ))}
      </View>

      <Text variant="caption" color={colors.textTertiary} align="center">
        Uses your real income, spending, debts and savings. Rules of thumb, not advice.
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  today: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { width: '47.5%', flexGrow: 1, gap: spacing.md, minHeight: 150 },
  arrow: { position: 'absolute', top: spacing.lg, right: spacing.lg },
});
