'use client';

/**
 * STUDENT ACTIVATION — the only way a student obtains a login, and it works
 * strictly against a PRE-EXISTING official record. Three steps:
 *
 *   1. Identify: matriculation number + date of birth + surname. The API replies
 *      generically ("if your details match…") so this page CANNOT be used to
 *      discover which matric numbers exist — we always advance to step 2.
 *   2. Verify: the 6-digit OTP delivered to the email ON FILE (never entered
 *      here). On success the API returns a single-use continuation token.
 *   3. Set password: create the account password. The API links the new login to
 *      the existing record; identity itself is never created or edited here.
 *
 * This page never invents identity — every field the university owns is
 * displayed nowhere and editable nowhere. It only proves possession of the
 * enrolment factors + the on-file email.
 */
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, ApiError } from '@/lib/api';
import { Alert, Field } from '@/components/ui';

type Step = 1 | 2 | 3 | 4;

export default function ActivatePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [error, setError] = useState<string | null>(null);
  const [details, setDetails] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Step 1 fields
  const [matric, setMatric] = useState('');
  const [dob, setDob] = useState('');
  const [surname, setSurname] = useState('');

  // Step 2/3 carriers
  const [otp, setOtp] = useState('');
  const [continuationToken, setContinuationToken] = useState('');

  // Step 3 fields
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  function fail(err: unknown, fallback: string) {
    if (err instanceof ApiError) {
      setError(err.message);
      setDetails(err.details ?? []);
    } else {
      setError(fallback);
      setDetails([]);
    }
  }

  async function submitIdentify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);
    try {
      // Response is intentionally generic; we advance regardless of match.
      await api.post('/students/activate/identify', {
        matriculationNumber: matric.trim(),
        dateOfBirth: dob,
        surname: surname.trim(),
      });
      setStep(2);
    } catch (err) {
      fail(err, 'Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVerify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    setSubmitting(true);
    try {
      const data = await api.post<{ continuationToken: string; expiresInSec: number }>(
        '/students/activate/verify',
        { matriculationNumber: matric.trim(), otp: otp.trim() },
      );
      setContinuationToken(data.continuationToken);
      setStep(3);
    } catch (err) {
      fail(err, 'The verification code is invalid or has expired.');
    } finally {
      setSubmitting(false);
    }
  }

  async function submitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDetails([]);
    if (password !== confirm) {
      setError('The two passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/students/activate/set-password', {
        continuationToken,
        password,
      });
      setStep(4);
    } catch (err) {
      fail(err, 'Unable to set your password. Please start again.');
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

        <Stepper current={step} />

        <div className="card mt-4 p-6">
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

          {step === 1 ? (
            <form onSubmit={submitIdentify} className="space-y-4" noValidate>
              <Field
                label="Matriculation number"
                required
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
                {submitting ? 'Checking…' : 'Continue'}
              </button>
            </form>
          ) : null}

          {step === 2 ? (
            <form onSubmit={submitVerify} className="space-y-4" noValidate>
              <Alert kind="info">
                If your details matched our records, a 6-digit verification code has been sent to the
                email address the university has on file. Enter it below.
              </Alert>
              <Field
                label="Verification code"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                required
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                autoComplete="one-time-code"
              />
              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? 'Verifying…' : 'Verify code'}
              </button>
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={() => {
                  setStep(1);
                  setOtp('');
                  setError(null);
                }}
              >
                Start over
              </button>
            </form>
          ) : null}

          {step === 3 ? (
            <form onSubmit={submitPassword} className="space-y-4" noValidate>
              <Alert kind="success">Code verified. Choose a password to finish.</Alert>
              <Field
                label="Password"
                type="password"
                autoComplete="new-password"
                required
                hint="At least 12 characters, mixing upper/lower case, a number and a symbol."
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <Field
                label="Confirm password"
                type="password"
                autoComplete="new-password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <button type="submit" className="btn-primary w-full" disabled={submitting}>
                {submitting ? 'Finishing…' : 'Activate account'}
              </button>
            </form>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <Alert kind="success" title="Account activated">
                Your student account is ready. You can now sign in with your official email and the
                password you just set.
              </Alert>
              <button className="btn-primary w-full" onClick={() => router.replace('/login')}>
                Go to sign in
              </button>
            </div>
          ) : null}
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

function Stepper({ current }: { current: Step }) {
  const steps = ['Identify', 'Verify', 'Set password'];
  return (
    <ol className="flex items-center justify-center gap-2" aria-label="Activation progress">
      {steps.map((label, i) => {
        const n = (i + 1) as Step;
        const active = current === n;
        const done = current > n;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={`badge ${
                done
                  ? 'bg-green-100 text-green-800'
                  : active
                    ? 'bg-brand-100 text-brand-800'
                    : 'bg-slate-100 text-slate-500'
              }`}
              aria-current={active ? 'step' : undefined}
            >
              {done ? '✓' : n}. {label}
            </span>
            {i < steps.length - 1 ? <span aria-hidden className="text-slate-300">→</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
