import { defineConfig } from "@playwright/test";

// Smoke E2E (S11 / D-012): determinista o nada — retries 0, 1 worker.
// Los servers NO se levantan acá: scripts/smoke.mjs los orquesta con puertos
// propios (SPA 5199 / API 8799), env sin key LLM y taskkill /T al final.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000, // generoso: primer render Vite + arranque frío
  retries: 0,
  workers: 1,
  reporter: [["list"], ["junit", { outputFile: "brain/evidence/smoke-junit.xml" }]],
  use: {
    baseURL: "http://127.0.0.1:5199",
    locale: "es-AR",
  },
});
