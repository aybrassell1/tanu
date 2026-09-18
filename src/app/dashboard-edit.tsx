import { StyleSheet, Switch, View } from 'react-native';

import { WIDGET_INFO } from '@/components/dashboard/Widgets';
import { Button, Card, IconButton, NavHeader, Screen, Text } from '@/components/ui';
import { DEFAULT_DASHBOARD } from '@/domain/factory';
import type { DashboardWidgetId } from '@/domain/types';
import { useSettings } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

export default function DashboardEditScreen() {
  const { dashboard } = useSettings();
  // Include widgets added in later versions that an older saved order lacks.
  const order = [...dashboard.order, ...DEFAULT_DASHBOARD.filter((id) => !dashboard.order.includes(id))];

  const move = (id: DashboardWidgetId, dir: -1 | 1) => {
    const i = order.indexOf(id);
    const j = i + dir;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    ledger.setDashboard(next, dashboard.hidden);
  };

  const toggle = (id: DashboardWidgetId, visible: boolean) =>
    ledger.setDashboard(order, visible ? dashboard.hidden.filter((x) => x !== id) : [...dashboard.hidden, id]);

  return (
    <Screen header={<NavHeader title="Customize dashboard" />}>
      <Text color={colors.textSecondary}>Choose which cards appear on Home and in what order. Everything stays available in its own section.</Text>
      <Card padding={spacing.md} style={{ paddingVertical: 4 }}>
        {order.map((id, i) => {
          const visible = !dashboard.hidden.includes(id);
          return (
            <View key={id} style={[styles.row, i > 0 && styles.divider]}>
              <View style={{ flex: 1, opacity: visible ? 1 : 0.5 }}>
                <Text weight="medium">{WIDGET_INFO[id].title}</Text>
                <Text variant="small" color={colors.textTertiary}>
                  {WIDGET_INFO[id].description}
                </Text>
              </View>
              <IconButton icon="arrow-up" size={32} variant="plain" accessibilityLabel={`Move ${WIDGET_INFO[id].title} up`} disabled={i === 0} onPress={() => move(id, -1)} />
              <IconButton icon="arrow-down" size={32} variant="plain" accessibilityLabel={`Move ${WIDGET_INFO[id].title} down`} disabled={i === order.length - 1} onPress={() => move(id, 1)} />
              <Switch value={visible} onValueChange={(v) => toggle(id, v)} trackColor={{ true: colors.primary, false: colors.track }} thumbColor={colors.surface} accessibilityLabel={`Show ${WIDGET_INFO[id].title}`} />
            </View>
          );
        })}
      </Card>
      <Button label="Reset to default" variant="secondary" fullWidth onPress={() => ledger.setDashboard([...DEFAULT_DASHBOARD], [])} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: 10 },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
});
