-- Phase 2 — Academic Structure (definition-only).
-- Purely additive: 4 enums + 10 tables + their indexes/FKs. No existing table
-- is altered. Generated to match schema.prisma; run with the OWNER connection
-- (see docs/28), then re-apply guards.sql (it appends a Phase 2 section).

-- CreateEnum
CREATE TYPE "OfferingStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CurriculumStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('COMPULSORY', 'ELECTIVE');

-- CreateEnum
CREATE TYPE "CourseRelationType" AS ENUM ('EQUIVALENT', 'EXCLUSION', 'RECOMMENDED', 'ANTIREQUISITE');

-- CreateTable
CREATE TABLE "semesters" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE,
    "end_date" DATE,
    "is_current" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "semesters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_categories" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "course_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "courses" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "credit_units" INTEGER NOT NULL,
    "level" INTEGER NOT NULL,
    "category_id" UUID,
    "department_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "courses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_prerequisites" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "prerequisite_course_id" UUID NOT NULL,
    "min_grade" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_prerequisites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_relationships" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "related_course_id" UUID NOT NULL,
    "type" "CourseRelationType" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "course_relationships_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "curriculum_versions" (
    "id" UUID NOT NULL,
    "programme_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "effective_from_session_id" UUID NOT NULL,
    "status" "CurriculumStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "curriculum_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "curriculum_requirements" (
    "id" UUID NOT NULL,
    "curriculum_version_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "level" INTEGER NOT NULL,
    "semester_sequence" INTEGER NOT NULL,
    "requirement_type" "RequirementType" NOT NULL,
    "credit_units" INTEGER,
    "elective_group" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "curriculum_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "course_offerings" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "semester_id" UUID NOT NULL,
    "department_id" UUID,
    "status" "OfferingStatus" NOT NULL DEFAULT 'DRAFT',
    "capacity" INTEGER,
    "seats_taken" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_by" UUID,

    CONSTRAINT "course_offerings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_scales" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "grade_scales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grade_bands" (
    "id" UUID NOT NULL,
    "scale_id" UUID NOT NULL,
    "grade" TEXT NOT NULL,
    "min_score" DECIMAL(5,2) NOT NULL,
    "max_score" DECIMAL(5,2) NOT NULL,
    "grade_point" DECIMAL(3,2) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "grade_bands_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "semesters_session_id_idx" ON "semesters"("session_id");

-- CreateIndex
CREATE UNIQUE INDEX "semesters_session_id_sequence_key" ON "semesters"("session_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "course_categories_key_key" ON "course_categories"("key");

-- CreateIndex
CREATE UNIQUE INDEX "courses_code_key" ON "courses"("code");

-- CreateIndex
CREATE INDEX "courses_department_id_idx" ON "courses"("department_id");

-- CreateIndex
CREATE INDEX "courses_category_id_idx" ON "courses"("category_id");

-- CreateIndex
CREATE INDEX "courses_level_idx" ON "courses"("level");

-- CreateIndex
CREATE INDEX "course_prerequisites_course_id_idx" ON "course_prerequisites"("course_id");

-- CreateIndex
CREATE INDEX "course_prerequisites_prerequisite_course_id_idx" ON "course_prerequisites"("prerequisite_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_prerequisites_course_id_prerequisite_course_id_key" ON "course_prerequisites"("course_id", "prerequisite_course_id");

-- CreateIndex
CREATE INDEX "course_relationships_course_id_idx" ON "course_relationships"("course_id");

-- CreateIndex
CREATE INDEX "course_relationships_related_course_id_idx" ON "course_relationships"("related_course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_relationships_course_id_related_course_id_type_key" ON "course_relationships"("course_id", "related_course_id", "type");

-- CreateIndex
CREATE INDEX "curriculum_versions_programme_id_idx" ON "curriculum_versions"("programme_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_versions_programme_id_effective_from_session_id_key" ON "curriculum_versions"("programme_id", "effective_from_session_id");

-- CreateIndex
CREATE INDEX "curriculum_requirements_curriculum_version_id_idx" ON "curriculum_requirements"("curriculum_version_id");

-- CreateIndex
CREATE INDEX "curriculum_requirements_course_id_idx" ON "curriculum_requirements"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "curriculum_requirements_curriculum_version_id_course_id_key" ON "curriculum_requirements"("curriculum_version_id", "course_id");

-- CreateIndex
CREATE INDEX "course_offerings_session_id_idx" ON "course_offerings"("session_id");

-- CreateIndex
CREATE INDEX "course_offerings_semester_id_idx" ON "course_offerings"("semester_id");

-- CreateIndex
CREATE INDEX "course_offerings_course_id_idx" ON "course_offerings"("course_id");

-- CreateIndex
CREATE INDEX "course_offerings_department_id_idx" ON "course_offerings"("department_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_offerings_course_id_session_id_semester_id_key" ON "course_offerings"("course_id", "session_id", "semester_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_scales_key_key" ON "grade_scales"("key");

-- CreateIndex
CREATE INDEX "grade_bands_scale_id_idx" ON "grade_bands"("scale_id");

-- CreateIndex
CREATE UNIQUE INDEX "grade_bands_scale_id_grade_key" ON "grade_bands"("scale_id", "grade");
-- AddForeignKey
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "course_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "courses" ADD CONSTRAINT "courses_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_prerequisites" ADD CONSTRAINT "course_prerequisites_prerequisite_course_id_fkey" FOREIGN KEY ("prerequisite_course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_relationships" ADD CONSTRAINT "course_relationships_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_relationships" ADD CONSTRAINT "course_relationships_related_course_id_fkey" FOREIGN KEY ("related_course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_programme_id_fkey" FOREIGN KEY ("programme_id") REFERENCES "programmes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_versions" ADD CONSTRAINT "curriculum_versions_effective_from_session_id_fkey" FOREIGN KEY ("effective_from_session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_curriculum_version_id_fkey" FOREIGN KEY ("curriculum_version_id") REFERENCES "curriculum_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "curriculum_requirements" ADD CONSTRAINT "curriculum_requirements_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "academic_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_semester_id_fkey" FOREIGN KEY ("semester_id") REFERENCES "semesters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "departments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "grade_bands" ADD CONSTRAINT "grade_bands_scale_id_fkey" FOREIGN KEY ("scale_id") REFERENCES "grade_scales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
