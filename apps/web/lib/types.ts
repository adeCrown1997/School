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
