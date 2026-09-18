import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { colors, spacing, TAB_BAR_CLEARANCE } from '@/theme/tokens';
import { IconButton } from './Button';
import { Text } from './Text';

type ScreenProps = {
  children: ReactNode;
  /** Reserve space for the floating tab bar. */
  tabBar?: boolean;
  edges?: Edge[];
  background?: string;
  contentStyle?: StyleProp<ViewStyle>;
  /** Rendered above the scroll area (e.g. a NavHeader that shouldn't scroll). */
  header?: ReactNode;
  /** Pinned to the bottom, above the keyboard (e.g. a Save button). */
  footer?: ReactNode;
  scroll?: boolean;
};

export function Screen({ children, tabBar = false, edges = ['top'], background = colors.background, contentStyle, header, footer, scroll = true }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const bottomPad = tabBar ? TAB_BAR_CLEARANCE : footer ? spacing.xl : spacing.xxxl + insets.bottom;
  const body = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[styles.content, { paddingBottom: bottomPad }, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.content, { flex: 1, paddingBottom: bottomPad }, contentStyle]}>{children}</View>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.screen, { backgroundColor: background }]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {header && <View style={styles.header}>{header}</View>}
        {body}
        {footer && <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>{footer}</View>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type ScreenTitleProps = {
  title: string;
  subtitle?: string;
  eyebrow?: ReactNode;
  actions?: ReactNode;
};

/** Large page title used at the top of hub screens. */
export function ScreenTitle({ title, subtitle, eyebrow, actions }: ScreenTitleProps) {
  return (
    <View style={{ gap: spacing.sm }}>
      {eyebrow}
      <View style={styles.titleRow}>
        <Text variant="h1" style={{ flex: 1 }} accessibilityRole="header">
          {title}
        </Text>
        {actions && <View style={styles.actions}>{actions}</View>}
      </View>
      {!!subtitle && <Text color={colors.textSecondary}>{subtitle}</Text>}
    </View>
  );
}

type SectionProps = {
  title: string;
  subtitle?: string;
  action?: string;
  onAction?: () => void;
  accessory?: ReactNode;
  children: ReactNode;
};

export function Section({ title, subtitle, action, onAction, accessory, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={{ flex: 1 }}>
          <Text variant="h3" accessibilityRole="header">
            {title}
          </Text>
          {!!subtitle && (
            <Text variant="small" color={colors.textTertiary}>
              {subtitle}
            </Text>
          )}
        </View>
        {accessory}
        {action && (
          <Text variant="small" weight="medium" color={colors.primary} onPress={onAction} suppressHighlighting accessibilityRole="button">
            {action}
          </Text>
        )}
      </View>
      {children}
    </View>
  );
}

/** Centered title bar with round back / action buttons ("‹  English Grammar  ⋯"). */
export function NavHeader({ title, right, onBack, backIcon = 'chevron-left' }: { title?: string; right?: ReactNode; onBack?: () => void; backIcon?: 'chevron-left' | 'x' }) {
  const router = useRouter();
  const back = onBack ?? (() => (router.canGoBack() ? router.back() : router.replace('/')));
  return (
    <View style={styles.nav}>
      <IconButton icon={backIcon} accessibilityLabel={backIcon === 'x' ? 'Close' : 'Back'} onPress={back} />
      <Text variant="h3" numberOfLines={1} style={styles.navTitle} align="center">
        {title ?? ''}
      </Text>
      <View style={styles.navRight}>{right ?? <View style={{ width: 40 }} />}</View>
    </View>
  );
}

export function Row({ children, gap = spacing.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap }, style]}>{children}</View>;
}

export function Stack({ children, gap = spacing.md, style }: { children: ReactNode; gap?: number; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, gap: spacing.xxl, width: '100%', maxWidth: 720, alignSelf: 'center' },
  header: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm, paddingBottom: spacing.sm, width: '100%', maxWidth: 720, alignSelf: 'center' },
  footer: { paddingHorizontal: spacing.xl, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: colors.background, width: '100%', maxWidth: 720, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.sm },
  section: { gap: spacing.md },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  nav: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  navTitle: { flex: 1 },
  navRight: { minWidth: 40, alignItems: 'flex-end', flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
