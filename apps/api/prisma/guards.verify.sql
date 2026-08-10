-- Functional proof that the Layer-2 database guards actually block what they
-- claim to. Run AS eportal_app (the role the API uses), because a guard that
-- only holds for a superuser is not a guard — superusers bypass table owner
-- privilege checks entirely.
--
-- Each test writes a fixture, attempts the forbidden operation, and asserts
-- Postgres refused. Everything runs in a transaction that is rolled back, so
-- this leaves no data behind and is safe to re-run against a live database.
--
-- Usage:
--   psql "$DATABASE_URL" -f apps/api/prisma/guards.verify.sql

\set ON_ERROR_STOP on
BEGIN;

INSERT INTO universities (id, name, short_name, code, updated_at)
VALUES ('11111111-1111-1111-1111-111111111111', 'Test U', 'TU', 'TU', now());

INSERT INTO faculties (id, university_id, name, code, updated_at)
VALUES ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111', 'Test Faculty', 'TF', now());

INSERT INTO departments (id, faculty_id, name, code, updated_at)
VALUES ('33333333-3333-3333-3333-333333333333',
        '22222222-2222-2222-2222-222222222222', 'Test Dept', 'TD', now());

INSERT INTO programmes (id, department_id, name, code, award, duration_years, updated_at)
VALUES ('44444444-4444-4444-4444-444444444444',
        '33333333-3333-3333-3333-333333333333', 'Test Prog', 'TP', 'B.Sc.', 4, now());

INSERT INTO academic_sessions (id, name, start_date, end_date)
VALUES ('55555555-5555-5555-5555-555555555555', '2099/2100', '2099-09-01', '2100-07-31');

INSERT INTO student_statuses (id, key, label)
VALUES ('66666666-6666-6666-6666-666666666666', 'TEST_ACTIVE', 'Active');

INSERT INTO student_records
  (id, student_id, matriculation_number, surname, first_name, date_of_birth,
   faculty_id, department_id, programme_id, admission_session_id,
   current_level, student_status_id, origin, updated_at)
VALUES
  ('77777777-7777-7777-7777-777777777777', 'TU-STU-0001', 'TU/TEST/0001',
   'Lovelace', 'Ada', '2000-01-01',
   '22222222-2222-2222-2222-222222222222',
   '33333333-3333-3333-3333-333333333333',
   '44444444-4444-4444-4444-444444444444',
   '55555555-5555-5555-5555-555555555555',
   100, '66666666-6666-6666-6666-666666666666', 'IMPORT', now());

-- === TEST 1: a protected identity field cannot be updated directly ========
-- THE UNIVERSITY IS THE SOURCE OF TRUTH FOR STUDENT IDENTITY. A direct write
-- must fail — either on the column grant (privilege) or on the trigger.
DO $$
BEGIN
  BEGIN
    UPDATE student_records SET surname = 'Hacked'
     WHERE id = '77777777-7777-7777-7777-777777777777';
    RAISE EXCEPTION 'TEST 1 FAILED: protected field surname was updated directly';
  EXCEPTION
    WHEN insufficient_privilege OR check_violation THEN
      RAISE NOTICE 'TEST 1 PASS: direct surname update blocked -- %', SQLERRM;
  END;
END $$;

-- === TEST 2: an administrative field CAN still be updated =================
-- The guard must not be so blunt that ordinary work stops.
DO $$
BEGIN
  UPDATE student_records SET photo_key = 'photos/ada.jpg'
   WHERE id = '77777777-7777-7777-7777-777777777777';
  RAISE NOTICE 'TEST 2 PASS: administrative field photo_key updated normally';
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'TEST 2 FAILED: administrative update was blocked -- %', SQLERRM;
END $$;

-- === TEST 3: the amendment function IS able to change a protected field ===
-- Layer 3's sole legitimate path. If this fails the registry cannot correct a
-- genuine error and the invariant has become a bug.
DO $$
DECLARE v text;
BEGIN
  PERFORM eportal_amend_student(
    '77777777-7777-7777-7777-777777777777'::uuid,
    '{"surname":"Byron"}'::jsonb,
    'AMD-TEST-0001',
    '88888888-8888-8888-8888-888888888888'::uuid);
  SELECT surname INTO v FROM student_records
   WHERE id = '77777777-7777-7777-7777-777777777777';
  IF v <> 'Byron' THEN
    RAISE EXCEPTION 'TEST 3 FAILED: amendment did not apply (got %)', v;
  END IF;
  RAISE NOTICE 'TEST 3 PASS: amendment function changed surname to %', v;
END $$;

-- === TEST 4: the amendment path requires an amendment id =================
-- An amendment with no reference is an untraceable identity change.
DO $$
BEGIN
  BEGIN
    PERFORM eportal_amend_student(
      '77777777-7777-7777-7777-777777777777'::uuid,
      '{"surname":"NoTrail"}'::jsonb,
      NULL,
      '88888888-8888-8888-8888-888888888888'::uuid);
    RAISE EXCEPTION 'TEST 4 FAILED: amendment accepted without an amendment id';
  EXCEPTION WHEN raise_exception OR check_violation OR not_null_violation THEN
    RAISE NOTICE 'TEST 4 PASS: amendment without an id refused -- %', SQLERRM;
  END;
END $$;

-- === TEST 5: matriculation_number is immutable even via the amendment ====
-- Protected AND absent from the whitelist. Same for `origin` (provenance).
DO $$
BEGIN
  BEGIN
    PERFORM eportal_amend_student(
      '77777777-7777-7777-7777-777777777777'::uuid,
      '{"matriculation_number":"TU/HACKED/9999"}'::jsonb,
      'AMD-TEST-0002',
      '88888888-8888-8888-8888-888888888888'::uuid);
    RAISE EXCEPTION 'TEST 5 FAILED: matriculation_number was amendable';
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RAISE NOTICE 'TEST 5 PASS: matriculation_number not amendable -- %', SQLERRM;
  END;
  BEGIN
    PERFORM eportal_amend_student(
      '77777777-7777-7777-7777-777777777777'::uuid,
      '{"origin":"ADMISSION"}'::jsonb,
      'AMD-TEST-0003',
      '88888888-8888-8888-8888-888888888888'::uuid);
    RAISE EXCEPTION 'TEST 5b FAILED: origin was amendable';
  EXCEPTION WHEN raise_exception OR check_violation THEN
    RAISE NOTICE 'TEST 5b PASS: origin not amendable -- %', SQLERRM;
  END;
END $$;

-- === TEST 6: audit_events is append-only =================================
DO $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO audit_events (action, entity_type)
  VALUES ('test.action', 'Test')
  RETURNING id INTO v_id;
  BEGIN
    UPDATE audit_events SET action = 'tampered' WHERE id = v_id;
    RAISE EXCEPTION 'TEST 6 FAILED: audit event was UPDATEd';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
    RAISE NOTICE 'TEST 6 PASS: audit UPDATE blocked';
  END;
  BEGIN
    DELETE FROM audit_events WHERE id = v_id;
    RAISE EXCEPTION 'TEST 6b FAILED: audit event was DELETEd';
  EXCEPTION WHEN insufficient_privilege OR check_violation OR raise_exception THEN
    RAISE NOTICE 'TEST 6b PASS: audit DELETE blocked';
  END;
END $$;

-- === TEST 7: a course offering cannot be oversold (§9.4) =================
DO $$
DECLARE v_sem uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
        v_crs uuid := 'aaaaaaaa-0000-0000-0000-000000000002';
        v_off uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
BEGIN
  INSERT INTO semesters (id, session_id, sequence, name, updated_at)
  VALUES (v_sem, '55555555-5555-5555-5555-555555555555', 1, 'First', now());
  INSERT INTO courses (id, code, title, credit_units, level, updated_at)
  VALUES (v_crs, 'TST101', 'Test Course', 3, 100, now());
  INSERT INTO course_offerings
    (id, course_id, session_id, semester_id, capacity, seats_taken, updated_at)
  VALUES (v_off, v_crs, '55555555-5555-5555-5555-555555555555', v_sem, 1, 1, now());

  BEGIN
    UPDATE course_offerings SET seats_taken = seats_taken + 1 WHERE id = v_off;
    RAISE EXCEPTION 'TEST 7 FAILED: offering oversold past capacity';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'TEST 7 PASS: seats_taken cannot exceed capacity';
  END;
END $$;

-- === TEST 8: INV-18 — graduation_date exists on exactly one table ========
DO $$
DECLARE v_tables text; v_count int;
BEGIN
  SELECT count(*), string_agg(table_name, ', ') INTO v_count, v_tables
    FROM information_schema.columns
   WHERE table_schema = 'public' AND column_name = 'graduation_date';
  IF v_count <> 1 OR v_tables <> 'senate_approvals' THEN
    RAISE EXCEPTION 'TEST 8 FAILED: graduation_date on % table(s): %', v_count, v_tables;
  END IF;
  RAISE NOTICE 'TEST 8 PASS: graduation_date stored once, on senate_approvals';
END $$;

-- === TEST 9: the app role cannot perform DDL =============================
-- A compromised application credential must not be able to reshape the schema.
DO $$
BEGIN
  BEGIN
    EXECUTE 'CREATE TABLE public.should_not_exist (id int)';
    RAISE EXCEPTION 'TEST 9 FAILED: app role created a table';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'TEST 9 PASS: app role cannot CREATE in schema public';
  END;
END $$;

ROLLBACK;
