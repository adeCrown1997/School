'use client';

/**
 * STUDENT ACTIVATION — the only way a student obtains a login, and it works
 * strictly against a PRE-EXISTING official record. A single step:
 *
 *   Identify: matriculation number + date of birth + surname. If the three match
 *   a PENDING record, the API creates the login and issues the student's SURNAME
 *   as the initial password, flagged "must change". The API replies generically
 *   ("if your details match…") so this page cannot be used to discover which
 *   matric numbers exist, and it never invents identity — no field is created or
 *   edited here, and the password is deliberately NOT set here: it is chosen at
 *   the forced change after the student's first sign-in.
 *
 * Email verification is currently disabled (the OTP step is skipped server-side
 * when the STUDENT_ACTIVATION_REQUIRE_EMAIL_OTP flag is off). The API still
 * reports emailVerificationRequired, so this page can grow the OTP step back
 * without the activation flow changing.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Field } from '@/components/ui';
import type { ActivationResult } from '@/lib/types';

export default function ActivatePage() {
  const router = useRouter();
  const [matric, setMatric] = useState('');
  const [dob, setDob] = useState('');
  const [surname, setSurname] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);
    try {
      // The response is intentionally generic; we advance regardless of match.
      await api.post<ActivationResult>('/students/activate', {
        matriculationNumber: matric.trim(),
        dateOfBirth: dob,
        surname: surname.trim(),
      });
      setDone(true);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setDetails(err.details ?? []);
      } else {
        setError('Something went wrong. Please try again.');
        setDetails([]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold text-brand-700">Activate your student account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Use the details from your admission record. The university has already created your
            record — this only sets up your login.
          </p>
        </div>

        <div className="card p-6">
          {done ? (
            <div className="space-y-4">
              <Alert kind="success" title="Account activated">
                Your student account is ready. Sign in with your <strong>matriculation number</strong>{' '}
                and the initial password <strong>issued with your admission letter</strong> (your
                surname). You will be asked to set a permanent password on first sign-in.
              </Alert>
              <button className="btn-primary w-full" onClick={() => router.replace('/login')}>
                Go to sign in
              </button>
            </div>
          ) : (
            <>
              {error ? (
                <div className="mb-4">
                  <Alert kind="error">
                    <p>{error}</p>
                    {details.length ? (
                      <ul className="mt-1 list-disc pl-5">
                        {details.map((d) => (
                          <li key={d}>{d}</li>
                        ))}
                      </ul>
                    ) : null}
                  </Alert>
                </div>
              ) : null}

              <form onSubmit={submit} className="space-y-4" noValidate>
                <Field
                  label="Matriculation number"
                  required
                  autoCapitalize="characters"
                  placeholder="AGE/2021/001"
                  hint="Format: PREFIX/YEAR/SEQUENCE, for example AGE/2021/001."
                  value={matric}
                  onChange={(e) => setMatric(e.target.value)}
                  autoComplete="off"
                />
                <Field
                  label="Date of birth"
                  type="date"
                  required
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                />
                <Field
                  label="Surname"
                  required
                  value={surname}
                  onChange={(e) => setSurname(e.target.value)}
                  autoComplete="off"
                />
                <button type="submit" className="btn-primary w-full" disabled={submitting}>
                  {submitting ? 'Checking…' : 'Activate account'}
                </button>
              </form>
            </>
          )}
        </div>

        <p className="mt-4 text-center text-sm">
          <Link href="/login" className="text-brand-600 hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
