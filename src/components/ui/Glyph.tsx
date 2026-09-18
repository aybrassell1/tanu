import { memo } from 'react';
import { View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { BRAND_ICONS, EMOJI_ICONS } from '@/data/iconify.generated';
import { colors } from '@/theme/tokens';

const xmlCache = new Map<string, string>();

function xmlFor(kind: 'emoji' | 'brand', name: string, color?: string) {
  const key = `${kind}:${name}:${color ?? ''}`;
  let xml = xmlCache.get(key);
  if (!xml) {
    const icon = kind === 'emoji' ? EMOJI_ICONS[name] : BRAND_ICONS[name];
    if (!icon) return null;
    const body = kind === 'brand' ? icon.body.replace(/currentColor/g, color ?? colors.ink) : icon.body;
    xml = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${icon.width} ${icon.height}">${body}</svg>`;
    xmlCache.set(key, xml);
  }
  return xml;
}

/** Full-color illustration icon (Fluent Emoji Flat, embedded locally). */
export const EmojiIcon = memo(function EmojiIcon({ name, size = 24 }: { name: string; size?: number }) {
  const xml = xmlFor('emoji', name);
  if (!xml) return <View style={{ width: size, height: size }} />;
  return <SvgXml xml={xml} width={size} height={size} />;
});

/** Brand mark in its brand color (Simple Icons, embedded locally). */
export const BrandIcon = memo(function BrandIcon({ name, size = 22, color }: { name: string; size?: number; color?: string }) {
  const brand = BRAND_ICONS[name];
  const xml = brand ? xmlFor('brand', name, color ?? brand.color) : null;
  if (!xml) return <View style={{ width: size, height: size }} />;
  return <SvgXml xml={xml} width={size} height={size} />;
});

type VisualTileProps = { emoji?: string | null; brand?: string | null; size?: number; tint?: string };

/** Rounded tile with a brand mark or illustration; the visual counterpart of IconTile. */
export function VisualTile({ emoji, brand, size = 40, tint }: VisualTileProps) {
  const brandColor = brand ? BRAND_ICONS[brand]?.color : undefined;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.3,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: tint ?? (brandColor ? `${brandColor}14` : colors.surfaceMuted),
      }}
    >
      {brand ? <BrandIcon name={brand} size={Math.round(size * 0.5)} /> : emoji ? <EmojiIcon name={emoji} size={Math.round(size * 0.62)} /> : null}
    </View>
  );
}
