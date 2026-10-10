import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import "@/modules/approvals/register-all";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { decide } from "@/modules/approvals/service";
import { createPurchaseOrder, submitPurchaseOrder, postReceipt, registerSupplierInvoice } from "@/modules/procurement/service";
import { saveProduct, saveWarehouse, postManualMovement, transferStock, openCount, saveCountEntries, postCount, stockPosition, reverseManualMovement } from "@/modules/inventory/service";
import { saveProductOrder, confirmProductOrder, deliverProductOrder, cancelProductOrder } from "@/modules/inventory/orders";
import { syncLedger, expectedPostings } from "@/modules/controlling/ledger";
import { settle } from "@/modules/finance/service";

const company = { kind: "HEADQUARTERS" as const, legalName: "Comércio e Serviços Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const product = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: `Produto ${code}`, kind: "GOODS" as const, unit: "UN", salePrice: "20", minStock: "5", tracksStock: true, active: true, ...extra });

async function setup() {
  const { ctx, org } = await newOrg();
  const c = await createCompany(ctx, company);
  const cc = await prisma.costCenter.create({ data: { organizationId: org.id, companyId: c.id, code: "100", name: "Operação" } });
  const wh = await saveWarehouse(ctx, { companyId: c.id, code: "CD", name: "Centro de distribuição", allowNegative: false, active: true });
  const wh2 = await saveWarehouse(ctx, { companyId: c.id, code: "LJ", name: "Loja", allowNegative: false, active: true });
  return { ctx, org, c, cc, wh, wh2 };
}

describe("estoque e vendas de produtos", () => {
  it("compra → entrada ao preço do pedido → venda ao custo médio → títulos → razão (receita e CMV, sem custo na compra) → cancelamento com retorno", async () => {
    const { ctx, org, c, cc, wh } = await setup();
    const p = await saveProduct(ctx, product("P1"));
    const sup = await createParty(ctx, { personType: "COMPANY", name: "Fornecedor de mercadorias", isSupplier: true, isCustomer: false, isProspect: false, isPartner: false });
    const cust = await createParty(ctx, { personType: "COMPANY", name: "Cliente varejo", isSupplier: false, isCustomer: true, isProspect: false, isPartner: false });
    const buyer = await addUser(org.id, ["purchasing"]);
    const approver = await addUser(org.id, ["director"]);

    // pedido com item de estoque exige depósito
    await expect(createPurchaseOrder(buyer, { companyId: c.id, supplierPartyId: sup.id, costCenterId: cc.id, kind: "ONE_OFF", orderDate: "2026-09-01", advanceAmount: "0", tolerancePct: "0", lineKind: ["MATERIAL"], lineDescription: [""], lineQuantity: ["10"], linePrice: ["8"], lineProduct: [p.id] })).rejects.toThrow(/depósito/);
    const po = await createPurchaseOrder(buyer, { companyId: c.id, supplierPartyId: sup.id, costCenterId: cc.id, warehouseId: wh.id, kind: "ONE_OFF", orderDate: "2026-09-01", advanceAmount: "0", tolerancePct: "0", lineKind: ["MATERIAL", "SERVICE"], lineDescription: ["", "Frete do fornecedor"], lineQuantity: ["10", "1"], linePrice: ["8", "20"], lineProduct: [p.id, ""] });
    expect(po.totalAmount.toString()).toBe("100");
    await submitPurchaseOrder(buyer, po.id);
    const ar = await prisma.approvalRequest.findFirstOrThrow({ where: { entityId: po.id, status: "PENDING" } });
    await decide(approver, ar.id, true);
    const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id }, orderBy: { amount: "desc" } });
    await postReceipt(buyer, { purchaseOrderId: po.id, date: "2026-09-02", kind: "GOODS_RECEIPT", lineId: lines.map((l) => l.id), quantity: ["10", "1"] });
    let bal = await prisma.stockBalance.findFirstOrThrow({ where: { productId: p.id, warehouseId: wh.id } });
    expect(bal.quantity.toString()).toBe("10");
    expect(bal.value.toString()).toBe("80");
    expect(await prisma.asset.count({ where: { purchaseOrderId: po.id } })).toBe(0); // item de estoque não vira ativo
    await registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: "NF-10", issueDate: "2026-09-02", dueDate: "2026-10-02", competence: "2026-09-02", amount: "100" });

    // segunda entrada a custo diferente (saldo inicial manual não é aceito depois de movimento)
    await expect(postManualMovement(ctx, { type: "OPENING", productId: p.id, warehouseId: wh.id, date: "2026-09-03", quantity: "1", unitCost: "1", reason: "implantação" })).rejects.toThrow(/Saldo inicial/);
    await postManualMovement(ctx, { type: "ADJUSTMENT_IN", productId: p.id, warehouseId: wh.id, date: "2026-09-03", quantity: "10", unitCost: "10", reason: "Sobra encontrada" });
    bal = await prisma.stockBalance.findFirstOrThrow({ where: { productId: p.id, warehouseId: wh.id } });
    expect(bal.avgCost.toString()).toBe("9");

    // ordem cronológica
    await expect(postManualMovement(ctx, { type: "ADJUSTMENT_OUT", productId: p.id, warehouseId: wh.id, date: "2026-09-01", quantity: "1", reason: "retroativo" })).rejects.toThrow(/ordem cronológica/);

    // venda: reserva, entrega, títulos
    const seller = await addUser(org.id, ["sales"]);
    await expect(saveProductOrder(seller, { companyId: c.id, partyId: sup.id, warehouseId: wh.id, orderDate: "2026-09-05", freightAmount: "0", lineProduct: [p.id], lineQuantity: ["1"], linePrice: ["20"], lineDiscount: ["0"] })).rejects.toThrow(/Cliente/);
    const term = await prisma.paymentTerm.findFirstOrThrow({ where: { organizationId: org.id, name: "30/60" } });
    const o = await saveProductOrder(seller, { companyId: c.id, partyId: cust.id, warehouseId: wh.id, orderDate: "2026-09-05", paymentTermId: term.id, freightAmount: "15", lineProduct: [p.id], lineQuantity: ["15"], linePrice: ["20"], lineDiscount: ["0"] });
    expect(o.totalAmount.toString()).toBe("315");
    await confirmProductOrder(seller, o.id);
    bal = await prisma.stockBalance.findFirstOrThrow({ where: { productId: p.id, warehouseId: wh.id } });
    expect(bal.reserved.toString()).toBe("15");
    // reserva impede vender o mesmo saldo duas vezes
    const o2 = await saveProductOrder(seller, { companyId: c.id, partyId: cust.id, warehouseId: wh.id, orderDate: "2026-09-05", freightAmount: "0", lineProduct: [p.id], lineQuantity: ["6"], linePrice: ["20"], lineDiscount: ["0"] });
    await expect(confirmProductOrder(seller, o2.id)).rejects.toThrow(/disponível 5/);
    await deliverProductOrder(seller, { id: o.id, date: "2026-09-06" });
    const delivered = await prisma.productOrder.findUniqueOrThrow({ where: { id: o.id } });
    expect(delivered.status).toBe("DELIVERED");
    expect(delivered.costAmount!.toString()).toBe("135"); // 15 × 9,00
    bal = await prisma.stockBalance.findFirstOrThrow({ where: { productId: p.id, warehouseId: wh.id } });
    expect(bal.quantity.toString()).toBe("5");
    expect(bal.reserved.toString()).toBe("0");
    expect(bal.value.toString()).toBe("45");
    const recs = await prisma.receivable.findMany({ where: { productOrderId: o.id }, orderBy: { installment: "asc" } });
    expect(recs.map((r) => r.amount.toString())).toEqual(["157.5", "157.5"]);

    // razão gerencial: receita (itens + frete), CMV; a NF da compra só lança a parte que não é estoque (frete 20)
    const posts = await expectedPostings(ctx, c.id, "2026-09-01");
    const byKey = (k: string) => posts.filter((x) => x.dedupeKey.startsWith(k)).map((x) => x.amount.toString());
    expect(byKey("GSALE:")).toEqual(expect.arrayContaining(["300", "15"]));
    expect(posts.filter((x) => x.sourceType === "COGS").map((x) => x.amount.toString())).toEqual(["135"]);
    expect(posts.filter((x) => x.sourceType === "STOCK_ADJUSTMENT").map((x) => x.amount.toString())).toEqual(["-100"]); // sobra reduz custo
    expect(posts.filter((x) => x.sourceType === "SUPPLIER_INVOICE").map((x) => x.amount.toString())).toEqual(["20"]);
    const r1 = await syncLedger(ctx, c.id, "2026-09-01");
    expect(r1.posted).toBeGreaterThanOrEqual(4);

    // cancelamento após entrega: bloqueado com recebimento; liberado sem
    const bank = await prisma.bankAccount.create({ data: { organizationId: org.id, companyId: c.id, name: "Banco", openingBalance: 0, openingDate: new Date("2026-01-01") } });
    const fin = await addUser(org.id, ["finance"]);
    await settle(fin, { kind: "RECEIVABLE", titleId: recs[0].id, date: "2026-09-10", principal: "10", interest: "0", fine: "0", discount: "0", bankAccountId: bank.id, idempotencyKey: "rcv-1" });
    await expect(cancelProductOrder(seller, o.id, "Cliente desistiu", "2026-09-11")).rejects.toThrow(/recebimento/);
    const o3 = await saveProductOrder(seller, { companyId: c.id, partyId: cust.id, warehouseId: wh.id, orderDate: "2026-09-12", freightAmount: "0", lineProduct: [p.id], lineQuantity: ["2"], linePrice: ["30"], lineDiscount: ["5"] });
    expect(o3.totalAmount.toString()).toBe("55");
    await confirmProductOrder(seller, o3.id);
    await deliverProductOrder(seller, { id: o3.id, date: "2026-09-12" });
    await syncLedger(ctx, c.id, "2026-09-01"); // receita do o3 lançada antes do cancelamento
    await cancelProductOrder(seller, o3.id, "Devolução integral", "2026-09-13");
    bal = await prisma.stockBalance.findFirstOrThrow({ where: { productId: p.id, warehouseId: wh.id } });
    expect(bal.quantity.toString()).toBe("5");
    expect(bal.value.toString()).toBe("45");
    expect((await prisma.receivable.findMany({ where: { productOrderId: o3.id } })).every((r) => r.status === "CANCELED")).toBe(true);
    const r2 = await syncLedger(ctx, c.id, "2026-09-01");
    expect(r2.reversed).toBe(1); // receita do pedido cancelado estornada
    const cogs = await expectedPostings(ctx, c.id, "2026-09-01");
    expect(cogs.filter((x) => x.sourceType === "COGS").map((x) => x.amount.toString()).sort()).toEqual(["-18", "135", "18"]);
  });

  it("transferência, consumo apropriado, inventário, permissões e isolamento", async () => {
    const { ctx, org, c, wh, wh2 } = await setup();
    const p = await saveProduct(ctx, product("M1", { kind: "MATERIAL" }));
    await expect(saveProduct(ctx, product("m1"))).rejects.toThrow(/Já existe/);
    await postManualMovement(ctx, { type: "OPENING", productId: p.id, warehouseId: wh.id, date: "2026-09-01", quantity: "20", unitCost: "2.5", reason: "Implantação" });
    const t = await transferStock(ctx, { productId: p.id, fromWarehouseId: wh.id, toWarehouseId: wh2.id, date: "2026-09-02", quantity: "8" });
    expect(t.in.totalCost.toString()).toBe("20");
    const prj = await prisma.project.findFirst({ where: { organizationId: org.id } });
    await expect(postManualMovement(ctx, { type: "CONSUMPTION", productId: p.id, warehouseId: wh2.id, date: "2026-09-03", quantity: "3", reason: "Aplicado em obra" })).rejects.toThrow(/projeto ou centro de custo/);
    const cc = await prisma.costCenter.findFirstOrThrow({ where: { organizationId: org.id } });
    const cons = await postManualMovement(ctx, { type: "CONSUMPTION", productId: p.id, warehouseId: wh2.id, date: "2026-09-03", quantity: "3", projectId: prj?.id, costCenterId: cc.id, reason: "Aplicado em serviço" });
    expect(cons.totalCost.toString()).toBe("-7.5");
    const rev = await reverseManualMovement(ctx, cons.id, "Lançado em duplicidade");
    expect(rev.totalCost.toString()).toBe("7.5");
    await expect(reverseManualMovement(ctx, cons.id, "de novo")).rejects.toThrow(/já estornado/);

    const count = await openCount(ctx, { warehouseId: wh.id, date: "2026-09-04", onlyWithBalance: true });
    await expect(openCount(ctx, { warehouseId: wh.id, date: "2026-09-04", onlyWithBalance: true })).rejects.toThrow(/aberto/);
    const cl = await prisma.inventoryCountLine.findMany({ where: { countId: count.id } });
    expect(cl.map((l) => l.systemQty.toString())).toEqual(["12"]);
    await saveCountEntries(ctx, { countId: count.id, lineId: [cl[0].id], counted: ["10"] });
    const r = await postCount(ctx, count.id);
    expect(r).toEqual({ counted: 1, adjusted: 1 });
    const pos = await stockPosition(ctx);
    const row = pos.rows.find((x) => x.product.id === p.id)!;
    expect(row.quantity.toString()).toBe("18"); // 10 no CD (inventário) + 8 na loja (consumo estornado)
    expect(row.value.toString()).toBe("45");

    // permissões: compras consulta e cadastra, mas não ajusta; consultor não acessa
    const buyer = await addUser(org.id, ["purchasing"]);
    await expect(postManualMovement(buyer, { type: "ADJUSTMENT_OUT", productId: p.id, warehouseId: wh.id, date: "2026-09-05", quantity: "1", reason: "perda" })).rejects.toThrow(/Permissão/);
    const consultant = await addUser(org.id, ["consultant"]);
    await expect(stockPosition(consultant)).rejects.toThrow(/Permissão/);
    const keeper = await addUser(org.id, ["stock_keeper"]);
    await postManualMovement(keeper, { type: "ADJUSTMENT_OUT", productId: p.id, warehouseId: wh.id, date: "2026-09-05", quantity: "1", reason: "Avaria" });

    // isolamento entre organizações
    const other = await newOrg();
    expect((await stockPosition(other.ctx)).rows).toHaveLength(0);
    await expect(postManualMovement(other.ctx, { type: "ADJUSTMENT_OUT", productId: p.id, warehouseId: wh.id, date: "2026-09-05", quantity: "1", reason: "x" })).rejects.toThrow();
    expect(c.id).toBeTruthy();
  });
});
