import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line, Path, Rect } from 'react-native-svg';

import { chart, colors, radius, spacing } from '@/theme/tokens';
import { Text } from '../Text';
import { linear, niceTicks } from './scale';

/**
 * Charts follow the dataviz specs: 2px lines, ≤24px bars with 4px rounded
 * data ends, hairline recessive grid, legend for 2+ series, text in ink
 * (never series color), a single y-axis, and a tap/drag readout.
 */

function useWidth(): [number, (e: LayoutChangeEvent) => void] {
  const [width, setWidth] = useState(0);
  return [width, (e) => setWidth(Math.round(e.nativeEvent.layout.width))];
}

// ─── Legend & tooltip ────────────────────────────────────────────────────────

export type LegendItem = { label: string; color: string; shape?: 'line' | 'dash' | 'rect' };

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <View style={styles.legend}>
      {items.map((item) => (
        <View key={item.label} style={styles.legendItem}>
          {item.shape === 'rect' ? (
            <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: item.color }} />
          ) : (
            <Svg width={16} height={4}>
              <Line x1={0} y1={2} x2={16} y2={2} stroke={item.color} strokeWidth={2} strokeDasharray={item.shape === 'dash' ? '4 3' : undefined} strokeLinecap="round" />
            </Svg>
          )}
          <Text variant="caption" color={colors.textSecondary}>
            {item.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Tooltip({ title, rows, x, width }: { title: string; rows: { label: string; value: string; color: string }[]; x: number; width: number }) {
  const boxWidth = 150;
  const left = Math.max(0, Math.min(width - boxWidth, x - boxWidth / 2));
  return (
    <View style={[styles.tooltip, { left, width: boxWidth, pointerEvents: 'none' }]}>
      <Text variant="caption" color={colors.onInkMuted}>
        {title}
      </Text>
      {rows.map((r) => (
        <View key={r.label} style={styles.tooltipRow}>
          <View style={{ width: 10, height: 2, backgroundColor: r.color, borderRadius: 1 }} />
          <Text variant="small" weight="semibold" color={colors.onInk} tabular>
            {r.value}
          </Text>
          <Text variant="caption" color={colors.onInkMuted} numberOfLines={1} style={{ flex: 1 }}>
            {r.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

// ─── Line chart ──────────────────────────────────────────────────────────────

export type LineSeries = {
  key: string;
  label: string;
  color: string;
  /** Points ordered by x. `null` y leaves a gap. */
  points: { x: number; y: number | null }[];
  dashed?: boolean;
  area?: boolean;
};

type LineChartProps = {
  series: LineSeries[];
  height?: number;
  formatY: (v: number) => string;
  formatX: (x: number) => string;
  /** A few x positions to label under the plot. */
  xTicks?: number[];
  /** Vertical marker, e.g. "Today" between actual and projected. */
  marker?: { x: number; label: string };
  showLegend?: boolean;
  /** Include zero in the y-domain (balances, net worth). */
  includeZero?: boolean;
  accessibilityLabel: string;
};

const PAD = { top: 12, right: 8, bottom: 22, left: 46 };

export function LineChart({ series, height = 180, formatY, formatX, xTicks, marker, showLegend, includeZero, accessibilityLabel }: LineChartProps) {
  const [width, onLayout] = useWidth();
  const [active, setActive] = useState<number | null>(null);
  const release = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (release.current) clearTimeout(release.current);
  }, []);

  const geo = useMemo(() => {
    const xs = series.flatMap((s) => s.points.map((p) => p.x));
    const ys = series.flatMap((s) => s.points.map((p) => p.y).filter((y): y is number => y !== null));
    if (!xs.length || !ys.length || width === 0) return null;
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const { min, max, ticks } = niceTicks(includeZero ? Math.min(0, ...ys) : Math.min(...ys), includeZero ? Math.max(0, ...ys) : Math.max(...ys));
    const sx = linear([xMin, xMax], [PAD.left, width - PAD.right]);
    const sy = linear([min, max], [height - PAD.bottom, PAD.top]);
    const allX = [...new Set(xs)].sort((a, b) => a - b);
    return { xMin, xMax, sx, sy, ticks, allX, min, max };
  }, [series, width, height, includeZero]);

  const pick = (e: GestureResponderEvent) => {
    if (release.current) clearTimeout(release.current);
    if (!geo) return;
    const px = e.nativeEvent.locationX;
    let best = geo.allX[0];
    for (const x of geo.allX) if (Math.abs(geo.sx(x) - px) < Math.abs(geo.sx(best) - px)) best = x;
    setActive(best);
  };

  const paths = geo
    ? series.map((s) => {
        let d = '';
        let area = '';
        let started = false;
        let first = 0;
        let last = 0;
        for (const p of s.points) {
          if (p.y === null) {
            started = false;
            continue;
          }
          const x = geo.sx(p.x);
          const y = geo.sy(p.y);
          d += `${started ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
          if (!started) first = x;
          last = x;
          started = true;
        }
        if (s.area && d) {
          const base = geo.sy(Math.max(geo.min, Math.min(0, geo.max)));
          area = `${d}L${last.toFixed(1)},${base}L${first.toFixed(1)},${base}Z`;
        }
        return { s, d, area };
      })
    : [];

  const activeRows =
    active === null
      ? []
      : series
          .map((s) => ({ s, p: s.points.find((p) => p.x === active) }))
          .filter((r) => r.p && r.p.y !== null)
          .map((r) => ({ label: r.s.label, value: formatY(r.p!.y!), color: r.s.color }));

  return (
    <View style={{ gap: spacing.sm }}>
      <View
        onLayout={onLayout}
        style={{ height }}
        accessible
        accessibilityLabel={accessibilityLabel}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={pick}
        onResponderMove={pick}
        onResponderRelease={() => {
          release.current = setTimeout(() => setActive(null), 1800);
        }}
      >
        {geo && (
          <Svg width={width} height={height} style={{ pointerEvents: 'none' }}>
            {geo.ticks.map((t) => (
              <Line key={t} x1={PAD.left} x2={width - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke={t === 0 && geo.min < 0 ? chart.axis : chart.grid} strokeWidth={1} />
            ))}
            {marker && marker.x >= geo.xMin && marker.x <= geo.xMax && (
              <Line x1={geo.sx(marker.x)} x2={geo.sx(marker.x)} y1={PAD.top} y2={height - PAD.bottom} stroke={chart.axis} strokeWidth={1} />
            )}
            {paths.map(({ s, area }) => (area ? <Path key={`${s.key}-area`} d={area} fill={s.color} opacity={0.1} /> : null))}
            {paths.map(({ s, d }) => (
              <Path key={s.key} d={d} stroke={s.color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? '5 4' : undefined} />
            ))}
            {active !== null && <Line x1={geo.sx(active)} x2={geo.sx(active)} y1={PAD.top} y2={height - PAD.bottom} stroke={colors.ink} strokeWidth={1} opacity={0.35} />}
            {active !== null &&
              series.map((s) => {
                const p = s.points.find((q) => q.x === active);
                if (!p || p.y === null) return null;
                return <Circle key={s.key} cx={geo.sx(active)} cy={geo.sy(p.y)} r={4} fill={s.color} stroke={colors.surface} strokeWidth={2} />;
              })}
            {/* End-point marker on each series. */}
            {active === null &&
              series.map((s) => {
                const last = [...s.points].reverse().find((p) => p.y !== null);
                if (!last || s.dashed) return null;
                return <Circle key={`${s.key}-end`} cx={geo.sx(last.x)} cy={geo.sy(last.y!)} r={4} fill={s.color} stroke={colors.surface} strokeWidth={2} />;
              })}
          </Svg>
        )}
        {geo && (
          <View style={[StyleSheet.absoluteFill, { pointerEvents: 'none' }]}>
            {geo.ticks.map((t) => (
              <Text key={t} variant="caption" color={chart.label} tabular style={[styles.yLabel, { top: geo.sy(t) - 7 }]} numberOfLines={1}>
                {formatY(t)}
              </Text>
            ))}
            {[...new Set((xTicks ?? [geo.xMin, geo.xMax]).filter((x) => x >= geo.xMin && x <= geo.xMax))].map((x, i, arr) => (
              <Text
                key={x}
                variant="caption"
                color={chart.label}
                style={[styles.xLabel, { left: Math.max(PAD.left - 30, Math.min(width - 70, geo.sx(x) - 30)), textAlign: i === 0 && arr.length > 1 ? 'left' : i === arr.length - 1 && arr.length > 1 ? 'right' : 'center' }]}
                numberOfLines={1}
              >
                {formatX(x)}
              </Text>
            ))}
            {marker && marker.x >= geo.xMin && marker.x <= geo.xMax && (
              <Text variant="caption" color={colors.textSecondary} style={[styles.markerLabel, { left: geo.sx(marker.x) + 4 }]}>
                {marker.label}
              </Text>
            )}
          </View>
        )}
        {geo && active !== null && activeRows.length > 0 && <Tooltip title={formatX(active)} rows={activeRows} x={geo.sx(active)} width={width} />}
      </View>
      {(showLegend ?? series.length > 1) && <Legend items={series.map((s) => ({ label: s.label, color: s.color, shape: s.dashed ? 'dash' : 'line' }))} />}
    </View>
  );
}

// ─── Column chart ────────────────────────────────────────────────────────────

export type ColumnDatum = { key: string; label: string; values: number[] };

type ColumnChartProps = {
  data: ColumnDatum[];
  series: { label: string; color: string }[];
  height?: number;
  formatY: (v: number) => string;
  /** Tooltip title per datum. */
  formatTitle?: (d: ColumnDatum) => string;
  highlightKey?: string;
  onSelect?: (d: ColumnDatum) => void;
  accessibilityLabel: string;
  /** Optional horizontal reference line (e.g. average or budget). */
  reference?: { value: number; label: string };
};

export function ColumnChart({ data, series, height = 170, formatY, formatTitle, highlightKey, onSelect, accessibilityLabel, reference }: ColumnChartProps) {
  const [width, onLayout] = useWidth();
  const [active, setActive] = useState<number | null>(null);

  const geo = useMemo(() => {
    if (!data.length || width === 0) return null;
    const values = data.flatMap((d) => d.values);
    if (reference) values.push(reference.value);
    const { min, max, ticks } = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 3);
    const sy = linear([min, max], [height - PAD.bottom, PAD.top]);
    const band = (width - PAD.left - PAD.right) / data.length;
    const groupWidth = Math.min(band * 0.72, series.length * 24 + (series.length - 1) * 2);
    const barWidth = (groupWidth - (series.length - 1) * 2) / series.length;
    return { sy, ticks, band, groupWidth, barWidth, zero: sy(0) };
  }, [data, width, height, series.length, reference]);

  const bar = (x: number, w: number, v: number) => {
    if (!geo || v === 0) return '';
    const y = geo.sy(v);
    const r = Math.min(4, w / 2, Math.abs(geo.zero - y));
    if (v > 0) return `M${x},${geo.zero}L${x},${y + r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y + r}L${x + w},${geo.zero}Z`;
    return `M${x},${geo.zero}L${x},${y - r}Q${x},${y} ${x + r},${y}L${x + w - r},${y}Q${x + w},${y} ${x + w},${y - r}L${x + w},${geo.zero}Z`;
  };

  const shown = active !== null ? data[active] : null;

  return (
    <View style={{ gap: spacing.sm }}>
      <View onLayout={onLayout} style={{ height }} accessibilityLabel={accessibilityLabel}>
        {geo && (
          <Svg width={width} height={height} style={{ pointerEvents: 'none' }}>
            {geo.ticks.map((t) => (
              <Line key={t} x1={PAD.left} x2={width - PAD.right} y1={geo.sy(t)} y2={geo.sy(t)} stroke={t === 0 ? chart.axis : chart.grid} strokeWidth={1} />
            ))}
            {data.map((d, i) => {
              const x0 = PAD.left + i * geo.band + (geo.band - geo.groupWidth) / 2;
              const dim = (active !== null && active !== i) || (highlightKey !== undefined && highlightKey !== d.key && active === null);
              return d.values.map((v, j) => (
                <Path key={`${d.key}-${j}`} d={bar(x0 + j * (geo.barWidth + 2), geo.barWidth, v)} fill={series[j].color} opacity={dim ? 0.45 : 1} />
              ));
            })}
            {reference && (
              <Line x1={PAD.left} x2={width - PAD.right} y1={geo.sy(reference.value)} y2={geo.sy(reference.value)} stroke={colors.ink} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
            )}
            {active !== null && <Rect x={PAD.left + active * geo.band} y={PAD.top} width={geo.band} height={height - PAD.top - PAD.bottom} fill={colors.ink} opacity={0.04} />}
          </Svg>
        )}
        {geo && (
          <View style={StyleSheet.absoluteFill}>
            {geo.ticks.map((t) => (
              <Text key={t} variant="caption" color={chart.label} tabular style={[styles.yLabel, { top: geo.sy(t) - 7 }]} numberOfLines={1}>
                {formatY(t)}
              </Text>
            ))}
            <View style={[styles.hitRow, { left: PAD.left, right: PAD.right }]}>
              {data.map((d, i) => (
                <Pressable
                  key={d.key}
                  style={{ flex: 1, height: '100%', justifyContent: 'flex-end' }}
                  onPress={() => {
                    setActive(active === i ? null : i);
                    onSelect?.(d);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatTitle?.(d) ?? d.label}: ${d.values.map((v, j) => `${series[j].label} ${formatY(v)}`).join(', ')}`}
                >
                  <Text variant="caption" align="center" color={highlightKey === d.key || active === i ? colors.ink : chart.label} numberOfLines={1} style={{ marginBottom: -PAD.bottom + 4 }}>
                    {d.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {reference && (
              <Text variant="caption" color={colors.textSecondary} style={[styles.refLabel, { top: geo.sy(reference.value) - 16 }]}>
                {reference.label}
              </Text>
            )}
          </View>
        )}
        {geo && shown && (
          <Tooltip
            title={formatTitle?.(shown) ?? shown.label}
            rows={shown.values.map((v, j) => ({ label: series[j].label, value: formatY(v), color: series[j].color }))}
            x={PAD.left + (active! + 0.5) * geo.band}
            width={width}
          />
        )}
      </View>
      {series.length > 1 && <Legend items={series.map((s) => ({ ...s, shape: 'rect' as const }))} />}
    </View>
  );
}

// ─── Horizontal bars ─────────────────────────────────────────────────────────

export type HBarItem = {
  key: string;
  label: string;
  value: number;
  valueLabel: string;
  color?: string;
  caption?: string;
  /** Prior-period value drawn as a tick for comparison. */
  compare?: number;
  onPress?: () => void;
  leading?: ReactNode;
};

/** Ranked bars with labels above: best for category breakdowns on narrow screens. */
export function HBarList({ items, max }: { items: HBarItem[]; max?: number }) {
  const top = max ?? Math.max(1, ...items.map((i) => Math.max(i.value, i.compare ?? 0)));
  return (
    <View style={{ gap: spacing.md }}>
      {items.map((item) => (
        <Pressable key={item.key} disabled={!item.onPress} onPress={item.onPress} accessibilityRole={item.onPress ? 'button' : undefined} style={{ gap: 6 }}>
          <View style={styles.hbarHeader}>
            {item.leading}
            <Text weight="medium" numberOfLines={1} style={{ flex: 1 }}>
              {item.label}
            </Text>
            <Text weight="semibold" tabular>
              {item.valueLabel}
            </Text>
          </View>
          <View style={styles.hbarTrack}>
            <View style={[styles.hbarFill, { width: `${Math.max(0, Math.min(1, item.value / top)) * 100}%`, backgroundColor: item.color ?? colors.primary }]} />
            {item.compare !== undefined && item.compare > 0 && <View style={[styles.hbarTick, { left: `${Math.min(1, item.compare / top) * 100}%` }]} />}
          </View>
          {!!item.caption && (
            <Text variant="caption" color={colors.textTertiary}>
              {item.caption}
            </Text>
          )}
        </Pressable>
      ))}
    </View>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────────

export function Sparkline({ values, color = colors.primary, height = 36, width = 96 }: { values: number[]; color?: string; height?: number; width?: number }) {
  if (values.length < 2) return <View style={{ width, height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const sx = linear([0, values.length - 1], [2, width - 6]);
  const sy = linear([min, max === min ? min + 1 : max], [height - 4, 4]);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join('');
  const lastX = sx(values.length - 1);
  const lastY = sy(values[values.length - 1]);
  return (
    <Svg width={width} height={height}>
      <Path d={d} stroke={color} strokeWidth={2} fill="none" strokeLinejoin="round" strokeLinecap="round" />
      <Circle cx={lastX} cy={lastY} r={3.5} fill={color} stroke={colors.surface} strokeWidth={2} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tooltip: { position: 'absolute', top: -4, backgroundColor: colors.ink, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, gap: 3 },
  tooltipRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  yLabel: { position: 'absolute', left: 0, width: PAD.left - 6, textAlign: 'right' },
  xLabel: { position: 'absolute', bottom: 0, width: 60 },
  markerLabel: { position: 'absolute', top: 0 },
  hitRow: { position: 'absolute', top: 0, bottom: PAD.bottom, flexDirection: 'row' },
  refLabel: { position: 'absolute', right: PAD.right },
  hbarHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hbarTrack: { height: 8, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken },
  hbarFill: { height: '100%', borderRadius: radius.pill },
  hbarTick: { position: 'absolute', top: -3, width: 2, height: 14, marginLeft: -1, backgroundColor: colors.ink, borderRadius: 1 },
});
