import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { portalOverview, portalPendingTime, portalMeasurements, portalProjects, portalFinance, portalScope } from "@/modules/portal/service";
import { openTicket, addComment, listComments, getTicket } from "@/modules/ams/tickets";
import { clientDecision } from "@/modules/timesheet/service";
import { clientApproveMeasurement, clientRejectMeasurement } from "@/modules/billing/measurement";
import { decideDeliverable } from "@/modules/projects/service";

const company = { kind: "HEADQUARTERS" as const, legalName: "Consultoria Portal Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

describe("portal do cliente restrito à parte autorizada (AC24)", () => {
  it("cliente vê só os próprios dados, sem custos nem comentários internos, e não decide sobre outro cliente", async () => {
    const { ctx, org, user } = await newOrg();
    const c = await createCompany(ctx, company);
    const mk = async (name: string) => createParty(ctx, { personType: "COMPANY", name, isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const [a, b] = [await mk("Cliente A"), await mk("Cliente B")];
    const prof = await prisma.professional.create({ data: { organizationId: org.id, companyId: c.id, name: "Consultor", employmentType: "CLT", certifications: [] } });
    const setupParty = async (partyId: string, n: string) => {
      const contract = await prisma.contract.create({ data: { organizationId: org.id, companyId: c.id, number: `CTR-${n}`, partyId, title: `Contrato ${n}`, commercialModel: "TIME_MATERIAL", status: "ACTIVE", startDate: new Date("2026-01-01"), totalValue: 1000, requiresClientTimesheetApproval: true, requiresClientMeasurementApproval: true } });
      const project = await prisma.project.create({ data: { organizationId: org.id, companyId: c.id, code: `PRJ-${n}`, name: `Projeto ${n}`, partyId, contractId: contract.id, status: "ACTIVE" } });
      const entry = await prisma.timeEntry.create({ data: { organizationId: org.id, companyId: c.id, professionalId: prof.id, contractId: contract.id, projectId: project.id, date: new Date("2026-09-10"), hours: 4, description: `Trabalho ${n}`, status: "APPROVED", clientApproval: "PENDING", billingStatus: "BLOCKED", costRate: 90, costAmount: 360, sellRate: 200, createdById: user.id } });
      const m = await prisma.measurement.create({ data: { organizationId: org.id, companyId: c.id, number: `MED-${n}`, partyId, contractId: contract.id, periodStart: new Date("2026-09-01"), periodEnd: new Date("2026-09-30"), competence: new Date("2026-09-01"), status: "CLIENT_PENDING", totalAmount: 800, createdById: user.id } });
      const task = await prisma.projectTask.create({ data: { organizationId: org.id, projectId: project.id, wbsCode: "1", name: `Entregável ${n}`, kind: "DELIVERABLE", status: "DONE", requiresAcceptance: true, acceptanceStatus: "PENDING" } });
      await prisma.projectLog.create({ data: { organizationId: org.id, projectId: project.id, kind: "RISK", title: `Risco interno ${n}`, clientVisible: false, createdById: user.id } });
      await prisma.projectLog.create({ data: { organizationId: org.id, projectId: project.id, kind: "DECISION", title: `Decisão visível ${n}`, clientVisible: true, createdById: user.id } });
      return { contract, project, entry, m, task };
    };
    const A = await setupParty(a.id, "A");
    const B = await setupParty(b.id, "B");
    const clientA = await addUser(org.id, ["client_approver"], { kind: "CLIENT", partyId: a.id });
    expect(() => portalScope(ctx)).toThrow(); // usuário interno não usa o portal
    // visão geral e listas apenas do cliente A
    const o = await portalOverview(clientA);
    expect([o.contracts.map((x) => x.number), o.timePending, o.measPending, o.deliverables]).toEqual([["CTR-A"], 1, 1, 1]);
    const pt = await portalPendingTime(clientA);
    expect(pt.map((x) => x.description)).toEqual(["Trabalho A"]);
    expect(JSON.stringify(pt)).not.toMatch(/cost/i); // sem custo/hora do profissional
    expect((await portalMeasurements(clientA)).map((m) => m.number)).toEqual(["MED-A"]);
    const pp = await portalProjects(clientA);
    expect([pp.map((p) => p.code), pp[0].logs.map((l) => l.title)]).toEqual([["PRJ-A"], ["Decisão visível A"]]);
    expect((await portalFinance(clientA)).docs).toEqual([]);
    // chamados: não vê de outro cliente; não vê comentário interno
    const tB = await openTicket(ctx, { partyId: b.id, companyId: c.id, type: "REQUEST", title: "Pedido B", description: "Somente do cliente B", impact: 3, urgency: 3 });
    await expect(getTicket(clientA, tB.id)).rejects.toThrow();
    const tA = await openTicket(clientA, { type: "INCIDENT", title: "Erro A", description: "Erro ao emitir relatório", impact: 2, urgency: 2, companyId: c.id });
    await addComment(ctx, tA.id, "Nota interna com custo estimado", "INTERNAL");
    await addComment(ctx, tA.id, "Estamos analisando", "PUBLIC");
    expect((await listComments(clientA, tA.id)).map((x) => x.body)).toEqual(["Estamos analisando"]);
    // decisões sobre dados de outro cliente são ignoradas/recusadas
    expect(await clientDecision(clientA, [B.entry.id], true, "A")).toBe(0);
    await expect(clientApproveMeasurement(clientA, B.m.id, "A")).rejects.toThrow();
    await expect(clientRejectMeasurement(clientA, B.m.id, "A", "não")).rejects.toThrow();
    await expect(decideDeliverable(clientA, B.task.id, true, "A")).rejects.toThrow();
    // e funcionam nos próprios
    expect(await clientDecision(clientA, [A.entry.id], true, "Aprovador A")).toBe(1);
    await clientApproveMeasurement(clientA, A.m.id, "Aprovador A");
    await decideDeliverable(clientA, A.task.id, true, "Aprovador A");
    expect((await prisma.timeEntry.findUniqueOrThrow({ where: { id: B.entry.id } })).clientApproval).toBe("PENDING");
    // usuário do cliente sem perfil aprovador não aprova
    const viewer = await addUser(org.id, ["client_user"], { kind: "CLIENT", partyId: a.id });
    await expect(clientDecision(viewer, [A.entry.id], true, "x")).rejects.toThrow();
  });
});
