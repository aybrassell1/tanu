import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { accountOptions } from '@/components/finance/Pickers';
import { Banner, Button, Card, Disclosure, EmptyState, ListRow, NavHeader, Pill, Row, Screen, Section, SelectField, Text, TextField, useOverlay } from '@/components/ui';
import { relativePhrase } from '@/domain/dates';
import type { BankConnection } from '@/domain/types';
import { accounts as fetchAccounts, exchange, institutionName, linkSupported, linkToken, openLink, PlaidError, type BankApi } from '@/lib/plaid';
import { useData, useSettings, useToday } from '@/store/hooks';
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

  const saved = settings.bankApi;
  const [url, setUrl] = useState(saved?.url ?? '');
  const [key, setKey] = useState(saved?.key ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const api: BankApi | null = saved?.url && saved.key ? saved : null;
  const options = useMemo(() => accountOptions(data, today), [data, today]);

  const saveApi = () => {
    const trimmed = url.trim().replace(/\/+$/, '');
    if (!trimmed || !key.trim()) return setError('Both the address and the key are needed.');
    ledger.updateSettings({ bankApi: { url: trimmed, key: key.trim() } });
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
        accounts: info.accounts.map((a) => ({ externalId: a.account_id, name: a.official_name || a.name, mask: a.mask ?? undefined, type: a.type, subtype: a.subtype ?? undefined })),
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
              <TextField label="Address" value={url} onChangeText={setUrl} placeholder="https://tanu-plaid.vercel.app" autoCapitalize="none" keyboardType="url" />
              <TextField label="Key" value={key} onChangeText={setKey} placeholder="The APP_KEY you set" autoCapitalize="none" secureTextEntry error={error ?? undefined} />
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
                return (
                  <Card key={connection.id} style={{ gap: spacing.sm }}>
                    <ListRow
                      icon="home"
                      title={connection.institutionName}
                      subtitle={connection.lastSyncedAt ? `Synced ${relativePhrase(connection.lastSyncedAt.slice(0, 10), today)} · ${mapped} of ${connection.accounts.length} accounts` : `${mapped} of ${connection.accounts.length} accounts linked`}
                      trailing={<Pill size="sm" tone={connection.needsAttention ? 'negative' : mapped > 0 ? 'positive' : 'muted'} label={connection.needsAttention ? 'Needs sign-in' : mapped > 0 ? 'Ready' : 'Set up'} />}
                    />
                    {!!connection.needsAttention && (
                      <Banner tone="warning" icon="alert-circle" title="This bank wants you to sign in again" message={connection.needsAttention} />
                    )}

                    <Disclosure label="Which account is which" initiallyOpen={mapped === 0}>
                      <View style={{ gap: spacing.md }}>
                        {connection.accounts.map((a) => (
                          <SelectField
                            key={a.externalId}
                            label={`${a.name}${a.mask ? ` ••${a.mask}` : ''}`}
                            hint={`${a.type}${a.subtype ? ` · ${a.subtype}` : ''}`}
                            value={a.accountId}
                            options={options}
                            onChange={(id) => ledger.mapConnectionAccount(connection.id, a.externalId, id)}
                            placeholder="Don't sync this one"
                            optional
                          />
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
                  </Card>
                );
              })
            )}
            {data.connections.length > 0 && (
              <Button label={busy === 'connect' ? 'Opening…' : 'Connect another bank'} icon="plus" variant="secondary" fullWidth onPress={connect} />
            )}
          </Section>

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
