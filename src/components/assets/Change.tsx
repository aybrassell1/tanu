import Feather from '@expo/vector-icons/Feather';
import { View } from 'react-native';

import { Text } from '@/components/ui';
import { formatPercent } from '@/domain/money';
import type { Asset, AssetValuation, Cents, ISODate } from '@/domain/types';
import { useMoney } from '@/store/hooks';
import { colors, type TypographyVariant } from '@/theme/tokens';

type ChangeLabelProps = {
  cents: Cents;
  /** Ratio (0.042 = 4.2%). Omitted or null hides the percentage. */
  pct?: number | null;
  /** Trailing words, e.g. "over 3 months". */
  suffix?: string;
  /** Leading words, e.g. "Equity". */
  prefix?: string;
  variant?: TypographyVariant;
  /** Override color (e.g. white on a gradient card). Arrow + sign still carry meaning. */
  color?: string;
  /** Ink text, arrow only tinted. */
  muted?: boolean;
};

/** "↗ +$1,240 (4.2%) over 3 months" — sign and arrow, never color alone. */
export function ChangeLabel({ cents, pct, suffix, prefix, variant = 'small', color, muted }: ChangeLabelProps) {
  const money = useMoney();
  const up = cents > 0;
  const down = cents < 0;
  const tone = color ?? (up ? colors.positive : down ? colors.negative : colors.textSecondary);
  const textColor = color ?? (muted ? colors.textSecondary : tone);
  const iconName = up ? 'arrow-up-right' : down ? 'arrow-down-right' : 'minus';
  const size = variant === 'caption' ? 11 : variant === 'small' ? 13 : 15;
  const pctText = pct === undefined || pct === null || !Number.isFinite(pct) ? '' : ` (${formatPercent(Math.abs(pct), 1)})`;
  const label = [prefix, `${money(cents, { signed: cents !== 0 })}${pctText}`, suffix].filter(Boolean).join(' ');
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }} accessibilityLabel={`${up ? 'Up' : down ? 'Down' : 'No change'} ${label}`}>
      <Feather name={iconName} size={size} color={tone} />
      <Text variant={variant} weight="medium" color={textColor} tabular numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </Text>
    </View>
  );
}

/** Latest valuation on or before `date` (ignores future-dated entries). */
export function latestValuation(asset: Asset, date: ISODate): AssetValuation | undefined {
  let best: AssetValuation | undefined;
  for (const v of asset.valuations) if (v.date <= date && (!best || v.date >= best.date)) best = v;
  return best;
}

export const isOwned = (asset: Asset, today: ISODate) => !asset.archived && !(asset.soldDate && asset.soldDate <= today);

export const yearStart = (today: ISODate): ISODate => `${today.slice(0, 4)}-01-01`;
