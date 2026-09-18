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
import { motion } from '@/theme/motion';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const hydrated = useLedgerStore((s) => s.hydrated);
  // The blue opening screen covers the app until fonts and the ledger are in.
  const [opening, setOpening] = useState(true);
  const ready = fontsLoaded && hydrated;

  useEffect(() => {
    void hydrateLedger();
  }, []);

  if (!ready && opening) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.primary }}>
        <Splash ready={false} onDone={() => setOpening(false)} />
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
      {opening && <Splash ready={ready} onDone={() => setOpening(false)} />}
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
