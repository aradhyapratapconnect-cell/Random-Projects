/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        kyc: {
          50: '#eefcff',
          100: '#d7f7ff',
          200: '#b3efff',
          300: '#7be4ff',
          400: '#36d3ff',
          500: '#0dbcff',
          600: '#0095eb',
          700: '#0076bd',
          800: '#08639a',
          900: '#0d537e',
          950: '#063552',
        },
        void: {
          900: '#05070d',
          950: '#020409',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float-slow': 'float-slow 8s ease-in-out infinite',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { opacity: '0.4', transform: 'scale(1)' },
          '50%': { opacity: '0.9', transform: 'scale(1.08)' },
        },
        'float-slow': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
      },
    },
  },
  plugins: [],
};
