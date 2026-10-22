import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    rollupOptions: {
      output: {
        manualChunks: { math: ["katex"], content: ["marked", "dompurify"] },
      },
    },
  },
  test: { environment: "jsdom", setupFiles: ["./tests/setup.ts"] },
} as any);
