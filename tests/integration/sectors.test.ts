import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { buildCtx } from "@/server/context";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createProject } from "@/modules/projects/service";
import { applySectorProfile, getTerms, saveProjectTypeTemplate, saveTerms } from "@/modules/sectors/service";
import { SECTOR_PROFILES } from "@/domain/sectors";

const company = { kind: "HEADQUARTERS" as const, legalName: "Empresa Setor Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

describe("setores de atividade", () => {
  it("provisiona a organização com os itens e a terminologia do setor escolhido", async () => {
    const o = await newOrg({ sector: "ENGINEERING" });
    expect((await prisma.organization.findUniqueOrThrow({ where: { id: o.org.id } })).sector).toBe("ENGINEERING");
    const p = SECTOR_PROFILES.ENGINEERING;
    const types = await prisma.projectType.findMany({ where: { organizationId: o.org.id } });
    expect(types.map((t) => t.name).sort()).toEqual(p.projectTypes.map((t) => t.name).sort());
    const services = await prisma.service.findMany({ where: { organizationId: o.org.id } });
    expect(services.map((s) => s.code).sort()).toEqual(p.services.map((s) => s.code).sort());
    expect(services.every((s) => s.revenueAccountId)).toBe(true);
    expect(await prisma.teamRole.count({ where: { organizationId: o.org.id } })).toBe(p.teamRoles.length);
    expect(await prisma.skill.count({ where: { organizationId: o.org.id } })).toBe(p.skills.length);
    const terms = await getTerms(o.ctx);
    expect(terms.tickets).toBe("Ordens de serviço");
    expect(terms.supportArea).toBe("Manutenção");
    // Organização sem setor informado continua com o padrão (consultoria e TI)
    const d = await newOrg();
    expect(d.ctx.sector).toBe("CONSULTING_IT");
    expect(await prisma.projectType.count({ where: { organizationId: d.org.id, templateKey: "ERP_IMPLEMENTATION" } })).toBe(1);
  });

  it("aplicar outro setor só acrescenta o que falta, é idempotente e exige permissão", async () => {
    const o = await newOrg();
    const before = await prisma.service.count({ where: { organizationId: o.org.id } });
    const consultant = await addUser(o.org.id, ["consultant"]);
    await expect(applySectorProfile(consultant, "AGENCY")).rejects.toThrow();
    const first = await applySectorProfile(o.ctx, "AGENCY");
    expect(first.projectTypes).toBeGreaterThan(0);
    expect(first.services).toBeGreaterThan(0);
    // Nada existente foi removido; serviços do setor anterior continuam
    expect(await prisma.service.count({ where: { organizationId: o.org.id } })).toBe(before + first.services);
    expect(await prisma.service.count({ where: { organizationId: o.org.id, code: "IMPL" } })).toBe(1);
    const again = await applySectorProfile(o.ctx, "AGENCY");
    expect(again).toEqual({ projectTypes: 0, teamRoles: 0, services: 0, expenseCategories: 0, skills: 0 });
    const ctx = await buildCtx(o.user.id, o.org.id);
    expect(ctx.sector).toBe("AGENCY");
    expect((await getTerms(ctx)).projects).toBe("Jobs");
    expect(await prisma.auditLog.count({ where: { organizationId: o.org.id, action: "org.sector_apply" } })).toBe(2);
  });

  it("personaliza a terminologia e volta ao termo do setor quando vazio", async () => {
    const o = await newOrg({ sector: "FIELD_SERVICES" });
    await saveTerms(o.ctx, { tickets: "Visitas técnicas", projects: "" });
    let t = await getTerms(o.ctx);
    expect(t.tickets).toBe("Visitas técnicas");
    expect(t.projects).toBe("Projetos");
    await saveTerms(o.ctx, {});
    t = await getTerms(o.ctx);
    expect(t.tickets).toBe("Ordens de serviço");
    const consultant = await addUser(o.org.id, ["consultant"]);
    await expect(saveTerms(consultant, { tickets: "x" })).rejects.toThrow();
  });

  it("tipo de projeto com modelo de WBS próprio gera as fases e o esforço do modelo", async () => {
    const o = await newOrg({ sector: "AGENCY" });
    const c = await createCompany(o.ctx, company);
    const party = await createParty(o.ctx, { personType: "COMPANY", name: "Cliente da Agência", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const type = await prisma.projectType.findFirstOrThrow({ where: { organizationId: o.org.id, name: "Campanha" } });
    await expect(saveProjectTypeTemplate(o.ctx, type.id, "Fase | Item | tarefa | 50")).rejects.toThrow(/soma/);
    await saveProjectTypeTemplate(o.ctx, type.id, "Criação | Conceito | entregável | 40 | sim\nCriação | Peças | tarefa | 40\nEntrega | Publicação | marco | 20");
    const base = { companyId: c.id, partyId: party.id, projectTypeId: type.id, plannedStart: "2026-11-02", plannedEnd: "2026-12-18", progressMethod: "HOURS" as const, effortHours: "200", revenue: "50000", laborCost: "20000", thirdPartyCost: "0", expenseCost: "0", applyTemplate: true };
    const proj = await createProject(o.ctx, { ...base, name: "Campanha de verão" });
    const tasks = await prisma.projectTask.findMany({ where: { projectId: proj.id }, orderBy: { sortOrder: "asc" } });
    expect(tasks.filter((t) => t.kind === "PHASE").map((t) => t.name)).toEqual(["Criação", "Entrega"]);
    const concept = tasks.find((t) => t.name === "Conceito")!;
    expect(concept.plannedHours.toString()).toBe("80");
    expect(concept.requiresAcceptance).toBe(true);
    // Sem modelo próprio volta à biblioteca (Campanha)
    await saveProjectTypeTemplate(o.ctx, type.id, "");
    const proj2 = await createProject(o.ctx, { ...base, name: "Campanha de inverno" });
    expect(await prisma.projectTask.count({ where: { projectId: proj2.id, name: "Briefing aprovado" } })).toBe(1);
  });
});
