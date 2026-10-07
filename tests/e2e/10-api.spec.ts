import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("administrador cria chave de API e integração consulta e abre chamado via HTTP", async ({ page, request }) => {
  await loginAs(page, "admin@demo.local");
  await page.goto("/app/admin/api");
  await page.getByLabel("Nome (ex.: Integração ITSM)").fill("Integração E2E");
  await page.getByLabel(/read:parties/).check();
  await page.getByLabel(/write:tickets/).check();
  await page.getByRole("button", { name: "Criar chave" }).click();
  const msg = await page.getByText(/Chave criada/).textContent();
  const key = /(erp_[0-9a-f]{8}_[A-Za-z0-9_-]+)/.exec(msg ?? "")?.[1];
  expect(key).toBeTruthy();
  const auth = { Authorization: `Bearer ${key}` };
  expect((await request.get("/api/v1/clientes")).status()).toBe(401);
  const list = await request.get("/api/v1/clientes?limit=5", { headers: auth });
  expect(list.status()).toBe(200);
  const body = await list.json();
  expect(body.data.length).toBeGreaterThan(0);
  expect((await request.get("/api/v1/titulos-receber", { headers: auth })).status()).toBe(403);
  const partyId = body.data.find((p: { name: string }) => /Beta/.test(p.name))?.id ?? body.data[0].id;
  const created = await request.post("/api/v1/chamados", { headers: auth, data: { partyId, title: "Chamado via API (E2E)", description: "Aberto pela integração de monitoramento", impact: 2, urgency: 2, type: "INCIDENT" } });
  expect(created.status()).toBe(201);
  expect((await created.json()).priority).toBe("P3");
});
