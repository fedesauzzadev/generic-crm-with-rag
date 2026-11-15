import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      // Same-origin: la SPA llama a /api/* y Vite lo deriva al server local.
      // Sigue PORT (mismo default 8787 que el server) — así el smoke E2E
      // corre en su puerto propio (8799) sin tocar esta config.
      "/api": `http://127.0.0.1:${process.env.PORT ?? 8787}`,
    },
  },
});
