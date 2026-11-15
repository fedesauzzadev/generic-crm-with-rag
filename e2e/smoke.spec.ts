import { expect, test } from "@playwright/test";

// Smoke E2E (S11 / D-012, cierra F-03): UNA corrida lineal del flujo de demo
// completo, contra los servers que scripts/smoke.mjs levanta en :5199 (SPA)
// con la DB reseteada al seed determinista y el server SIN CRM_LLM_API_KEY.
// Asserts específicos por paso — nada de text() vagos.

test("login → dashboard → deal detail → degraded chat → i18n toggle", async ({ page }) => {
  // 1) Login demo: sin contraseña, cualquier nombre entra (H-03).
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await page.getByPlaceholder("Tu nombre (opcional)").fill("Smoke Bot");
  await page.getByRole("button", { name: "Entrar" }).click();
  // Sidebar con el actor de la sesión (cookie firmada, D-006).
  await expect(page.locator("aside").getByTitle("Smoke Bot")).toHaveText("Smoke Bot");

  // 2) Dashboard (H-06): KPIs visibles — win rate del seed = 3 ganados /
  // 2 perdidos = "60%" (winRateLabel, nunca NaN). ES default en contexto limpio.
  await page.locator("aside").getByRole("link", { name: "Panel", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Panel de métricas" })).toBeVisible();
  await expect(page.getByText("Tasa de éxito", { exact: true })).toBeVisible();
  await expect(page.getByText("60%", { exact: true })).toBeVisible();
  await expect(page.getByText("Valor del pipeline", { exact: true })).toBeVisible();
  await expect(page.getByText("Valor por etapa", { exact: true })).toBeVisible();

  // 3) Deals: abrir un deal del seed. Regresión F-01 para siempre: el
  // subtítulo del detalle debe traer company_name poblada (GET /:id joinea).
  await page.locator("aside").getByRole("link", { name: "Negocios", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Negocios" })).toBeVisible();
  const firstDeal = page.locator("main a[href^='/deals/']").first();
  await firstDeal.click();
  await expect(page).toHaveURL(/\/deals\/.+$/);
  // "{company_name} · responsable {owner} [· contacto {name}]"
  await expect(page.locator("h1 + p.text-sm")).toContainText(/^.+ · responsable .+$/);

  // 4) Ambos historiales presentes (stage N-0002 / monto N-0010) con al
  // menos el evento de creación del seed ("Negocio creado en …").
  await expect(page.getByRole("heading", { name: /Historial de etapas/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Historial de montos/ })).toBeVisible();
  await expect(page.getByText(/Negocio creado en /).first()).toBeVisible();

  // 5) Chat SIN key (AC5 H-05): respuesta degradada honesta — banner ámbar
  // "IA no configurada" que nombra la variable y cómo activarla. El server
  // del smoke corre con CRM_LLM_API_KEY="" (vacía pisa el .env real).
  await page.locator("aside").getByRole("link", { name: "Chat IA", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Chat IA" })).toBeVisible();
  await page.getByPlaceholder("Escribí tu pregunta… (Enter para enviar)").fill("¿Cuántos negocios hay?");
  await page.getByRole("button", { name: "Enviar" }).click();
  const degraded = page.locator(".border-amber-300");
  await expect(degraded).toBeVisible();
  await expect(degraded.getByText("IA no configurada")).toBeVisible();
  await expect(degraded.getByText(/CRM_LLM_API_KEY/)).toBeVisible();

  // El CRM sigue 100% operativo tras la degradación (AC5).
  await page.locator("aside").getByRole("link", { name: "Negocios", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Negocios" })).toBeVisible();

  // 6) i18n (N-0005): toggle a EN cambia el sidebar EN vivo.
  await page.locator("aside").getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("aside").getByRole("link", { name: "Dashboard", exact: true })).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: "Deals", exact: true })).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: "AI Chat", exact: true })).toBeVisible();
  await expect(page.locator("aside").getByRole("link", { name: "Negocios", exact: true })).toHaveCount(0);
});
