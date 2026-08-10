import { BadRequestException } from '@nestjs/common';
import { parseImportFile } from './import-parse.util';

/**
 * Bulk-import parsing. The brief requires that invalid records are never SILENTLY
 * discarded and that headers tolerate human variation. Parsing itself must not
 * apply business rules — it structures rows (keyed by canonical column) and
 * reports unmappable headers, leaving per-row validation to a later stage.
 */
const csv = (text: string) => Buffer.from(text, 'utf8');

const HEADER =
  'matriculationNumber,surname,firstName,dateOfBirth,facultyCode,departmentCode,programmeCode,admissionSession,currentLevel';

describe('parseImportFile (CSV)', () => {
  it('parses canonical headers into rows keyed by canonical column', async () => {
    const file = csv(`${HEADER}\nCSC/24/001,Bello,Ada,2005-01-02,SCI,CSC,CSC-BSC,2024/2025,100`);
    const result = await parseImportFile(file, 'students.csv', 'text/csv');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].values).toMatchObject({
      matriculationNumber: 'CSC/24/001',
      surname: 'Bello',
      firstName: 'Ada',
      facultyCode: 'SCI',
      currentLevel: '100',
    });
    expect(result.unknownHeaders).toEqual([]);
  });

  it('maps human header aliases (matricno, dob, faculty, level, ...)', async () => {
    const file = csv(
      'MatricNo,Surname,First Name,DOB,Faculty,Department,Programme,Session,Level\n' +
        'CSC/24/002,Okafor,Ben,2004-05-06,SCI,CSC,CSC-BSC,2024/2025,200',
    );
    const result = await parseImportFile(file, 'students.csv', 'text/csv');
    expect(result.rows[0].values).toMatchObject({
      matriculationNumber: 'CSC/24/002',
      firstName: 'Ben',
      dateOfBirth: '2004-05-06',
      currentLevel: '200',
    });
  });

  it('reports unknown headers without treating them as fatal', async () => {
    const file = csv(
      `${HEADER},favouriteColour\nCSC/24/003,Musa,Sadiq,2005-03-03,SCI,CSC,CSC-BSC,2024/2025,100,blue`,
    );
    const result = await parseImportFile(file, 'students.csv', 'text/csv');
    expect(result.unknownHeaders).toEqual(['favouriteColour']);
    expect(result.rows).toHaveLength(1);
  });

  it('throws a descriptive error when a required column is missing', async () => {
    // Drop programmeCode.
    const file = csv(
      'matriculationNumber,surname,firstName,dateOfBirth,facultyCode,departmentCode,admissionSession,currentLevel\n' +
        'CSC/24/004,Yusuf,Aisha,2005-07-07,SCI,CSC,2024/2025,100',
    );
    await expect(parseImportFile(file, 'students.csv', 'text/csv')).rejects.toThrow(
      /Missing required column\(s\): programmeCode/,
    );
  });

  it('skips fully-blank rows and numbers rows from the source line (+2)', async () => {
    const file = csv(
      `${HEADER}\n` +
        'CSC/24/005,Eze,Ngozi,2005-08-08,SCI,CSC,CSC-BSC,2024/2025,100\n' +
        ',,,,,,,,\n' +
        'CSC/24/006,Ali,Zara,2005-09-09,SCI,CSC,CSC-BSC,2024/2025,100',
    );
    const result = await parseImportFile(file, 'students.csv', 'text/csv');
    expect(result.rows).toHaveLength(2);
    // Row 2 is the first data line; the blank line 4 is skipped; line 5 → rowNumber 4.
    expect(result.rows[0].rowNumber).toBe(2);
    expect(result.rows[1].rowNumber).toBe(4);
  });

  it('rejects an unsupported file type', async () => {
    await expect(parseImportFile(csv('x'), 'notes.pdf', 'application/pdf')).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects an empty file', async () => {
    await expect(parseImportFile(csv(''), 'students.csv', 'text/csv')).rejects.toThrow(/empty/i);
  });
});
