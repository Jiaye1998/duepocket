/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#162026",
        muted: "#647182",
        radar: {
          green: "#176f5d",
          greenSoft: "#dff2ec",
          blue: "#2f6fed",
          blueSoft: "#e4edff",
          coral: "#d65745",
          coralSoft: "#fde8e3",
          amber: "#a96800",
          amberSoft: "#fff1cf",
          violet: "#695bc7",
          violetSoft: "#ece9ff"
        }
      },
      boxShadow: {
        app: "0 18px 45px rgba(31, 45, 52, 0.10)"
      },
      borderRadius: {
        app: "8px"
      }
    }
  },
  plugins: []
};
