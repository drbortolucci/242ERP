import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("contabilidade: plano, diário, balancete e balanço fecham; lançamento manual balanceado", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  await loginAs(page, "contador@demo.local");
  for (const url of ["/app/contabilidade/plano", "/app/contabilidade/lancamentos", "/app/contabilidade/balancete", "/app/contabilidade/balanco", "/app/contabilidade/dre", "/app/contabilidade/razao"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/app/contabilidade/balancete?de=2000-01-01");
  await expect(page.getByText(/não fecham/)).toHaveCount(0);
  await page.goto("/app/contabilidade/balanco");
  await expect(page.getByText(/Ativo diferente de passivo/)).toHaveCount(0);

  await page.goto("/app/contabilidade/lancamentos");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Registrar lançamento" }) });
  await form.getByRole("combobox", { name: /^Empresa/ }).selectOption({ label: "Demo Consultoria" });
  await form.getByLabel("Histórico", { exact: false }).first().fill("Integralização de capital (E2E)");
  await form.getByLabel("Conta").nth(0).selectOption({ label: "1.1.1.01 Caixa" });
  await form.getByLabel("Débito").nth(0).fill("1000");
  await form.getByLabel("Conta").nth(1).selectOption({ label: "2.3.1 Capital social" });
  await form.getByLabel("Crédito").nth(1).fill("1000");
  await form.getByRole("button", { name: "Registrar lançamento" }).click();
  await expect(page.getByText("Integralização de capital (E2E)")).toBeVisible();
  expect(errors).toEqual([]);
});
