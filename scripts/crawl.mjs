// Varredura de links: entra com cada perfil de demonstração, percorre todas as páginas
// alcançáveis por links internos e registra status HTTP, erros de console/página e telas de erro.
// Uso: BASE=http://localhost:3300 DEMO_PASSWORD=... node scripts/crawl.mjs > crawl.json
import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3300";
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@2026local";
const USERS = (process.env.USERS ?? "admin@demo.local,diretor@demo.local,comercial@demo.local,pmo@demo.local,financeiro@demo.local,consultor@demo.local,cliente@alfa.local,admin@outra.local").split(",");
const MAX = Number(process.env.MAX ?? 600);
const SKIP = /\/(logout|sair)|\/api\/|\.(pdf|csv|xlsx|zip)(\?|$)|download|export/i;

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM ?? undefined });
const report = [];
for (const email of USERS) {
  const ctx = await browser.newContext({ locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await ctx.newPage();
  let current = "";
  const issues = [];
  page.on("console", (m) => { if (m.type() === "error") issues.push({ url: current, kind: "console", text: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => issues.push({ url: current, kind: "pageerror", text: String(e).slice(0, 300) }));
  await page.goto(BASE + "/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 30000 }).catch(() => issues.push({ url: "/login", kind: "login", text: "falhou" }));
  const start = new URL(page.url()).pathname;
  const seen = new Set();
  const queue = [{ path: start, from: "(login)" }];
  // Coleta com até 3 instâncias por padrão de rota (ex.: /app/projetos/[id]) para não varrer milhares de registros.
  const patternCount = new Map();
  const pattern = (p) => p.replace(/\/[0-9a-z]{20,}(?=\/|$)/gi, "/[id]").replace(/\/\d+(?=\/|$)/g, "/[n]");
  while (queue.length && seen.size < MAX) {
    const { path, from } = queue.shift();
    if (seen.has(path)) continue;
    seen.add(path);
    current = path;
    let status = 0;
    try {
      const res = await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 });
      status = res?.status() ?? 0;
    } catch (e) {
      issues.push({ url: path, from, kind: "timeout", text: String(e).slice(0, 200) });
      continue;
    }
    const final = new URL(page.url()).pathname;
    if (status >= 400) issues.push({ url: path, from, kind: "http", text: String(status) + (final !== path ? ` -> ${final}` : "") });
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/Algo deu errado|Application error|Internal Server Error|This page could not be found|Página não encontrada|Unhandled Runtime Error/i.test(bodyText))
      issues.push({ url: path, from, kind: "errorpage", text: bodyText.slice(0, 200).replace(/\s+/g, " ") });
    const links = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    for (const href of links) {
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
      let u;
      try { u = new URL(href, BASE + path); } catch { continue; }
      if (u.origin !== new URL(BASE).origin) continue;
      const p = u.pathname + u.search;
      if (SKIP.test(p) || seen.has(p)) continue;
      const pat = pattern(u.pathname);
      const n = patternCount.get(pat) ?? 0;
      if (n >= 3) continue;
      patternCount.set(pat, n + 1);
      queue.push({ path: p, from: path });
    }
  }
  report.push({ email, visited: seen.size, issues });
  console.error(`${email}: ${seen.size} páginas, ${issues.length} ocorrências`);
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(report, null, 1));
