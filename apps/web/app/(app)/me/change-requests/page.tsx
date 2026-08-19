'use client';

/**
 * Student "My change requests". Lets a student raise a correction to a PROTECTED
 * identity field and track its status. The set of correctable fields is narrow
 * (personal identity only — never academic placement, matric, or student id) and
 * mirrors the API's STUDENT_CORRECTABLE_FIELDS. Submitting only files a request;
 * a Registry officer must approve it before the record ever changes.
 */
import { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { ChangeRequest } from '@/lib/types';
import { PageHeader, AccessNotice, EmptyState } from '@/components/page';
import { Alert, Field, Spinner, StatusBadge } from '@/components/ui';
import { dobToIso, formatDob } from '@/lib/dates';

/** Mirrors the API's STUDENT_CORRECTABLE_FIELDS (profile.dto.ts). */
const CORRECTABLE_FIELDS: { key: string; label: string }[] = [
  { key: 'surname', label: 'Surname' },
  { key: 'firstName', label: 'First name' },
  { key: 'otherNames', label: 'Other names' },
  { key: 'dateOfBirth', label: 'Date of birth' },
  { key: 'gender', label: 'Gender' },
  { key: 'jambRegistrationNumber', label: 'JAMB registration number' },
];

export default function MyChangeRequestsPage() {
  const [items, setItems] = useState<ChangeRequest[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [fieldKey, setFieldKey] = useState(CORRECTABLE_FIELDS[0]!.key);
  const [requestedValue, setRequestedValue] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await api.get<ChangeRequest[]>('/me/change-requests');
      setItems(res);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setForbidden(true);
      else setError(err instanceof ApiError ? err.message : 'Failed to load your requests.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormError(null);
    let value = requestedValue.trim();
    if (fieldKey === 'dateOfBirth') {
      const iso = dobToIso(value);
      if (!iso) {
        setFormError('Date of birth must be a valid date in DD/MM/YYYY format.');
        setSubmitting(false);
        return;
      }
      value = iso;
    }
    try {
      await api.post('/me/change-requests', {
        fieldKey,
        requestedValue: value,
        reason: reason.trim(),
      });
      setRequestedValue('');
      setReason('');
      await load();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to submit the request.');
    } finally {
      setSubmitting(false);
    }
  }

  async function cancel(id: string) {
    try {
      await api.post(`/me/change-requests/${id}/cancel`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to cancel.');
    }
  }

  if (loading) return <Spinner label="Loading your requests…" />;
  if (forbidden)
    return <AccessNotice message="This page is only available to a student account." />;

  const labelFor = (key: string) =>
    CORRECTABLE_FIELDS.find((f) => f.key === key)?.label ?? key;

  const valueFor = (key: string, value: string | null | undefined) =>
    key === 'dateOfBirth' ? formatDob(value ?? null) : (value ?? '—');

  return (
    <>
      <PageHeader
        title="My change requests"
        description="Request a correction to a personal detail. A Registry officer reviews every request before anything changes."
      />

      {error ? (
        <div className="mb-4">
          <Alert kind="error">{error}</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="card p-5 lg:col-span-1">
          <h2 className="mb-4 text-sm font-semibold text-slate-700">New request</h2>
          {formError ? (
            <div className="mb-4">
              <Alert kind="error">{formError}</Alert>
            </div>
          ) : null}
          <div className="space-y-4">
            <div>
              <label htmlFor="field" className="label">
                Field to correct
              </label>
              <select
                id="field"
                className="input"
                value={fieldKey}
                onChange={(e) => setFieldKey(e.target.value)}
              >
                {CORRECTABLE_FIELDS.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>
            <Field
              label="Correct value"
              value={requestedValue}
              onChange={(e) => setRequestedValue(e.target.value)}
              hint={
                fieldKey === 'dateOfBirth'
                  ? 'Format: DD/MM/YYYY, for example 14/03/2005.'
                  : undefined
              }
              placeholder={fieldKey === 'dateOfBirth' ? 'DD/MM/YYYY' : undefined}
              required
            />
            <div>
              <label htmlFor="reason" className="label">
                Reason
              </label>
              <textarea
                id="reason"
                className="input min-h-[90px]"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                maxLength={500}
                required
              />
              <p className="mt-1 text-xs text-slate-500">
                Explain the correction. Supporting documents may be requested by the Registry.
              </p>
            </div>
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
        </form>

        <div className="lg:col-span-2">
          {!items || items.length === 0 ? (
            <EmptyState title="No requests yet">
              When you submit a correction it will appear here with its status.
            </EmptyState>
          ) : (
            <ul className="space-y-3">
              {items.map((cr) => (
                <li key={cr.id} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-800">{labelFor(cr.fieldKey)}</p>
                      <p className="mt-1 text-sm text-slate-600">
                        <span className="text-slate-400">from</span> {valueFor(cr.fieldKey, cr.currentValue)}{' '}
                        <span className="text-slate-400">to</span>{' '}
                        <span className="font-medium">{valueFor(cr.fieldKey, cr.requestedValue)}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-500">{cr.reason}</p>
                      {cr.reviewNote ? (
                        <p className="mt-1 text-xs text-slate-500">
                          <span className="font-medium">Reviewer note:</span> {cr.reviewNote}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <StatusBadge state={cr.status} />
                      {cr.status === 'PENDING' ? (
                        <button
                          className="text-xs text-red-600 hover:underline"
                          onClick={() => cancel(cr.id)}
                        >
                          Cancel
                        </button>
                      ) : null}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
