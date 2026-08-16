'use client';

/**
 * Animated illustration of the school's front gate: the two gate leaves swing
 * open on load and settle, with a soft sky/ground scene behind. Inline SVG so
 * the landing page carries zero binary assets, and the motion is CSS-only —
 * disabled entirely under prefers-reduced-motion (the gate renders open).
 */
export function SchoolGate({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 640 360"
      role="img"
      aria-label="Animated illustration of the school gate opening"
      className={className}
    >
      <defs>
        <linearGradient id="gate-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#dbeafe" />
          <stop offset="100%" stopColor="#eff6ff" />
        </linearGradient>
        <linearGradient id="gate-ground" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#86efac" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id="gate-path" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e7e5e4" />
          <stop offset="100%" stopColor="#d6d3d1" />
        </linearGradient>
      </defs>

      {/* sky */}
      <rect x="0" y="0" width="640" height="360" fill="url(#gate-sky)" rx="16" />

      {/* sun with a slow halo pulse */}
      <g className="gate-sun">
        <circle cx="548" cy="64" r="30" fill="#fcd34d" opacity="0.35" />
        <circle cx="548" cy="64" r="20" fill="#fbbf24" />
      </g>

      {/* drifting clouds */}
      <g className="gate-cloud gate-cloud-a" fill="#ffffff" opacity="0.9">
        <ellipse cx="120" cy="70" rx="42" ry="14" />
        <ellipse cx="150" cy="60" rx="30" ry="12" />
      </g>
      <g className="gate-cloud gate-cloud-b" fill="#ffffff" opacity="0.7">
        <ellipse cx="380" cy="46" rx="34" ry="11" />
        <ellipse cx="404" cy="38" rx="22" ry="9" />
      </g>

      {/* ground */}
      <rect x="0" y="252" width="640" height="108" fill="url(#gate-ground)" rx="16" />

      {/* the walkway through the gate */}
      <polygon points="286,252 354,252 428,360 212,360" fill="url(#gate-path)" />

      {/* flanking hedges */}
      <ellipse cx="150" cy="258" rx="58" ry="16" fill="#22c55e" />
      <ellipse cx="492" cy="258" rx="58" ry="16" fill="#22c55e" />

      {/* campus building glimpsed behind the open gate */}
      <g opacity="0.85">
        <rect x="262" y="150" width="116" height="102" fill="#e2e8f0" />
        <polygon points="254,150 320,112 386,150" fill="#1f4bd6" />
        <rect x="306" y="196" width="28" height="56" fill="#475569" />
        <rect x="272" y="168" width="20" height="20" fill="#bfdbfe" />
        <rect x="348" y="168" width="20" height="20" fill="#bfdbfe" />
        <rect x="316" y="118" width="8" height="20" fill="#64748b" />
        <polygon points="324,120 348,126 324,132" fill="#1f4bd6" />
      </g>

      {/* gate pillars */}
      <g>
        <rect x="216" y="128" width="34" height="124" fill="#94a3b8" />
        <rect x="212" y="118" width="42" height="14" rx="3" fill="#64748b" />
        <rect x="390" y="128" width="34" height="124" fill="#94a3b8" />
        <rect x="386" y="118" width="42" height="14" rx="3" fill="#64748b" />
        {/* plaque */}
        <rect x="222" y="146" width="22" height="34" rx="2" fill="#1c3cac" />
        <rect x="396" y="146" width="22" height="34" rx="2" fill="#1c3cac" />
      </g>

      {/* arch spanning the pillars */}
      <path d="M233 128 Q320 78 407 128" fill="none" stroke="#475569" strokeWidth="10" />
      <text
        x="320"
        y="106"
        textAnchor="middle"
        fontSize="17"
        fontWeight="700"
        fill="#1d316d"
        letterSpacing="3"
      >
        UNIVERSITY
      </text>

      {/* left gate leaf — swings open and settles (hinged at the left pillar) */}
      <g className="gate-leaf gate-leaf-left">
        <rect x="250" y="150" width="70" height="102" fill="none" stroke="#1d3688" strokeWidth="5" />
        <line x1="250" y1="175" x2="320" y2="175" stroke="#1d3688" strokeWidth="3" />
        <line x1="250" y1="201" x2="320" y2="201" stroke="#1d3688" strokeWidth="3" />
        <line x1="250" y1="227" x2="320" y2="227" stroke="#1d3688" strokeWidth="3" />
        <line x1="273" y1="150" x2="273" y2="252" stroke="#1d3688" strokeWidth="3" />
        <line x1="296" y1="150" x2="296" y2="252" stroke="#1d3688" strokeWidth="3" />
        <line x1="250" y1="252" x2="320" y2="150" stroke="#1f4bd6" strokeWidth="4" />
      </g>

      {/* right gate leaf — mirrored hinge at the right pillar */}
      <g className="gate-leaf gate-leaf-right">
        <rect x="320" y="150" width="70" height="102" fill="none" stroke="#1d3688" strokeWidth="5" />
        <line x1="320" y1="175" x2="390" y2="175" stroke="#1d3688" strokeWidth="3" />
        <line x1="320" y1="201" x2="390" y2="201" stroke="#1d3688" strokeWidth="3" />
        <line x1="320" y1="227" x2="390" y2="227" stroke="#1d3688" strokeWidth="3" />
        <line x1="344" y1="150" x2="344" y2="252" stroke="#1d3688" strokeWidth="3" />
        <line x1="367" y1="150" x2="367" y2="252" stroke="#1d3688" strokeWidth="3" />
        <line x1="390" y1="252" x2="320" y2="150" stroke="#1f4bd6" strokeWidth="4" />
      </g>

      {/* lamp posts framing the walkway */}
      <g fill="#334155">
        <rect x="196" y="268" width="6" height="52" />
        <circle cx="199" cy="262" r="7" fill="#fef08a" className="gate-lamp" />
        <rect x="438" y="268" width="6" height="52" />
        <circle cx="441" cy="262" r="7" fill="#fef08a" className="gate-lamp" />
      </g>
    </svg>
  );
}
