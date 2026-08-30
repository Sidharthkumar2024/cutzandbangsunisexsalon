import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.cutzandbangs.salon",
  appName: "Cutz & Bangs",
  webDir: "public",
  server: {
    url: process.env.CAPACITOR_SERVER_URL ?? "https://cutzandbangs.com",
    cleartext: false,
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#faf7f5",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
    StatusBar: {
      style: "LIGHT",
      backgroundColor: "#6b2d2f",
    },
  },
};

export default config;
