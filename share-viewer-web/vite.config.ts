import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // Собирается и раздаётся бэкендом под /share-app/*.
  base: "/share-app/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});