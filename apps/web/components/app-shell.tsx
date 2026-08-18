'use client';

/**
 * Authenticated app shell: dark navigation sidebar + sticky top bar, with a
 * slide-over drawer on mobile. Nav links are shown/hidden purely for UX based
 * on the principal's permissions — this is NOT a security control. Every
 * destination fetches from the API, which independently authorizes the request;
 * a user who navigates to a page they lack rights for simply sees an access
 * notice and empty data, never privileged content.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { canAny, PERMISSIONS, type PermissionKey } from '@/lib/permissions';
import {
  BanknoteIcon,
  BookOpenIcon,
  BuildingIcon,
  CalendarIcon,
  ClipboardListIcon,
  FileTextIcon,
  GraduationCapIcon,
  HomeIcon,
  IdCardIcon,
  KeyIcon,
  LandmarkIcon,
  LayersIcon,
  LogOutIcon,
  MenuIcon,
  SettingsIcon,
  SlidersIcon,
  UsersIcon,
  UserIcon,
  UserPlusIcon,
  XIcon,
  type IconProps,
} from './icons';

interface NavItem {
  href: string;
  label: string;
  icon: (p: IconProps) => React.JSX.Element;
  /** Show when the user has ANY of these; omitted = always show (authenticated). */
  anyOf?: PermissionKey[];
  /** Show only for a student principal. */
  studentOnly?: boolean;
}

/** Navigation grouped for scannability: primary destinations first, then
 *  records, academics and administration. Href, label and permission logic are
 *  unchanged from the original flat list. */
const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: HomeIcon,
        anyOf: [PERMISSIONS.DASHBOARD_ADMIN_VIEW],
      },
      { href: '/student', label: 'My dashboard', icon: HomeIcon, studentOnly: true },
    ],
  },
  {
    title: 'Academics',
    items: [
      {
        href: '/student/registration',
        label: 'Course registration',
        icon: GraduationCapIcon,
        studentOnly: true,
      },
      {
        href: '/registrations',
        label: 'Registrations',
        icon: ClipboardListIcon,
        anyOf: [PERMISSIONS.REGISTRATION_VIEW],
      },
      {
        href: '/registrations/windows',
        label: 'Registration windows',
        icon: CalendarIcon,
        anyOf: [
          PERMISSIONS.REGISTRATION_VIEW,
          PERMISSIONS.STRUCTURE_MANAGE,
          PERMISSIONS.ACADEMIC_CONFIG_MANAGE,
        ],
      },
      {
        href: '/academics/courses',
        label: 'Course catalogue',
        icon: BookOpenIcon,
        anyOf: [PERMISSIONS.COURSES_VIEW, PERMISSIONS.COURSES_CREATE],
      },
      {
        href: '/academics/curriculum',
        label: 'Curriculum',
        icon: LayersIcon,
        anyOf: [PERMISSIONS.CURRICULUM_VIEW, PERMISSIONS.CURRICULUM_MANAGE],
      },
      {
        href: '/academics/offerings',
        label: 'Course offerings',
        icon: CalendarIcon,
        anyOf: [PERMISSIONS.OFFERINGS_VIEW, PERMISSIONS.OFFERINGS_MANAGE],
      },
      {
        href: '/academics/config',
        label: 'Academic config',
        icon: SettingsIcon,
        anyOf: [PERMISSIONS.ACADEMIC_CONFIG_VIEW, PERMISSIONS.ACADEMIC_CONFIG_MANAGE],
      },
    ],
  },
  {
    title: 'Bursary',
    items: [
      {
        href: '/finance',
        label: 'Finance',
        icon: BanknoteIcon,
        anyOf: [PERMISSIONS.FINANCE_VIEW],
      },
      { href: '/me/finance', label: 'My finance', icon: BanknoteIcon, studentOnly: true },
    ],
  },
  {
    title: 'Records',
    items: [
      {
        href: '/students',
        label: 'Students',
        icon: GraduationCapIcon,
        anyOf: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_CREATE],
      },
      { href: '/students/import', label: 'Bulk import', icon: UserPlusIcon, anyOf: [PERMISSIONS.STUDENTS_IMPORT] },
      {
        href: '/change-requests',
        label: 'Change requests',
        icon: FileTextIcon,
        anyOf: [PERMISSIONS.CHANGE_REQUESTS_VIEW],
      },
      { href: '/me/profile', label: 'My profile', icon: UserIcon, studentOnly: true },
      { href: '/me/change-requests', label: 'My change requests', icon: FileTextIcon, studentOnly: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      { href: '/users', label: 'Staff accounts', icon: UsersIcon, anyOf: [PERMISSIONS.USERS_VIEW] },
      { href: '/roles', label: 'Roles & permissions', icon: IdCardIcon, anyOf: [PERMISSIONS.ROLES_VIEW] },
      { href: '/structure', label: 'University structure', icon: BuildingIcon, anyOf: [PERMISSIONS.STRUCTURE_VIEW] },
      { href: '/modules', label: 'Other modules', icon: SlidersIcon },
    ],
  },
];

function NavLinks({
  pathname,
  onNavigate,
}: {
  pathname: string;
  onNavigate: () => void;
}) {
  const { me } = useSession();
  return (
    <nav className="space-y-5 px-3 pb-6" aria-label="Primary">
      {NAV_GROUPS.map((group) => {
        const items = group.items.filter((item) => {
          if (item.studentOnly) return me?.userType === 'STUDENT';
          if (!item.anyOf) return true;
          return canAny(me?.permissions, item.anyOf);
        });
        if (items.length === 0) return null;
        return (
          <div key={group.title}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400/70">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={`group flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-white/10 text-white shadow-[inset_2px_0_0_0_theme(colors.brand.400)]'
                          : 'text-slate-300 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      <Icon
                        size={17}
                        className={`shrink-0 transition-colors ${
                          active ? 'text-brand-300' : 'text-slate-400 group-hover:text-slate-200'
                        }`}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2.5 px-6 py-5">
      <span
        aria-hidden
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500 text-white shadow-lg shadow-brand-900/40"
      >
        <LandmarkIcon size={18} />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-bold tracking-tight text-white">University ePortal</span>
        <span className="block text-[11px] font-medium text-slate-400">Campus records & academics</span>
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, clear } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Close the mobile drawer on navigation and on Escape; lock body scroll while
  // it is open so the page underneath cannot drift.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [drawerOpen]);

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* even if the call fails, drop local session */
    }
    clear();
    router.replace('/login');
  }

  const initials = (me?.fullName ?? '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <div className="min-h-screen bg-slate-100 lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col overflow-y-auto bg-navy-900 lg:flex">
        <Brand />
        <NavLinks pathname={pathname} onNavigate={() => undefined} />
        <div className="mt-auto border-t border-white/10 px-3 py-3">
          <button
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
            onClick={logout}
          >
            <LogOutIcon size={17} className="text-slate-400" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="absolute inset-0 animate-fade-in bg-slate-900/50 backdrop-blur-[2px]"
            aria-hidden
            onClick={() => setDrawerOpen(false)}
          />
          <div
            id="mobile-nav"
            className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] animate-fade-in flex-col overflow-y-auto bg-navy-900 shadow-lift"
          >
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button
                className="btn-icon text-slate-300 hover:bg-white/10 hover:text-white"
                aria-label="Close menu"
                onClick={() => setDrawerOpen(false)}
              >
                <XIcon size={18} />
              </button>
            </div>
            <NavLinks pathname={pathname} onNavigate={() => setDrawerOpen(false)} />
            <div className="mt-auto border-t border-white/10 px-3 py-3">
              <button
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-white/5 hover:text-white"
                onClick={logout}
              >
                <LogOutIcon size={17} className="text-slate-400" />
                Sign out
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/85 backdrop-blur">
        <div className="flex h-16 items-center gap-3 px-4 lg:px-8">
          <button
            className="btn-icon -ml-1 lg:hidden"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon size={20} />
          </button>

          <span className="font-display text-base font-bold tracking-tight text-slate-900 lg:hidden">
            ePortal
          </span>

          <div className="ml-auto flex items-center gap-2.5">
            <Link href="/account/password" className="btn-ghost hidden gap-1.5 sm:inline-flex" title="Change password">
              <KeyIcon size={16} className="text-slate-400" />
              Change password
            </Link>
            <Link href="/account/password" className="btn-icon sm:hidden" aria-label="Change password">
              <KeyIcon size={18} />
            </Link>

            <span className="hidden h-6 w-px bg-slate-200 sm:block" aria-hidden />

            <div className="flex items-center gap-2.5 pl-1">
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white shadow-sm"
              >
                {initials || '•'}
              </span>
              <span className="hidden min-w-0 leading-tight md:block">
                <span className="block max-w-[11rem] truncate text-sm font-semibold text-slate-800">
                  {me?.fullName}
                </span>
                <span className="block text-xs text-slate-500">
                  {me?.userType === 'STUDENT' ? 'Student' : 'Staff'}
                </span>
              </span>
            </div>

            <button className="btn-ghost gap-1.5 hidden lg:inline-flex" onClick={logout}>
              <LogOutIcon size={16} className="text-slate-400" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-page flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
    </div>
  );
}
