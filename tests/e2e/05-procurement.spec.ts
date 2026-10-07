import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("compras navega por requisições, mapa de cotações, pedidos, documentos e ativos", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${page.url()} :: ${e.message.slice(0, 80)}`));
  await loginAs(page, "compras@demo.local");
  for (const url of ["/app/suprimentos/requisicoes", "/app/suprimentos/pedidos", "/app/suprimentos/notas", "/app/suprimentos/ativos"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  await page.goto("/app/suprimentos/requisicoes");
  await page.getByRole("row", { name: /Hospedagem da equipe/ }).getByRole("link").first().click();
  await expect(page.getByText("Mapa comparativo de cotações")).toBeVisible();
  await expect(page.getByText("menor preço")).toBeVisible();

  await page.goto("/app/suprimentos/pedidos");
  await page.getByRole("row", { name: /Subcontratação/ }).getByRole("link").first().click();
  await expect(page.getByText("Itens — pedido × recebido/aceito × faturado (3 vias)")).toBeVisible();
  await expect(page.getByText("INT-2026-0533")).toBeVisible();
  // Documento acima do aceito é marcado como divergente
  await page.getByLabel("Número do documento").fill("INT-E2E-1");
  await page.locator('input[name="amount"]').fill("999999");
  await page.locator('input[name="dueDate"]').fill("2026-12-31");
  await page.getByRole("button", { name: "Registrar e conferir (3 vias)" }).click();
  await expect(page.getByText(/Documento DIVERGENTE/)).toBeVisible();
  expect(errors).toEqual([]);
});

test("diretor aceita divergência com justificativa e consulta a visão 360° do fornecedor", async ({ page }) => {
  await loginAs(page, "diretor@demo.local");
  await page.goto("/app/suprimentos/notas");
  page.on("dialog", (d) => d.accept());
  const card = page.locator("div.border-amber-200", { hasText: "INT-2026-0533" });
  await card.getByLabel("Justificativa para aceitar").fill("Horas adicionais aprovadas pelo gestor do projeto");
  await card.getByRole("button", { name: "Aceitar divergência" }).click();
  // O documento sai da lista de divergências e passa a "Aprovado", com conta a pagar aguardando aprovação financeira
  await expect(page.getByRole("row", { name: /INT-2026-0533.*Aprovado/ })).toBeVisible();

  await page.goto("/app/cadastros/fornecedores");
  await page.getByRole("row", { name: /Integra/ }).getByRole("link").first().click();
  for (const t of ["Documentação e conformidade", "Contratos e pedidos de compra", "Cotações", "Projetos atendidos", "Medições e aceites", "Documentos de cobrança", "Contas a pagar, adiantamentos e pagamentos", "Avaliações"]) await expect(page.getByRole("heading", { name: t, exact: true })).toBeVisible();
});
