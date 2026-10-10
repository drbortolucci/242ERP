import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("estoque: telas, venda de produto com reserva e entrega gera contas a receber", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  page.on("dialog", (d) => d.accept());
  await loginAs(page, "estoque@demo.local");
  for (const url of ["/app/estoque/produtos", "/app/estoque/posicao", "/app/estoque/movimentos", "/app/estoque/inventarios", "/app/estoque/reposicao", "/app/estoque/depositos", "/app/estoque/vendas"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // Kardex do produto
  await page.goto("/app/estoque/produtos");
  await page.getByRole("row", { name: /NB-14/ }).getByRole("link").first().click();
  await expect(page.getByText("Saldo por depósito")).toBeVisible();
  await expect(page.getByText("Entrada por compra").first()).toBeVisible();

  // Pedido de venda: cria, confirma (reserva) e entrega
  await page.goto("/app/estoque/vendas");
  const form = page.locator("form", { has: page.getByRole("button", { name: "Criar pedido" }) });
  await form.getByLabel("Empresa").selectOption({ label: "Demo Consultoria" });
  await form.getByLabel("Cliente").selectOption({ index: 1 });
  await form.getByLabel("Depósito de saída").selectOption({ label: "ALM — Almoxarifado central" });
  await form.getByLabel("Produto").first().selectOption({ label: "KIT-TRN — Kit de material de treinamento" });
  await form.getByLabel("Quantidade").first().fill("3");
  await form.getByRole("button", { name: "Criar pedido" }).click();
  await expect(page.getByRole("heading", { name: /Pedido PVP-/ })).toBeVisible();
  await expect(page.getByText("Rascunho")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar e reservar" }).click();
  await expect(page.getByText(/itens reservados/)).toBeVisible();
  await page.getByRole("button", { name: "Entregar" }).click();
  await expect(page.getByText(/Entrega registrada/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Contas a receber" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("perfil sem estoque não vê o módulo; consultor recebe acesso não permitido", async ({ page }) => {
  await loginAs(page, "consultor@demo.local");
  await expect(page.getByRole("navigation", { name: "Módulos" }).getByText("Posição de estoque")).toHaveCount(0);
  const res = await page.goto("/app/estoque/posicao");
  expect(res?.status()).toBe(403);
});
