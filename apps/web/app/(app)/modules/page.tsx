'use client';

/**
 * "Other modules" (§21 / §22). Phase 1 delivers foundation, identity, auth and
 * RBAC only. The remaining university modules are shown here as PLANNED navigation
 * so the platform's scope is legible — but each is clearly marked unavailable and
 * is NOT a working link. This deliberately avoids pretending unimplemented
 * functionality exists.
 */
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { PageHeader } from '@/components/page';

interface ModuleInfo {
  name: string;
  description: string;
  audience: 'student' | 'staff' | 'all';
  /** When set, the module is live and links here instead of showing "Coming soon". */
  href?: string;
  /** Staff modules may require a permission before the link is shown. */
  permission?: PermissionKey;
}

const PLANNED_MODULES: ModuleInfo[] = [
  {
    name: 'Course Registration',
    description: 'Enrol in courses each semester.',
    audience: 'student',
    href: '/student/registration',
  },
  {
    name: 'Registration windows & policy',
    description: 'Configure registration open/close dates and institutional rules.',
    audience: 'staff',
    href: '/registrations/windows',
    permission: PERMISSIONS.REGISTRATION_VIEW,
  },
  { name: 'Results & Transcripts', description: 'View grades and academic transcripts.', audience: 'student' },
  { name: 'Fees & Payments', description: 'Invoices, payments and receipts.', audience: 'all' },
  { name: 'Examinations', description: 'Exam dockets, timetables and clearances.', audience: 'student' },
  {
    name: 'Registration review',
    description: 'Review and approve student course registrations.',
    audience: 'staff',
    href: '/registrations',
    permission: PERMISSIONS.REGISTRATION_VIEW,
  },
  {
    name: 'Course catalogue',
    description: 'Define and maintain the university course catalogue.',
    audience: 'staff',
    href: '/academics/courses',
    permission: PERMISSIONS.COURSES_VIEW,
  },
  {
    name: 'Curriculum versions',
    description: 'Programme curricula — course requirements per level and semester.',
    audience: 'staff',
    href: '/academics/curriculum',
    permission: PERMISSIONS.CURRICULUM_VIEW,
  },
  {
    name: 'Course offerings',
    description: 'Schedule courses for a session and semester — capacity and availability.',
    audience: 'staff',
    href: '/academics/offerings',
    permission: PERMISSIONS.OFFERINGS_VIEW,
  },
  { name: 'Grading & Assessment', description: 'Record and moderate student scores.', audience: 'staff' },
  { name: 'Timetabling', description: 'Lecture and exam scheduling.', audience: 'staff' },
  { name: 'Hostel & Accommodation', description: 'Room allocation and management.', audience: 'all' },
  { name: 'Library', description: 'Catalogue, loans and fines.', audience: 'all' },
  { name: 'Notifications & Messaging', description: 'Announcements and alerts.', audience: 'all' },
];

export default function ModulesPage() {
  const { me } = useSession();
  const isStudent = me?.userType === 'STUDENT';

  const modules = PLANNED_MODULES.filter((m) => {
    if (m.audience === 'all') return true;
    if (isStudent) return m.audience === 'student';
    if (m.audience !== 'staff') return false;
    if (m.permission) return can(me?.permissions, m.permission);
    return true;
  });

  return (
    <>
      <PageHeader
        title="Other modules"
        description="These areas are planned for later phases. They are shown here for context and are not yet available."
      />

      <div className="mb-6 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Phase 1 delivers accounts, identity, authentication and access control. The modules below are
        <span className="font-semibold"> not implemented yet</span> — they will light up in future
        phases.
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const live = !!m.href;
          const showLink =
            live &&
            (!m.href?.startsWith('/student/') || isStudent) &&
            (!m.permission || can(me?.permissions, m.permission));
          return (
            <div
              key={m.name}
              className={`card p-5 ${live ? '' : 'opacity-75'}`}
              aria-disabled={live ? undefined : 'true'}
            >
              <div className="mb-1 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-800">{m.name}</h2>
                {live ? (
                  <span className="badge bg-green-100 text-green-800">Available</span>
                ) : (
                  <span className="badge bg-slate-200 text-slate-600">Coming soon</span>
                )}
              </div>
              <p className="text-sm text-slate-500">{m.description}</p>
              {showLink ? (
                <Link href={m.href!} className="btn-primary mt-4 w-full">
                  Open
                </Link>
              ) : (
                <button
                  className="btn-secondary mt-4 w-full cursor-not-allowed opacity-60"
                  disabled
                  aria-disabled="true"
                >
                  Not available yet
                </button>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
