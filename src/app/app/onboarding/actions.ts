"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { companySchema } from "@/modules/companies/service";
import { saveCompanyStep, financeStepSchema, saveFinanceStep, operationStepSchema, saveOperationStep, governanceStepSchema, saveGovernanceStep, saveChecklist, markStructureStep } from "@/modules/companies/onboarding";
import { zArray } from "@/lib/zod-helpers";

const companyStepActionImpl = makeAction(companySchema, async (ctx, i) => {
  await saveCompanyStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=2" };
});
const structureStepActionImpl = makeAction(z.object({}), async (ctx) => {
  await markStructureStep(ctx);
  return { redirectTo: "/app/onboarding?step=3" };
});
const financeStepActionImpl = makeAction(financeStepSchema, async (ctx, i) => {
  await saveFinanceStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=4" };
});
const operationStepActionImpl = makeAction(operationStepSchema, async (ctx, i) => {
  await saveOperationStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=5" };
});
const governanceStepActionImpl = makeAction(governanceStepSchema, async (ctx, i) => {
  await saveGovernanceStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=6" };
});
const checklistActionImpl = makeAction(z.object({ checked: zArray, finish: z.string().optional() }), async (ctx, i) => {
  await saveChecklist(ctx, i.checked, i.finish === "1");
  return i.finish === "1" ? { redirectTo: "/app?bemvindo=1" } : { message: "Checklist salvo. Você pode retomar depois." };
});

export async function companyStepAction(prev: ActionState | undefined, fd: FormData) {
  return companyStepActionImpl(prev, fd);
}
export async function structureStepAction(prev: ActionState | undefined, fd: FormData) {
  return structureStepActionImpl(prev, fd);
}
export async function financeStepAction(prev: ActionState | undefined, fd: FormData) {
  return financeStepActionImpl(prev, fd);
}
export async function operationStepAction(prev: ActionState | undefined, fd: FormData) {
  return operationStepActionImpl(prev, fd);
}
export async function governanceStepAction(prev: ActionState | undefined, fd: FormData) {
  return governanceStepActionImpl(prev, fd);
}
export async function checklistAction(prev: ActionState | undefined, fd: FormData) {
  return checklistActionImpl(prev, fd);
}
