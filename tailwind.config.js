/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef7f4', 100: '#d5ece4', 200: '#aad9c9', 300: '#78bfa9', 400: '#4aa189',
          500: '#2f8570', 600: '#256b5b', 700: '#1f5649', 800: '#1b453b', 900: '#173a32',
        },
        canvas: { DEFAULT: '#f4f5f3', dark: '#0e1412' },
        'surface-dark': '#161e1b',
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
