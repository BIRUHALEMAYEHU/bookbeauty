/** Money is stored as whole santim (1 ETB = 100 santim), never as floating point. */
export type Money = { amount: number; currency: string };

export function toMinorUnits(major: number): number {
  return Math.round(major * 100);
}

/** "1,200 ETB" or "1,250.50 ETB" */
export function formatMoney({ amount, currency }: Money): string {
  if (!Number.isInteger(amount)) {
    throw new Error("Money amounts must be whole minor units");
  }
  const hasFraction = amount % 100 !== 0;
  const major = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(amount / 100);
  return `${major} ${currency}`;
}
