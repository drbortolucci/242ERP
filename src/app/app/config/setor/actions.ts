"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { applySectorProfile, saveProjectTypeTemplate, saveTerms, sectorSchema, termsSchema } from "@/modules/sectors/service";

const applySectorActionImpl = makeAction(sectorSchema, async (ctx, i) => {
  const r = await applySectorProfile(ctx, i.sector);
  const n = r.projectTypes + r.teamRoles + r.services + r.expenseCategories + r.skills;
  return { revalidate: ["/app", "/app/config/setor"], message: n ? `Setor aplicado. Acrescentados: ${r.projectTypes} tipo(s) de projeto, ${r.teamRoles} papel(éis), ${r.services} serviço(s), ${r.expenseCategories} categoria(s) de despesa, ${r.skills} competência(s).` : "Setor aplicado. Nenhum item novo a acrescentar." };
});

const saveTermsActionImpl = makeAction(termsSchema, async (ctx, i) => {
  await saveTerms(ctx, i);
  return { revalidate: ["/app", "/app/config/setor"], message: "Terminologia salva." };
});

const saveWbsTemplateActionImpl = makeAction(z.object({ projectTypeId: z.string(), text: z.string().max(20000).optional() }), async (ctx, i) => {
  const t = await saveProjectTypeTemplate(ctx, i.projectTypeId, i.text ?? "");
  return { revalidate: ["/app/config/setor"], message: t ? "Modelo próprio salvo." : "Modelo próprio removido; vale o modelo da biblioteca." };
});

export async function applySectorAction(prev: ActionState | undefined, fd: FormData) {
  return applySectorActionImpl(prev, fd);
}
export async function saveTermsAction(prev: ActionState | undefined, fd: FormData) {
  return saveTermsActionImpl(prev, fd);
}
export async function saveWbsTemplateAction(prev: ActionState | undefined, fd: FormData) {
  return saveWbsTemplateActionImpl(prev, fd);
}
