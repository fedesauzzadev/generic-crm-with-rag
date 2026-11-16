import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { bootstrapDatabase } from "./db.js";
import { registerSpa } from "./static.js";

// Carga .env de la raíz del proyecto (documentado en README §Assistant) antes de leer process.env.
// shortcut: solo 2 ubicaciones fijas (raíz y cwd); si algún día hay envs por workspace, migrar a dotenv flows.
for (const envPath of [new URL("../../.env", import.meta.url), new URL(".env", import.meta.url)]) {
  try {
    process.loadEnvFile(envPath);
    break;
  } catch {
    /* archivo ausente o sin permiso: seguimos con el entorno del proceso */
  }
}

// Bootstrap (AC H-01): abrir DB → migrar → seedear si vacía → escuchar.
const db = bootstrapDatabase();
const app = createApp(db);
// SPA compilada (Docker/build): sirve admin/dist desde public/ si existe.
registerSpa(app as never);
const port = Number(process.env.PORT) || 8787;

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[server] Generic CRM API listening on http://127.0.0.1:${info.port}`);
});
