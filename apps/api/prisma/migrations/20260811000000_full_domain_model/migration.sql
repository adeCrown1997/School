-- Full domain model — the remaining nine bounded contexts (docs/02 §2.1).
--
-- Completes the database so it accommodates the WHOLE system: student records,
-- calendar, admission, registration, finance, assessment, examination,
-- clearance, graduation, credentials, storage and notifications. Together with
-- the two earlier migrations this is the complete schema; nothing further is
-- pending on the data model.
--
-- Purely additive: 37 enums + 71 tables + their indexes/FKs, plus three
-- ALTER TABLE ... ADD COLUMN statements. No column is dropped, retyped, or
-- made NOT NULL without a default, so this is safe to apply to a populated
-- database. Every added column is either nullable or carries a default.
--
-- Two additions deserve a note:
--
--   * academic_sessions.state — new lifecycle column (docs/04 §8.2), defaulted
--     to PLANNED. On an existing database that default is WRONG for the session
--     already flagged is_current, so the backfill at the foot of this file
--     promotes it to ACTIVE. is_current is retained rather than replaced: it
--     already carries the uq_one_current_session guard, and state is the richer
--     lifecycle running alongside it.
--
--   * audit_events.seq / prev_hash / row_hash — the Tier 2 hash chain
--     (docs/04 §19). Nullable by design: rows written before the chain existed
--     cannot be retro-signed, and pretending otherwise would forge provenance.
--     The chain starts from the first row that carries a seq. The UNIQUE index
--     on seq tolerates the existing NULLs, since Postgres does not treat NULLs
--     as equal.
--
-- Generated with `prisma migrate diff` against schema.prisma. Run with the
-- OWNER connection (see docs/28), then re-apply guards.sql — it appends a
-- full-domain section covering the amendment whitelist, the append-only ledger,
-- the grade-record partial index and the separation-of-duties checks.

-- CreateEnum
CREATE TYPE "SessionState" AS ENUM ('PLANNED', 'ACTIVE', 'TEACHING_COMPLETE', 'RESULTS_PROCESSING', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WindowType" AS ENUM ('REGISTRATION', 'ADD_DROP', 'LATE_REGISTRATION', 'SCORE_ENTRY', 'RESULT_RELEASE', 'EXAM', 'CLEARANCE', 'TRANSCRIPT_REQUEST');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApprovalDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ApprovalDomain" AS ENUM ('REGISTRATION', 'RESULT');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'OFFERED', 'ACCEPTED', 'DECLINED', 'REJECTED', 'WITHDRAWN', 'ENROLLED');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('ISSUED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'DRY_RUN', 'AWAITING_APPROVAL', 'COMMITTED', 'REJECTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "RecordOrigin" AS ENUM ('ADMISSION', 'IMPORT', 'MIGRATION');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'LOCKED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationLineType" AS ENUM ('NEW', 'CARRYOVER', 'REPEAT', 'ELECTIVE', 'AUDIT');

-- CreateEnum
CREATE TYPE "RegistrationLineState" AS ENUM ('ACTIVE', 'DROPPED');

-- CreateEnum
CREATE TYPE "RegistrationExceptionType" AS ENUM ('LATE_REGISTRATION', 'ADD_DROP', 'UNIT_OVERRIDE', 'PREREQUISITE_OVERRIDE', 'CARRYOVER_REMOVAL', 'WINDOW_REOPEN');

-- CreateEnum
CREATE TYPE "ScoreEntryState" AS ENUM ('DRAFT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "ScoreMark" AS ENUM ('SCORED', 'ABSENT', 'WITHHELD', 'MEDICAL', 'MALPRACTICE');

-- CreateEnum
CREATE TYPE "ResultBatchStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'SENATE_RATIFIED', 'PUBLISHED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WithholdingStatus" AS ENUM ('ACTIVE', 'RELEASED');

-- CreateEnum
CREATE TYPE "ProgressionOutcome" AS ENUM ('PROMOTE', 'REPEAT', 'PROBATION', 'WITHDRAW', 'SPILL_OVER', 'GRADUATE_PENDING');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentIntentStatus" AS ENUM ('CREATED', 'PENDING', 'PAID', 'POSTED_TO_LEDGER', 'UNDERPAID', 'OVERPAID', 'FAILED', 'ABANDONED', 'REVERSED');

-- CreateEnum
CREATE TYPE "LedgerDirection" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "LedgerSource" AS ENUM ('INVOICE', 'PAYMENT', 'WAIVER', 'LOAN', 'REVERSAL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ExamAttendanceStatus" AS ENUM ('PRESENT', 'ABSENT', 'EXCUSED');

-- CreateEnum
CREATE TYPE "IdentityVerificationMethod" AS ENUM ('MANUAL', 'BIOMETRIC', 'CARD');

-- CreateEnum
CREATE TYPE "MisconductStatus" AS ENUM ('REPORTED', 'UNDER_REVIEW', 'UPHELD', 'DISMISSED', 'APPEALED');

-- CreateEnum
CREATE TYPE "ClearanceType" AS ENUM ('GRADUATION', 'WITHDRAWAL', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ClearanceStepStatus" AS ENUM ('PENDING', 'CLEARED', 'BLOCKED', 'WAIVED');

-- CreateEnum
CREATE TYPE "GraduationCandidateStatus" AS ENUM ('EVALUATED', 'PENDING_CLEARANCE', 'RECOMMENDED', 'APPROVED', 'DEFERRED', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('STATEMENT_OF_RESULT', 'PROVISIONAL_TRANSCRIPT', 'FINAL_TRANSCRIPT', 'SENATE_TRANSCRIPT', 'DIRECTORATE_TRANSCRIPT', 'CERTIFICATE', 'EXAM_CARD', 'REGISTRATION_SLIP', 'RESULT_SHEET', 'PAYMENT_RECEIPT');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('GENERATING', 'ISSUED', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "TranscriptRequestStatus" AS ENUM ('SUBMITTED', 'AWAITING_PAYMENT', 'IN_REVIEW', 'APPROVED', 'GENERATED', 'DISPATCHED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FileClass" AS ENUM ('STUDENT_UPLOAD', 'GENERATED_DOCUMENT', 'IMPORT_ARTEFACT', 'AUDIT_ANCHOR', 'BIOMETRIC_TEMPLATE');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "AuditTier" AS ENUM ('STANDARD', 'TAMPER_EVIDENT');

-- AlterTable
ALTER TABLE "academic_sessions" ADD COLUMN     "state" "SessionState" NOT NULL DEFAULT 'PLANNED';

-- AlterTable
ALTER TABLE "student_records" ADD COLUMN     "curriculum_version_id" UUID,
ADD COLUMN     "expected_graduation_session_id" UUID,
ADD COLUMN     "origin" "RecordOrigin" NOT NULL DEFAULT 'IMPORT',
ADD COLUMN     "student_category_id" UUID;

-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "actor_roles" JSONB,
ADD COLUMN     "actor_scope" JSONB,
ADD COLUMN     "correlation_id" TEXT,
ADD COLUMN     "impersonated_by" UUID,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "prev_hash" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "request_id" TEXT,
ADD COLUMN     "row_hash" TEXT,
ADD COLUMN     "seq" BIGINT,
ADD COLUMN     "tier" "AuditTier" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "mfa_factors" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "factor_type" TEXT NOT NULL DEFAULT 'TOTP',
    "label" TEXT,
    "secret_hash" TEXT NOT NULL,
    "confirmed_at" TIMESTAMP(3),
    "last_used_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_factors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "factor_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMP(3),

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_transitions" (
    "id" UUID NOT NULL,
    "from_status_id" UUID NOT NULL,
    "to_status_id" UUID NOT NULL,
    "required_permission" TEXT,
    "requires_approval" BOOLEAN NOT NULL DEFAULT false,
    "is_appealable" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_transitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_status_history" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "from_status_id" UUID,
    "to_status_id" UUID NOT NULL,
    "session_id" UUID,
    "reason" TEXT NOT NULL,
    "proposal_id" UUID,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_level_history" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "from_level" INTEGER,
    "to_level" INTEGER NOT NULL,
    "session_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_level_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_amendments" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "field_key" TEXT NOT NULL,
    "old_value" TEXT,
    "new_value" TEXT,
    "reason" TEXT NOT NULL,
    "evidence_file_id" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "record_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_holds" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "hold_type" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blocks_registration" BOOLEAN NOT NULL DEFAULT true,
    "blocks_exam" BOOLEAN NOT NULL DEFAULT false,
    "blocks_results" BOOLEAN NOT NULL DEFAULT false,
    "blocks_graduation" BOOLEAN NOT NULL DEFAULT false,
    "placed_by" UUID,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" UUID,
    "released_at" TIMESTAMP(3),
    "release_note" TEXT,

    CONSTRAINT "student_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_anchors" (
    "id" UUID NOT NULL,
    "head_seq" BIGINT NOT NULL,
    "head_hash" TEXT NOT NULL,
    "worm_key" TEXT,
    "external_ref" TEXT,
    "anchored_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verified_at" TIMESTAMP(3),
    "verify_outcome" TEXT,

    CONSTRAINT "audit_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_windows" (
    "id" UUID NOT NULL,
    "window_type" "WindowType" NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID,
    "scope_type" "ScopeType" NOT NULL DEFAULT 'GLOBAL',
    "faculty_id" UUID,
    "department_id" UUID,
    "programme_id" UUID,
    "opens_at" TIMESTAMP(3) NOT NULL,
    "closes_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "calendar_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "approval_stages" (
    "id" UUID NOT NULL,
    "domain" "ApprovalDomain" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "required_role_id" UUID,
    "scope_kind" "ScopeType" NOT NULL DEFAULT 'DEPARTMENT',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "approval_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "applications" (
    "id" UUID NOT NULL,
    "application_number" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "jamb_registration_number" TEXT,
    "surname" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "other_names" TEXT,
    "date_of_birth" DATE NOT NULL,
    "gender" "Gender" NOT NULL DEFAULT 'UNSPECIFIED',
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "entry_mode" "EntryMode" NOT NULL DEFAULT 'UTME',
    "qualifications" JSONB,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "review_score" DECIMAL(6,2),
    "review_note" TEXT,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "application_documents" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "document_type" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" UUID,
    "verified_at" TIMESTAMP(3),
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "application_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admission_offers" (
    "id" UUID NOT NULL,
    "application_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "entry_level" INTEGER NOT NULL DEFAULT 100,
    "status" "OfferStatus" NOT NULL DEFAULT 'ISSUED',
    "expires_at" TIMESTAMP(3),
    "issued_by" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),
    "revoke_reason" TEXT,
    "student_record_id" UUID,
    "enrolled_at" TIMESTAMP(3),

    CONSTRAINT "admission_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriculation_sequences" (
    "id" UUID NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "faculty_id" UUID,
    "department_id" UUID,
    "programme_id" UUID,
    "format" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL DEFAULT 1,
    "last_assigned_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "matriculation_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "programme_id" UUID,
    "file_name" TEXT NOT NULL,
    "file_id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_count" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "adopted_count" INTEGER NOT NULL DEFAULT 0,
    "reversed_count" INTEGER NOT NULL DEFAULT 0,
    "validation_errors" JSONB,
    "created_by" UUID,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batch_rows" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "row_number" INTEGER NOT NULL,
    "raw_data" JSONB NOT NULL,
    "is_valid" BOOLEAN,
    "errors" JSONB,
    "claimed_matric" TEXT,
    "student_record_id" UUID,
    "reversed_in_batch_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batch_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_allocations" (
    "id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'LECTURER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "curriculum_version_id" UUID,
    "status" "RegistrationStatus" NOT NULL DEFAULT 'DRAFT',
    "total_units" INTEGER NOT NULL DEFAULT 0,
    "min_units" INTEGER,
    "max_units" INTEGER,
    "submitted_at" TIMESTAMP(3),
    "approved_at" TIMESTAMP(3),
    "locked_at" TIMESTAMP(3),
    "locked_by" UUID,
    "reject_reason" TEXT,
    "idempotency_key" TEXT,
    "slip_document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_lines" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "course_offering_id" UUID NOT NULL,
    "credit_units" INTEGER NOT NULL,
    "line_type" "RegistrationLineType" NOT NULL DEFAULT 'NEW',
    "state" "RegistrationLineState" NOT NULL DEFAULT 'ACTIVE',
    "exception_id" UUID,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dropped_at" TIMESTAMP(3),
    "dropped_by" UUID,

    CONSTRAINT "registration_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_approvals" (
    "id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_exceptions" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "registration_id" UUID,
    "session_id" UUID NOT NULL,
    "exception_type" "RegistrationExceptionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "parameters" JSONB,
    "evidence_file_id" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_schedules" (
    "id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "session_id" UUID,
    "name" TEXT NOT NULL,
    "clearance_threshold_bps" INTEGER NOT NULL DEFAULT 10000,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "semesterId" UUID,

    CONSTRAINT "fee_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fee_items" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "fee_type" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "fee_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "invoice_number" TEXT NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "total_amount" BIGINT NOT NULL DEFAULT 0,
    "paid_amount" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "fee_item_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_amount" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "invoice_id" UUID,
    "amount" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'NGN',
    "provider" TEXT NOT NULL,
    "provider_reference" TEXT,
    "status" "PaymentIntentStatus" NOT NULL DEFAULT 'CREATED',
    "discrepancy_amount" BIGINT,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "paid_at" TIMESTAMP(3),
    "posted_at" TIMESTAMP(3),

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "payment_intent_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "provider_payload" JSONB NOT NULL,
    "sequence" INTEGER NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID,
    "direction" "LedgerDirection" NOT NULL,
    "source" "LedgerSource" NOT NULL,
    "amount" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "invoice_id" UUID,
    "payment_intent_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waivers" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "invoice_id" UUID,
    "fee_type" TEXT,
    "amount" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "applied_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "academicSessionId" UUID,

    CONSTRAINT "waivers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loan_clearances" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "loan_provider" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "amount_covered" BIGINT NOT NULL,
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "recorded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_clearances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_reconciliations" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "settlement_date" DATE NOT NULL,
    "report_file_id" UUID,
    "provider_total" BIGINT NOT NULL,
    "ledger_total" BIGINT NOT NULL,
    "discrepancy" BIGINT NOT NULL DEFAULT 0,
    "matched_count" INTEGER NOT NULL DEFAULT 0,
    "unmatched_count" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "reconciled_by" UUID,
    "reconciled_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assessment_components" (
    "id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "weight" DECIMAL(5,2) NOT NULL,
    "max_score" DECIMAL(6,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "assessment_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_entries" (
    "id" UUID NOT NULL,
    "component_id" UUID NOT NULL,
    "registration_line_id" UUID NOT NULL,
    "score" DECIMAL(6,2),
    "mark" "ScoreMark" NOT NULL DEFAULT 'SCORED',
    "state" "ScoreEntryState" NOT NULL DEFAULT 'DRAFT',
    "entered_by" UUID,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "score_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_batches" (
    "id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "grade_scale_id" UUID NOT NULL,
    "status" "ResultBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "ratified_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "published_by" UUID,
    "publish_cosigner" UUID,
    "reject_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "result_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_approvals" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "decision" "ApprovalDecision" NOT NULL,
    "comment" TEXT,
    "decided_by" UUID NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_records" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "registration_line_id" UUID NOT NULL,
    "batch_id" UUID,
    "offering_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "total_score" DECIMAL(6,2),
    "grade" TEXT,
    "grade_point" DECIMAL(3,2),
    "credit_units" INTEGER NOT NULL,
    "mark" "ScoreMark" NOT NULL DEFAULT 'SCORED',
    "grade_scale_id" UUID NOT NULL,
    "counts_toward_cgpa" BOOLEAN NOT NULL DEFAULT true,
    "is_carryover" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "superseded_by" UUID,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grade_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_amendments" (
    "id" UUID NOT NULL,
    "grade_record_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "proposed_score" DECIMAL(6,2),
    "proposed_mark" "ScoreMark",
    "evidence_file_id" UUID,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "decision_note" TEXT,
    "decided_at" TIMESTAMP(3),
    "resulting_grade_record_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_amendments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_withholdings" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID,
    "offering_id" UUID,
    "reason" TEXT NOT NULL,
    "status" "WithholdingStatus" NOT NULL DEFAULT 'ACTIVE',
    "placed_by" UUID,
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "released_by" UUID,
    "released_at" TIMESTAMP(3),

    CONSTRAINT "result_withholdings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "semester_gpas" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "units_registered" INTEGER NOT NULL,
    "units_passed" INTEGER NOT NULL,
    "grade_points" DECIMAL(8,2) NOT NULL,
    "gpa" DECIMAL(4,2) NOT NULL,
    "cumulative_units" INTEGER NOT NULL,
    "cumulative_grade_points" DECIMAL(10,2) NOT NULL,
    "cgpa" DECIMAL(4,2) NOT NULL,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "semester_gpas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_rules" (
    "id" UUID NOT NULL,
    "programme_id" UUID,
    "curriculum_version_id" UUID,
    "level" INTEGER,
    "name" TEXT NOT NULL,
    "outcome" "ProgressionOutcome" NOT NULL,
    "min_cgpa" DECIMAL(4,2),
    "max_cgpa" DECIMAL(4,2),
    "min_units_passed" INTEGER,
    "max_carryover_units" INTEGER,
    "consecutive_sessions" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "progression_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "progression_proposals" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "from_level" INTEGER,
    "to_level" INTEGER,
    "outcome" "ProgressionOutcome" NOT NULL,
    "rule_id" UUID,
    "rationale" JSONB,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,

    CONSTRAINT "progression_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_periods" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_venues" (
    "id" UUID NOT NULL,
    "campus_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_venues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_schedules" (
    "id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "offering_id" UUID NOT NULL,
    "venue_id" UUID,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "seats_allocated" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exam_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_eligibilities" (
    "id" UUID NOT NULL,
    "registration_line_id" UUID NOT NULL,
    "is_eligible" BOOLEAN NOT NULL DEFAULT true,
    "blocked_reason" TEXT,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_by" UUID,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "exam_eligibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_cards" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "period_id" UUID NOT NULL,
    "verification_code" TEXT NOT NULL,
    "document_id" UUID,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "invalidated_at" TIMESTAMP(3),
    "invalid_reason" TEXT,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,

    CONSTRAINT "exam_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_attendances" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "registration_line_id" UUID NOT NULL,
    "status" "ExamAttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "seat_number" TEXT,
    "venue_id" UUID,
    "verification_method" "IdentityVerificationMethod" NOT NULL DEFAULT 'MANUAL',
    "recorded_by" UUID,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_attendances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exam_invigilators" (
    "id" UUID NOT NULL,
    "schedule_id" UUID NOT NULL,
    "staff_user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'INVIGILATOR',
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exam_invigilators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "misconduct_cases" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "schedule_id" UUID,
    "offering_id" UUID,
    "case_number" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "MisconductStatus" NOT NULL DEFAULT 'REPORTED',
    "sanction" TEXT,
    "applied_status_id" UUID,
    "reported_by" UUID NOT NULL,
    "reported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by" UUID,
    "decided_at" TIMESTAMP(3),
    "appeal_note" TEXT,
    "appealed_at" TIMESTAMP(3),

    CONSTRAINT "misconduct_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clearance_units" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "required_role_id" UUID,
    "clearance_type" "ClearanceType" NOT NULL DEFAULT 'GRADUATION',
    "is_mandatory" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "clearance_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clearance_requests" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "clearance_type" "ClearanceType" NOT NULL DEFAULT 'GRADUATION',
    "is_complete" BOOLEAN NOT NULL DEFAULT false,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clearance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clearance_steps" (
    "id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "status" "ClearanceStepStatus" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "signed_by" UUID,
    "signed_at" TIMESTAMP(3),
    "waived_by" UUID,
    "waived_at" TIMESTAMP(3),
    "waive_reason" TEXT,

    CONSTRAINT "clearance_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduation_candidates" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "status" "GraduationCandidateStatus" NOT NULL DEFAULT 'EVALUATED',
    "units_required" INTEGER NOT NULL,
    "units_earned" INTEGER NOT NULL,
    "final_cgpa" DECIMAL(4,2),
    "classification" TEXT,
    "deficiencies" JSONB,
    "fee_cleared" BOOLEAN NOT NULL DEFAULT false,
    "clearance_complete" BOOLEAN NOT NULL DEFAULT false,
    "evaluated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "evaluated_by" UUID,
    "note" TEXT,

    CONSTRAINT "graduation_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senate_approvals" (
    "id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "graduation_date" DATE NOT NULL,
    "final_cgpa" DECIMAL(4,2),
    "classification" TEXT,
    "minute_reference" TEXT,
    "approved_by" UUID NOT NULL,
    "approved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cosigner_id" UUID,

    CONSTRAINT "senate_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduation_lists" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "department_id" UUID,
    "batch_label" TEXT NOT NULL,
    "is_finalised" BOOLEAN NOT NULL DEFAULT false,
    "finalised_at" TIMESTAMP(3),
    "finalised_by" UUID,
    "document_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graduation_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "graduation_list_entries" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "candidate_id" UUID NOT NULL,
    "position" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "graduation_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "senate_list_entries" (
    "id" UUID NOT NULL,
    "list_id" UUID NOT NULL,
    "matriculation_number" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "nysc_vetted" BOOLEAN NOT NULL DEFAULT false,
    "student_record_id" UUID,
    "discrepancy_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "senate_list_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_batches" (
    "id" UUID NOT NULL,
    "target" TEXT NOT NULL,
    "session_id" UUID NOT NULL,
    "is_dry_run" BOOLEAN NOT NULL DEFAULT true,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "total_items" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "file_id" UUID,
    "external_reference" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),

    CONSTRAINT "export_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "export_batch_items" (
    "id" UUID NOT NULL,
    "batch_id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "payload" JSONB,
    "is_successful" BOOLEAN,
    "error_message" TEXT,

    CONSTRAINT "export_batch_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_templates" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT,
    "template_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "signing_keys" (
    "id" UUID NOT NULL,
    "key_version" INTEGER NOT NULL,
    "algorithm" TEXT NOT NULL DEFAULT 'Ed25519',
    "public_key" TEXT NOT NULL,
    "private_key_ref" TEXT NOT NULL,
    "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retired_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "signing_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "generated_documents" (
    "id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'GENERATING',
    "student_record_id" UUID,
    "template_id" UUID,
    "template_version" INTEGER,
    "content_hash" TEXT NOT NULL,
    "file_id" UUID,
    "signature" TEXT,
    "signing_key_id" UUID,
    "payload_snapshot" JSONB,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,
    "superseded_by" UUID,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" TEXT,

    CONSTRAINT "generated_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verification_codes" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "key_version" INTEGER,
    "disclosure_fields" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMP(3),
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "last_viewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verification_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_requests" (
    "id" UUID NOT NULL,
    "request_number" TEXT NOT NULL,
    "student_record_id" UUID NOT NULL,
    "document_type" "DocumentType" NOT NULL,
    "status" "TranscriptRequestStatus" NOT NULL DEFAULT 'SUBMITTED',
    "delivery_method" TEXT NOT NULL,
    "recipient_name" TEXT,
    "recipient_email" TEXT,
    "recipient_address" TEXT,
    "copies" INTEGER NOT NULL DEFAULT 1,
    "invoice_id" UUID,
    "document_id" UUID,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_by" UUID,
    "reviewed_at" TIMESTAMP(3),
    "generated_at" TIMESTAMP(3),
    "dispatched_at" TIMESTAMP(3),
    "dispatch_reference" TEXT,
    "reject_reason" TEXT,

    CONSTRAINT "transcript_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificate_issuances" (
    "id" UUID NOT NULL,
    "student_record_id" UUID NOT NULL,
    "serial_number" TEXT NOT NULL,
    "senate_approval_id" UUID,
    "document_id" UUID,
    "signing_key_id" UUID,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by" UUID,
    "collected_at" TIMESTAMP(3),
    "collected_by" TEXT,
    "replaces_id" UUID,
    "replace_reason" TEXT,
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "certificate_issuances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stored_files" (
    "id" UUID NOT NULL,
    "file_class" "FileClass" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "bucket" TEXT,
    "original_filename" TEXT NOT NULL,
    "declared_mime_type" TEXT NOT NULL,
    "detected_mime_type" TEXT,
    "size_bytes" BIGINT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "scan_status" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanned_at" TIMESTAMP(3),
    "scan_result" TEXT,
    "exif_stripped" BOOLEAN NOT NULL DEFAULT false,
    "is_object_locked" BOOLEAN NOT NULL DEFAULT false,
    "encryption_key_id" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retain_until" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "stored_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_templates" (
    "id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rules" (
    "id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "is_mandatory" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "policy" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "student_record_id" UUID,
    "event_key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link_path" TEXT,
    "data" JSONB,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_dispatches" (
    "id" UUID NOT NULL,
    "notification_id" UUID,
    "template_id" UUID,
    "channel" "NotificationChannel" NOT NULL,
    "destination" TEXT NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT,
    "provider_reference" TEXT,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "failed_at" TIMESTAMP(3),

    CONSTRAINT "notification_dispatches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mfa_factors_user_id_idx" ON "mfa_factors"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_factor_id_idx" ON "mfa_recovery_codes"("factor_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_status_transitions_from_status_id_to_status_id_key" ON "student_status_transitions"("from_status_id", "to_status_id");

-- CreateIndex
CREATE INDEX "student_status_history_student_record_id_changed_at_idx" ON "student_status_history"("student_record_id", "changed_at");

-- CreateIndex
CREATE INDEX "student_status_history_to_status_id_idx" ON "student_status_history"("to_status_id");

-- CreateIndex
CREATE INDEX "student_level_history_student_record_id_changed_at_idx" ON "student_level_history"("student_record_id", "changed_at");

-- CreateIndex
CREATE INDEX "record_amendments_student_record_id_idx" ON "record_amendments"("student_record_id");

-- CreateIndex
CREATE INDEX "record_amendments_status_idx" ON "record_amendments"("status");

-- CreateIndex
CREATE INDEX "student_holds_student_record_id_idx" ON "student_holds"("student_record_id");

-- CreateIndex
CREATE INDEX "student_holds_hold_type_idx" ON "student_holds"("hold_type");

-- CreateIndex
CREATE INDEX "audit_anchors_anchored_at_idx" ON "audit_anchors"("anchored_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_anchors_head_seq_key" ON "audit_anchors"("head_seq");

-- CreateIndex
CREATE INDEX "calendar_windows_window_type_session_id_idx" ON "calendar_windows"("window_type", "session_id");

-- CreateIndex
CREATE INDEX "calendar_windows_session_id_semester_id_idx" ON "calendar_windows"("session_id", "semester_id");

-- CreateIndex
CREATE INDEX "calendar_windows_opens_at_closes_at_idx" ON "calendar_windows"("opens_at", "closes_at");

-- CreateIndex
CREATE UNIQUE INDEX "approval_stages_domain_sequence_key" ON "approval_stages"("domain", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "approval_stages_domain_key_key" ON "approval_stages"("domain", "key");

-- CreateIndex
CREATE UNIQUE INDEX "applications_application_number_key" ON "applications"("application_number");

-- CreateIndex
CREATE INDEX "applications_session_id_status_idx" ON "applications"("session_id", "status");

-- CreateIndex
CREATE INDEX "applications_programme_id_idx" ON "applications"("programme_id");

-- CreateIndex
CREATE INDEX "applications_jamb_registration_number_idx" ON "applications"("jamb_registration_number");

-- CreateIndex
CREATE INDEX "applications_email_idx" ON "applications"("email");

-- CreateIndex
CREATE INDEX "application_documents_application_id_idx" ON "application_documents"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_application_id_key" ON "admission_offers"("application_id");

-- CreateIndex
CREATE UNIQUE INDEX "admission_offers_student_record_id_key" ON "admission_offers"("student_record_id");

-- CreateIndex
CREATE INDEX "admission_offers_session_id_status_idx" ON "admission_offers"("session_id", "status");

-- CreateIndex
CREATE INDEX "admission_offers_programme_id_idx" ON "admission_offers"("programme_id");

-- CreateIndex
CREATE UNIQUE INDEX "matriculation_sequences_scopeKey_key" ON "matriculation_sequences"("scopeKey");

-- CreateIndex
CREATE UNIQUE INDEX "matriculation_sequences_scopeKey_year_key" ON "matriculation_sequences"("scopeKey", "year");

-- CreateIndex
CREATE INDEX "import_batches_session_id_idx" ON "import_batches"("session_id");

-- CreateIndex
CREATE INDEX "import_batches_status_idx" ON "import_batches"("status");

-- CreateIndex
CREATE INDEX "import_batch_rows_batch_id_idx" ON "import_batch_rows"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_batch_rows_batch_id_row_number_key" ON "import_batch_rows"("batch_id", "row_number");

-- CreateIndex
CREATE INDEX "course_allocations_staff_user_id_idx" ON "course_allocations"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_allocations_offering_id_staff_user_id_key" ON "course_allocations"("offering_id", "staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_idempotency_key_key" ON "registrations"("idempotency_key");

-- CreateIndex
CREATE INDEX "registrations_session_id_semester_id_idx" ON "registrations"("session_id", "semester_id");

-- CreateIndex
CREATE INDEX "registrations_status_idx" ON "registrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_student_record_id_semester_id_key" ON "registrations"("student_record_id", "semester_id");

-- CreateIndex
CREATE INDEX "registration_lines_registration_id_idx" ON "registration_lines"("registration_id");

-- CreateIndex
CREATE INDEX "registration_lines_course_offering_id_idx" ON "registration_lines"("course_offering_id");

-- CreateIndex
CREATE INDEX "registration_approvals_registration_id_idx" ON "registration_approvals"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "registration_approvals_registration_id_stage_id_key" ON "registration_approvals"("registration_id", "stage_id");

-- CreateIndex
CREATE INDEX "registration_exceptions_student_record_id_idx" ON "registration_exceptions"("student_record_id");

-- CreateIndex
CREATE INDEX "registration_exceptions_session_id_exception_type_idx" ON "registration_exceptions"("session_id", "exception_type");

-- CreateIndex
CREATE INDEX "registration_exceptions_status_idx" ON "registration_exceptions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "student_categories_key_key" ON "student_categories"("key");

-- CreateIndex
CREATE INDEX "fee_schedules_programme_id_idx" ON "fee_schedules"("programme_id");

-- CreateIndex
CREATE INDEX "fee_items_schedule_id_idx" ON "fee_items"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "fee_items_schedule_id_fee_type_key" ON "fee_items"("schedule_id", "fee_type");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoice_number_key" ON "invoices"("invoice_number");

-- CreateIndex
CREATE INDEX "invoices_student_record_id_idx" ON "invoices"("student_record_id");

-- CreateIndex
CREATE INDEX "invoices_session_id_semester_id_idx" ON "invoices"("session_id", "semester_id");

-- CreateIndex
CREATE INDEX "invoice_lines_invoice_id_idx" ON "invoice_lines"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_idempotency_key_key" ON "payment_intents"("idempotency_key");

-- CreateIndex
CREATE INDEX "payment_intents_student_record_id_idx" ON "payment_intents"("student_record_id");

-- CreateIndex
CREATE INDEX "payment_intents_invoice_id_idx" ON "payment_intents"("invoice_id");

-- CreateIndex
CREATE INDEX "payment_intents_provider_reference_idx" ON "payment_intents"("provider_reference");

-- CreateIndex
CREATE INDEX "payment_events_payment_intent_id_idx" ON "payment_events"("payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_payment_intent_id_sequence_key" ON "payment_events"("payment_intent_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_idempotency_key_key" ON "ledger_entries"("idempotency_key");

-- CreateIndex
CREATE INDEX "ledger_entries_student_record_id_created_at_idx" ON "ledger_entries"("student_record_id", "created_at");

-- CreateIndex
CREATE INDEX "ledger_entries_invoice_id_idx" ON "ledger_entries"("invoice_id");

-- CreateIndex
CREATE INDEX "ledger_entries_source_idx" ON "ledger_entries"("source");

-- CreateIndex
CREATE INDEX "waivers_student_record_id_idx" ON "waivers"("student_record_id");

-- CreateIndex
CREATE INDEX "waivers_status_idx" ON "waivers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "loan_clearances_reference_key" ON "loan_clearances"("reference");

-- CreateIndex
CREATE INDEX "loan_clearances_student_record_id_idx" ON "loan_clearances"("student_record_id");

-- CreateIndex
CREATE INDEX "payment_reconciliations_settlement_date_idx" ON "payment_reconciliations"("settlement_date");

-- CreateIndex
CREATE UNIQUE INDEX "payment_reconciliations_provider_settlement_date_key" ON "payment_reconciliations"("provider", "settlement_date");

-- CreateIndex
CREATE INDEX "assessment_components_offering_id_idx" ON "assessment_components"("offering_id");

-- CreateIndex
CREATE UNIQUE INDEX "assessment_components_offering_id_key_key" ON "assessment_components"("offering_id", "key");

-- CreateIndex
CREATE INDEX "score_entries_registration_line_id_idx" ON "score_entries"("registration_line_id");

-- CreateIndex
CREATE UNIQUE INDEX "score_entries_component_id_registration_line_id_key" ON "score_entries"("component_id", "registration_line_id");

-- CreateIndex
CREATE INDEX "result_batches_session_id_semester_id_idx" ON "result_batches"("session_id", "semester_id");

-- CreateIndex
CREATE INDEX "result_batches_status_idx" ON "result_batches"("status");

-- CreateIndex
CREATE UNIQUE INDEX "result_batches_offering_id_key" ON "result_batches"("offering_id");

-- CreateIndex
CREATE INDEX "result_approvals_batch_id_idx" ON "result_approvals"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "result_approvals_batch_id_stage_id_key" ON "result_approvals"("batch_id", "stage_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_records_superseded_by_key" ON "grade_records"("superseded_by");

-- CreateIndex
CREATE INDEX "grade_records_student_record_id_session_id_idx" ON "grade_records"("student_record_id", "session_id");

-- CreateIndex
CREATE INDEX "grade_records_registration_line_id_idx" ON "grade_records"("registration_line_id");

-- CreateIndex
CREATE INDEX "grade_records_offering_id_idx" ON "grade_records"("offering_id");

-- CreateIndex
CREATE INDEX "grade_records_course_id_idx" ON "grade_records"("course_id");

-- CreateIndex
CREATE INDEX "grade_records_batch_id_idx" ON "grade_records"("batch_id");

-- CreateIndex
CREATE INDEX "result_amendments_grade_record_id_idx" ON "result_amendments"("grade_record_id");

-- CreateIndex
CREATE INDEX "result_amendments_status_idx" ON "result_amendments"("status");

-- CreateIndex
CREATE INDEX "result_withholdings_student_record_id_idx" ON "result_withholdings"("student_record_id");

-- CreateIndex
CREATE INDEX "result_withholdings_status_idx" ON "result_withholdings"("status");

-- CreateIndex
CREATE INDEX "semester_gpas_student_record_id_idx" ON "semester_gpas"("student_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "semester_gpas_student_record_id_semester_id_key" ON "semester_gpas"("student_record_id", "semester_id");

-- CreateIndex
CREATE INDEX "progression_rules_programme_id_idx" ON "progression_rules"("programme_id");

-- CreateIndex
CREATE INDEX "progression_rules_curriculum_version_id_idx" ON "progression_rules"("curriculum_version_id");

-- CreateIndex
CREATE INDEX "progression_proposals_session_id_status_idx" ON "progression_proposals"("session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "progression_proposals_student_record_id_session_id_key" ON "progression_proposals"("student_record_id", "session_id");

-- CreateIndex
CREATE INDEX "exam_periods_session_id_semester_id_idx" ON "exam_periods"("session_id", "semester_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_periods_session_id_semester_id_name_key" ON "exam_periods"("session_id", "semester_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "exam_venues_code_key" ON "exam_venues"("code");

-- CreateIndex
CREATE INDEX "exam_venues_campus_id_idx" ON "exam_venues"("campus_id");

-- CreateIndex
CREATE INDEX "exam_schedules_period_id_idx" ON "exam_schedules"("period_id");

-- CreateIndex
CREATE INDEX "exam_schedules_venue_id_starts_at_idx" ON "exam_schedules"("venue_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "exam_schedules_offering_id_period_id_key" ON "exam_schedules"("offering_id", "period_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_eligibilities_registration_line_id_key" ON "exam_eligibilities"("registration_line_id");

-- CreateIndex
CREATE INDEX "exam_eligibilities_is_eligible_idx" ON "exam_eligibilities"("is_eligible");

-- CreateIndex
CREATE UNIQUE INDEX "exam_cards_verification_code_key" ON "exam_cards"("verification_code");

-- CreateIndex
CREATE INDEX "exam_cards_period_id_idx" ON "exam_cards"("period_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_cards_student_record_id_period_id_key" ON "exam_cards"("student_record_id", "period_id");

-- CreateIndex
CREATE INDEX "exam_attendances_schedule_id_idx" ON "exam_attendances"("schedule_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_attendances_schedule_id_registration_line_id_key" ON "exam_attendances"("schedule_id", "registration_line_id");

-- CreateIndex
CREATE INDEX "exam_invigilators_staff_user_id_idx" ON "exam_invigilators"("staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "exam_invigilators_schedule_id_staff_user_id_key" ON "exam_invigilators"("schedule_id", "staff_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "misconduct_cases_case_number_key" ON "misconduct_cases"("case_number");

-- CreateIndex
CREATE INDEX "misconduct_cases_student_record_id_idx" ON "misconduct_cases"("student_record_id");

-- CreateIndex
CREATE INDEX "misconduct_cases_status_idx" ON "misconduct_cases"("status");

-- CreateIndex
CREATE UNIQUE INDEX "clearance_units_key_key" ON "clearance_units"("key");

-- CreateIndex
CREATE INDEX "clearance_requests_session_id_idx" ON "clearance_requests"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "clearance_requests_student_record_id_session_id_clearance_t_key" ON "clearance_requests"("student_record_id", "session_id", "clearance_type");

-- CreateIndex
CREATE INDEX "clearance_steps_request_id_idx" ON "clearance_steps"("request_id");

-- CreateIndex
CREATE INDEX "clearance_steps_status_idx" ON "clearance_steps"("status");

-- CreateIndex
CREATE UNIQUE INDEX "clearance_steps_request_id_unit_id_key" ON "clearance_steps"("request_id", "unit_id");

-- CreateIndex
CREATE INDEX "graduation_candidates_session_id_status_idx" ON "graduation_candidates"("session_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "graduation_candidates_student_record_id_session_id_key" ON "graduation_candidates"("student_record_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "senate_approvals_candidate_id_key" ON "senate_approvals"("candidate_id");

-- CreateIndex
CREATE INDEX "senate_approvals_session_id_idx" ON "senate_approvals"("session_id");

-- CreateIndex
CREATE INDEX "senate_approvals_graduation_date_idx" ON "senate_approvals"("graduation_date");

-- CreateIndex
CREATE INDEX "graduation_lists_session_id_idx" ON "graduation_lists"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "graduation_lists_session_id_department_id_batch_label_key" ON "graduation_lists"("session_id", "department_id", "batch_label");

-- CreateIndex
CREATE INDEX "graduation_list_entries_list_id_idx" ON "graduation_list_entries"("list_id");

-- CreateIndex
CREATE UNIQUE INDEX "graduation_list_entries_list_id_candidate_id_key" ON "graduation_list_entries"("list_id", "candidate_id");

-- CreateIndex
CREATE INDEX "senate_list_entries_list_id_idx" ON "senate_list_entries"("list_id");

-- CreateIndex
CREATE UNIQUE INDEX "senate_list_entries_list_id_matriculation_number_key" ON "senate_list_entries"("list_id", "matriculation_number");

-- CreateIndex
CREATE INDEX "export_batches_session_id_target_idx" ON "export_batches"("session_id", "target");

-- CreateIndex
CREATE INDEX "export_batch_items_batch_id_idx" ON "export_batch_items"("batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "export_batch_items_batch_id_student_record_id_key" ON "export_batch_items"("batch_id", "student_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_document_type_version_key" ON "document_templates"("document_type", "version");

-- CreateIndex
CREATE UNIQUE INDEX "signing_keys_key_version_key" ON "signing_keys"("key_version");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_content_hash_key" ON "generated_documents"("content_hash");

-- CreateIndex
CREATE UNIQUE INDEX "generated_documents_superseded_by_key" ON "generated_documents"("superseded_by");

-- CreateIndex
CREATE INDEX "generated_documents_student_record_id_idx" ON "generated_documents"("student_record_id");

-- CreateIndex
CREATE INDEX "generated_documents_document_type_idx" ON "generated_documents"("document_type");

-- CreateIndex
CREATE INDEX "generated_documents_status_idx" ON "generated_documents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "verification_codes_code_key" ON "verification_codes"("code");

-- CreateIndex
CREATE INDEX "verification_codes_document_id_idx" ON "verification_codes"("document_id");

-- CreateIndex
CREATE UNIQUE INDEX "transcript_requests_request_number_key" ON "transcript_requests"("request_number");

-- CreateIndex
CREATE INDEX "transcript_requests_student_record_id_idx" ON "transcript_requests"("student_record_id");

-- CreateIndex
CREATE INDEX "transcript_requests_status_idx" ON "transcript_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_issuances_serial_number_key" ON "certificate_issuances"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "certificate_issuances_replaces_id_key" ON "certificate_issuances"("replaces_id");

-- CreateIndex
CREATE INDEX "certificate_issuances_student_record_id_idx" ON "certificate_issuances"("student_record_id");

-- CreateIndex
CREATE UNIQUE INDEX "stored_files_storage_key_key" ON "stored_files"("storage_key");

-- CreateIndex
CREATE INDEX "stored_files_file_class_idx" ON "stored_files"("file_class");

-- CreateIndex
CREATE INDEX "stored_files_content_hash_idx" ON "stored_files"("content_hash");

-- CreateIndex
CREATE INDEX "stored_files_scan_status_idx" ON "stored_files"("scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_templates_event_key_channel_version_key" ON "notification_templates"("event_key", "channel", "version");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rules_event_key_channel_key" ON "notification_rules"("event_key", "channel");

-- CreateIndex
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");

-- CreateIndex
CREATE INDEX "notifications_student_record_id_idx" ON "notifications"("student_record_id");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE INDEX "notification_dispatches_notification_id_idx" ON "notification_dispatches"("notification_id");

-- CreateIndex
CREATE INDEX "notification_dispatches_status_queued_at_idx" ON "notification_dispatches"("status", "queued_at");

-- CreateIndex
CREATE INDEX "notification_dispatches_queued_at_idx" ON "notification_dispatches"("queued_at");

-- CreateIndex
CREATE INDEX "academic_sessions_state_idx" ON "academic_sessions"("state");

-- CreateIndex
CREATE INDEX "student_records_curriculum_version_id_idx" ON "student_records"("curriculum_version_id");

-- CreateIndex
CREATE INDEX "student_records_programme_id_current_level_student_status_i_idx" ON "student_records"("programme_id", "current_level", "student_status_id");

-- CreateIndex
CREATE INDEX "audit_events_correlation_id_idx" ON "audit_events"("correlation_id");

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_seq_key" ON "audit_events"("seq");

-- AddForeignKey
ALTER TABLE "mfa_factors" ADD CONSTRAINT "mfa_factors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_factor_id_fkey" FOREIGN KEY ("factor_id") REFERENCES "mfa_factors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_transitions" ADD CONSTRAINT "student_status_transitions_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "student_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_transitions" ADD CONSTRAINT "student_status_transitions_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "student_statuses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_student_category_id_fkey" FOREIGN KEY ("student_category_id") REFERENCES "student_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_records" ADD CONSTRAINT "student_records_expected_graduation_session_id_fkey" FOREIGN KEY ("expected_graduation_session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_from_status_id_fkey" FOREIGN KEY ("from_status_id") REFERENCES "student_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_to_status_id_fkey" FOREIGN KEY ("to_status_id") REFERENCES "student_statuses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_status_history" ADD CONSTRAINT "student_status_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_level_history" ADD CONSTRAINT "student_level_history_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_level_history" ADD CONSTRAINT "student_level_history_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_amendments" ADD CONSTRAINT "record_amendments_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_holds" ADD CONSTRAINT "student_holds_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_windows" ADD CONSTRAINT "calendar_windows_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_windows" ADD CONSTRAINT "calendar_windows_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_windows" ADD CONSTRAINT "calendar_windows_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_windows" ADD CONSTRAINT "calendar_windows_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_windows" ADD CONSTRAINT "calendar_windows_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "approval_stages" ADD CONSTRAINT "approval_stages_required_role_id_fkey" FOREIGN KEY ("required_role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "application_documents" ADD CONSTRAINT "application_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admission_offers" ADD CONSTRAINT "admission_offers_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch_rows" ADD CONSTRAINT "import_batch_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batch_rows" ADD CONSTRAINT "import_batch_rows_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_allocations" ADD CONSTRAINT "course_allocations_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_allocations" ADD CONSTRAINT "course_allocations_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_lines" ADD CONSTRAINT "registration_lines_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_lines" ADD CONSTRAINT "registration_lines_course_offering_id_fkey" FOREIGN KEY ("course_offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_approvals" ADD CONSTRAINT "registration_approvals_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_approvals" ADD CONSTRAINT "registration_approvals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_exceptions" ADD CONSTRAINT "registration_exceptions_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_exceptions" ADD CONSTRAINT "registration_exceptions_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_exceptions" ADD CONSTRAINT "registration_exceptions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_semesterId_fkey" FOREIGN KEY ("semesterId") REFERENCES "semesters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fee_items" ADD CONSTRAINT "fee_items_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "fee_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_fee_item_id_fkey" FOREIGN KEY ("fee_item_id") REFERENCES "fee_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_intents" ADD CONSTRAINT "payment_intents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_intent_id_fkey" FOREIGN KEY ("payment_intent_id") REFERENCES "payment_intents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waivers" ADD CONSTRAINT "waivers_academicSessionId_fkey" FOREIGN KEY ("academicSessionId") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_clearances" ADD CONSTRAINT "loan_clearances_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_clearances" ADD CONSTRAINT "loan_clearances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_reconciliations" ADD CONSTRAINT "payment_reconciliations_report_file_id_fkey" FOREIGN KEY ("report_file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assessment_components" ADD CONSTRAINT "assessment_components_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_entries" ADD CONSTRAINT "score_entries_component_id_fkey" FOREIGN KEY ("component_id") REFERENCES "assessment_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_batches" ADD CONSTRAINT "result_batches_grade_scale_id_fkey" FOREIGN KEY ("grade_scale_id") REFERENCES "grade_scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_approvals" ADD CONSTRAINT "result_approvals_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "result_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_approvals" ADD CONSTRAINT "result_approvals_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "approval_stages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_registration_line_id_fkey" FOREIGN KEY ("registration_line_id") REFERENCES "registration_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "result_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_grade_scale_id_fkey" FOREIGN KEY ("grade_scale_id") REFERENCES "grade_scales"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_records" ADD CONSTRAINT "grade_records_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "grade_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_amendments" ADD CONSTRAINT "result_amendments_grade_record_id_fkey" FOREIGN KEY ("grade_record_id") REFERENCES "grade_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_withholdings" ADD CONSTRAINT "result_withholdings_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_withholdings" ADD CONSTRAINT "result_withholdings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_withholdings" ADD CONSTRAINT "result_withholdings_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_gpas" ADD CONSTRAINT "semester_gpas_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_gpas" ADD CONSTRAINT "semester_gpas_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "semester_gpas" ADD CONSTRAINT "semester_gpas_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_rules" ADD CONSTRAINT "progression_rules_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_rules" ADD CONSTRAINT "progression_rules_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_proposals" ADD CONSTRAINT "progression_proposals_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_proposals" ADD CONSTRAINT "progression_proposals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "progression_proposals" ADD CONSTRAINT "progression_proposals_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "progression_rules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_periods" ADD CONSTRAINT "exam_periods_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_periods" ADD CONSTRAINT "exam_periods_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_venues" ADD CONSTRAINT "exam_venues_campus_id_fkey" FOREIGN KEY ("campus_id") REFERENCES "campuses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "exam_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_schedules" ADD CONSTRAINT "exam_schedules_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "exam_venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_eligibilities" ADD CONSTRAINT "exam_eligibilities_registration_line_id_fkey" FOREIGN KEY ("registration_line_id") REFERENCES "registration_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_cards" ADD CONSTRAINT "exam_cards_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_cards" ADD CONSTRAINT "exam_cards_period_id_fkey" FOREIGN KEY ("period_id") REFERENCES "exam_periods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attendances" ADD CONSTRAINT "exam_attendances_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_attendances" ADD CONSTRAINT "exam_attendances_venue_id_fkey" FOREIGN KEY ("venue_id") REFERENCES "exam_venues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "exam_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exam_invigilators" ADD CONSTRAINT "exam_invigilators_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "misconduct_cases" ADD CONSTRAINT "misconduct_cases_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "misconduct_cases" ADD CONSTRAINT "misconduct_cases_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "exam_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "misconduct_cases" ADD CONSTRAINT "misconduct_cases_offering_id_fkey" FOREIGN KEY ("offering_id") REFERENCES "course_offerings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_units" ADD CONSTRAINT "clearance_units_required_role_id_fkey" FOREIGN KEY ("required_role_id") REFERENCES "roles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_requests" ADD CONSTRAINT "clearance_requests_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_steps" ADD CONSTRAINT "clearance_steps_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "clearance_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clearance_steps" ADD CONSTRAINT "clearance_steps_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "clearance_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_candidates" ADD CONSTRAINT "graduation_candidates_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_candidates" ADD CONSTRAINT "graduation_candidates_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senate_approvals" ADD CONSTRAINT "senate_approvals_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "graduation_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senate_approvals" ADD CONSTRAINT "senate_approvals_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_lists" ADD CONSTRAINT "graduation_lists_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_lists" ADD CONSTRAINT "graduation_lists_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_list_entries" ADD CONSTRAINT "graduation_list_entries_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "graduation_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "graduation_list_entries" ADD CONSTRAINT "graduation_list_entries_candidate_id_fkey" FOREIGN KEY ("candidate_id") REFERENCES "graduation_candidates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "senate_list_entries" ADD CONSTRAINT "senate_list_entries_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "graduation_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_batches" ADD CONSTRAINT "export_batches_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_batches" ADD CONSTRAINT "export_batches_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_batch_items" ADD CONSTRAINT "export_batch_items_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "export_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "export_batch_items" ADD CONSTRAINT "export_batch_items_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "document_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_signing_key_id_fkey" FOREIGN KEY ("signing_key_id") REFERENCES "signing_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_superseded_by_fkey" FOREIGN KEY ("superseded_by") REFERENCES "generated_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_codes" ADD CONSTRAINT "verification_codes_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "generated_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_requests" ADD CONSTRAINT "transcript_requests_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_issuances" ADD CONSTRAINT "certificate_issuances_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_issuances" ADD CONSTRAINT "certificate_issuances_signing_key_id_fkey" FOREIGN KEY ("signing_key_id") REFERENCES "signing_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificate_issuances" ADD CONSTRAINT "certificate_issuances_replaces_id_fkey" FOREIGN KEY ("replaces_id") REFERENCES "certificate_issuances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_student_record_id_fkey" FOREIGN KEY ("student_record_id") REFERENCES "student_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_dispatches" ADD CONSTRAINT "notification_dispatches_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_dispatches" ADD CONSTRAINT "notification_dispatches_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "notification_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: reconcile the new session lifecycle with the existing flag.
--
-- academic_sessions.state arrived defaulted to PLANNED. The session already
-- marked is_current is, by definition, the one being taught — leaving it
-- PLANNED would make the very first read of the new column a lie, and every
-- window predicate keyed on ACTIVE would resolve closed.
--
-- Idempotent, and a no-op on a fresh database where no session is current yet.
-- ---------------------------------------------------------------------------
UPDATE "academic_sessions" SET "state" = 'ACTIVE'
 WHERE "is_current" AND "state" = 'PLANNED';
