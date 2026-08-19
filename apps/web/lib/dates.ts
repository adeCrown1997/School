/**
 * Date-of-birth presentation helpers. The API transports dates as ISO
 * (YYYY-MM-DD); every user-facing date-of-birth surface — forms, hints, and
 * read-only displays — consistently presents DD/MM/YYYY. Convert at the edge:
 * don't send raw user text to the API, don't render raw ISO to the user.
 */

/** ISO date (or Date) → DD/MM/YYYY display string. Junk/empty input → "—". */
export function formatDob(iso: string | Date | null | undefined): string {
  if (!iso) return '—';
  const value = typeof iso === 'string' ? iso.slice(0, 10) : iso.toISOString().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return typeof iso === 'string' ? iso : '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/**
 * DD/MM/YYYY as typed by a user → ISO (YYYY-MM-DD) for the API, or null when
 * the input is not a valid calendar date. Tolerates DD-MM-YYYY / DD.MM.YYYY
 * and 1-digit day/month parts. Future dates are returned as ISO (not null):
 * the server owns the "cannot be in the future" rule and returns the precise
 * message.
 */
export function dobToIso(input: string): string | null {
  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(input.trim());
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(probe.getTime()) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
