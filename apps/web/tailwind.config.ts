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
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
