/**
 * Minor-units (kobo) money formatting for the finance surfaces. All amounts
 * arrive from the API as DIGIT STRINGS of kobo (§11.5) — never floats. Parse to
 * BigInt for exact math, format only at the display edge.
 */

/** Kobo digit-string → ₦x,xxx.xx. Empty/garbage input renders as ₦0.00. */
export function formatNaira(minor: string | number | bigint | null | undefined): string {
  let kobo: bigint;
  try {
    kobo = BigInt(String(minor ?? '0').replace(/[^0-9]/g, '') || '0');
  } catch {
    kobo = 0n;
  }
  const naira = kobo / 100n;
  const rem = kobo % 100n;
  return `₦${Number(naira).toLocaleString('en-NG')}.${rem.toString().padStart(2, '0')}`;
}

/** Naira entered by a user ("1,250.50") → kobo digit string, or null if invalid. */
export function nairaToMinor(input: string): string | null {
  const cleaned = input.replace(/[₦,\s]/g, '');
  if (!/^\d{1,13}(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ''] = cleaned.split('.');
  const kobo = (frac + '00').slice(0, 2);
  return `${BigInt(whole ?? '0') * 100n + BigInt(kobo)}`;
}
