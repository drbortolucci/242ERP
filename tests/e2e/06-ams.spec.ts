import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("gestora AMS abre, atende e resolve chamado com SLA; consulta saldos e base de conhecimento", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  await loginAs(page, "ams@demo.local");
  for (const url of ["/app/ams/chamados", "/app/ams/chamados?status=ALL", "/app/ams/saldos", "/app/ams/conhecimento"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/app/ams/chamados");
  await page.locator('select[name="partyId"]').selectOption({ label: "Beta" });
  await page.locator('input[name="title"]').fill("Erro E2E na baixa de títulos");
  await page.locator('textarea[name="description"]').fill("A baixa automática retorna erro de conta não encontrada.");
  await page.locator('select[name="impact"]').selectOption("1");
  await page.locator('select[name="urgency"]').selectOption("1");
  await page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(page.getByRole("heading", { name: /Erro E2E na baixa de títulos/ })).toBeVisible();
  await expect(page.getByText("P1", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Prazo consumido")).toBeVisible();

  await page.locator('textarea[name="body"]').fill("Analisando o lançamento com erro.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Analisando o lançamento com erro.")).toBeVisible();
  await page.getByRole("button", { name: "Iniciar atendimento" }).click();
  await expect(page.getByText("Em andamento").first()).toBeVisible();
  await page.getByRole("button", { name: "Resolver" }).first().click();
  await expect(page.getByText("Resolvido").first()).toBeVisible();

  await page.goto("/app/ams/saldos");
  await page.getByRole("row", { name: /Sustentação AMS/ }).getByRole("link").first().click();
  await expect(page.getByText("Evolução mensal (horas)")).toBeVisible();
  await expect(page.getByText("Créditos e saldos (FIFO por vencimento)")).toBeVisible();

  await page.goto("/app/ams/conhecimento?q=bloqueio");
  await expect(page.getByRole("row", { name: /desbloquear usuário/ })).toBeVisible();
  expect(errors).toEqual([]);
});
