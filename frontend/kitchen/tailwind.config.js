/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
            colors: {
        slate: {
          850: '#172033',
          750: '#27354a',
          350: '#cbd5e1'
        },
        rose: {
          450: '#f73b5f'
        },
        indigo: {
          650: '#4a44e4'
        }
      },
      spacing: {
        4.5: '1.125rem'
      }
    },
  },
  plugins: [],
}