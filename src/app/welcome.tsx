import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { Image, StyleSheet, View } from 'react-native';

import { Button, GradientCard, Pill, Screen, Text } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: 'lock', title: 'Private by design', body: 'Everything stays on this device. No bank logins, no servers, no tracking.' },
  { icon: 'edit-3', title: 'Manual first', body: 'Add accounts and transactions yourself in seconds. Nothing is required to be linked.' },
  { icon: 'download', title: 'Your data, portable', body: 'Export a full backup or a CSV of transactions whenever you like.' },
];

export default function WelcomeScreen() {
  const router = useRouter();
  const start = (sample: boolean) => {
    // Setup marks onboarding complete once it finishes, so a half-done setup can be resumed.
    if (sample) ledger.loadSampleData();
    router.replace(sample ? '/' : '/setup');
  };

  return (
    <Screen edges={['top', 'bottom']}>
      <GradientCard style={{ gap: spacing.md, paddingVertical: spacing.xxxl }}>
        <Pill tone="glass" icon="shield" label="Personal finance command center" />
        <View style={styles.brand}>
          <View style={styles.logo}>
            <Image source={require('../../assets/brand/tanu-mark.png')} style={styles.mark} resizeMode="contain" accessibilityLabel="Tanu logo" />
          </View>
          <Text variant="display" color={colors.onPrimary}>
            Tanu
          </Text>
        </View>
        <Text color="rgba(255,255,255,0.9)">
          Everything you own, owe, earn, spend and plan — in one calm place.
        </Text>
      </GradientCard>

      <View style={{ gap: spacing.lg }}>
        {POINTS.map((p) => (
          <View key={p.title} style={styles.point}>
            <View style={styles.icon}>
              <Feather name={p.icon} size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text weight="semibold">{p.title}</Text>
              <Text variant="small" color={colors.textSecondary}>
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ gap: spacing.md }}>
        <Button label="Start with my own data" size="lg" fullWidth trailingIcon="arrow-right" onPress={() => start(false)} />
        <Button label="Explore with sample data" size="lg" variant="secondary" fullWidth onPress={() => start(true)} />
        <Text variant="small" color={colors.textTertiary} align="center">
          Sample data is clearly marked and can be erased in one tap from Settings.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  logo: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.onPrimary, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 48, height: 48 },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
