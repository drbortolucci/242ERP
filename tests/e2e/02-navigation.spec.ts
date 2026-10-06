import { test, expect, type Page } from "@playwright/test";

export async function loginAs(page: Page, email: string, password = process.env.DEMO_PASSWORD ?? "Demo@2026local") {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

const ADMIN_PAGES = [
  "/app", "/app/config", "/app/config/servicos", "/app/config/alcadas", "/app/config/calendarios", "/app/config/tabelas-preco", "/app/config/condicoes-pagamento",
  "/app/config/sla", "/app/config/politicas", "/app/config/numeracao", "/app/config/integracoes", "/app/admin/empresas", "/app/admin/usuarios", "/app/admin/perfis",
  "/app/admin/assinatura", "/app/admin/auditoria", "/app/admin/dados", "/app/cadastros/clientes", "/app/cadastros/fornecedores", "/app/cadastros/parceiros",
  "/app/cadastros/profissionais", "/app/cadastros/importar", "/app/aprovacoes", "/app/perfil", "/app/notificacoes", "/app/busca?q=alfa", "/app/onboarding?step=5",
];

test("administrador navega pelas telas da fundação sem erros", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs(page, "admin@demo.local");
  for (const url of ADMIN_PAGES) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first(), url).toBeVisible();
    await expect(page.getByText("Application error"), url).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test("consultor não acessa configurações (autorização no servidor)", async ({ page }) => {
  await loginAs(page, "consultor@demo.local");
  const res = await page.goto("/app/config");
  expect(res?.status()).toBeGreaterThanOrEqual(400);
  await expect(page.getByText("Acesso não permitido")).toBeVisible();
});
