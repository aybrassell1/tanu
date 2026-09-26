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
import type { Cents, CustomTourQuestion, FeeWhen, Place, PlaceFee, PlaceStatus } from './types';

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
  { id: 'total_move_in', group: 'Money', label: 'What is the total to move in, all in?', kind: 'note', hint: 'Make them add it up out loud: deposit, admin, application, pet, first month.', scored: false },
  { id: 'credit_minimum', group: 'Money', label: 'What credit score do you need?', kind: 'note', hint: 'Worth knowing before you pay to apply.', scored: false },
  { id: 'utility_billing', group: 'Money', label: 'Do I pay the utility company directly, or do you bill me?', kind: 'note', hint: 'A building that splits one bill across units (RUBS) can cost more than metered, and you cannot shop it.', scored: false },
  { id: 'utility_admin_fee', group: 'Money', label: 'Is there a fee on top of the utility bill?', kind: 'yesno', hint: 'Billing or "utility admin" fees of $5–15 a month are common.', scored: false },
  { id: 'rent_payment_fee', group: 'Money', label: 'Does it cost anything to pay rent?', kind: 'yesno', hint: 'Card fees of 2–3%, or a few dollars for ACH.', scored: false },
  { id: 'late_fee', group: 'Money', label: 'What is the late fee, and is there a grace period?', kind: 'note', scored: false },
  { id: 'insurance_required', group: 'Money', label: "Is renter's insurance required, and what liability minimum?", kind: 'note', hint: '$100k liability is typical. Their in-house policy is usually dearer than your own.', scored: false },
  { id: 'deposit_alternative', group: 'Money', label: 'Is there a deposit alternative, and what does it cost over the lease?', kind: 'note', hint: 'A monthly "deposit waiver" fee is never refunded. Do the arithmetic.', scored: false },
  { id: 'prorated_first', group: 'Money', label: 'Is the first month prorated if I move in mid-month?', kind: 'yesno', scored: true },
  { id: 'fees_mandatory', group: 'Money', label: 'Which fees are mandatory even if I never use them?', kind: 'note', hint: 'Amenity, valet trash and package fees are often not optional.', scored: false },

  // The lease
  { id: 'lease_lengths', group: 'The lease', label: 'What lease lengths are available, and what do they cost?', kind: 'note', scored: false },
  { id: 'break_lease', group: 'The lease', label: 'What does breaking the lease cost?', kind: 'note', hint: 'Two months plus forfeited deposit is common. Get the number.', scored: false },
  { id: 'sublet', group: 'The lease', label: 'Can you sublet or reassign the lease?', kind: 'yesno', scored: false },
  { id: 'renewal_notice', group: 'The lease', label: 'How much notice to renew or leave?', kind: 'note', hint: '60 days is typical; missing it can trigger month-to-month rates.', scored: false },
  { id: 'guarantor', group: 'The lease', label: 'Do they accept a guarantor or co-signer?', kind: 'yesno', scored: false },
  { id: 'lease_price_by_length', group: 'The lease', label: 'What does a longer lease cost, versus a shorter one?', kind: 'note', hint: 'A 15-month lease is often cheaper per month than a 12.', scored: false },
  { id: 'month_to_month', group: 'The lease', label: 'What is the month-to-month rate when the lease ends?', kind: 'note', hint: 'Often several hundred more a month. This is what you pay if the next place falls through.', scored: false },
  { id: 'negotiable', group: 'The lease', label: 'Is the rent or any fee negotiable?', kind: 'yesno', hint: 'Worth asking. Concessions are easier to get than a lower rent.', scored: false },
  { id: 'rent_cap', group: 'The lease', label: 'Is there a cap on the increase at renewal?', kind: 'yesno', scored: false },
  { id: 'deposit_return_days', group: 'The lease', label: 'How long after moving out do deposits come back?', kind: 'note', hint: 'Your state sets a limit; ask what theirs actually is.', scored: false },

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
  { id: 'windows_sealed', group: 'The unit', label: 'Are the windows double-glazed and sealed?', kind: 'yesno', hint: 'Single panes and draughts are a heating bill, every winter.', scored: true },
  { id: 'thermostat', group: 'The unit', label: 'Can I control the heat and air myself?', kind: 'yesno', hint: 'A building-controlled system means you pay for a temperature you did not pick.', scored: true },
  { id: 'laundry_cost', group: 'The unit', label: 'If laundry is shared, what does a load cost?', kind: 'note', hint: '$3–5 a load is $20–40 a month for most people.', scored: false },
  { id: 'furnishing_gaps', group: 'The unit', label: 'What would I have to buy myself?', kind: 'note', hint: 'Blinds, light fixtures, a fridge, a shower curtain rod — first-week costs nobody quotes.', scored: false },
  { id: 'unit_differs', group: 'The unit', label: 'Is this the exact unit, or does mine differ?', kind: 'note', hint: 'Floor, view, layout and appliances vary between units at the same price.', scored: false },

  // The building
  { id: 'noise', group: 'The building', label: 'How loud is it — neighbours, street, trains?', kind: 'note', hint: 'Stand still and listen for a full minute.', scored: false },
  { id: 'maintenance_response', group: 'The building', label: 'How fast is maintenance, and is it 24/7?', kind: 'note', scored: false },
  { id: 'packages', group: 'The building', label: 'How are packages handled?', kind: 'note', scored: false },
  { id: 'pests', group: 'The building', label: 'Any pest treatment history in the building?', kind: 'yesno', hint: 'A "no" that comes too fast is worth a second question.', scored: false },
  { id: 'security', group: 'The building', label: 'Secure entry, cameras, lighting at night?', kind: 'yesno', scored: true },
  { id: 'turnover', group: 'The building', label: 'How long do people usually stay?', kind: 'note', hint: 'High turnover tells you something the tour will not.', scored: false },
  { id: 'who_manages', group: 'The building', label: 'Who manages it, and are they on site?', kind: 'note', scored: false },
  { id: 'repairs_charged', group: 'The building', label: 'What repairs get charged back to me?', kind: 'note', hint: 'Clogged drains, lockouts and lost fobs are often billable.', scored: false },
  { id: 'upcoming_work', group: 'The building', label: 'Any construction or renovation planned?', kind: 'note', hint: 'Scaffolding outside your window for six months is a real cost.', scored: false },
  { id: 'water_damage', group: 'The building', label: 'Any water damage, mould or flooding history here?', kind: 'yesno', scored: false },
  { id: 'detectors', group: 'The building', label: 'Are the smoke and CO detectors in and working?', kind: 'yesno', scored: true },

  // Parking & pets
  { id: 'parking_spot', group: 'Parking & pets', label: 'Is parking guaranteed, and what does it cost?', kind: 'note', scored: false },
  { id: 'guest_parking', group: 'Parking & pets', label: 'Where do guests park?', kind: 'note', scored: false },
  { id: 'pets_allowed', group: 'Parking & pets', label: 'Pets allowed, and any breed or weight limits?', kind: 'yesno', scored: false },

  // Before you sign
  { id: 'unit_shown', group: 'Before you sign', label: 'Did you see the actual unit, not a model?', kind: 'yesno', hint: 'A model apartment is a sales tool. Ask for the real one.', scored: true },
  { id: 'move_in_checklist', group: 'Before you sign', label: 'Will they document existing damage at move-in?', kind: 'yesno', hint: 'Photograph everything the day you get keys, either way.', scored: true },
  { id: 'available_date', group: 'Before you sign', label: 'When is it actually available?', kind: 'note', scored: false },
  { id: 'application_hold', group: 'Before you sign', label: 'Does applying hold the unit, and is the fee refundable?', kind: 'yesno', scored: false },
  { id: 'move_in_window', group: 'Before you sign', label: 'Are there move-in hours, elevator bookings or a fee?', kind: 'note', hint: 'Some buildings only allow weekday moves, which can cost you a day off.', scored: false },
  { id: 'truck_access', group: 'Before you sign', label: 'Where does a moving truck park?', kind: 'note', scored: false },
  { id: 'everything_in_writing', group: 'Before you sign', label: 'Will every fee and concession be written into the lease?', kind: 'yesno', hint: 'A verbal "we will waive that" is worth nothing at renewal.', scored: true },
  { id: 'read_lease', group: 'Before you sign', label: 'Can I take a copy of the lease away to read?', kind: 'yesno', scored: true },
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
  /** The part of that which is utilities, for the 30%-of-income rule. */
  utilities: Cents;
  /** Due before you get the keys. */
  upfront: Cents;
  breakdown: { key: string; label: string; amount: Cents }[];
  upfrontBreakdown: { key: string; label: string; amount: Cents }[];
  /** Rent plus everything else, over a 12-month lease. */
  firstYear: Cents;
}

export function placeCost(place: Place): PlaceCost {
  const fees = place.fees ?? [];
  const breakdown = [
    { key: 'rent', label: 'Rent', amount: place.rent },
    ...fees.filter((f) => f.when === 'monthly').map((f) => ({ key: f.id, label: f.label, amount: f.amount })),
  ];
  const upfrontBreakdown = [
    ...(place.firstMonthUpfront ? [{ key: 'first', label: "First month's rent", amount: place.rent }] : []),
    ...fees.filter((f) => f.when === 'upfront').map((f) => ({ key: f.id, label: f.label, amount: f.amount })),
  ];
  const monthly = sum(breakdown);
  const upfront = sum(upfrontBreakdown);
  return {
    monthly,
    aboveRent: monthly - place.rent,
    upfront,
    utilities: sum(fees.filter((f) => f.when === 'monthly' && f.utility)),
    breakdown: breakdown.filter((b) => b.amount > 0),
    upfrontBreakdown: upfrontBreakdown.filter((b) => b.amount > 0),
    // Twelve months plus what you hand over at signing, less the first month if
    // it was in there, because that month is already one of the twelve.
    firstYear: monthly * 12 + upfront - (place.firstMonthUpfront ? place.rent : 0),
  };
}

/** Fees you can add with one tap, instead of typing the same labels every time. */
export const FEE_PRESETS: { label: string; when: FeeWhen; utility?: boolean }[] = [
  { label: 'Parking', when: 'monthly' },
  { label: 'Valet trash', when: 'monthly' },
  { label: 'Amenity fee', when: 'monthly' },
  { label: 'Pet rent', when: 'monthly' },
  { label: 'Storage', when: 'monthly' },
  { label: 'Pest control', when: 'monthly' },
  { label: 'Package locker', when: 'monthly' },
  { label: 'Common area (CAM)', when: 'monthly' },
  { label: 'Rent payment fee', when: 'monthly' },
  { label: "Renter's insurance", when: 'monthly' },
  { label: 'Electric', when: 'monthly', utility: true },
  { label: 'Gas', when: 'monthly', utility: true },
  { label: 'Water & sewer', when: 'monthly', utility: true },
  { label: 'Trash', when: 'monthly', utility: true },
  { label: 'Internet', when: 'monthly', utility: true },
  { label: 'Security deposit', when: 'upfront' },
  { label: 'Admin fee', when: 'upfront' },
  { label: 'Application fee', when: 'upfront' },
  { label: 'Pet deposit', when: 'upfront' },
  { label: 'Pet fee (non-refundable)', when: 'upfront' },
  { label: 'Last month up front', when: 'upfront' },
  { label: 'Holding fee', when: 'upfront' },
  { label: 'Key or fob deposit', when: 'upfront' },
  { label: 'Move-in / elevator fee', when: 'upfront' },
  { label: 'Cleaning fee', when: 'upfront' },
];

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
export function scorePlace(snapshot: FinancialSnapshot, place: Place, custom: CustomTourQuestion[] = []): PlaceScore {
  // With no income recorded there is nothing to weigh a rent against, and a
  // letter grade would be a guess dressed up as a judgement.
  const graded = snapshot.takeHome > 0;
  const cost = placeCost(place);
  const result = rentAffordability(snapshot, {
    rent: place.rent,
    utilities: cost.utilities,
    insurance: 0,
    other: cost.aboveRent - cost.utilities,
    moveInCosts: cost.upfront,
    replaceCurrent: true,
  });

  const affordability = WEIGHTS.affordability * verdictWeight(result.verdict);

  const scores = place.ratings.filter((r) => r.score > 0).map((r) => r.score);
  const rated = scores.length;
  // No ratings yet is neutral, not bad: an untouched place sits in the middle.
  const condition = WEIGHTS.condition * (rated === 0 ? 0.6 : average(scores) / 5);

  const scoredIds = new Set(tourQuestions(custom).filter((q) => q.scored).map((q) => q.id));
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
    rentShare: snapshot.gross > 0 ? (place.rent + cost.utilities) / snapshot.gross : 0,
    weakest: graded && shares.length > 0 && shares[0].share < 0.85 ? shares[0].key : null,
    basis: graded ? 'full' : 'no_income',
  };
}

/** Everywhere you toured, best grade first. */
export function rankPlaces(snapshot: FinancialSnapshot, places: Place[], custom: CustomTourQuestion[] = []): { place: Place; score: PlaceScore }[] {
  return places
    .map((place) => ({ place, score: scorePlace(snapshot, place, custom) }))
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

/** The group your own questions land in, at the end of the checklist. */
export const CUSTOM_GROUP = 'Your questions';

/** The built-in checklist plus anything you added yourself. */
export function tourQuestions(custom: CustomTourQuestion[] = []): TourQuestion[] {
  return [...TOUR_QUESTIONS, ...custom.map((q) => ({ id: q.id, group: CUSTOM_GROUP, label: q.label, kind: q.kind, scored: q.kind === 'yesno' }))];
}

const recorded = (place: Place) => new Set(place.answers.filter((a) => a.answer !== undefined || (a.note ?? '').trim().length > 0).map((a) => a.id));

/** How much of the tour checklist you got through. */
export function checklistProgress(place: Place, custom: CustomTourQuestion[] = []): { answered: number; total: number } {
  const all = tourQuestions(custom);
  const done = recorded(place);
  return { answered: all.filter((q) => done.has(q.id)).length, total: all.length };
}

/** The questions with nothing recorded yet — what to ask before you leave. */
export function unanswered(place: Place, custom: CustomTourQuestion[] = []): TourQuestion[] {
  const done = recorded(place);
  return tourQuestions(custom).filter((q) => !done.has(q.id));
}

/** A fee line ready to drop into a place. */
export function newFee(label: string, when: FeeWhen, extra: Partial<PlaceFee> = {}): Omit<PlaceFee, 'id'> {
  return { label, amount: 0, when, ...extra };
}

/** A blank place, with the costs a first-time renter forgets set to zero. */
export function newPlace(): Omit<Place, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: '',
    status: 'touring',
    rent: 0,
    fees: [],
    included: ['water', 'sewer', 'trash'],
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
