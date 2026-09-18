import { Redirect, Tabs } from 'expo-router';

import { TabBar } from '@/components/TabBar';
import { useLedgerStore } from '@/store/ledger';

export default function TabsLayout() {
  const onboarded = useLedgerStore((s) => s.data.meta.onboarded);
  if (!onboarded) return <Redirect href="/welcome" />;

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="transactions" options={{ title: 'Activity' }} />
      <Tabs.Screen name="money" options={{ title: 'Money' }} />
      <Tabs.Screen name="more" options={{ title: 'More' }} />
    </Tabs>
  );
}
