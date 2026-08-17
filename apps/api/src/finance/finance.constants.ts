/**
 * Pure finance math for docs/03 §11. Deliberately side-effect-free so the
 * money logic can be tested without a database: a wrong here moves real money.
 *
 * Conventions:
 *  - ALL amounts are integer minor units (kobo), as `bigint` internally and as
 *    digit strings on the wire (§11.5: floats lose precision inside the range
 *    of real Nigerian school fees).
 *  - The ledger is the truth (INV-14). Balances are always DERIVED — sums over
 *    appended entries, never stored numbers.
 *  - Direction: DEBIT raises a charge (an invoice issued), CREDIT retires one
 *    (a payment posted, a waiver granted). `debits − credits` is therefore the
 *    outstanding receivable.
 */

/** Digit-string bound shared with the DTOs: ≤ 13 digits of kobo. */
export const MINOR_AMOUNT_RE = /^\d{1,13}$/;

/** Percentage basis. 10000 = 100%. */
export const BPS_FULL = 10000;

/** Parse a wire amount (digit string of minor units) into a bigint. */
export function minorFromString(value: string): bigint {
  if (!MINOR_AMOUNT_RE.test(value)) {
    throw new Error(`Invalid minor-units amount: "${value}"`);
  }
  return BigInt(value);
}

/**
 * Minor units → naira string for human-facing messages, e.g. 25000050 →
 * "₦250,000.50" — the shape a student can compare to a bank alert.
 */
export function formatMinor(minor: bigint): string {
  const naira = minor / 100n;
  const kobo = minor % 100n;
  return `₦${naira.toLocaleString('en-NG')}.${kobo.toString().padStart(2, '0')}`;
}

/** The §11.1 balance: Σ credits − Σ debits. Non-negative means paid-in-full. */
export function ledgerBalance(debits: bigint, credits: bigint): bigint {
  return credits - debits;
}

/** Outstanding receivable: Σ debits − Σ credits, floored at zero. */
export function amountDue(debits: bigint, credits: bigint): bigint {
  const due = debits - credits;
  return due > 0n ? due : 0n;
}

// --- Fee clearance (INV-16) --------------------------------------------------

export interface ClearableInvoice {
  totalAmount: bigint;
  /** Net of payment postings and payment reversals. */
  paidAmount: bigint;
  /** Sum of APPROVED waivers pinned to the invoice. */
  waivedAmount: bigint;
}

export interface ClearanceInput {
  invoices: ClearableInvoice[];
  /** APPROVED loan clearances for the session (Q-39), minor units. */
  loanCovered: bigint;
  /** Minimum cleared fraction in basis points (10000 = full payment, Q-17). */
  thresholdBps: number;
}

export interface ClearanceVerdict {
  /** False when no invoice exists for the session — the gate is UNDECIDABLE,
   *  not satisfied (see eligibility NOT_ENFORCED semantics). */
  invoiced: boolean;
  cleared: boolean;
  /** Positive shortfall after payments, waivers and loan cover, minor units. */
  shortfall: bigint;
  billed: bigint;
  covered: bigint;
}

function bigintMax(a: bigint, b: bigint): bigint {
  return a > b ? a : b;
}

function bigintMin(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}

/**
 * The derived fee-clearance predicate of §11.4. Clearance is a QUERY, never a
 * stored boolean:
 *
 *   cleared ⇔ Σ(min(total, paid + waived) + loan cover) ≥ billed × threshold
 *
 * Deliberate mechanics:
 *  - Coverage per invoice is CAPPED at its total: an overpayment on one invoice
 *    cannot clear the shortfall on another. Money is owed to a specific charge
 *    until it is formally forwarded.
 *  - Loan cover is session-scoped (not pinned to one invoice) because a loan is
 *    a promise to fund the session, not a payment of a line.
 *  - The threshold is a FLOOR, not a rounding rule: a 50% threshold clears the
 *    student at 50% even though a balance remains — the shortfall is still
 *    reported so finance sees it.
 */
export function clearanceVerdict(input: ClearanceInput): ClearanceVerdict {
  if (input.invoices.length === 0) {
    return { invoiced: false, cleared: false, shortfall: 0n, billed: 0n, covered: 0n };
  }

  let billed = 0n;
  let covered = 0n;
  for (const inv of input.invoices) {
    billed += inv.totalAmount;
    covered += bigintMin(inv.totalAmount, inv.paidAmount + inv.waivedAmount);
  }
  covered += bigintMin(bigintMax(billed - covered, 0n), bigintMax(input.loanCovered, 0n));

  const required =
    (billed * BigInt(clampThreshold(input.thresholdBps)) + BigInt(BPS_FULL - 1)) / BigInt(BPS_FULL);

  return {
    invoiced: true,
    cleared: covered >= required,
    shortfall: bigintMax(billed - covered, 0n),
    billed,
    covered,
  };
}

function clampThreshold(bps: number): number {
  if (!Number.isInteger(bps) || bps < 1) return BPS_FULL;
  return Math.min(bps, BPS_FULL);
}

// --- Payment classification ---------------------------------------------------

export type PaymentKind = 'EXACT' | 'PARTIAL' | 'OVERPAYMENT';

export interface PaymentClassification {
  kind: PaymentKind;
  /** Shortfall (PARTIAL) or excess (OVERPAYMENT), minor units. */
  delta: bigint;
}

/**
 * Classify a received amount against an invoice's outstanding balance. R8 is
 * explicit that exact-amount entry matters and mismatches stall transactions,
 * so UNDER/OVER are surfaced as first-class outcomes rather than silently
 * accepted (docs/03 §11.3 rule 5).
 */
export function classifyPayment(amount: bigint, outstanding: bigint): PaymentClassification {
  if (amount === outstanding) return { kind: 'EXACT', delta: 0n };
  if (amount < outstanding) return { kind: 'PARTIAL', delta: outstanding - amount };
  return { kind: 'OVERPAYMENT', delta: amount - outstanding };
}
