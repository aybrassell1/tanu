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
import type { Cents, CustomTourQuestion, FeeWhen, Place, PlaceConcession, PlaceFee, PlaceStatus } from './types';

// ─── What to ask on the tour ─────────────────────────────────────────────────

export type QuestionKind = 'yesno' | 'note';

/**
 * A tour happens in an order, so the checklist follows it: the money at the
 * desk, the building on the way, the unit while you are standing in it, then the
 * lease as you are leaving. Asking the water pressure question in the lobby is
 * how you end up not asking it at all.
 */
export type TourStage = 'desk' | 'walk' | 'unit' | 'leave';

export const TOUR_STAGES: { id: TourStage; label: string }[] = [
  { id: 'desk', label: 'At the desk' },
  { id: 'walk', label: 'Walking round' },
  { id: 'unit', label: 'In the unit' },
  { id: 'leave', label: 'Before you leave' },
];

export interface TourQuestion {
  id: string;
  /** Where in the tour it belongs. */
  stage: TourStage;
  /**
   * Who answers. A leasing agent will happily answer fifteen questions and
   * resent forty, so the ones only you can answer — by trying a tap or a lock —
   * are kept apart and never counted against your patience.
   */
  ask: 'them' | 'you';
  label: string;
  kind: QuestionKind;
  /** Why it is worth asking, or what a good answer sounds like. */
  hint?: string;
  /**
   * Counts toward the fit score. Questions about taste ("is there a gym") are
   * worth asking but shouldn't mark a place down.
   */
  scored?: boolean;
  /**
   * In the short list shown by default. Everything else is still there, one tap
   * away — a thorough list you never open is worse than a short one you finish.
   */
  core?: boolean;
  /** Added by the user rather than built in. */
  mine?: boolean;
}

/**
 * The questions people wish they had asked, in the order a tour actually
 * happens. Roughly twenty are marked `core`: that is a tour you can get through
 * without the agent losing patience. The rest are for the place you are serious
 * about.
 */
export const TOUR_QUESTIONS: TourQuestion[] = [
  // ── At the desk: the money, while you are both sitting down ──────────────
  { id: 'available_date', stage: 'desk', ask: 'them', label: 'When is it actually available?', kind: 'note', core: true },
  { id: 'total_move_in', stage: 'desk', ask: 'them', label: 'What is the total to move in, all in?', kind: 'note', hint: 'Make them add it up out loud: deposit, admin, application, pet, first month.', core: true },
  { id: 'fees_total', stage: 'desk', ask: 'them', label: 'Are there any monthly fees beyond rent?', kind: 'note', hint: 'Amenity, trash, valet, pest, common area, package locker.', core: true },
  { id: 'move_in_specials', stage: 'desk', ask: 'them', label: 'Any free months, and is it spread or taken at the start?', kind: 'note', hint: 'Spread lowers every month; taken at the start, the rent returns to full. Record it in the costs so the math is right.', core: true },
  { id: 'rent_is_special', stage: 'desk', ask: 'them', label: 'Is that the standard rent, or a special that resets?', kind: 'note', hint: 'A rent quoted net of a concession looks cheaper than the lease says. Ask what the rent becomes after the offer.', core: true },
  { id: 'utilities_average', stage: 'desk', ask: 'them', label: 'What do utilities average here in summer and winter?', kind: 'note', hint: 'Ask for both, and ask whether each unit is metered or one bill is split across the building — a split you cannot shop.', core: true },
  { id: 'apply_documents', stage: 'desk', ask: 'them', label: 'What do you need from me to apply?', kind: 'note', hint: 'Pay stubs, an offer letter, ID, bank statements. Knowing now saves a day later.' },
  { id: 'application_fee_each', stage: 'desk', ask: 'them', label: 'Is the application fee per person?', kind: 'yesno', hint: 'Two adults often means paying it twice.' },
  { id: 'start_date_flex', stage: 'desk', ask: 'them', label: 'How much can the lease start date move?', kind: 'note', hint: 'A fortnight of overlap with your current place is rent you pay twice.' },
  { id: 'pet_cost', stage: 'desk', ask: 'them', label: 'Pet rent, a pet deposit, or both — and is any of it refundable?', kind: 'note', hint: 'Pet rent is every month forever; a deposit is once. They are not the same money.' },
  { id: 'rent_increase', stage: 'desk', ask: 'them', label: 'How much did rent go up at renewal last year?', kind: 'note', hint: 'A number here tells you what year two costs.', core: true },
  { id: 'income_requirement', stage: 'desk', ask: 'them', label: 'What income do you require?', kind: 'note', hint: 'Usually 2.5–3× the monthly rent, gross. Worth knowing before you tour a second one.', core: true },
  { id: 'concession_clawback', stage: 'desk', ask: 'them', label: 'If I leave early, do I pay the free months back?', kind: 'note', hint: 'Usually yes. That turns a cheap lease into an expensive exit.' },
  { id: 'fees_mandatory', stage: 'desk', ask: 'them', label: 'Which fees are mandatory even if I never use them?', kind: 'note', hint: 'Amenity, valet trash and package fees are often not optional.' },
  { id: 'deposit_refundable', stage: 'desk', ask: 'them', label: 'Is the deposit refundable, and what gets taken out?', kind: 'yesno', hint: 'Ask what they kept from the last tenant.', scored: true },
  { id: 'prorated_first', stage: 'desk', ask: 'them', label: 'Is the first month prorated if I move in mid-month?', kind: 'yesno', scored: true },
  { id: 'utility_billing', stage: 'desk', ask: 'them', label: 'Do I pay the utility company directly, or do you bill me?', kind: 'note', hint: 'A building that splits one bill across units (RUBS) can cost more than metered, and you cannot shop it.' },
  { id: 'utility_admin_fee', stage: 'desk', ask: 'them', label: 'Is there a fee on top of the utility bill?', kind: 'yesno', hint: 'Billing or "utility admin" fees of $5–15 a month are common.' },
  { id: 'rent_payment_fee', stage: 'desk', ask: 'them', label: 'Does it cost anything to pay rent?', kind: 'yesno', hint: 'Card fees of 2–3%, or a few dollars for ACH.' },
  { id: 'late_fee', stage: 'desk', ask: 'them', label: 'What is the late fee, and is there a grace period?', kind: 'note' },
  { id: 'insurance_required', stage: 'desk', ask: 'them', label: "Is renter's insurance required, and what liability minimum?", kind: 'note', hint: '$100k liability is typical. Their in-house policy usually costs more than your own.' },
  { id: 'deposit_alternative', stage: 'desk', ask: 'them', label: 'Is there a deposit alternative, and what does it cost over the lease?', kind: 'note', hint: 'A monthly "deposit waiver" fee is never refunded. Do the arithmetic.' },
  { id: 'credit_minimum', stage: 'desk', ask: 'them', label: 'What credit score do you need?', kind: 'note', hint: 'Worth knowing before you pay to apply.' },
  { id: 'guarantor', stage: 'desk', ask: 'them', label: 'Do they accept a guarantor or co-signer?', kind: 'yesno' },
  { id: 'application_hold', stage: 'desk', ask: 'them', label: 'Does applying hold the unit, and is the fee refundable?', kind: 'yesno' },
  { id: 'pets_allowed', stage: 'desk', ask: 'them', label: 'Pets allowed, and any breed or weight limits?', kind: 'yesno', hint: 'A gate, not a detail. Ask before you walk round.' },

  // ── Walking round: the building, on the way to the unit ──────────────────
  { id: 'parking_spot', stage: 'walk', ask: 'them', label: 'Is parking guaranteed, and what does it cost?', kind: 'note', core: true },
  { id: 'maintenance_response', stage: 'walk', ask: 'them', label: 'How fast is maintenance, and is it 24/7?', kind: 'note', core: true },
  { id: 'security', stage: 'walk', ask: 'them', label: 'Secure entry, cameras, lighting at night?', kind: 'yesno', scored: true, core: true },
  { id: 'noise', stage: 'walk', ask: 'you', label: 'How loud is it — neighbors, street, trains?', kind: 'note', hint: 'Stand still and listen for a full minute.', core: true },
  { id: 'packages', stage: 'walk', ask: 'them', label: 'How are packages handled?', kind: 'note' },
  { id: 'pests', stage: 'walk', ask: 'them', label: 'Any pest treatment history in the building?', kind: 'yesno', hint: 'A "no" that comes too fast is worth a second question.' },
  { id: 'water_damage', stage: 'walk', ask: 'them', label: 'Any water damage, mold or flooding history here?', kind: 'yesno' },
  { id: 'turnover', stage: 'walk', ask: 'them', label: 'How long do people usually stay?', kind: 'note', hint: 'High turnover tells you something the tour will not.' },
  { id: 'last_tenant', stage: 'walk', ask: 'them', label: 'Why did the last tenant leave, and how long has it been empty?', kind: 'note' },
  { id: 'who_manages', stage: 'walk', ask: 'them', label: 'Who manages it, and are they on site?', kind: 'note' },
  { id: 'complaints', stage: 'walk', ask: 'them', label: 'How do I report a problem with a neighbor?', kind: 'note', hint: 'Whether anyone actually handles it is the real question.' },
  { id: 'repairs_charged', stage: 'walk', ask: 'them', label: 'What repairs get charged back to me?', kind: 'note', hint: 'Clogged drains, lockouts and lost fobs are often billable.' },
  { id: 'upcoming_work', stage: 'walk', ask: 'them', label: 'Any construction or renovation planned?', kind: 'note', hint: 'Scaffolding outside your window for six months is a real cost.' },
  { id: 'bins', stage: 'walk', ask: 'them', label: 'Where do the bins go, and when are they collected?', kind: 'note' },
  { id: 'seasonal', stage: 'walk', ask: 'them', label: 'Who does snow, leaves and the grounds?', kind: 'note' },
  { id: 'parking_second', stage: 'walk', ask: 'them', label: 'Is there a second spot if you need one, and what does it cost?', kind: 'note' },
  { id: 'ev_charging', stage: 'walk', ask: 'them', label: 'Is there EV charging, and is there a waiting list?', kind: 'note' },
  { id: 'guest_parking', stage: 'walk', ask: 'them', label: 'Where do guests park?', kind: 'note' },

  // ── In the unit: mostly things to try, not things to ask ─────────────────
  { id: 'unit_shown', stage: 'unit', ask: 'them', label: 'Is this the unit you would get, not a model?', kind: 'yesno', hint: 'A model apartment is a sales tool. Ask for the real one.', scored: true, core: true },
  { id: 'water_pressure', stage: 'unit', ask: 'you', label: 'Did you run the taps and the shower?', kind: 'yesno', hint: 'Do it. Also flush while the shower runs.', scored: true, core: true },
  { id: 'locks', stage: 'unit', ask: 'you', label: 'Do all the doors and windows lock?', kind: 'yesno', hint: 'Try them, including the ones behind furniture.', scored: true, core: true },
  { id: 'damp_check', stage: 'unit', ask: 'you', label: 'Did you look under the sinks and around the windows?', kind: 'yesno', hint: 'Stains, warping and a damp smell are what you are looking for.', scored: true, core: true },
  { id: 'laundry', stage: 'unit', ask: 'you', label: 'Laundry in the unit?', kind: 'yesno', hint: 'In-building or a laundromat changes your week and your budget.', scored: true, core: true },
  { id: 'ac_heat', stage: 'unit', ask: 'them', label: 'What kind of heating and cooling?', kind: 'note', hint: 'Central, window units, radiators, heat pump — it shows up on the bill.', core: true },
  { id: 'hot_water', stage: 'unit', ask: 'you', label: 'Does the hot water arrive quickly, and run clear?', kind: 'yesno', hint: 'Let it run a minute. Slow or rusty is the water heater telling you something.', scored: true },
  { id: 'outlets', stage: 'unit', ask: 'you', label: 'Enough outlets, and do they work?', kind: 'yesno', scored: true },
  { id: 'cell_signal', stage: 'unit', ask: 'you', label: 'Does your phone have signal inside?', kind: 'yesno', hint: 'Check in the bedroom, not just by the window.', scored: true },
  { id: 'detectors', stage: 'unit', ask: 'you', label: 'Are the smoke and CO detectors in and working?', kind: 'yesno', scored: true },
  { id: 'windows_sealed', stage: 'unit', ask: 'you', label: 'Are the windows double-glazed and sealed?', kind: 'yesno', hint: 'Single panes and drafts are a heating bill, every winter.', scored: true },
  { id: 'storage', stage: 'unit', ask: 'you', label: 'Closet and storage space enough?', kind: 'yesno', scored: true },
  { id: 'windows', stage: 'unit', ask: 'you', label: 'Which way do the windows face, and do they open?', kind: 'note' },
  { id: 'furnishing_gaps', stage: 'unit', ask: 'you', label: 'What would I have to buy myself?', kind: 'note', hint: 'Blinds, light fixtures, a fridge, a shower curtain rod — first-week costs nobody quotes.' },
  { id: 'dishwasher', stage: 'unit', ask: 'you', label: 'Dishwasher?', kind: 'yesno', scored: true },
  { id: 'thermostat', stage: 'unit', ask: 'them', label: 'Can I control the heat and air myself?', kind: 'yesno', hint: 'A building-controlled system means you pay for a temperature you did not pick.', scored: true },
  { id: 'unit_differs', stage: 'unit', ask: 'them', label: 'If this is a model, how does mine differ?', kind: 'note', hint: 'Floor, view, layout and appliances vary between units at the same price.' },
  { id: 'internet_options', stage: 'unit', ask: 'them', label: 'Which internet providers serve the building?', kind: 'note', hint: 'One option means one price.' },
  { id: 'appliance_age', stage: 'unit', ask: 'them', label: 'How old are the appliances and the water heater?', kind: 'note' },
  { id: 'laundry_cost', stage: 'unit', ask: 'them', label: 'If laundry is shared, what does a load cost?', kind: 'note', hint: '$3–5 a load is $20–40 a month for most people.' },

  // ── Before you leave: the lease, and what to take away with you ──────────
  { id: 'lease_lengths', stage: 'leave', ask: 'them', label: 'What lease lengths are available, and what do they cost?', kind: 'note', hint: 'A 15-month lease is often cheaper per month than a 12. Ask for the price of each.', core: true },
  { id: 'break_lease', stage: 'leave', ask: 'them', label: 'What does breaking the lease cost?', kind: 'note', hint: 'Two months plus forfeited deposit is common. Get the number.', core: true },
  { id: 'renewal_notice', stage: 'leave', ask: 'them', label: 'How much notice to renew or leave?', kind: 'note', hint: '60 days is typical; missing it can trigger month-to-month rates.', core: true },
  { id: 'everything_in_writing', stage: 'leave', ask: 'them', label: 'Will every fee and concession be written into the lease?', kind: 'yesno', hint: 'A verbal "we will waive that" is worth nothing at renewal.', scored: true, core: true },
  { id: 'read_lease', stage: 'leave', ask: 'them', label: 'Can I take a copy of the lease away to read?', kind: 'yesno', scored: true, core: true },
  { id: 'lease_price_by_length', stage: 'leave', ask: 'them', label: 'Is the price per month different on a longer lease?', kind: 'note', hint: 'Longer is often cheaper per month, and a lease ending in winter is harder to re-let.' },
  { id: 'negotiable', stage: 'leave', ask: 'them', label: 'Is the rent or any fee negotiable?', kind: 'yesno', hint: 'Ask once you have seen it and they know you are interested. A concession is easier to get than a lower rent.' },
  { id: 'month_to_month', stage: 'leave', ask: 'them', label: 'What is the month-to-month rate when the lease ends?', kind: 'note', hint: 'Often several hundred more a month. This is what you pay if the next place falls through.' },
  { id: 'rent_cap', stage: 'leave', ask: 'them', label: 'Is there a cap on the increase at renewal?', kind: 'yesno' },
  { id: 'deposit_return_days', stage: 'leave', ask: 'them', label: 'How long after moving out do deposits come back?', kind: 'note', hint: 'Your state sets a limit; ask what theirs actually is.' },
  { id: 'sublet', stage: 'leave', ask: 'them', label: 'Can you sublet or reassign the lease?', kind: 'yesno' },
  { id: 'add_roommate', stage: 'leave', ask: 'them', label: 'Can someone move in later, and what does adding them cost?', kind: 'note' },
  { id: 'guest_policy', stage: 'leave', ask: 'them', label: 'How long can a guest stay before it becomes a problem?', kind: 'note' },
  { id: 'decorating', stage: 'leave', ask: 'them', label: 'Can I paint or hang things, and what gets charged at move-out?', kind: 'note', hint: 'Nail holes are the classic deduction.' },
  { id: 'smoking', stage: 'leave', ask: 'them', label: 'What is the smoking policy, indoors and on balconies?', kind: 'note' },
  { id: 'move_in_checklist', stage: 'leave', ask: 'them', label: 'Will they document existing damage at move-in?', kind: 'yesno', hint: 'Photograph everything the day you get keys, either way.', scored: true, core: true },
  { id: 'move_in_window', stage: 'leave', ask: 'them', label: 'Are there move-in hours, elevator bookings or a fee?', kind: 'note', hint: 'Some buildings only allow weekday moves, which can cost you a day off.' },
  { id: 'truck_access', stage: 'leave', ask: 'them', label: 'Where does a moving truck park?', kind: 'note' },
  { id: 'second_visit', stage: 'leave', ask: 'you', label: 'Have you seen it at a different time of day?', kind: 'yesno', hint: 'Evening light and evening noise are different things entirely.', scored: true },
  { id: 'neighbourhood', stage: 'leave', ask: 'you', label: 'What is within walking distance?', kind: 'note', hint: 'Shop, pharmacy, transport. Walk it, do not map it.' }
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

/** What a concession is actually worth, once it is spread over a real lease. */
export interface ConcessionEffect {
  /** The rent they advertise, before anything is taken off. */
  askingRent: Cents;
  /** The rent in a month you actually pay one. */
  payMonth: Cents;
  /** Rent averaged over the whole lease — the "net effective" figure. */
  effectiveRent: Cents;
  /** Total value of the offer: free rent plus anything knocked off at signing. */
  worth: Cents;
  /** Whole months at the start you pay no rent for. Zero when the offer is spread. */
  freeAtStart: number;
  /**
   * The part of an upfront offer that isn't a whole month — six weeks free is
   * one month plus half of another — taken off what you owe at signing, plus
   * anything they knocked off outright. Without this the banner would promise
   * money that never appears in a single figure below it.
   */
  startCredit: Cents;
  /** What the rent becomes when the offer ends, minus what you pay now. */
  renewalJump: Cents;
  leaseMonths: number;
}

/** One named cost. `high` is set only when it was quoted as a range. */
export interface CostLine {
  key: string;
  label: string;
  amount: Cents;
  high?: Cents;
}

/**
 * What a place costs. Every total comes twice: a cheap month and an expensive
 * one. Where nothing was given as a range the two are the same number.
 */
export interface PlaceCost {
  /**
   * The rent in a month you pay one — after a spread concession, not the
   * advertised figure. Everything that judges affordability uses this.
   */
  rent: Cents;
  /** Everything that arrives every month, including the rent. */
  monthly: Cents;
  /** The same month with every range at its top. */
  monthlyHigh: Cents;
  /** Monthly cost beyond the advertised rent. */
  aboveRent: Cents;
  aboveRentHigh: Cents;
  /** The part of that which is utilities, for the 30%-of-income rule. */
  utilities: Cents;
  utilitiesHigh: Cents;
  /** Due before you get the keys. */
  upfront: Cents;
  upfrontHigh: Cents;
  breakdown: CostLine[];
  upfrontBreakdown: CostLine[];
  /** Rent plus everything else, over a 12-month lease. */
  firstYear: Cents;
  firstYearHigh: Cents;
  /** True when anything here was quoted as a range, so the totals are a span. */
  ranged: boolean;
  /** False until a rent or a fee has been entered: $0 is not a price. */
  priced: boolean;
  /** Present when the place is offering free months or money off. */
  concession?: ConcessionEffect;
}

/** A lease with no length given is assumed to be the usual twelve months. */
export const DEFAULT_LEASE_MONTHS = 12;

/**
 * What free months are worth, and what you actually hand over each month.
 *
 * Spread over the lease, the offer lowers every payment and the rent jumps back
 * up at renewal. Taken up front, the first months cost nothing and every month
 * after is the full rent — the saving is the same, but what you have to afford
 * month to month is not.
 */
export function concessionEffect(place: Place): ConcessionEffect | undefined {
  const offer = place.concession;
  if (!offer) return undefined;

  const leaseMonths = Math.max(1, Math.round(place.leaseMonths ?? DEFAULT_LEASE_MONTHS) || DEFAULT_LEASE_MONTHS);
  // More free months than there are months in the lease is someone mishearing,
  // and a value that isn't a number at all is a restored backup, not an offer.
  const asked = Number.isFinite(offer.freeMonths) ? offer.freeMonths : 0;
  const freeMonths = Math.min(Math.max(0, asked), leaseMonths);
  // An offer of nothing is not an offer, however it was typed in.
  if (freeMonths <= 0 && !offer.upfrontCredit) return undefined;
  const freeRent = Math.round(place.rent * freeMonths);
  const worth = freeRent + (offer.upfrontCredit ?? 0);
  const effectiveRent = Math.round((place.rent * (leaseMonths - freeMonths)) / leaseMonths);
  const spread = offer.applied === 'spread';

  const wholeFree = Math.floor(freeMonths);
  return {
    askingRent: place.rent,
    payMonth: spread ? effectiveRent : place.rent,
    effectiveRent,
    worth,
    freeAtStart: spread ? 0 : wholeFree,
    startCredit: (offer.upfrontCredit ?? 0) + (spread ? 0 : Math.round(place.rent * (freeMonths - wholeFree))),
    // Only a spread offer has somewhere to fall from: paying full rent already
    // means renewal changes nothing by itself.
    renewalJump: spread ? place.rent - effectiveRent : 0,
    leaseMonths,
  };
}

export function placeCost(place: Place): PlaceCost {
  const fees = place.fees ?? [];
  const concession = concessionEffect(place);
  // The headline is what you hand over in a month you pay rent, because that is
  // the number your income has to carry.
  const rent = concession?.payMonth ?? place.rent;
  const line = (f: PlaceFee): CostLine => ({ key: f.id, label: f.label, amount: f.amount, high: topOf(f) > f.amount ? topOf(f) : undefined });
  const breakdown: CostLine[] = [
    { key: 'rent', label: concession && rent !== place.rent ? 'Rent, after the offer' : 'Rent', amount: rent },
    ...fees.filter((f) => f.when === 'monthly').map(line),
  ];
  const upfrontBreakdown: CostLine[] = [
    // A free first month is not due at signing, however the offer is applied.
    ...(place.firstMonthUpfront && !(concession && concession.freeAtStart > 0) ? [{ key: 'first', label: "First month's rent", amount: rent }] : []),
    ...fees.filter((f) => f.when === 'upfront').map(line),
  ];
  const monthly = sum(breakdown);
  const monthlyHigh = sumHigh(breakdown);
  const credit = concession?.startCredit ?? 0;
  const upfront = Math.max(0, sum(upfrontBreakdown) - credit);
  const upfrontHigh = Math.max(0, sumHigh(upfrontBreakdown) - credit);
  const free = Math.min(concession?.freeAtStart ?? 0, 12);
  const firstMonthIn = place.firstMonthUpfront && !(concession && concession.freeAtStart > 0);
  // Twelve months plus what you hand over at signing, less the first month if it
  // was in there, because that month is already one of the twelve. Free months
  // at the start come off the twelve.
  const year = (m: Cents, up: Cents) => m * 12 - rent * free + up - (firstMonthIn ? rent : 0);
  return {
    rent,
    monthly,
    monthlyHigh,
    aboveRent: monthly - rent,
    aboveRentHigh: monthlyHigh - rent,
    upfront,
    upfrontHigh,
    utilities: sum(fees.filter((f) => f.when === 'monthly' && f.utility).map(line)),
    utilitiesHigh: sumHigh(fees.filter((f) => f.when === 'monthly' && f.utility).map(line)),
    breakdown: breakdown.filter((b) => b.amount > 0 || (b.high ?? 0) > 0),
    upfrontBreakdown: upfrontBreakdown.filter((b) => b.amount > 0 || (b.high ?? 0) > 0),
    firstYear: year(monthly, upfront),
    firstYearHigh: year(monthlyHigh, upfrontHigh),
    ranged: monthlyHigh > monthly || upfrontHigh > upfront,
    priced: place.rent > 0 || fees.some((f) => topOf(f) > 0),
    concession,
  };
}

/** The top of a fee's range, or its only figure. */
const topOf = (f: PlaceFee) => Math.max(f.amount, f.high ?? 0);

/**
 * The fee line a utility's own cost lives on. A fixed id means entering it
 * twice updates one line instead of quietly adding a second.
 */
export const utilityFeeId = (utility: string) => `util_${utility}`;

/**
 * Record what a utility costs, as a figure or a range. Clearing both ends
 * removes the line rather than leaving a zero that looks like an answer.
 */
export function setUtilityCost(fees: PlaceFee[], utility: string, label: string, low?: Cents, high?: Cents): PlaceFee[] {
  const id = utilityFeeId(utility);
  const rest = fees.filter((f) => f.id !== id);
  if (!low && !high) return rest;
  const existing = fees.find((f) => f.id === id);
  const kept = { ...existing, id, label, when: 'monthly' as const, utility: true, amount: low ?? 0, high: high && high > (low ?? 0) ? high : undefined };
  const at = fees.findIndex((f) => f.id === id);
  return at < 0 ? [...fees, kept] : fees.map((f) => (f.id === id ? kept : f));
}

/** What you have written down for a utility, if anything. */
export const utilityCost = (fees: PlaceFee[], utility: string) => fees.find((f) => f.id === utilityFeeId(utility));

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
  /** Of those, how many came back the way you wanted. */
  agreed: number;
  answerable: number;
  cost: PlaceCost;
  /** The full affordability read, for showing the checks. */
  result: AffordabilityResult;
  /** Rent plus utilities as a share of gross pay. */
  rentShare: number;
  /** The single thing holding the grade down. */
  weakest: 'affordability' | 'condition' | 'fit' | null;
  /**
   * Why there is no grade. `no_income` means there is nothing to weigh a rent
   * against; `not_priced` means nobody has said what the place costs yet.
   */
  basis: 'full' | 'no_income' | 'not_priced';
}

const WEIGHTS = { affordability: 55, condition: 25, fit: 20 };
/** Where an unanswered part sits: the middle, neither credit nor blame. */
const NEUTRAL = 0.6;
/** Answers' worth of neutral to weigh against, so one tap cannot decide a grade. */
const PRIOR = 3;

/**
 * A grade you can argue with: every part is shown, and an unanswered question
 * never counts against a place — only a bad answer does.
 */
export function scorePlace(snapshot: FinancialSnapshot, place: Place, custom: CustomTourQuestion[] = []): PlaceScore {
  const cost = placeCost(place);
  // With no income recorded there is nothing to weigh a rent against, and a
  // letter grade would be a guess dressed up as a judgement. Neither is a place
  // nobody has put a price on: $0 a month is not an affordable apartment.
  const graded = snapshot.takeHome > 0 && cost.priced;
  const result = rentAffordability(snapshot, {
    // The rent after the offer, not the one on the sign. Two places that cost
    // the same every month have to grade the same.
    rent: cost.rent,
    // Judged on an expensive month. A range you can only afford at the bottom
    // is a range you cannot afford.
    utilities: cost.utilitiesHigh,
    insurance: 0,
    other: cost.aboveRentHigh - cost.utilitiesHigh,
    moveInCosts: cost.upfrontHigh,
    replaceCurrent: true,
  });

  const affordability = WEIGHTS.affordability * verdictWeight(result.verdict);

  const scores = place.ratings.filter((r) => r.score > 0).map((r) => r.score);
  const rated = scores.length;
  // No ratings yet is neutral, not bad: an untouched place sits in the middle.
  const condition = WEIGHTS.condition * (rated === 0 ? 0.6 : average(scores) / 5);

  const scoredIds = new Set(tourQuestions(custom).filter((q) => q.scored).map((q) => q.id));
  // One answer per question, whatever a restored backup happens to contain:
  // two entries for the same id would weigh that question twice.
  const given = [...new Map(place.answers.filter((a) => scoredIds.has(a.id) && (a.answer === 'yes' || a.answer === 'no')).map((a) => [a.id, a])).values()];
  const good = given.filter((a) => a.answer === 'yes').length;
  // Pulled toward neutral until there are a few answers, so the first thing you
  // tap cannot move the grade a whole letter. One "no" out of one is a fact
  // about your afternoon, not about the apartment.
  const fit = WEIGHTS.fit * ((good + NEUTRAL * PRIOR) / (given.length + PRIOR));

  const score = Math.round(affordability + condition + fit);
  // Only a part you have actually filled in can be the weak one: a place you
  // haven't rated yet is not "let down by its condition".
  const shares = [
    { key: 'affordability' as const, share: affordability / WEIGHTS.affordability, known: true },
    { key: 'condition' as const, share: condition / WEIGHTS.condition, known: rated > 0 },
    { key: 'fit' as const, share: fit / WEIGHTS.fit, known: given.length >= PRIOR },
  ]
    .filter((part) => part.known)
    .sort((a, b) => a.share - b.share);

  return {
    grade: graded ? gradeFor(score) : null,
    score,
    parts: { affordability: Math.round(affordability), condition: Math.round(condition), fit: Math.round(fit) },
    rated,
    answered: given.length,
    agreed: good,
    answerable: scoredIds.size,
    cost,
    result,
    rentShare: snapshot.gross > 0 ? (cost.rent + cost.utilitiesHigh) / snapshot.gross : 0,
    weakest: graded && shares.length > 0 && shares[0].share < 0.85 ? shares[0].key : null,
    basis: graded ? 'full' : snapshot.takeHome > 0 ? 'not_priced' : 'no_income',
  };
}

/** Everywhere you toured, best grade first. */
export function rankPlaces(snapshot: FinancialSnapshot, places: Place[], custom: CustomTourQuestion[] = []): { place: Place; score: PlaceScore }[] {
  return places
    .map((place) => ({ place, score: scorePlace(snapshot, place, custom) }))
    // A graded place always leads an ungraded one; without a grade to sort by,
    // the cheapest leads.
    .sort(
      (a, b) =>
        Number(b.score.grade !== null) - Number(a.score.grade !== null) ||
        (a.score.grade === null ? a.score.cost.monthly - b.score.cost.monthly : b.score.score - a.score.score || a.score.cost.monthly - b.score.cost.monthly),
    );
}

/** The cheapest monthly cost and the best grade among what you have seen. */
export function placeHighlights(ranked: { place: Place; score: PlaceScore }[]) {
  const live = ranked.filter((r) => r.place.status !== 'passed');
  // A place with no rent typed in is not the cheapest one, and comparing it
  // with places you have priced would make the whole row a lie.
  const priced = live.filter((r) => r.score.cost.priced);
  const cheapest = priced.reduce<(typeof priced)[number] | null>((best, r) => (!best || r.score.cost.monthly < best.score.cost.monthly ? r : best), null);
  return {
    best: live.find((r) => r.score.grade !== null) ?? live[0] ?? null,
    cheapest,
    spread: priced.length > 1 && cheapest ? Math.max(...priced.map((r) => r.score.cost.monthly)) - cheapest.score.cost.monthly : 0,
  };
}

/**
 * The built-in checklist plus anything you added yourself. Your own questions
 * are always in the short list: you would not have written one down to skip it.
 */
export function tourQuestions(custom: CustomTourQuestion[] = []): TourQuestion[] {
  return [
    ...TOUR_QUESTIONS,
    ...custom.map((q): TourQuestion => ({ id: q.id, stage: 'leave', ask: 'them', label: q.label, kind: q.kind, scored: q.kind === 'yesno', core: true, mine: true })),
  ];
}

/** The short list, in tour order — what a normal tour actually covers. */
export function coreQuestions(custom: CustomTourQuestion[] = []): TourQuestion[] {
  return tourQuestions(custom).filter((q) => q.core);
}

/** One stage of the tour, split into the short list and everything else. */
export function stageQuestions(stage: TourStage, custom: CustomTourQuestion[] = []): { core: TourQuestion[]; more: TourQuestion[] } {
  const here = tourQuestions(custom).filter((q) => q.stage === stage && !q.mine);
  return { core: here.filter((q) => q.core), more: here.filter((q) => !q.core) };
}

const recorded = (place: Place) => new Set(place.answers.filter((a) => a.answer !== undefined || (a.note ?? '').trim().length > 0).map((a) => a.id));

/**
 * How much of the tour you got through. The short list is what progress means —
 * counting all seventy would make a good tour look like a failure.
 */
export function checklistProgress(place: Place, custom: CustomTourQuestion[] = []): { answered: number; total: number; extra: number } {
  const all = tourQuestions(custom);
  const done = recorded(place);
  const core = all.filter((q) => q.core);
  return {
    answered: core.filter((q) => done.has(q.id)).length,
    total: core.length,
    extra: all.filter((q) => !q.core && done.has(q.id)).length,
  };
}

/** The questions with nothing recorded yet, short list first. */
export function unanswered(place: Place, custom: CustomTourQuestion[] = []): TourQuestion[] {
  const done = recorded(place);
  const left = tourQuestions(custom).filter((q) => !done.has(q.id));
  return [...left.filter((q) => q.core), ...left.filter((q) => !q.core)];
}

/**
 * What is left of the short list, split by who can answer it. Sixteen questions
 * for a leasing agent is a conversation; forty is an interrogation, and the
 * things only you can answer cost them nothing at all.
 */
export function stillToDo(place: Place, custom: CustomTourQuestion[] = []): { ask: TourQuestion[]; check: TourQuestion[] } {
  const left = unanswered(place, custom).filter((q) => q.core);
  return { ask: left.filter((q) => q.ask === 'them'), check: left.filter((q) => q.ask === 'you') };
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
const sumHigh = (parts: CostLine[]) => parts.reduce((total, p) => total + (p.high ?? p.amount), 0);
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
