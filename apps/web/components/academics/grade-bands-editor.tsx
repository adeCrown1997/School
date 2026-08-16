'use client';

/**
 * Editable grade-band table used when creating a scale or replacing bands.
 * Scores and points stay as strings in the form so empty/partial input does not
 * coerce to 0; callers parse to numbers on submit.
 */
export interface BandDraft {
  grade: string;
  minScore: string;
  maxScore: string;
  gradePoint: string;
}

/** Common Nigerian 5-point template (seed default). Must cover 0–100 with no gaps. */
export const FIVE_POINT_TEMPLATE: BandDraft[] = [
  { grade: 'A', minScore: '70', maxScore: '100', gradePoint: '5' },
  { grade: 'B', minScore: '60', maxScore: '69', gradePoint: '4' },
  { grade: 'C', minScore: '50', maxScore: '59', gradePoint: '3' },
  { grade: 'D', minScore: '45', maxScore: '49', gradePoint: '2' },
  { grade: 'E', minScore: '40', maxScore: '44', gradePoint: '1' },
  { grade: 'F', minScore: '0', maxScore: '39', gradePoint: '0' },
];

export function emptyBand(): BandDraft {
  return { grade: '', minScore: '', maxScore: '', gradePoint: '' };
}

export function parseBandsPayload(bands: BandDraft[]) {
  return bands.map((b, i) => ({
    grade: b.grade.trim().toUpperCase(),
    minScore: Number(b.minScore),
    maxScore: Number(b.maxScore),
    gradePoint: Number(b.gradePoint),
    sortOrder: i,
  }));
}

export function GradeBandsEditor({
  bands,
  onChange,
  disabled,
}: {
  bands: BandDraft[];
  onChange: (next: BandDraft[]) => void;
  disabled?: boolean;
}) {
  function update(index: number, patch: Partial<BandDraft>) {
    onChange(bands.map((b, i) => (i === index ? { ...b, ...patch } : b)));
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          Bands must cover 0–100 with no overlaps or gaps (inclusive ends; consecutive bands
          meet at n and n+1).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => onChange(FIVE_POINT_TEMPLATE.map((b) => ({ ...b })))}
          >
            Use 5-point template
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={disabled}
            onClick={() => onChange([...bands, emptyBand()])}
          >
            Add band
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-md border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-slate-500">
              <th className="px-3 py-2 font-medium">Grade</th>
              <th className="px-3 py-2 font-medium">Min %</th>
              <th className="px-3 py-2 font-medium">Max %</th>
              <th className="px-3 py-2 font-medium">Points</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {bands.map((b, i) => (
              <tr key={i} className="border-b border-slate-100 last:border-0">
                <td className="px-3 py-2">
                  <input
                    className="input"
                    aria-label={`Grade letter row ${i + 1}`}
                    maxLength={4}
                    value={b.grade}
                    disabled={disabled}
                    onChange={(e) => update(i, { grade: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    aria-label={`Min score row ${i + 1}`}
                    value={b.minScore}
                    disabled={disabled}
                    onChange={(e) => update(i, { minScore: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step="any"
                    aria-label={`Max score row ${i + 1}`}
                    value={b.maxScore}
                    disabled={disabled}
                    onChange={(e) => update(i, { maxScore: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={10}
                    step="any"
                    aria-label={`Grade points row ${i + 1}`}
                    value={b.gradePoint}
                    disabled={disabled}
                    onChange={(e) => update(i, { gradePoint: e.target.value })}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    className="text-sm text-red-700 hover:underline disabled:text-slate-400"
                    disabled={disabled || bands.length <= 1}
                    onClick={() => onChange(bands.filter((_, j) => j !== i))}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
