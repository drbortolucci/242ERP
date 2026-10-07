import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";


const ADMIN_PAGES = [
  "/app", "/app/config", "/app/config/servicos", "/app/config/alcadas", "/app/config/calendarios", "/app/config/tabelas-preco", "/app/config/condicoes-pagamento",
  "/app/config/sla", "/app/config/politicas", "/app/config/numeracao", "/app/config/integracoes", "/app/admin/empresas", "/app/admin/usuarios", "/app/admin/perfis",
  "/app/admin/assinatura", "/app/admin/auditoria", "/app/admin/dados", "/app/cadastros/clientes", "/app/cadastros/fornecedores", "/app/cadastros/parceiros",
  "/app/cadastros/profissionais", "/app/cadastros/importar", "/app/aprovacoes", "/app/perfil", "/app/notificacoes", "/app/busca?q=alfa", "/app/onboarding?step=5",
];

test("administrador navega pelas telas da fundação sem erros", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
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
