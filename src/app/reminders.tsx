import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  IconTile,
  ListCard,
  MoneyField,
  NavHeader,
  NumberField,
  Pill,
  Screen,
  Section,
  SelectField,
  Stack,
  SwitchRow,
  Text,
} from '@/components/ui';
import { icon } from '@/data/icons';
import { formatDate, relativeDay } from '@/domain/dates';
import { MAX_REMINDERS, REMINDER_KINDS, clampHour, formatHour, plannedReminders } from '@/domain/reminders';
import type { NotificationSettings, SecuritySettings } from '@/domain/types';
import { biometricsSupported } from '@/lib/lock';
import { notificationsSupported, requestReminderPermission, useReminderStatus } from '@/lib/notifications';
import { useData, useDerived, useSettings, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: String(h), label: formatHour(h) }));

const LOCK_DELAYS = [
  { value: '0', label: 'Immediately' },
  { value: '1', label: 'After 1 minute' },
  { value: '5', label: 'After 5 minutes' },
  { value: '15', label: 'After 15 minutes' },
  { value: '30', label: 'After 30 minutes' },
  { value: '60', label: 'After 1 hour' },
];

const PREVIEW_COUNT = 6;

export default function RemindersScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const settings = useSettings();
  const status = useReminderStatus();
  const [checking, setChecking] = useState(false);

  const notifications = settings.notifications;
  const security = settings.security;
  const planned = useDerived(plannedReminders);

  const patchNotifications = (patch: Partial<NotificationSettings>) =>
    ledger.updateSettings({ notifications: { ...notifications, ...patch } });
  const patchSecurity = (patch: Partial<SecuritySettings>) => ledger.updateSettings({ security: { ...security, ...patch } });

  const recheck = async () => {
    setChecking(true);
    try {
      await requestReminderPermission(data, today);
    } finally {
      setChecking(false);
    }
  };

  const permissionBanner = () => {
    if (!notificationsSupported)
      return <Banner tone="muted" icon="monitor" title="Not available in the browser" message="Reminders are delivered by iOS or Android. The preview below still shows what the app would send." />;
    switch (status.permission) {
      case 'granted':
        return <Banner tone="positive" icon="check-circle" title="Notifications allowed" message={status.message} />;
      case 'denied':
        return (
          <Banner
            tone="warning"
            icon="bell-off"
            title="Notifications are blocked"
            message="Allow notifications for Tanu in your device settings, then check again."
            action={<Button label="Check again" size="sm" variant="secondary" loading={checking} onPress={recheck} />}
          />
        );
      default:
        return (
          <Banner
            tone="primary"
            icon="bell"
            title="Permission not granted yet"
            message={status.message}
            action={<Button label="Allow notifications" size="sm" onPress={recheck} loading={checking} />}
          />
        );
    }
  };

  return (
    <Screen header={<NavHeader title="Reminders & lock" />}>
      <Section title="Reminders">
        <Banner
          tone="positive"
          icon="shield"
          title="Scheduled on this device"
          message="Reminders are handed to your phone's own notification system. Nothing about your money is sent anywhere."
        />
        <Card>
          <SwitchRow
            label="Local reminders"
            description={notifications.enabled ? 'Turn every reminder below on or off.' : 'Turn this on to choose what you are reminded about.'}
            icon="bell"
            value={notifications.enabled}
            onChange={(enabled) => patchNotifications({ enabled })}
          />
        </Card>
        {notifications.enabled && permissionBanner()}
      </Section>

      {notifications.enabled && (
        <>
          <Section title="What to remind me about">
            <Stack gap={spacing.lg}>
              <NumberField
                label="Remind me before a bill is due"
                value={notifications.billsDaysBefore}
                onChange={(n) => patchNotifications({ billsDaysBefore: Math.min(30, Math.max(0, Math.round(n ?? 0))) })}
                suffix="days"
                integer
                hint="0 reminds you on the due date itself. Paid and skipped bills are never included."
              />
              <SelectField
                label="Time of day"
                value={String(clampHour(notifications.hour))}
                onChange={(v) => patchNotifications({ hour: clampHour(Number(v)) })}
                options={HOURS}
                sheetTitle="Reminder time"
                hint="All reminders arrive at this hour, in this device's time zone."
              />
              <Card>
                <SwitchRow
                  label="Payday reminders"
                  description="On the day a paycheck is expected to land."
                  icon="trending-up"
                  value={notifications.paydays}
                  onChange={(paydays) => patchNotifications({ paydays })}
                />
                <SwitchRow
                  label="Weekly review"
                  description="A weekly nudge to look back at spending and what's coming."
                  icon="calendar"
                  value={notifications.weeklyReview}
                  onChange={(weeklyReview) => patchNotifications({ weeklyReview })}
                />
              </Card>
              <MoneyField
                label="Warn me if cash may drop below"
                value={notifications.lowBalance}
                onChange={(cents) => patchNotifications({ lowBalance: cents && cents > 0 ? cents : undefined })}
                optional
                hint="Uses the cash forecast, so this is a projection rather than a real balance. Leave empty to skip it."
              />
            </Stack>
          </Section>

          <Section title="Next reminders" subtitle={`What the next two months look like right now (max ${MAX_REMINDERS}).`}>
            {planned.length === 0 ? (
              <EmptyState
                icon="bell-off"
                title="Nothing to remind you about"
                message="Add a bill, a paycheck or a low-balance warning and reminders will show up here."
                actionLabel="Add a bill"
                onAction={() => router.push('/bills/edit')}
                compact
              />
            ) : (
              <>
                {/* This is the notification word for word, so it wraps rather than clipping. */}
                <ListCard>
                  {planned.slice(0, PREVIEW_COUNT).map((reminder) => (
                    <View key={reminder.id} style={styles.previewRow}>
                      <IconTile icon={icon(REMINDER_KINDS[reminder.kind].icon, 'bell')} size={36} />
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text weight="medium" numberOfLines={2}>
                          {reminder.title}
                        </Text>
                        <Text variant="small" color={colors.textTertiary} numberOfLines={2}>
                          {reminder.body}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: 2 }}>
                        <Text variant="small" weight="medium">
                          {relativeDay(reminder.date, today)}
                        </Text>
                        <Text variant="caption" color={colors.textTertiary}>
                          {formatHour(reminder.hour)}
                        </Text>
                      </View>
                    </View>
                  ))}
                </ListCard>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' }}>
                  <Pill label="Projected" icon="clock" tone="projected" size="sm" />
                  <Text variant="small" color={colors.textTertiary}>
                    {planned.length} planned through {formatDate(planned[planned.length - 1].date, 'medium', today)}
                  </Text>
                </View>
              </>
            )}
          </Section>
        </>
      )}

      <Section title="App lock" subtitle="Keep balances behind Face ID, Touch ID or your device passcode.">
        {!biometricsSupported && (
          <Banner
            tone="muted"
            icon="monitor"
            title="Browsers have no biometrics"
            message="Here the lock only hides the screen behind an Unlock button. Use the iOS or Android app for a real lock."
          />
        )}
        <Card>
          <SwitchRow
            label="Require unlock"
            description="Asks on a cold start and after time in the background."
            icon="lock"
            value={security.lock}
            onChange={(lock) => patchSecurity({ lock })}
          />
        </Card>
        {security.lock && (
          <SelectField
            label="Lock when I come back"
            value={String(security.lockAfterMinutes)}
            onChange={(v) => patchSecurity({ lockAfterMinutes: Number(v) })}
            options={LOCK_DELAYS}
            sheetTitle="Lock after"
            hint="If Face ID, Touch ID and a passcode are all missing, the app unlocks and tells you why — you can never be shut out of your own data."
          />
        )}
      </Section>
    </Screen>
  );
}

const styles = StyleSheet.create({
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
});
