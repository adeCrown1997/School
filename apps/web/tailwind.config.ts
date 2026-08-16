import type { Config } from 'tailwindcss';

/**
 * Tailwind design tokens for the ePortal. A small, deliberate palette keyed to a
 * university brand colour so the UI is consistent and accessible (contrast-safe
 * text pairings). Extended tokens are referenced by the component primitives in
 * app/(components).
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          100: '#d9e6ff',
          200: '#bcd3ff',
          300: '#8db6ff',
          400: '#578dff',
          500: '#2f66f0',
          600: '#1f4bd6',
          700: '#1c3cac',
          800: '#1d3688',
          900: '#1d316d',
        },
        // The sidebar/header use a deep navy independent of brand-900 so the
        // dark chrome keeps its identity if the brand hue is ever re-themed.
        navy: {
          700: '#243263',
          800: '#1b2649',
          900: '#131c38',
          950: '#0d1428',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'var(--font-sans)', 'system-ui', 'sans-serif'],
      },
      /** Soft, layered elevation — cards sit ON the page rather than being
       *  outlined boxes; interactive elements lift slightly on hover. */
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.05), 0 1px 3px 0 rgb(16 24 40 / 0.08)',
        'card-hover': '0 4px 8px -2px rgb(16 24 40 / 0.08), 0 2px 6px -2px rgb(16 24 40 / 0.06)',
        lift: '0 12px 24px -6px rgb(16 24 40 / 0.14), 0 4px 8px -4px rgb(16 24 40 / 0.06)',
        focus: '0 0 0 4px var(--ring-brand)',
      },
      maxWidth: {
        page: '80rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'scale-in': {
          '0%': { opacity: '0', transform: 'scale(0.97)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'fade-in': 'fade-in 0.25s ease-out both',
        'scale-in': 'scale-in 0.2s cubic-bezier(0.22, 1, 0.36, 1) both',
        shimmer: 'shimmer 1.6s linear infinite',
      },
    },
  },
  plugins: [],
};

export default config;
