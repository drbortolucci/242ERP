"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { companySchema, createCompany, updateCompany, setCompanyActive, bankAccountSchema, createBankAccount } from "@/modules/companies/service";

export const createCompanyAction = makeAction(companySchema, async (ctx, i) => {
  const c = await createCompany(ctx, i);
  return { redirectTo: `/app/admin/empresas/${c.id}` };
});
export const updateCompanyAction = makeAction(companySchema.extend({ id: z.string() }), async (ctx, i) => {
  await updateCompany(ctx, i.id, i);
  return { revalidate: [`/app/admin/empresas/${i.id}`], message: "Empresa atualizada." };
});
export const toggleCompanyAction = makeAction(z.object({ id: z.string(), active: z.enum(["true", "false"]) }), async (ctx, i) => {
  await setCompanyActive(ctx, i.id, i.active === "true");
  return { revalidate: ["/app/admin/empresas"] };
});
export const createBankAccountAction = makeAction(bankAccountSchema, async (ctx, i) => {
  await createBankAccount(ctx, i);
  return { revalidate: [`/app/admin/empresas/${i.companyId}`], message: "Conta bancária cadastrada." };
});
