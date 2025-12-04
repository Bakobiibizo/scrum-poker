/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        poker: {
          green: "#1a472a",
          felt: "#2d5a3f",
          gold: "#d4af37",
          chip: {
            red: "#c41e3a",
            blue: "#1e90ff",
            green: "#228b22",
            black: "#1a1a1a",
            white: "#f5f5f5",
          },
        },
      },
      animation: {
        "chip-flip": "chip-flip 0.6s ease-in-out",
        "chip-stack": "chip-stack 0.3s ease-out",
      },
      keyframes: {
        "chip-flip": {
          "0%": { transform: "rotateY(0deg)" },
          "50%": { transform: "rotateY(90deg)" },
          "100%": { transform: "rotateY(0deg)" },
        },
        "chip-stack": {
          "0%": { transform: "translateY(-20px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
    },
  },
  plugins: [],
};
