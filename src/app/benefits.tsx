import { useRouter } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';

import {
  Banner,
  Button,
  Card,
  EmptyState,
  GradientCard,
  ListCard,
  ListRow,
  Money,
  NavHeader,
  NumberField,
  Pill,
  ProgressBar,
  Row,
  Screen,
  Section,
  Sheet,
  SplitBar,
  Stack,
  Text,
  useOverlay,
} from '@/components/ui';
import { EmojiIcon } from '@/components/ui/Glyph';
import { matchOverview, type MatchStatus } from '@/domain/benefits';
import { formatDate } from '@/domain/dates';
import { formatPercent } from '@/domain/money';
import type { ID, IncomeSource } from '@/domain/types';
import { useData, useDerived, useMoney, useToday } from '@/store/hooks';
import { ledger } from '@/store/ledger';
import { colors, spacing } from '@/theme/tokens';

const rate = (percent: number, digits = 1) => formatPercent(percent / 100, digits);

export default function BenefitsScreen() {
  const router = useRouter();
  const today = useToday();
  const year = Number(today.slice(0, 4));
  const overview = useDerived((d, t) => matchOverview(d, Number(t.slice(0, 4)), t));
  const [editing, setEditing] = useState<ID | null>(null);

  const nothingToShow = overview.sources.length === 0 && overview.withoutMatch.length === 0;
  const claimed = overview.projectedAvailable > 0 ? overview.projectedMatch / overview.projectedAvailable : 1;

  return (
    <Screen header={<NavHeader title="Employer match" />}>
      {nothingToShow ? (
        <EmptyState
          icon="briefcase"
          title="No income sources yet"
          message="Add where your pay comes from, then set the employer match to see how much of it you are capturing."
          actionLabel="Add income source"
          onAction={() => router.push('/income/edit')}
        />
      ) : (
        <GradientCard style={{ gap: spacing.md }}>
          <Row gap={spacing.sm}>
            <EmojiIcon name={overview.sources.length === 0 ? 'briefcase' : overview.onTrack ? 'party-popper' : 'money-with-wings'} size={28} />
            <Text variant="small" weight="medium" color={colors.onPrimary} style={{ flex: 1 }}>
              {overview.sources.length === 0 ? 'Employer match' : `Free money, ${year}`}
            </Text>
            {overview.sources.length > 0 && <Pill tone="glass" size="sm" label="Projected" icon="trending-up" />}
          </Row>
          {overview.sources.length === 0 ? (
            <>
              <Text variant="h2" color={colors.onPrimary}>
                No match set up yet
              </Text>
              <Text variant="small" color={colors.onPrimary}>
                Add what your employer matches below and this turns into real numbers.
              </Text>
            </>
          ) : overview.onTrack ? (
            <>
              <Text variant="h1" color={colors.onPrimary}>
                You&apos;re on track
              </Text>
              <Text variant="small" color={colors.onPrimary}>
                On course to collect the whole match by 31 December.
              </Text>
            </>
          ) : (
            <>
              <Money cents={overview.projectedMissed} variant="display" color={colors.onPrimary} />
              <Text variant="small" color={colors.onPrimary}>
                of employer match goes unclaimed this year if nothing changes.
              </Text>
            </>
          )}
          {overview.sources.length > 0 && (
            <>
              <SplitBar
                segments={[
                  { key: 'earned', value: overview.projectedMatch, color: colors.onPrimary },
                  { key: 'missed', value: overview.projectedMissed, color: colors.glassBorder },
                ]}
                height={10}
              />
              <Row gap={spacing.md}>
                <Text variant="caption" color={colors.onPrimary} style={{ flex: 1 }}>
                  {`${formatPercent(claimed)} of the year's match claimed`}
                </Text>
                <Text variant="caption" color={colors.onPrimary}>
                  Banked so far
                </Text>
                <Money cents={overview.matchEarnedYtd} variant="caption" weight="semibold" color={colors.onPrimary} />
              </Row>
            </>
          )}
        </GradientCard>
      )}

      {overview.sources.map((s) => (
        <MatchCard key={s.sourceId} status={s} onEdit={() => setEditing(s.sourceId)} />
      ))}

      {overview.withoutMatch.length > 0 && (
        <Section title="No match recorded" subtitle="Check your benefits portal — most employers match something">
          <ListCard>
            {overview.withoutMatch.map((s) => (
              <ListRow
                key={s.sourceId}
                title={s.name}
                subtitle={s.employer ?? 'Set what the employer matches'}
                leading={<EmojiIcon name="briefcase" size={28} />}
                trailing={<Pill label="Add match" tone="primary" size="sm" />}
                chevron
                onPress={() => setEditing(s.sourceId)}
              />
            ))}
          </ListCard>
        </Section>
      )}

      {editing && <MatchSheet sourceId={editing} onClose={() => setEditing(null)} />}
    </Screen>
  );
}



function MatchCard({ status, onEdit }: { status: MatchStatus; onEdit: () => void }) {
  const today = useToday();
  const money = useMoney();
  const match = status.match!;
  const scale = Math.max(match.upToPercent * 1.4, status.rateYtd * 1.1, 1);
  const perPaycheck = status.paychecks[status.paychecks.length - 1];

  return (
    <Card style={{ gap: spacing.md }} padding={spacing.xl}>
      <Row gap={spacing.sm}>
        <EmojiIcon name="bank" size={28} />
        <View style={{ flex: 1 }}>
          <Text variant="h3">{status.name}</Text>
          <Text variant="caption" color={colors.textTertiary}>
            {`${match.percent}% match on the first ${match.upToPercent}% of pay`}
          </Text>
        </View>
        <Pill label="Edit" icon="edit-2" size="sm" onPress={onEdit} accessibilityLabel={`Edit the match for ${status.name}`} />
      </Row>

      {/* Rate meter: your contribution against the rate that captures everything. */}
      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm}>
          <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }}>
            You contribute
          </Text>
          <Text variant="h3" tabular>
            {rate(status.rateYtd)}
          </Text>
        </Row>
        <ProgressBar
          value={status.rateYtd / scale}
          marker={match.upToPercent / scale}
          color={status.onTrack ? colors.positive : colors.warning}
          height={10}
          accessibilityLabel={`You contribute ${rate(status.rateYtd)} of pay; the full match needs ${rate(match.upToPercent, 0)}`}
        />
        <Text variant="caption" color={colors.textTertiary}>
          {status.onTrack
            ? `The mark is ${rate(match.upToPercent, 0)} — you are at or above it.`
            : `The mark is ${rate(match.upToPercent, 0)}. Raise your contribution by ${rate(Math.max(0, match.upToPercent - status.rateYtd))} of pay to reach it.`}
        </Text>
      </Stack>

      {/* The maths, on one line per step. */}
      <Card variant="muted" style={{ gap: spacing.sm }} padding={spacing.lg}>
        <MathRow emoji="dollar-banknote" label={`Gross pay since 1 Jan (${status.paychecks.length} paychecks)`} cents={status.grossYtd} />
        <MathRow emoji="money-bag" label={`× ${rate(status.rateYtd)} you defer`} cents={status.contributedYtd} />
        <MathRow
          emoji="handshake"
          label={`× ${match.percent}% matched on the first ${match.upToPercent}%`}
          cents={status.matchEarnedYtd}
          strong
        />
        {status.missedYtd > 0 && <MathRow emoji="money-with-wings" label="Match already gone" cents={status.missedYtd} tone={colors.negative} />}
        {perPaycheck && (
          <Text variant="caption" color={colors.textTertiary}>
            {`Last paycheck ${formatDate(perPaycheck.date, 'short', today)}: ${money(perPaycheck.gross)} gross · ${money(perPaycheck.contributed)} in · ${money(perPaycheck.matched)} matched`}
          </Text>
        )}
      </Card>

      <Stack gap={spacing.sm}>
        <Row gap={spacing.sm}>
          <Text variant="small" weight="semibold" style={{ flex: 1 }}>
            Rest of the year
          </Text>
          <Pill tone="projected" size="sm" label="Projected" icon="trending-up" />
        </Row>
        <SplitBar
          segments={[
            { key: 'earned', value: status.remainingMatch, color: colors.positive },
            { key: 'missed', value: status.remainingMissed, color: colors.negativeSoft },
          ]}
        />
        <Row gap={spacing.md}>
          <Text variant="caption" color={colors.textSecondary} style={{ flex: 1 }}>
            {status.upcomingPaychecks === 1
              ? `1 paycheck left at ${rate(status.currentRate)}`
              : `${status.upcomingPaychecks} paychecks left at ${rate(status.currentRate)}`}
          </Text>
          <Money cents={status.remainingMatch} variant="small" weight="semibold" color={colors.positive} />
          <Text variant="caption" color={colors.textTertiary}>
            {`of ${money(status.remainingAvailable)}`}
          </Text>
        </Row>
        <Text variant="caption" color={colors.textTertiary}>
          {`Still to earn between now and 31 December. Adds up to ${money(status.projectedMatch)} of ${money(status.projectedAvailable)} for the whole year.`}
        </Text>
      </Stack>

      {status.projectedMissed > 0 ? (
        <Banner
          tone="warning"
          icon="alert-circle"
          title={`${money(status.projectedMissed)} left on the table by December`}
          message={
            status.catchUpRate === null
              ? `Contribute ${rate(match.upToPercent, 0)} of pay next year to collect all of it.`
              : `Move to ${rate(match.upToPercent, 0)} to catch every future dollar, or ${rate(status.catchUpRate)} on the paychecks left if your plan trues up at year end.`
          }
        />
      ) : (
        <Banner tone="positive" icon="check-circle" title="Full match captured" message={`Keep contributing at least ${rate(match.upToPercent, 0)} of every paycheck.`} />
      )}

      {status.missingGross > 0 && (
        <Banner
          tone="muted"
          icon="info"
          title={`${status.missingGross} paychecks have no gross amount`}
          message="The match is sized from gross pay, so these are estimated from what landed in your account."
        />
      )}
    </Card>
  );
}

function MathRow({ emoji, label, cents, strong, tone }: { emoji: string; label: string; cents: number; strong?: boolean; tone?: string }) {
  return (
    <Row gap={spacing.sm}>
      <EmojiIcon name={emoji} size={18} />
      <Text variant="small" color={colors.textSecondary} style={{ flex: 1 }} numberOfLines={2}>
        {label}
      </Text>
      <Money cents={cents} variant={strong ? 'h3' : 'small'} weight="semibold" color={tone} />
    </Row>
  );
}

function MatchSheet({ sourceId, onClose }: { sourceId: ID; onClose: () => void }) {
  const data = useData();
  const { toast } = useOverlay();
  const source = data.incomeSources.find((s) => s.id === sourceId);
  const [percent, setPercent] = useState<number | undefined>(source?.match?.percent ?? 50);
  const [upTo, setUpTo] = useState<number | undefined>(source?.match?.upToPercent ?? 6);
  const [error, setError] = useState<string | undefined>();

  if (!source) return null;

  const save = (match: IncomeSource['match']) => {
    if (match && (!match.percent || !match.upToPercent)) return setError('Enter both percentages.');
    const { createdAt: _c, updatedAt: _u, ...rest } = source;
    const result = ledger.saveIncomeSource({ ...rest, match });
    if (!result.ok) return setError(Object.values(result.errors)[0]);
    onClose();
    toast({ message: match ? `Match saved for ${source.name}` : `Match removed from ${source.name}`, actionLabel: 'Undo', onAction: ledger.undo });
  };

  return (
    <Sheet
      visible
      onClose={onClose}
      title="Employer match"
      subtitle={source.employer ? `${source.name} · ${source.employer}` : source.name}
      footer={<Button label="Save match" size="lg" fullWidth onPress={() => save({ percent: percent ?? 0, upToPercent: upTo ?? 0 })} />}
    >
      <Card variant="muted" style={{ gap: spacing.xs }}>
        <Row gap={spacing.sm}>
          <EmojiIcon name="light-bulb" size={20} />
          <Text variant="small" weight="semibold" style={{ flex: 1 }}>
            {`"${percent ?? 0}% of the first ${upTo ?? 0}%"`}
          </Text>
        </Row>
        <Text variant="small" color={colors.textSecondary}>
          {`For every dollar you put in, your employer adds ${((percent ?? 0) / 100).toFixed(2)} — until you have contributed ${upTo ?? 0}% of your pay.`}
        </Text>
      </Card>
      <NumberField
        label="Employer pays"
        value={percent}
        onChange={(n) => {
          setPercent(n);
          setError(undefined);
        }}
        suffix="% of what you contribute"
        hint="50 for a half match, 100 for dollar-for-dollar."
        error={error}
      />
      <NumberField label="On the first" value={upTo} onChange={setUpTo} suffix="% of your pay" hint="The cap on the pay that gets matched." />
      {!!source.match && <Button label="Remove match" variant="secondary" fullWidth icon="trash-2" onPress={() => save(undefined)} />}
    </Sheet>
  );
}
