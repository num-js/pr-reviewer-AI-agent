/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      colors: {
        ink: "var(--ink)",
        muted: "var(--muted)",
        surface: "var(--surface)",
        elevated: "var(--surface-elevated)",
        accent: "var(--accent)",
        warn: "var(--warn)",
        danger: "var(--danger)",
        glow: "var(--glow)",
        line: "var(--line)",
      },
      boxShadow: {
        glow: "0 0 0 1px color-mix(in oklab, var(--glow) 35%, transparent), 0 0 32px color-mix(in oklab, var(--glow) 18%, transparent)",
        panel:
          "0 18px 50px -24px rgb(0 0 0 / 0.65), inset 0 1px 0 rgb(255 255 255 / 0.04)",
      },
      transitionTimingFunction: {
        outExpo: "cubic-bezier(0.16, 1, 0.3, 1)",
        outQuart: "cubic-bezier(0.25, 1, 0.5, 1)",
      },
      keyframes: {
        fadeUp: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        pulseSoft: {
          "0%, 100%": { opacity: "1", boxShadow: "0 0 0 0 color-mix(in oklab, var(--accent) 0%, transparent)" },
          "50%": {
            opacity: "0.92",
            boxShadow:
              "0 0 0 6px color-mix(in oklab, var(--accent) 12%, transparent)",
          },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        successPop: {
          "0%": { opacity: "0", transform: "scale(0.92)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        checkDraw: {
          "0%": { strokeDashoffset: "16" },
          "100%": { strokeDashoffset: "0" },
        },
      },
      animation: {
        "fade-up": "fadeUp 220ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fadeIn 200ms cubic-bezier(0.25, 1, 0.5, 1) both",
        "pulse-soft": "pulseSoft 1.4s ease-in-out infinite",
        shimmer: "shimmer 1.6s linear infinite",
        "success-pop": "successPop 280ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "check-draw": "checkDraw 320ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
