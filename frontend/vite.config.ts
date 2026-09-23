import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "../public",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ["/conversations", "/chat", "/upload", "/models", "/usage"].map(
        (path) => [path, "http://127.0.0.1:8000"],
      ),
    ),
  },
});
