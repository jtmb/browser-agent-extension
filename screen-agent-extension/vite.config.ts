import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

/**
 * Vite config for the Screen Agent side panel.
 * Builds the React app into the extension's sidepanel/ directory
 * so manifest.json can reference it directly.
 */
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src/sidepanel"),
  // Relative base so assets resolve correctly inside a Chrome extension
  // (e.g. "./sidepanel.js" instead of "/sidepanel.js")
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "sidepanel"),
    emptyOutDir: true,
    // Single JS bundle + CSS — extension side panels load locally, no chunk-splitting needed
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        entryFileNames: "sidepanel.js",
        assetFileNames: "sidepanel.[ext]",
      },
    },
  },
});
