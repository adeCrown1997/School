'use client';

/**
 * Authenticated app shell: top bar + permission-aware sidebar. Nav links are
 * shown/hidden purely for UX based on the principal's permissions — this is NOT
 * a security control. Every destination fetches from the API, which independently
 * authorizes the request; a user who navigates to a page they lack rights for
 * simply sees an access notice and empty data, never privileged content.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { canAny, PERMISSIONS, type PermissionKey } from '@/lib/permissions';

interface NavItem {
  href: string;
  label: string;
  /** Show when the user has ANY of these; omitted = always show (authenticated). */
  anyOf?: PermissionKey[];
  /** Show only for a student principal. */
  studentOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', anyOf: [PERMISSIONS.DASHBOARD_ADMIN_VIEW] },
  { href: '/student', label: 'My dashboard', studentOnly: true },
  { href: '/me/profile', label: 'My profile', studentOnly: true },
  { href: '/me/change-requests', label: 'My change requests', studentOnly: true },
  {
    href: '/students',
    label: 'Students',
    anyOf: [PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_CREATE],
  },
  { href: '/students/import', label: 'Bulk import', anyOf: [PERMISSIONS.STUDENTS_IMPORT] },
  {
    href: '/change-requests',
    label: 'Change requests',
    anyOf: [PERMISSIONS.CHANGE_REQUESTS_VIEW],
  },
  { href: '/users', label: 'Staff accounts', anyOf: [PERMISSIONS.USERS_VIEW] },
  { href: '/roles', label: 'Roles & permissions', anyOf: [PERMISSIONS.ROLES_VIEW] },
  { href: '/structure', label: 'University structure', anyOf: [PERMISSIONS.STRUCTURE_VIEW] },
  { href: '/modules', label: 'Other modules' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { me, clear } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);

  const visible = NAV.filter((item) => {
    if (item.studentOnly) return me?.userType === 'STUDENT';
    if (!item.anyOf) return true;
    return canAny(me?.permissions, item.anyOf);
  });

  async function logout() {
    try {
      await api.post('/auth/logout');
    } catch {
      /* even if the call fails, drop local session */
    }
    clear();
    router.replace('/login');
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Top bar (mobile) */}
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <span className="font-bold text-brand-700">ePortal</span>
        <button
          className="btn-secondary"
          aria-expanded={open}
          aria-controls="sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          Menu
        </button>
      </header>

      {/* Sidebar */}
      <aside
        id="sidebar"
        className={`${open ? 'block' : 'hidden'} border-r border-slate-200 bg-white lg:block`}
      >
        <div className="hidden items-center gap-2 px-6 py-5 lg:flex">
          <span className="text-lg font-bold text-brand-700">University ePortal</span>
        </div>
        <nav className="space-y-1 px-3 pb-6" aria-label="Primary">
          {visible.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                aria-current={active ? 'page' : undefined}
                className={`block rounded-md px-3 py-2 text-sm font-medium ${
                  active
                    ? 'bg-brand-50 text-brand-700'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex min-h-screen flex-col">
        <div className="hidden items-center justify-between border-b border-slate-200 bg-white px-8 py-3 lg:flex">
          <span className="text-sm text-slate-500">
            Signed in as <span className="font-medium text-slate-800">{me?.fullName}</span>
            {me?.userType === 'STAFF' ? ' · Staff' : me?.userType === 'STUDENT' ? ' · Student' : ''}
          </span>
          <div className="flex items-center gap-3">
            <Link href="/account/password" className="text-sm text-brand-600 hover:underline">
              Change password
            </Link>
            <button className="btn-secondary" onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
