import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { conflict, notFound, validation } from "@/lib/errors";
import { zCnpj, zDate, zDecimal, zEmail, zOptId, zOptStr, zStr } from "@/lib/zod-helpers";
import { assertCompanyLimit } from "../saas/limits";
import { civil } from "@/lib/dates";
import { money } from "@/lib/money";

export const companySchema = z.object({
  kind: z.enum(["HEADQUARTERS", "BRANCH"]).default("HEADQUARTERS"),
  parentId: zOptId,
  legalName: zStr(2, "Informe a razão social"),
  tradeName: zOptStr,
  cnpj: zCnpj,
  stateRegistration: zOptStr,
  municipalRegistration: zOptStr,
  taxRegime: zOptStr,
  email: zEmail,
  phone: zOptStr,
  street: zOptStr,
  number: zOptStr,
  district: zOptStr,
  city: zOptStr,
  state: zOptStr,
  zip: zOptStr,
  municipalityCode: zOptStr,
  currency: z.string().default("BRL"),
  timezone: z.string().default("America/Sao_Paulo"),
  responsibleName: zOptStr,
  responsibleEmail: zEmail,
});
export type CompanyInput = z.infer<typeof companySchema>;

function companyData(i: CompanyInput) {
  return {
    kind: i.kind, parentId: i.kind === "BRANCH" ? i.parentId ?? null : null, legalName: i.legalName, tradeName: i.tradeName ?? null, cnpj: i.cnpj,
    stateRegistration: i.stateRegistration ?? null, municipalRegistration: i.municipalRegistration ?? null, taxRegime: i.taxRegime ?? null,
    email: i.email ?? null, phone: i.phone ?? null,
    address: { street: i.street ?? "", number: i.number ?? "", district: i.district ?? "", city: i.city ?? "", state: i.state ?? "", zip: i.zip ?? "" },
    municipalityCode: i.municipalityCode ?? null, currency: i.currency, timezone: i.timezone, responsibleName: i.responsibleName ?? null, responsibleEmail: i.responsibleEmail ?? null,
  };
}

async function validateBranch(ctx: Ctx, i: CompanyInput) {
  if (i.kind !== "BRANCH") return;
  if (!i.parentId) throw validation("Filial exige a matriz.");
  const parent = await ctx.db.company.findFirst({ where: { id: i.parentId } });
  if (!parent) throw validation("Matriz não encontrada.");
  if (parent.cnpj.slice(0, 8) !== i.cnpj.slice(0, 8)) throw validation("A filial deve ter a mesma raiz de CNPJ (8 primeiros dígitos) da matriz.");
}

export async function createCompany(ctx: Ctx, i: CompanyInput) {
  requirePerm(ctx, "company.manage");
  requireWritable(ctx);
  await assertCompanyLimit(ctx.orgId, 1);
  if (await ctx.db.company.findFirst({ where: { cnpj: i.cnpj } })) throw conflict("Já existe empresa com este CNPJ nesta organização.");
  await validateBranch(ctx, i);
  const c = await ctx.db.company.create({ data: { organizationId: ctx.orgId, ...companyData(i) } });
  await audit(ctx, { action: "company.create", entity: "Company", entityId: c.id, companyId: c.id, changes: { legalName: c.legalName, cnpj: c.cnpj } });
  return c;
}

export async function updateCompany(ctx: Ctx, id: string, i: CompanyInput) {
  requirePerm(ctx, "company.manage");
  requireWritable(ctx);
  const before = await ctx.db.company.findFirst({ where: { id } });
  if (!before) throw notFound("Empresa");
  if (before.cnpj !== i.cnpj && (await ctx.db.company.findFirst({ where: { cnpj: i.cnpj, NOT: { id } } }))) throw conflict("Já existe empresa com este CNPJ.");
  await validateBranch(ctx, i);
  const after = await ctx.db.company.update({ where: { id }, data: companyData(i) });
  await audit(ctx, { action: "company.update", entity: "Company", entityId: id, companyId: id, changes: diff(before, after) });
  return after;
}

export async function setCompanyActive(ctx: Ctx, id: string, active: boolean) {
  requirePerm(ctx, "company.manage");
  requireWritable(ctx);
  const c = await ctx.db.company.findFirst({ where: { id } });
  if (!c) throw notFound("Empresa");
  if (active) await assertCompanyLimit(ctx.orgId, 1);
  await ctx.db.company.update({ where: { id }, data: { active } });
  await audit(ctx, { action: active ? "company.activate" : "company.deactivate", entity: "Company", entityId: id, companyId: id });
}

export const bankAccountSchema = z.object({
  companyId: z.string().min(1, "Selecione a empresa"),
  name: zStr(2, "Informe o nome da conta"),
  bankCode: zOptStr,
  agency: zOptStr,
  accountNumber: zOptStr,
  openingBalance: zDecimal,
  openingDate: zDate,
});

export async function createBankAccount(ctx: Ctx, i: z.infer<typeof bankAccountSchema>) {
  requirePerm(ctx, "company.manage");
  requireWritable(ctx);
  if (!(await ctx.db.company.findFirst({ where: { id: i.companyId } }))) throw validation("Empresa inválida.");
  const a = await ctx.db.bankAccount.create({
    data: { organizationId: ctx.orgId, companyId: i.companyId, name: i.name, bankCode: i.bankCode ?? null, agency: i.agency ?? null, accountNumber: i.accountNumber ?? null, openingBalance: money(i.openingBalance), openingDate: civil(i.openingDate) },
  });
  await audit(ctx, { action: "bank_account.create", entity: "BankAccount", entityId: a.id, companyId: i.companyId, changes: { name: i.name, openingBalance: i.openingBalance } });
  return a;
}

export async function listCompanies(ctx: Ctx, onlyActive = false) {
  return ctx.db.company.findMany({ where: onlyActive ? { active: true } : {}, orderBy: [{ kind: "asc" }, { legalName: "asc" }] });
}

export async function companyOptions(ctx: Ctx) {
  const cs = await listCompanies(ctx, true);
  return cs.map((c) => ({ value: c.id, label: c.tradeName || c.legalName }));
}
