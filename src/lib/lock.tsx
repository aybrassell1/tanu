import Feather from '@expo/vector-icons/Feather';
import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, AppState, Platform, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner, Button, Text } from '@/components/ui';
import { useSettings } from '@/store/hooks';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * On-device app lock. When `settings.security.lock` is on the app content is
 * hidden and Face ID / Touch ID / the device passcode is required on a cold
 * start and after the app has been in the background longer than
 * `lockAfterMinutes`.
 *
 * The lock can never shut the user out of their own data: when biometrics are
 * missing, not enrolled, or unavailable (including on the web) the gate
 * unlocks and explains why instead of blocking.
 */

export const biometricsSupported = Platform.OS !== 'web';

type Availability = 'checking' | 'ready' | 'unavailable';

const PROMPT = 'Unlock Tanu';

export function LockGate({ children }: { children: ReactNode }) {
  const security = useSettings().security;
  const enabled = security.lock;
  const delayMinutes = Math.max(0, security.lockAfterMinutes ?? 0);

  // Cold start: locked straight away when the lock is on.
  const [locked, setLocked] = useState(enabled);
  const [availability, setAvailability] = useState<Availability>('checking');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');

  const enabledRef = useRef(enabled);
  const delayRef = useRef(delayMinutes);
  enabledRef.current = enabled;
  delayRef.current = delayMinutes;

  // Turning the lock off must release the gate immediately.
  useEffect(() => {
    if (!enabled) {
      setLocked(false);
      setMessage(null);
    }
  }, [enabled]);

  const unlock = useCallback((note: string | null = null) => {
    setLocked(false);
    setMessage(note);
  }, []);

  const authenticate = useCallback(
    async (passcodeFirst = false) => {
      setBusy(true);
      try {
        if (!biometricsSupported) {
          setAvailability('unavailable');
          setBusy(false);
          return;
        }
        const [hasHardware, enrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync(),
        ]);
        if (!hasHardware || !enrolled) {
          setAvailability('unavailable');
          unlock('This device has no Face ID, Touch ID or screen lock set up, so the app lock cannot be enforced. Add a device passcode to use it.');
          setBusy(false);
          return;
        }
        setAvailability('ready');
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: passcodeFirst ? 'Enter your device passcode' : PROMPT,
          cancelLabel: 'Cancel',
          fallbackLabel: 'Use device passcode',
          // Always leave the passcode route open so a failed scan is never a dead end.
          disableDeviceFallback: false,
        });
        if (result.success) unlock();
        else if (result.error === 'user_cancel' || result.error === 'system_cancel' || result.error === 'app_cancel') setMessage(null);
        else setMessage('That didn’t match. Try again, or use your device passcode.');
      } catch (e) {
        // The module is missing or the platform can't do this: never lock out.
        setAvailability('unavailable');
        unlock(`Couldn’t check your identity (${e instanceof Error ? e.message : 'unavailable'}), so the app was unlocked.`);
      } finally {
        setBusy(false);
      }
    },
    [unlock],
  );

  // Lock again after enough time in the background; track foreground state so
  // the app-switcher snapshot never shows balances.
  useEffect(() => {
    let leftAt: number | null = AppState.currentState === 'active' ? null : Date.now();
    const sub = AppState.addEventListener('change', (next) => {
      setForeground(next === 'active');
      if (next === 'active') {
        const since = leftAt;
        leftAt = null;
        if (enabledRef.current && since !== null && Date.now() - since >= delayRef.current * 60_000) {
          setLocked(true);
          setMessage(null);
        }
      } else if (leftAt === null) {
        leftAt = Date.now();
      }
    });
    return () => sub.remove();
  }, []);

  // Prompt as soon as the lock screen appears in the foreground, once.
  const prompted = useRef(false);
  useEffect(() => {
    if (!locked) {
      prompted.current = false;
      return;
    }
    if (!foreground || prompted.current) return;
    prompted.current = true;
    void authenticate();
  }, [locked, foreground, authenticate]);

  const hidden = locked || (enabled && !foreground);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Kept mounted so screen state survives a lock, but invisible and
          unreachable — including to screen readers — while hidden. */}
      <View
        style={{ flex: 1, opacity: hidden ? 0 : 1, pointerEvents: hidden ? 'none' : 'auto' }}
        accessibilityElementsHidden={hidden}
        importantForAccessibility={hidden ? 'no-hide-descendants' : 'auto'}
      >
        {children}
      </View>
      {hidden && (
        <View style={styles.cover}>
          {locked && (
            <LockScreen
              busy={busy}
              availability={availability}
              message={message}
              onUnlock={() => authenticate()}
              onPasscode={() => authenticate(true)}
              onWebUnlock={() => unlock()}
            />
          )}
        </View>
      )}
      {!!message && !locked && (
        <View style={styles.note}>
          <Banner tone="warning" icon="unlock" title="App lock" message={message} action={<Button label="Dismiss" size="sm" variant="ghost" onPress={() => setMessage(null)} />} />
        </View>
      )}
    </View>
  );
}

function LockScreen({
  busy,
  availability,
  message,
  onUnlock,
  onPasscode,
  onWebUnlock,
}: {
  busy: boolean;
  availability: Availability;
  message: string | null;
  onUnlock: () => void;
  onPasscode: () => void;
  onWebUnlock: () => void;
}) {
  const insets = useSafeAreaInsets();
  const web = !biometricsSupported;

  return (
    <View style={[styles.lock, { paddingTop: insets.top + spacing.xxxl, paddingBottom: Math.max(insets.bottom, spacing.xl) }]} accessibilityViewIsModal>
      <View style={{ alignItems: 'center', gap: spacing.lg }}>
        <View style={styles.badge}>
          <Feather name="lock" size={28} color={colors.primary} />
        </View>
        <Text variant="h1" align="center" accessibilityRole="header">
          Tanu is locked
        </Text>
        <Text align="center" color={colors.textSecondary}>
          {web
            ? 'Browsers have no Face ID or Touch ID. This screen only hides your balances — use the iOS or Android app for a real lock.'
            : 'Use Face ID, Touch ID or your device passcode to see your balances again.'}
        </Text>
        {!!message && <Banner tone="warning" icon="alert-triangle" title="Couldn’t unlock" message={message} />}
        {availability === 'unavailable' && !web && (
          <Banner tone="muted" icon="info" title="No biometrics available" message="This device has no enrolled Face ID, Touch ID or passcode." />
        )}
      </View>

      <View style={{ gap: spacing.sm, width: '100%' }}>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : web ? (
          <Button label="Unlock" icon="unlock" size="lg" fullWidth onPress={onWebUnlock} />
        ) : (
          <>
            <Button label="Unlock" icon="unlock" size="lg" fullWidth onPress={onUnlock} />
            <Button label="Use device passcode" variant="secondary" size="lg" fullWidth onPress={onPasscode} />
          </>
        )}
        <Text variant="caption" align="center" color={colors.textTertiary}>
          Your data never leaves this device. The lock is checked by the device itself.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background },
  lock: { flex: 1, justifyContent: 'space-between', paddingHorizontal: spacing.xl, gap: spacing.xxl },
  badge: {
    width: 64,
    height: 64,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  note: { position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.xxl },
});
