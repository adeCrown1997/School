-- ===========================================================================
--  ePortal — database guards (Layer 2 of the identity invariant)
--  Applied AFTER `prisma migrate` against the SAME database. Idempotent.
--
--  What lives here (and not in schema.prisma) is everything Prisma cannot
--  express: the protected-field trigger, audit append-only triggers, the
--  separation-of-duties CHECK, partial/functional unique indexes, and the
--  least-privilege GRANTs for the application role.
--
--  Run as a role that owns the tables (DATABASE_ADMIN_URL). See docs 28.
-- ===========================================================================

-- citext is used for case-insensitive email / matric comparisons.
CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- 1) Protected-field guard on student_records (INV-3)
--    Any UPDATE that changes a PROTECTED column is rejected UNLESS the session
--    has set `eportal.amendment_id` (an approved amendment is in progress).
--    Creation path is INSERT (not guarded here); deletion is Restricted by FKs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_student_record()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('eportal.amendment_id', true) IS NULL
     OR current_setting('eportal.amendment_id', true) = '' THEN
    -- curriculum_version_id joined this tuple with the full domain model: it is
    -- the pinned admission-cohort curriculum a student is assessed against
    -- (INV-7). Silently repointing it would retroactively change what the
    -- student was required to pass, so it is protected, not administrative.
    -- `origin` is a provenance fact (IMPORT vs ADMISSION) fixed at creation; it
    -- is protected AND absent from the amendment whitelist, i.e. truly immutable.
    IF (NEW.matriculation_number, NEW.jamb_registration_number, NEW.student_id,
        NEW.surname, NEW.first_name, NEW.other_names, NEW.date_of_birth,
        NEW.gender, NEW.faculty_id, NEW.department_id, NEW.programme_id,
        NEW.admission_session_id, NEW.entry_mode, NEW.current_level,
        NEW.student_status_id, NEW.curriculum_version_id, NEW.origin)
       IS DISTINCT FROM
       (OLD.matriculation_number, OLD.jamb_registration_number, OLD.student_id,
        OLD.surname, OLD.first_name, OLD.other_names, OLD.date_of_birth,
        OLD.gender, OLD.faculty_id, OLD.department_id, OLD.programme_id,
        OLD.admission_session_id, OLD.entry_mode, OLD.current_level,
        OLD.student_status_id, OLD.curriculum_version_id, OLD.origin)
    THEN
      RAISE EXCEPTION
        'Protected student identity field modified outside an approved amendment (INV-3)'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_student_record ON student_records;
CREATE TRIGGER trg_guard_student_record
  BEFORE UPDATE ON student_records
  FOR EACH ROW EXECUTE FUNCTION guard_student_record();

-- ---------------------------------------------------------------------------
-- 1b) Amendment path (SECURITY DEFINER). The application role is granted UPDATE
--     on NON-protected columns only (see grants below), so it physically cannot
--     write protected identity columns directly — not even with the GUC set.
--     The ONLY way to mutate protected columns is this function, which:
--       * runs with the table owner's privileges (SECURITY DEFINER),
--       * sets the transaction-local `eportal.amendment_id` GUC the guard
--         trigger requires,
--       * whitelists the columns it will touch (defense in depth with the
--         service layer), applying only keys present in p_changes.
--     This makes the four identity layers CONSISTENT: L1 grants block direct
--     protected writes, and approved amendments flow exclusively through here.
--
--     Note: studentId and matriculation_number are deliberately absent from the
--     whitelist — those surrogate/identity keys are immutable in Phase 1.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eportal_amend_student(
  p_id          uuid,
  p_changes     jsonb,
  p_amendment_id text,
  p_actor       uuid
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  k text;
BEGIN
  IF p_amendment_id IS NULL OR p_amendment_id = '' THEN
    RAISE EXCEPTION 'An amendment id is required to modify protected fields';
  END IF;

  -- Reject any key outside the amendable protected set.
  FOR k IN SELECT jsonb_object_keys(p_changes) LOOP
    IF k NOT IN (
      'jamb_registration_number','surname','first_name','other_names',
      'date_of_birth','gender','faculty_id','department_id','programme_id',
      'admission_session_id','entry_mode','current_level','student_status_id',
      -- Amendable, but only here: a student transferring programme legitimately
      -- needs their pinned curriculum repointed (INV-7), and that correction
      -- must leave an amendment trail like any other identity change.
      'curriculum_version_id'
    ) THEN
      RAISE EXCEPTION 'Column % is not amendable', k USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  -- Unlock the guard trigger for THIS transaction only.
  PERFORM set_config('eportal.amendment_id', p_amendment_id, true);

  UPDATE student_records SET
    jamb_registration_number = CASE WHEN p_changes ? 'jamb_registration_number'
      THEN NULLIF(p_changes->>'jamb_registration_number','') ELSE jamb_registration_number END,
    surname       = COALESCE(p_changes->>'surname', surname),
    first_name    = COALESCE(p_changes->>'first_name', first_name),
    other_names   = CASE WHEN p_changes ? 'other_names'
      THEN NULLIF(p_changes->>'other_names','') ELSE other_names END,
    date_of_birth = COALESCE((p_changes->>'date_of_birth')::date, date_of_birth),
    gender        = COALESCE((p_changes->>'gender')::"Gender", gender),
    faculty_id    = COALESCE((p_changes->>'faculty_id')::uuid, faculty_id),
    department_id = COALESCE((p_changes->>'department_id')::uuid, department_id),
    programme_id  = COALESCE((p_changes->>'programme_id')::uuid, programme_id),
    admission_session_id = COALESCE((p_changes->>'admission_session_id')::uuid, admission_session_id),
    entry_mode    = COALESCE((p_changes->>'entry_mode')::"EntryMode", entry_mode),
    current_level = COALESCE((p_changes->>'current_level')::int, current_level),
    student_status_id = COALESCE((p_changes->>'student_status_id')::uuid, student_status_id),
    curriculum_version_id = CASE WHEN p_changes ? 'curriculum_version_id'
      THEN NULLIF(p_changes->>'curriculum_version_id','')::uuid ELSE curriculum_version_id END,
    updated_by    = p_actor,
    updated_at    = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Student record % not found', p_id USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Audit is append-only. Block UPDATE and DELETE at the table level so even
--    a compromised app cannot rewrite history (INV-13).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only (attempted %)', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_events;
CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_events;
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

-- ---------------------------------------------------------------------------
-- 3) Separation of duties: a change request cannot be reviewed by its author.
-- ---------------------------------------------------------------------------
ALTER TABLE profile_change_requests
  DROP CONSTRAINT IF EXISTS chk_change_request_sod;
ALTER TABLE profile_change_requests
  ADD CONSTRAINT chk_change_request_sod
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by);

-- ---------------------------------------------------------------------------
-- 4) Exactly one current academic session (partial unique index).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_one_current_session;
CREATE UNIQUE INDEX uq_one_current_session
  ON academic_sessions ((true)) WHERE is_current;

-- ---------------------------------------------------------------------------
-- 5) Case-insensitive uniqueness for matric number (defense in depth beyond
--    the Prisma @unique, which is case-sensitive on plain text).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_matric_ci;
CREATE UNIQUE INDEX uq_matric_ci
  ON student_records (lower(matriculation_number));

-- Efficient case-insensitive search on surname/first name for admin lists.
CREATE INDEX IF NOT EXISTS ix_student_surname_lower
  ON student_records (lower(surname));
CREATE INDEX IF NOT EXISTS ix_student_firstname_lower
  ON student_records (lower(first_name));

-- ---------------------------------------------------------------------------
-- 5b) Internal student-id sequence. A real Postgres SEQUENCE gives us atomic,
--     race-free allocation (nextval never hands the same number to two
--     concurrent transactions). The application formats the number into the
--     STUyyyyNNNNNN internal id. This is the SURROGATE key only — it has
--     nothing to do with the matriculation number, which is supplied by the
--     authorized admin/import and never generated from student input.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS student_id_seq AS bigint START WITH 1 INCREMENT BY 1;

-- ---------------------------------------------------------------------------
-- 6) Least-privilege GRANTs for the application role.
--    The app connects as `eportal_app`, which:
--      * has no UPDATE on the PROTECTED columns of student_records
--        (only the non-protected columns are granted);
--      * cannot UPDATE or DELETE audit_events.
--    Amendments run through a SECURITY DEFINER path that sets
--    eportal.amendment_id, so the trigger — not raw column grants — is the
--    real enforcement; the revoked grants are belt-and-braces.
--    Guarded so the script still runs if the role does not exist yet.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eportal_app') THEN
    -- student_records: grant column-level UPDATE on non-protected columns only.
    REVOKE UPDATE ON student_records FROM eportal_app;
    -- student_category_id and expected_graduation_session_id are ADMINISTRATIVE:
    -- a fee category is reclassified and a projected graduation session is
    -- recomputed as a matter of routine, so the app writes them directly.
    -- curriculum_version_id and origin are deliberately NOT here — the former
    -- moves only through eportal_amend_student, the latter never moves at all.
    GRANT  UPDATE (activation_state, photo_key, official_email, official_phone,
                   student_category_id, expected_graduation_session_id,
                   updated_at, updated_by)
           ON student_records TO eportal_app;
    -- audit is INSERT + SELECT only.
    REVOKE UPDATE, DELETE ON audit_events FROM eportal_app;
    GRANT  SELECT, INSERT ON audit_events TO eportal_app;
    -- allocate internal student ids.
    GRANT  USAGE, SELECT ON SEQUENCE student_id_seq TO eportal_app;
    -- protected identity columns change ONLY through the SECURITY DEFINER
    -- amendment function; the app role may execute it but cannot write those
    -- columns directly.
    GRANT  EXECUTE ON FUNCTION eportal_amend_student(uuid, jsonb, text, uuid) TO eportal_app;
  END IF;
END $$;

-- ===========================================================================
--  PHASE 2 — ACADEMIC STRUCTURE guards (idempotent; re-run after the migration)
--
--  Everything Prisma cannot express for the academic-structure tables:
--  case-insensitive course-code uniqueness, the "exactly one current/default"
--  partial unique indexes, and CHECKs that reject self-referential edges and
--  inverted grade-band ranges. These are Layer-2 (database) enforcement backing
--  the Layer-3 (service) validation — neither layer is trusted alone (INV:
--  three-layer validation).
--
--  NO new GRANTs are needed here: docs/28 runs
--    ALTER DEFAULT PRIVILEGES IN SCHEMA public
--      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eportal_app;
--  so eportal_app automatically receives CRUD on every Phase 2 table created by
--  the migration. Unlike student_records, none of these tables has protected
--  columns, so the broad default grant is exactly what we want.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 7) Case-insensitive uniqueness for course code (university-wide). Mirrors
--    uq_matric_ci: the Prisma @unique on courses.code is case-sensitive, so
--    this functional index is the authoritative guarantee that "csc101" and
--    "CSC101" cannot coexist (the service also uppercases on write).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_course_code_ci;
CREATE UNIQUE INDEX uq_course_code_ci
  ON courses (lower(code));

-- ---------------------------------------------------------------------------
-- 8) At most one current semester PER SESSION (partial unique index, scoped by
--    session_id — unlike the globally-unique current session in (4)).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_one_current_semester;
CREATE UNIQUE INDEX uq_one_current_semester
  ON semesters (session_id) WHERE is_current;

-- ---------------------------------------------------------------------------
-- 9) At most one default grade scale (partial unique index; mirrors
--    uq_one_current_session's ((true)) WHERE pattern).
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_one_default_grade_scale;
CREATE UNIQUE INDEX uq_one_default_grade_scale
  ON grade_scales ((true)) WHERE is_default;

-- ---------------------------------------------------------------------------
-- 10) Structural CHECKs the ORM cannot express.
--     * A course cannot be its own prerequisite or its own relationship target
--       (self-edges). Deeper prerequisite CYCLES need graph reachability and are
--       rejected in the service layer — a CHECK cannot express them.
--     * A grade band's minimum score cannot exceed its maximum.
-- ---------------------------------------------------------------------------
ALTER TABLE course_prerequisites
  DROP CONSTRAINT IF EXISTS chk_prereq_not_self;
ALTER TABLE course_prerequisites
  ADD CONSTRAINT chk_prereq_not_self
  CHECK (course_id <> prerequisite_course_id);

ALTER TABLE course_relationships
  DROP CONSTRAINT IF EXISTS chk_relationship_not_self;
ALTER TABLE course_relationships
  ADD CONSTRAINT chk_relationship_not_self
  CHECK (course_id <> related_course_id);

ALTER TABLE grade_bands
  DROP CONSTRAINT IF EXISTS chk_grade_band_range;
ALTER TABLE grade_bands
  ADD CONSTRAINT chk_grade_band_range
  CHECK (min_score <= max_score);

-- ===========================================================================
--  FULL DOMAIN MODEL guards (idempotent; re-run after 20260811000000)
--
--  The remaining invariants that live in the database because the database is
--  the only layer that cannot be bypassed. Grouped by the invariant each backs,
--  because a guard whose purpose is unclear is a guard someone will "fix".
--
--  As with Phase 2, no new GRANTs are required: docs/28 sets ALTER DEFAULT
--  PRIVILEGES so eportal_app receives CRUD on tables the migration creates.
--  The exceptions are the append-only tables handled in (16) below, which must
--  have UPDATE/DELETE taken back after that blanket grant.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 11) INV-12 — at most one CURRENT grade per registration line.
--     A superseded grade is RETAINED, so `registration_line_id` cannot be
--     plainly unique; uniqueness holds only over rows that have not been
--     superseded. This is the docs/02 §3.5 partial index, and it doubles as the
--     covering index for every transcript read (which always filters the same
--     way), so the retained history costs nothing at query time.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_grade_current_per_line;
CREATE UNIQUE INDEX uq_grade_current_per_line
  ON grade_records (registration_line_id) WHERE superseded_by IS NULL;

-- ---------------------------------------------------------------------------
-- 12) INV-9 / §9.4 — one ACTIVE line per (registration, offering).
--     Partial, because a DROPPED line must coexist with a re-added one: a
--     student who drops a course in the add/drop window and picks it up again
--     has two rows for the same offering, and only one of them is live. A plain
--     unique constraint would make the second add fail.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_active_line_per_offering;
CREATE UNIQUE INDEX uq_active_line_per_offering
  ON registration_lines (registration_id, course_offering_id)
  WHERE state = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 13) §9.4 — the seat counter can never exceed capacity, nor go negative.
--     The atomic claim statement already guards this, but the CHECK means that
--     ANY other writer — a migration, a manual correction, a future code path
--     that forgets the pattern — cannot oversubscribe a course either.
--     capacity IS NULL means uncapped.
-- ---------------------------------------------------------------------------
ALTER TABLE course_offerings
  DROP CONSTRAINT IF EXISTS chk_offering_seats;
ALTER TABLE course_offerings
  ADD CONSTRAINT chk_offering_seats
  CHECK (seats_taken >= 0 AND (capacity IS NULL OR seats_taken <= capacity));

-- ---------------------------------------------------------------------------
-- 14) INV-14 — money is never negative at rest.
--     Direction (DEBIT/CREDIT) carries the sign, so a negative amount would
--     double-encode it and silently corrupt every derived balance. Amounts are
--     integer minor units (kobo); there are no fractional-kobo entries.
-- ---------------------------------------------------------------------------
ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS chk_ledger_amount_nonneg;
ALTER TABLE ledger_entries
  ADD CONSTRAINT chk_ledger_amount_nonneg
  CHECK (amount >= 0);

ALTER TABLE invoices
  DROP CONSTRAINT IF EXISTS chk_invoice_amounts_nonneg;
ALTER TABLE invoices
  ADD CONSTRAINT chk_invoice_amounts_nonneg
  CHECK (total_amount >= 0 AND paid_amount >= 0);

ALTER TABLE payment_intents
  DROP CONSTRAINT IF EXISTS chk_intent_amount_positive;
ALTER TABLE payment_intents
  ADD CONSTRAINT chk_intent_amount_positive
  CHECK (amount > 0);

-- ---------------------------------------------------------------------------
-- 15) §5.4 — separation of duties, enforced structurally.
--     Each of these mirrors chk_change_request_sod: the second actor in a
--     two-person control cannot be the first. Expressible as a CHECK because
--     both actors sit on the same row; the stage-n/stage-n+1 rule does not, and
--     is enforced in the service layer against the approval history.
-- ---------------------------------------------------------------------------
ALTER TABLE record_amendments
  DROP CONSTRAINT IF EXISTS chk_record_amendment_sod;
ALTER TABLE record_amendments
  ADD CONSTRAINT chk_record_amendment_sod
  CHECK (approved_by IS NULL OR approved_by <> requested_by);

ALTER TABLE waivers
  DROP CONSTRAINT IF EXISTS chk_waiver_sod;
ALTER TABLE waivers
  ADD CONSTRAINT chk_waiver_sod
  CHECK (approved_by IS NULL OR approved_by <> requested_by);

-- Publication is dual control (§10.4): the cosigner must be a second person.
ALTER TABLE result_batches
  DROP CONSTRAINT IF EXISTS chk_publish_dual_control;
ALTER TABLE result_batches
  ADD CONSTRAINT chk_publish_dual_control
  CHECK (publish_cosigner IS NULL OR publish_cosigner <> published_by);

-- A senate approval needs a cosigner distinct from the approver (§14).
ALTER TABLE senate_approvals
  DROP CONSTRAINT IF EXISTS chk_senate_dual_control;
ALTER TABLE senate_approvals
  ADD CONSTRAINT chk_senate_dual_control
  CHECK (cosigner_id IS NULL OR cosigner_id <> approved_by);

-- A clearance step cannot be both signed and waived by the same actor.
ALTER TABLE clearance_steps
  DROP CONSTRAINT IF EXISTS chk_clearance_step_sod;
ALTER TABLE clearance_steps
  ADD CONSTRAINT chk_clearance_step_sod
  CHECK (waived_by IS NULL OR signed_by IS NULL OR waived_by <> signed_by);

-- ---------------------------------------------------------------------------
-- 16) INV-14 — the ledger is APPEND-ONLY, like the audit log.
--     A balance derived from a mutable ledger is not a balance, it is a guess.
--     Corrections are made by posting a reversing entry, which is why this is a
--     trigger and not merely a revoked grant: the intent is that no code path
--     even tries. The same applies to the raw provider payloads in
--     payment_events — they are evidence in a payment dispute.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION eportal_append_only()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; post a reversing entry instead (attempted %)',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

DROP TRIGGER IF EXISTS trg_ledger_no_update ON ledger_entries;
CREATE TRIGGER trg_ledger_no_update BEFORE UPDATE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION eportal_append_only();

DROP TRIGGER IF EXISTS trg_ledger_no_delete ON ledger_entries;
CREATE TRIGGER trg_ledger_no_delete BEFORE DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION eportal_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'payment_events') THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_payment_event_no_update ON payment_events';
    EXECUTE 'CREATE TRIGGER trg_payment_event_no_update BEFORE UPDATE OR DELETE
             ON payment_events FOR EACH ROW EXECUTE FUNCTION eportal_append_only()';
  END IF;
END $$;

-- Take back what ALTER DEFAULT PRIVILEGES handed out on the append-only tables.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eportal_app') THEN
    REVOKE UPDATE, DELETE ON ledger_entries FROM eportal_app;
    GRANT  SELECT, INSERT ON ledger_entries TO eportal_app;
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = 'payment_events') THEN
      REVOKE UPDATE, DELETE ON payment_events FROM eportal_app;
      GRANT  SELECT, INSERT ON payment_events TO eportal_app;
    END IF;
    -- Generated documents and signing keys: the app must never rewrite an
    -- issued credential or a published public key. Revocation is a new row /
    -- a timestamp column, both of which remain writable elsewhere.
    REVOKE DELETE ON generated_documents FROM eportal_app;
    REVOKE DELETE ON signing_keys FROM eportal_app;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 17) INV-12 — a published grade is immutable.
--     Before publication a grade is working data and may be corrected freely.
--     After it, the only lawful change is being SUPERSEDED, so this trigger
--     permits exactly one transition: setting superseded_by (and nothing else).
--     Amendments therefore cannot rewrite a transcript a student already holds.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION guard_published_grade()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.published_at IS NOT NULL THEN
    IF (NEW.total_score, NEW.grade, NEW.grade_point, NEW.credit_units, NEW.mark,
        NEW.grade_scale_id, NEW.student_record_id, NEW.registration_line_id,
        NEW.offering_id, NEW.course_id, NEW.session_id, NEW.semester_id,
        NEW.version, NEW.published_at)
       IS DISTINCT FROM
       (OLD.total_score, OLD.grade, OLD.grade_point, OLD.credit_units, OLD.mark,
        OLD.grade_scale_id, OLD.student_record_id, OLD.registration_line_id,
        OLD.offering_id, OLD.course_id, OLD.session_id, OLD.semester_id,
        OLD.version, OLD.published_at)
    THEN
      RAISE EXCEPTION
        'Published grade % is immutable; supersede it with a new version (INV-12)', OLD.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guard_published_grade ON grade_records;
CREATE TRIGGER trg_guard_published_grade
  BEFORE UPDATE ON grade_records
  FOR EACH ROW EXECUTE FUNCTION guard_published_grade();

-- ---------------------------------------------------------------------------
-- 18) INV-11 / §10.3 — assessment weightings must total 100 per offering.
--     A partial total silently rescales every student's mark, so it is checked
--     at the END of the transaction: components are inserted one at a time and
--     the sum is legitimately wrong in between. DEFERRABLE INITIALLY DEFERRED on
--     a constraint trigger gives exactly that timing.
--
--     An offering with NO components is allowed — that is an offering not yet
--     configured, not a broken one.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_component_weights()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_offering uuid := COALESCE(NEW.offering_id, OLD.offering_id);
  v_total    numeric;
  v_count    int;
BEGIN
  SELECT COALESCE(SUM(weight), 0), COUNT(*) INTO v_total, v_count
    FROM assessment_components WHERE offering_id = v_offering;

  IF v_count > 0 AND v_total <> 100 THEN
    RAISE EXCEPTION
      'Assessment weightings for offering % total %, must be 100 (INV-11)',
      v_offering, v_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_component_weights ON assessment_components;
CREATE CONSTRAINT TRIGGER trg_component_weights
  AFTER INSERT OR UPDATE OR DELETE ON assessment_components
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_component_weights();

-- Individual weights and maxima must still be sane on their own.
ALTER TABLE assessment_components
  DROP CONSTRAINT IF EXISTS chk_component_bounds;
ALTER TABLE assessment_components
  ADD CONSTRAINT chk_component_bounds
  CHECK (weight > 0 AND weight <= 100 AND max_score > 0);

-- A score cannot be negative, nor exceed its component's maximum. The upper
-- bound needs the parent row, so it is a trigger rather than a CHECK.
ALTER TABLE score_entries
  DROP CONSTRAINT IF EXISTS chk_score_nonneg;
ALTER TABLE score_entries
  ADD CONSTRAINT chk_score_nonneg
  CHECK (score IS NULL OR score >= 0);

CREATE OR REPLACE FUNCTION check_score_within_max()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_max numeric;
BEGIN
  IF NEW.score IS NULL THEN RETURN NEW; END IF;
  SELECT max_score INTO v_max FROM assessment_components WHERE id = NEW.component_id;
  IF v_max IS NOT NULL AND NEW.score > v_max THEN
    RAISE EXCEPTION 'Score % exceeds the component maximum of %', NEW.score, v_max
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_score_within_max ON score_entries;
CREATE TRIGGER trg_score_within_max
  BEFORE INSERT OR UPDATE ON score_entries
  FOR EACH ROW EXECUTE FUNCTION check_score_within_max();

-- ---------------------------------------------------------------------------
-- 19) §8.2 — exactly one ACTIVE session, mirroring uq_one_current_session.
--     Both guards now exist because both columns do: is_current is the legacy
--     flag, state is the lifecycle. The migration's backfill aligns them, and
--     these two indexes keep them aligned.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS uq_one_active_session;
CREATE UNIQUE INDEX uq_one_active_session
  ON academic_sessions ((true)) WHERE state = 'ACTIVE';

-- A session's window must not close before it opens.
ALTER TABLE calendar_windows
  DROP CONSTRAINT IF EXISTS chk_window_order;
ALTER TABLE calendar_windows
  ADD CONSTRAINT chk_window_order
  CHECK (closes_at > opens_at);

-- §8.1 — a scoped window must carry the scope it claims. A DEPARTMENT window
-- with no department_id resolves to nothing and silently never opens.
ALTER TABLE calendar_windows
  DROP CONSTRAINT IF EXISTS chk_window_scope_complete;
ALTER TABLE calendar_windows
  ADD CONSTRAINT chk_window_scope_complete
  CHECK (
    (scope_type = 'GLOBAL')
    OR (scope_type = 'FACULTY'    AND faculty_id    IS NOT NULL)
    OR (scope_type = 'DEPARTMENT' AND department_id IS NOT NULL)
    OR (scope_type = 'PROGRAMME'  AND programme_id  IS NOT NULL)
  );

-- ---------------------------------------------------------------------------
-- 20) INV-18 — the graduation date has exactly ONE home.
--     It lives on senate_approvals and nowhere else. This is a documentation
--     guard: it fails loudly if a future migration adds a graduation_date
--     column to graduation_candidates or student_records, which is precisely
--     the duplication INV-18 exists to prevent.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_offender text;
BEGIN
  SELECT string_agg(table_name, ', ') INTO v_offender
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND column_name = 'graduation_date'
     AND table_name <> 'senate_approvals';

  IF v_offender IS NOT NULL THEN
    RAISE EXCEPTION
      'INV-18 violated: graduation_date duplicated onto %. It belongs only to senate_approvals.',
      v_offender;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 21) §13.4 — verification codes must be unguessable.
--     Length is the one property the database can check; randomness is the
--     service's job. A short code is a code someone will enumerate, and the
--     thing behind it is a graduate's record.
-- ---------------------------------------------------------------------------
ALTER TABLE verification_codes
  DROP CONSTRAINT IF EXISTS chk_verification_code_length;
ALTER TABLE verification_codes
  ADD CONSTRAINT chk_verification_code_length
  CHECK (length(code) >= 12);

-- Case-insensitive uniqueness: verification codes are transcribed by hand from
-- printed documents, so "AB12" and "ab12" must not be different credentials.
DROP INDEX IF EXISTS uq_verification_code_ci;
CREATE UNIQUE INDEX uq_verification_code_ci
  ON verification_codes (lower(code));

-- ---------------------------------------------------------------------------
-- 22) §19 — the audit hash chain is strictly ordered.
--     BRIN on occurred_at because audit_events is append-only and therefore
--     physically correlated with time: a BRIN index over it is a fraction of
--     the size of a btree and answers the range scans that audit review
--     actually performs. Partitioning by month comes with the ops runbook
--     (docs/02 §3.5); this index is useful either way.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS ix_audit_occurred_brin
  ON audit_events USING brin (occurred_at);

-- The chain must not fork: one row per sequence number, one row per hash.
DROP INDEX IF EXISTS uq_audit_row_hash;
CREATE UNIQUE INDEX uq_audit_row_hash
  ON audit_events (row_hash) WHERE row_hash IS NOT NULL;

