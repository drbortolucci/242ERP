import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("controladoria navega DRE, razão com origem, P&L de projeto, orçamentos, rateios e fechamento", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs(page, "controladoria@demo.local");
  for (const url of ["/app/controladoria/dre", "/app/controladoria/razao", "/app/controladoria/pl", "/app/controladoria/orcamentos", "/app/controladoria/rateios", "/app/controladoria/fechamento"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/app/controladoria/dre");
  await expect(page.getByText("= Margem de contribuição")).toBeVisible();
  await page.getByRole("link", { name: /Custo de profissionais internos alocados/ }).first().click();
  await expect(page.getByRole("heading", { name: "Razão gerencial" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Horas" }).first()).toBeVisible();

  await page.goto("/app/controladoria/pl");
  await page.getByRole("row", { name: /Implantação SAP/ }).getByRole("link").first().click();
  await expect(page.getByText("Original (v1)")).toBeVisible();
  await expect(page.getByText("Previsto ao término")).toBeVisible();

  await page.goto("/app/controladoria/fechamento");
  await expect(page.getByText("Fechado", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Reabrir" }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("painel mostra blocos conforme o perfil e cada indicador leva à origem", async ({ page }) => {
  await loginAs(page, "diretor@demo.local");
  await page.goto("/app");
  for (const t of ["Resultado (gerencial)", "Caixa e títulos", "Comercial", "Projetos"]) await expect(page.getByRole("heading", { name: t })).toBeVisible();
  await page.getByRole("link", { name: /A receber vencido/ }).click();
  await expect(page.getByRole("heading", { name: "Contas a receber" })).toBeVisible();
  await page.goto("/login");
  await loginAs(page, "consultor@demo.local");
  await page.goto("/app");
  await expect(page.getByRole("heading", { name: "Minha semana" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Resultado (gerencial)" })).toHaveCount(0);
});
