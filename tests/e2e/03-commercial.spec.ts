import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

const PAGES = ["/app/crm/leads", "/app/crm/oportunidades", "/app/crm/oportunidades?view=lista", "/app/crm/oportunidades?view=previsao", "/app/crm/oportunidades?view=parados", "/app/crm/atividades", "/app/propostas", "/app/pedidos", "/app/contratos"];

test("comercial navega no CRM, propostas e contratos", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  await loginAs(page, "comercial@demo.local");
  for (const url of PAGES) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // Abre um contrato e a visão 360 do cliente
  await page.goto("/app/contratos");
  await page.getByRole("link", { name: /CTR-/ }).first().click();
  await expect(page.getByText("Contratado").first()).toBeVisible();
  await page.goto("/app/cadastros/clientes");
  await page.getByRole("link", { name: /Indústria Alfa/ }).click();
  await expect(page.getByText("Visão 360° do cliente")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contratos" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("cria proposta a partir de oportunidade, calcula margem ao vivo e salva", async ({ page }) => {
  await loginAs(page, "comercial@demo.local");
  await page.goto("/app/crm/oportunidades?view=lista&status=OPEN");
  await page.getByRole("row", { name: /Diagnóstico de processos/ }).getByRole("link").first().click();
  await page.getByRole("button", { name: "Gerar proposta" }).click();
  await expect(page).toHaveURL(/\/app\/propostas\//);
  await page.getByRole("button", { name: "+ adicionar linha" }).click();
  const row = page.locator("tbody tr").last();
  await row.getByLabel("Descrição").fill("Consultor sênior");
  await row.getByLabel("Horas").fill("100");
  await row.getByLabel("Preço unitário").fill("250");
  await row.getByLabel("Custo unitário").fill("100");
  await expect(page.getByText("Receita líquida")).toBeVisible();
  await expect(page.locator("[aria-live=polite]")).toContainText("25.000,00");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await expect(page.getByText(/Rascunho salvo/)).toBeVisible();
  await page.getByRole("button", { name: "Submeter à aprovação" }).click();
  await expect(page.getByText(/Aprovada automaticamente|aprovação/i).first()).toBeVisible();
});
