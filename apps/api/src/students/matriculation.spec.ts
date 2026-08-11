import {
  formatMatriculationNumber,
  isValidMatriculationNumber,
  normalizeMatriculationNumber,
  parseMatriculationNumber,
} from './matriculation';

/**
 * The matriculation number is the student's login identifier and the university's
 * permanent handle on the record, so this module is the single definition of the
 * PREFIX/YEAR/SEQUENCE format that the DTOs, the service layer, the CSV import
 * and the ck_student_matric_format CHECK constraint all defer to.
 *
 * Two properties matter beyond "does the regex match":
 *   • normalization is idempotent and produces the upper-case canonical form,
 *     because uq_matric_ci is a unique index on lower(matriculation_number);
 *   • parseMatriculationNumber RETURNS NULL rather than throwing, because login
 *     uses it to tell a matric apart from an email address.
 */
describe('normalizeMatriculationNumber', () => {
  it('upper-cases and trims', () => {
    expect(normalizeMatriculationNumber('  age/2021/001 ')).toBe('AGE/2021/001');
  });

  it('closes whitespace around the separators', () => {
    expect(normalizeMatriculationNumber('AGE / 2021 / 001')).toBe('AGE/2021/001');
  });

  it('is idempotent, so re-saving a record cannot drift', () => {
    const once = normalizeMatriculationNumber(' age / 2021 / 001 ');
    expect(normalizeMatriculationNumber(once)).toBe(once);
  });
});

describe('isValidMatriculationNumber', () => {
  it.each(['AGE/2021/001', 'CSC/2024/1', 'EEE/1999/123456', 'A1/2021/001', 'age/2021/001'])(
    'accepts %s',
    (value) => expect(isValidMatriculationNumber(value)).toBe(true),
  );

  it.each([
    ['CSC/24/001', 'a two-digit year'],
    ['1SC/2021/001', 'a prefix that does not start with a letter'],
    ['CSC-2021-001', 'hyphens instead of slashes'],
    ['CSC/2021', 'a missing sequence'],
    ['CSC/2021/001/002', 'a fourth segment'],
    ['CSC/2021/abc', 'a non-numeric sequence'],
    ['/2021/001', 'an empty prefix'],
    ['C/2021/001', 'a single-character prefix'],
    ['', 'an empty string'],
  ])('rejects %s (%s)', (value) => expect(isValidMatriculationNumber(value)).toBe(false));
});

describe('parseMatriculationNumber', () => {
  it('returns the canonical form alongside the parts', () => {
    expect(parseMatriculationNumber(' age/2021/001 ')).toMatchObject({
      normalized: 'AGE/2021/001',
      prefix: 'AGE',
      year: 2021,
      sequence: 1,
    });
  });

  it('returns null for an email address, which is how login discriminates', () => {
    expect(parseMatriculationNumber('student@uni.example')).toBeNull();
  });

  it('returns null rather than throwing on malformed input', () => {
    expect(parseMatriculationNumber('CSC/24/001')).toBeNull();
  });
});

describe('formatMatriculationNumber', () => {
  it('zero-pads the sequence to three digits by default', () => {
    expect(formatMatriculationNumber('AGE', 2021, 1)).toBe('AGE/2021/001');
  });

  it('does not truncate a sequence wider than the pad', () => {
    expect(formatMatriculationNumber('AGE', 2021, 1234)).toBe('AGE/2021/1234');
  });

  it('produces a value the validator accepts', () => {
    expect(isValidMatriculationNumber(formatMatriculationNumber('csc', 2024, 7))).toBe(true);
  });
});
