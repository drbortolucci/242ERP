"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { zDate } from "@/lib/zod-helpers";
import * as A from "@/modules/accounting/service";

const chartImpl = makeAction(z.object({}), async (ctx) => { const r = await A.ensureSuggestedChart(ctx); return { revalidate: ["/app/contabilidade/plano"], message: r.created ? `Plano sugerido criado (${r.created} contas). Revise com o contador.` : "A organização já possui plano de contas." }; });
const accountImpl = makeAction(A.accountSchema, async (ctx, i) => { await A.saveLedgerAccount(ctx, i); return { revalidate: ["/app/contabilidade/plano"], message: "Conta salva." }; });
const mappingImpl = makeAction(A.mappingSchema, async (ctx, i) => { await A.saveMapping(ctx, i); return { revalidate: ["/app/contabilidade/plano"], message: "De-para salvo." }; });
const syncImpl = makeAction(z.object({ companyId: z.string().min(1), month: zDate }), async (ctx, i) => { const r = await A.syncJournal(ctx, i.companyId, i.month); return { revalidate: ["/app/contabilidade/lancamentos"], message: `Contabilização: ${r.posted} lançamento(s) novo(s) de ${r.expected} operação(ões)${r.skipped.length ? `; ${r.skipped.length} desbalanceada(s) para revisão` : ""}.` }; });
const manualImpl = makeAction(A.manualEntrySchema, async (ctx, i) => { const je = await A.createManualEntry(ctx, i); return { revalidate: ["/app/contabilidade/lancamentos"], message: `Lançamento ${je.number} registrado.` }; });
const reverseImpl = makeAction(z.object({ id: z.string(), reason: z.string(), date: zDate }), async (ctx, i) => { const r = await A.reverseEntry(ctx, i.id, i.reason, i.date); return { revalidate: ["/app/contabilidade/lancamentos"], message: `Estorno ${r.number} registrado.` }; });

export async function suggestedChartAction(prev: ActionState | undefined, fd: FormData) { return chartImpl(prev, fd); }
export async function saveAccountAction(prev: ActionState | undefined, fd: FormData) { return accountImpl(prev, fd); }
export async function saveMappingAction(prev: ActionState | undefined, fd: FormData) { return mappingImpl(prev, fd); }
export async function syncJournalAction(prev: ActionState | undefined, fd: FormData) { return syncImpl(prev, fd); }
export async function manualEntryAction(prev: ActionState | undefined, fd: FormData) { return manualImpl(prev, fd); }
export async function reverseEntryAction(prev: ActionState | undefined, fd: FormData) { return reverseImpl(prev, fd); }
