import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Results DTOs (docs/03 §10).
 *
 * Conventions follow the rest of the API: assessment component keys are
 * uppercase identifiers (CA, TEST_1, EXAM), weights are percentages summing to
 * 100 (validated in the service, where the whole set is visible), and raw
 * scores are numbers within the component's own max scale — out-of-range values
 * are HARD-REJECTED, never clamped (Q-16).
 */

const COMPONENT_KEY = /^[A-Z][A-Z0-9_]{0,11}$/;

/** Coerce a query-string boolean without the Boolean("false") trap. */
const BooleanQuery = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;
    const v = String(value).trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return value;
  });

// --- Assessment structure (§10.1) -------------------------------------------

export class AssessmentComponentDto {
  @Matches(COMPONENT_KEY, { message: 'key must be an uppercase identifier like CA or TEST_1' })
  key!: string;

  @IsString() @Length(2, 60) label!: string;

  /** Percentage of the final mark. Must be whole-or-fractional percent; the
   *  service insists the complete set sums to exactly 100. */
  @IsNumber() @Min(0.01) @Max(100) weight!: number;

  /** The raw scale this component is marked out of (a test may be out of 20). */
  @IsNumber() @Min(0.01) @Max(1000) maxScore!: number;

  @IsOptional() @IsInt() @Min(0) @Max(99) sortOrder?: number;
}

/** The component set is replaced WHOLESALE — the same discipline as curriculum
 *  requirements: piecemeal add/remove calls would leave the weights transiently
 *  off 100, a state no submission should ever observe. */
export class SetAssessmentComponentsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AssessmentComponentDto)
  components!: AssessmentComponentDto[];
}

// --- Score entry (§10.2) ------------------------------------------------------

export class ScoreEntryDto {
  @IsUUID() componentId!: string;
  @IsUUID() registrationLineId!: string;

  /** Null only when `mark` records an explicit non-score (ABSENT, MEDICAL, ...).
   *  A blank is never a silent zero. */
  @IsOptional() @IsNumber() @Min(-0.01) @Max(10000) score?: number | null;

  @IsString()
  @IsIn(['SCORED', 'ABSENT', 'WITHHELD', 'MEDICAL', 'MALPRACTICE'], {
    message: 'mark must be SCORED, ABSENT, WITHHELD, MEDICAL or MALPRACTICE',
  })
  mark!: 'SCORED' | 'ABSENT' | 'WITHHELD' | 'MEDICAL' | 'MALPRACTICE';
}

/** Autosave. Draft ≠ submitted: entries land as DRAFT until an explicit
 *  submit call promotes them. */
export class SaveScoresDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ScoreEntryDto)
  entries!: ScoreEntryDto[];
}

export class SubmitScoresDto {
  /** Which components to submit. Submitting per component lets a lecturer
   *  finalise coursework before the exam script is marked. */
  @IsArray() @IsUUID('4', { each: true }) componentIds!: string[];
}

// --- Batches & approval (§10.4) ---------------------------------------------

export class DecideResultBatchDto {
  @IsString()
  @IsIn(['APPROVED', 'REJECTED'], { message: 'decision must be APPROVED or REJECTED' })
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional() @IsString() @Length(0, 500) comment?: string;
}

/** Publication is dual control: this is one co-signature, and the service
 *  requires a second distinct actor before anything becomes student-visible. */
export class PublishResultBatchDto {
  @IsOptional() @IsString() @Length(0, 500) comment?: string;
}

// --- Withholdings (§10.7) -----------------------------------------------------

export class CreateWithholdingDto {
  @IsUUID() studentRecordId!: string;
  @IsString() @Length(10, 500) reason!: string;

  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() offeringId?: string;
}

// --- Query params -------------------------------------------------------------

export class ListResultBatchesQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;

  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'PENDING_APPROVAL', 'SENATE_RATIFIED', 'PUBLISHED', 'REJECTED'], {
    message: 'status must be DRAFT, PENDING_APPROVAL, SENATE_RATIFIED, PUBLISHED or REJECTED',
  })
  status?: 'DRAFT' | 'PENDING_APPROVAL' | 'SENATE_RATIFIED' | 'PUBLISHED' | 'REJECTED';
}

export class ListWithholdingsQueryDto {
  @IsOptional() @IsUUID() studentRecordId?: string;

  @IsOptional() @BooleanQuery() includeReleased?: boolean;
}

/** Release carries an optional note; the service insists on one when the actor
 *  is releasing their OWN withholding, so the trail explains the reversal. */
export class ReleaseWithholdingDto {
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class StudentResultsQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
}
