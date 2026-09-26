/**
 * Apartment hunting: what to ask while you are standing there, what it would
 * really cost, and how it sits against the money you actually have.
 *
 * A listed rent is never the number you pay. Parking, pet rent, an amenity fee,
 * the utilities the rent doesn't cover and renter's insurance all arrive every
 * month too, and the deposit plus fees land in one week. So a place is scored on
 * its whole monthly cost, through the same affordability rules the rest of the
 * app uses, and the grade says which part is weak rather than just how it felt.
 *
 * Everything here is a rule of thumb, not advice.
 */

import { rentAffordability, type AffordabilityResult, type FinancialSnapshot } from './affordability';
import type { Cents, Place, PlaceStatus } from './types';

// ─── What to ask on the tour ─────────────────────────────────────────────────

export type QuestionKind = 'yesno' | 'note';

export interface TourQuestion {
  id: string;
  group: string;
  label: string;
  kind: QuestionKind;
  /** Why it is worth asking, or what a good answer sounds like. */
  hint?: string;
  /**
   * Counts toward the fit score. Questions about taste ("is there a gym") are
   * worth asking but shouldn't mark a place down.
   */
  scored?: boolean;
}

/**
 * The questions people wish they had asked. Money first, because those are the
 * ones that change what the place costs, then the things that decide whether
 * you can live there.
 */
export const TOUR_QUESTIONS: TourQuestion[] = [
  // Money
  { id: 'rent_increase', group: 'Money', label: 'How much did rent go up at renewal last year?', kind: 'note', hint: 'A number here tells you what year two costs.', scored: false },
  { id: 'utilities_average', group: 'Money', label: 'What do utilities average here in summer and winter?', kind: 'note', hint: 'Ask for both. A cheap place with electric heat may not be.', scored: false },
  { id: 'fees_total', group: 'Money', label: 'Are there any monthly fees beyond rent?', kind: 'note', hint: 'Amenity, trash, valet, pest, common area, package locker.', scored: false },
  { id: 'deposit_refundable', group: 'Money', label: 'Is the deposit refundable, and what gets taken out?', kind: 'yesno', hint: 'Ask what they kept from the last tenant.', scored: true },
  { id: 'move_in_specials', group: 'Money', label: 'Any move-in specials or free months?', kind: 'note', hint: 'Check whether it is spread across the lease or paid back if you leave.', scored: false },
  { id: 'income_requirement', group: 'Money', label: 'What income do you require?', kind: 'note', hint: 'Usually 2.5–3× the monthly rent, gross.', scored: false },

  // The lease
  { id: 'lease_lengths', group: 'The lease', label: 'What lease lengths are available, and what do they cost?', kind: 'note', scored: false },
  { id: 'break_lease', group: 'The lease', label: 'What does breaking the lease cost?', kind: 'note', hint: 'Two months plus forfeited deposit is common. Get the number.', scored: false },
  { id: 'sublet', group: 'The lease', label: 'Can you sublet or reassign the lease?', kind: 'yesno', scored: false },
  { id: 'renewal_notice', group: 'The lease', label: 'How much notice to renew or leave?', kind: 'note', hint: '60 days is typical; missing it can trigger month-to-month rates.', scored: false },
  { id: 'guarantor', group: 'The lease', label: 'Do they accept a guarantor or co-signer?', kind: 'yesno', scored: false },

  // The unit
  { id: 'laundry', group: 'The unit', label: 'Laundry in the unit?', kind: 'yesno', hint: 'In-building or a laundromat changes your week and your budget.', scored: true },
  { id: 'dishwasher', group: 'The unit', label: 'Dishwasher?', kind: 'yesno', scored: true },
  { id: 'ac_heat', group: 'The unit', label: 'What kind of heating and cooling?', kind: 'note', hint: 'Central, window units, radiators, heat pump — it shows up on the bill.', scored: false },
  { id: 'water_pressure', group: 'The unit', label: 'Did you run the taps and the shower?', kind: 'yesno', hint: 'Do it. Also flush while the shower runs.', scored: true },
  { id: 'outlets', group: 'The unit', label: 'Enough outlets, and do they work?', kind: 'yesno', scored: true },
  { id: 'windows', group: 'The unit', label: 'Which way do the windows face, and do they open?', kind: 'note', scored: false },
  { id: 'storage', group: 'The unit', label: 'Closet and storage space enough?', kind: 'yesno', scored: true },
  { id: 'cell_signal', group: 'The unit', label: 'Does your phone have signal inside?', kind: 'yesno', hint: 'Check in the bedroom, not just by the window.', scored: true },
  { id: 'internet_options', group: 'The unit', label: 'Which internet providers serve the building?', kind: 'note', hint: 'One option means one price.', scored: false },
  { id: 'appliance_age', group: 'The unit', label: 'How old are the appliances and the water heater?', kind: 'note', scored: false },

  // The building
  { id: 'noise', group: 'The building', label: 'How loud is it — neighbours, street, trains?', kind: 'note', hint: 'Stand still and listen for a full minute.', scored: false },
  { id: 'maintenance_response', group: 'The building', label: 'How fast is maintenance, and is it 24/7?', kind: 'note', scored: false },
  { id: 'packages', group: 'The building', label: 'How are packages handled?', kind: 'note', scored: false },
  { id: 'pests', group: 'The building', label: 'Any pest treatment history in the building?', kind: 'yesno', hint: 'A "no" that comes too fast is worth a second question.', scored: false },
  { id: 'security', group: 'The building', label: 'Secure entry, cameras, lighting at night?', kind: 'yesno', scored: true },
  { id: 'turnover', group: 'The building', label: 'How long do people usually stay?', kind: 'note', hint: 'High turnover tells you something the tour will not.', scored: false },
  { id: 'who_manages', group: 'The building', label: 'Who manages it, and are they on site?', kind: 'note', scored: false },

  // Parking & pets
  { id: 'parking_spot', group: 'Parking & pets', label: 'Is parking guaranteed, and what does it cost?', kind: 'note', scored: false },
  { id: 'guest_parking', group: 'Parking & pets', label: 'Where do guests park?', kind: 'note', scored: false },
  { id: 'pets_allowed', group: 'Parking & pets', label: 'Pets allowed, and any breed or weight limits?', kind: 'yesno', scored: false },

  // Before you sign
  { id: 'unit_shown', group: 'Before you sign', label: 'Did you see the actual unit, not a model?', kind: 'yesno', hint: 'A model apartment is a sales tool. Ask for the real one.', scored: true },
  { id: 'move_in_checklist', group: 'Before you sign', label: 'Will they document existing damage at move-in?', kind: 'yesno', hint: 'Photograph everything the day you get keys, either way.', scored: true },
  { id: 'available_date', group: 'Before you sign', label: 'When is it actually available?', kind: 'note', scored: false },
  { id: 'application_hold', group: 'Before you sign', label: 'Does applying hold the unit, and is the fee refundable?', kind: 'yesno', scored: false },
];

/** What you would pay separately if the rent doesn't cover it. */
export const UTILITIES = [
  { id: 'water', label: 'Water' },
  { id: 'sewer', label: 'Sewer' },
  { id: 'trash', label: 'Trash' },
  { id: 'electric', label: 'Electric' },
  { id: 'gas', label: 'Gas' },
  { id: 'heat', label: 'Heat' },
  { id: 'internet', label: 'Internet' },
] as const;

/** The things a number can't hold, scored 1–5 while it is fresh. */
export const RATINGS = [
  { id: 'condition', label: 'Condition' },
  { id: 'light', label: 'Light' },
  { id: 'quiet', label: 'Quiet' },
  { id: 'layout', label: 'Layout' },
  { id: 'location', label: 'Location' },
  { id: 'management', label: 'Management' },
] as const;

export const PLACE_STATUS: Record<PlaceStatus, { label: string; tone: 'muted' | 'primary' | 'positive' | 'negative' }> = {
  touring: { label: 'Toured', tone: 'muted' },
  shortlist: { label: 'Shortlist', tone: 'primary' },
  applied: { label: 'Applied', tone: 'primary' },
  chosen: { label: 'Chosen', tone: 'positive' },
  passed: { label: 'Passed', tone: 'negative' },
};

// ─── What it costs ───────────────────────────────────────────────────────────

export interface PlaceCost {
  /** Everything that arrives every month, including the rent. */
  monthly: Cents;
  /** Monthly cost beyond the advertised rent. */
  aboveRent: Cents;
  /** Due before you get the keys. */
  upfront: Cents;
  breakdown: { key: string; label: string; amount: Cents }[];
  upfrontBreakdown: { key: string; label: string; amount: Cents }[];
  /** Rent plus everything else, over a 12-month lease. */
  firstYear: Cents;
}

export function placeCost(place: Place): PlaceCost {
  const breakdown = [
    { key: 'rent', label: 'Rent', amount: place.rent },
    { key: 'utilities', label: 'Utilities you pay', amount: place.utilitiesEstimate },
    { key: 'parking', label: 'Parking', amount: place.parking },
    { key: 'pet', label: 'Pet rent', amount: place.petRent },
    { key: 'fees', label: 'Monthly fees', amount: place.otherMonthly },
    { key: 'insurance', label: "Renter's insurance", amount: place.insurance },
  ];
  const upfrontBreakdown = [
    { key: 'deposit', label: 'Security deposit', amount: place.deposit },
    { key: 'first', label: "First month's rent", amount: place.firstMonthUpfront ? place.rent : 0 },
    { key: 'admin', label: 'Admin fee', amount: place.adminFee },
    { key: 'application', label: 'Application fee', amount: place.applicationFee },
    { key: 'petDeposit', label: 'Pet deposit', amount: place.petDeposit },
  ];
  const monthly = sum(breakdown);
  const upfront = sum(upfrontBreakdown);
  return {
    monthly,
    aboveRent: monthly - place.rent,
    upfront,
    breakdown: breakdown.filter((b) => b.amount > 0),
    upfrontBreakdown: upfrontBreakdown.filter((b) => b.amount > 0),
    firstYear: monthly * 12 + upfront - (place.firstMonthUpfront ? place.rent : 0),
  };
}

// ─── The grade ───────────────────────────────────────────────────────────────

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface PlaceScore {
  /** Null when there is no income recorded to judge a cost against. */
  grade: Grade | null;
  /** 0–100, the three parts below added up. */
  score: number;
  parts: {
    /** 0–55. Can you carry it, by the same rules the rent calculator uses. */
    affordability: number;
    /** 0–25. How the place itself came across, from your 1–5 ratings. */
    condition: number;
    /** 0–20. The scored questions you got a good answer to. */
    fit: number;
  };
  /** How many of the 1–5 ratings and scored questions you filled in. */
  rated: number;
  answered: number;
  answerable: number;
  cost: PlaceCost;
  /** The full affordability read, for showing the checks. */
  result: AffordabilityResult;
  /** Rent plus utilities as a share of gross pay. */
  rentShare: number;
  /** The single thing holding the grade down. */
  weakest: 'affordability' | 'condition' | 'fit' | null;
  /** `no_income` means the cost half of the grade could not be worked out. */
  basis: 'full' | 'no_income';
}

const WEIGHTS = { affordability: 55, condition: 25, fit: 20 };

/**
 * A grade you can argue with: every part is shown, and an unanswered question
 * never counts against a place — only a bad answer does.
 */
export function scorePlace(snapshot: FinancialSnapshot, place: Place): PlaceScore {
  // With no income recorded there is nothing to weigh a rent against, and a
  // letter grade would be a guess dressed up as a judgement.
  const graded = snapshot.takeHome > 0;
  const cost = placeCost(place);
  const result = rentAffordability(snapshot, {
    rent: place.rent,
    utilities: place.utilitiesEstimate,
    insurance: place.insurance,
    other: place.parking + place.petRent + place.otherMonthly,
    moveInCosts: cost.upfront,
    replaceCurrent: true,
  });

  const affordability = WEIGHTS.affordability * verdictWeight(result.verdict);

  const scores = place.ratings.filter((r) => r.score > 0).map((r) => r.score);
  const rated = scores.length;
  // No ratings yet is neutral, not bad: an untouched place sits in the middle.
  const condition = WEIGHTS.condition * (rated === 0 ? 0.6 : average(scores) / 5);

  const scoredIds = new Set(TOUR_QUESTIONS.filter((q) => q.scored).map((q) => q.id));
  const given = place.answers.filter((a) => scoredIds.has(a.id) && (a.answer === 'yes' || a.answer === 'no'));
  const good = given.filter((a) => a.answer === 'yes').length;
  const fit = WEIGHTS.fit * (given.length === 0 ? 0.6 : good / given.length);

  const score = Math.round(affordability + condition + fit);
  // Only a part you have actually filled in can be the weak one: a place you
  // haven't rated yet is not "let down by its condition".
  const shares = [
    { key: 'affordability' as const, share: affordability / WEIGHTS.affordability, known: true },
    { key: 'condition' as const, share: condition / WEIGHTS.condition, known: rated > 0 },
    { key: 'fit' as const, share: fit / WEIGHTS.fit, known: given.length > 0 },
  ]
    .filter((part) => part.known)
    .sort((a, b) => a.share - b.share);

  return {
    grade: graded ? gradeFor(score) : null,
    score,
    parts: { affordability: Math.round(affordability), condition: Math.round(condition), fit: Math.round(fit) },
    rated,
    answered: given.length,
    answerable: scoredIds.size,
    cost,
    result,
    rentShare: snapshot.gross > 0 ? (place.rent + place.utilitiesEstimate) / snapshot.gross : 0,
    weakest: graded && shares.length > 0 && shares[0].share < 0.85 ? shares[0].key : null,
    basis: graded ? 'full' : 'no_income',
  };
}

/** Everywhere you toured, best grade first. */
export function rankPlaces(snapshot: FinancialSnapshot, places: Place[]): { place: Place; score: PlaceScore }[] {
  return places
    .map((place) => ({ place, score: scorePlace(snapshot, place) }))
    // Without a grade to sort by, the cheapest place leads.
    .sort((a, b) => (a.score.grade === null ? a.score.cost.monthly - b.score.cost.monthly : b.score.score - a.score.score || a.score.cost.monthly - b.score.cost.monthly));
}

/** The cheapest monthly cost and the best grade among what you have seen. */
export function placeHighlights(ranked: { place: Place; score: PlaceScore }[]) {
  const live = ranked.filter((r) => r.place.status !== 'passed');
  const cheapest = live.reduce<(typeof live)[number] | null>((best, r) => (!best || r.score.cost.monthly < best.score.cost.monthly ? r : best), null);
  return {
    best: live[0] ?? null,
    cheapest,
    spread: live.length > 1 && cheapest ? Math.max(...live.map((r) => r.score.cost.monthly)) - cheapest.score.cost.monthly : 0,
  };
}

/** How much of the tour checklist you got through. */
export function checklistProgress(place: Place): { answered: number; total: number } {
  const answered = place.answers.filter((a) => a.answer !== undefined || (a.note ?? '').trim().length > 0).length;
  return { answered, total: TOUR_QUESTIONS.length };
}

/** The questions with nothing recorded yet — what to ask before you leave. */
export function unanswered(place: Place): TourQuestion[] {
  const done = new Set(place.answers.filter((a) => a.answer !== undefined || (a.note ?? '').trim().length > 0).map((a) => a.id));
  return TOUR_QUESTIONS.filter((q) => !done.has(q.id));
}

/** A blank place, with the costs a first-time renter forgets set to zero. */
export function newPlace(): Omit<Place, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    status: 'touring',
    rent: 0,
    parking: 0,
    petRent: 0,
    otherMonthly: 0,
    utilitiesEstimate: 0,
    insurance: 0,
    included: ['water', 'sewer', 'trash'],
    deposit: 0,
    applicationFee: 0,
    adminFee: 0,
    petDeposit: 0,
    firstMonthUpfront: true,
    answers: [],
    ratings: [],
    photos: [],
    tags: [],
  };
}

const VERDICT_WEIGHT = { comfortable: 1, manageable: 0.78, stretch: 0.45, not_affordable: 0.1 } as const;
const verdictWeight = (v: AffordabilityResult['verdict']) => VERDICT_WEIGHT[v];

function gradeFor(score: number): Grade {
  if (score >= 85) return 'A';
  if (score >= 72) return 'B';
  if (score >= 58) return 'C';
  if (score >= 45) return 'D';
  return 'F';
}

const sum = (parts: { amount: Cents }[]) => parts.reduce((total, p) => total + p.amount, 0);
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
