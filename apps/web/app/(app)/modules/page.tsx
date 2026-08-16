'use client';

/**
 * "Other modules" (§21 / §22). Modules that shipped in a phase are shown as
 * Available with a working link; the rest appear here as PLANNED navigation so
 * the platform's scope is legible — but each unimplemented module is clearly
 * marked unavailable and is NOT a working link. This deliberately avoids
 * pretending unimplemented functionality exists.
 */
import Link from 'next/link';
import { useSession } from '@/lib/session';
import { can, PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import { PageHeader } from '@/components/page';
import {
  AlertTriangleIcon,
  BookOpenIcon,
  CalendarIcon,
  ClipboardListIcon,
  ClockIcon,
  FileTextIcon,
  GraduationCapIcon,
  LayersIcon,
  BoxesIcon,
  LandmarkIcon,
  SettingsIcon,
  UsersIcon,
  type IconProps,
} from '@/components/icons';

interface ModuleInfo {
  name: string;
  description: string;
  audience: 'student' | 'staff' | 'all';
  icon: (p: IconProps) => React.JSX.Element;
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
    icon: GraduationCapIcon,
    href: '/student/registration',
  },
  {
    name: 'Registration windows & policy',
    description: 'Configure registration open/close dates and institutional rules.',
    audience: 'staff',
    icon: CalendarIcon,
    href: '/registrations/windows',
    permission: PERMISSIONS.REGISTRATION_VIEW,
  },
  { name: 'Results & Transcripts', description: 'View grades and academic transcripts.', audience: 'student', icon: FileTextIcon },
  { name: 'Fees & Payments', description: 'Invoices, payments and receipts.', audience: 'all', icon: LandmarkIcon },
  { name: 'Examinations', description: 'Exam dockets, timetables and clearances.', audience: 'student', icon: ClipboardListIcon },
  {
    name: 'Registration review',
    description: 'Review and approve student course registrations.',
    audience: 'staff',
    icon: ClipboardListIcon,
    href: '/registrations',
    permission: PERMISSIONS.REGISTRATION_VIEW,
  },
  {
    name: 'Course catalogue',
    description: 'Define and maintain the university course catalogue.',
    audience: 'staff',
    icon: BookOpenIcon,
    href: '/academics/courses',
    permission: PERMISSIONS.COURSES_VIEW,
  },
  {
    name: 'Curriculum versions',
    description: 'Programme curricula — course requirements per level and semester.',
    audience: 'staff',
    icon: LayersIcon,
    href: '/academics/curriculum',
    permission: PERMISSIONS.CURRICULUM_VIEW,
  },
  {
    name: 'Course offerings',
    description: 'Schedule courses for a session and semester — capacity and availability.',
    audience: 'staff',
    icon: CalendarIcon,
    href: '/academics/offerings',
    permission: PERMISSIONS.OFFERINGS_VIEW,
  },
  {
    name: 'Academic configuration',
    description: 'Course categories, grading scales and credit-unit policy.',
    audience: 'staff',
    icon: SettingsIcon,
    href: '/academics/config',
    permission: PERMISSIONS.ACADEMIC_CONFIG_VIEW,
  },
  { name: 'Grading & Assessment', description: 'Record and moderate student scores.', audience: 'staff', icon: FileTextIcon },
  { name: 'Timetabling', description: 'Lecture and exam scheduling.', audience: 'staff', icon: ClockIcon },
  { name: 'Hostel & Accommodation', description: 'Room allocation and management.', audience: 'all', icon: BoxesIcon },
  { name: 'Library', description: 'Catalogue, loans and fines.', audience: 'all', icon: BookOpenIcon },
  { name: 'Notifications & Messaging', description: 'Announcements and alerts.', audience: 'all', icon: UsersIcon },
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
        description="Everything the platform covers at a glance. Available modules open directly; the rest are shown for context and light up as later phases ship."
      />

      <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm text-amber-900 shadow-sm">
        <AlertTriangleIcon size={18} className="mt-0.5 shrink-0 text-amber-500" aria-hidden />
        <p>
          Modules marked <span className="font-semibold">Available</span> are live. Unimplemented
          areas remain clearly flagged rather than simulated — the UI never pretends a module
          exists before it does.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {modules.map((m) => {
          const live = !!m.href;
          const showLink =
            live &&
            (!m.href?.startsWith('/student/') || isStudent) &&
            (!m.permission || can(me?.permissions, m.permission));
          const Icon = m.icon;
          return (
            <div
              key={m.name}
              className={`card group relative flex flex-col p-5 transition-shadow ${
                live ? 'hover:shadow-card-hover' : 'opacity-70'
              }`}
              aria-disabled={live ? undefined : 'true'}
            >
              <div className="mb-3 flex items-start justify-between gap-2">
                <span
                  aria-hidden
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    live
                      ? 'bg-brand-50 text-brand-600'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  <Icon size={19} />
                </span>
                {live ? (
                  <span className="badge bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Available
                  </span>
                ) : (
                  <span className="badge bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-500/20">
                    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-slate-400" />
                    Coming soon
                  </span>
                )}
              </div>
              <h2 className="text-sm font-semibold tracking-tight text-slate-800">{m.name}</h2>
              <p className="mt-1 flex-1 text-sm leading-6 text-slate-500">{m.description}</p>
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
