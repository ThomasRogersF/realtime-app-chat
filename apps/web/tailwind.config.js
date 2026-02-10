/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        muted: "var(--muted)",
        border: "var(--border)",
        primary: { DEFAULT: "var(--primary)", hover: "var(--primary-hover)" },
        secondary: { DEFAULT: "var(--secondary)", hover: "var(--secondary-hover)" },
        accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)" },
        danger: { DEFAULT: "var(--danger)", hover: "var(--danger-hover)" },
        warning: "var(--warning)",
      },
    },
  },
  plugins: [],
};
