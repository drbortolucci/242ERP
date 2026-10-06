/** Dados comerciais de demonstração: funil, propostas (com alçadas), pedidos e contratos dos 4 modelos principais. */
import { prisma } from "../src/server/db";
import "../src/modules/approvals/register-all";
import type { DemoContext } from "./seed-demo";
import { createOpportunity, moveStage, loseOpportunity, createActivity, createLead } from "../src/modules/crm/service";
import { createProposal, saveDraft, submitProposal, registerAcceptance, type VersionInput } from "../src/modules/proposals/service";
import { decide } from "../src/modules/approvals/service";
import { createSalesOrderFromProposal, createContractFromOrder, activateContract, addMilestone, addCustomerPo, type ContractInput } from "../src/modules/contracts/service";
import { saveConfig } from "../src/modules/config/service";
import { addDays, addMonths, monthStart } from "../src/lib/dates";
import type { Ctx } from "../src/server/context";

type L = { kind: string; description: string; hours?: string; quantity?: string; unitPrice: string; unitCost: string; teamRoleId?: string; seniorityId?: string; serviceId?: string };
function v(lines: L[], o: Partial<VersionInput> & { commercialModel: VersionInput["commercialModel"] }): VersionInput {
  return {
    months: 1, discountPct: "0", taxRatePct: "11.33", validUntil: "2099-12-31", scope: "Escopo conforme reuniões de levantamento.", assumptions: "Ambiente do cliente disponível; key users dedicados.", exclusions: "Infraestrutura e licenças do cliente.",
    lineKind: lines.map((l) => l.kind), lineDescription: lines.map((l) => l.description), lineServiceId: lines.map((l) => l.serviceId ?? ""), lineTeamRoleId: lines.map((l) => l.teamRoleId ?? ""), lineSeniorityId: lines.map((l) => l.seniorityId ?? ""),
    lineHours: lines.map((l) => l.hours ?? "0"), lineQuantity: lines.map((l) => l.quantity ?? "1"), lineUnitPrice: lines.map((l) => l.unitPrice), lineUnitCost: lines.map((l) => l.unitCost), lineBillable: lines.map(() => "1"), ...o,
  } as VersionInput;
}

const baseContract = (o: Partial<ContractInput>): ContractInput => ({
  title: "", commercialModel: "TIME_MATERIAL", startDate: "", totalValue: "0", billingDay: 1, billingFrequency: "MONTHLY", requiresClientTimesheetApproval: false, requiresClientMeasurementApproval: false,
  requiresPo: false, overagePolicy: "REQUIRE_APPROVAL", revenueMethod: "TIME_MATERIAL", lowBalancePct: 20, taxRatePct: "11.33", autoRenew: false, renewalNoticeDays: 60, ...o,
} as ContractInput);

async function approveAll(director: Ctx, entityId: string) {
  for (;;) {
    const req = await prisma.approvalRequest.findFirst({ where: { entityId, status: "PENDING" }, orderBy: { level: "asc" } });
    if (!req) return;
    await decide(director, req.id, true, "Aprovado conforme estratégia comercial");
  }
}

export async function seedCommercial(d: DemoContext) {
  const sales = d.users.comercial.ctx;
  const director = d.users.diretor.ctx;
  const T = d.today;
  const start = monthStart(addMonths(T, -5));
  const roles = Object.fromEntries((await prisma.teamRole.findMany({ where: { organizationId: d.orgId } })).map((r) => [r.name, r.id]));
  const sens = Object.fromEntries((await prisma.seniorityLevel.findMany({ where: { organizationId: d.orgId } })).map((r) => [r.name, r.id]));
  const svc = Object.fromEntries((await prisma.service.findMany({ where: { organizationId: d.orgId } })).map((s) => [s.code, s.id]));
  const stages = Object.fromEntries((await prisma.pipelineStage.findMany({ where: { organizationId: d.orgId } })).map((s) => [s.name, s.id]));
  const term3060 = (await prisma.paymentTerm.findFirstOrThrow({ where: { organizationId: d.orgId, name: "30/60" } })).id;
  const term30 = (await prisma.paymentTerm.findFirstOrThrow({ where: { organizationId: d.orgId, name: "30 dias" } })).id;
  const sla = (await prisma.slaPolicy.findFirstOrThrow({ where: { organizationId: d.orgId } })).id;
  await saveConfig(d.admin, "comissoes", null, { name: "Comissão comercial sobre contratação", basis: "BOOKING", ratePct: "2" });
  await saveConfig(d.admin, "comissoes", null, { name: "Canal parceiro sobre recebimento", basis: "RECEIPT", ratePct: "5", beneficiaryPartyId: d.parties.Canal });

  const out: Record<string, string> = {};
  async function deal(key: string, partyKey: string, companyId: string, title: string, model: VersionInput["commercialModel"], lines: L[], contract: Partial<ContractInput>, extra: { discount?: string; partner?: string; po?: string } = {}) {
    const opp = await createOpportunity(sales, { companyId, partyId: d.parties[partyKey], title, estimatedValue: "0", competitors: ["Concorrente A"], kind: "NEW", serviceIds: [], itemModels: [], itemValues: [], partnerPartyId: extra.partner, source: "Indicação", expectedCloseDate: addDays(start, -10) });
    await createActivity(sales, { type: "MEETING", subject: `Levantamento — ${title}`, opportunityId: opp.id, done: true, notes: "Entendimento do cenário e dores." });
    const p = await createProposal(sales, { companyId, partyId: d.parties[partyKey], title, opportunityId: opp.id, commercialModel: model });
    await saveDraft(sales, p.id, v(lines, { commercialModel: model, discountPct: extra.discount ?? "0", paymentTermId: contract.paymentTermId, startDate: contract.startDate, endDate: contract.endDate, months: model === "AMS_RECURRING" || model === "MONTHLY_ALLOCATION" ? 12 : 1 }));
    await submitProposal(sales, p.id);
    await approveAll(director, p.id);
    await registerAcceptance(sales, p.id, { acceptedByName: `Sponsor ${partyKey}`, note: "Aceite formal por e-mail (comprovante anexado)" });
    const so = await createSalesOrderFromProposal(sales, p.id, { orderDate: addDays(start, -5), customerPo: extra.po });
    const c = await createContractFromOrder(sales, so.id, baseContract({ title, commercialModel: model, ...contract, totalValue: contract.totalValue === "0" ? so.totalAmount.toString() : contract.totalValue! }));
    await activateContract(sales, c.id, { signedAt: addDays(start, -3), signatureEvidence: "Contrato assinado externamente — PDF anexado" });
    out[key] = c.id;
    out[`opp:${key}`] = opp.id;
    return c;
  }

  // 1) Preço fechado — Implantação (Alfa) com marcos e reconhecimento por % de conclusão (horas)
  const fp = await deal("fixed", "Alfa", d.companies.main, "Implantação SAP FI/SD — Alfa", "FIXED_PRICE", [
    { kind: "LABOR", description: "Gerente de projeto", hours: "320", unitPrice: "320", unitCost: "160", teamRoleId: roles["Gerente de projeto"], seniorityId: sens["Sênior"], serviceId: svc.IMPL },
    { kind: "LABOR", description: "Arquiteta de soluções", hours: "200", unitPrice: "380", unitCost: "190", teamRoleId: roles["Arquiteto de soluções"], seniorityId: sens["Especialista"], serviceId: svc.IMPL },
    { kind: "LABOR", description: "Consultor funcional FI", hours: "600", unitPrice: "260", unitCost: "120", teamRoleId: roles["Consultor funcional"], seniorityId: sens["Sênior"], serviceId: svc.IMPL },
    { kind: "LABOR", description: "Desenvolvedor ABAP", hours: "400", unitPrice: "170", unitCost: "75", teamRoleId: roles["Desenvolvedor"], seniorityId: sens["Pleno"], serviceId: svc.IMPL },
    { kind: "THIRD_PARTY", description: "Integrações (subcontratado)", quantity: "1", unitPrice: "60000", unitCost: "42000", serviceId: svc.IMPL },
    { kind: "EXPENSE", description: "Viagens e hospedagem (reembolsáveis)", quantity: "1", unitPrice: "18000", unitCost: "18000" },
  ], { revenueMethod: "PERCENT_COMPLETE_HOURS", billingFrequency: "MILESTONE", startDate: start, endDate: addDays(addMonths(start, 9), -1), totalValue: "0", hoursLimit: "1520", paymentTermId: term3060, requiresPo: true, ownerUserId: d.users.pmo.userId, businessUnitId: d.refs.bu1, costCenterId: d.refs.ccOp }, { discount: "8", po: "OC-ALFA-7781" });
  // marcos que somam exatamente o valor contratado
  const total = Number(fp.totalValue);
  const parts = [0.15, 0.25, 0.3, 0.2];
  let acc = 0;
  const msNames = ["Plano do projeto aprovado", "Desenho da solução (BBP) aceito", "Testes integrados concluídos", "Go-live"];
  for (let i = 0; i < 4; i++) {
    const amt = (Math.round(total * parts[i] * 100) / 100).toFixed(2);
    acc += Number(amt);
    await addMilestone(sales, { contractId: fp.id, name: msNames[i], amount: amt, plannedDate: addMonths(start, [1, 3, 6, 8][i]) });
  }
  await addMilestone(sales, { contractId: fp.id, name: "Encerramento e hypercare", amount: (Math.round((total - acc) * 100) / 100).toFixed(2), plannedDate: addMonths(start, 9) });

  // 2) T&M — Integrações (Gama) com aprovação de horas pelo cliente
  const tm = await deal("tm", "Gama", d.companies.main, "Consultoria em integrações — Gama (T&M)", "TIME_MATERIAL", [
    { kind: "LABOR", description: "Arquiteta de soluções", hours: "120", unitPrice: "380", unitCost: "190", teamRoleId: roles["Arquiteto de soluções"], seniorityId: sens["Especialista"], serviceId: svc.CONS },
    { kind: "LABOR", description: "Desenvolvedor", hours: "500", unitPrice: "170", unitCost: "75", teamRoleId: roles["Desenvolvedor"], seniorityId: sens["Pleno"], serviceId: svc.CONS },
  ], { revenueMethod: "TIME_MATERIAL", startDate: start, endDate: addDays(addMonths(start, 12), -1), totalValue: "130600", hoursLimit: "620", paymentTermId: term30, requiresClientTimesheetApproval: true, ownerUserId: d.users.pmo.userId, businessUnitId: d.refs.bu1, costCenterId: d.refs.ccOp });
  void tm;

  // 3) Alocação mensal — Consultora SD (Delta)
  await deal("alloc", "Delta", d.companies.main, "Alocação de consultora SAP SD — Delta", "MONTHLY_ALLOCATION", [
    { kind: "RECURRING", description: "Alocação mensal consultora funcional SD (160h/mês)", quantity: "12", unitPrice: "28800", unitCost: "14080", serviceId: svc.ALOC },
  ], { revenueMethod: "STRAIGHT_LINE", startDate: start, endDate: addDays(addMonths(start, 12), -1), totalValue: "345600", monthlyFee: "28800", paymentTermId: term30, ownerUserId: d.users.recursos.userId, businessUnitId: d.refs.bu1, costCenterId: d.refs.ccOp }, { partner: d.parties.Canal });

  // 4) AMS recorrente — Beta (empresa AMS) com franquia, banco de horas e SLA
  await deal("ams", "Beta", d.companies.second, "Sustentação AMS SAP — Beta", "AMS_RECURRING", [
    { kind: "RECURRING", description: "Mensalidade AMS (franquia de 80h)", quantity: "12", unitPrice: "16000", unitCost: "6000", serviceId: svc.AMS },
  ], { revenueMethod: "STRAIGHT_LINE", startDate: start, endDate: addDays(addMonths(start, 12), -1), totalValue: "192000", monthlyFee: "16000", franchiseHours: "80", overageRate: "180", overagePolicy: "BILL", hourBankPolicy: "ACCUMULATE", hourBankExpiryMonths: 3, slaPolicyId: sla, paymentTermId: term30, ownerUserId: d.users.ams.userId, businessUnitId: d.refs.bu2, costCenterId: d.refs.ccAms, autoRenew: true });
  await addCustomerPo(sales, { contractId: out.fixed, number: "OC-ALFA-7781-A1", amount: "50000" });

  // Funil aberto em várias etapas
  const open = [
    { party: "Epsilon", title: "Diagnóstico de processos financeiros — Épsilon", value: "180000", stage: "Qualificação", prob: undefined },
    { party: "Alfa", title: "Upsell: módulo MM — Alfa", value: "95000", stage: "Negociação", prob: 70, kind: "UPSELL" as const },
    { party: "Beta", title: "Cross-sell: treinamento de usuários — Beta", value: "42000", stage: "Proposta", kind: "CROSS_SELL" as const },
    { party: "Delta", title: "Advisory de arquitetura — Delta", value: "60000", stage: "Prospecção" },
  ];
  for (const o of open) {
    const opp = await createOpportunity(sales, { companyId: d.companies.main, partyId: d.parties[o.party], title: o.title, estimatedValue: o.value, competitors: [], kind: o.kind ?? "NEW", serviceIds: [], itemModels: [], itemValues: [], expectedCloseDate: addMonths(T, 1), nextAction: "Reunião de alinhamento", nextActionDate: addDays(T, 5) });
    if (o.stage !== "Prospecção") await moveStage(sales, opp.id, stages[o.stage]);
    out[`open:${o.party}`] = opp.id;
  }
  // Proposta de treinamento com desconto acima da alçada → aguardando aprovação da diretoria
  const tr = await createProposal(sales, { companyId: d.companies.main, partyId: d.parties.Beta, title: "Treinamento de usuários-chave — Beta", opportunityId: out["open:Beta"], commercialModel: "TRAINING" });
  await saveDraft(sales, tr.id, v([{ kind: "LABOR", description: "Instrutor sênior", hours: "160", unitPrice: "220", unitCost: "100", teamRoleId: roles["Instrutor"], seniorityId: sens["Sênior"], serviceId: svc.TRN }, { kind: "EXPENSE", description: "Material didático", quantity: "1", unitPrice: "3500", unitCost: "2800" }], { commercialModel: "TRAINING", discountPct: "15" }));
  await submitProposal(sales, tr.id);
  // Oportunidade perdida
  const lost = await createOpportunity(sales, { companyId: d.companies.main, partyId: d.parties.Gama, title: "Rollout Argentina — Gama", estimatedValue: "250000", competitors: ["Concorrente B"], kind: "NEW", serviceIds: [], itemModels: [], itemValues: [] });
  const reason = await prisma.lossReason.findFirstOrThrow({ where: { organizationId: d.orgId, name: "Preço" } });
  await loseOpportunity(sales, lost.id, reason.id, "Concorrente 18% mais barato");
  await createLead(sales, { name: "Rita Prospect", companyName: "Construtora Zeta S.A.", email: "rita@zeta.local", source: "Evento", serviceInterest: "Implantação ERP" });
  await createLead(sales, { name: "Paulo Lead", companyName: "Agro Ômega Ltda", source: "Site", serviceInterest: "AMS" });
  return out;
}
