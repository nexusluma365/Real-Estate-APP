/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#263750', 900: '#1B2739', 800: '#212F45', 700: '#263750', 600: '#34496A', 100: '#E6EAF0' },
        gold: { DEFAULT: '#D0B080', 600: '#B8975F', 700: '#9E7F4C', 100: '#F5EEE2' },
        charcoal: '#30343A',
        stone: { DEFAULT: '#E9E6E1', 300: '#D8D3CB', 500: '#8C877F' },
        offwhite: '#F3F5F8',
        mist: '#E9EDF3',
      },
      fontFamily: {
        sans: ['Manrope', 'Manrope Fallback', 'Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 30px -12px rgba(38, 55, 80, 0.18), 0 2px 6px -2px rgba(38, 55, 80, 0.06)',
        lift: '0 22px 45px -18px rgba(38, 55, 80, 0.30), 0 4px 10px -4px rgba(38, 55, 80, 0.08)',
        btn: '0 6px 16px -8px rgba(158, 127, 76, 0.55)',
        float: '0 40px 80px -32px rgba(27, 39, 57, 0.35), 0 12px 28px -14px rgba(27, 39, 57, 0.14)',
        pill: '0 12px 26px -12px rgba(27, 39, 57, 0.65)',
      },
      maxWidth: { site: '1180px' },
      transitionTimingFunction: { lux: 'cubic-bezier(0.22, 0.61, 0.36, 1)' },
    },
  },
  plugins: [],
};
