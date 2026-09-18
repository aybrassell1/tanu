import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, useFonts } from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';

import { OverlayProvider, useOverlay } from '@/components/ui';
import { LockGate } from '@/lib/lock';
import { useReminderSync } from '@/lib/notifications';
import { hydrateLedger, useLedgerStore } from '@/store/ledger';
import { colors } from '@/theme/tokens';

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  const hydrated = useLedgerStore((s) => s.hydrated);

  useEffect(() => {
    void hydrateLedger();
  }, []);

  if (!fontsLoaded || !hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator color={colors.primary} />
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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="welcome" options={{ gestureEnabled: false, animation: 'fade' }} />
          <Stack.Screen name="quick-add" options={{ presentation: 'modal' }} />
          {['transactions/edit', 'accounts/edit', 'bills/edit', 'income/edit', 'goals/edit', 'belongings/edit', 'policies/edit', 'ious/edit', 'sinking/edit'].map((name) => (
            <Stack.Screen key={name} name={name} options={{ presentation: 'modal' }} />
          ))}
        </Stack>
      </LockGate>
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
