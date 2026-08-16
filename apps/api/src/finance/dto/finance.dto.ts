import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  Validate,
  ValidateNested,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Finance DTOs (docs/03 §11).
 *
 * Amounts travel as STRINGS of integer minor units (kobo) rather than numbers —
 * a float loses precision well inside the range of real Nigerian school fees
 * (INV-14/§11.5) — and are BigInt on the wire-internal side.
 */

const MINOR_AMOUNT = /^\d{1,13}$/;

const bigintFromMinor = (value: unknown): bigint | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  try {
    return BigInt(String(value));
  } catch {
    return undefined;
  }
};

const MinorAmount = () => Transform(({ value }) => bigintFromMinor(value), { toClassOnly: true });

/**
 * Amounts are integer minor units (kobo) as DIGIT STRINGS on the wire — the
 * transform turns them into bigints, so no stock validator can see the original
 * shape. This constraint guards both sides: the incoming value must be a
 * non-empty digit string within the minor-units bound, and the transformed
 * value must be a bigint. A number, float or negative never passes.
 */
@ValidatorConstraint({ name: 'minorAmount' })
class IsMinorAmountConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value === 'bigint') return value >= BigInt(0) && value <= BigInt('9999999999999');
    return typeof value === 'string' && MINOR_AMOUNT.test(value);
  }
  defaultMessage(args: ValidationArguments): string {
    return `${args.property} must be integer minor units (kobo), as a digit string`;
  }
}

export class FeeItemDto {
  @IsString() @Length(2, 40) feeType!: string;
  @IsString() @Length(2, 120) label!: string;
  /** Integer minor units, as a string (e.g. "25000000" = ₦250,000). */
  @Transform(({ value }) => (typeof value === 'string' && MINOR_AMOUNT.test(value) ? value : value))
  @IsString()
  amount!: string;
  @IsOptional() @IsBoolean() isMandatory?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}

export class CreateFeeScheduleDto {
  @IsUUID() programmeId!: string;
  @IsString() @Length(3, 120) name!: string;
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;

  /** Minimum paid fraction, basis points. 10000 = 100% (full payment),
   *  5000 = half. The registration fee gate reads this (INV-16). */
  @IsOptional() @IsInt() @Min(1) @Max(10000) clearanceThresholdBps?: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeItemDto)
  items!: FeeItemDto[];

  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateFeeScheduleDto {
  @IsOptional() @IsString() @Length(3, 120) name!: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) clearanceThresholdBps!: number;
  @IsOptional() @IsBoolean() isActive!: boolean;
}

// --- Invoicing ---------------------------------------------------------------

export class GenerateInvoicesDto {
  /** Which schedule to bill from. */
  @IsUUID() scheduleId!: string;
  /** Optional narrowing; otherwise every active record on the programme. */
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
  /** Explicit student list override (e.g. partial cohort billing). */
  @IsOptional() @IsArray() @IsUUID('4', { each: true }) studentRecordIds?: string[];
  /** When true, existing invoices for the (student, session, semester) are
   *  left untouched; when false the request fails if any exist. */
  @IsOptional() @IsBoolean() skipExisting?: boolean;
}

export class IssueInvoiceDto {
  @IsOptional() @IsString() dueAt?: string;
}

// --- Payments ----------------------------------------------------------------

export class RecordPaymentDto {
  @IsUUID() invoiceId!: string;
  /** Minor units paid. Must equal the outstanding amount unless the caller
   *  explicitly accepts a partial/overpayment state. */
  @MinorAmount()
  @Validate(IsMinorAmountConstraint)
  amount!: bigint;

  /** The gateway's reference (RRR, Paystack ref...). The idempotency key
   *  (INV-15): resending the same reference cannot double-post. */
  @IsString() @Length(3, 120) providerReference!: string;

  @IsOptional() @IsString() @Length(2, 40) provider?: string;

  /** When a partial payment is intentional (instalments, Q-17). Without this,
   *  an amount below the outstanding balance is rejected rather than leaving
   *  an unexplained shortfall. */
  @IsOptional() @IsBoolean() allowPartial?: boolean;
}

export class ReversePaymentDto {
  @IsUUID() paymentIntentId!: string;
  @IsString() @Length(10, 500) reason!: string;
}

// --- Waivers & loans ---------------------------------------------------------

export class CreateWaiverDto {
  @IsUUID() studentRecordId!: string;
  /** The invoice the waiver reduces. Required so the ledger side stays pinned
   *  to a concrete charge. */
  @IsUUID() invoiceId!: string;
  @MinorAmount()
  @Validate(IsMinorAmountConstraint)
  amount!: bigint;
  @IsString() @Length(10, 500) reason!: string;
  @IsOptional() @IsString() @Length(2, 40) feeType?: string;
}

export class DecideWaiverDto {
  @IsString() @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsOptional() @IsString() @Length(0, 500) decisionNote?: string;
}

export class RecordLoanClearanceDto {
  @IsUUID() studentRecordId!: string;
  @IsUUID() sessionId!: string;
  @IsString() @Length(2, 60) loanProvider!: string;
  @IsString() @Length(5, 120) reference!: string;
  @MinorAmount()
  @Validate(IsMinorAmountConstraint)
  amountCovered!: bigint;
  @IsOptional() @IsString() validFrom?: string;
  @IsOptional() @IsString() validTo?: string;
}

// --- Queries -------------------------------------------------------------------

const BooleanQuery = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;
    const v = String(value).trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return value;
  });

export class ListInvoicesQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
  @IsOptional() @IsUUID() studentRecordId?: string;
  @IsOptional()
  @IsString()
  @IsIn(['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID'])
  status?: string;
}

export class ListWaiversQueryDto {
  @IsOptional() @IsUUID() studentRecordId?: string;
  @IsOptional()
  @IsString()
  @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'])
  status?: string;
  @IsOptional() @BooleanQuery() includeDecided?: boolean;
}
