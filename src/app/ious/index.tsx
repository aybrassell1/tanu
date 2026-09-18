import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { IouRow, PersonRow } from '@/components/ious/IouRow';
import {
  Banner,
  Button,
  Card,
  Disclosure,
  EmptyState,
  GradientCard,
  IconButton,
  ListCard,
  Money,
  NavHeader,
  Pill,
  Row,
  Screen,
  Section,
  Stack,
  Text,
} from '@/components/ui';
import { formatDate } from '@/domain/dates';
import { iouAging, iouBalance, iouSummary } from '@/domain/ious';
import { useData, useDerived, useMoney, useToday } from '@/store/hooks';
import { colors, spacing } from '@/theme/tokens';

const onGradient = 'rgba(255,255,255,0.85)';

export default function IousScreen() {
  const router = useRouter();
  const data = useData();
  const today = useToday();
  const money = useMoney();

  const model = useDerived((d, day) => {
    const summary = iouSummary(d, day);
    const settled = d.ious
      .filter((i) => i.archived || iouBalance(i).outstanding === 0)
      .sort((a, b) => ((a.settledOn ?? a.date) < (b.settledOn ?? b.date) ? 1 : -1));
    return { summary, settled, aging: iouAging(d, day).filter((b) => b.count > 0) };
  });

  const { summary, settled, aging } = model;
  const add = () => router.push('/ious/edit');
  const open = (id: string) => router.push(`/ious/${id}`);
  const header = <NavHeader title="IOUs" right={<IconButton icon="plus" accessibilityLabel="Add an IOU" onPress={add} />} />;

  if (data.ious.length === 0) {
    return (
      <Screen header={header}>
        <EmptyState
          icon="users"
          title="No IOUs yet"
          message="Keep track of money you lent to or borrowed from someone — splitting dinner, covering a ticket, borrowing from family. Your account balances are not affected."
          actionLabel="Add an IOU"
          onAction={add}
        />
      </Screen>
    );
  }

  const netLabel = summary.net > 0 ? 'in your favour' : summary.net < 0 ? 'you owe overall' : 'all square';

  return (
    <Screen header={header}>
      <GradientCard style={{ gap: spacing.md }}>
        <View style={{ gap: 2 }}>
          <Text variant="small" color={onGradient}>
            Net position
          </Text>
          <Money cents={Math.abs(summary.net)} variant="display" color={colors.onGradient} />
          <Text variant="small" color={onGradient}>
            {netLabel}
          </Text>
        </View>
        <Row gap={spacing.sm} style={{ flexWrap: 'wrap' }}>
          <Pill tone="glass" size="sm" icon="arrow-down-left" label={`${money(summary.owedToMe)} owed to you`} />
          <Pill tone="glass" size="sm" icon="arrow-up-right" label={`${money(summary.iOwe)} you owe`} />
        </Row>
      </GradientCard>

      <Banner
        tone="muted"
        icon="info"
        title="An IOU is a side ledger"
        message="It never changes an account balance on its own. When money really moves, record it from the IOU so it is counted once."
      />

      {summary.overdue.length > 0 && (
        <Banner
          tone="warning"
          icon="alert-triangle"
          title={summary.overdue.length === 1 ? '1 IOU is past its due date' : `${summary.overdue.length} IOUs are past their due date`}
          message={summary.overdue
            .slice(0, 3)
            .map((i) => `${i.person} · due ${formatDate(i.dueDate ?? i.date, 'short', today)}`)
            .join('\n')}
          action={<Button label="Open the oldest" size="sm" variant="secondary" onPress={() => open(summary.overdue[0].id)} />}
        />
      )}

      <Section title="Who owes whom" subtitle={summary.people.length === 1 ? '1 person with something open' : `${summary.people.length} people with something open`}>
        {summary.people.length === 0 ? (
          <EmptyState compact icon="check-circle" title="Everything is settled" message="Nothing is outstanding with anyone right now." actionLabel="Add an IOU" onAction={add} />
        ) : (
          <Stack gap={spacing.md}>
            {summary.people.map((person) => (
              <View key={person.person.toLowerCase()} style={{ gap: spacing.xs }}>
                <ListCard>
                  <PersonRow person={person} />
                </ListCard>
                <View style={{ paddingLeft: spacing.md }}>
                  <ListCard>
                    {person.ious.map((iou) => (
                      <IouRow key={iou.id} iou={iou} today={today} onPress={() => open(iou.id)} />
                    ))}
                  </ListCard>
                </View>
              </View>
            ))}
          </Stack>
        )}
      </Section>

      {aging.length > 0 && (
        <Section title="How long has this been outstanding?">
          <Card style={{ gap: spacing.md }}>
            {aging.map((bucket) => (
              <View key={bucket.bucket} style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text weight="medium">{bucket.label}</Text>
                  <Text variant="caption" color={colors.textTertiary}>
                    {`${bucket.count} ${bucket.count === 1 ? 'IOU' : 'IOUs'}`}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  {bucket.owedToMe > 0 && (
                    <Text variant="small" tabular>
                      {`${money(bucket.owedToMe)} owed to you`}
                    </Text>
                  )}
                  {bucket.iOwe > 0 && (
                    <Text variant="small" color={colors.textSecondary} tabular>
                      {`${money(bucket.iOwe)} you owe`}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </Card>
        </Section>
      )}

      {settled.length > 0 && (
        <Disclosure label="Settled" count={settled.length}>
          <ListCard>
            {settled.map((iou) => (
              <IouRow key={iou.id} iou={iou} today={today} showPerson onPress={() => open(iou.id)} />
            ))}
          </ListCard>
        </Disclosure>
      )}

      {summary.people.length > 0 && (
        <Text variant="caption" color={colors.textTertiary} align="center">
          Tap an IOU to record a repayment.
        </Text>
      )}
    </Screen>
  );
}
