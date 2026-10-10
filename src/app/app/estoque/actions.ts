"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { zDate } from "@/lib/zod-helpers";
import * as S from "@/modules/inventory/service";
import * as O from "@/modules/inventory/orders";

const saveProductImpl = makeAction(S.productSchema, async (ctx, i) => { const p = await S.saveProduct(ctx, i); return i.id ? { revalidate: [`/app/estoque/produtos/${p.id}`], message: "Produto salvo." } : { redirectTo: `/app/estoque/produtos/${p.id}` }; });
const createCategoryImpl = makeAction(S.categorySchema, async (ctx, i) => { await S.createCategory(ctx, i); return { revalidate: ["/app/estoque/produtos"], message: "Categoria criada." }; });
const saveWarehouseImpl = makeAction(S.warehouseSchema, async (ctx, i) => { await S.saveWarehouse(ctx, i); return { revalidate: ["/app/estoque/depositos"], message: "Depósito salvo." }; });
const manualMovementImpl = makeAction(S.manualMovementSchema, async (ctx, i) => { const m = await S.postManualMovement(ctx, i); return { revalidate: ["/app/estoque/movimentos", `/app/estoque/produtos/${i.productId}`], message: `Movimento ${m.number} lançado.` }; });
const reverseMovementImpl = makeAction(z.object({ id: z.string(), reason: z.string() }), async (ctx, i) => { const m = await S.reverseManualMovement(ctx, i.id, i.reason); return { revalidate: ["/app/estoque/movimentos"], message: `Estorno ${m.number} lançado.` }; });
const transferImpl = makeAction(S.transferSchema, async (ctx, i) => { const r = await S.transferStock(ctx, i); return { revalidate: ["/app/estoque/movimentos", "/app/estoque/posicao"], message: `Transferência ${r.ref} registrada.` }; });
const openCountImpl = makeAction(S.countSchema, async (ctx, i) => { const c = await S.openCount(ctx, i); return { redirectTo: `/app/estoque/inventarios/${c.id}` }; });
const saveCountImpl = makeAction(S.countEntrySchema, async (ctx, i) => { const r = await S.saveCountEntries(ctx, i); return { revalidate: [`/app/estoque/inventarios/${i.countId}`], message: `${r.saved} contagem(ns) gravada(s).` }; });
const postCountImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { const r = await S.postCount(ctx, i.id); return { revalidate: [`/app/estoque/inventarios/${i.id}`], message: `Inventário encerrado: ${r.counted} item(ns) contado(s), ${r.adjusted} ajuste(s).` }; });
const cancelCountImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await S.cancelCount(ctx, i.id); return { revalidate: [`/app/estoque/inventarios/${i.id}`], message: "Inventário cancelado." }; });
const saveOrderImpl = makeAction(O.productOrderSchema, async (ctx, i) => { const o = await O.saveProductOrder(ctx, i); return i.id ? { revalidate: [`/app/estoque/vendas/${o.id}`], message: "Pedido salvo." } : { redirectTo: `/app/estoque/vendas/${o.id}` }; });
const confirmOrderImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await O.confirmProductOrder(ctx, i.id); return { revalidate: [`/app/estoque/vendas/${i.id}`], message: "Pedido confirmado e itens reservados." }; });
const deliverOrderImpl = makeAction(O.deliverSchema, async (ctx, i) => { await O.deliverProductOrder(ctx, i); return { revalidate: [`/app/estoque/vendas/${i.id}`], message: "Entrega registrada: estoque baixado e títulos a receber gerados." }; });
const cancelOrderImpl = makeAction(z.object({ id: z.string(), reason: z.string(), date: zDate }), async (ctx, i) => { await O.cancelProductOrder(ctx, i.id, i.reason, i.date); return { revalidate: [`/app/estoque/vendas/${i.id}`], message: "Pedido cancelado." }; });

export async function saveProductAction(prev: ActionState | undefined, fd: FormData) { return saveProductImpl(prev, fd); }
export async function createCategoryAction(prev: ActionState | undefined, fd: FormData) { return createCategoryImpl(prev, fd); }
export async function saveWarehouseAction(prev: ActionState | undefined, fd: FormData) { return saveWarehouseImpl(prev, fd); }
export async function manualMovementAction(prev: ActionState | undefined, fd: FormData) { return manualMovementImpl(prev, fd); }
export async function reverseMovementAction(prev: ActionState | undefined, fd: FormData) { return reverseMovementImpl(prev, fd); }
export async function transferAction(prev: ActionState | undefined, fd: FormData) { return transferImpl(prev, fd); }
export async function openCountAction(prev: ActionState | undefined, fd: FormData) { return openCountImpl(prev, fd); }
export async function saveCountAction(prev: ActionState | undefined, fd: FormData) { return saveCountImpl(prev, fd); }
export async function postCountAction(prev: ActionState | undefined, fd: FormData) { return postCountImpl(prev, fd); }
export async function cancelCountAction(prev: ActionState | undefined, fd: FormData) { return cancelCountImpl(prev, fd); }
export async function saveOrderAction(prev: ActionState | undefined, fd: FormData) { return saveOrderImpl(prev, fd); }
export async function confirmOrderAction(prev: ActionState | undefined, fd: FormData) { return confirmOrderImpl(prev, fd); }
export async function deliverOrderAction(prev: ActionState | undefined, fd: FormData) { return deliverOrderImpl(prev, fd); }
export async function cancelOrderAction(prev: ActionState | undefined, fd: FormData) { return cancelOrderImpl(prev, fd); }
