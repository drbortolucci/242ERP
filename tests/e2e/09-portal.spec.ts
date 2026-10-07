import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

test("cliente aprova horas no portal e não acessa telas internas", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await loginAs(page, "cliente@gama.local");
  await expect(page).toHaveURL(/\/portal/);
  for (const url of ["/portal", "/portal/chamados", "/portal/aprovacoes", "/portal/projetos", "/portal/financeiro", "/portal/conhecimento"]) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  }
  // telas internas redirecionam para o portal
  await page.goto("/app/financeiro/receber");
  await expect(page).toHaveURL(/\/portal/);
  await page.goto("/portal/aprovacoes");
  await expect(page.getByText(/Horas aguardando aprovação \([1-9]\d*\)/)).toBeVisible();
  await page.getByRole("button", { name: "Aprovar selecionadas" }).click();
  await expect(page.getByText("Horas aguardando aprovação (0)")).toBeVisible();
  expect(errors).toEqual([]);
});

test("cliente abre chamado e conversa sem ver notas internas", async ({ page }) => {
  await loginAs(page, "cliente@beta.local");
  await page.goto("/portal/chamados");
  await page.locator('input[name="title"]').fill("Relatório de vendas lento (E2E)");
  await page.locator('textarea[name="description"]').fill("O relatório demora mais de 5 minutos para abrir.");
  await page.getByRole("button", { name: "Abrir chamado" }).click();
  await expect(page.getByRole("heading", { name: /Relatório de vendas lento/ })).toBeVisible();
  await page.locator('textarea[name="body"]').fill("Ocorre desde ontem.");
  await page.getByRole("button", { name: "Enviar" }).click();
  await expect(page.getByText("Ocorre desde ontem.")).toBeVisible();
  await expect(page.getByText(/interno/i)).toHaveCount(0);
});
