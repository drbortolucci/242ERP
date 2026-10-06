"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { companySchema } from "@/modules/companies/service";
import { saveCompanyStep, financeStepSchema, saveFinanceStep, operationStepSchema, saveOperationStep, governanceStepSchema, saveGovernanceStep, saveChecklist, markStructureStep } from "@/modules/companies/onboarding";
import { zArray } from "@/lib/zod-helpers";

export const companyStepAction = makeAction(companySchema, async (ctx, i) => {
  await saveCompanyStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=2" };
});
export const structureStepAction = makeAction(z.object({}), async (ctx) => {
  await markStructureStep(ctx);
  return { redirectTo: "/app/onboarding?step=3" };
});
export const financeStepAction = makeAction(financeStepSchema, async (ctx, i) => {
  await saveFinanceStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=4" };
});
export const operationStepAction = makeAction(operationStepSchema, async (ctx, i) => {
  await saveOperationStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=5" };
});
export const governanceStepAction = makeAction(governanceStepSchema, async (ctx, i) => {
  await saveGovernanceStep(ctx, i);
  return { redirectTo: "/app/onboarding?step=6" };
});
export const checklistAction = makeAction(z.object({ checked: zArray, finish: z.string().optional() }), async (ctx, i) => {
  await saveChecklist(ctx, i.checked, i.finish === "1");
  return i.finish === "1" ? { redirectTo: "/app?bemvindo=1" } : { message: "Checklist salvo. Você pode retomar depois." };
});
