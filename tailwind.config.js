/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: '#b20155',
        'card': '#fff',
        'card-foreground': '#3e3832',
        muted: '#3e3832',
        'muted-foreground': 'rgba(62, 56, 50, 0.7)',
        input: 'rgba(62, 56, 50, 0.2)',
        border: 'rgba(62, 56, 50, 0.2)',
        ring: '#b20155',
        foreground: '#3e3832',
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
