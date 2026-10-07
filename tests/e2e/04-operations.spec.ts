import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("gestor navega por projetos, portfólio, recursos, horas e despesas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  await loginAs(page, "pmo@demo.local");
  for (const url of ["/app/projetos", "/app/projetos/portfolio", "/app/recursos", "/app/recursos?visao=mensal", "/app/horas", "/app/horas/aprovacao", "/app/despesas", "/app/minha-area"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/app/projetos");
  await page.getByRole("row", { name: /Implantação SAP FI\/SD/ }).getByRole("link").first().click();
  for (const tab of ["Escopo e cronograma", "Equipe e recursos", "Riscos, problemas e decisões", "Relatórios de status", "Linha de base", "Estimativa e previsão", "Compras, despesas e faturamento", "Encerramento"]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.getByRole("tab", { name: "Escopo e cronograma" }).click();
  await page.getByRole("tab", { name: "Cronograma (Gantt)" }).click();
  await expect(page.getByText("Linha vermelha: hoje")).toBeVisible();
  expect(errors).toEqual([]);
});

test("consultor aponta horas e envia para aprovação", async ({ page }) => {
  await loginAs(page, "elisa@demo.local");
  await page.goto("/app/horas");
  await page.getByLabel("Horas").fill("2");
  const opt = await page.getByLabel("Projeto", { exact: true }).locator("option", { hasText: "Alocação de consultora" }).first().getAttribute("value");
  await page.getByLabel("Projeto", { exact: true }).selectOption(opt!);
  await page.getByLabel("Descrição").fill("Reunião de alinhamento E2E");
  await page.getByRole("button", { name: "Registrar" }).click();
  await expect(page.getByText(/registrado como rascunho|excede o máximo/)).toBeVisible();
});
