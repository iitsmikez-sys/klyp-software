import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#060608",
        surface: "#0d0d12",
        "surface-2": "#13131a",
        border: "#1e1e2a",
        accent: "#00E5A0",
        "accent-dim": "#00b87e",
        "accent-glow": "rgba(0, 229, 160, 0.15)",
        muted: "#5a5a72",
        subtle: "#3a3a4e",
        foreground: "#e8e8f0",
        "foreground-muted": "#9898b0",
      },
      fontFamily: {
        syne: ["var(--font-syne)", "sans-serif"],
        sans: ["var(--font-dm-sans)", "sans-serif"],
      },
      boxShadow: {
        "accent-glow": "0 0 24px rgba(0, 229, 160, 0.2)",
        "accent-glow-sm": "0 0 12px rgba(0, 229, 160, 0.15)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.4s ease-out",
      },
    },
  },
  plugins: [],
};
export default config;
