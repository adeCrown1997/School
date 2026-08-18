/**
 * Shared response types mirroring the API's serialized shapes. These describe
 * only what the frontend reads; they are intentionally permissive (optional
 * relations) because the API's `include` sets can vary by endpoint. The API
 * remains the source of truth — these types are a convenience for the UI.
 */

export type UserType = 'STAFF' | 'STUDENT';
export type ScopeType = 'GLOBAL' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAMME';
export type ActivationState = 'PENDING' | 'ACTIVATED' | 'LOCKED';
export type Gender = 'MALE' | 'FEMALE' | 'OTHER' | 'UNSPECIFIED';
export type EntryMode = 'UTME' | 'DIRECT_ENTRY' | 'TRANSFER' | 'INTER_UNIVERSITY' | 'JUPEB';
export type ChangeRequestStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

/** GET /auth/me */
export interface Me {
  userId: string;
  userType: UserType;
  email: string;
  fullName: string;
  permissions: string[];
  studentRecordId: string | null;
  /** Read-only here; a student can never change it. Null for staff. */
  matriculationNumber: string | null;
  /** True while the account still holds the initial password issued at activation. */
  mustChangePassword: boolean;
}

/** POST /auth/login */
export interface LoginResult {
  authenticated: boolean;
  mustChangePassword: boolean;
}

/** POST /students/activate */
export interface ActivationResult {
  message: string;
  /** False while email verification is disabled; the OTP step is then skipped. */
  emailVerificationRequired: boolean;
}

export interface NamedRef {
  id: string;
  name: string;
  code?: string;
}

export interface StudentStatusRef {
  id?: string;
  key: string;
  label: string;
  allowsLogin?: boolean;
}

/** A student master record as returned by the admin endpoints (STUDENT_INCLUDE). */
export interface StudentRecord {
  id: string;
  studentId: string;
  matriculationNumber: string;
  jambRegistrationNumber: string | null;
  surname: string;
  firstName: string;
  otherNames: string | null;
  dateOfBirth: string;
  gender: Gender;
  currentLevel: number;
  entryMode: EntryMode;
  activationState: ActivationState;
  photoKey: string | null;
  officialEmail: string | null;
  officialPhone: string | null;
  faculty?: NamedRef;
  department?: NamedRef;
  programme?: NamedRef & { durationYears?: number; award?: string };
  admissionSession?: NamedRef;
  studentStatus?: StudentStatusRef;
  userAccount?: { id: string; email: string; isActive: boolean; lastLoginAt: string | null } | null;
  profile?: unknown;
  createdAt?: string;
}

export interface RoleAssignmentView {
  assignmentId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  scopeType: ScopeType;
  facultyId: string | null;
  departmentId: string | null;
  programmeId: string | null;
  grantedById: string | null;
  grantedAt: string;
}

export interface StaffUser {
  id: string;
  email: string;
  fullName: string;
  userType: UserType;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  roles: RoleAssignmentView[];
}

export interface RoleView {
  id: string;
  key: string;
  name: string;
  description: string;
  isSystem: boolean;
  scopeKind: ScopeType;
  permissions: string[];
  grantable: boolean;
}

export interface PermissionView {
  key: string;
  description: string;
  category: string;
}

export interface Faculty extends NamedRef {
  universityId: string;
  departments?: Department[];
}
export interface Department extends NamedRef {
  facultyId: string;
  programmes?: Programme[];
}
export interface Programme extends NamedRef {
  departmentId: string;
  award: string;
  durationYears: number;
  studyMode?: string;
}
export interface AcademicSession {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

export interface Semester {
  id: string;
  name: string;
  sequence: number;
  sessionId: string;
  isCurrent?: boolean;
}
export interface UniversityTree extends NamedRef {
  faculties: Faculty[];
}

export interface ChangeRequest {
  id: string;
  studentRecordId: string;
  requestedById: string;
  fieldKey: string;
  currentValue: string | null;
  requestedValue: string;
  reason: string;
  documentKey: string | null;
  status: ChangeRequestStatus;
  reviewedById: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  studentRecord?: {
    id: string;
    matriculationNumber: string;
    surname: string;
    firstName: string;
  };
}

export interface StudentProfileContact {
  phone?: string | null;
  personalEmail?: string | null;
  addressLine?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
}

/** GET /me/profile — own record (read-only identity) + editable contact profile. */
export interface OwnProfile {
  id: string;
  studentId: string;
  matriculationNumber: string;
  jambRegistrationNumber: string | null;
  surname: string;
  firstName: string;
  otherNames: string | null;
  dateOfBirth: string;
  gender: Gender;
  currentLevel: number;
  activationState: ActivationState;
  faculty?: NamedRef;
  department?: NamedRef;
  programme?: NamedRef;
  admissionSession?: NamedRef;
  studentStatus?: StudentStatusRef;
  profile: StudentProfileContact | null;
}

/** GET /dashboards/admin */
export interface AdminOverview {
  scope: {
    unrestricted: boolean;
    facultyIds: string[];
    departmentIds: string[];
    programmeIds: string[];
  };
  students: {
    total: number;
    byActivationState: Record<ActivationState, number>;
    byStatus: { key: string; label: string; count: number }[];
    byFaculty: { facultyId: string; name: string; code: string; count: number }[];
  };
  changeRequests: { pending: number };
  staff: { total: number; active: number };
}

/** GET /dashboards/me */
export interface StudentOverview {
  record: {
    studentId: string;
    matriculationNumber: string;
    surname: string;
    firstName: string;
    otherNames: string | null;
    currentLevel: number;
    activationState: ActivationState;
    faculty: { name: string; code: string } | null;
    department: { name: string; code: string } | null;
    programme: { name: string; code: string; award: string; durationYears: number } | null;
    admissionSession: { name: string } | null;
    studentStatus: { key: string; label: string } | null;
  };
  changeRequests: Record<ChangeRequestStatus, number>;
}

/** Row report from the bulk-import preview/commit. */
export interface RowReport {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  matriculationNumber?: string;
  fullName?: string;
  errors: string[];
  warnings: string[];
}

export interface ImportSummary {
  totalRows: number;
  valid: number;
  warnings: number;
  errors: number;
  previewToken: string;
  unknownHeaders: string[];
  rows: RowReport[];
  imported?: number;
}

// --- Registration (Phase 2) ------------------------------------------------

export type RegistrationStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'LOCKED'
  | 'REJECTED'
  | 'CANCELLED';

export type RegistrationLineType = 'NEW' | 'CARRYOVER' | 'REPEAT' | 'ELECTIVE';

export interface EligibilityGateResult {
  gate: 'ACCOUNT' | 'WINDOW' | 'FEE_CLEARANCE' | 'HOLDS' | 'DURATION';
  passed: boolean;
  notEnforced?: boolean;
  message: string | null;
}

export interface EligibilityReport {
  eligible: boolean;
  gates: EligibilityGateResult[];
  student: {
    id: string;
    matriculationNumber: string;
    fullName: string;
    level: number;
    facultyId: string;
    departmentId: string;
    programmeId: string;
    curriculumVersionId: string | null;
  };
  window: { id: string; opensAt: string; closesAt: string } | null;
}

export interface CourseListItem {
  offeringId: string;
  courseId: string;
  code: string;
  title: string;
  courseLevel: number;
  creditUnits: number;
  categoryKey: string | null;
  lineType: RegistrationLineType;
  preSelected: boolean;
  removable: boolean;
  alreadyRegistered: boolean;
  selectable: boolean;
  prerequisites: {
    satisfied: boolean;
    unmet: Array<{ code: string; title: string; message: string }>;
    enforcement: 'BLOCK' | 'WARN';
  };
  capacity: {
    capacity: number | null;
    seatsTaken: number;
    seatsAvailable: number | null;
    isFull: boolean;
  };
  warnings: string[];
}

export interface CourseListResult {
  level: number;
  semesterSequence: number;
  curriculumVersion: { id: string; name: string; status: string } | null;
  items: CourseListItem[];
  excluded: Array<{ courseId: string; code: string; title: string; reason: string; message: string }>;
  totals: {
    preSelectedUnits: number;
    selectableUnits: number;
    carryoverCount: number;
    carryoverUnits: number;
  };
  warnings: string[];
}

export interface RegistrationLine {
  id: string;
  creditUnits: number;
  lineType: RegistrationLineType;
  state: string;
  courseOffering: {
    id: string;
    capacity: number | null;
    seatsTaken: number;
    course: { id: string; code: string; title: string; level: number; creditUnits: number };
  };
}

export interface RegistrationDetail {
  id: string;
  status: RegistrationStatus;
  level: number;
  totalUnits: number;
  minUnits: number | null;
  maxUnits: number | null;
  submittedAt: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  rejectReason: string | null;
  session: { id: string; name: string };
  semester: { id: string; name: string; sequence: number };
  curriculumVersion: { id: string; name: string; status: string } | null;
  lines: RegistrationLine[];
  approvals: Array<{
    id: string;
    decision: string;
    comment: string | null;
    stage: { key: string; name: string; sequence: number };
  }>;
}

/** GET /me/registration — eligibility, course list and current registration. */
export interface RegistrationContext {
  session: { id: string; name: string };
  semester: { id: string; name: string; sequence: number };
  eligibility: EligibilityReport;
  courses: CourseListResult;
  registration: RegistrationDetail | null;
}

export interface RegistrationHistoryItem {
  id: string;
  status: RegistrationStatus;
  totalUnits: number;
  session: { id: string; name: string };
  semester: { id: string; name: string; sequence: number };
  _count: { lines: number };
}

/** Row from GET /registrations (staff list). */
export interface RegistrationListItem {
  id: string;
  status: RegistrationStatus;
  level: number;
  totalUnits: number;
  submittedAt: string | null;
  studentRecord: {
    id: string;
    matriculationNumber: string;
    surname: string;
    firstName: string;
    currentLevel: number;
    programme?: { code: string };
  };
  semester: { id: string; name: string; sequence: number };
  _count: { lines: number; approvals: number };
}

/** Paginated staff list envelope (nested in `data`, not `meta`). */
export interface PaginatedRegistrations {
  items: RegistrationListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** GET /registrations/:id — includes the student record for staff review. */
export interface StaffRegistrationDetail extends RegistrationDetail {
  studentRecord?: {
    id: string;
    matriculationNumber: string;
    surname: string;
    firstName: string;
    otherNames: string | null;
    currentLevel: number;
    programme?: { id: string; code: string; name: string };
    department?: { id: string; name: string };
  };
}

export type RegistrationWindowType = 'REGISTRATION' | 'ADD_DROP' | 'LATE_REGISTRATION';

/** Row from GET /registrations/windows */
export interface CalendarWindowListItem {
  id: string;
  windowType: RegistrationWindowType;
  scopeType: ScopeType;
  opensAt: string;
  closesAt: string;
  isActive: boolean;
  notes: string | null;
  session: { id: string; name: string };
  semester: { id: string; name: string } | null;
  faculty: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  programme: { id: string; name: string } | null;
}

/** GET /registrations/policy */
export interface RegistrationPolicy {
  prerequisiteEnforcement: 'BLOCK' | 'WARN';
  levelSpread: number;
  allowRepeatForUpgrade: boolean;
  enforceCapacity: boolean;
  timetableClash: 'BLOCK' | 'WARN';
  isDefault?: boolean;
}

// --- Academics (Phase 2) ---------------------------------------------------

export interface CourseCategory {
  id: string;
  key: string;
  label: string;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  _count?: { courses: number };
}

/** One interval of a grade scale. Prisma Decimals arrive as strings. */
export interface GradeBand {
  id: string;
  grade: string;
  minScore: string | number;
  maxScore: string | number;
  gradePoint: string | number;
  sortOrder: number;
}

/** GET /academics/grade-scales and GET /academics/grade-scales/:id */
export interface GradeScale {
  id: string;
  key: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
  bands: GradeBand[];
  _count?: { gradeRecords: number };
}

/** GET/POST /academics/credit-policy — min/max units per semester (INV-8). */
export interface CreditPolicy {
  minUnits: number;
  maxUnits: number;
  isDefault: boolean;
}

/** Row from GET /academics/courses */
export interface CatalogueCourse {
  id: string;
  code: string;
  title: string;
  description: string | null;
  creditUnits: number;
  level: number;
  isActive: boolean;
  category?: { id: string; key: string; label: string } | null;
  department?: { id: string; code: string; name: string } | null;
}

/** GET /academics/courses/:id — includes prerequisites and relationships. */
export interface CourseDetail extends CatalogueCourse {
  prerequisites: Array<{
    id: string;
    minGrade: string | null;
    prerequisiteCourse: { id: string; code: string; title: string; creditUnits: number };
  }>;
  relationshipsFrom: Array<{
    id: string;
    type: 'EQUIVALENT' | 'EXCLUSION' | 'RECOMMENDED' | 'ANTIREQUISITE';
    note: string | null;
    relatedCourse: { id: string; code: string; title: string };
  }>;
}

export type CurriculumStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type RequirementType = 'COMPULSORY' | 'ELECTIVE';

/** Row from GET /academics/curriculum */
export interface CurriculumListItem {
  id: string;
  name: string;
  status: CurriculumStatus;
  notes: string | null;
  publishedAt: string | null;
  programme: { id: string; code: string; name: string; departmentId: string };
  effectiveFromSession: { id: string; name: string };
  _count: { requirements: number };
}

export interface CurriculumRequirementRow {
  id: string;
  level: number;
  semesterSequence: number;
  requirementType: RequirementType;
  creditUnits: number | null;
  electiveGroup: string | null;
  course: { id: string; code: string; title: string; creditUnits: number; isActive: boolean };
}

export interface CurriculumLevelSummary {
  level: number;
  compulsory: number;
  elective: number;
  total: number;
}

export interface CurriculumSummary {
  totalUnits: number;
  requirementCount: number;
  byLevel: CurriculumLevelSummary[];
}

/** GET /academics/curriculum/:id */
export interface CurriculumDetail {
  id: string;
  name: string;
  status: CurriculumStatus;
  notes: string | null;
  publishedAt: string | null;
  programme: { id: string; code: string; name: string; departmentId: string };
  effectiveFromSession: { id: string; name: string };
  requirements: CurriculumRequirementRow[];
  summary: CurriculumSummary;
}

export type OfferingStatus = 'DRAFT' | 'OPEN' | 'CLOSED';

/** Row from GET /academics/offerings and GET /academics/offerings/:id */
export interface OfferingListItem {
  id: string;
  status: OfferingStatus;
  capacity: number | null;
  seatsTaken: number;
  seatsAvailable: number | null;
  isFull: boolean;
  course: { id: string; code: string; title: string; creditUnits: number; level: number };
  session: { id: string; name: string };
  semester: { id: string; name: string; sequence: number };
  department: { id: string; code: string; name: string } | null;
}

/** POST /academics/offerings/generate */
export interface GenerateOfferingsResult {
  created: number;
  alreadyPresent: number;
  skippedInactive: string[];
  semester: { id: string; name: string; sequence: number };
}

// --- Results (Phase 3) -------------------------------------------------------

export type ResultBatchStatus =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'SENATE_RATIFIED'
  | 'PUBLISHED'
  | 'REJECTED';

export type ScoreMark = 'SCORED' | 'ABSENT' | 'WITHHELD' | 'MEDICAL' | 'MALPRACTICE';
export type ScoreEntryState = 'DRAFT' | 'SUBMITTED';

/** One column of the score grid: an assessment component of the offering. */
export interface ScoreComponent {
  id: string;
  key: string;
  label: string;
  weight: string | number;
  maxScore: string | number;
  sortOrder: number;
}

/** One editable cell in the score grid. */
export interface ScoreCell {
  componentId: string;
  registrationLineId: string;
  score: string | number | null;
  mark: ScoreMark;
  state: ScoreEntryState;
}

export interface ScoreGridRow {
  registrationLineId: string;
  matriculationNumber: string;
  fullName: string;
  level: number;
  lineType: RegistrationLineType;
  cells: ScoreCell[];
}

/** GET /results/offerings/:id/scores */
export interface ScoreGrid {
  offering: {
    id: string;
    capacity: number | null;
    seatsTaken: number;
    course: { id: string; code: string; title: string; departmentId: string | null };
    session: { id: string; name: string };
    semester: { id: string; name: string; sequence: number };
  };
  components: ScoreComponent[];
  rows: ScoreGridRow[];
}

/** One data row's outcome from a score-sheet upload preview. */
export interface ScoreSheetRowReport {
  rowNumber: number;
  status: 'valid' | 'warning' | 'error';
  matriculationNumber: string | null;
  fullName: string | null;
  errors: string[];
  warnings: string[];
  cells: number;
}

/** POST .../scores/import/preview — and apply (adds `imported`). */
export interface ScoreSheetSummary {
  totalRows: number;
  valid: number;
  warnings: number;
  errors: number;
  entriesPlanned: number;
  ignoredColumns: string[];
  rows: ScoreSheetRowReport[];
  imported?: number;
}

/** GET /results/batches and the batch returned by the lifecycle endpoints. */
export interface ResultBatchListItem {
  id: string;
  status: ResultBatchStatus;
  submittedAt: string | null;
  ratifiedAt: string | null;
  publishedAt: string | null;
  publishedById: string | null;
  publishCosignerId: string | null;
  rejectReason: string | null;
  session: { id: string; name: string };
  offering: {
    id: string;
    course: { id: string; code: string; title: string };
    semester: { id: string; name: string; sequence: number };
  };
  gradeScale: { id: string; key: string; name: string };
  _count: { gradeRecords: number };
}

/** GET /results/batches/:id — the batch with its chain, scale bands and grades. */
export interface ResultBatchDetail extends ResultBatchListItem {
  semester: { id: string; name: string; sequence: number };
  gradeScale: GradeScale;
  approvals: Array<{
    id: string;
    decision: string;
    comment: string | null;
    stage: { key: string; name: string; sequence: number };
  }>;
  gradeRecords: Array<{
    id: string;
    course: { code: string; title: string };
    totalScore: string | number | null;
    grade: string | null;
    gradePoint: string | number | null;
    creditUnits: number;
    mark: ScoreMark;
    version: number;
    publishedAt: string | null;
  }>;
}

/** GET /results/batches/:id/compute — the preview the approval is made against. */
export interface BatchComputeRow {
  registrationLineId: string;
  matriculationNumber: string;
  fullName: string;
  level: number;
  status: 'OK' | 'MARKED' | 'INCOMPLETE';
  reason: string | null;
  totalScore: string | number | null;
  grade: string | null;
  gradePoint: string | number | null;
  mark: ScoreMark | null;
  passed?: boolean;
}

export interface BatchComputePreview {
  offering: string;
  batchStatus: ResultBatchStatus;
  graded: number;
  incomplete: number;
  marked: number;
  rows: BatchComputeRow[];
}

/** GET /results/withholdings */
export interface WithholdingItem {
  id: string;
  reason: string;
  status: 'ACTIVE' | 'RELEASED';
  placedAt: string;
  releasedAt: string | null;
  studentRecord: { matriculationNumber: string; surname: string; firstName: string };
  offering: { id: string; course: { code: string; title: string } } | null;
  session: { id: string; name: string } | null;
}

/** GET /me/results — the student's OWN published results. */
export interface OwnResults {
  grades: Array<{
    id: string;
    code: string;
    title: string;
    level: number;
    session: string;
    sessionId: string;
    semester: string;
    semesterSequence: number;
    creditUnits: number;
    totalScore: string | number | null;
    grade: string | null;
    gradePoint: string | number | null;
    mark: ScoreMark;
    isCarryover: boolean;
    publishedAt: string | null;
  }>;
  gpas: Array<{
    id: string;
    session: string;
    semester: string;
    level: number;
    unitsRegistered: number;
    unitsPassed: number;
    gpa: string | number;
    cumulativeUnits: number;
    cgpa: string | number;
  }>;
  withholdings: Array<{
    id: string;
    reason: string;
    placedAt: string;
    course: string | null;
    session: string | null;
  }>;
  withheldCourseCodes: string[];
}

// --- Finance (Phase 4) -----------------------------------------------------
// Amounts arrive as DIGIT STRINGS of integer minor units (kobo), §11.5.

export type InvoiceStatus = 'DRAFT' | 'ISSUED' | 'PARTIALLY_PAID' | 'PAID' | 'CANCELLED' | 'VOID';
export type WaiverStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type PaymentIntentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'PAID'
  | 'POSTED_TO_LEDGER'
  | 'UNDERPAID'
  | 'OVERPAID'
  | 'REVERSED'
  | 'FAILED'
  | 'ABANDONED';

export interface FeeItem {
  id: string;
  feeType: string;
  label: string;
  /** Kobo digit string. */
  amount: string;
  isMandatory: boolean;
  sortOrder: number;
}

/** Row from GET /finance/schedules (bigint columns already stringified). */
export interface FeeSchedule {
  id: string;
  programmeId: string;
  name: string;
  sessionId: string | null;
  semesterId: string | null;
  clearanceThresholdBps: number;
  isActive: boolean;
  invoiceCount: number;
  createdAt: string;
  programme: { id: string; code: string; name: string };
  session: { id: string; name: string } | null;
  Semester: { id: string; name: string } | null;
  items: FeeItem[];
}

export interface InvoiceLine {
  id: string;
  description: string;
  quantity: number;
  unitAmount: string;
  amount: string;
  feeType: string | null;
}

/** Row from GET /finance/invoices (serialize() of InvoiceService). */
export interface InvoiceListItem {
  id: string;
  invoiceNumber: string;
  status: InvoiceStatus;
  issuedAt: string | null;
  dueAt: string | null;
  totalAmount: string;
  paidAmount: string;
  student: { id: string; matriculationNumber: string; name: string };
  session: { id: string; name: string } | null;
  semester: { id: string; name: string; sequence: number } | null;
  lines: InvoiceLine[];
  createdAt: string;
}

/** GET /finance/invoices/:id */
export interface InvoiceDetail extends InvoiceListItem {
  waivedAmount: string;
  outstanding: string;
  ledger: Array<{
    id: string;
    direction: 'DEBIT' | 'CREDIT';
    source: string;
    amount: string;
    description: string;
    createdAt: string;
  }>;
  waivers: Array<{
    id: string;
    feeType: string | null;
    amount: string;
    reason: string;
    status: WaiverStatus;
    decisionNote: string | null;
    requestedAt: string;
    decidedAt: string | null;
  }>;
}

export interface LedgerEntryView {
  id: string;
  direction: 'DEBIT' | 'CREDIT';
  source: string;
  amount: string;
  description: string;
  invoiceNumber: string | null;
  createdAt: string;
}

/** GET /finance/students/:id/ledger — also the shape of GET /me/finance. */
export interface StudentLedgerView {
  student: { id: string; matriculationNumber: string; name: string };
  sums: { debits: string; credits: string; balance: string };
  entries: LedgerEntryView[];
  invoices: Array<{
    id: string;
    invoiceNumber: string;
    status: InvoiceStatus;
    totalAmount: string;
    paidAmount: string;
    issuedAt: string | null;
    dueAt: string | null;
    session: { id: string; name: string } | null;
    semester: { id: string; name: string; sequence: number } | null;
  }>;
  waivers: Array<{
    id: string;
    invoiceNumber: string | null;
    feeType: string | null;
    amount: string;
    reason: string;
    status: WaiverStatus;
    createdAt: string;
  }>;
}

/** GET /me/finance attaches the clearance verdict per invoiced session. */
export interface OwnFinanceView extends StudentLedgerView {
  clearances: Array<{
    sessionId: string;
    sessionName: string | null;
    invoiced: boolean;
    cleared: boolean;
    billed: string;
    covered: string;
    shortfall: string;
  }>;
}

/** GET /finance/overview — the bursary dashboard. */
export interface FinanceOverview {
  invoices: Record<string, { count: number; billed: string; paid: string }>;
  billed: string;
  received: string;
  waived: string;
  outstanding: string;
  pendingWaivers: { count: number; amount: string };
  approvedLoanClearances: number;
}

/** Row from GET /finance/waivers */
export interface WaiverListItem {
  id: string;
  student: { id: string; matriculationNumber: string; name: string };
  invoiceNumber: string | null;
  sessionId: string | null;
  feeType: string | null;
  amount: string;
  reason: string;
  status: WaiverStatus;
  requestedByName: string | null;
  approvedByName: string | null;
  decisionNote: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
}

/** Row from GET /finance/loans */
export interface LoanClearanceItem {
  id: string;
  student: { id: string; matriculationNumber: string; name: string };
  session: { id: string; name: string };
  loanProvider: string;
  reference: string;
  amountCovered: string;
  validFrom: string | null;
  validTo: string | null;
  status: 'PENDING' | 'APPROVED';
  recordedByName: string | null;
  createdAt: string;
}

/** Row from GET /finance/payments */
export interface PaymentIntentItem {
  id: string;
  amount: string;
  currency: string;
  provider: string | null;
  providerReference: string | null;
  status: PaymentIntentStatus;
  discrepancyAmount: string | null;
  invoiceNumber: string | null;
  paidAt: string | null;
  postedAt: string | null;
  createdAt: string;
}

/** Row from GET /finance/reconciliations */
export interface ReconciliationItem {
  id: string;
  provider: string;
  settlementDate: string;
  providerTotal: string;
  ledgerTotal: string;
  discrepancy: string;
  matchedCount: number;
  unmatchedCount: number;
  status: 'PENDING' | 'APPROVED';
  reconciledAt: string | null;
  notes: string | null;
  createdAt: string;
}

/** GET /finance/students/:id/clearance */
export interface ClearanceView {
  student: { id: string; matriculationNumber: string; name: string };
  session: { id: string; name: string };
  invoiced: boolean;
  cleared: boolean;
  billed: string;
  covered: string;
  shortfall: string;
}
