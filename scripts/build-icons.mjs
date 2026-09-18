/**
 * Downloads a curated set of icons from Iconify (https://iconify.design) and
 * embeds them in src/data/iconify.generated.ts so the app never fetches icons
 * at runtime (financial data and usage stay private).
 *
 * - Fluent Emoji Flat (MIT, Microsoft) for categories, accounts, goals, assets.
 * - Simple Icons (CC0) for merchant and subscription brand marks.
 *
 * Run: node scripts/build-icons.mjs
 */
import { writeFileSync } from 'node:fs';

const EMOJI = [
  'house', 'house-with-garden', 'houses', 'high-voltage', 'globe-with-meridians', 'mobile-phone', 'hammer-and-wrench', 'umbrella',
  'automobile', 'shield', 'fuel-pump', 'wrench', 'page-facing-up', 'p-button', 'motorway', 'bus', 'oncoming-taxi',
  'fork-and-knife-with-plate', 'shopping-cart', 'hamburger', 'hot-beverage', 'takeout-box', 'pizza',
  'stethoscope', 'tooth', 'glasses', 'pill', 'speech-balloon', 'flexed-biceps', 'medical-symbol', 'hospital',
  'clapper-board', 'video-game', 'popcorn', 'ticket', 'artist-palette', 'airplane', 'desert-island',
  'shopping-bags', 't-shirt', 'laptop', 'couch-and-lamp', 'lotion-bottle', 'wrapped-gift',
  'repeat-button', 'desktop-computer', 'television', 'identification-card',
  'bank', 'money-with-wings', 'receipt', 'classical-building', 'credit-card', 'chart-increasing', 'chart-decreasing', 'money-bag',
  'graduation-cap', 'books', 'memo', 'package', 'handshake', 'red-heart',
  'briefcase', 'alarm-clock', 'party-popper', 'convenience-store', 'label', 'dollar-banknote', 'coin',
  'key', 'bullseye', 'broken-chain', 'gem-stone', 'ring', 'trophy', 'seedling', 'deciduous-tree', 'bar-chart',
  'spiral-calendar', 'light-bulb', 'warning', 'check-mark-button', 'bell', 'crystal-ball', 'balance-scale', 'abacus',
  'hourglass-not-done', 'sparkles', 'rocket', 'thinking-face', 'locked', 'fire', 'droplet', 'framed-picture', 'direct-hit',
  // Expanded category taxonomy (src/domain/defaultCategories.ts)
  'closed-umbrella', 'wastebasket', 'electric-plug', 'sponge', 'potted-plant', 'mouse-trap', 'card-file-box', 'delivery-truck',
  'oncoming-automobile', 'battery', 'nut-and-bolt', 'wheel', 'magnifying-glass-tilted-left', 'bicycle', 'bubbles', 'sos-button', 'police-car-light',
  'fork-and-knife', 'beer-mug', 'cookie', 'bento-box', 'adhesive-bandage', 'test-tube', 'thermometer', 'leafy-green',
  'barber-pole', 'soap', 'lipstick', 'nail-polish', 'lotus', 'jeans', 'running-shoe', 'handbag', 'basket', 'safety-vest',
  'roll-of-paper', 'open-book', 'paperclip', 'yarn', 'soccer-ball', 'basketball', 'guitar', 'mirror-ball', 'rose', 'slot-machine',
  'luggage', 'airplane-departure', 'hotel', 'sport-utility-vehicle', 'camera-with-flash', 'umbrella-on-ground', 'passport-control', 'globe-showing-americas',
  'children-crossing', 'baby', 'child', 'school', 'backpack', 'ballet-shoes', 'teddy-bear', 'baby-bottle', 'socks', 'older-person',
  'paw-prints', 'bone', 'syringe', 'poodle', 'cat-face', 'dog', '1st-place-medal', 'heart-with-ribbon', 'manual-wheelchair', 'bed', 'locked-with-key',
  'headphone', 'cloud', 'newspaper', 'joystick', 'place-of-worship', 'christmas-tree', 'birthday-cake', 'people-hugging',
  'straight-ruler', 'printer', 'megaphone', 'construction-worker', 'clipboard', 'page-with-curl', 'telephone', 'office-building', 'postbox', 'chair',
  'atm-sign', 'calendar', 'tear-off-calendar', 'cityscape', 'bookmark-tabs', 'scroll', 'man-judge', 'world-map', 'pencil',
  'crown', 'beach-with-umbrella', 'open-hands', 'glowing-star',
  // Taxes hub
  'card-index-dividers', 'file-folder',
];

/** Brand mark → brand color (Simple Icons slugs). */
const BRANDS = {
  netflix: '#E50914', spotify: '#1DB954', icloud: '#3693F3', apple: '#000000', applemusic: '#FA243C', adobe: '#FF0000',
  adobecreativecloud: '#DA1F26', amazon: '#FF9900', youtube: '#FF0000', hulu: '#1CE783', hbo: '#000000', max: '#002BE7',
  paramountplus: '#0064FF', audible: '#F8991C', duolingo: '#58CC02', openai: '#412991', crunchyroll: '#F47521', twitch: '#9146FF',
  patreon: '#000000', dropbox: '#0061FF', googledrive: '#4285F4', notion: '#000000', canva: '#00C4CC', figma: '#F24E1E',
  peloton: '#181A1D', '1password': '#3B66BC', xbox: '#107C10', playstation: '#0070D1', nintendo: '#E60012', steam: '#000000',
  epicgames: '#313131', uber: '#000000', ubereats: '#06C167', lyft: '#FF00BF', doordash: '#FF3008', instacart: '#43B02A',
  starbucks: '#006241', mcdonalds: '#FBC817', burgerking: '#D62300', tacobell: '#38096C', target: '#CC0000', walmart: '#0071CE',
  ikea: '#0058A3', etsy: '#F16521', ebay: '#E53238', nike: '#111111', uniqlo: '#FF0000', zara: '#000000', autozone: '#D52B1E',
  shell: '#FFD500', airbnb: '#FF5A5F', southwestairlines: '#304CB2', delta: '#003366', hilton: '#124D97', marriott: '#A70023',
  ticketmaster: '#026CDF', verizon: '#CD040B', spectrum: '#0078E6', samsung: '#1428A0', robinhood: '#CCFF00', coinbase: '#0052FF',
  paypal: '#003087', venmo: '#008CFF', cashapp: '#00C244', zelle: '#6D1ED4', visa: '#1A1F71', mastercard: '#EB001B',
  americanexpress: '#2E77BC', discover: '#FF6000', chase: '#117ACA', wellsfargo: '#D71E28', bankofamerica: '#012169',
};

async function fetchSet(prefix, names) {
  const res = await fetch(`https://api.iconify.design/${prefix}.json?icons=${names.join(',')}`);
  if (!res.ok) throw new Error(`${prefix}: HTTP ${res.status}`);
  const json = await res.json();
  if (json.not_found?.length) console.warn(`${prefix} missing:`, json.not_found.join(', '));
  const out = {};
  for (const [name, icon] of Object.entries(json.icons)) {
    out[name] = { body: icon.body, width: icon.width ?? json.width ?? 24, height: icon.height ?? json.height ?? 24 };
  }
  return out;
}

const emoji = await fetchSet('fluent-emoji-flat', EMOJI);
const brandIcons = await fetchSet('simple-icons', Object.keys(BRANDS));
const brands = Object.fromEntries(Object.entries(brandIcons).map(([k, v]) => [k, { ...v, color: BRANDS[k] }]));

const file = `// Generated by scripts/build-icons.mjs — do not edit by hand.
// Fluent Emoji Flat © Microsoft (MIT). Simple Icons (CC0 1.0).

export type IconData = { body: string; width: number; height: number };

export const EMOJI_ICONS: Record<string, IconData> = ${JSON.stringify(emoji)};

export const BRAND_ICONS: Record<string, IconData & { color: string }> = ${JSON.stringify(brands)};
`;
writeFileSync(new URL('../src/data/iconify.generated.ts', import.meta.url), file);
console.log(`Wrote ${Object.keys(emoji).length} emoji and ${Object.keys(brands).length} brand icons.`);
