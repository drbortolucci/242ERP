import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("financeiro mede pendências, consulta cobrança, recebe título e acompanha tesouraria", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await loginAs(page, "financeiro@demo.local");
  for (const url of ["/app/faturamento/pendencias", "/app/faturamento/medicoes", "/app/faturamento/cobrancas", "/app/financeiro/receber", "/app/financeiro/pagar", "/app/financeiro/adiantamentos", "/app/financeiro/tesouraria", "/app/financeiro/conciliacao", "/app/financeiro/fluxo-caixa"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // gera medição a partir das pendências e envia para aprovação (quem mede não aprova)
  await page.goto("/app/faturamento/pendencias");
  await page.getByRole("button", { name: "Gerar medição com todos os itens" }).first().click();
  await expect(page.getByRole("heading", { name: /^Medição MED-/ })).toBeVisible();
  await page.getByRole("button", { name: "Enviar para aprovação" }).click();
  await expect(page.getByText("Aguardando aprovação").first()).toBeVisible();

  // documento de cobrança: rótulo de documento interno e títulos
  await page.goto("/app/faturamento/cobrancas");
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  await expect(page.getByText("Retenções aplicadas")).toBeVisible();
  await expect(page.getByRole("link", { name: "PDF (documento interno)" })).toBeVisible();

  // recebimento parcial de um título em aberto
  await page.goto("/app/financeiro/receber");
  await page.getByRole("row").nth(1).getByRole("link").first().click();
  await page.locator('input[name="principal"]').fill("100");
  await page.locator('select[name="bankAccountId"]').selectOption({ index: 0 });
  await page.getByRole("button", { name: "Registrar recebimento" }).click();
  await expect(page.getByText("Liquidação registrada.")).toBeVisible();
  await expect(page.getByText("Parcial").first()).toBeVisible();
  expect(errors).toEqual([]);
});
