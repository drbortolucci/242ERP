import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { openTicket, changeStatus, addComment, getTicket, listComments, slaSweep, changePriority } from "@/modules/ams/tickets";
import { syncHourBank, decideOverage, hourBankSummary, addManualEntry } from "@/modules/ams/hour-bank";
import { approveEntries } from "@/modules/timesheet/service";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa AMS Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const Z = (iso: string) => new Date(iso);

async function setup() {
  const o = await newOrg();
  const c = await createCompany(o.ctx, company);
  const alfa = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente Alfa", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
  const beta = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente Beta", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
  const sla = await prisma.slaPolicy.findFirstOrThrow({ where: { organizationId: o.org.id } });
  const contract = await prisma.contract.create({ data: { organizationId: o.org.id, companyId: c.id, number: "CTR-AMS-1", partyId: alfa.id, title: "AMS Alfa", commercialModel: "AMS_RECURRING", status: "ACTIVE", startDate: new Date("2026-08-01"), totalValue: 120000, monthlyFee: 10000, franchiseHours: 10, overageRate: 200, overagePolicy: "REQUIRE_APPROVAL", hourBankPolicy: "ACCUMULATE", hourBankExpiryMonths: 1, slaPolicyId: sla.id } });
  const prof = await prisma.professional.create({ data: { organizationId: o.org.id, companyId: c.id, name: "Analista AMS", employmentType: "CLT", certifications: [] } });
  return { ...o, c, alfa, beta, contract, prof };
}

describe("chamados AMS e SLA em horário comercial", () => {
  it("prazos por prioridade, primeira resposta, pausa que estende o prazo, resolução, encerramento e reabertura pelo cliente", async () => {
    const { ctx, org, alfa, beta, c, contract } = await setup();
    const client = await addUser(org.id, ["client_user"], { kind: "CLIENT", partyId: alfa.id });
    // quarta 07/10/2026 10:00 (SP); P2 = impacto 1 × urgência 2 → resposta 60 min, solução 480 min úteis
    const t = await openTicket(client, { type: "INCIDENT", title: "Erro na emissão de notas", description: "Ao emitir, o sistema retorna erro de validação", impact: 1, urgency: 2 }, Z("2026-10-07T13:00:00Z"));
    expect(t.priority).toBe("P2");
    expect(t.contractId).toBe(contract.id); // contrato AMS ativo do cliente vinculado automaticamente
    expect(t.responseDueAt?.toISOString()).toBe("2026-10-07T14:00:00.000Z");
    expect(t.resolutionDueAt?.toISOString()).toBe("2026-10-07T21:00:00.000Z");
    // cliente não vê chamado de outro cliente
    const other = await openTicket(ctx, { partyId: beta.id, companyId: c.id, type: "REQUEST", title: "Acesso", description: "Criar usuário", impact: 3, urgency: 3 });
    await expect(getTicket(client, other.id)).rejects.toThrow();
    await addComment(ctx, t.id, "Analisando o log de erro.", "PUBLIC", Z("2026-10-07T13:30:00Z"));
    await addComment(ctx, t.id, "Suspeita de configuração de imposto (interno).", "INTERNAL");
    expect((await getTicket(ctx, t.id)).responseBreached).toBe(false);
    expect((await listComments(client, t.id)).map((x) => x.visibility)).toEqual(["PUBLIC"]);
    // aguardando cliente das 12:00 de quarta às 10:00 de quinta = 360 + 60 = 420 min úteis pausados
    await changeStatus(ctx, t.id, "WAITING_CUSTOMER", "Solicitado exemplo de nota", Z("2026-10-07T15:00:00Z"));
    await changeStatus(client, t.id, "IN_PROGRESS", "Exemplo enviado", Z("2026-10-08T13:00:00Z"));
    const resumed = await getTicket(ctx, t.id);
    expect(resumed.pausedBusinessMinutes).toBe(420);
    expect(resumed.resolutionDueAt?.toISOString()).toBe("2026-10-08T19:00:00.000Z"); // quinta 16:00
    await changeStatus(ctx, t.id, "RESOLVED", undefined, Z("2026-10-08T18:00:00Z"));
    expect((await getTicket(ctx, t.id)).resolutionBreached).toBe(false);
    await expect(changeStatus(client, t.id, "CANCELED", "x")).rejects.toThrow();
    await changeStatus(client, t.id, "CLOSED", "Resolvido, obrigado", Z("2026-10-09T12:00:00Z"));
    await changeStatus(client, t.id, "IN_PROGRESS", "O erro voltou", Z("2026-10-10T12:00:00Z"));
    const reopened = await getTicket(ctx, t.id);
    expect([reopened.status, reopened.reopenCount, reopened.closedAt]).toEqual(["IN_PROGRESS", 1, null]);
    expect(await prisma.ticketEvent.count({ where: { ticketId: t.id, kind: "REOPEN" } })).toBe(1);
  });

  it("varredura detecta violação de resposta, escalona em risco e viola solução; prioridade recalcula prazos", async () => {
    const { ctx, org, alfa } = await setup();
    const t = await openTicket(ctx, { partyId: alfa.id, type: "INCIDENT", title: "Sistema parado", description: "Produção indisponível", impact: 1, urgency: 1 }, Z("2026-10-07T13:00:00Z"));
    expect(t.priority).toBe("P1"); // 30 min resposta / 240 min solução
    expect((await slaSweep(Z("2026-10-07T13:20:00Z"), org.id)).responseBreaches).toBe(0);
    expect((await slaSweep(Z("2026-10-07T13:31:00Z"), org.id)).responseBreaches).toBe(1);
    expect((await slaSweep(Z("2026-10-07T15:30:00Z"), org.id)).escalations).toBe(0); // 62%
    expect((await slaSweep(Z("2026-10-07T16:20:00Z"), org.id)).escalations).toBe(1); // 83% ≥ 80%
    expect((await slaSweep(Z("2026-10-07T16:25:00Z"), org.id)).escalations).toBe(0); // não repete
    expect((await slaSweep(Z("2026-10-07T17:01:00Z"), org.id)).resolutionBreaches).toBe(1);
    const after = await getTicket(ctx, t.id);
    expect([after.responseBreached, after.resolutionBreached, after.escalationLevel]).toEqual([true, true, 2]);
    const t2 = await openTicket(ctx, { partyId: alfa.id, type: "REQUEST", title: "Relatório", description: "Novo relatório", impact: 3, urgency: 3 }, Z("2026-10-07T13:00:00Z"));
    await expect(changePriority(ctx, t2.id, 1, 1, "")).rejects.toThrow(/Justifique/);
    await changePriority(ctx, t2.id, 2, 2, "Impacto no fechamento");
    // P3 = 1440 min úteis a partir de qua 10:00: qua 480 + qui 540 + sex 420 → sex 16:00 (19:00Z)
    expect((await getTicket(ctx, t2.id)).resolutionDueAt?.toISOString()).toBe("2026-10-09T19:00:00.000Z");
  });
});

describe("banco de horas AMS", () => {
  it("franquias, consumo FIFO por vencimento, excedente com decisão, idempotência, expiração e concorrência", async () => {
    const { ctx, org, c, contract, prof } = await setup();
    const te = (date: string, hours: number, status = "APPROVED") => prisma.timeEntry.create({ data: { organizationId: org.id, companyId: c.id, professionalId: prof.id, contractId: contract.id, date: new Date(date), hours, description: "Atendimento AMS", status, createdById: ctx.userId } });
    await te("2026-08-20", 4);
    await te("2026-09-10", 12);
    await te("2026-10-05", 20);
    const r = await syncHourBank(ctx, contract.id, "2026-10-07");
    expect(r.franchises).toBe(3);
    expect(r.overageHours.toString()).toBe("6");
    const debits = await prisma.hourBankEntry.findMany({ where: { contractId: contract.id, kind: "DEBIT" }, orderBy: { createdAt: "asc" } });
    const credits = await prisma.hourBankEntry.findMany({ where: { contractId: contract.id, kind: "CREDIT" }, orderBy: { month: "asc" } });
    // set/10 consome primeiro o saldo de agosto (vence antes) e depois setembro
    expect(debits.map((d) => [credits.findIndex((x) => x.id === d.creditEntryId), Number(d.hours)])).toEqual([[0, -4], [0, -6], [1, -6], [1, -4], [2, -10]]);
    let s = await hourBankSummary(ctx, contract.id, "2026-10-07");
    expect([s.available.toString(), s.overagePendingHours.toString(), s.lowBalance]).toEqual(["0", "6", true]);
    // reprocessar não duplica
    const again = await syncHourBank(ctx, contract.id, "2026-10-07");
    expect([again.franchises, again.debits, again.overageHours.toString()]).toEqual([0, 0, "0"]);
    // excedente: decisão única, com justificativa e permissão
    const ov = await prisma.hourBankEntry.findFirstOrThrow({ where: { contractId: contract.id, kind: "OVERAGE" } });
    const analyst = await addUser(org.id, ["consultant"]);
    await expect(decideOverage(analyst, ov.id, true, "ok")).rejects.toThrow();
    await decideOverage(ctx, ov.id, true, "Excedente acordado com o cliente");
    await expect(decideOverage(ctx, ov.id, false, "de novo")).rejects.toThrow(/já decidido/);
    s = await hourBankSummary(ctx, contract.id, "2026-10-07");
    expect([s.overageBillableHours.toString(), s.overageBillableValue.toString()]).toEqual(["6", "1200"]);
    // expiração: em 05/01/2027 o crédito de novembro (vence 31/12) expira; reexecutar não duplica
    await syncHourBank(ctx, contract.id, "2027-01-05");
    await syncHourBank(ctx, contract.id, "2027-01-05");
    const exp = await prisma.hourBankEntry.findMany({ where: { contractId: contract.id, kind: "EXPIRE" } });
    expect(exp.map((e) => [e.month.toISOString().slice(0, 10), Number(e.hours)])).toEqual([["2027-01-01", -10]]);
    // ajuste negativo além do saldo é recusado
    await expect(addManualEntry(ctx, { contractId: contract.id, kind: "ADJUST", hours: "-500", notes: "teste" })).rejects.toThrow(/maior que o saldo/);
    // concorrência: duas apurações simultâneas consomem a mesma hora uma única vez
    const late = await te("2027-01-04", 3);
    await Promise.all([syncHourBank(ctx, contract.id, "2027-01-05"), syncHourBank(ctx, contract.id, "2027-01-05")]);
    expect(await prisma.hourBankEntry.count({ where: { sourceId: late.id } })).toBe(1);
  });

  it("aprovação de horas do contrato AMS consome o banco automaticamente", async () => {
    const { org, c, contract, prof } = await setup();
    const approver = await addUser(org.id, ["ams_manager"]);
    const e = await prisma.timeEntry.create({ data: { organizationId: org.id, companyId: c.id, professionalId: prof.id, contractId: contract.id, date: new Date("2026-09-15"), hours: 2, description: "Chamado", status: "SUBMITTED", createdById: approver.userId } });
    expect(await approveEntries(approver, [e.id])).toBe(1);
    const d = await prisma.hourBankEntry.findMany({ where: { sourceId: e.id } });
    expect(d.map((x) => [x.kind, Number(x.hours)])).toEqual([["DEBIT", -2]]);
  });
});
