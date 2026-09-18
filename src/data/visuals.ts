import type { AccountType, AssetType, GoalKind, GoalTemplate, IncomeType, RecurringKind } from '@/domain/types';

import { BRAND_ICONS, EMOJI_ICONS } from './iconify.generated';

/** Colorful illustration per concept. Falls back to the root category or null. */
const CATEGORY_EMOJI: Record<string, string> = {
  housing: 'house', 'housing.rent': 'key', 'housing.mortgage': 'house-with-garden', 'housing.property_tax': 'classical-building', 'housing.hoa': 'houses',
  'housing.home_insurance': 'umbrella', 'housing.renters_insurance': 'closed-umbrella', 'housing.utilities': 'high-voltage', 'housing.gas_heating': 'fire',
  'housing.water': 'droplet', 'housing.trash': 'wastebasket', 'housing.internet': 'globe-with-meridians', 'housing.phone': 'mobile-phone',
  'housing.maintenance': 'hammer-and-wrench', 'housing.furniture': 'couch-and-lamp', 'housing.appliances': 'electric-plug', 'housing.cleaning': 'sponge',
  'housing.lawn_garden': 'potted-plant', 'housing.pest_control': 'mouse-trap', 'housing.security': 'locked', 'housing.storage': 'card-file-box', 'housing.moving': 'delivery-truck',

  transportation: 'automobile', 'transportation.car_payment': 'automobile', 'transportation.car_lease': 'oncoming-automobile', 'transportation.insurance': 'shield',
  'transportation.gas': 'fuel-pump', 'transportation.ev_charging': 'battery', 'transportation.maintenance': 'wrench', 'transportation.repairs': 'nut-and-bolt',
  'transportation.tires': 'wheel', 'transportation.registration': 'page-facing-up', 'transportation.inspection': 'magnifying-glass-tilted-left',
  'transportation.parking': 'p-button', 'transportation.tolls': 'motorway', 'transportation.public_transit': 'bus', 'transportation.rideshare': 'oncoming-taxi',
  'transportation.bike_scooter': 'bicycle', 'transportation.car_wash': 'bubbles', 'transportation.roadside': 'sos-button', 'transportation.tickets': 'police-car-light',

  food: 'fork-and-knife-with-plate', 'food.groceries': 'shopping-cart', 'food.restaurants': 'fork-and-knife', 'food.fast_food': 'hamburger', 'food.coffee': 'hot-beverage',
  'food.delivery': 'takeout-box', 'food.alcohol': 'beer-mug', 'food.snacks': 'cookie', 'food.work_meals': 'bento-box',

  health: 'stethoscope', 'health.medical': 'stethoscope', 'health.dental': 'tooth', 'health.vision': 'glasses', 'health.medication': 'pill', 'health.otc': 'adhesive-bandage',
  'health.therapy': 'speech-balloon', 'health.hospital': 'hospital', 'health.labs': 'test-tube', 'health.medical_devices': 'thermometer',
  'health.health_insurance': 'medical-symbol', 'health.fitness': 'flexed-biceps', 'health.supplements': 'leafy-green',

  personal_care: 'lotion-bottle', 'personal_care.haircuts': 'barber-pole', 'personal_care.toiletries': 'soap', 'personal_care.cosmetics': 'lipstick',
  'personal_care.nails': 'nail-polish', 'personal_care.spa': 'lotus',

  clothing: 't-shirt', 'clothing.clothes': 'jeans', 'clothing.shoes': 'running-shoe', 'clothing.accessories': 'handbag', 'clothing.laundry': 'basket', 'clothing.uniforms': 'safety-vest',

  shopping: 'shopping-bags', 'shopping.household': 'roll-of-paper', 'shopping.electronics': 'laptop', 'shopping.home_decor': 'framed-picture', 'shopping.books': 'open-book',
  'shopping.office_supplies': 'paperclip', 'shopping.online': 'package', 'shopping.hobby_supplies': 'yarn', 'shopping.sporting_goods': 'soccer-ball',

  entertainment: 'clapper-board', 'entertainment.movies': 'popcorn', 'entertainment.events': 'ticket', 'entertainment.games': 'video-game', 'entertainment.hobbies': 'artist-palette',
  'entertainment.sports': 'basketball', 'entertainment.music': 'guitar', 'entertainment.nightlife': 'mirror-ball', 'entertainment.dating': 'rose', 'entertainment.gambling': 'slot-machine',

  travel: 'airplane', 'travel.general': 'luggage', 'travel.flights': 'airplane-departure', 'travel.lodging': 'hotel', 'travel.car_rental': 'sport-utility-vehicle',
  'travel.activities': 'camera-with-flash', 'travel.travel_insurance': 'umbrella-on-ground', 'travel.passport': 'passport-control', 'travel.souvenirs': 'globe-showing-americas',

  kids: 'children-crossing', 'kids.childcare': 'baby', 'kids.babysitting': 'child', 'kids.school_tuition': 'school', 'kids.school_supplies': 'backpack',
  'kids.activities': 'ballet-shoes', 'kids.toys': 'teddy-bear', 'kids.baby_supplies': 'baby-bottle', 'kids.kids_clothing': 'socks', 'kids.allowance': 'coin',
  'kids.child_support': 'handshake', 'kids.elder_care': 'older-person',

  pets: 'paw-prints', 'pets.pet_food': 'bone', 'pets.vet': 'syringe', 'pets.pet_insurance': 'shield', 'pets.grooming': 'poodle', 'pets.pet_supplies': 'cat-face', 'pets.boarding': 'dog',

  education: 'graduation-cap', 'education.tuition': 'graduation-cap', 'education.books': 'books', 'education.courses': 'memo', 'education.certifications': '1st-place-medal',
  'education.student_fees': 'receipt',

  insurance: 'shield', 'insurance.life': 'heart-with-ribbon', 'insurance.disability': 'manual-wheelchair', 'insurance.umbrella': 'umbrella', 'insurance.long_term_care': 'bed',
  'insurance.identity': 'locked-with-key', 'insurance.other': 'shield',

  subscriptions: 'repeat-button', 'subscriptions.streaming': 'television', 'subscriptions.music': 'headphone', 'subscriptions.software': 'desktop-computer', 'subscriptions.cloud': 'cloud',
  'subscriptions.news': 'newspaper', 'subscriptions.memberships': 'identification-card', 'subscriptions.apps': 'mobile-phone', 'subscriptions.gaming': 'joystick',

  giving: 'wrapped-gift', 'giving.gifts': 'wrapped-gift', 'giving.charity': 'red-heart', 'giving.religious': 'place-of-worship', 'giving.holidays': 'christmas-tree',
  'giving.celebrations': 'birthday-cake', 'giving.crowdfunding': 'people-hugging',

  business: 'briefcase', 'business.supplies': 'straight-ruler', 'business.software': 'laptop', 'business.equipment': 'printer', 'business.advertising': 'megaphone',
  'business.contractors': 'construction-worker', 'business.professional_fees': 'clipboard', 'business.licenses': 'page-with-curl', 'business.business_travel': 'airplane',
  'business.business_meals': 'fork-and-knife-with-plate', 'business.phone_internet': 'telephone', 'business.coworking': 'office-building', 'business.shipping': 'postbox',
  'business.home_office': 'chair', 'business.work_expenses': 'receipt',

  financial: 'coin', 'financial.interest': 'money-with-wings', 'financial.bank_fees': 'receipt', 'financial.late_fees': 'hourglass-not-done', 'financial.atm_fees': 'atm-sign',
  'financial.annual_fees': 'spiral-calendar', 'financial.advisor_fees': 'light-bulb', 'financial.credit_card_payments': 'credit-card', 'financial.loan_payments': 'bank',
  'financial.investments': 'chart-increasing', 'financial.savings': 'money-bag',

  taxes: 'classical-building', 'taxes.federal_estimated': 'calendar', 'taxes.state_estimated': 'tear-off-calendar', 'taxes.federal_income': 'classical-building',
  'taxes.state_income': 'cityscape', 'taxes.other_tax': 'bookmark-tabs', 'taxes.tax_prep': 'abacus', 'taxes.penalties': 'warning',

  legal: 'balance-scale', 'legal.legal_fees': 'scroll', 'legal.government_fees': 'classical-building', 'legal.fines': 'man-judge', 'legal.immigration': 'world-map',

  other: 'package', 'other.misc': 'package', 'other.cash': 'dollar-banknote', 'other.adjustment': 'pencil',

  income: 'money-bag', 'income.paycheck': 'briefcase', 'income.overtime': 'alarm-clock', 'income.bonus': 'party-popper', 'income.commission': 'handshake', 'income.tips': 'coin',
  'income.freelance': 'laptop', 'income.side_business': 'convenience-store', 'income.reselling': 'label', 'income.rental': 'key', 'income.royalties': 'crown',
  'income.interest': 'bank', 'income.dividends': 'chart-increasing', 'income.capital_gains': 'rocket', 'income.investment': 'bar-chart',
  'income.retirement': 'beach-with-umbrella', 'income.social_security': 'classical-building', 'income.unemployment': 'page-facing-up', 'income.benefits': 'open-hands',
  'income.child_support': 'child', 'income.gifts': 'wrapped-gift', 'income.tax_refund': 'receipt', 'income.rewards': 'glowing-star', 'income.sold_items': 'shopping-bags',
  'income.gambling': 'trophy', 'income.other': 'dollar-banknote',

  // Legacy ids (pre-expansion) kept so un-migrated data still gets a fitting illustration.
  'shopping.clothing': 't-shirt', 'shopping.personal': 'lotion-bottle', 'shopping.gifts': 'wrapped-gift', 'entertainment.travel': 'airplane',
  'financial.taxes': 'classical-building', 'financial.insurance': 'shield', 'other.donations': 'red-heart',
};

export function categoryEmoji(id: string | undefined): string | null {
  if (!id) return null;
  return CATEGORY_EMOJI[id] ?? CATEGORY_EMOJI[id.split('.')[0]] ?? null;
}

export const ACCOUNT_EMOJI: Record<AccountType, string> = {
  checking: 'bank', savings: 'money-bag', cash: 'dollar-banknote', credit_card: 'credit-card', store_card: 'shopping-bags',
  auto_loan: 'automobile', student_loan: 'graduation-cap', personal_loan: 'handshake', mortgage: 'house', medical_debt: 'hospital',
  brokerage: 'chart-increasing', roth_ira: 'seedling', traditional_ira: 'deciduous-tree', '401k': 'briefcase', hsa: 'medical-symbol',
  other_investment: 'bar-chart', other_asset: 'package', other_liability: 'receipt',
};

export const GOAL_EMOJI: Record<GoalTemplate, string> = {
  emergency: 'umbrella', move_out: 'key', vacation: 'desert-island', car: 'automobile', purchase: 'shopping-bags', general: 'money-bag', custom: 'bullseye',
};

export const GOAL_KIND_EMOJI: Record<GoalKind, string> = {
  savings: 'money-bag', debt_payoff: 'broken-chain', net_worth: 'gem-stone', investment: 'chart-increasing', custom: 'bullseye',
};

export const ASSET_EMOJI: Record<AssetType, string> = {
  vehicle: 'automobile', property: 'house-with-garden', electronics: 'laptop', jewelry: 'ring', collectible: 'trophy', other: 'package',
};

export const INCOME_EMOJI: Record<IncomeType, string> = {
  salary: 'briefcase', hourly: 'alarm-clock', overtime: 'alarm-clock', bonus: 'party-popper', freelance: 'laptop', side_business: 'convenience-store',
  reselling: 'label', interest: 'bank', dividends: 'chart-increasing', investment_income: 'chart-increasing', gift: 'wrapped-gift', refund: 'receipt', other: 'dollar-banknote',
};

export const RECURRING_EMOJI: Record<RecurringKind, string> = {
  bill: 'receipt', subscription: 'repeat-button', debt_payment: 'bank', transfer: 'repeat-button', savings: 'money-bag', investment: 'chart-increasing',
};

/** Merchant/payee text → brand mark. Matches on normalized words. */
const BRAND_ALIASES: [RegExp, string][] = [
  [/netflix/, 'netflix'], [/spotify/, 'spotify'], [/icloud/, 'icloud'], [/apple music/, 'applemusic'], [/apple/, 'apple'],
  [/creative cloud/, 'adobecreativecloud'], [/adobe/, 'adobe'], [/amazon|prime video/, 'amazon'], [/youtube/, 'youtube'], [/hulu/, 'hulu'],
  [/\bhbo\b/, 'hbo'], [/\bmax\b/, 'max'], [/paramount/, 'paramountplus'], [/audible/, 'audible'], [/duolingo/, 'duolingo'],
  [/openai|chatgpt/, 'openai'], [/crunchyroll/, 'crunchyroll'], [/twitch/, 'twitch'], [/patreon/, 'patreon'], [/dropbox/, 'dropbox'],
  [/google (drive|one)/, 'googledrive'], [/notion/, 'notion'], [/canva/, 'canva'], [/figma/, 'figma'], [/peloton/, 'peloton'],
  [/1password|password manager/, '1password'], [/xbox|game pass/, 'xbox'], [/playstation|\bpsn\b/, 'playstation'], [/nintendo/, 'nintendo'],
  [/steam/, 'steam'], [/epic games/, 'epicgames'], [/uber eats/, 'ubereats'], [/\buber\b/, 'uber'], [/\blyft\b/, 'lyft'],
  [/doordash/, 'doordash'], [/instacart/, 'instacart'], [/starbucks/, 'starbucks'], [/mcdonald/, 'mcdonalds'], [/burger king/, 'burgerking'],
  [/taco bell/, 'tacobell'], [/target/, 'target'], [/walmart/, 'walmart'], [/ikea/, 'ikea'], [/etsy/, 'etsy'], [/ebay/, 'ebay'],
  [/\bnike\b/, 'nike'], [/uniqlo/, 'uniqlo'], [/\bzara\b/, 'zara'], [/autozone/, 'autozone'], [/\bshell\b/, 'shell'], [/airbnb/, 'airbnb'],
  [/southwest/, 'southwestairlines'], [/\bdelta\b/, 'delta'], [/hilton/, 'hilton'], [/marriott/, 'marriott'], [/ticketmaster/, 'ticketmaster'],
  [/verizon/, 'verizon'], [/spectrum/, 'spectrum'], [/samsung/, 'samsung'], [/robinhood/, 'robinhood'], [/coinbase/, 'coinbase'],
  [/paypal/, 'paypal'], [/venmo/, 'venmo'], [/cash app/, 'cashapp'], [/zelle/, 'zelle'], [/american express|amex/, 'americanexpress'],
  [/discover/, 'discover'], [/chase|sapphire/, 'chase'], [/wells fargo/, 'wellsfargo'], [/bank of america/, 'bankofamerica'],
];

export function brandFor(...texts: (string | undefined)[]): string | null {
  const text = texts.filter(Boolean).join(' ').toLowerCase();
  if (!text) return null;
  for (const [pattern, key] of BRAND_ALIASES) if (pattern.test(text) && BRAND_ICONS[key]) return key;
  return null;
}

/** Brand mark when the name is recognizable, otherwise the category/kind illustration. */
export function recurringVisual(item: { name: string; payee?: string; categoryId?: string; kind: RecurringKind }) {
  return { brand: brandFor(item.name, item.payee), emoji: categoryEmoji(item.categoryId) ?? RECURRING_EMOJI[item.kind] };
}

export const hasEmoji = (name: string | null | undefined): name is string => !!name && !!EMOJI_ICONS[name];
