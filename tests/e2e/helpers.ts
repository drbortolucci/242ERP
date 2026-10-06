import type { Page } from "@playwright/test";

export async function loginAs(page: Page, email: string, password = process.env.DEMO_PASSWORD ?? "Demo@2026local") {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}
