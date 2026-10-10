import { test, expect } from "@playwright/test";

test("agência escolhe o setor no cadastro e a terminologia segue o setor e as personalizações", async ({ page }) => {
  const suffix = Date.now().toString(36);
  await page.goto("/cadastro");
  await page.getByLabel("Nome da organização (sua empresa)").fill(`Agência E2E ${suffix}`);
  await page.getByLabel("Setor de atividade").selectOption("AGENCY");
  await page.getByLabel("Seu nome").fill("Pessoa da Agência");
  await page.getByLabel("E-mail").fill(`agencia-${suffix}@exemplo.com`);
  await page.getByLabel("Senha").fill("SenhaForte123");
  await page.getByText("Li e aceito").click();
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding/);

  const nav = page.getByRole("navigation", { name: "Módulos" }).last();
  await expect(nav.getByRole("link", { name: "Jobs", exact: true })).toBeVisible();
  await expect(nav.getByText("Fee mensal")).toBeVisible();

  await page.goto("/app/config/setor");
  await expect(page.getByText("Setor atual: Agências de marketing, comunicação e design")).toBeVisible();
  await page.getByLabel("Projetos (plural)").fill("Campanhas");
  await page.getByRole("button", { name: "Salvar terminologia" }).click();
  await expect(nav.getByRole("link", { name: "Campanhas", exact: true })).toBeVisible();

  await page.goto("/app/projetos");
  await expect(page.getByRole("heading", { name: "Campanhas" })).toBeVisible();
});
