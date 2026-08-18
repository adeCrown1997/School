import { BadRequestException } from '@nestjs/common';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

/**
 * Parsing layer for bulk import. Turns an uploaded CSV or XLSX buffer into a
 * list of raw rows keyed by CANONICAL column names, tolerating human header
 * variations (case, spaces, underscores). Parsing NEVER validates business
 * rules — it only structures the data; validation happens per-row afterwards so
 * every invalid record can be reported (never silently dropped).
 */

/** Canonical columns the importer understands. Templates ship with these. */
export const IMPORT_COLUMNS = [
  'matriculationNumber',
  'jambRegistrationNumber',
  'surname',
  'firstName',
  'otherNames',
  'dateOfBirth',
  'gender',
  'facultyCode',
  'departmentCode',
  'programmeCode',
  'admissionSession',
  'entryMode',
  'currentLevel',
  'statusKey',
  'officialEmail',
  'officialPhone',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type RawRow = { rowNumber: number; values: Partial<Record<ImportColumn, string>> };

/** Accept several human spellings for each canonical header. */
const HEADER_ALIASES: Record<string, ImportColumn> = {
  matriculationnumber: 'matriculationNumber',
  matricno: 'matriculationNumber',
  matric: 'matriculationNumber',
  jambregistrationnumber: 'jambRegistrationNumber',
  jambregno: 'jambRegistrationNumber',
  jamb: 'jambRegistrationNumber',
  surname: 'surname',
  lastname: 'surname',
  firstname: 'firstName',
  othernames: 'otherNames',
  middlename: 'otherNames',
  dateofbirth: 'dateOfBirth',
  dob: 'dateOfBirth',
  gender: 'gender',
  sex: 'gender',
  facultycode: 'facultyCode',
  faculty: 'facultyCode',
  departmentcode: 'departmentCode',
  department: 'departmentCode',
  programmecode: 'programmeCode',
  programcode: 'programmeCode',
  programme: 'programmeCode',
  program: 'programmeCode',
  admissionsession: 'admissionSession',
  session: 'admissionSession',
  entrymode: 'entryMode',
  modeofentry: 'entryMode',
  currentlevel: 'currentLevel',
  level: 'currentLevel',
  statuskey: 'statusKey',
  status: 'statusKey',
  officialemail: 'officialEmail',
  email: 'officialEmail',
  emailaddress: 'officialEmail',
  officialphone: 'officialPhone',
  phone: 'officialPhone',
  phonenumber: 'officialPhone',
  mobile: 'officialPhone',
};

function normalizeHeader(raw: string): ImportColumn | null {
  const key = raw.toLowerCase().replace(/[\s_\-.]/g, '');
  return HEADER_ALIASES[key] ?? null;
}

export interface ParseResult {
  rows: RawRow[];
  /** Canonical columns that were present in the file header. */
  presentColumns: ImportColumn[];
  /** Header cells that could not be mapped (reported, not fatal). */
  unknownHeaders: string[];
}

const REQUIRED_HEADERS: ImportColumn[] = [
  'matriculationNumber',
  'surname',
  'firstName',
  'dateOfBirth',
  'facultyCode',
  'departmentCode',
  'programmeCode',
  'admissionSession',
  'currentLevel',
];

export const MAX_IMPORT_ROWS = 5000;

/** A parsed sheet as a header row + data rows of raw strings. */
export interface Table {
  headers: string[];
  dataRows: string[][];
}

/**
 * Detect + dispatch a CSV/XLSX buffer by extension/mime and return the raw
 * table (header row + data rows of strings). Shared with other import flows
 * (e.g. score sheets) that need spreadsheet reading WITHOUT this module's
 * column-mapping rules. Business mapping stays with each caller.
 */
export async function parseSpreadsheetTable(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<Table> {
  const isXlsx =
    /\.xlsx$/i.test(filename) ||
    mimetype.includes('spreadsheetml') ||
    mimetype === 'application/vnd.ms-excel';
  const isCsv = /\.csv$/i.test(filename) || mimetype.includes('csv') || mimetype === 'text/plain';

  return isXlsx
    ? await readXlsx(buffer)
    : isCsv
      ? readCsv(buffer)
      : (() => {
          throw new BadRequestException('Unsupported file type — upload a .csv or .xlsx file');
        })();
}

/** Detect + dispatch by extension/mime, then map headers to canonical columns. */
export async function parseImportFile(
  buffer: Buffer,
  filename: string,
  mimetype: string,
): Promise<ParseResult> {
  return mapTable(await parseSpreadsheetTable(buffer, filename, mimetype));
}

function readCsv(buffer: Buffer): Table {
  let records: string[][];
  try {
    records = parseCsv(buffer.toString('utf8'), {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      trim: true,
    }) as string[][];
  } catch (err) {
    throw new BadRequestException(
      `Could not parse CSV: ${err instanceof Error ? err.message : 'invalid format'}`,
    );
  }
  if (records.length === 0) throw new BadRequestException('The file is empty');
  const [headers, ...dataRows] = records;
  return { headers, dataRows };
}

async function readXlsx(buffer: Buffer): Promise<Table> {
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs's typings predate @types/node's generic Buffer<ArrayBufferLike>;
    // it accepts a Node Buffer at runtime, so cast to satisfy the signature.
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new BadRequestException('Could not read the spreadsheet — the file may be corrupt');
  }
  const sheet = wb.worksheets[0];
  if (!sheet) throw new BadRequestException('The workbook has no sheets');

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    // eachCell({includeEmpty}) keeps column alignment with the header.
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell.value));
    });
    rows.push(cells);
  });
  if (rows.length === 0) throw new BadRequestException('The file is empty');
  const [headers, ...dataRows] = rows;
  return { headers, dataRows };
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    // Normalize to YYYY-MM-DD (dates are the only rich type we care about).
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === 'object') {
    const rich = value as { text?: string; result?: unknown };
    if (typeof rich.text === 'string') return rich.text.trim();
    if (rich.result !== undefined) return String(rich.result).trim();
    return '';
  }
  return String(value).trim();
}

function mapTable(table: Table): ParseResult {
  const mapped: Array<ImportColumn | null> = table.headers.map((h) => normalizeHeader(h ?? ''));
  const presentColumns = mapped.filter((c): c is ImportColumn => c !== null);
  const unknownHeaders = table.headers.filter(
    (_, i) => mapped[i] === null && table.headers[i] !== '',
  );

  const missingRequired = REQUIRED_HEADERS.filter((c) => !presentColumns.includes(c));
  if (missingRequired.length > 0) {
    throw new BadRequestException(
      `Missing required column(s): ${missingRequired.join(', ')}. ` + `Use the provided template.`,
    );
  }

  if (table.dataRows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(
      `Too many rows (${table.dataRows.length}). The limit per import is ${MAX_IMPORT_ROWS}.`,
    );
  }

  const rows: RawRow[] = [];
  table.dataRows.forEach((cells, idx) => {
    // Skip fully-blank rows (common trailing rows in spreadsheets).
    if (cells.every((c) => (c ?? '').trim() === '')) return;
    const values: Partial<Record<ImportColumn, string>> = {};
    mapped.forEach((col, i) => {
      if (!col) return;
      const v = (cells[i] ?? '').trim();
      if (v !== '') values[col] = v;
    });
    rows.push({ rowNumber: idx + 2, values }); // +2: 1-based + header row
  });

  return { rows, presentColumns, unknownHeaders };
}
