/** @type {import('tailwindcss').Config} */

// The look lives in CSS variables (see the theme tokens at the top of
// src/index.css). The palettes the UI leans on are routed through them, so a
// recolour is an edit there rather than a hunt through every component:
//   slate -> --neutral-*  (panels, borders, body text)
//   cyan  -> --corp-*     (Corp side, primary accent)
//   pink  -> --runner-*   (Runner side, danger/run actions)
//   amber -> --signal-*   (highlights, credits, warnings)
// Faction colours (violet, red, emerald, orange, blue, lime) keep Tailwind's
// defaults so they stay recognisable.
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const scale = name =>
  Object.fromEntries(SHADES.map(s => [s, `rgb(var(--${name}-${s}) / <alpha-value>)`]));
const token = name => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // Angular: corners are clipped or near-square; only rounded-full (pips, dots) stays round
    borderRadius: {
      none: '0',
      sm: '1px',
      DEFAULT: '2px',
      md: '2px',
      lg: '2px',
      xl: '3px',
      '2xl': '3px',
      '3xl': '4px',
      full: '9999px',
    },
    extend: {
      colors: {
        slate: scale('neutral'),
        cyan: scale('corp'),
        pink: scale('runner'),
        amber: scale('signal'),
        cyber: {
          dark: token('bg'),
          darker: token('bg-deep'),
          card: token('surface'),
          border: token('line'),
          neonCyan: token('corp-400'),
          neonPink: token('runner-500'),
          neonYellow: token('signal-400'),
          credit: token('signal-400'),
          click: token('runner-500'),
          corp: token('corp-400'),
          runner: token('runner-500'),
          terminal: token('terminal'),
        }
      },
      fontFamily: {
        mono: ['"Share Tech Mono"', '"Courier New"', 'monospace'],
        cyber: ['Orbitron', 'sans-serif'],
      }
    },
  },
  plugins: [],
}
