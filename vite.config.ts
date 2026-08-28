import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // Required for Tauri production builds: assets must be served with relative
  // paths because the app runs under tauri://localhost, not http://127.0.0.1
  base: "./",
  // Ensure VITE_* env vars are statically inlined into the production bundle
  envPrefix: ["VITE_"],
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
  },
  build: {
    // Tauri expects ES modules
    target: "esnext",
    // Don't minify for easier debugging; toggle to true for final release
    minify: true,
  },
});
