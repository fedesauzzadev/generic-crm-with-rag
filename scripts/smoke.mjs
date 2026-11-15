#!/usr/bin/env node
// S11 (D-012): smoke E2E autocontenido — 1 comando, puertos propios, cleanup garantizado.
//
// Por qué no el `webServer` de Playwright: en Windows, Playwright mata el
// proceso que spawn-eó pero el árbol npm→node→tsx puede quedar huérfano.
// Este script guarda los PIDs y hace `taskkill /PID x /T /F` SIEMPRE, aun
// con specs rojas o timeout de readiness. Puertos propios (5173/5174 suelen
// estar ocupados por apps ajenas en la máquina de demo): API 8799, SPA 5199.

import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const API_PORT = 8799;
const SPA_PORT = 5199;
const READY_TIMEOUT_MS = 60_000; // arranque frío (migraciones + tsx + vite)

// Env del smoke: puertos propios + chat SIN key. `process.loadEnvFile` del
// server NO pisa vars ya presentes en el entorno (verificado, N-0011), así
// que ni una key real en .env puede activar el LLM dentro del smoke.
const smokeEnv = { ...process.env, PORT: String(API_PORT), CRM_LLM_API_KEY: "" };

function run(cmd, opts = {}) {
  // Comando como string único (Node 24: args array + shell tira DEP0190).
  // Los comandos son fijos de este script — cero input externo que escapar.
  return spawnSync(cmd, { cwd: ROOT, env: smokeEnv, shell: true, encoding: "utf8", ...opts });
}

async function assertPortFree(port) {
  await new Promise((resolve, reject) => {
    const srv = createServer();
    srv.once("error", (err) => reject(new Error(`puerto ${port} ocupado (${err.code}) — libéralo o cambiá el puerto en scripts/smoke.mjs`)));
    srv.listen(port, "127.0.0.1", () => srv.close(resolve));
  });
}

// 1) DB determinista: el smoke aserte cifras del seed (win rate 60%, 16 deals).
const reset = run("npm run reset --workspace server");
process.stdout.write(reset.stdout ?? "");
process.stderr.write(reset.stderr ?? "");
if (reset.status !== 0) {
  console.error("[smoke] npm run reset falló — abortando antes de levantar nada");
  process.exit(1);
}

const procs = [];
function start(name, cmd) {
  const child = spawn(cmd, { cwd: ROOT, env: smokeEnv, shell: true, stdio: ["ignore", "pipe", "pipe"] });
  const tag = (chunk) =>
    String(chunk)
      .split("\n")
      .filter(Boolean)
      .map((line) => `[${name}] ${line}\n`)
      .join("");
  child.stdout.on("data", (d) => process.stdout.write(tag(d)));
  child.stderr.on("data", (d) => process.stderr.write(tag(d)));
  procs.push(child);
  console.log(`[smoke] ${name} levantado (pid ${child.pid})`);
  return child;
}

async function waitReady(name, url) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  for (;;) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      /* todavía no escucha */
    }
    if (Date.now() > deadline) throw new Error(`${name} no respondió ${url} en ${READY_TIMEOUT_MS} ms`);
    await delay(300);
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  console.log(`[smoke] matando árbol del pid ${child.pid}`);
  if (process.platform === "win32") spawnSync(`taskkill /PID ${child.pid} /T /F`, { shell: true });
  else child.kill("SIGTERM");
}

let exitCode = 1;
try {
  await assertPortFree(API_PORT);
  await assertPortFree(SPA_PORT);
  start("api", "npm run dev --workspace server");
  start("spa", `npm run dev --workspace admin -- --port ${SPA_PORT} --strictPort --host 127.0.0.1`);
  await waitReady("api", `http://127.0.0.1:${API_PORT}/api/ping`);
  await waitReady("spa", `http://127.0.0.1:${SPA_PORT}/`);
  console.log("[smoke] server + SPA listos — corriendo Playwright");
  const pw = run("npx playwright test", { stdio: "inherit" });
  exitCode = pw.status ?? 1;
} catch (err) {
  console.error(`[smoke] ${err instanceof Error ? err.message : String(err)}`);
} finally {
  for (const p of procs) killTree(p);
}
process.exit(exitCode);
