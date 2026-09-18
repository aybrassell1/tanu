import Feather from '@expo/vector-icons/Feather';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { colors, fonts, radius, shadows, spacing } from '@/theme/tokens';
import { Button, IconButton } from './Button';
import { Text } from './Text';

// ─── Sheet ───────────────────────────────────────────────────────────────────

type SheetProps = {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Let content scroll (lists, long forms). */
  scroll?: boolean;
};

/** Bottom sheet built on Modal so it works on iOS, Android and web. */
export function Sheet({ visible, onClose, title, subtitle, children, footer, scroll = true }: SheetProps) {
  // Otherwise typing goes into the form field behind the sheet.
  useEffect(() => {
    if (!visible) return;
    Keyboard.dismiss();
    if (Platform.OS === 'web') (globalThis as { document?: { activeElement?: { blur?: () => void } } }).document?.activeElement?.blur?.();
  }, [visible]);

  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <KeyboardAvoidingView style={styles.sheetRoot} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" accessibilityRole="button">
          <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.overlay }]} />
        </Pressable>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.grabber} />
          {(title || subtitle) && (
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                {!!title && <Text variant="h3">{title}</Text>}
                {!!subtitle && (
                  <Text variant="small" color={colors.textSecondary}>
                    {subtitle}
                  </Text>
                )}
              </View>
              <IconButton icon="x" size={34} accessibilityLabel="Close" onPress={onClose} />
            </View>
          )}
          {scroll ? (
            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody} style={{ flexGrow: 0 }}>
              {children}
            </ScrollView>
          ) : (
            <View style={styles.sheetBody}>{children}</View>
          )}
          {footer && <View style={styles.sheetFooter}>{footer}</View>}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Dialog + Toast providers ────────────────────────────────────────────────

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Require typing this word before confirming (for irreversible actions). */
  typeToConfirm?: string;
};

type ToastOptions = { message: string; actionLabel?: string; onAction?: () => void; tone?: 'default' | 'error' };

type OverlayApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (options: ToastOptions | string) => void;
};

const OverlayContext = createContext<OverlayApi | null>(null);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<(ConfirmOptions & { resolve: (v: boolean) => void }) | null>(null);
  const [typed, setTyped] = useState('');
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setTyped('');
        setDialog({ ...options, resolve });
      }),
    [],
  );

  const showToast = useCallback(
    (input: ToastOptions | string) => {
      const options = typeof input === 'string' ? { message: input } : input;
      if (timer.current) clearTimeout(timer.current);
      setToast({ ...options, key: Date.now() });
      Animated.timing(opacity, { toValue: 1, duration: 160, useNativeDriver: true }).start();
      timer.current = setTimeout(() => {
        Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => finished && setToast(null));
      }, options.actionLabel ? 5000 : 2600);
    },
    [opacity],
  );

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const close = (value: boolean) => {
    dialog?.resolve(value);
    setDialog(null);
  };
  const blocked = !!dialog?.typeToConfirm && typed.trim().toLowerCase() !== dialog.typeToConfirm.toLowerCase();

  return (
    <OverlayContext.Provider value={{ confirm, toast: showToast }}>
      {children}
      {dialog && (
      <Modal visible transparent animationType="fade" onRequestClose={() => close(false)}>
        <View style={styles.dialogRoot}>
          <View style={styles.dialog} accessibilityRole="alert">
            <Text variant="h3">{dialog?.title}</Text>
            {!!dialog?.message && <Text color={colors.textSecondary}>{dialog.message}</Text>}
            {!!dialog?.typeToConfirm && (
              <View style={{ gap: 6 }}>
                <Text variant="small" color={colors.textSecondary}>
                  Type <Text variant="small" weight="semibold">{dialog.typeToConfirm}</Text> to confirm.
                </Text>
                <TextInput value={typed} onChangeText={setTyped} autoCapitalize="none" autoCorrect={false} style={styles.confirmInput} accessibilityLabel="Confirmation text" />
              </View>
            )}
            <View style={styles.dialogActions}>
              <Button label={dialog?.cancelLabel ?? 'Cancel'} variant="secondary" onPress={() => close(false)} style={{ flex: 1 }} />
              <Button
                label={dialog?.confirmLabel ?? 'Confirm'}
                variant={dialog?.destructive ? 'dark' : 'primary'}
                onPress={() => close(true)}
                disabled={blocked}
                style={[{ flex: 1 }, dialog?.destructive && { backgroundColor: colors.negative, borderColor: colors.negative }]}
              />
            </View>
          </View>
        </View>
      </Modal>
      )}
      {toast && (
        <Animated.View style={[styles.toastWrap, { pointerEvents: 'box-none' }, { bottom: insets.bottom + 100, opacity }]}>
          <View style={[styles.toast, toast.tone === 'error' && { backgroundColor: colors.negative }]} accessibilityLiveRegion="polite">
            <Feather name={toast.tone === 'error' ? 'alert-circle' : 'check'} size={16} color={colors.onInk} />
            <Text variant="small" weight="medium" color={colors.onInk} style={{ flex: 1 }}>
              {toast.message}
            </Text>
            {toast.actionLabel && (
              <Pressable
                onPress={() => {
                  toast.onAction?.();
                  setToast(null);
                }}
                hitSlop={10}
                accessibilityRole="button"
              >
                <Text variant="small" weight="semibold" color={colors.primaryMuted}>
                  {toast.actionLabel}
                </Text>
              </Pressable>
            )}
          </View>
        </Animated.View>
      )}
    </OverlayContext.Provider>
  );
}

export function useOverlay(): OverlayApi {
  const api = useContext(OverlayContext);
  if (!api) throw new Error('useOverlay must be used inside OverlayProvider');
  return api;
}

const styles = StyleSheet.create({
  sheetRoot: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    boxShadow: shadows.float,
  },
  grabber: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong, marginTop: 8 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md, paddingBottom: spacing.sm },
  sheetBody: { paddingHorizontal: spacing.xl, paddingVertical: spacing.md, gap: spacing.lg },
  sheetFooter: { paddingHorizontal: spacing.xl, paddingTop: spacing.sm },
  dialogRoot: { flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  dialog: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.xl, gap: spacing.md, width: '100%', maxWidth: 400 },
  dialogActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  confirmInput: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, height: 44, paddingHorizontal: spacing.md, fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  toastWrap: { position: 'absolute', left: spacing.xl, right: spacing.xl, alignItems: 'center' },
  toast: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.ink, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, maxWidth: 480, width: '100%', boxShadow: shadows.float },
});
