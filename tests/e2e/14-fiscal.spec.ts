import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("fiscal: regras com validação do responsável e documentos com rejeição reprocessável", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  page.on("dialog", (d) => d.accept());
  await loginAs(page, "fiscal@demo.local");
  await page.goto("/app/fiscal/regras");
  await expect(page.getByRole("heading", { name: /Regras fiscais de produtos/ })).toBeVisible();
  await expect(page.getByText(/não define classificação fiscal/)).toBeVisible();
  const pending = page.getByRole("row", { name: /aguarda validação/ });
  await expect(pending).toHaveCount(1);
  await pending.getByLabel("Responsável fiscal").fill("Responsável de teste E2E");
  await pending.getByRole("button", { name: "Validar" }).click();
  await expect(page.getByRole("row", { name: /aguarda validação/ })).toHaveCount(0);

  await page.goto("/app/fiscal/documentos");
  await expect(page.getByRole("heading", { name: "Documentos fiscais" })).toBeVisible();
  await expect(page.getByText(/Itens sem NCM ou CFOP/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Reprocessar" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});
