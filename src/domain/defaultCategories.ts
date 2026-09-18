import type { Category, IncomeTaxKind, TaxTag } from './types';

/**
 * Default taxonomy: meant to cover essentially everything a person spends
 * money on or earns, two levels deep. Each subcategory can carry tax meaning
 * (`taxTag` for spending, `incomeTax` for income) so the Taxes hub can find
 * deductible spending and taxable income without extra bookkeeping.
 *
 * Credit card payments, loan payments, savings and investing are recorded as
 * `debt_payment` / transfer transactions. Their Financial subcategories are
 * labels only: spending totals are decided by transaction type, so a card
 * purchase is counted once (when made) and never again when the card is paid.
 */

type Sub = [slug: string, name: string, opts?: { essential?: boolean; tax?: TaxTag; income?: IncomeTaxKind; icon?: string }];
type Def = { id: string; name: string; icon: string; color: string; essential: boolean; subs: Sub[] };

const EXPENSE: Def[] = [
  {
    id: 'housing', name: 'Housing', icon: 'home', color: '#2469FE', essential: true,
    subs: [
      ['rent', 'Rent'],
      ['mortgage', 'Mortgage payment'],
      ['property_tax', 'Property tax', { tax: 'property_tax', icon: 'file-text' }],
      ['hoa', 'HOA dues'],
      ['home_insurance', 'Home insurance', { icon: 'shield' }],
      ['renters_insurance', "Renter's insurance", { icon: 'shield' }],
      ['utilities', 'Electricity', { icon: 'zap' }],
      ['gas_heating', 'Gas & heating', { icon: 'thermometer' }],
      ['water', 'Water & sewer', { icon: 'droplet' }],
      ['trash', 'Trash & recycling', { icon: 'trash-2' }],
      ['internet', 'Internet', { icon: 'wifi' }],
      ['phone', 'Phone', { icon: 'smartphone' }],
      ['maintenance', 'Repairs & maintenance', { icon: 'tool' }],
      ['furniture', 'Furniture', { essential: false }],
      ['appliances', 'Appliances'],
      ['cleaning', 'Cleaning & housekeeping', { essential: false }],
      ['lawn_garden', 'Lawn & garden', { essential: false }],
      ['pest_control', 'Pest control'],
      ['security', 'Home security'],
      ['storage', 'Storage unit', { essential: false }],
      ['moving', 'Moving costs', { essential: false }],
    ],
  },
  {
    id: 'transportation', name: 'Transportation', icon: 'truck', color: '#0EA5E9', essential: true,
    subs: [
      ['car_payment', 'Car payment'],
      ['car_lease', 'Car lease'],
      ['insurance', 'Car insurance', { icon: 'shield' }],
      ['gas', 'Gas', { icon: 'droplet' }],
      ['ev_charging', 'EV charging', { icon: 'battery-charging' }],
      ['maintenance', 'Maintenance', { icon: 'tool' }],
      ['repairs', 'Repairs', { icon: 'tool' }],
      ['tires', 'Tires'],
      ['registration', 'Registration & DMV', { icon: 'file-text' }],
      ['inspection', 'Inspection & emissions'],
      ['parking', 'Parking', { essential: false }],
      ['tolls', 'Tolls'],
      ['public_transit', 'Public transit', { icon: 'navigation' }],
      ['rideshare', 'Rideshare & taxis', { essential: false, icon: 'navigation' }],
      ['bike_scooter', 'Bike & scooter', { essential: false }],
      ['car_wash', 'Car wash', { essential: false }],
      ['roadside', 'Roadside assistance'],
      ['tickets', 'Tickets & fines', { essential: false }],
    ],
  },
  {
    id: 'food', name: 'Food & drink', icon: 'coffee', color: '#F59E0B', essential: false,
    subs: [
      ['groceries', 'Groceries', { essential: true, icon: 'shopping-cart' }],
      ['restaurants', 'Restaurants'],
      ['fast_food', 'Fast food'],
      ['coffee', 'Coffee'],
      ['delivery', 'Delivery & takeout', { icon: 'package' }],
      ['alcohol', 'Alcohol & bars'],
      ['snacks', 'Snacks & vending'],
      ['work_meals', 'Work lunches'],
    ],
  },
  {
    id: 'health', name: 'Health', icon: 'heart', color: '#E5484D', essential: true,
    subs: [
      ['medical', 'Doctor & medical', { tax: 'medical' }],
      ['dental', 'Dental', { tax: 'medical' }],
      ['vision', 'Vision & glasses', { tax: 'medical', icon: 'eye' }],
      ['medication', 'Prescriptions', { tax: 'medical', icon: 'plus-square' }],
      ['otc', 'Over-the-counter & first aid', { tax: 'hsa_eligible' }],
      ['therapy', 'Therapy & mental health', { tax: 'medical', icon: 'message-circle' }],
      ['hospital', 'Hospital & urgent care', { tax: 'medical' }],
      ['labs', 'Labs & tests', { tax: 'medical' }],
      ['medical_devices', 'Medical equipment', { tax: 'medical' }],
      ['health_insurance', 'Health insurance premiums', { tax: 'medical', icon: 'shield' }],
      ['fitness', 'Gym & fitness', { essential: false, icon: 'activity' }],
      ['supplements', 'Vitamins & supplements', { essential: false }],
    ],
  },
  {
    id: 'personal_care', name: 'Personal care', icon: 'smile', color: '#EC4899', essential: false,
    subs: [
      ['haircuts', 'Haircuts & salon', { icon: 'scissors' }],
      ['toiletries', 'Toiletries', { essential: true }],
      ['cosmetics', 'Skincare & cosmetics'],
      ['nails', 'Nails'],
      ['spa', 'Spa & massage'],
    ],
  },
  {
    id: 'clothing', name: 'Clothing', icon: 'shopping-bag', color: '#DB2777', essential: false,
    subs: [
      ['clothes', 'Clothes'],
      ['shoes', 'Shoes'],
      ['accessories', 'Accessories & jewelry'],
      ['laundry', 'Laundry & dry cleaning', { essential: true }],
      ['uniforms', 'Work clothes & uniforms', { essential: true }],
    ],
  },
  {
    id: 'shopping', name: 'Shopping', icon: 'shopping-cart', color: '#A855F7', essential: false,
    subs: [
      ['household', 'Household supplies', { essential: true, icon: 'home' }],
      ['electronics', 'Electronics'],
      ['home_decor', 'Home decor'],
      ['books', 'Books'],
      ['office_supplies', 'Office supplies'],
      ['online', 'Online shopping'],
      ['hobby_supplies', 'Hobby & craft supplies'],
      ['sporting_goods', 'Sporting goods'],
    ],
  },
  {
    id: 'entertainment', name: 'Entertainment', icon: 'film', color: '#8B5CF6', essential: false,
    subs: [
      ['movies', 'Movies & shows'],
      ['events', 'Concerts & events'],
      ['games', 'Video games'],
      ['hobbies', 'Hobbies'],
      ['sports', 'Sports & recreation'],
      ['music', 'Music & instruments'],
      ['nightlife', 'Nightlife & parties'],
      ['dating', 'Dating'],
      ['gambling', 'Lottery & gambling'],
    ],
  },
  {
    id: 'travel', name: 'Travel', icon: 'map', color: '#06B6D4', essential: false,
    subs: [
      ['general', 'Trip spending'],
      ['flights', 'Flights', { icon: 'send' }],
      ['lodging', 'Hotels & lodging'],
      ['car_rental', 'Car rental'],
      ['activities', 'Tours & activities'],
      ['travel_insurance', 'Travel insurance', { icon: 'shield' }],
      ['passport', 'Passport & visas'],
      ['souvenirs', 'Souvenirs'],
    ],
  },
  {
    id: 'kids', name: 'Kids & family', icon: 'users', color: '#F97316', essential: true,
    subs: [
      ['childcare', 'Daycare & childcare', { tax: 'childcare' }],
      ['babysitting', 'Babysitting', { tax: 'childcare', essential: false }],
      ['school_tuition', 'School tuition'],
      ['school_supplies', 'School supplies'],
      ['activities', 'Lessons & activities', { essential: false }],
      ['toys', 'Toys & games', { essential: false }],
      ['baby_supplies', 'Baby supplies & diapers'],
      ['kids_clothing', "Kids' clothing"],
      ['allowance', 'Allowance', { essential: false }],
      ['child_support', 'Child support paid'],
      ['elder_care', 'Elder & family care'],
    ],
  },
  {
    id: 'pets', name: 'Pets', icon: 'heart', color: '#84CC16', essential: true,
    subs: [
      ['pet_food', 'Pet food'],
      ['vet', 'Vet'],
      ['pet_insurance', 'Pet insurance', { icon: 'shield' }],
      ['grooming', 'Grooming', { essential: false }],
      ['pet_supplies', 'Pet supplies'],
      ['boarding', 'Boarding & walking', { essential: false }],
    ],
  },
  {
    id: 'education', name: 'Education', icon: 'book-open', color: '#0C0407', essential: true,
    subs: [
      ['tuition', 'College tuition & fees', { tax: 'education' }],
      ['books', 'Textbooks & supplies', { tax: 'education' }],
      ['courses', 'Courses & training', { essential: false, tax: 'education' }],
      ['certifications', 'Certifications & exams'],
      ['student_fees', 'Student fees', { tax: 'education' }],
    ],
  },
  {
    id: 'insurance', name: 'Insurance', icon: 'shield', color: '#475569', essential: true,
    subs: [
      ['life', 'Life insurance'],
      ['disability', 'Disability insurance'],
      ['umbrella', 'Umbrella liability'],
      ['long_term_care', 'Long-term care'],
      ['identity', 'Identity protection', { essential: false }],
      ['other', 'Other insurance'],
    ],
  },
  {
    id: 'subscriptions', name: 'Subscriptions', icon: 'refresh-cw', color: '#14B8A6', essential: false,
    subs: [
      ['streaming', 'Streaming video', { icon: 'tv' }],
      ['music', 'Music & audio'],
      ['software', 'Software & AI tools', { icon: 'code' }],
      ['cloud', 'Cloud storage'],
      ['news', 'News & magazines'],
      ['memberships', 'Memberships & clubs', { icon: 'award' }],
      ['apps', 'Apps', { icon: 'smartphone' }],
      ['gaming', 'Gaming subscriptions'],
    ],
  },
  {
    id: 'giving', name: 'Gifts & giving', icon: 'gift', color: '#E11D48', essential: false,
    subs: [
      ['gifts', 'Gifts'],
      ['charity', 'Charitable donations', { tax: 'charitable', icon: 'heart' }],
      ['religious', 'Religious giving', { tax: 'charitable' }],
      ['holidays', 'Holidays'],
      ['celebrations', 'Weddings, birthdays & parties'],
      ['crowdfunding', 'Crowdfunding & helping friends'],
    ],
  },
  {
    id: 'business', name: 'Work & business', icon: 'briefcase', color: '#7C3AED', essential: false,
    subs: [
      ['supplies', 'Business supplies', { tax: 'business' }],
      ['software', 'Business software', { tax: 'business' }],
      ['equipment', 'Equipment', { tax: 'business' }],
      ['advertising', 'Advertising & marketing', { tax: 'business' }],
      ['contractors', 'Contractors', { tax: 'business' }],
      ['professional_fees', 'Legal & professional fees', { tax: 'business' }],
      ['licenses', 'Licenses & dues', { tax: 'business' }],
      ['business_travel', 'Business travel', { tax: 'business' }],
      ['business_meals', 'Business meals', { tax: 'business' }],
      ['phone_internet', 'Business phone & internet', { tax: 'business' }],
      ['coworking', 'Coworking & rent', { tax: 'business' }],
      ['shipping', 'Shipping & postage', { tax: 'business' }],
      ['home_office', 'Home office', { tax: 'home_office' }],
      ['work_expenses', 'Unreimbursed job expenses'],
    ],
  },
  {
    id: 'financial', name: 'Fees & finance', icon: 'percent', color: '#64748B', essential: true,
    subs: [
      ['interest', 'Interest charges'],
      ['bank_fees', 'Bank & account fees', { icon: 'alert-circle' }],
      ['late_fees', 'Late fees'],
      ['atm_fees', 'ATM fees'],
      ['annual_fees', 'Card annual fees'],
      ['advisor_fees', 'Financial advice & investing fees'],
      // Labels for transfer-type transactions; never counted as spending.
      ['credit_card_payments', 'Credit card payments', { icon: 'credit-card' }],
      ['loan_payments', 'Loan payments', { icon: 'check-circle' }],
      ['investments', 'Investments', { icon: 'trending-up' }],
      ['savings', 'Savings', { icon: 'shield' }],
    ],
  },
  {
    id: 'taxes', name: 'Taxes', icon: 'file-text', color: '#334155', essential: true,
    subs: [
      ['federal_estimated', 'Federal estimated tax', { tax: 'federal_estimated' }],
      ['state_estimated', 'State estimated tax', { tax: 'state_estimated' }],
      ['federal_income', 'Federal tax due'],
      ['state_income', 'State & local income tax', { tax: 'state_local_tax' }],
      ['other_tax', 'Other taxes'],
      ['tax_prep', 'Tax preparation', { tax: 'tax_prep' }],
      ['penalties', 'Tax penalties & interest'],
    ],
  },
  {
    id: 'legal', name: 'Legal & government', icon: 'book', color: '#57534E', essential: true,
    subs: [
      ['legal_fees', 'Legal fees'],
      ['government_fees', 'Government fees & permits'],
      ['fines', 'Fines & court costs', { essential: false }],
      ['immigration', 'Immigration & visas'],
    ],
  },
  {
    id: 'other', name: 'Other', icon: 'more-horizontal', color: '#94A3B8', essential: false,
    subs: [
      ['misc', 'Miscellaneous'],
      ['cash', 'Cash spending (untracked)'],
      ['adjustment', 'Adjustments & corrections'],
    ],
  },
];

const INCOME: Def[] = [
  {
    id: 'income', name: 'Income', icon: 'arrow-down-left', color: '#16A34A', essential: true,
    subs: [
      ['paycheck', 'Paycheck', { income: 'wages' }],
      ['overtime', 'Overtime', { income: 'overtime' }],
      ['bonus', 'Bonus', { income: 'wages' }],
      ['commission', 'Commission', { income: 'wages' }],
      ['tips', 'Tips', { income: 'tips' }],
      ['freelance', 'Freelance', { income: 'self_employment' }],
      ['side_business', 'Side business', { income: 'self_employment' }],
      ['reselling', 'Reselling for profit', { income: 'self_employment' }],
      ['rental', 'Rental income', { income: 'rental' }],
      ['royalties', 'Royalties', { income: 'other_taxable' }],
      ['interest', 'Interest', { income: 'interest' }],
      ['dividends', 'Dividends', { income: 'dividends' }],
      ['capital_gains', 'Investment gains (sold)', { income: 'capital_gains' }],
      ['investment', 'Other investment income', { income: 'other_taxable' }],
      ['retirement', 'Pension & retirement withdrawals', { income: 'retirement' }],
      ['social_security', 'Social Security', { income: 'social_security' }],
      ['unemployment', 'Unemployment', { income: 'unemployment' }],
      ['benefits', 'Benefits & assistance', { income: 'nontaxable' }],
      ['child_support', 'Child support received', { income: 'nontaxable' }],
      ['gifts', 'Gifts received', { income: 'nontaxable' }],
      ['tax_refund', 'Tax refund', { income: 'nontaxable' }],
      ['rewards', 'Cash back & rewards', { income: 'nontaxable' }],
      ['sold_items', 'Sold personal items', { income: 'nontaxable' }],
      ['gambling', 'Gambling & prize winnings', { income: 'other_taxable' }],
      ['other', 'Other income', { income: 'other_taxable' }],
    ],
  },
];

export function buildDefaultCategories(): Category[] {
  const out: Category[] = [];
  const add = (defs: Def[], kind: Category['kind']) => {
    defs.forEach((def, i) => {
      out.push({ id: def.id, name: def.name, parentId: null, kind, icon: def.icon, color: def.color, essential: def.essential, archived: false, order: i });
      def.subs.forEach(([slug, name, opts = {}], j) => {
        out.push({
          id: `${def.id}.${slug}`,
          name,
          parentId: def.id,
          kind,
          icon: opts.icon ?? def.icon,
          color: def.color,
          essential: opts.essential ?? def.essential,
          archived: false,
          order: j,
          ...(opts.tax ? { taxTag: opts.tax } : {}),
          ...(opts.income ? { incomeTax: opts.income } : {}),
        });
      });
    });
  };
  add(EXPENSE, 'expense');
  add(INCOME, 'income');
  return out;
}

/** Category ids from earlier versions that moved in the expanded taxonomy. */
export const LEGACY_CATEGORY_MAP: Record<string, string> = {
  'shopping.clothing': 'clothing.clothes',
  'shopping.personal': 'personal_care.toiletries',
  'shopping.gifts': 'giving.gifts',
  'entertainment.travel': 'travel.general',
  'financial.taxes': 'taxes.federal_income',
  'financial.insurance': 'insurance.life',
  'other.donations': 'giving.charity',
};

export const SYSTEM_CATEGORY = {
  interest: 'financial.interest',
  paycheck: 'income.paycheck',
  interestIncome: 'income.interest',
  dividends: 'income.dividends',
  otherIncome: 'income.other',
  misc: 'other.misc',
  cardPayments: 'financial.credit_card_payments',
  loanPayments: 'financial.loan_payments',
  investments: 'financial.investments',
  savings: 'financial.savings',
  federalEstimated: 'taxes.federal_estimated',
  stateEstimated: 'taxes.state_estimated',
} as const;

export const TRANSFER_LABEL_CATEGORIES: string[] = [
  SYSTEM_CATEGORY.cardPayments,
  SYSTEM_CATEGORY.loanPayments,
  SYSTEM_CATEGORY.investments,
  SYSTEM_CATEGORY.savings,
];
