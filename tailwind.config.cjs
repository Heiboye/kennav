/** @type {import('tailwindcss').Config} */
module.exports = {
  // 深色模式通过 .dark class 切换（与 index.html body class 一致）
  darkMode: 'class',
  content: [
    './index.html',
    './index.tsx',
    './App.tsx',
    './components/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    './types.ts',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#3b82f6',
        secondary: '#64748b',
        dark: '#0f172a',
        card: '#1e293b',
      },
    },
  },
  plugins: [],
};
