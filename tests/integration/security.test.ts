import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { createCompany } from "@/modules/companies/service";
import { saveRole, updateMembership, invite, setMembershipActive } from "@/modules/users/service";
import { createApiKey } from "@/modules/api/service";
import { canReadDataExport } from "@/modules/saas/data-export";
import { beginMfaSetup } from "@/modules/auth/service";
import { buildCtx } from "@/server/context";
import { prisma } from "@/server/db";

const company = (cnpj: string) => ({ kind: "HEADQUARTERS" as const, legalName: `Empresa ${cnpj}`, cnpj, currency: "BRL", timezone: "America/Sao_Paulo" });

describe("controles de segurança da auditoria", () => {
  it("administrador de empresa não escala privilégios nem alcance", async () => {
    const a = await newOrg();
    const c1 = await createCompany(a.ctx, company("11222333000181"));
    const c2 = await createCompany(a.ctx, company("11444777000161"));
    const ca = await addUser(a.org.id, ["company_admin"], { companyIds: [c1.id] });
    const roles = await prisma.role.findMany({ where: { organizationId: a.org.id } });
    const id = (k: string) => roles.find((r) => r.key === k)!.id;
    // Não cria perfil com permissões que não possui
    await expect(saveRole(ca, null, { name: "Perfil turbinado", permissions: ["payable.approve"] })).rejects.toThrow(/não possui/);
    // Não altera o próprio acesso
    await expect(updateMembership(ca, ca.membershipId, { roleIds: [id("org_admin")], allCompanies: true, companyIds: [] })).rejects.toThrow(/próprio acesso/);
    // Não concede perfil mais poderoso nem empresa fora do escopo
    const consultant = await addUser(a.org.id, ["consultant"], { companyIds: [c1.id] });
    await expect(updateMembership(ca, consultant.membershipId, { roleIds: [id("org_admin")], allCompanies: false, companyIds: [c1.id] })).rejects.toThrow(/não possui/);
    await expect(updateMembership(ca, consultant.membershipId, { roleIds: [id("consultant")], allCompanies: false, companyIds: [c2.id] })).rejects.toThrow(/empresas/);
    await expect(updateMembership(ca, consultant.membershipId, { roleIds: [id("consultant")], allCompanies: true, companyIds: [] })).rejects.toThrow(/empresas/);
    await updateMembership(ca, consultant.membershipId, { roleIds: [id("consultant")], allCompanies: false, companyIds: [c1.id] });
    await expect(invite(ca, { email: "novo@teste.local", roleIds: [id("controller")], kind: "INTERNAL", allCompanies: false, companyIds: [c1.id] })).rejects.toThrow(/não possui/);
    // Não desativa administrador da organização
    const admin = await prisma.membership.findFirstOrThrow({ where: { organizationId: a.org.id, userId: a.user.id } });
    await expect(setMembershipActive(ca, admin.id, false)).rejects.toThrow();
  });

  it("usuário de portal recebe só permissões de portal; chaves de API e exportação exigem alcance total", async () => {
    const a = await newOrg();
    const c1 = await createCompany(a.ctx, company("11222333000181"));
    const party = await prisma.party.create({ data: { organizationId: a.org.id, personType: "COMPANY", name: "Cliente X", isCustomer: true } });
    const client = await addUser(a.org.id, ["finance", "client_user"], { kind: "CLIENT", partyId: party.id });
    expect([...client.permissions].every((p) => p.startsWith("portal."))).toBe(true);
    const ca = await addUser(a.org.id, ["company_admin"], { companyIds: [c1.id] });
    await expect(createApiKey(ca, { name: "Chave restrita", scopes: ["read:parties"] })).rejects.toThrow(/todas as empresas/);
    expect(canReadDataExport(ca)).toBe(false);
    expect(canReadDataExport(a.ctx)).toBe(true);
    // Exportação/chave somem para quem perde o acesso
    const support = await buildCtx(a.user.id, a.org.id);
    expect(canReadDataExport({ ...support, support: true })).toBe(false);
  });

  it("configurar MFA não desativa um MFA já ativo", async () => {
    const a = await newOrg();
    await prisma.user.update({ where: { id: a.user.id }, data: { mfaEnabled: true, mfaSecret: "JBSWY3DPEHPK3PXP" } });
    await expect(beginMfaSetup(a.user.id)).rejects.toThrow(/já está ativa/);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: a.user.id } })).mfaEnabled).toBe(true);
  });
});
