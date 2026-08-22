// All money is integer minor units (paise). These helpers keep it that way —
// there is no float arithmetic anywhere in the money path.

/** Basis points → applied amount, rounded half-up. 1800 bps of 100000 = 18000. */
export function applyBps(amountMinor: number, bps: number): number {
  return Math.round((amountMinor * bps) / 10000);
}

export interface LineInput {
  qty: number;
  unitMinor: number;
  discountMinor?: number; // absolute, applied to the line before tax
  taxRateBps?: number;
}

export interface LineResult {
  qty: number;
  unitMinor: number;
  discountMinor: number;
  taxRateBps: number;
  taxMinor: number;
  lineTotalMinor: number;
}

/** Compute a single line's tax and total. Tax is on the post-discount base. */
export function computeLine(line: LineInput): LineResult {
  const qty = Math.max(1, Math.trunc(line.qty));
  const discountMinor = Math.max(0, line.discountMinor ?? 0);
  const taxRateBps = Math.max(0, line.taxRateBps ?? 0);
  const gross = qty * line.unitMinor;
  const base = Math.max(0, gross - discountMinor);
  const taxMinor = applyBps(base, taxRateBps);
  return {
    qty,
    unitMinor: line.unitMinor,
    discountMinor,
    taxRateBps,
    taxMinor,
    lineTotalMinor: base + taxMinor,
  };
}

export interface InvoiceTotals {
  subtotalMinor: number; // sum of (qty*unit) before discount & tax
  discountMinor: number;
  taxMinor: number;
  totalMinor: number;
}

/**
 * Split `amountMinor` across buckets in proportion to `weights`, in integer
 * minor units, using the largest-remainder method so the allocations sum EXACTLY
 * to `min(amountMinor, sum(weights))` and never exceed any single weight. Used to
 * spread an invoice-level discount (coupon) across taxable line bases, and to
 * prorate refunds. Pure and deterministic.
 */
export function allocateProportional(weights: number[], amountMinor: number): number[] {
  const w = weights.map((x) => Math.max(0, Math.trunc(x)));
  const weightSum = w.reduce((a, b) => a + b, 0);
  if (weightSum <= 0 || amountMinor <= 0) return w.map(() => 0);
  const cap = Math.min(amountMinor, weightSum); // never allocate more than the total weight
  const raw = w.map((x) => (cap * x) / weightSum);
  const alloc = raw.map((r) => Math.floor(r));
  let remainder = cap - alloc.reduce((a, b) => a + b, 0);
  // hand the rounding remainder to the largest fractional parts, skipping
  // buckets already at their weight ceiling
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; remainder > 0 && k < order.length * 2; k++) {
    const i = order[k % order.length].i;
    if (alloc[i] < w[i]) { alloc[i] += 1; remainder -= 1; }
  }
  return alloc;
}

/** Aggregate invoice totals from computed lines. Pure, deterministic. */
export function computeInvoiceTotals(lines: LineResult[]): InvoiceTotals {
  let subtotalMinor = 0;
  let discountMinor = 0;
  let taxMinor = 0;
  let totalMinor = 0;
  for (const l of lines) {
    subtotalMinor += l.qty * l.unitMinor;
    discountMinor += l.discountMinor;
    taxMinor += l.taxMinor;
    totalMinor += l.lineTotalMinor;
  }
  return { subtotalMinor, discountMinor, taxMinor, totalMinor };
}
