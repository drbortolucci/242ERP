/** Operação de demonstração: projetos dos contratos, alocações, horas (aprovadas, pendentes, aguardando cliente) e despesas. */
import { prisma } from "../src/server/db";
import type { DemoContext } from "./seed-demo";
import { baselineSuggestion, createProject, updateProject, setTaskStatus, addLog, addStatusReport, addEstimate } from "../src/modules/projects/service";
import { createAllocation } from "../src/modules/resources/service";
import { createTimeEntry, submitEntries, approveEntries, clientDecision } from "../src/modules/timesheet/service";
import { createExpense, submitExpense, requestAdvance, approveAdvance } from "../src/modules/expenses/service";
import { uploadAttachment } from "../src/modules/attachments/service";
import { acceptMilestone } from "../src/modules/contracts/service";
import { decide } from "../src/modules/approvals/service";
import { addDays, addMonths, eachDay, monthStart, weekday, toCivil } from "../src/lib/dates";
import { buildCtx } from "../src/server/context";

const PDF = Buffer.from("%PDF-1.4\n% comprovante fictício de demonstração\n");

export async function seedOperations(d: DemoContext) {
  const pmo = d.users.pmo.ctx;
  const admin = await buildCtx(d.admin.userId, d.orgId);
  const T = d.today;
  const start = monthStart(addMonths(T, -5));
  const types = Object.fromEntries((await prisma.projectType.findMany({ where: { organizationId: d.orgId } })).map((t) => [t.templateKey, t.id]));
  const projects: Record<string, string> = {};
  const defs: [string, string, string][] = [["fixed", "ERP_IMPLEMENTATION", "HOURS"], ["tm", "INTEGRATION", "HOURS"], ["alloc", "ALLOCATION", "MANUAL"], ["ams", "AMS", "MANUAL"]];
  for (const [key, tpl, method] of defs) {
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: d.refs[key] } });
    const sug = (await baselineSuggestion(pmo, c.id))!;
    const p = await createProject(pmo, { companyId: c.companyId, name: c.title, partyId: c.partyId, contractId: c.id, projectTypeId: types[tpl], managerUserId: key === "ams" ? d.users.ams.userId : d.users.pmo.userId, plannedStart: sug.plannedStart, plannedEnd: sug.plannedEnd, progressMethod: method as "HOURS", effortHours: key === "alloc" ? "1920" : key === "ams" ? "960" : sug.effortHours, revenue: sug.revenue, laborCost: key === "alloc" ? "168960" : key === "ams" ? "57600" : sug.laborCost, thirdPartyCost: sug.thirdPartyCost, expenseCost: sug.expenseCost, applyTemplate: true, description: c.title });
    await updateProject(pmo, p.id, { status: "ACTIVE" });
    if (method === "MANUAL") await updateProject(pmo, p.id, { manualProgressPct: "40" });
    projects[key] = p.id;
  }

  // Alocações (percentual convertido em horas pelo calendário)
  const P = d.professionals;
  const end = addDays(addMonths(start, 9), -1);
  const alloc = async (prof: string, proj: string, pct: string, status: "CONFIRMED" | "TENTATIVE" = "CONFIRMED", s = start, e = end) =>
    createAllocation(admin, { professionalId: P[prof], projectId: projects[proj], startDate: s, endDate: e, mode: "PERCENT", value: pct, status, billable: true });
  await alloc("Bruno", "fixed", "50");
  await alloc("Diego", "fixed", "75");
  await alloc("Fábio", "fixed", "75");
  await alloc("Camila", "fixed", "25");
  await alloc("Camila", "tm", "37.5");
  await alloc("Carlos", "tm", "75");
  await alloc("Elisa", "alloc", "100");
  await alloc("Gabriela", "ams", "60");
  // Reserva provisória em conflito (demonstra alerta): Diego também no upsell
  await alloc("Diego", "fixed", "40", "TENTATIVE", addDays(T, 7), addDays(T, 30));

  // Horas: dias úteis do início até ontem; últimas 2 semanas ficam pendentes/rascunho
  const plan: [string, string, string, string][] = [["Bruno", "fixed", "4", "Gestão do projeto e reuniões de acompanhamento"], ["Diego", "fixed", "6", "Configuração FI/CO"], ["Fábio", "fixed", "6", "Desenvolvimentos ABAP"], ["Camila", "fixed", "2", "Arquitetura e desenho da solução"], ["Camila", "tm", "3", "Arquitetura de integrações"], ["Carlos", "tm", "6", "Desenvolvimento de APIs"], ["Elisa", "alloc", "8", "Atividades alocadas SD"]];
  const holidays = new Set((await prisma.holiday.findMany({ where: { organizationId: d.orgId } })).map((h) => toCivil(h.date)));
  const lastApproved = addDays(T, -14);
  const tasks = await prisma.projectTask.findMany({ where: { projectId: { in: Object.values(projects) }, kind: { not: "PHASE" } }, orderBy: { sortOrder: "asc" } });
  const toApprove: string[] = [];
  const toSubmitOnly: string[] = [];
  for (const day of eachDay(start, addDays(T, -1))) {
    const wd = weekday(day);
    if (wd === 0 || wd === 6 || holidays.has(day)) continue;
    for (const [prof, proj, hours, desc] of plan) {
      const projTasks = tasks.filter((t) => t.projectId === projects[proj]);
      const task = projTasks[Math.min(projTasks.length - 1, Math.floor(((Date.parse(day) - Date.parse(start)) / (Date.parse(T) - Date.parse(start))) * projTasks.length))];
      const e = await createTimeEntry(pmo, { professionalId: P[prof], date: day, hours, description: desc, activityType: "WORK", billable: true, projectId: projects[proj], taskId: task?.id });
      if (day <= lastApproved) toApprove.push(e.id);
      else if (day <= addDays(T, -5)) toSubmitOnly.push(e.id);
    }
  }
  // Envio e aprovação (admin aprova para respeitar segregação do gestor que também aponta)
  for (let i = 0; i < toApprove.length; i += 200) await submitEntries(pmo, toApprove.slice(i, i + 200));
  for (let i = 0; i < toApprove.length; i += 200) await approveEntries(admin, toApprove.slice(i, i + 200));
  await submitEntries(pmo, toSubmitOnly);
  // T&M exige aprovação do cliente: aprova tudo exceto o último mês aprovado (fica aguardando o cliente no portal)
  const tmPending = await prisma.timeEntry.findMany({ where: { projectId: projects.tm, clientApproval: "PENDING" } });
  const cut = monthStart(addMonths(T, -1));
  await clientDecision(admin, tmPending.filter((e) => toCivil(e.date) < cut).map((e) => e.id), true, "Aprovador Gama (ata mensal)");

  // Avanço físico: tarefas iniciais concluídas no projeto de preço fechado
  const fixedTasks = tasks.filter((t) => t.projectId === projects.fixed);
  for (const t of fixedTasks.slice(0, Math.ceil(fixedTasks.length * 0.45))) {
    try { await setTaskStatus(pmo, t.id, "IN_PROGRESS"); await setTaskStatus(pmo, t.id, "DONE"); } catch { /* dependências */ }
  }
  // Marcos aceitos (faturáveis): plano e BBP
  const ms = await prisma.contractMilestone.findMany({ where: { contractId: d.refs.fixed }, orderBy: { plannedDate: "asc" } });
  await acceptMilestone(pmo, ms[0].id, "Sponsor Alfa");
  await acceptMilestone(pmo, ms[1].id, "Sponsor Alfa");
  // Riscos, decisões e status
  await addLog(pmo, { projectId: projects.fixed, kind: "RISK", title: "Atraso na disponibilidade dos usuários-chave", probability: 3, impact: 4, ownerName: "Bruno Gerente", clientVisible: true });
  await addLog(pmo, { projectId: projects.fixed, kind: "ISSUE", title: "Ambiente de qualidade instável", ownerName: "TI Alfa", clientVisible: false });
  await addLog(pmo, { projectId: projects.fixed, kind: "DECISION", title: "Adotar plano de contas único para as filiais", clientVisible: true });
  await addStatusReport(pmo, { projectId: projects.fixed, overall: "YELLOW", schedule: "YELLOW", budget: "GREEN", scope: "GREEN", summary: "Desenho concluído e aceito; realização em andamento com atenção à disponibilidade dos usuários-chave.", nextSteps: "Concluir configurações e iniciar testes integrados.", clientVisible: true });
  await addEstimate(pmo, { projectId: projects.fixed, remainingHours: "700", remainingLaborCost: "84000", remainingThirdPartyUncommitted: "0", remainingExpenses: "8000", remainingRevenue: "260000", notes: "Integrações já contratadas (pedido de compra) — não incluídas aqui para evitar duplicidade." });

  // Despesas
  const cats = Object.fromEntries((await prisma.expenseCategory.findMany({ where: { organizationId: d.orgId } })).map((c) => [c.name, c.id]));
  const diego = d.users.consultor.ctx;
  for (let m = 4; m >= 1; m--) {
    const day = addDays(monthStart(addMonths(T, -m)), 9);
    const e = await createExpense(diego, { date: day, categoryId: cats["Hospedagem"], description: `Hospedagem visita Alfa ${day.slice(5, 7)}/${day.slice(0, 4)}`, amount: "780.00", paidBy: "PROFESSIONAL", billableToClient: true, billableAmount: "", projectId: projects.fixed });
    await uploadAttachment(diego, { entity: "Expense", entityId: e.id, fileName: "nota-hotel.pdf", data: PDF });
    await submitExpense(diego, e.id);
    const req = await prisma.approvalRequest.findFirst({ where: { entityId: e.id, status: "PENDING" } });
    if (req) await decide(pmo, req.id, true, "OK");
  }
  const taxi = await createExpense(d.users.consultor2.ctx, { date: addDays(T, -3), categoryId: cats["Transporte"], description: "Táxi aeroporto", amount: "96.50", paidBy: "PROFESSIONAL", billableToClient: false, projectId: projects.alloc });
  await uploadAttachment(d.users.consultor2.ctx, { entity: "Expense", entityId: taxi.id, fileName: "recibo.pdf", data: PDF });
  await submitExpense(d.users.consultor2.ctx, taxi.id); // fica aguardando aprovação
  const sw = await createExpense(admin, { date: addDays(monthStart(addMonths(T, -1)), 4), categoryId: cats["Software e ferramentas"], description: "Ferramenta de diagramação (cartão corporativo)", amount: "320.00", paidBy: "COMPANY", billableToClient: false, costCenterId: d.refs.ccAdm, companyId: d.companies.main });
  await uploadAttachment(admin, { entity: "Expense", entityId: sw.id, fileName: "fatura.pdf", data: PDF });
  await submitExpense(admin, sw.id);
  const swReq = await prisma.approvalRequest.findFirst({ where: { entityId: sw.id, status: "PENDING" } });
  if (swReq) await decide(pmo, swReq.id, true, "OK");
  const adv = await requestAdvance(diego, { amount: "1500.00", purpose: "Viagem para workshop de testes integrados", projectId: projects.fixed });
  await approveAdvance(pmo, adv.id);
  return projects;
}
