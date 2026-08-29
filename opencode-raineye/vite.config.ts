import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  root: "src/webview",
  base: "./",
  plugins: [react()],
  build: {
    outDir: "../../dist/webview",
    emptyOutDir: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: "app.js",
        assetFileNames: "app[extname]",
        chunkFileNames: "[name].js",
      },
    },
  },
})
