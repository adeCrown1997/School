import { parseScoreSheet, normalizeComponentHeader } from './score-import.parse';

/**
 * Score-sheet parsing (CSV/XLSX upload into §10.2). Parsing only STRUCTURES
 * rows — matric column + component-keyed columns; all business validation is
 * the service's job. These tests hold the structural rules: header mapping,
 * blank-row skipping, row numbering, and hard rejections on unusable sheets.
 */
const csv = (text: string) => Buffer.from(text, 'utf8');

describe('normalizeComponentHeader', () => {
  it('uppercases and folds separators so "Test 1" and "test.1" both map to TEST_1', () => {
    expect(normalizeComponentHeader('ca')).toBe('CA');
    expect(normalizeComponentHeader('Test 1')).toBe('TEST_1');
    expect(normalizeComponentHeader('test.1')).toBe('TEST_1');
    expect(normalizeComponentHeader(' final-exam ')).toBe('FINAL_EXAM');
  });
});

describe('parseScoreSheet', () => {
  it('maps the matric column and component columns into raw rows', async () => {
    const file = csv('Matric,CA,EXAM\nCSC/2024/001,18,55\nCSC/2024/002,15,60');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');

    expect(result.matricHeader).toBe('Matric');
    expect(result.componentHeaders).toEqual([
      { key: 'CA', header: 'CA' },
      { key: 'EXAM', header: 'EXAM' },
    ]);
    expect(result.unknownHeaders).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toMatchObject({ rowNumber: 2, matric: 'CSC/2024/001' });
    expect(result.rows[0].values.get('CA')).toBe('18');
    expect(result.rows[0].values.get('EXAM')).toBe('55');
  });

  it('tolerates human matric-header spellings', async () => {
    const file = csv('Matriculation Number,CA\nCSC/2024/003,20');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.rows[0].matric).toBe('CSC/2024/003');
  });

  it('accepts non-score keywords as cell values without rejecting them', async () => {
    const file = csv('Matric,CA,EXAM\nCSC/2024/004,ABSENT,MEDICAL');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.rows[0].values.get('CA')).toBe('ABSENT');
    expect(result.rows[0].values.get('EXAM')).toBe('MEDICAL');
  });

  it('reports unknown columns instead of silently absorbing them', async () => {
    const file = csv('Matric,CA,favouriteColour\nCSC/2024/005,17,blue');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.unknownHeaders).toEqual(['favouriteColour']);
    expect(result.rows[0].values.has('FAVOURITECOLOUR')).toBe(false);
  });

  it('reports duplicate component columns rather than guessing', async () => {
    const file = csv('Matric,CA,ca\nCSC/2024/006,17,18');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.componentHeaders).toHaveLength(1);
    expect(result.unknownHeaders).toEqual(['ca']);
  });

  it('keeps empty cells absent from the value map (blank ≠ zero)', async () => {
    const file = csv('Matric,CA,EXAM\nCSC/2024/007,16,');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.rows[0].values.has('CA')).toBe(true);
    expect(result.rows[0].values.has('EXAM')).toBe(false);
  });

  it('skips fully-blank rows and numbers rows from the source line (+2)', async () => {
    const file = csv('Matric,CA\nCSC/2024/008,14\n,\nCSC/2024/009,13');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(4);
  });

  it('retains rows missing a matric cell so the service can report them', async () => {
    const file = csv('Matric,CA\n,19');
    const result = await parseScoreSheet(file, 'scores.csv', 'text/csv');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].matric).toBe('');
  });

  it('rejects a sheet without a matric column', async () => {
    const file = csv('Name,CA\nSomeone,18');
    await expect(parseScoreSheet(file, 'scores.csv', 'text/csv')).rejects.toThrow(/matriculation/i);
  });

  it('rejects a sheet with no component columns', async () => {
    const file = csv('Matric\nCSC/2024/010');
    await expect(parseScoreSheet(file, 'scores.csv', 'text/csv')).rejects.toThrow(
      /No score columns/,
    );
  });

  it('rejects an unsupported file type', async () => {
    await expect(parseScoreSheet(csv('x'), 'marks.pdf', 'application/pdf')).rejects.toThrow(
      /Unsupported file type/,
    );
  });
});
