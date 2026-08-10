import { IsBoolean, IsOptional, IsString, IsUUID, Length } from 'class-validator';

/**
 * Import is a two-phase, stateless flow:
 *   1) POST /students/import/preview  (multipart file)  → validate, no writes
 *   2) POST /students/import/commit   (multipart file)  → validate + insert
 * The file is re-uploaded on commit (stateless server; no partially-parsed
 * state is retained between calls). The client echoes the previewToken it got
 * back so we can assert the same file is being committed.
 */
export class ImportCommitDto {
  /** Opaque hash of the previewed file, returned by /preview. */
  @IsString() @Length(16, 128) previewToken!: string;

  /** Optional default admission session applied to rows that omit one. */
  @IsOptional() @IsUUID() defaultAdmissionSessionId?: string;

  /** If true, rows flagged only as SOFT-duplicate warnings are still imported. */
  @IsOptional() @IsBoolean() acceptWarnings?: boolean;
}
