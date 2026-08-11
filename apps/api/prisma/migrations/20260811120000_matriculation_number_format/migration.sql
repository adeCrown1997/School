-- Matriculation-number format: PREFIX/YEAR/SEQUENCE (e.g. AGE/2021/001)
--
-- The institution has specified the format, closing the question the id
-- generator deliberately left open. The number is now ALSO the student login
-- identifier, which raises the stakes: the login path decides whether a
-- submitted credential is a matric number or a staff email by testing it
-- against this shape, so a row that does not conform would be unloggable-in.
-- That is why the rule is a CHECK constraint here and not only a DTO rule —
-- bulk import, the seed, a future admissions feed and a DBA at a psql prompt
-- all write this column, and only the database sees every one of them.
--
-- Two statements, in this order:
--   1. Rewrite the pre-format demo rows to the new shape.
--   2. Add the CHECK, which would reject those rows if it ran first.
--
-- Both are idempotent, so re-running the migration on an already-migrated
-- database is a no-op.

-- ---------------------------------------------------------------------------
-- 1) Migrate existing rows.
--
-- The demo cohort was seeded as DEMO/<DEPT>/<YY>/<NNNN> before a format
-- existed. Mapping is explicit rather than algorithmic: there are four rows,
-- the transformation (drop the DEMO prefix, expand the 2-digit year, shrink the
-- 4-digit sequence) is not one a regex should be trusted to infer, and an
-- explicit list cannot silently mangle a row it was not written for.
--
-- The guard trigger on student_records protects matriculation_number, so a
-- plain UPDATE is rejected. eportal.amendment_id is set for this transaction
-- exactly as an approved amendment would — this IS an approved amendment, made
-- by the institution's own format decision rather than by a change request.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  mapping CONSTANT jsonb := jsonb_build_object(
    'DEMO/CSC/24/0001', 'CSC/2024/001',
    'DEMO/CSC/24/0002', 'CSC/2024/002',
    'DEMO/MTH/24/0003', 'MTH/2024/003',
    'DEMO/EEE/24/0004', 'EEE/2024/004'
  );
  old_matric text;
  new_matric text;
BEGIN
  PERFORM set_config('eportal.amendment_id', 'matric-format-migration', true);

  FOR old_matric, new_matric IN SELECT * FROM jsonb_each_text(mapping) LOOP
    -- Skip if the target already exists (re-run, or a real student already
    -- holds the number) — the unique index would reject it anyway, and failing
    -- loudly here beats a partially-applied rename.
    IF EXISTS (SELECT 1 FROM student_records WHERE lower(matriculation_number) = lower(new_matric))
    THEN
      CONTINUE;
    END IF;

    UPDATE student_records
       SET matriculation_number = new_matric
     WHERE matriculation_number = old_matric;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Enforce the format.
--
-- PREFIX  2-10 alphanumerics starting with a letter (faculty/department code)
-- YEAR    exactly 4 digits (the admission year)
-- SEQ     1-6 digits, conventionally zero-padded to 3, but the width is NOT
--         fixed: a cohort of more than 999 must be able to issue 1000.
--
-- Case is not accepted loosely — the application normalizes to upper case
-- before writing, and uq_matric_ci makes uniqueness case-insensitive, so
-- allowing lower case here would let two spellings of one number exist in
-- different rows' history for no benefit.
--
-- NOT VALID is deliberately NOT used: every existing row is expected to conform
-- after step 1, and a constraint that skips the existing rows would hide any
-- row this migration failed to convert.
-- ---------------------------------------------------------------------------
ALTER TABLE student_records
  DROP CONSTRAINT IF EXISTS ck_student_matric_format;

ALTER TABLE student_records
  ADD CONSTRAINT ck_student_matric_format
  CHECK (matriculation_number ~ '^[A-Z][A-Z0-9]{1,9}/[0-9]{4}/[0-9]{1,6}$');
