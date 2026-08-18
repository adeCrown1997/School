import { BadRequestException } from '@nestjs/common';
import { parseSpreadsheetTable } from '../students/import/import-parse.util';

/**
 * Score-sheet parsing (CSV/XLSX upload into §10.2 score entry).
 *
 * Shape of the sheet: a `matric` column (the student key) plus one column PER
 * assessment component, named exactly by component key (CA, TEST_1, EXAM…) —
 * case/underscores/spaces are tolerated in the header but the KEY must resolve.
 * Parsing only STRUCTURES rows (raw strings); range and component validation
 * happen in the service against the live component set so every bad cell is
 * reported per-row, never silently dropped.
 */

/** Accept several human spellings of the student-key column. */
const MATRIC_HEADERS = new Set([
  'matric',
  'matricno',
  'matriculationnumber',
  'matriculationno',
  'matriculation',
  'regno',
]);

export interface RawScoreRow {
  rowNumber: number;
  matric: string;
  /** Raw string per component column, keyed by uppercase component key. */
  values: Map<string, string>;
}

export interface ScoreSheetParse {
  matricHeader: string;
  /** Component-keyed columns present in the sheet (as header text appeared). */
  componentHeaders: Array<{ key: string; header: string }>;
  rows: RawScoreRow[];
  /** Header cells that mapped to neither matric nor a component (reported). */
  unknownHeaders: string[];
}

/** Normalize a header cell the way component keys normalize (COMPONENT_KEY). */
export function normalizeComponentHeader(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[\s.-]/g, '_');
}

export const MAX_SCORE_ROWS = 5000;

/**
 * Turn an uploaded buffer into raw score rows. Throws a BadRequestException for
 * structural problems (unreadable file, no header, no matric column, no
 * component columns, too many rows) — everything else is reported per-row.
 */
export async function parseScoreSheet(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<ScoreSheetParse> {
  const table = await parseSpreadsheetTable(buffer, filename, mimetype);
  if (table.headers.length === 0) {
    throw new BadRequestException('The file is empty — expected a header row');
  }

  // Map columns: one matric column + any number of component-keyed columns.
  let matricIndex = -1;
  let matricHeader = '';
  const componentHeaders: Array<{ key: string; header: string; index: number }> = [];
  const unknownHeaders: string[] = [];
  const seenKeys = new Set<string>();

  table.headers.forEach((h, i) => {
    const raw = h ?? '';
    const norm = raw.trim();
    if (norm === '') return;
    const lowered = norm.toLowerCase().replace(/[\s_\-.]/g, '');
    if (matricIndex === -1 && MATRIC_HEADERS.has(lowered)) {
      matricIndex = i;
      matricHeader = norm;
      return;
    }
    const key = normalizeComponentHeader(norm);
    if (!/^[A-Z][A-Z0-9_]{0,11}$/.test(key)) {
      unknownHeaders.push(norm);
      return;
    }
    if (seenKeys.has(key)) {
      unknownHeaders.push(norm); // duplicate component column — never guess
      return;
    }
    seenKeys.add(key);
    componentHeaders.push({ key, header: norm, index: i });
  });

  if (matricIndex === -1) {
    throw new BadRequestException(
      'The sheet needs a matriculation-number column (header "Matric" or "MatriculationNumber")',
    );
  }
  if (componentHeaders.length === 0) {
    throw new BadRequestException(
      'No score columns found — add one column per assessment component, named exactly by key (e.g. CA, EXAM)',
    );
  }
  if (table.dataRows.length > MAX_SCORE_ROWS) {
    throw new BadRequestException(
      `Too many rows (${table.dataRows.length}). The limit per upload is ${MAX_SCORE_ROWS}.`,
    );
  }

  const rows: RawScoreRow[] = [];
  table.dataRows.forEach((cells, idx) => {
    if (cells.every((c) => (c ?? '').trim() === '')) return; // skip blank rows
    const matric = (cells[matricIndex] ?? '').trim();
    const values = new Map<string, string>();
    if (matric !== '') {
      for (const col of componentHeaders) {
        const v = (cells[col.index] ?? '').trim();
        if (v !== '') values.set(col.key, v);
      }
    }
    rows.push({ rowNumber: idx + 2, matric, values }); // +2: 1-based + header row
  });

  return {
    matricHeader,
    componentHeaders: componentHeaders.map(({ key, header }) => ({ key, header })),
    rows,
    unknownHeaders,
  };
}
