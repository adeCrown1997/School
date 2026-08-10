import type { Metadata } from 'next';
import './globals.css';
import { SessionProvider } from '@/lib/session';

export const metadata: Metadata = {
  title: 'University ePortal',
  description: 'Official university portal — Phase 1',
};

/**
 * Root layout. Wraps the whole app in the SessionProvider so any page can read
 * the current principal. The `--font-sans` variable is set on <body> to match
 * the Tailwind fontFamily token.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
