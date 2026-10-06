import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { createInvitation } from "@/modules/auth/service";
import { assertCompanyLimit } from "@/modules/saas/limits";

describe("isolamento entre organizações", () => {
  it("consultas escopadas não enxergam dados de outra organização", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const partyB = await b.ctx.db.party.create({ data: { name: "Cliente secreto B", isCustomer: true } as never });
    expect(partyB.organizationId).toBe(b.org.id);

    // findMany / findFirst / findUnique / count no contexto A não retornam dado de B
    expect(await a.ctx.db.party.findMany({ where: { name: "Cliente secreto B" } })).toHaveLength(0);
    expect(await a.ctx.db.party.findUnique({ where: { id: partyB.id } })).toBeNull();
    expect(await a.ctx.db.party.count({ where: { id: partyB.id } })).toBe(0);
    // update/delete por id de outra organização falham
    await expect(a.ctx.db.party.update({ where: { id: partyB.id }, data: { name: "hack" } })).rejects.toThrow();
    const del = await a.ctx.db.party.deleteMany({ where: { id: partyB.id } });
    expect(del.count).toBe(0);
    // não é possível criar dados em outra organização
    await expect(a.ctx.db.party.create({ data: { organizationId: b.org.id, name: "x" } })).rejects.toThrow(/outra organização/);
    // nada foi alterado em B
    expect((await prisma.party.findUnique({ where: { id: partyB.id } }))!.name).toBe("Cliente secreto B");
  });

  it("transações mantêm o escopo", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const pb = await b.ctx.db.party.create({ data: { name: "B tx" } as never });
    const found = await a.ctx.db.$transaction(async (tx) => tx.party.findFirst({ where: { id: pb.id } }));
    expect(found).toBeNull();
  });

  it("escopo de empresa restringe leitura e escrita", async () => {
    const a = await newOrg();
    const c1 = await a.ctx.db.company.create({ data: { legalName: "Empresa 1", cnpj: "11222333000181" } as never });
    const c2 = await a.ctx.db.company.create({ data: { legalName: "Empresa 2", cnpj: "11444777000161" } as never });
    await a.ctx.db.bankAccount.create({ data: { companyId: c1.id, name: "Conta E1", openingBalance: "0", openingDate: new Date("2026-01-01") } as never });
    await a.ctx.db.bankAccount.create({ data: { companyId: c2.id, name: "Conta E2", openingBalance: "0", openingDate: new Date("2026-01-01") } as never });

    const scoped = await addUser(a.org.id, ["finance"], { companyIds: [c1.id] });
    const accounts = await scoped.db.bankAccount.findMany();
    expect(accounts.map((x) => x.name)).toEqual(["Conta E1"]);
    const companies = await scoped.db.company.findMany();
    expect(companies.map((x) => x.id)).toEqual([c1.id]);
    await expect(scoped.db.bankAccount.create({ data: { companyId: c2.id, name: "x", openingBalance: "0", openingDate: new Date("2026-01-01") } as never })).rejects.toThrow(/escopo/);
  });

  it("modelos de plataforma não podem ser alterados pelo contexto do tenant", async () => {
    const a = await newOrg();
    await expect(a.ctx.db.organization.update({ where: { id: a.org.id }, data: { status: "ACTIVE" } })).rejects.toThrow(/plataforma/);
  });
});

describe("limites do plano no servidor", () => {
  it("bloqueia convites acima do limite de usuários", async () => {
    const a = await newOrg({ plan: "STARTER" }); // 5 usuários
    const role = await prisma.role.findFirstOrThrow({ where: { organizationId: a.org.id, key: "consultant" } });
    for (let i = 0; i < 4; i++) await createInvitation({ orgId: a.org.id, invitedById: a.user.id, email: `c${i}-${a.org.id}@x.com`, roleIds: [role.id] });
    await expect(createInvitation({ orgId: a.org.id, invitedById: a.user.id, email: `c9-${a.org.id}@x.com`, roleIds: [role.id] })).rejects.toThrow(/Limite de usuários/);
  });
  it("bloqueia empresas acima do limite", async () => {
    const a = await newOrg({ plan: "STARTER" }); // 1 empresa
    await a.ctx.db.company.create({ data: { legalName: "E1", cnpj: "11222333000181" } as never });
    await expect(assertCompanyLimit(a.org.id)).rejects.toThrow(/Limite de empresas/);
  });
});
