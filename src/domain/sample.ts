import { SYSTEM_CATEGORY } from './defaultCategories';
import {
  addDays,
  addMonths,
  addMonthsToMonth,
  dayOfWeek,
  lastMonths,
  monthEnd,
  monthOf,
  monthStart,
  todayISO,
  toISODate,
  parseISODate,
  daysInMonth,
} from './dates';
import { createId, emptyLedger, nowStamp } from './factory';
import { balanceOn, indexLedger } from './ledger';
import { occurrencesBetween } from './recurrence';
import { estimatedPaymentDueDates } from './taxTables';
import type {
  Account,
  Asset,
  Budget,
  Cents,
  FavoriteTransaction,
  Goal,
  GoalContribution,
  ID,
  IncomeSource,
  ISODate,
  LedgerData,
  RecurringItem,
  Scenario,
  Transaction,
} from './types';

/**
 * Deterministic, realistic sample ledger covering the last 12 months. Every
 * balance is produced by real transactions through the same ledger rules the
 * app uses, so sample numbers reconcile exactly. The whole dataset is flagged
 * `meta.isSample` and can be wiped from Settings.
 */

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const $ = (dollars: number): Cents => Math.round(dollars * 100);

/** $3,050 gross minus these = $2,250 take-home. */
const PAYCHECK_WITHHOLDING = { federal: 24_000, state: 10_667, socialSecurity: 18_910, medicare: 4_423, retirement: 18_000, hsa: 4_000 };

export function buildSampleLedger(today: ISODate = todayISO()): LedgerData {
  const rng = mulberry32(20260916);
  const between = (min: number, max: number) => $(min + rng() * (max - min));
  const chance = (p: number) => rng() < p;
  const pick = <T,>(items: T[]) => items[Math.floor(rng() * items.length)];

  const stamp = nowStamp();
  const data = emptyLedger();
  data.meta = { ...data.meta, isSample: true, onboarded: true };
  const start = monthStart(addMonthsToMonth(monthOf(today), -12));
  const dayIn = (month: string, day: number) => {
    const [y, m] = month.split('-').map(Number);
    return toISODate(y, m, Math.min(day, daysInMonth(y, m)));
  };

  // ─── Electricity, with a prior year ────────────────────────────────────────
  /**
   * The electricity bill is the seasonal one, so it gets six months of extra
   * history: the price-change report compares the last six months against the
   * *same* six months a year earlier, and without a prior year that guard is
   * never exercised. The amounts repeat season for season, a touch under 1%
   * cheaper a year ago — a real difference, but far too small to be reported
   * as a price rise once the seasons line up.
   */
  const historyStart = monthStart(addMonthsToMonth(monthOf(start), -6));
  const ELECTRIC: Cents[] = [10_512, 11_038, 9_174, 7_806, 8_243, 9_627, 12_038, 12_614, 11_205, 8_418, 7_962, 9_384];
  const electricCharge = (date: ISODate): Cents => {
    const base = ELECTRIC[parseISODate(date).month - 1];
    return date <= addMonths(today, -12) ? Math.round(base * 0.991) : base;
  };
  const electricStart = dayIn(monthOf(historyStart), 15);
  // Checking opens six months early to carry those bills; its opening balance
  // absorbs them, so every balance from `start` onwards is exactly as before.
  const electricOpening = occurrencesBetween(electricStart, { unit: 'month', interval: 1 }, historyStart, addDays(start, -1)).reduce(
    (total, date) => total + electricCharge(date),
    0,
  );

  // ─── Accounts ──────────────────────────────────────────────────────────────
  const account = (a: Partial<Account> & Pick<Account, 'id' | 'name' | 'type' | 'startingBalance' | 'color' | 'icon'>): Account => ({
    startingDate: start,
    tags: [],
    archived: false,
    createdAt: stamp,
    updatedAt: stamp,
    ...a,
  });

  const A = {
    checking: 'acc_checking',
    savings: 'acc_savings',
    wallet: 'acc_wallet',
    sapphire: 'acc_sapphire',
    citi: 'acc_citi',
    redcard: 'acc_redcard',
    auto: 'acc_auto',
    student: 'acc_student',
    roth: 'acc_roth',
    brokerage: 'acc_brokerage',
    k401: 'acc_401k',
    hsa: 'acc_hsa',
  };

  data.accounts = [
    account({ id: A.checking, name: 'Everyday Checking', institution: 'Chase', type: 'checking', startingDate: historyStart, startingBalance: $(3800) + electricOpening, spendable: true, color: '#2469FE', icon: 'credit-card' }),
    account({ id: A.savings, name: 'High-Yield Savings', institution: 'Ally', type: 'savings', startingBalance: $(5200), apr: 4.2, color: '#16A34A', icon: 'shield' }),
    account({ id: A.wallet, name: 'Wallet', type: 'cash', startingBalance: $(80), spendable: true, color: '#64748B', icon: 'dollar-sign' }),
    account({ id: A.sapphire, name: 'Sapphire Preferred', institution: 'Chase', type: 'credit_card', startingBalance: $(1150), creditLimit: $(9000), apr: 24.99, minimumPayment: $(40), plannedPayment: 'statement', dueDay: 12, statementClosingDay: 16, color: '#0C0407', icon: 'credit-card', tags: [] }),
    account({ id: A.citi, name: 'Citi Simplicity', institution: 'Citi', type: 'credit_card', startingBalance: $(4200), creditLimit: $(5000), apr: 27.49, promoApr: 0, promoExpires: addDays(today, 50), minimumPayment: $(35), paymentAmount: $(250), plannedPayment: 'fixed', dueDay: 24, statementClosingDay: 28, color: '#0EA5E9', icon: 'credit-card', notes: '0% balance transfer promo. Pay off before it ends.' }),
    account({ id: A.redcard, name: 'Target RedCard', institution: 'Target', type: 'store_card', startingBalance: $(640), creditLimit: $(1200), apr: 29.95, minimumPayment: $(30), paymentAmount: $(80), plannedPayment: 'fixed', dueDay: 8, statementClosingDay: 12, color: '#E5484D', icon: 'shopping-bag' }),
    account({ id: A.auto, name: 'Auto Loan', institution: 'Toyota Financial', type: 'auto_loan', startingBalance: $(16800), originalBalance: $(22000), apr: 6.4, paymentAmount: $(425), minimumPayment: $(425), dueDay: 5, color: '#F59E0B', icon: 'truck', tags: ['car'] }),
    account({ id: A.student, name: 'Student Loans', institution: 'Nelnet', type: 'student_loan', startingBalance: $(21500), originalBalance: $(28000), apr: 4.99, paymentAmount: $(310), minimumPayment: $(310), dueDay: 20, color: '#8B5CF6', icon: 'book-open' }),
    account({ id: A.roth, name: 'Roth IRA', institution: 'Fidelity', type: 'roth_ira', startingBalance: $(8400), startingCostBasis: $(7200), color: '#14B8A6', icon: 'sun' }),
    account({ id: A.brokerage, name: 'Brokerage', institution: 'Vanguard', type: 'brokerage', startingBalance: $(4100), startingCostBasis: $(3900), color: '#2469FE', icon: 'trending-up' }),
    account({ id: A.k401, name: '401(k)', institution: 'Empower', type: '401k', startingBalance: $(14200), startingCostBasis: $(12000), color: '#0C0407', icon: 'briefcase' }),
    account({ id: A.hsa, name: 'HSA', institution: 'HealthEquity', type: 'hsa', startingBalance: $(1200), startingCostBasis: $(1150), color: '#EC4899', icon: 'heart' }),
  ];

  // ─── Assets ────────────────────────────────────────────────────────────────
  const valuation = (date: ISODate, value: number) => ({ id: createId('val'), date, value: $(value) });
  data.assets = [
    {
      id: 'asset_car', name: '2021 Toyota Corolla', type: 'vehicle', purchasePrice: $(23500), purchaseDate: '2021-06-12',
      valuations: [valuation('2021-06-12', 23500), valuation(start, 19800), valuation(addMonths(start, 4), 19100), valuation(addMonths(start, 8), 18400), valuation(addDays(today, -20), 17600)],
      linkedLiabilityId: A.auto, expenseTag: 'car', notes: 'Estimate from Kelley Blue Book private-party value.', tags: ['car'], archived: false, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'asset_laptop', name: 'MacBook Pro', type: 'electronics', purchasePrice: $(2399), purchaseDate: addMonths(start, -10),
      valuations: [valuation(addMonths(start, -10), 2399), valuation(start, 1900), valuation(addDays(today, -40), 1500)],
      notes: 'Used for freelance work.', tags: ['work'], archived: false, createdAt: stamp, updatedAt: stamp,
    },
  ] satisfies Asset[];

  // ─── Income sources ────────────────────────────────────────────────────────
  let anchor = today;
  while (dayOfWeek(anchor) !== 5) anchor = addDays(anchor, -1);
  while (anchor > start) anchor = addDays(anchor, -14);

  const S = { paycheck: 'inc_paycheck', freelance: 'inc_freelance', interest: 'inc_interest', dividends: 'inc_dividends' };
  const source = (s: Partial<IncomeSource> & Pick<IncomeSource, 'id' | 'name' | 'type' | 'depositAccountId'>): IncomeSource => ({
    active: true, tags: [], createdAt: stamp, updatedAt: stamp, ...s,
  });
  data.incomeSources = [
    source({ id: S.paycheck, name: 'Acme Corp paycheck', type: 'salary', employer: 'Acme Corp', frequency: { unit: 'week', interval: 2 }, anchorDate: anchor, expectedGross: $(3050), expectedNet: $(2250), depositAccountId: A.checking, categoryId: SYSTEM_CATEGORY.paycheck, taxForm: 'W-2', withholding: PAYCHECK_WITHHOLDING, match: { percent: 50, upToPercent: 6 }, notes: 'Pre-tax 401(k) contribution of $180 per paycheck goes straight to Empower.' }),
    source({ id: S.freelance, name: 'Freelance design', type: 'freelance', depositAccountId: A.checking, categoryId: 'income.freelance', tags: ['work'] }),
    source({ id: S.interest, name: 'Ally savings interest', type: 'interest', frequency: { unit: 'month', interval: 1 }, anchorDate: dayIn(monthOf(start), 28), expectedNet: $(30), depositAccountId: A.savings, categoryId: SYSTEM_CATEGORY.interestIncome }),
    source({ id: S.dividends, name: 'Vanguard dividends', type: 'dividends', frequency: { unit: 'month', interval: 3 }, anchorDate: dayIn(addMonthsToMonth(monthOf(start), 2), 25), expectedNet: $(28), depositAccountId: A.brokerage, categoryId: SYSTEM_CATEGORY.dividends }),
  ];

  // ─── Recurring ─────────────────────────────────────────────────────────────
  const recurring = (r: Partial<RecurringItem> & Pick<RecurringItem, 'id' | 'name' | 'kind' | 'amount' | 'accountId'> & { day: number }): RecurringItem => {
    const { day, ...rest } = r;
    return {
      variable: false, frequency: { unit: 'month', interval: 1 }, startDate: dayIn(monthOf(start), day), autopay: true, essential: true, active: true, skipped: [], tags: [], createdAt: stamp, updatedAt: stamp, ...rest,
    };
  };
  const yearly = (day: number, monthsAgo: number) => dayIn(addMonthsToMonth(monthOf(today), -monthsAgo), day);

  data.recurring = [
    recurring({ id: 'rec_rent', name: 'Rent', kind: 'bill', amount: $(1450), accountId: A.checking, day: 1, categoryId: 'housing.rent', payee: 'Maple Court Apartments', autopay: false }),
    recurring({ id: 'rec_electric', name: 'Electric', kind: 'bill', amount: $(95), variable: true, accountId: A.checking, day: 15, startDate: electricStart, categoryId: 'housing.utilities', payee: 'City Power & Light', autopay: false }),
    recurring({ id: 'rec_internet', name: 'Internet', kind: 'bill', amount: $(70), accountId: A.sapphire, day: 8, categoryId: 'housing.internet', payee: 'Fiberlink' }),
    recurring({ id: 'rec_phone', name: 'Phone plan', kind: 'bill', amount: $(55), accountId: A.checking, day: 21, categoryId: 'housing.phone', payee: 'Mint Mobile' }),
    recurring({ id: 'rec_carins', name: 'Car insurance', kind: 'bill', amount: $(138), accountId: A.checking, day: 3, categoryId: 'transportation.insurance', payee: 'Geico', tags: ['car'] }),
    recurring({ id: 'rec_renters', name: 'Renters insurance', kind: 'bill', amount: $(15), accountId: A.checking, day: 10, categoryId: 'housing.renters_insurance', payee: 'Lemonade' }),
    recurring({ id: 'rec_gym', name: 'Gym membership', kind: 'subscription', amount: $(40), accountId: A.sapphire, day: 6, categoryId: 'health.fitness', payee: 'Crunch Fitness', essential: false, usage: 'sometimes' }),
    recurring({ id: 'rec_netflix', name: 'Netflix', kind: 'subscription', amount: $(15.49), accountId: A.sapphire, day: 12, categoryId: 'subscriptions.streaming', essential: false, usage: 'often' }),
    recurring({ id: 'rec_spotify', name: 'Spotify', kind: 'subscription', amount: $(9.99), accountId: A.sapphire, day: 18, categoryId: 'subscriptions.streaming', essential: false, usage: 'often' }),
    recurring({ id: 'rec_icloud', name: 'iCloud+', kind: 'subscription', amount: $(2.99), accountId: A.sapphire, day: 2, categoryId: 'subscriptions.software', essential: false, usage: 'often' }),
    recurring({ id: 'rec_adobe', name: 'Adobe Creative Cloud', kind: 'subscription', amount: $(22.99), accountId: A.sapphire, day: 25, categoryId: 'subscriptions.software', essential: false, usage: 'rarely', lastUsed: addDays(today, -52), tags: ['work'] }),
    recurring({ id: 'rec_gamepass', name: 'Xbox Game Pass', kind: 'subscription', amount: $(16.99), accountId: A.sapphire, day: 9, categoryId: 'subscriptions.memberships', essential: false, usage: 'never', lastUsed: addDays(today, -118) }),
    recurring({ id: 'rec_prime', name: 'Amazon Prime', kind: 'subscription', amount: $(139), frequency: { unit: 'year', interval: 1 }, accountId: A.sapphire, day: 14, startDate: yearly(14, 7), categoryId: 'subscriptions.memberships', essential: false, usage: 'often' }),
    recurring({ id: 'rec_1password', name: 'Password manager', kind: 'subscription', amount: $(36), frequency: { unit: 'year', interval: 1 }, accountId: A.sapphire, day: 20, startDate: yearly(20, 10), categoryId: 'subscriptions.software', essential: false, usage: 'often' }),
    recurring({ id: 'rec_autoloan', name: 'Auto loan payment', kind: 'debt_payment', amount: $(425), accountId: A.checking, toAccountId: A.auto, day: 5, categoryId: SYSTEM_CATEGORY.loanPayments, payee: 'Toyota Financial', tags: ['car'] }),
    recurring({ id: 'rec_savings', name: 'Transfer to savings', kind: 'savings', amount: $(400), accountId: A.checking, toAccountId: A.savings, day: 2, categoryId: SYSTEM_CATEGORY.savings }),
    recurring({ id: 'rec_roth', name: 'Roth IRA contribution', kind: 'investment', amount: $(250), accountId: A.checking, toAccountId: A.roth, day: 3, categoryId: SYSTEM_CATEGORY.investments }),
  ];

  // ─── Transactions ──────────────────────────────────────────────────────────
  const txs: Transaction[] = [];
  const add = (t: Omit<Transaction, 'id' | 'tags' | 'attachments' | 'createdAt' | 'updatedAt'> & { tags?: string[] }) => {
    const { tags, ...rest } = t;
    const tx: Transaction = { id: createId('tx'), tags: tags ?? [], attachments: [], createdAt: stamp, updatedAt: stamp, ...rest };
    txs.push(tx);
    return tx;
  };

  /**
   * Prices move. Netflix put its price up twice this year and the saved
   * amount was never corrected — so the app has a genuinely stale figure to
   * offer to fix. Spotify moved to a cheaper plan and its amount *was*
   * updated, so a drop shows up with nothing left to do about it.
   */
  const CHARGES: Record<ID, { base: Cents; steps: { monthsAgo: number; amount: Cents }[] }> = {
    rec_netflix: { base: $(15.49), steps: [{ monthsAgo: 9, amount: $(16.99) }, { monthsAgo: 3, amount: $(17.99) }] },
    rec_spotify: { base: $(11.99), steps: [{ monthsAgo: 4, amount: $(9.99) }] },
  };
  const chargeAmount = (r: RecurringItem, date: ISODate): Cents => {
    if (r.id === 'rec_electric') return electricCharge(date);
    if (r.variable) return between(r.amount / 100 - 35, r.amount / 100 + 25);
    const history = CHARGES[r.id];
    if (!history) return r.amount;
    let amount = history.base;
    for (const step of history.steps) if (date >= addMonths(today, -step.monthsAgo)) amount = step.amount;
    return amount;
  };

  // Recurring payments, settled against their occurrences. A non-autopay bill
  // due in the last two days is left unpaid so it shows up as overdue.
  for (const r of data.recurring) {
    const from = r.id === 'rec_electric' ? historyStart : start;
    for (const date of occurrencesBetween(r.startDate, r.frequency, from, today, r.endDate)) {
      if (!r.autopay && date > addDays(today, -2)) continue;
      const amount = chargeAmount(r, date);
      const type = r.kind === 'debt_payment' ? 'debt_payment' : r.kind === 'savings' || r.kind === 'transfer' ? 'transfer' : r.kind === 'investment' ? 'investment_contribution' : 'expense';
      add({ type, amount, date, description: r.name, payee: r.payee ?? r.name, categoryId: r.categoryId, accountId: r.accountId, toAccountId: r.toAccountId, recurringId: r.id, occurrenceDate: date, tags: r.tags });
    }
  }

  // Paychecks and payroll retirement contributions.
  for (const date of occurrencesBetween(anchor, { unit: 'week', interval: 2 }, start, today)) {
    add({ type: 'income', amount: $(2250), date, description: 'Paycheck', payee: 'Acme Corp', categoryId: SYSTEM_CATEGORY.paycheck, accountId: A.checking, incomeSourceId: S.paycheck, occurrenceDate: date, grossAmount: $(3050), withholding: PAYCHECK_WITHHOLDING });
    add({ type: 'income', amount: $(180), date, description: '401(k) payroll contribution (pre-tax)', payee: 'Acme Corp', categoryId: SYSTEM_CATEGORY.paycheck, accountId: A.k401, notes: 'Employee contribution withheld from paycheck.' });
    add({ type: 'income', amount: $(40), date, description: 'HSA payroll contribution', payee: 'Acme Corp', categoryId: SYSTEM_CATEGORY.paycheck, accountId: A.hsa, tags: ['medical'] });
  }

  const everyday: { p: number; category: string; payees: string[]; min: number; max: number; accounts: [ID, number][]; tags?: string[] }[] = [
    { p: 1 / 7, category: 'food.groceries', payees: ["Trader Joe's", 'Whole Foods', 'Kroger', 'Costco'], min: 45, max: 150, accounts: [[A.sapphire, 0.8], [A.checking, 1]] },
    { p: 1.3 / 7, category: 'food.restaurants', payees: ['Chipotle', 'Thai Basil', 'Sushi House', 'Pizzeria Uno', 'Taqueria El Sol'], min: 14, max: 48, accounts: [[A.sapphire, 0.85], [A.checking, 1]] },
    { p: 1 / 7, category: 'food.fast_food', payees: ["McDonald's", 'Chick-fil-A', 'Five Guys'], min: 8, max: 17, accounts: [[A.sapphire, 0.6], [A.wallet, 1]] },
    { p: 2 / 7, category: 'food.coffee', payees: ['Blue Bottle', 'Starbucks', 'Corner Café'], min: 4.5, max: 7.25, accounts: [[A.sapphire, 0.65], [A.wallet, 1]] },
    { p: 0.05, category: 'food.delivery', payees: ['DoorDash', 'Uber Eats'], min: 24, max: 46, accounts: [[A.sapphire, 1]] },
    { p: 0.1, category: 'transportation.gas', payees: ['Shell', 'Chevron', 'Costco Gas'], min: 36, max: 58, accounts: [[A.sapphire, 1]], tags: ['car'] },
    { p: 0.04, category: 'transportation.parking', payees: ['City Parking', 'ParkMobile'], min: 4, max: 18, accounts: [[A.sapphire, 1]], tags: ['car'] },
    { p: 0.03, category: 'transportation.rideshare', payees: ['Uber', 'Lyft'], min: 12, max: 28, accounts: [[A.sapphire, 1]] },
    { p: 0.07, category: 'shopping.household', payees: ['Amazon'], min: 14, max: 85, accounts: [[A.sapphire, 1]] },
    { p: 0.06, category: 'shopping.household', payees: ['Target'], min: 18, max: 62, accounts: [[A.redcard, 1]] },
    { p: 0.02, category: 'clothing.clothes', payees: ['Uniqlo', 'Nordstrom Rack', 'Everlane'], min: 35, max: 120, accounts: [[A.sapphire, 1]] },
    { p: 0.03, category: 'personal_care.toiletries', payees: ['Sephora', 'CVS'], min: 12, max: 45, accounts: [[A.sapphire, 0.7], [A.checking, 1]] },
    { p: 0.03, category: 'entertainment.movies', payees: ['AMC Theatres'], min: 14, max: 32, accounts: [[A.sapphire, 1]] },
    { p: 0.02, category: 'entertainment.games', payees: ['Steam', 'Nintendo eShop'], min: 20, max: 70, accounts: [[A.sapphire, 1]] },
    { p: 0.01, category: 'entertainment.events', payees: ['Ticketmaster', 'Eventbrite'], min: 45, max: 150, accounts: [[A.sapphire, 1]] },
    { p: 0.03, category: 'health.medication', payees: ['Walgreens', 'CVS Pharmacy'], min: 10, max: 32, accounts: [[A.checking, 1]], tags: ['medical'] },
  ];

  let atmCounter = 0;
  for (let date = start; date <= today; date = addDays(date, 1)) {
    for (const item of everyday) {
      if (!chance(item.p)) continue;
      const roll = rng();
      const accountId = item.accounts.find(([, cumulative]) => roll <= cumulative)![0];
      const payee = pick(item.payees);
      const max = payee === 'Costco' ? item.max + 90 : item.max;
      add({ type: 'expense', amount: between(item.min, max), date, description: payee, payee, categoryId: item.category, accountId, tags: item.tags });
    }
    if (++atmCounter % 24 === 0) {
      add({ type: 'transfer', amount: $(50), date, description: 'ATM withdrawal', accountId: A.checking, toAccountId: A.wallet });
    }
  }

  // Occasional, larger or special activity.
  const monthsBack = (n: number, day: number) => dayIn(addMonthsToMonth(monthOf(today), -n), day);
  for (let n = 11; n >= 0; n -= 2) {
    const date = monthsBack(n, 17);
    if (date <= today) add({ type: 'income', amount: between(300, 900), date, description: 'Logo & brand project', payee: pick(['Northwind Studio', 'Bright Bakery', 'Fern & Co']), categoryId: 'income.freelance', accountId: A.checking, incomeSourceId: S.freelance, tags: ['work'] });
  }
  add({ type: 'income', amount: $(1800), date: monthsBack(6, 15), description: 'Annual performance bonus', payee: 'Acme Corp', categoryId: 'income.bonus', accountId: A.checking, tags: ['work'] });
  add({ type: 'income', amount: $(1120), date: monthsBack(5, 9), description: 'Federal tax refund', payee: 'IRS', categoryId: 'income.tax_refund', accountId: A.checking, taxRelated: true, taxCategory: 'other', tags: ['tax'] });
  add({ type: 'expense', amount: $(65), date: monthsBack(10, 11), description: 'Oil change', payee: 'Jiffy Lube', categoryId: 'transportation.maintenance', accountId: A.sapphire, tags: ['car'] });
  add({ type: 'expense', amount: $(69), date: monthsBack(6, 22), description: 'Oil change & rotation', payee: 'Jiffy Lube', categoryId: 'transportation.maintenance', accountId: A.sapphire, tags: ['car'] });
  add({ type: 'expense', amount: $(72), date: monthsBack(2, 4), description: 'Oil change', payee: 'Jiffy Lube', categoryId: 'transportation.maintenance', accountId: A.sapphire, tags: ['car'] });
  add({ type: 'expense', amount: $(386.4), date: monthsBack(4, 19), description: 'Brake pads & rotors', payee: 'Midas', categoryId: 'transportation.repairs', accountId: A.sapphire, tags: ['car'], notes: 'Front brakes. Warranty 24 months.' });
  add({ type: 'expense', amount: $(168), date: monthsBack(8, 7), description: 'Vehicle registration', payee: 'DMV', categoryId: 'transportation.registration', accountId: A.checking, tags: ['car'], essential: true });
  add({ type: 'expense', amount: $(120), date: monthsBack(9, 13), description: 'Dental cleaning copay', payee: 'Bright Smiles Dental', categoryId: 'health.dental', accountId: A.checking, tags: ['medical'], taxRelated: true, taxCategory: 'medical', reimbursableFrom: 'hsa' });
  add({ type: 'expense', amount: $(45), date: monthsBack(3, 13), description: 'Urgent care copay', payee: 'CityMD', categoryId: 'health.medical', accountId: A.checking, tags: ['medical'], taxRelated: true, taxCategory: 'medical', reimbursableFrom: 'hsa' });
  add({ type: 'expense', amount: $(100), date: monthsBack(1, 28), description: 'Donation', payee: 'Local Food Bank', categoryId: 'giving.charity', accountId: A.checking, taxRelated: true, taxCategory: 'charitable' });
  add({ type: 'expense', amount: $(412.6), date: monthsBack(3, 2), description: 'Flights to Denver', payee: 'Southwest', categoryId: 'travel.flights', accountId: A.sapphire, tags: ['vacation'] });
  add({ type: 'expense', amount: $(538), date: monthsBack(3, 21), description: 'Hotel', payee: 'Hilton', categoryId: 'travel.lodging', accountId: A.sapphire, tags: ['vacation'] });
  const refunded = add({ type: 'expense', amount: $(42.99), date: monthsBack(2, 9), description: 'Desk lamp', payee: 'Amazon', categoryId: 'shopping.household', accountId: A.sapphire });
  add({ type: 'refund', amount: $(42.99), date: monthsBack(2, 16), description: 'Return: desk lamp', payee: 'Amazon', categoryId: 'shopping.household', accountId: A.sapphire, notes: `Refund for purchase on ${refunded.date}.` });
  add({ type: 'expense', amount: $(86.3), date: monthsBack(1, 10), description: 'Client dinner', payee: 'Thai Basil', categoryId: 'food.restaurants', accountId: A.sapphire, tags: ['work'] });
  add({ type: 'reimbursement', amount: $(86.3), date: monthsBack(1, 24), description: 'Expense report reimbursement', payee: 'Acme Corp', categoryId: 'food.restaurants', accountId: A.checking, tags: ['work'] });
  add({ type: 'investment_contribution', amount: $(500), date: monthsBack(6, 18), description: 'Invest part of bonus', accountId: A.checking, toAccountId: A.brokerage, categoryId: SYSTEM_CATEGORY.investments });

  // Planned future expense so the forecast shows a scheduled item.
  add({ type: 'expense', amount: $(128), date: addDays(today, 9), description: 'Concert tickets', payee: 'Ticketmaster', categoryId: 'entertainment.events', accountId: A.sapphire, notes: 'Planned purchase' });

  // Month-by-month items that depend on running balances.
  const months = lastMonths(monthOf(today), 13);
  const snapshot = () => indexLedger({ ...data, transactions: [...txs] });
  for (const month of months) {
    const first = monthStart(month);
    const current = first <= today;
    if (!current) continue;

    // Loan and card interest posts on the 1st (promo cards accrue nothing).
    if (first > start) {
      for (const id of [A.auto, A.student, A.redcard]) {
        const acc = data.accounts.find((a) => a.id === id)!;
        const balance = balanceOn(snapshot(), id, addDays(first, -1));
        const interest = Math.round((balance * (acc.apr ?? 0)) / 1200);
        if (interest > 0) add({ type: 'interest', amount: interest, date: first, description: 'Interest charged', payee: acc.institution, categoryId: SYSTEM_CATEGORY.interest, accountId: id });
      }
    }

    const pay = (id: ID, day: number, amount: Cents, description: string) => {
      const date = dayIn(month, day);
      if (date > today || amount <= 0) return;
      add({ type: 'debt_payment', amount, date, description, accountId: A.checking, toAccountId: id, categoryId: SYSTEM_CATEGORY.cardPayments });
    };

    // Sapphire: pay last month's statement in full.
    const closing = dayIn(addMonthsToMonth(month, -1), 16);
    if (closing >= start) pay(A.sapphire, 12, balanceOn(snapshot(), A.sapphire, closing), 'Sapphire payment');
    pay(A.citi, 24, Math.min($(250), balanceOn(snapshot(), A.citi, dayIn(month, 23))), 'Citi payment');
    pay(A.redcard, 8, $(80), 'RedCard payment');
    const studentDate = dayIn(month, 20);
    if (studentDate <= today) add({ type: 'debt_payment', amount: $(310), date: studentDate, description: 'Student loan payment', payee: 'Nelnet', accountId: A.checking, toAccountId: A.student, categoryId: SYSTEM_CATEGORY.loanPayments });

    // Savings interest and quarterly dividends.
    const interestDate = dayIn(month, 28);
    if (interestDate <= today && interestDate > start) {
      const bal = balanceOn(snapshot(), A.savings, interestDate);
      add({ type: 'income', amount: Math.round((bal * 4.2) / 1200), date: interestDate, description: 'Interest paid', payee: 'Ally', categoryId: SYSTEM_CATEGORY.interestIncome, accountId: A.savings, incomeSourceId: S.interest, occurrenceDate: interestDate });
    }
    const divSource = data.incomeSources.find((s) => s.id === S.dividends)!;
    for (const date of occurrencesBetween(divSource.anchorDate!, divSource.frequency!, first, monthEnd(month))) {
      if (date <= today) add({ type: 'income', amount: between(22, 36), date, description: 'Dividend reinvested', payee: 'Vanguard', categoryId: SYSTEM_CATEGORY.dividends, accountId: A.brokerage, incomeSourceId: S.dividends, occurrenceDate: date });
    }

    // Month-end market moves for investment accounts.
    const valueDate = monthEnd(month) <= today ? monthEnd(month) : null;
    if (valueDate) {
      const idx = snapshot();
      for (const id of [A.roth, A.brokerage, A.k401, A.hsa]) {
        const bal = balanceOn(idx, id, valueDate);
        const change = Math.round(bal * (-0.025 + rng() * 0.06));
        if (change !== 0) add({ type: 'adjustment', adjustmentKind: 'valuation', amount: change, date: valueDate, description: 'Market value update', accountId: id });
      }
    }
  }

  // Keep statement balances current for the cards.
  const finalIndex = indexLedger({ ...data, transactions: txs });
  const { day: todayDay } = parseISODate(today);
  for (const acc of data.accounts) {
    if (!acc.statementClosingDay) continue;
    const closeMonth = todayDay >= acc.statementClosingDay ? monthOf(today) : addMonthsToMonth(monthOf(today), -1);
    acc.statementBalance = Math.max(0, balanceOn(finalIndex, acc.id, dayIn(closeMonth, acc.statementClosingDay)));
  }
  data.transactions = txs;

  // ─── Goals & allocations ───────────────────────────────────────────────────
  const goal = (g: Partial<Goal> & Pick<Goal, 'id' | 'name' | 'kind' | 'template' | 'target' | 'icon' | 'color'>): Goal => ({
    linkedAccountIds: [], startDate: start, tags: [], archived: false, createdAt: stamp, updatedAt: stamp, ...g,
  });
  data.goals = [
    goal({ id: 'goal_emergency', name: 'Emergency fund', kind: 'savings', template: 'emergency', target: $(10000), icon: 'umbrella', color: '#16A34A', notes: 'Target: about 4 months of essential expenses.' }),
    goal({ id: 'goal_moveout', name: 'Move-out fund', kind: 'savings', template: 'move_out', target: $(6000), targetDate: addMonths(today, 8), icon: 'home', color: '#2469FE', tags: ['moving'], notes: 'Deposit, first month, furniture.' }),
    goal({ id: 'goal_japan', name: 'Japan trip', kind: 'savings', template: 'vacation', target: $(4500), targetDate: addMonths(today, 11), startDate: addMonths(start, 6), icon: 'map', color: '#F59E0B', tags: ['vacation'] }),
    goal({ id: 'goal_student', name: 'Pay off student loans', kind: 'debt_payoff', template: 'custom', target: $(28000), startValue: $(28000), linkedAccountIds: [A.student], icon: 'book-open', color: '#8B5CF6' }),
    goal({ id: 'goal_roth', name: 'Roth IRA to $15K', kind: 'investment', template: 'custom', target: $(15000), linkedAccountIds: [A.roth], icon: 'trending-up', color: '#14B8A6' }),
    goal({ id: 'goal_networth', name: 'Net worth $25K', kind: 'net_worth', template: 'custom', target: $(25000), icon: 'bar-chart-2', color: '#0C0407' }),
  ];

  const contributions: GoalContribution[] = [];
  const contribute = (goalId: ID, date: ISODate, amount: Cents, note?: string) =>
    contributions.push({ id: createId('gc'), goalId, date, amount, accountId: A.savings, note, createdAt: stamp });
  contribute('goal_emergency', start, $(4500), 'Starting balance');
  contribute('goal_moveout', start, $(500), 'Starting balance');
  for (const month of months) {
    const date = dayIn(month, 3);
    if (date <= start || date > today) continue;
    contribute('goal_emergency', date, $(250));
    contribute('goal_moveout', date, $(100));
    if (date >= addMonths(start, 6)) contribute('goal_japan', date, $(50));
  }
  data.goalContributions = contributions;

  // ─── Budgets, favorites, scenarios ─────────────────────────────────────────
  const budget = (categoryId: ID, amount: number, mode: Budget['mode'] = 'limit', rollover = false): Budget => ({
    id: `bud_${categoryId}`, categoryId, mode, rollover, amounts: [{ month: monthOf(start), amount: $(amount) }],
  });
  data.budgets = [
    budget('food', 950),
    budget('food.restaurants', 300),
    budget('shopping', 350),
    budget('entertainment', 150, 'flexible', true),
    budget('transportation', 320),
    budget('subscriptions', 120),
  ];

  data.favorites = [
    { id: 'fav_coffee', label: 'Coffee', type: 'expense', amount: $(6.5), categoryId: 'food.coffee', accountId: A.sapphire, payee: 'Blue Bottle', tags: [] },
    { id: 'fav_lunch', label: 'Lunch', type: 'expense', amount: $(14), categoryId: 'food.fast_food', accountId: A.sapphire, tags: [] },
    { id: 'fav_gas', label: 'Gas', type: 'expense', amount: $(45), categoryId: 'transportation.gas', accountId: A.sapphire, tags: ['car'] },
    { id: 'fav_groceries', label: 'Groceries', type: 'expense', categoryId: 'food.groceries', accountId: A.sapphire, tags: [] },
  ] satisfies FavoriteTransaction[];

  const scenario = (s: Omit<Scenario, 'createdAt' | 'updatedAt'>): Scenario => ({ ...s, createdAt: stamp, updatedAt: stamp });
  data.scenarios = [
    scenario({
      id: 'sc_moveout', name: 'Move into a 1-bedroom', notes: 'Rent goes up, plus a one-time deposit and furniture.', horizonMonths: 24,
      changes: [
        { id: createId('chg'), type: 'change_recurring', recurringId: 'rec_rent', newAmount: $(1750), startMonth: 2 },
        { id: createId('chg'), type: 'expense_change', label: 'Higher utilities', monthlyAmount: $(40), startMonth: 2 },
        { id: createId('chg'), type: 'one_time', label: 'Deposit & furniture', amount: -$(3200), month: 2 },
      ],
    }),
    scenario({
      id: 'sc_extra_student', name: 'Extra $200 on student loans', horizonMonths: 60,
      changes: [{ id: createId('chg'), type: 'extra_debt_payment', monthlyAmount: $(200), accountId: A.student, startMonth: 0 }],
    }),
  ];

  // Taxes: side-gig estimated payments, business costs and a profile.
  for (const { due } of estimatedPaymentDueDates(Number(today.slice(0, 4)))) {
    if (due >= start && due <= today) add({ type: 'expense', amount: $(200), date: due, description: 'Federal estimated tax', payee: 'IRS Direct Pay', categoryId: SYSTEM_CATEGORY.federalEstimated, accountId: A.checking, tags: ['tax'] });
  }
  for (let n = 10; n >= 0; n -= 3) {
    add({ type: 'expense', amount: $(59.99), date: monthsBack(n, 6), description: 'Design software', payee: 'Adobe', categoryId: 'business.software', accountId: A.sapphire, tags: ['work'] });
  }
  data.taxProfile = { ...data.taxProfile, hsaCoverage: 'self', stateRate: 4.5, priorYearTax: $(4100), priorYearAgi: $(71_000), configured: true };
  data.taxYears = [
    {
      year: Number(today.slice(0, 4)),
      documents: [],
      adjustments: [],
      mileage: [
        { id: 'mi_sample_1', date: monthsBack(2, 11), miles: 34, purpose: 'business', note: 'Client meeting · Fern & Co' },
        { id: 'mi_sample_2', date: monthsBack(1, 3), miles: 18, purpose: 'medical', note: 'Physical therapy' },
      ].filter((m) => m.date <= today && m.date.startsWith(today.slice(0, 4))) as LedgerData['taxYears'][number]['mileage'],
    },
  ];

  // A split purchase, medical bills kept for an HSA reimbursement, reserves,
  // policies and IOUs: one of each so every screen has something to show.
  add({
    type: 'expense', amount: $(126.4), date: monthsBack(0, 8), description: 'Target run', payee: 'Target', categoryId: 'food.groceries', accountId: A.redcard,
    splits: [
      { id: 'sp_sample_1', categoryId: 'food.groceries', amount: $(68.2) },
      { id: 'sp_sample_2', categoryId: 'housing.cleaning', amount: $(24.5), note: 'Detergent & paper towels' },
      { id: 'sp_sample_3', categoryId: 'giving.gifts', amount: $(33.7), note: "Nephew's birthday", essential: false },
    ],
  });

  data.sinkingFunds = [
    {
      id: 'sink_car', name: 'Car registration & repairs', emoji: 'automobile', categoryId: 'transportation.registration', yearlyTarget: $(720), monthly: $(60), accountId: A.savings,
      dueDate: dayIn(addMonthsToMonth(monthOf(today), 4), 12),
      entries: [
        { id: 'se_1', date: monthsBack(2, 2), amount: $(60) },
        { id: 'se_2', date: monthsBack(1, 2), amount: $(60) },
        { id: 'se_3', date: monthsBack(0, 2), amount: $(60) },
      ],
      archived: false, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'sink_holidays', name: 'Holiday gifts', emoji: 'wrapped-gift', categoryId: 'giving.holidays', yearlyTarget: $(600), monthly: $(50), accountId: A.savings,
      dueDate: dayIn(`${Number(today.slice(0, 4))}-12`, 15),
      entries: [
        { id: 'se_4', date: monthsBack(2, 2), amount: $(50) },
        { id: 'se_5', date: monthsBack(1, 2), amount: $(50) },
      ],
      archived: false, createdAt: stamp, updatedAt: stamp,
    },
  ];

  data.policies = [
    {
      id: 'pol_auto', kind: 'auto', name: 'Auto insurance', provider: 'Geico', policyNumber: 'GEC-4471902', premium: $(138), premiumFrequency: { unit: 'month', interval: 1 },
      deductible: $(500), coverage: $(100000), startDate: monthsBack(8, 3), renewalDate: dayIn(addMonthsToMonth(monthOf(today), 4), 3), linkedAssetId: 'asset_car', recurringId: 'rec_carins',
      contact: '1-800-861-8380', documents: [], claims: [], tags: ['car'], archived: false, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'pol_renters', kind: 'renters', name: 'Renters insurance', provider: 'Lemonade', premium: $(15), premiumFrequency: { unit: 'month', interval: 1 },
      deductible: $(250), coverage: $(30000), startDate: monthsBack(10, 10), renewalDate: dayIn(addMonthsToMonth(monthOf(today), 2), 10), recurringId: 'rec_renters',
      documents: [], claims: [], tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'pol_laptop', kind: 'warranty', name: 'MacBook AppleCare+', provider: 'Apple', coverage: $(2399), startDate: addMonths(start, -10), renewalDate: addMonths(start, 14),
      linkedAssetId: 'asset_laptop', documents: [], claims: [], tags: ['work'], archived: false, createdAt: stamp, updatedAt: stamp,
    },
  ];

  data.ious = [
    {
      id: 'iou_concert', person: 'Jordan', direction: 'owed_to_me', amount: $(120), date: monthsBack(1, 22), reason: 'Concert tickets I bought for both of us',
      entries: [{ id: 'ie_1', date: monthsBack(0, 4), amount: $(60), note: 'Venmo' }], tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
    },
    {
      id: 'iou_sibling', person: 'Sam', direction: 'i_owe', amount: $(300), date: monthsBack(3, 6), dueDate: dayIn(addMonthsToMonth(monthOf(today), 1), 6), reason: 'Covered my share of the family gift',
      entries: [], tags: [], archived: false, createdAt: stamp, updatedAt: stamp,
    },
  ];

  data.meta.updatedAt = stamp;
  return data;
}
