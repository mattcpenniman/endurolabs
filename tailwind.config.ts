import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // EnduroLab brand palette
        enduro: {
          50: "#f0f7f4",
          100: "#d9ede1",
          200: "#b8dfc7",
          300: "#8ecfa6",
          400: "#62bb84",
          500: "#3da16a",
          600: "#2b8456",
          700: "#246b48",
          800: "#20553b",
          900: "#1c4732",
          950: "#0d291d",
        },
        // Intensity colors for workout types
        intensity: {
          easy: "#22c55e",
          recovery: "#86efac",
          threshold: "#f59e0b",
          marathon: "#3b82f6",
          vo2: "#ef4444",
          long: "#8b5cf6",
          strength: "#ec4899",
          rest: "#9ca3af",
        },
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
