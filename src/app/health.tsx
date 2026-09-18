import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { CheckupGrid } from '@/components/health/Checkup';
import { Button, Card, NavHeader, Screen, Text } from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { moneyCheckup } from '@/domain/health';
import { useDerived } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

export default function HealthScreen() {
  const router = useRouter();
  const { metrics, strong, rated } = useDerived(moneyCheckup);
  const share = rated ? strong / rated : 0;

  return (
    <Screen header={<NavHeader title="Money checkup" />}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.lg }} padding={spacing.xl}>
        <EmojiIcon name={share >= 0.75 ? 'rocket' : share >= 0.4 ? 'seedling' : 'light-bulb'} size={48} />
        <View style={{ flex: 1 }}>
          <Text variant="h1" tabular>
            {strong}
            <Text variant="h2" color={colors.textTertiary}>
              {' '}/ {rated}
            </Text>
          </Text>
          <Text color={colors.textSecondary}>vital signs looking strong</Text>
        </View>
      </Card>
      <CheckupGrid metrics={metrics} />
      <Button label="Can I afford something new?" icon="check-square" variant="secondary" fullWidth onPress={() => router.push('/afford')} />
      <Text variant="caption" color={colors.textTertiary} align="center">
        Compared with common rules of thumb. Informational, not financial advice.
      </Text>
    </Screen>
  );
}
