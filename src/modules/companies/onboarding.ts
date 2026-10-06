import { z } from "zod";
import { prisma } from "@/server/db";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit } from "@/server/audit";
import { setSetting } from "@/server/settings";
import { validation } from "@/lib/errors";
import { zDecimal, zOptStr } from "@/lib/zod-helpers";
import { createCompany, updateCompany, type CompanyInput } from "./service";
import { dec } from "@/lib/money";

export const ONBOARDING_STEPS = [
  { n: 1, key: "empresa", title: "Empresa" },
  { n: 2, key: "estrutura", title: "Estrutura" },
  { n: 3, key: "financeiro", title: "Financeiro" },
  { n: 4, key: "operacao", title: "Operação" },
  { n: 5, key: "governanca", title: "Governança" },
  { n: 6, key: "checklist", title: "Checklist e conclusão" },
] as const;

/** Itens de processos legais externos — apenas acompanhamento; o ERP não realiza registros oficiais. */
export const LEGAL_CHECKLIST = [
  { key: "cnpj", label: "CNPJ ativo na Receita Federal (processo externo)" },
  { key: "municipal", label: "Inscrição municipal e enquadramento do ISS confirmados" },
  { key: "certificate", label: "Certificado digital da empresa disponível para emissão fiscal" },
  { key: "nfse_access", label: "Acesso ao emissor de NFS-e da prefeitura/provedor" },
  { key: "bank", label: "Conta bancária PJ aberta e convênio de cobrança contratado" },
  { key: "accountant", label: "Contador responsável definido e regras fiscais validadas" },
  { key: "revenue_policy", label: "Política de reconhecimento de receita gerencial aprovada pelo responsável" },
];

export async function getOnboarding(ctx: Ctx) {
  let st = await ctx.db.onboardingState.findFirst();
  if (!st) st = await ctx.db.onboardingState.create({ data: { organizationId: ctx.orgId, step: 1 } });
  return { ...st, data: (st.data ?? {}) as Record<string, Record<string, unknown>> };
}

async function saveState(ctx: Ctx, stepKey: string, n: number, payload: Record<string, unknown>) {
  const st = await getOnboarding(ctx);
  const data = { ...st.data, [stepKey]: { ...(st.data[stepKey] ?? {}), ...payload } };
  await ctx.db.onboardingState.update({ where: { id: st.id }, data: { data: data as object, step: Math.max(st.step, Math.min(6, n + 1)) } });
}

export async function saveCompanyStep(ctx: Ctx, input: CompanyInput) {
  requirePerm(ctx, "company.manage");
  requireWritable(ctx);
  const st = await getOnboarding(ctx);
  const existingId = st.data.empresa?.companyId as string | undefined;
  const company = existingId && (await ctx.db.company.findFirst({ where: { id: existingId } }))
    ? await updateCompany(ctx, existingId, { ...input, kind: "HEADQUARTERS" })
    : await createCompany(ctx, { ...input, kind: "HEADQUARTERS" });
  await saveState(ctx, "empresa", 1, { companyId: company.id });
  return company;
}

export const financeStepSchema = z.object({
  defaultDueDays: z.coerce.number().int().min(0).max(180),
  defaultPaymentTermId: zOptStr,
  defaultTaxRatePct: zDecimal,
});

export async function saveFinanceStep(ctx: Ctx, i: z.infer<typeof financeStepSchema>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  if (dec(i.defaultTaxRatePct).lt(0) || dec(i.defaultTaxRatePct).gt(100)) throw validation("Percentual de tributos estimados deve estar entre 0 e 100.");
  await setSetting(ctx, "billing", { defaultDueDays: i.defaultDueDays });
  await setSetting(ctx, "commercial", { defaultTaxRatePct: i.defaultTaxRatePct });
  await saveState(ctx, "financeiro", 3, i);
  await audit(ctx, { action: "onboarding.finance", entity: "OrgSetting", changes: i });
}

export const operationStepSchema = z.object({
  calendarId: z.string().min(1),
  h0: zDecimal, h1: zDecimal, h2: zDecimal, h3: zDecimal, h4: zDecimal, h5: zDecimal, h6: zDecimal,
  services: z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string())),
});

export async function saveOperationStep(ctx: Ctx, i: z.infer<typeof operationStepSchema>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const hours = [i.h0, i.h1, i.h2, i.h3, i.h4, i.h5, i.h6];
  if (hours.some((h) => dec(h).lt(0) || dec(h).gt(24))) throw validation("Horas por dia devem estar entre 0 e 24.");
  const cal = await ctx.db.workCalendar.findFirst({ where: { id: i.calendarId } });
  if (!cal) throw validation("Calendário inválido.");
  await ctx.db.workCalendar.update({ where: { id: cal.id }, data: { weeklyHours: hours } });
  const all = await ctx.db.service.findMany();
  for (const s of all) {
    const active = i.services.includes(s.id);
    if (s.active !== active) await ctx.db.service.update({ where: { id: s.id }, data: { active } });
  }
  await saveState(ctx, "operacao", 4, { hours, services: i.services });
  await audit(ctx, { action: "onboarding.operation", entity: "WorkCalendar", entityId: cal.id, changes: { hours, services: i.services.length } });
}

export const governanceStepSchema = z.object({
  proposalMaxDiscountPct: zDecimal,
  proposalMinMarginPct: zDecimal,
  proposalHighValue: zDecimal,
  requesterCannotApprove: z.preprocess((v) => v === "on", z.boolean()),
  approverCannotPay: z.preprocess((v) => v === "on", z.boolean()),
  prefixProposal: zOptStr,
  prefixContract: zOptStr,
  prefixProject: zOptStr,
  prefixBilling: zOptStr,
});

export async function saveGovernanceStep(ctx: Ctx, i: z.infer<typeof governanceStepSchema>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const rules = await ctx.db.approvalRule.findMany({ where: { docType: "PROPOSAL" } });
  for (const r of rules) {
    if (r.maxDiscountPct !== null) await ctx.db.approvalRule.update({ where: { id: r.id }, data: { maxDiscountPct: i.proposalMaxDiscountPct, name: `Desconto acima de ${i.proposalMaxDiscountPct}%` } });
    if (r.minMarginPct !== null) await ctx.db.approvalRule.update({ where: { id: r.id }, data: { minMarginPct: i.proposalMinMarginPct, name: `Margem abaixo de ${i.proposalMinMarginPct}%` } });
    if (r.minAmount !== null && r.requiredPermission === "proposal.approve_high") await ctx.db.approvalRule.update({ where: { id: r.id }, data: { minAmount: i.proposalHighValue } });
  }
  await setSetting(ctx, "sod", { requesterCannotApprove: i.requesterCannotApprove, approverCannotPay: i.approverCannotPay });
  const prefixes: [string, string | undefined][] = [["PROPOSAL", i.prefixProposal], ["CONTRACT", i.prefixContract], ["PROJECT", i.prefixProject], ["BILLING_DOCUMENT", i.prefixBilling]];
  for (const [docType, prefix] of prefixes) {
    if (!prefix) continue;
    if (!/^[A-Z0-9-]{1,10}$/.test(prefix)) throw validation("Prefixos: até 10 caracteres em maiúsculas, números ou hífen.");
    await ctx.db.documentSequence.upsert({
      where: { organizationId_companyId_docType: { organizationId: ctx.orgId, companyId: "", docType } },
      create: { organizationId: ctx.orgId, companyId: "", docType, prefix },
      update: { prefix },
    });
  }
  await saveState(ctx, "governanca", 5, i);
  await audit(ctx, { action: "onboarding.governance", entity: "ApprovalRule", changes: i });
}

export async function saveChecklist(ctx: Ctx, checked: string[], finish: boolean) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const st = await getOnboarding(ctx);
  if (finish) {
    if (!st.data.empresa?.companyId) throw validation("Cadastre a empresa (etapa 1) antes de concluir.");
    await ctx.db.onboardingState.update({ where: { id: st.id }, data: { completedAt: new Date() } });
    await prisma.organization.update({ where: { id: ctx.orgId }, data: { onboardingDone: true } });
  }
  await saveState(ctx, "checklist", 6, { checked });
  await audit(ctx, { action: finish ? "onboarding.complete" : "onboarding.checklist", entity: "Organization", entityId: ctx.orgId, changes: { checked } });
}

export async function markStructureStep(ctx: Ctx) {
  await saveState(ctx, "estrutura", 2, { reviewedAt: new Date().toISOString() });
}
