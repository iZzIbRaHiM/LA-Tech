/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        border: "#3F3F46",
        input: "#3F3F46",
        ring: "#DFE104",
        background: "#09090B",
        foreground: "#FAFAFA",
        primary: {
          DEFAULT: "#DFE104",
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "#27272A",
          foreground: "#FAFAFA",
        },
        destructive: {
          DEFAULT: "#EF4444",
          foreground: "#FAFAFA",
        },
        muted: {
          DEFAULT: "#27272A",
          foreground: "#A1A1AA",
        },
        accent: {
          DEFAULT: "#DFE104",
          foreground: "#000000",
        },
        popover: {
          DEFAULT: "#09090B",
          foreground: "#FAFAFA",
        },
        card: {
          DEFAULT: "#09090B",
          foreground: "#FAFAFA",
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'sans-serif'],
        body: ['"Inter"', 'sans-serif'],
      },
      borderRadius: {
        xl: "0px",
        lg: "0px",
        md: "0px",
        sm: "0px",
        xs: "0px",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "marquee": {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "pulse-opacity": {
          "0%, 100%": { opacity: "0.3" },
          "50%": { opacity: "0.8" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "marquee": "marquee 20s linear infinite",
        "pulse-opacity": "pulse-opacity 2s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
