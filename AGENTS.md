# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# MasterFinance

Local-first personal finance command center for a single user. Expo SDK 57, expo-router (routes in `src/app`), TypeScript, zustand. UI language inspired by the Deltex Webflow template (Inter, `#2469FE` blue, blue→sky gradient hero cards, soft grey panels, pill badges).

Commands: `npm run typecheck`, `npm test` (vitest, domain logic), `npm run web`.

## Architecture

- `src/domain/` — pure, framework-free financial logic. **All money is integer cents; all dates are `YYYY-MM-DD` strings.** Never do money math in screens that the domain already provides.
  - `types.ts` data model · `catalog.ts` enum metadata (labels/icons) · `ledger.ts` postings, balances, classification · `schedule.ts` scheduled events (bills, paychecks, debt due dates) · `position.ts` net worth + available-to-spend · `reports.ts` period stats & monthly review · `budgets.ts` · `goals.ts` · `debt.ts` (summary + payoff simulation) · `forecast.ts` · `scenarios.ts` · `alerts.ts` · `search.ts` · `validation.ts` · `backup.ts` · `sample.ts` · `merchantText.ts` (statement text → merchant fingerprint) · `merchants.ts` (what you usually do with a merchant).
- `src/store/ledger.ts` — the single zustand store. Mutate **only** through `ledger.*` actions; they validate and return `Result` (`{ ok: true, id } | { ok: false, errors }`). Destructive actions are undoable via `ledger.undo()`.
- `src/store/hooks.ts` — `useData()`, `useToday()`, `useSettings()`, `useMoney()` (formatter honoring currency + privacy mode), `useDerived(fn)`.
- `src/components/ui/` — design system (import from `@/components/ui`). `src/components/finance/` — shared finance rows (`TransactionRow`, `EventRow`, `AccountRow`, `DateBadge`) and pickers (`AccountSelect`, `CategorySelect`, `FrequencySelect`, `MonthSwitcher`, `accountOptions`, `categoryOptions`).

## Integrity rules (do not break)

- Balances are derived, never stored. To set a balance use `ledger.updateBalance` (records an adjustment).
- Income/spending come only from transaction type (`incomeAmount` / `spendingAmount`). Transfers, debt payments and investment contributions are never income or spending.
- Expected things (bills, paychecks, debt payments) come from `scheduledEvents` / `openEvents`. Paying an occurrence uses `ledger.payOccurrence` so it is linked and never double-counted.
- Savings goals allocate money that already sits in an account; `validateContribution` blocks over-allocation.
- Scenarios are pure projections (`compareScenario`) and never write data. Always label them **Hypothetical**.
- Always visually distinguish **actual** vs **projected/expected** numbers (use `Pill tone="projected"`, dashed lines, "Projected"/"Expected" labels).

## UI conventions

- Tab screens: `<Screen tabBar>` with `ScreenTitle`. Stack screens: `<Screen header={<NavHeader title=… right={…} />}>`. Forms: `<Screen header={<NavHeader title=… backIcon="x" />} footer={<Button label="Save" size="lg" fullWidth … />}>`.
- Amounts: `<Money cents=… />` or `useMoney()`; never `toFixed` on money. Signs: income `tone="flow"`/green, spending ink, transfers neutral grey.
- Colors/spacing/typography only from `@/theme/tokens`. Status is never color-only: pair with an icon or label (`StatusBadge`, `Banner`).
- Charts only from the UI kit (`LineChart`, `ColumnChart`, `HBarList`, `Sparkline`, `SplitBar`). Title each chart as the question it answers. One y-axis. Series colors from `series` in tokens (fixed order).
- Confirm destructive actions with `useOverlay().confirm({ destructive: true })`, then show `toast({ message, actionLabel: 'Undo', onAction: ledger.undo })`.
- Don't nest pressables (a `Card onPress` must not contain `Button`s/`Pill onPress`). Don't use the `pointerEvents` prop; use `style={{ pointerEvents }}`.
- Every list has an `EmptyState` with a primary action. Every screen works with an empty ledger.
- Routes use plain strings (`router.push('/bills/abc')` or `{ pathname, params }`); typed routes are off.

## Taxes & categories

- `domain/taxTables.ts` holds IRS amounts per year with source links; update it each fall. Unknown years fall back to the latest table and the UI says so.
- `domain/taxes.ts` is a US federal planning estimate. Spending counts for taxes through the category's `taxTag` unless the transaction overrides it (`taxRelated: false` opts out, `taxCategory` sets a tag). Income is classified by the category's `incomeTax`.
- Deposits into 401(k)/IRA/HSA accounts are never taxable income. Paycheck `grossAmount` minus pre-tax `withholding` (retirement, HSA, benefits) is taxable wages.
- Q4 estimated payments made in January count toward the prior year (`estimatedPaymentsFor`).
- Tax records live in `data.taxYears` (documents, adjustments, mileage) and `data.taxProfile`; change them only through the store's tax actions.
- Every default category has an emoji in `data/visuals.ts`; add one when adding a category and run `npm run build:icons`.
- `domain/coverage.ts` (Spending map) lists irregular costs by category id; keep ids in sync with `defaultCategories.ts`.

## Suggestions from your own history

- `domain/merchants.ts` is the one place that learns habits from past transactions: `merchantProfiles`, `suggestFor`, `categoryFor`, plus the tidy-up queue (`needsCategory`, `groupNeedsCategory`). Quick add, the CSV importer and `/tidy` all read it, so a suggestion never depends on which screen asked.
- A habit needs at least 2 past transactions with 60% agreement. Splits and archived categories are never learned from, and money in is kept apart from money out.
- Suggestions are defaults, never decisions: filling a field is fine, writing to the ledger without the user is not. Bulk filing goes through `ledger.categorizeTransactions` so it is a single undo.

## Splits & side ledgers

- A transaction may carry `splits` (lines that add up to `amount`). Never read `tx.categoryId` alone for spending analysis: use `categoryLines(tx)` / `categoryIdsOf(tx)` from `domain/ledger.ts`, which return one line per split or a single line otherwise.
- Splits only apply to spending types and are validated to sum to the total, so a split can never change what was spent.
- `data.sinkingFunds` reserve money that already sits in an account (like goal allocations) — they never create transactions, and reserves reduce available-to-spend.
- `data.policies` (insurance and warranties) and `data.ious` are records, not accounts: they don't post to balances. An IOU only moves money when the user also records a real transaction, linked by `entries[].txId`.
- Medical spending can be flagged `reimbursableFrom: 'hsa' | 'fsa'` with `reimbursedOn` once claimed.
