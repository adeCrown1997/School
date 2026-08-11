/**
 * The matriculation-number format, in one place.
 *
 * This closes Q-08, which the id generator deliberately left open ("the
 * matriculation-number FORMAT is institution-specific and is intentionally NOT
 * invented here"). The institution has now specified it:
 *
 *     PREFIX / YEAR / SEQUENCE          e.g. AGE/2021/001
 *
 * The number is now also the STUDENT LOGIN IDENTIFIER, which is why the format
 * is enforced rather than merely documented: `resolveLoginIdentifier` decides
 * whether a submitted credential is a matriculation number or a staff email by
 * testing it against this pattern, so a loose format would make that decision
 * ambiguous.
 *
 * Kept free of decorators and Nest imports so that non-Nest callers — the Prisma
 * seed, the CSV import parser — can reach it without pulling `@nestjs/common`
 * (and its reflect-metadata requirement) into a plain ts-node script.
 */

/**
 * PREFIX is 2-10 alphanumerics starting with a letter (a faculty, department or
 * institution code: AGE, CSC, MTH). YEAR is the 4-digit admission year. SEQUENCE
 * is 1-6 digits, normally zero-padded to 3 (001), but the width is not fixed:
 * an institution that admits more than 999 students to a cohort must be able to
 * issue 1000 without the format rejecting it.
 */
export const MATRIC_PATTERN = /^[A-Z][A-Z0-9]{1,9}\/\d{4}\/\d{1,6}$/;

/** Human-readable rule, reused verbatim in every validation message. */
export const MATRIC_FORMAT_MESSAGE =
  'Matriculation number must be PREFIX/YEAR/SEQUENCE, for example AGE/2021/001';

/** Widest string the format can produce: 10 + 1 + 4 + 1 + 6. */
export const MATRIC_MAX_LENGTH = 22;
/** Narrowest: 2 + 1 + 4 + 1 + 1. */
export const MATRIC_MIN_LENGTH = 9;

/** Admission years outside this range are a typo, not a cohort. */
const MIN_YEAR = 1900;
const MAX_YEAR = 2999;

export interface ParsedMatric {
  prefix: string;
  year: number;
  sequence: number;
  /** The canonical, storable form. */
  normalized: string;
}

/**
 * Canonical form: trimmed, upper-cased, with whitespace around the separators
 * removed. Case folding matters because the number is a login identifier and
 * `uq_student_matric_ci` (guards.sql) makes uniqueness case-insensitive — so
 * "age/2021/001" and "AGE/2021/001" are the SAME student and must not be
 * storable as two rows.
 */
export function normalizeMatriculationNumber(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s*\/\s*/g, '/');
}

/** Shape-only check against the canonical form. */
export function isValidMatriculationNumber(raw: string): boolean {
  return parseMatriculationNumber(raw) !== null;
}

/**
 * Parse into parts, or null if the value is not a matriculation number.
 *
 * Returning null rather than throwing is what lets the login path use this as a
 * cheap discriminator ("is this a matric number or an email?") without treating
 * a staff email as an error.
 */
export function parseMatriculationNumber(raw: string): ParsedMatric | null {
  const normalized = normalizeMatriculationNumber(raw);
  if (!MATRIC_PATTERN.test(normalized)) return null;

  const [prefix, yearPart, sequencePart] = normalized.split('/');
  const year = Number(yearPart);
  if (year < MIN_YEAR || year > MAX_YEAR) return null;

  return { prefix, year, sequence: Number(sequencePart), normalized };
}

/**
 * Build a number from its parts, zero-padding the sequence to `width` (3 by
 * default, matching AGE/2021/001). Used by the seed and by tests; the registry
 * supplies real numbers from the admission process rather than deriving them.
 */
export function formatMatriculationNumber(
  prefix: string,
  year: number,
  sequence: number,
  width = 3,
): string {
  return `${prefix.trim().toUpperCase()}/${year}/${String(sequence).padStart(width, '0')}`;
}
