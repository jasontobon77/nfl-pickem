/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './lib/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        field: '#0e2119',
        fieldLine: '#1c3a2c',
        panel: '#14291f',
        panelRaised: '#1a3327',
        chalk: '#edefe9',
        chalkDim: '#a9b6ac',
        hashGold: '#e3b23c',
        win: '#5fa987',
        loss: '#c1554a',
      },
      fontFamily: {
        display: ['var(--font-display)', 'sans-serif'],
        body: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
    },
  },
  plugins: [],
};
