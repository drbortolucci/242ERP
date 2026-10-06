import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { openApprovals, decide, registerApprovalHandler } from "@/modules/approvals/service";
import { addCostRate, costRateAt, createProfessional } from "@/modules/professionals/service";
import { createParty } from "@/modules/parties/service";
import { createCompany } from "@/modules/companies/service";
import { changePlan, handlePaymentWebhook, runBillingPolicy, activateSubscription } from "@/modules/saas/subscription";
import { requestDataExport } from "@/modules/saas/data-export";
import { grantSupportAccess, startSupportSession } from "@/modules/saas/support";
import { buildCtx } from "@/server/context";
import { saveConfig } from "@/modules/config/service";
import { uploadAttachment } from "@/modules/attachments/service";
import { nextNumber } from "@/server/sequences";
import { login, requestPasswordReset, resetPassword } from "@/modules/auth/service";
import { storage } from "@/server/storage";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa Teste Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

describe("autenticação", () => {
  it("bloqueia após tentativas inválidas e permite recuperação de acesso", async () => {
    const { user } = await newOrg();
    for (let i = 0; i < 5; i++) await expect(login(user.email, "errada123456")).rejects.toThrow(/inválidos/);
    await expect(login(user.email, "SenhaForte123")).rejects.toThrow(/bloqueada/);
    const token = await requestPasswordReset(user.email);
    await resetPassword(token!, "NovaSenha12345");
    const r = await login(user.email, "NovaSenha12345");
    expect(r.token).toBeTruthy();
    await expect(resetPassword(token!, "OutraSenha12345")).rejects.toThrow(/inválido ou expirado/);
  });
});

describe("aprovações com segregação de funções", () => {
  it("solicitante não aprova; aprovador com alçada aprova e o documento é notificado", async () => {
    const { org, ctx } = await newOrg();
    const approved: string[] = [];
    registerApprovalHandler("TestDoc", { onApproved: async (_c, _t, id) => { approved.push(id); }, onRejected: async () => {}, link: () => "/", label: "Teste" });
    const seller = await addUser(org.id, ["sales"]);
    const director = await addUser(org.id, ["director"]);
    await ctx.db.approvalRule.create({ data: { organizationId: org.id, docType: "TEST", name: "Toda", minAmount: "0", requiredPermission: "proposal.approve" } });
    const { approved: auto } = await seller.db.$transaction((tx) => openApprovals(seller, tx, { docType: "TEST", entity: "TestDoc", entityId: "doc1", facts: { amount: "10" } }));
    expect(auto).toBe(false);
    const req = await ctx.db.approvalRequest.findFirstOrThrow({ where: { entityId: "doc1" } });
    await expect(decide(seller, req.id, true)).rejects.toThrow(/alçada|Segregação/);
    await expect(decide(director, req.id, false)).rejects.toThrow(/motivo/);
    await decide(director, req.id, true, "ok");
    expect(approved).toEqual(["doc1"]);
    await expect(decide(director, req.id, true)).rejects.toThrow(/já foi decidida/);
    const auditRow = await prisma.auditLog.findFirst({ where: { organizationId: org.id, action: "approval.approve" } });
    expect(auditRow?.userId).toBe(director.userId);
  });
});

describe("custo/hora com vigência", () => {
  it("encerra vigência anterior e preserva custo histórico", async () => {
    const { ctx } = await newOrg();
    const c = await createCompany(ctx, company);
    const p = await createProfessional(ctx, { companyId: c.id, name: "Ana", employmentType: "CLT", capacityPct: "100", certifications: [], skillIds: [], email: undefined, supplierPartyId: undefined, teamRoleId: undefined, seniorityId: undefined, managerId: undefined, calendarId: undefined, costCenterId: undefined, businessUnitId: undefined });
    await addCostRate(ctx, { professionalId: p.id, hourlyCost: "80", validFrom: "2026-01-01" });
    await addCostRate(ctx, { professionalId: p.id, hourlyCost: "95.5", validFrom: "2026-07-01" });
    expect((await costRateAt(ctx.db, p.id, "2026-06-30"))?.toString()).toBe("80");
    expect((await costRateAt(ctx.db, p.id, "2026-07-01"))?.toString()).toBe("95.5");
    expect(await costRateAt(ctx.db, p.id, "2025-12-31")).toBeNull();
    await expect(addCostRate(ctx, { professionalId: p.id, hourlyCost: "70", validFrom: "2026-03-01" })).rejects.toThrow(/data posterior/);
    const consultant = await addUser(ctx.orgId, ["consultant"]);
    await expect(addCostRate(consultant, { professionalId: p.id, hourlyCost: "1", validFrom: "2027-01-01" })).rejects.toThrow(/cost.manage/);
  });
});

describe("cadastros", () => {
  it("detecta duplicidade e mantém papéis cliente/fornecedor na mesma parte", async () => {
    const { ctx } = await newOrg();
    const base = { personType: "COMPANY" as const, name: "ACME Tecnologia Ltda", document: "11444777000161", isCustomer: true, isProspect: false, isSupplier: true, isPartner: false };
    const p = await createParty(ctx, base);
    expect(p.isCustomer && p.isSupplier).toBe(true);
    await expect(createParty(ctx, { ...base, name: "Outra" })).rejects.toThrow(/duplicidade/);
    await expect(createParty(ctx, { ...base, document: undefined, name: "ACME Tecnologia LTDA." })).rejects.toThrow(/duplicidade/);
  });
  it("configurador valida tipos e unicidade e audita", async () => {
    const { ctx } = await newOrg();
    await expect(saveConfig(ctx, "servicos", null, { code: "IMPL", name: "Dup", category: "OTHER" })).rejects.toThrow(/Já existe/);
    await expect(saveConfig(ctx, "funil", null, { name: "X", order: "abc", probability: "10", kind: "OPEN" })).rejects.toThrow(/Verifique/);
    const s = await saveConfig(ctx, "servicos", null, { code: "NEW", name: "Novo serviço", category: "OTHER" });
    expect(await prisma.auditLog.count({ where: { organizationId: ctx.orgId, entityId: s.id } })).toBe(1);
    const consultant = await addUser(ctx.orgId, ["consultant"]);
    await expect(saveConfig(consultant, "servicos", null, { code: "Z", name: "Z", category: "OTHER" })).rejects.toThrow(/settings.manage/);
  });
});

describe("assinatura SaaS", () => {
  it("upgrade imediato, downgrade bloqueado pelo uso e webhook idempotente", async () => {
    const { ctx, org } = await newOrg({ plan: "PROFESSIONAL" });
    await createCompany(ctx, company);
    await createCompany(ctx, { ...company, legalName: "Segunda", cnpj: "11444777000161" });
    const starter = await prisma.plan.findUniqueOrThrow({ where: { code: "STARTER" } });
    await expect(changePlan(ctx, starter.id)).rejects.toThrow(/Downgrade bloqueado/);
    const ent = await prisma.plan.findUniqueOrThrow({ where: { code: "ENTERPRISE" } });
    await changePlan(ctx, ent.id);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).planId).toBe(ent.id);

    await activateSubscription(await buildCtx(ctx.userId, org.id));
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { organizationId: org.id } });
    const ev = { id: `evt-${org.id}`, type: "invoice.payment_failed", data: { providerSubscriptionId: sub.providerSubscriptionId!, invoiceId: `inv-${org.id}`, amount: "10.00" } };
    expect((await handlePaymentWebhook("simulated", ev)).duplicate).toBe(false);
    expect((await handlePaymentWebhook("simulated", ev)).duplicate).toBe(true);
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("PAST_DUE");
    // carência expirada → suspensão (dados preservados, somente leitura)
    await prisma.subscription.update({ where: { id: sub.id }, data: { pastDueSince: new Date(Date.now() - 40 * 86400000) } });
    await runBillingPolicy();
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: org.id } })).status).toBe("SUSPENDED");
    const ro = await buildCtx(ctx.userId, org.id);
    expect(ro.readOnly).toBe(true);
    await expect(createParty(ro, { personType: "COMPANY", name: "Novo", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false })).rejects.toThrow(/somente leitura/);
    expect(await ro.db.company.count()).toBe(2);
  });
});

describe("dados e suporte", () => {
  it("exportação contém somente dados da própria organização", async () => {
    const a = await newOrg();
    const b = await newOrg();
    await createParty(b.ctx, { personType: "COMPANY", name: "Segredo da B", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    await createParty(a.ctx, { personType: "COMPANY", name: "Cliente da A", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const exp = await requestDataExport(a.ctx);
    const row = await prisma.dataExport.findUniqueOrThrow({ where: { id: exp.id } });
    expect(row.status).toBe("READY");
    const json = (await storage.get(row.storageKey!)).toString();
    expect(json).toContain("Cliente da A");
    expect(json).not.toContain("Segredo da B");
    expect(json).not.toContain("passwordHash");
  });
  it("suporte só acessa com concessão vigente, em modo somente leitura e sem custos", async () => {
    const { ctx, org } = await newOrg();
    const admin = await prisma.user.create({ data: { email: `suporte-${org.id}@plataforma.local`, name: "Suporte", passwordHash: "x", isPlatformAdmin: true } });
    await expect(startSupportSession(admin.id, org.id, {})).rejects.toThrow(/Não há autorização/);
    await grantSupportAccess(ctx, admin.email, 2, "Chamado 123");
    expect(await startSupportSession(admin.id, org.id, {})).toBeTruthy();
    const sctx = await buildCtx(admin.id, org.id, { support: true });
    expect(sctx.readOnly).toBe(true);
    expect(sctx.permissions.has("cost.view")).toBe(false);
    expect(await prisma.auditLog.count({ where: { organizationId: org.id, action: "support.session_start" } })).toBe(1);
  });
});

describe("anexos e numeração", () => {
  it("recusa tipo inválido e acesso sem permissão", async () => {
    const { ctx } = await newOrg();
    const c = await createCompany(ctx, company);
    await expect(uploadAttachment(ctx, { entity: "Company", entityId: c.id, fileName: "x.pdf", data: Buffer.from([0x4d, 0x5a, 0, 0]) })).rejects.toThrow(/não permitido/);
    const ok = await uploadAttachment(ctx, { entity: "Company", entityId: c.id, fileName: "logo.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) });
    expect(ok.mimeType).toBe("image/png");
    const consultant = await addUser(ctx.orgId, ["consultant"]);
    await expect(uploadAttachment(consultant, { entity: "Company", entityId: c.id, fileName: "a.png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]) })).rejects.toThrow(/permissão/);
  });
  it("numeração é única sob concorrência", async () => {
    const { org } = await newOrg();
    const nums = await Promise.all(Array.from({ length: 20 }, () => nextNumber(prisma, org.id, "PROPOSAL")));
    expect(new Set(nums).size).toBe(20);
  });
});
