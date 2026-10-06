"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import * as S from "@/modules/config/special";

const saveCalendarActionImpl = makeAction(S.calendarSchema, async (ctx, i) => { await S.saveCalendar(ctx, i); return { revalidate: ["/app/config/calendarios"], message: "Calendário salvo." }; });
const addHolidayActionImpl = makeAction(S.holidaySchema, async (ctx, i) => { await S.addHoliday(ctx, i); return { revalidate: ["/app/config/calendarios"], message: "Feriado incluído." }; });
const removeHolidayActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await S.removeHoliday(ctx, i.id); return { revalidate: ["/app/config/calendarios"] }; });
const savePaymentTermActionImpl = makeAction(S.paymentTermSchema.extend({ days: z.preprocess((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]), z.array(z.coerce.number().int().min(0))), percents: z.preprocess((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]), z.array(z.string())) }), async (ctx, i) => { await S.savePaymentTerm(ctx, i); return { revalidate: ["/app/config/condicoes-pagamento"], message: "Condição salva." }; });
const createPriceTableActionImpl = makeAction(S.priceTableSchema, async (ctx, i) => { await S.createPriceTable(ctx, i); return { revalidate: ["/app/config/tabelas-preco"], message: "Tabela criada." }; });
const addPriceItemActionImpl = makeAction(S.priceItemSchema, async (ctx, i) => { await S.addPriceItem(ctx, i); return { revalidate: ["/app/config/tabelas-preco"], message: "Tarifa salva." }; });
const saveSlaActionImpl = makeAction(S.slaSchema, async (ctx, i) => { await S.saveSla(ctx, i); return { revalidate: ["/app/config/sla"], message: "SLA salvo." }; });
const savePoliciesActionImpl = makeAction(S.policySchema, async (ctx, i) => { await S.savePolicies(ctx, i); return { revalidate: ["/app/config/politicas"], message: "Políticas salvas." }; });
const saveSequenceActionImpl = makeAction(S.sequenceSchema, async (ctx, i) => { await S.saveSequence(ctx, i); return { revalidate: ["/app/config/numeracao"], message: "Numeração salva." }; });
const saveIntegrationActionImpl = makeAction(S.integrationSchema, async (ctx, i) => { await S.saveIntegration(ctx, i); return { revalidate: ["/app/config/integracoes"], message: "Integração salva." }; });

export async function saveCalendarAction(prev: ActionState | undefined, fd: FormData) {
  return saveCalendarActionImpl(prev, fd);
}
export async function addHolidayAction(prev: ActionState | undefined, fd: FormData) {
  return addHolidayActionImpl(prev, fd);
}
export async function removeHolidayAction(prev: ActionState | undefined, fd: FormData) {
  return removeHolidayActionImpl(prev, fd);
}
export async function savePaymentTermAction(prev: ActionState | undefined, fd: FormData) {
  return savePaymentTermActionImpl(prev, fd);
}
export async function createPriceTableAction(prev: ActionState | undefined, fd: FormData) {
  return createPriceTableActionImpl(prev, fd);
}
export async function addPriceItemAction(prev: ActionState | undefined, fd: FormData) {
  return addPriceItemActionImpl(prev, fd);
}
export async function saveSlaAction(prev: ActionState | undefined, fd: FormData) {
  return saveSlaActionImpl(prev, fd);
}
export async function savePoliciesAction(prev: ActionState | undefined, fd: FormData) {
  return savePoliciesActionImpl(prev, fd);
}
export async function saveSequenceAction(prev: ActionState | undefined, fd: FormData) {
  return saveSequenceActionImpl(prev, fd);
}
export async function saveIntegrationAction(prev: ActionState | undefined, fd: FormData) {
  return saveIntegrationActionImpl(prev, fd);
}
