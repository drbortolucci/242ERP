"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { professionalSchema, createProfessional, updateProfessional, setProfessionalActive, costRateSchema, addCostRate, absenceSchema, addAbsence } from "@/modules/professionals/service";

const createProfessionalActionImpl = makeAction(professionalSchema, async (ctx, i) => {
  const p = await createProfessional(ctx, i);
  return { redirectTo: `/app/cadastros/profissionais/${p.id}` };
});
const updateProfessionalActionImpl = makeAction(professionalSchema.extend({ id: z.string() }), async (ctx, i) => {
  await updateProfessional(ctx, i.id, i);
  return { revalidate: [`/app/cadastros/profissionais/${i.id}`], message: "Profissional atualizado." };
});
const toggleProfessionalActionImpl = makeAction(z.object({ id: z.string(), active: z.enum(["true", "false"]) }), async (ctx, i) => {
  await setProfessionalActive(ctx, i.id, i.active === "true");
  return { revalidate: [`/app/cadastros/profissionais/${i.id}`] };
});
const addCostRateActionImpl = makeAction(costRateSchema, async (ctx, i) => {
  await addCostRate(ctx, i);
  return { revalidate: [`/app/cadastros/profissionais/${i.professionalId}`], message: "Custo/hora registrado com vigência." };
});
const addAbsenceActionImpl = makeAction(absenceSchema, async (ctx, i) => {
  await addAbsence(ctx, i);
  return { revalidate: [`/app/cadastros/profissionais/${i.professionalId}`], message: "Ausência registrada." };
});

export async function createProfessionalAction(prev: ActionState | undefined, fd: FormData) {
  return createProfessionalActionImpl(prev, fd);
}
export async function updateProfessionalAction(prev: ActionState | undefined, fd: FormData) {
  return updateProfessionalActionImpl(prev, fd);
}
export async function toggleProfessionalAction(prev: ActionState | undefined, fd: FormData) {
  return toggleProfessionalActionImpl(prev, fd);
}
export async function addCostRateAction(prev: ActionState | undefined, fd: FormData) {
  return addCostRateActionImpl(prev, fd);
}
export async function addAbsenceAction(prev: ActionState | undefined, fd: FormData) {
  return addAbsenceActionImpl(prev, fd);
}
