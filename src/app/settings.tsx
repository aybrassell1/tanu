import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  Field,
  KeyValue,
  ListCard,
  ListRow,
  MoneyField,
  NavHeader,
  NumberField,
  Screen,
  Section,
  Segmented,
  SelectField,
  Stack,
  SwitchRow,
  Text,
  useOverlay,
} from '@/components/ui';
import { backupFileName, countRecords, integrityWarnings, parseBackup, serializeBackup, transactionsCsv, transactionsFileName } from '@/domain/backup';
import { SCHEMA_VERSION } from '@/domain/factory';
import { exportTextFile, pickTextFile } from '@/store/fileIO';
import { useData, useSettings } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { applyTheme } from '@/theme/applyTheme';
import { storageDescription } from '@/store/storage';
import { colors, spacing } from '@/theme/tokens';

const CURRENCIES = [
  { value: 'USD', label: 'US dollar (USD)' },
  { value: 'CAD', label: 'Canadian dollar (CAD)' },
  { value: 'EUR', label: 'Euro (EUR)' },
  { value: 'GBP', label: 'British pound (GBP)' },
  { value: 'AUD', label: 'Australian dollar (AUD)' },
  { value: 'NZD', label: 'New Zealand dollar (NZD)' },
  { value: 'CHF', label: 'Swiss franc (CHF)' },
  { value: 'MXN', label: 'Mexican peso (MXN)' },
];

const LABELS: Record<string, string> = {
  accounts: 'Accounts',
  transactions: 'Transactions',
  recurring: 'Recurring payments',
  incomeSources: 'Income sources',
  goals: 'Goals',
  goalContributions: 'Goal contributions',
  assets: 'Assets',
  budgets: 'Budgets',
  categories: 'Categories',
  favorites: 'Favorites',
  scenarios: 'Scenarios',
};

export default function SettingsScreen() {
  const router = useRouter();
  const data = useData();
  const settings = useSettings();
  const { confirm, toast } = useOverlay();
  const [warnings, setWarnings] = useState<string[] | null>(null);
  const counts = countRecords(data);

  const run = async (label: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      toast({ message: `${label} failed: ${e instanceof Error ? e.message : 'unknown error'}`, tone: 'error' });
    }
  };

  const exportBackup = () =>
    run('Export', async () => {
      await exportTextFile(backupFileName(), serializeBackup(data), 'application/json');
      toast('Backup ready');
    });

  const exportCsv = () =>
    run('Export', async () => {
      await exportTextFile(transactionsFileName(), transactionsCsv(data), 'text/csv');
      toast('CSV ready');
    });

  const restore = () =>
    run('Restore', async () => {
      const file = await pickTextFile();
      if (!file) return;
      const result = parseBackup(file.text);
      const summary = Object.entries(result.counts)
        .filter(([k, n]) => n > 0 && k !== 'categories')
        .map(([k, n]) => `${n} ${LABELS[k]?.toLowerCase() ?? k}`)
        .join(', ');
      const ok = await confirm({
        title: 'Replace all data with this backup?',
        message: `${file.name} contains ${summary || 'no records'}.${result.warnings.length ? `\n\nWarnings: ${result.warnings.join(' ')}` : ''}\n\nEverything currently in the app will be replaced. Export a backup first if you might need it.`,
        confirmLabel: 'Replace data',
        destructive: true,
      });
      if (!ok) return;
      ledger.replaceAllData(result.data);
      toast({ message: 'Backup restored', actionLabel: 'Undo', onAction: ledger.undo });
    });

  const erase = async () => {
    const ok = await confirm({
      title: data.meta.isSample ? 'Erase sample data?' : 'Erase all financial data?',
      message: data.meta.isSample
        ? 'Removes every sample account, transaction and goal so you can start with a clean slate. Your preferences are kept.'
        : 'Deletes every account, transaction, bill, goal, asset and scenario on this device. Export a backup first if you might need it.',
      confirmLabel: 'Erase',
      destructive: true,
      typeToConfirm: data.meta.isSample ? undefined : 'erase',
    });
    if (!ok) return;
    ledger.eraseAllData();
    toast({ message: 'Data erased', actionLabel: 'Undo', onAction: ledger.undo });
    router.replace('/');
  };

  const loadSample = async () => {
    if (data.accounts.length > 0) {
      const ok = await confirm({ title: 'Replace your data with sample data?', message: 'Your current data will be replaced. You can undo right after.', confirmLabel: 'Load sample data', destructive: true });
      if (!ok) return;
    }
    ledger.loadSampleData();
    toast({ message: 'Sample data loaded', actionLabel: 'Undo', onAction: ledger.undo });
    router.replace('/');
  };

  return (
    <Screen header={<NavHeader title="Settings & data" />}>
      <Section title="Privacy">
        <Banner tone="positive" icon="lock" title="Your data stays on this device" message={`${storageDescription} Tanu never asks for bank credentials and doesn't send your financial information anywhere.`} />
        <Card>
          <SwitchRow label="Hide amounts" description="Mask balances and totals, e.g. when others can see your screen." icon="eye-off" value={settings.hideAmounts} onChange={(v) => ledger.updateSettings({ hideAmounts: v })} />
        </Card>
      </Section>

      <Section title="Backup & export" subtitle="Your data is never locked in. Backups are plain JSON.">
        <ListCard>
          <ListRow title="Export full backup" subtitle="Everything, restorable on any device" icon="download" chevron onPress={exportBackup} />
          <ListRow title="Export transactions as CSV" subtitle="Open in Excel, Numbers or Google Sheets" icon="file-text" chevron onPress={exportCsv} />
          <ListRow title="Import transactions (CSV)" subtitle="Add a bank or card statement to an account" icon="upload-cloud" chevron onPress={() => router.push('/import')} />
          <ListRow title="Restore from backup" subtitle="Replaces the data in this app" icon="upload" chevron onPress={restore} />
        </ListCard>
      </Section>

      <Section title="Preferences">
        <Stack gap={spacing.lg}>
          <Field label="Appearance" hint={Platform.OS === 'web' ? undefined : 'Reopen the app to change theme on this device.'}>
            <Segmented
              items={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
              value={settings.theme ?? 'system'}
              onChange={(theme) => {
                ledger.updateSettings({ theme });
                applyTheme(theme);
              }}
            />
          </Field>
          <SelectField label="Currency" value={settings.currency} onChange={(currency) => ledger.updateSettings({ currency })} options={CURRENCIES} hint="Changes how amounts are displayed. Existing amounts are not converted." />
          <Field label="Weeks start on">
            <Segmented items={[{ value: '0', label: 'Sunday' }, { value: '1', label: 'Monday' }]} value={String(settings.weekStartsOn) as '0' | '1'} onChange={(v) => ledger.updateSettings({ weekStartsOn: v === '1' ? 1 : 0 })} />
          </Field>
          <MoneyField label="Spending safety buffer" value={settings.spendingBuffer || undefined} onChange={(c) => ledger.updateSettings({ spendingBuffer: c ?? 0 })} optional hint="Kept out of 'available to spend' on the dashboard." />
          <NumberField label="Expected investment return" value={settings.investmentReturn} onChange={(n) => ledger.updateSettings({ investmentReturn: n ?? 0 })} suffix="% / year" hint="Only used for what-if scenario projections." />
        </Stack>
      </Section>

      <Section title="Organize">
        <ListCard>
          <ListRow title="Customize dashboard" subtitle="Reorder or hide cards" icon="sliders" chevron onPress={() => router.push('/dashboard-edit')} />
          <ListRow title="Categories" subtitle="Add, rename or archive" icon="tag" chevron onPress={() => router.push('/categories')} />
        </ListCard>
      </Section>

      <Section title="Your data">
        <ListCard>
          {Object.entries(counts)
            .filter(([k]) => LABELS[k])
            .map(([k, n]) => (
              <KeyValue key={k} label={LABELS[k]} value={String(n)} />
            ))}
        </ListCard>
        <Button
          label="Check data integrity"
          icon="check-square"
          variant="secondary"
          fullWidth
          onPress={() => setWarnings(integrityWarnings(data))}
        />
        {warnings && (warnings.length === 0 ? <Banner tone="positive" icon="check-circle" title="No problems found" message="Every transaction points to a valid account and all amounts are whole cents." /> : <Banner tone="warning" icon="alert-triangle" title="Problems found" message={warnings.join('\n')} />)}
      </Section>

      <Section title={data.meta.isSample ? 'Sample data' : 'Start over'}>
        <View style={{ gap: spacing.sm }}>
          {data.meta.isSample && <Banner tone="projected" icon="info" title="You're using sample data" message="Erase it to start tracking your real finances." />}
          <Button label={data.meta.isSample ? 'Erase sample data & start fresh' : 'Erase all data'} icon="trash-2" variant="danger" fullWidth onPress={erase} />
          {!data.meta.isSample && <Button label="Load sample data" variant="ghost" fullWidth onPress={loadSample} />}
        </View>
      </Section>

      <Text variant="caption" color={colors.textTertiary} align="center">
        Tanu · data format v{SCHEMA_VERSION}
      </Text>
    </Screen>
  );
}
