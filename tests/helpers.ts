import { prisma } from "@/server/db";
import { buildCtx, type Ctx } from "@/server/context";
import { provisionOrganization } from "@/modules/saas/provision";
import { ensurePlans } from "@/modules/saas/plans";
import { hashPassword } from "@/server/auth/crypto";

let seq = 0;
export function uid(prefix = "t") {
  seq += 1;
  return `${prefix}${Date.now().toString(36)}${seq}`;
}

export async function newOrg(opts: { name?: string; plan?: string; sector?: string } = {}) {
  await ensurePlans();
  const email = `${uid("admin")}@teste.local`;
  const { org, user } = await provisionOrganization({ orgName: opts.name ?? uid("Org "), userName: "Admin Teste", email, password: "SenhaForte123", planCode: opts.plan ?? "ENTERPRISE", sector: opts.sector });
  const ctx = await buildCtx(user.id, org.id);
  return { org, user, ctx };
}

const pwHashPromise = hashPassword("SenhaForte123");

/** Cria usuário com perfis indicados na organização. */
export async function addUser(orgId: string, roleKeys: string[], opts: { companyIds?: string[]; kind?: "INTERNAL" | "CLIENT"; partyId?: string; professionalId?: string } = {}): Promise<Ctx> {
  const roles = await prisma.role.findMany({ where: { organizationId: orgId, key: { in: roleKeys } } });
  const user = await prisma.user.create({ data: { email: `${uid("u")}@teste.local`, name: `Usuário ${roleKeys.join("+")}`, passwordHash: await pwHashPromise } });
  await prisma.membership.create({
    data: {
      userId: user.id, organizationId: orgId, roleIds: roles.map((r) => r.id), kind: opts.kind ?? "INTERNAL",
      allCompanies: !opts.companyIds, companyIds: opts.companyIds ?? [], partyId: opts.partyId ?? null, professionalId: opts.professionalId ?? null,
    },
  });
  return buildCtx(user.id, orgId);
}
