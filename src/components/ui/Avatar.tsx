import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';
import { Text } from './Text';

type AvatarProps = {
  initials: string;
  size?: number;
  color?: string;
  textColor?: string;
  ring?: string;
};

export function Avatar({ initials, size = 40, color = colors.primarySoft, textColor = colors.primary, ring }: AvatarProps) {
  return (
    <View
      style={[
        styles.avatar,
        { width: size, height: size, backgroundColor: color },
        ring ? { borderWidth: 2, borderColor: ring } : null,
      ]}
    >
      <Text variant="small" weight="semibold" color={textColor} style={{ fontSize: size * 0.36, lineHeight: size * 0.44 }}>
        {initials}
      </Text>
    </View>
  );
}

type StackItem = { initials: string; color: string };

/** Overlapping avatars, like the template's "22K+ Trusted users" cluster. */
export function AvatarStack({ items, size = 28, ring = colors.surface }: { items: StackItem[]; size?: number; ring?: string }) {
  return (
    <View style={styles.stack}>
      {items.map((item, i) => (
        <View key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.3 }}>
          <Avatar initials={item.initials} color={item.color} textColor={colors.onPrimary} size={size} ring={ring} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  stack: { flexDirection: 'row', alignItems: 'center' },
});
