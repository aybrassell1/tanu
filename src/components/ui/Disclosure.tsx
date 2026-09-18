import Feather from '@expo/vector-icons/Feather';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { colors, spacing } from '@/theme/tokens';
import { IconButton } from './Button';
import { Sheet } from './Overlay';
import { Text } from './Text';

/** Collapsed-by-default section for secondary detail (tables, advanced fields). */
export function Disclosure({ label, children, initiallyOpen = false, count }: { label: string; children: ReactNode; initiallyOpen?: boolean; count?: number }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <View style={{ gap: spacing.md }}>
      <Pressable onPress={() => setOpen(!open)} style={styles.toggle} accessibilityRole="button" accessibilityState={{ expanded: open }} hitSlop={6}>
        <Text variant="small" weight="medium" color={colors.primary}>
          {open ? `Hide ${label.toLowerCase()}` : label}
          {count !== undefined && !open ? ` (${count})` : ''}
        </Text>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={15} color={colors.primary} />
      </Pressable>
      {open && children}
    </View>
  );
}

/** Small ⓘ button that explains a concept in a sheet instead of inline paragraphs. */
export function InfoButton({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="info" variant="plain" size={28} accessibilityLabel={`About ${title}`} onPress={() => setOpen(true)} />
      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        {typeof children === 'string' ? <Text color={colors.textSecondary}>{children}</Text> : children}
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start' },
});
