import { describe, expect, it } from 'vitest';

import { spendingMap } from '../coverage';
import { emptyLedger } from '../factory';
import { buildSampleLedger } from '../sample';
import type { Transaction } from '../types';

const stamp = '2026-01-01T00:00:00.000Z';
let seq = 0;
const tx = (p: Partial<Transaction> & Pick<Transaction, 'type' | 'amount'>): Transaction => ({
  id: `t${++seq}`, date: '2026-06-01', description: 'x', accountId: 'chk', tags: [], attachments: [], createdAt: stamp, updatedAt: stamp, ...p,
});

describe('spendingMap', () => {
  it('totals areas, annualizes irregular costs and lists what may be missing', () => {
    const d = emptyLedger();
    d.accounts = [{ id: 'chk', name: 'c', type: 'checking', startingBalance: 1_000_000, startingDate: '2025-01-01', color: '#000', icon: 'x', tags: [], archived: false, createdAt: stamp, updatedAt: stamp }];
    d.transactions = [
      tx({ type: 'expense', amount: 12_000, date: '2025-10-01', categoryId: 'transportation.gas' }),
      tx({ type: 'expense', amount: 18_000, date: '2026-03-10', categoryId: 'transportation.registration' }),
      tx({ type: 'expense', amount: 5_000, date: '2026-04-01', categoryId: 'food.groceries' }),
      tx({ type: 'refund', amount: 1_000, date: '2026-04-02', categoryId: 'food.groceries' }),
      // Transfers never count as spending.
      tx({ type: 'transfer', amount: 99_999, date: '2026-04-03', categoryId: 'financial.savings', toAccountId: 'chk' }),
    ];
    const m = spendingMap(d, '2026-09-17');
    expect(m.total).toBe(12_000 + 18_000 + 4_000);
    const transport = m.areas.find((a) => a.id === 'transportation')!;
    expect(transport.total).toBe(30_000);
    expect(transport.trackedSubs).toBe(2);
    expect(m.areas.find((a) => a.id === 'financial')!.subs.some((s) => s.id === 'financial.savings')).toBe(false);
    // Having gas spending means the car-related reminders apply.
    const reg = m.irregular.find((i) => i.categoryId === 'transportation.registration')!;
    expect(reg.yearly).toBe(Math.round((18_000 / m.months) * 12));
    expect(m.missing.map((x) => x.categoryId)).toContain('transportation.inspection');
    expect(m.missing.map((x) => x.categoryId)).not.toContain('pets.vet');
    expect(m.missing.map((x) => x.categoryId)).not.toContain('housing.property_tax');
  });

  it('works on the sample ledger', () => {
    const m = spendingMap(buildSampleLedger('2026-09-17'), '2026-09-17');
    expect(m.total).toBeGreaterThan(0);
    expect(m.trackedAreas).toBeGreaterThan(5);
    expect(m.setAsideMonthly).toBeGreaterThanOrEqual(0);
    expect(m.months).toBe(12);
  });
});
