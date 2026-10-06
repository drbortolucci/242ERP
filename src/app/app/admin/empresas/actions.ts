"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { companySchema, createCompany, updateCompany, setCompanyActive, bankAccountSchema, createBankAccount } from "@/modules/companies/service";

const createCompanyActionImpl = makeAction(companySchema, async (ctx, i) => {
  const c = await createCompany(ctx, i);
  return { redirectTo: `/app/admin/empresas/${c.id}` };
});
const updateCompanyActionImpl = makeAction(companySchema.extend({ id: z.string() }), async (ctx, i) => {
  await updateCompany(ctx, i.id, i);
  return { revalidate: [`/app/admin/empresas/${i.id}`], message: "Empresa atualizada." };
});
const toggleCompanyActionImpl = makeAction(z.object({ id: z.string(), active: z.enum(["true", "false"]) }), async (ctx, i) => {
  await setCompanyActive(ctx, i.id, i.active === "true");
  return { revalidate: ["/app/admin/empresas"] };
});
const createBankAccountActionImpl = makeAction(bankAccountSchema, async (ctx, i) => {
  await createBankAccount(ctx, i);
  return { revalidate: [`/app/admin/empresas/${i.companyId}`], message: "Conta bancária cadastrada." };
});

export async function createCompanyAction(prev: ActionState | undefined, fd: FormData) {
  return createCompanyActionImpl(prev, fd);
}
export async function updateCompanyAction(prev: ActionState | undefined, fd: FormData) {
  return updateCompanyActionImpl(prev, fd);
}
export async function toggleCompanyAction(prev: ActionState | undefined, fd: FormData) {
  return toggleCompanyActionImpl(prev, fd);
}
export async function createBankAccountAction(prev: ActionState | undefined, fd: FormData) {
  return createBankAccountActionImpl(prev, fd);
}
