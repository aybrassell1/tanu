import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import type { IconName } from '@/data/icons';
import { colors, radius, shadows } from '@/theme/tokens';

const icons: Record<string, IconName> = {
  index: 'home',
  transactions: 'list',
  money: 'layers',
  more: 'grid',
};

/** Floating pill tab bar with a centre quick-add action. */
export function TabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const router = useRouter();
  const middle = Math.ceil(state.routes.length / 2);

  return (
    <View style={[styles.wrap, { pointerEvents: 'box-none' }, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <View style={styles.bar}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const label = descriptors[route.key].options.title ?? route.name;
          const color = focused ? colors.primary : colors.textTertiary;

          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            // A tab press opens the tab itself, dropping params left by a deep link
            // (e.g. /transactions?accountId=…) so old filters don't stick.
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
          };

          return (
            <Fragment key={route.key}>
              {index === middle && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Quick add"
                  accessibilityHint="Record an expense, paycheck, transfer, debt payment or balance"
                  onPress={() => router.push('/quick-add')}
                  style={({ pressed }) => [styles.add, pressed && { opacity: 0.8 }]}
                >
                  <Feather name="plus" size={24} color={colors.onPrimary} />
                </Pressable>
              )}
              <Pressable accessibilityRole="tab" accessibilityState={{ selected: focused }} accessibilityLabel={label} onPress={onPress} style={styles.tab}>
                <Feather name={icons[route.name] ?? 'circle'} size={20} color={color} />
                <Text variant="caption" color={color} weight={focused ? 'semibold' : 'medium'}>
                  {label}
                </Text>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, alignItems: 'center' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 8,
    boxShadow: shadows.float,
    width: '100%',
    maxWidth: 520,
  },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 4 },
  add: { width: 50, height: 50, borderRadius: radius.pill, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', marginHorizontal: 4 },
});
