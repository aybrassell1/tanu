import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { accountOptions } from '@/components/finance/Pickers';
import { Banner, Button, Card, Disclosure, EmptyState, KeyValue, ListRow, Money, NavHeader, Pill, Row, Screen, Section, SelectField, SwitchRow, Text, TextField, useOverlay } from '@/components/ui';
import { balanceChecks, balanceDisagreements, bankBalanceOf } from '@/domain/balanceCheck';
import { ENTITY_COLORS } from '@/domain/catalog';
import { draftAccountFrom } from '@/domain/plaidAccounts';
import { relativePhrase } from '@/domain/dates';
import { isSandbox } from '@/domain/plaidSync';
import type { BankConnection, ConnectedAccount } from '@/domain/types';
import { accounts as fetchAccounts, exchange, institutionName, linkToken, PlaidError, type BankApi } from '@/lib/plaid';
import { linkSupported, openLink } from '@/lib/plaidLink';
import { enroll, installedAsApp, pushState, pushSupported, subscribe, unsubscribe, type PushState } from '@/lib/pushAlerts';
import { useData, useMoney, useSettings, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

/**
 * Banks you have connected, and the deployment that lets you.
 *
 * Nothing here holds a bank password: sign-in happens inside Plaid's own frame,
 * and what comes back is a token that only works alongside the secret on your
 * server. Transactions still arrive as a list you approve, exactly like the
 * CSV importer.
 */
export default function ConnectScreen() {
  const router = useRouter();
  const data = useData();
  const settings = useSettings();
  const today = useToday();
  const { confirm, toast } = useOverlay();
  const money = useMoney();

  const saved = settings.bankApi;
  const [url, setUrl] = useState(saved?.url ?? '');
  const [key, setKey] = useState(saved?.key ?? '');
  const [vapid, setVapid] = useState(saved?.vapidPublicKey ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<PushState>('unsupported');
  const [error, setError] = useState<string | null>(null);

  const api: BankApi | null = saved?.url && saved.key ? saved : null;
  const checks = useMemo(() => balanceChecks(data, today), [data, today]);
  const off = balanceDisagreements(checks);
  const options = useMemo(() => accountOptions(data, today), [data, today]);

  /**
   * Creates the account from what the bank said and points the connection at
   * it. It opens at the balance the bank reports, so the number is right
   * immediately; history that arrives later still shows in reports.
   */
  const createAndMap = (connection: BankConnection, account: ConnectedAccount) => {
    const color = ENTITY_COLORS[data.accounts.length % ENTITY_COLORS.length];
    const result = ledger.saveAccount(draftAccountFrom(account, today, color));
    if (!result.ok) return setError(Object.values(result.errors)[0] ?? 'That account could not be created.');
    ledger.mapConnectionAccount(connection.id, account.externalId, result.id);
    toast({ message: `${account.name} added`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  useEffect(() => {
    void pushState().then(setAlerts);
  }, []);

  /**
   * Turning this on hands the server your access token, encrypted, so it can
   * say what you were charged rather than only that something happened.
   * Turning it off deletes that record for every bank.
   */
  const toggleAlerts = async (on: boolean) => {
    if (!api) return;
    setBusy('alerts');
    setError(null);
    try {
      if (!on) {
        for (const connection of data.connections) await enroll(api, connection, null);
        await unsubscribe();
        ledger.updateSettings({ transactionAlerts: false });
        setAlerts('off');
        toast({ message: 'Notifications off, and the server has forgotten your banks' });
        return;
      }
      if (!api.vapidPublicKey) {
        setError('Add the VAPID public key from your server before turning notifications on.');
        return;
      }
      const subscription = await subscribe(api.vapidPublicKey);
      if (!subscription) {
        setAlerts(await pushState());
        return;
      }
      for (const connection of data.connections) await enroll(api, connection, subscription);
      ledger.updateSettings({ transactionAlerts: true });
      setAlerts('on');
      toast({ message: 'Your phone will say when money moves' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That could not be set up.');
    } finally {
      setBusy(null);
    }
  };

  const saveApi = () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed || !key.trim()) return setError('Both the address and the key are needed.');
    ledger.updateSettings({ bankApi: { url: trimmed, key: key.trim(), vapidPublicKey: vapid.trim() || undefined } });
    setError(null);
    toast({ message: 'Server saved' });
  };

  const forgetApi = async () => {
    if (!(await confirm({ title: 'Forget this server?', message: 'Connected banks stay, but nothing can sync until you add it again.', confirmLabel: 'Forget', destructive: true }))) return;
    ledger.updateSettings({ bankApi: undefined });
    toast({ message: 'Server forgotten', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const connect = async () => {
    if (!api) return;
    setError(null);
    setBusy('connect');
    try {
      const token = await linkToken(api, deviceUserId(data.meta.createdAt));
      const publicToken = await openLink(token);
      if (!publicToken) return;
      const { access_token, item_id } = await exchange(api, publicToken);
      const info = await fetchAccounts(api, access_token);
      const name = (info.item.institution_id ? await institutionName(api, info.item.institution_id).catch(() => undefined) : undefined) ?? 'Your bank';
      const result = ledger.saveConnection({
        itemId: item_id,
        institutionName: name,
        accessToken: access_token,
        // The balances come with this call, so an account made from one of
        // these opens at the right number rather than at zero.
        accounts: info.accounts.map((a) => ({
          externalId: a.account_id,
          name: a.official_name || a.name,
          mask: a.mask ?? undefined,
          type: a.type,
          subtype: a.subtype ?? undefined,
          lastBalance: bankBalanceOf(a.balances),
          lastBalanceAt: new Date().toISOString(),
        })),
      });
      if (result.ok) toast({ message: `${name} connected — now point its accounts at yours` });
    } catch (e) {
      setError(e instanceof PlaidError ? e.message : 'Something went wrong connecting that bank.');
    } finally {
      setBusy(null);
    }
  };

  const repair = async (connection: BankConnection) => {
    if (!api) return;
    setBusy(connection.id);
    try {
      const token = await linkToken(api, deviceUserId(data.meta.createdAt), connection.accessToken);
      await openLink(token);
      ledger.flagConnection(connection.id, undefined);
      toast({ message: `${connection.institutionName} reconnected` });
    } catch (e) {
      setError(e instanceof PlaidError ? e.message : 'That bank could not be reconnected.');
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async (connection: BankConnection) => {
    if (!(await confirm({ title: `Disconnect ${connection.institutionName}?`, message: 'Transactions already imported stay. Nothing new will arrive.', confirmLabel: 'Disconnect', destructive: true }))) return;
    ledger.deleteConnection(connection.id);
    toast({ message: 'Bank disconnected', actionLabel: 'Undo', onAction: ledger.undo });
  };

  const reconcile = (accountId: string, name: string, balance: number) => {
    const result = ledger.updateBalance(accountId, balance, today, 'reconcile', 'From your bank');
    if (result.ok) toast({ message: `${name} set to what the bank says`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  const removeImported = async (connection: BankConnection, count: number) => {
    const ok = await confirm({
      title: `Remove ${count} imported ${count === 1 ? 'transaction' : 'transactions'}?`,
      message: `Everything ${connection.institutionName} put in goes. Anything you typed yourself stays.`,
      confirmLabel: 'Remove them',
      destructive: true,
    });
    if (!ok) return;
    const result = ledger.removeConnectionTransactions(connection.id);
    if (result.ok) toast({ message: `Removed ${result.id}`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Screen header={<NavHeader title="Connected accounts" />}>
      {!linkSupported() && (
        <Banner tone="warning" icon="alert-circle" title="Open this on the web" message="Bank sign-in runs in Plaid's own page, which needs the browser version of Tanu." />
      )}

      {!api ? (
        <>
          <Banner
            tone="primary"
            icon="server"
            title="One deployment of your own, first"
            message="Plaid's secret can't live in the app, so it lives in a small function you deploy for free. Its address and key go here. Setup steps are in server/plaid-api/README.md."
          />
          <Section title="Your server">
            <Card style={{ gap: spacing.md }}>
              <TextField label="Address" value={url} onChangeText={setUrl} placeholder="https://your-project.vercel.app" autoCapitalize="none" keyboardType="url" />
              <TextField label="Key" value={key} onChangeText={setKey} placeholder="The APP_KEY you set" autoCapitalize="none" secureTextEntry error={error ?? undefined} />
              <TextField
                label="Notification key"
                value={vapid}
                onChangeText={setVapid}
                placeholder="VAPID_PUBLIC_KEY"
                autoCapitalize="none"
                hint="Only needed for notifications. Safe to share: it identifies your server, it does not authorise anything."
                optional
              />
              <Button label="Save" size="lg" fullWidth onPress={saveApi} />
            </Card>
          </Section>
        </>
      ) : (
        <>
          {error && <Banner tone="negative" icon="alert-triangle" title="That didn't work" message={error} />}

          <Section title="Banks" subtitle={data.connections.length === 0 ? undefined : `${data.connections.length} connected`}>
            {data.connections.length === 0 ? (
              <EmptyState
                icon="link"
                title="No banks yet"
                message="Connect one and its transactions arrive as a list you approve — never written to your ledger behind your back."
                actionLabel={busy === 'connect' ? 'Opening…' : 'Connect a bank'}
                onAction={connect}
              />
            ) : (
              data.connections.map((connection) => {
                const mapped = connection.accounts.filter((a) => a.accountId).length;
                const imported = data.transactions.filter((t) => t.connectionId === connection.id).length;
                return (
                  <Card key={connection.id} style={{ gap: spacing.sm }}>
                    <ListRow
                      icon="home"
                      title={connection.institutionName}
                      subtitle={connection.lastSyncedAt ? `Synced ${relativePhrase(connection.lastSyncedAt.slice(0, 10), today)} · ${mapped} of ${connection.accounts.length} accounts` : `${mapped} of ${connection.accounts.length} accounts linked`}
                      trailing={<Pill size="sm" tone={connection.needsAttention ? 'negative' : mapped > 0 ? 'positive' : 'muted'} label={connection.needsAttention ? 'Needs sign-in' : mapped > 0 ? 'Ready' : 'Set up'} />}
                    />
                    {isSandbox(connection.accessToken) && (
                      <Banner
                        tone="warning"
                        icon="alert-triangle"
                        title="Test bank — the money here is invented"
                        message="Fine for checking the wiring. Don't file these into a real account: a week later they look exactly like charges you made. Switch the server to production when you're ready for your own bank."
                      />
                    )}
                    {!!connection.needsAttention && (
                      <Banner tone="warning" icon="alert-circle" title="This bank wants you to sign in again" message={connection.needsAttention} />
                    )}

                    <Disclosure label="Which account is which" initiallyOpen={mapped === 0}>
                      <View style={{ gap: spacing.md }}>
                        {connection.accounts.map((a) => (
                          <View key={a.externalId} style={{ gap: 6 }}>
                            <SelectField
                              label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`}
                              hint={`${a.type}${a.subtype ? ` · ${a.subtype}` : ''}`}
                              value={a.accountId}
                              options={options}
                              onChange={(id) => ledger.mapConnectionAccount(connection.id, a.externalId, id)}
                              placeholder={options.length === 0 ? 'No accounts here yet' : "Don't sync this one"}
                              optional
                            />
                            {!a.accountId && (
                              <Button
                                label={`Add "${a.name}" as a new account`}
                                icon="plus"
                                variant="ghost"
                                size="sm"
                                onPress={() => createAndMap(connection, a)}
                              />
                            )}
                          </View>
                        ))}
                        <Text variant="caption" color={colors.textTertiary}>
                          An account you leave unlinked is ignored entirely. Nothing from it is imported.
                        </Text>
                      </View>
                    </Disclosure>

                    <Row>
                      <Button label="Sync" icon="refresh-cw" size="sm" style={{ flex: 1 }} onPress={() => router.push(`/connect/${connection.id}`)} />
                      <Button label={busy === connection.id ? 'Opening…' : 'Reconnect'} variant="ghost" size="sm" onPress={() => repair(connection)} />
                      <Button label="Remove" variant="ghost" size="sm" onPress={() => disconnect(connection)} />
                    </Row>
                    {imported > 0 && (
                      <Button
                        label={`Take back the ${imported} it imported`}
                        icon="rotate-ccw"
                        variant="ghost"
                        size="sm"
                        onPress={() => removeImported(connection, imported)}
                      />
                    )}
                  </Card>
                );
              })
            )}
            {data.connections.length > 0 && (
              <Button label={busy === 'connect' ? 'Opening…' : 'Connect another bank'} icon="plus" variant="secondary" fullWidth onPress={connect} />
            )}
          </Section>

          {checks.length > 0 && (
            <Section title="What your bank says">
              <Card style={{ gap: spacing.sm }}>
                {checks.map((check) => (
                  <View key={`${check.connectionId}:${check.externalId}`} style={{ gap: 4 }}>
                    <KeyValue
                      label={check.accountName}
                      hint={check.agrees ? 'Matches' : `Off by ${money(Math.abs(check.difference))}`}
                    >
                      <View style={{ alignItems: 'flex-end' }}>
                        <Money cents={check.bank} weight="semibold" />
                        <Text variant="caption" color={colors.textTertiary}>
                          {check.agrees ? 'agreed' : `app says ${money(check.derived)}`}
                        </Text>
                      </View>
                    </KeyValue>
                    {!check.agrees && (
                      <Button
                        label={`Record the ${money(Math.abs(check.difference))} difference`}
                        icon="check"
                        variant="ghost"
                        size="sm"
                        onPress={() => reconcile(check.accountId, check.accountName, check.bank)}
                      />
                    )}
                  </View>
                ))}
                {off.checks.length > 0 && (
                  <Text variant="caption" color={colors.textTertiary}>
                    A difference usually means something never came across — a fee, a pending charge, or a starting balance that was a guess. Recording it adds one adjustment, which you can undo.
                  </Text>
                )}
              </Card>
            </Section>
          )}

          {data.connections.length > 0 && (
            <Section title="How much it does on its own">
              <Card style={{ gap: spacing.sm }}>
                <SwitchRow
                  label="Catch up when I open the app"
                  description="There is no background sync on a phone, so this is the moment it can look."
                  value={settings.autoSync?.onOpen ?? true}
                  onChange={(v) => ledger.updateSettings({ autoSync: { onOpen: v, autoAdd: settings.autoSync?.autoAdd ?? true } })}
                />
                <SwitchRow
                  label="Add what it finds"
                  description="Off, and new transactions wait on the sync screen for you to approve."
                  value={settings.autoSync?.autoAdd ?? true}
                  onChange={(v) => ledger.updateSettings({ autoSync: { onOpen: settings.autoSync?.onOpen ?? true, autoAdd: v } })}
                />
                <Text variant="caption" color={colors.textTertiary}>
                  Either way a sync is a single undo, and everything it adds shows up in Activity like anything else.
                </Text>
              </Card>
            </Section>
          )}

          {data.connections.length > 0 && pushSupported() && (
            <Section title="Telling you when money moves">
              <Card style={{ gap: spacing.sm }}>
                {!installedAsApp() ? (
                  <Banner
                    tone="muted"
                    icon="smartphone"
                    title="Add Tanu to your home screen first"
                    message="iOS only allows notifications from an installed app, never from a browser tab. Share → Add to Home Screen, then open it from there."
                  />
                ) : alerts === 'denied' ? (
                  <Banner
                    tone="warning"
                    icon="bell-off"
                    title="Notifications are blocked"
                    message="Turn them back on for Tanu in iOS Settings → Notifications, then come back here."
                  />
                ) : (
                  <>
                    <SwitchRow
                      label={busy === 'alerts' ? 'Just a moment…' : 'Notify me when a charge arrives'}
                      description="Your bank tells the server, the server tells your phone. Works with the app closed."
                      value={alerts === 'on'}
                      onChange={(v) => void toggleAlerts(v)}
                    />
                    <Banner
                      tone={alerts === 'on' ? 'muted' : 'primary'}
                      icon="alert-circle"
                      title="This one costs something"
                      message="To name the merchant and the amount, your server keeps your access token — encrypted, but able to read the account. Everything else here holds nothing. Turning this off deletes it."
                    />
                  </>
                )}
              </Card>
            </Section>
          )}

          <Section title="The server">
            <Card style={{ gap: spacing.sm }}>
              <ListRow icon="server" title={api.url.replace(/^https?:\/\//, '')} subtitle="Holds your Plaid secret. Stores nothing." />
              <Row>
                <Button label="Change" variant="ghost" size="sm" onPress={() => ledger.updateSettings({ bankApi: undefined })} />
                <Button label="Forget" variant="ghost" size="sm" onPress={forgetApi} />
              </Row>
            </Card>
          </Section>

          <Text variant="caption" color={colors.textTertiary}>
            Tanu never sees a bank password. Sign-in happens in Plaid's own page, and what comes back only works next to the secret on your server.
          </Text>
        </>
      )}
    </Screen>
  );
}


/** A stable id for Plaid that isn't anything about you. */
const deviceUserId = (createdAt: string) => `tanu-${createdAt.slice(0, 10).replace(/-/g, '')}`;
