import { prisma } from "@/server/db";

export const ALL_MODULES = ["crm", "projects", "resources", "timesheet", "expenses", "procurement", "ams", "billing", "finance", "controlling", "portal", "inventory", "api"];

/** Catálogo de planos da plataforma (preços fictícios para demonstração; ajustáveis no painel da plataforma). */
export const PLAN_CATALOG = [
  {
    code: "STARTER", name: "Essencial", description: "Para empresas de serviços em início de operação", priceMonthly: "490.00", maxUsers: 5, maxCompanies: 1, maxStorageMb: 1024,
    modules: ["crm", "projects", "resources", "timesheet", "expenses", "billing", "finance"], features: [], trialDays: 14, rank: 1,
  },
  {
    code: "PROFESSIONAL", name: "Profissional", description: "Operação completa com suprimentos, AMS e portal", priceMonthly: "1490.00", maxUsers: 30, maxCompanies: 3, maxStorageMb: 10240,
    modules: ["crm", "projects", "resources", "timesheet", "expenses", "procurement", "ams", "billing", "finance", "controlling", "portal", "inventory"], features: ["mfa"], trialDays: 14, rank: 2,
  },
  {
    code: "ENTERPRISE", name: "Corporativo", description: "Multiempresa, controladoria avançada e API", priceMonthly: "3990.00", maxUsers: 200, maxCompanies: 20, maxStorageMb: 102400,
    modules: ALL_MODULES, features: ["mfa", "api", "sso_ready"], trialDays: 30, rank: 3,
  },
];

export async function ensurePlans() {
  for (const p of PLAN_CATALOG) {
    await prisma.plan.upsert({ where: { code: p.code }, create: p, update: {} });
  }
}
