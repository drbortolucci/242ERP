import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("financeiro: cobrança bancária simulada é baixada e liquida o título; conciliação automática", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  page.on("dialog", (d) => d.accept());
  await loginAs(page, "financeiro@demo.local");
  await page.goto("/app/financeiro/cobrancas-bancarias");
  await expect(page.getByRole("heading", { name: "Cobranças bancárias" })).toBeVisible();
  await expect(page.getByText(/Ambiente simulado/)).toBeVisible();
  await page.getByRole("row", { name: /Registrada/ }).getByRole("link").first().click();
  await expect(page.getByText(/Linha digitável|PIX copia e cola/)).toBeVisible();
  await expect(page.getByText(/não pagável/).first()).toBeVisible();
  await page.getByRole("button", { name: "Simular pagamento" }).click();
  // a cobrança passa a "Pago" e o título fica liquidado (liquidação registrada na conta da cobrança)
  await expect(page.getByRole("row", { name: /BOL-\d+.*Pago/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Simular pagamento" })).toHaveCount(0);

  await page.goto("/app/financeiro/conciliacao");
  await expect(page.getByRole("heading", { name: "Conciliação automática" })).toBeVisible();
  await expect(page.getByText(/Tarifas bancárias/)).toBeVisible();
  await page.getByRole("button", { name: "Conciliar automaticamente" }).click();
  await expect(page.getByText(/Conciliação automática: \d+ por valor\/data/)).toBeVisible();
  expect(errors).toEqual([]);
});
