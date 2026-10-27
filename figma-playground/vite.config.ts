import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Solo en esta máquina: los diseños son privados
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
