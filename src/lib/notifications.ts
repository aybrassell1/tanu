import * as Notifications from 'expo-notifications';
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import { plannedReminders, type PlannedReminder } from '@/domain/reminders';
import type { ISODate, LedgerData } from '@/domain/types';
import { useData, useToday } from '@/store/hooks';

/**
 * Local reminders. Everything is scheduled by the operating system on this
 * device from the plan in `domain/reminders`; no server is involved and no
 * data leaves the phone.
 *
 * Nothing in here ever throws: every entry point resolves to a
 * `ReminderStatus` the settings screen can show.
 */

export type ReminderPermission = 'granted' | 'denied' | 'unsupported' | 'unknown';

export interface ReminderStatus {
  permission: ReminderPermission;
  /** How many reminders are currently queued with the OS. */
  scheduled: number;
  /** One line explaining the current state, safe to show in the UI. */
  message: string;
  /** True while a sync is running. */
  syncing: boolean;
}

const CHANNEL_ID = 'reminders';
const IDLE: ReminderStatus = { permission: 'unknown', scheduled: 0, message: 'Reminders have not been set up yet.', syncing: false };

export const notificationsSupported = Platform.OS !== 'web';

// ─── Tiny store so the settings screen and the sync share one status ─────────

let status: ReminderStatus = IDLE;
let lastSignature = '';
let handlerInstalled = false;
const listeners = new Set<() => void>();

function setStatus(next: Partial<ReminderStatus>) {
  status = { ...status, ...next };
  for (const listen of listeners) listen();
}

function subscribe(listen: () => void) {
  listeners.add(listen);
  return () => listeners.delete(listen);
}

/** Current reminder/permission state, re-rendering when it changes. */
export function useReminderStatus(): ReminderStatus {
  return useSyncExternalStore(
    subscribe,
    () => status,
    () => status,
  );
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

/** The local instant a planned reminder should fire. */
export function reminderInstant(reminder: PlannedReminder): Date {
  const [year, month, day] = reminder.date.split('-').map(Number);
  return new Date(year, month - 1, day, reminder.hour, 0, 0, 0);
}

function installHandler() {
  if (handlerInstalled || !notificationsSupported) return;
  handlerInstalled = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

async function ensurePermission(request: boolean): Promise<ReminderPermission> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!request || current.canAskAgain === false) return 'denied';
  const asked = await Notifications.requestPermissionsAsync({
    ios: { allowAlert: true, allowBadge: false, allowSound: true },
  });
  return asked.granted ? 'granted' : 'denied';
}

function errorText(e: unknown) {
  return e instanceof Error ? e.message : 'unknown error';
}

export interface SyncOptions {
  /** Re-schedule even when the plan has not changed. */
  force?: boolean;
  /** Show the system permission prompt when it has not been answered yet. */
  request?: boolean;
}

/**
 * Cancels the reminders this app scheduled and queues the current plan.
 * Safe to call often: an unchanged plan is skipped unless `force` is set.
 */
export async function syncReminders(data: LedgerData, today: ISODate, options: SyncOptions = {}): Promise<ReminderStatus> {
  const { force = false, request = true } = options;

  if (!notificationsSupported) {
    setStatus({
      permission: 'unsupported',
      scheduled: 0,
      syncing: false,
      message: 'Reminders need the iOS or Android app. The browser version can still show the preview below.',
    });
    return status;
  }

  const planned = plannedReminders(data, today);
  const signature = `${today}|${JSON.stringify(planned)}`;
  if (!force && signature === lastSignature) return status;

  setStatus({ syncing: true });
  try {
    installHandler();

    if (!data.settings.notifications.enabled) {
      await Notifications.cancelAllScheduledNotificationsAsync();
      lastSignature = signature;
      setStatus({ scheduled: 0, syncing: false, message: 'Reminders are off. Nothing is scheduled on this device.' });
      return status;
    }

    const permission = await ensurePermission(request);
    if (permission !== 'granted') {
      await Notifications.cancelAllScheduledNotificationsAsync();
      lastSignature = '';
      setStatus({
        permission,
        scheduled: 0,
        syncing: false,
        message: 'Notifications are blocked for Tanu. Turn them on in your device settings, then tap Check again.',
      });
      return status;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
        name: 'Bills & paydays',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    await Notifications.cancelAllScheduledNotificationsAsync();

    const now = Date.now();
    let scheduled = 0;
    for (const reminder of planned) {
      const when = reminderInstant(reminder);
      // The hour may already have passed today; that reminder is simply dropped.
      if (when.getTime() <= now) continue;
      try {
        await Notifications.scheduleNotificationAsync({
          identifier: reminder.id,
          content: {
            title: reminder.title,
            body: reminder.body,
            sound: true,
            data: { kind: reminder.kind, id: reminder.id },
          },
          trigger: {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: when,
            ...(Platform.OS === 'android' ? { channelId: CHANNEL_ID } : null),
          },
        });
        scheduled++;
      } catch {
        // One bad reminder must never stop the rest.
      }
    }

    lastSignature = signature;
    setStatus({
      permission: 'granted',
      scheduled,
      syncing: false,
      message: scheduled
        ? `${scheduled} reminder${scheduled === 1 ? '' : 's'} queued on this device.`
        : 'Nothing to remind you about in the next two months.',
    });
    return status;
  } catch (e) {
    lastSignature = '';
    setStatus({ scheduled: 0, syncing: false, message: `Couldn't schedule reminders: ${errorText(e)}` });
    return status;
  }
}

/** Asks for permission from a button press, then re-schedules. */
export async function requestReminderPermission(data: LedgerData, today: ISODate): Promise<ReminderStatus> {
  if (!notificationsSupported) return syncReminders(data, today, { force: true });
  try {
    installHandler();
    await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: false, allowSound: true } });
  } catch {
    // Fall through: syncReminders reports whatever the real state is.
  }
  return syncReminders(data, today, { force: true, request: false });
}

/**
 * Keeps the OS queue in step with the ledger: on mount, whenever the plan
 * changes, and every time the app comes back to the foreground.
 * Mounted once, in the root layout.
 */
export function useReminderSync() {
  const data = useData();
  const today = useToday();
  const latest = useRef({ data, today });
  latest.current = { data, today };

  // The first sync must not pop a permission dialog on top of the app;
  // that only happens when the user turns reminders on themselves.
  const started = useRef(false);

  const run = useCallback((force: boolean) => {
    const { data: d, today: t } = latest.current;
    void syncReminders(d, t, { force, request: started.current });
    started.current = true;
  }, []);

  useEffect(() => {
    run(false);
  }, [run, data.settings.notifications, data.recurring, data.incomeSources, data.transactions, data.accounts, today]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run(true);
    });
    return () => sub.remove();
  }, [run]);
}
