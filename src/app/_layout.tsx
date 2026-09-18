import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { OverlayProvider, useOverlay } from '@/components/ui';
import { Splash } from '@/components/ui/Splash';
import { LockGate } from '@/lib/lock';
import { useReminderSync } from '@/lib/notifications';
import { hydrateLedger, useLedgerStore } from '@/store/ledger';
import { applyTheme } from '@/theme/applyTheme';
import { motion } from '@/theme/motion';
import { colors } from '@/theme/tokens';

/**
 * The opening screen belongs to the session, not to a mount: a remount (a deep
 * link into a modal route, a fast refresh) must not replay it.
 */
let opened = false;

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const hydrated = useLedgerStore((s) => s.hydrated);
  // The blue opening screen covers the app until fonts and the ledger are in.
  const [opening, setOpening] = useState(!opened);
  const ready = fontsLoaded && hydrated;

  const theme = useLedgerStore((s) => s.data.settings.theme);

  const finishOpening = () => {
    opened = true;
    setOpening(false);
  };

  useEffect(() => {
    void hydrateLedger();
  }, []);

  // The chosen palette is part of the data, so it follows a restore or import.
  useEffect(() => {
    if (!opening) applyTheme(theme ?? 'system');
  }, [opening, theme]);

  if (!ready && opening) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.primary }}>
        <Splash ready={false} onDone={finishOpening} />
      </View>
    );
  }

  return (
    <OverlayProvider>
      <StatusBar style="dark" />
      <SaveErrorWatcher />
      <ReminderSync />
      {/* Hides every screen behind Face ID / Touch ID when the app lock is on. */}
      <LockGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            // Screens slide in; the whole app should feel like it moves, not blink.
            animation: 'slide_from_right',
            animationDuration: motion.screen,
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="welcome" options={{ gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="quick-add" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          {['transactions/edit', 'accounts/edit', 'bills/edit', 'income/edit', 'goals/edit', 'belongings/edit', 'policies/edit', 'ious/edit', 'sinking/edit'].map((name) => (
            <Stack.Screen key={name} name={name} options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
          ))}
        </Stack>
      </LockGate>
      {opening && <Splash ready={ready} onDone={finishOpening} />}
    </OverlayProvider>
  );
}

/** Keeps the device's scheduled reminders in step with the ledger. */
function ReminderSync() {
  useReminderSync();
  return null;
}

/** Surfaces storage failures on every screen, not just Home. */
function SaveErrorWatcher() {
  const saveError = useLedgerStore((s) => s.saveError);
  const { toast } = useOverlay();
  useEffect(() => {
    if (saveError) toast({ message: `Not saved: ${saveError}`, tone: 'error' });
  }, [saveError, toast]);
  return null;
}
