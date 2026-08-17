import {
  BPS_FULL,
  amountDue,
  classifyPayment,
  clearanceVerdict,
  formatMinor,
  ledgerBalance,
  minorFromString,
} from './finance.constants';

/**
 * The money math of docs/03 §11, proven without a database. These are the
 * numbers a bursary will defend to an auditor, so every branch speaks:
 *   - balance/outstanding derivation (§11.1),
 *   - the clearance predicate with waivers and loan cover (§11.4, Q-39),
 *   - under/over classification as first-class outcomes (§11.3 rule 5).
 */

describe('minor-unit handling', () => {
  it('parses digit strings into bigints', () => {
    expect(minorFromString('25000050')).toBe(25_000_050n);
    expect(minorFromString('0')).toBe(0n);
  });

  it('rejects anything that is not non-negative minor units', () => {
    expect(() => minorFromString('-1')).toThrow();
    expect(() => minorFromString('12.50')).toThrow();
    expect(() => minorFromString('1e3')).toThrow();
    expect(() => minorFromString('')).toThrow();
  });

  it('formats minor units as naira with kobo', () => {
    expect(formatMinor(25_000_050n)).toBe('₦250,000.50');
    expect(formatMinor(0n)).toBe('₦0.00');
    expect(formatMinor(5n)).toBe('₦0.05');
    expect(formatMinor(1_000_00n)).toBe('₦1,000.00');
  });
});

describe('ledger derivation (§11.1)', () => {
  it('derives the balance as credits minus debits', () => {
    // An unpaid invoice of ₦500.
    expect(ledgerBalance(50_000_00n, 0n)).toBe(-50_000_00n);
    // ...then a ₦500 payment clears it exactly.
    expect(ledgerBalance(50_000_00n, 50_000_00n)).toBe(0n);
  });

  it('floors amount-due at zero — an over-receipt is not a negative bill', () => {
    expect(amountDue(50_000_00n, 50_000_00n)).toBe(0n);
    expect(amountDue(50_000_00n, 60_000_00n)).toBe(0n);
    expect(amountDue(50_000_00n, 20_000_00n)).toBe(30_000_00n);
  });
});

describe('payment classification (§11.3 rule 5)', () => {
  it('names exact receipt', () => {
    expect(classifyPayment(30_000_00n, 30_000_00n)).toEqual({ kind: 'EXACT', delta: 0n });
  });

  it('names the shortfall on a partial payment', () => {
    expect(classifyPayment(20_000_00n, 30_000_00n)).toEqual({
      kind: 'PARTIAL',
      delta: 10_000_00n,
    });
  });

  it('names the excess on an overpayment', () => {
    expect(classifyPayment(35_000_00n, 30_000_00n)).toEqual({
      kind: 'OVERPAYMENT',
      delta: 5_000_00n,
    });
  });
});

describe('fee-clearance predicate (§11.4, INV-16)', () => {
  const inv = (total: bigint, paid: bigint, waived = 0n) => ({
    totalAmount: total,
    paidAmount: paid,
    waivedAmount: waived,
  });

  it('reports not-invoiced (NOT_ENFORCED semantics) rather than cleared', () => {
    const verdict = clearanceVerdict({ invoices: [], loanCovered: 0n, thresholdBps: BPS_FULL });
    expect(verdict.invoiced).toBe(false);
    expect(verdict.cleared).toBe(false);
    expect(verdict.shortfall).toBe(0n);
  });

  it('clears a fully paid invoice', () => {
    const verdict = clearanceVerdict({
      invoices: [inv(50_000_00n, 50_000_00n)],
      loanCovered: 0n,
      thresholdBps: BPS_FULL,
    });
    expect(verdict).toMatchObject({ invoiced: true, cleared: true, shortfall: 0n });
  });

  it('keeps a partially paid invoice short', () => {
    const verdict = clearanceVerdict({
      invoices: [inv(50_000_00n, 20_000_00n)],
      loanCovered: 0n,
      thresholdBps: BPS_FULL,
    });
    expect(verdict.cleared).toBe(false);
    expect(verdict.shortfall).toBe(30_000_00n);
  });

  it('lets an approved waiver cover the remainder', () => {
    const verdict = clearanceVerdict({
      invoices: [inv(50_000_00n, 20_000_00n, 30_000_00n)],
      loanCovered: 0n,
      thresholdBps: BPS_FULL,
    });
    expect(verdict.cleared).toBe(true);
  });

  /** Q-39: a loan-funded student registers on the strength of the loan. */
  it('lets an approved loan clearance cover the shortfall', () => {
    const verdict = clearanceVerdict({
      invoices: [inv(50_000_00n, 10_000_00n)],
      loanCovered: 40_000_00n,
      thresholdBps: BPS_FULL,
    });
    expect(verdict.cleared).toBe(true);
    expect(verdict.covered).toBe(50_000_00n);
  });

  it('caps per-invoice coverage at the invoice total — cross-invoice pooling is forbidden', () => {
    // Two ₦50k invoices; ₦80k paid all against the FIRST. The second stays
    // unpaid even though aggregate cover exceeds aggregate billing.
    const verdict = clearanceVerdict({
      invoices: [inv(50_000_00n, 80_000_00n), inv(50_000_00n, 0n)],
      loanCovered: 0n,
      thresholdBps: BPS_FULL,
    });
    expect(verdict.cleared).toBe(false);
    expect(verdict.covered).toBe(50_000_00n);
    expect(verdict.shortfall).toBe(50_000_00n);
  });

  it('applies a part-payment threshold as a floor, not a rounding rule', () => {
    const half = clearanceVerdict({
      invoices: [inv(50_000_00n, 25_000_00n)],
      loanCovered: 0n,
      thresholdBps: 5000,
    });
    expect(half.cleared).toBe(true);
    // The shortfall is still reported — the student cleared, finance sees it.
    expect(half.shortfall).toBe(25_000_00n);

    const justUnder = clearanceVerdict({
      invoices: [inv(50_000_00n, 24_999_00n)],
      loanCovered: 0n,
      thresholdBps: 5000,
    });
    expect(justUnder.cleared).toBe(false);
  });

  it('rounds the required amount UP — 50% of an odd-kobo bill is never undercharged', () => {
    const verdict = clearanceVerdict({
      invoices: [inv(100n, 50n)],
      loanCovered: 0n,
      thresholdBps: 5000,
    });
    expect(verdict.cleared).toBe(true);
    const shortfallOne = clearanceVerdict({
      invoices: [inv(101n, 50n)],
      loanCovered: 0n,
      thresholdBps: 5000,
    });
    // required = ceil(101 * 5000 / 10000) = 51 → 50 is not enough.
    expect(shortfallOne.cleared).toBe(false);
  });
});
