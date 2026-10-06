import { test, expect } from "@playwright/test";

test("cria organização, entra e configura a empresa no onboarding", async ({ page }) => {
  const suffix = Date.now().toString(36);
  await page.goto("/cadastro");
  await page.getByLabel("Nome da organização (sua consultoria)").fill(`Consultoria E2E ${suffix}`);
  await page.getByLabel("Seu nome").fill("Pessoa Teste");
  await page.getByLabel("E-mail").fill(`e2e-${suffix}@exemplo.com`);
  await page.getByLabel("Senha").fill("SenhaForte123");
  await page.getByText("Li e aceito").click();
  await page.getByRole("button", { name: "Criar organização" }).click();
  await expect(page).toHaveURL(/\/app\/onboarding/);

  // CNPJ inválido é recusado no servidor
  await page.getByLabel("Razão social").fill("Consultoria E2E Ltda");
  await page.getByLabel("CNPJ").fill("11.222.333/0001-82");
  await page.getByRole("button", { name: "Salvar e continuar" }).click();
  await expect(page.locator("form [role=alert]")).toContainText("CNPJ inválido");

  await page.getByLabel("CNPJ").fill("11.222.333/0001-81");
  await page.getByRole("button", { name: "Salvar e continuar" }).click();
  await expect(page).toHaveURL(/step=2/);
  await expect(page.getByText("Consultoria E2E Ltda")).toBeVisible();
});
