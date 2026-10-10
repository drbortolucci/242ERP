/**
 * Dados de demonstração do módulo de estoque (idempotente: só cria se a organização demo ainda não tiver produtos).
 * Roda também em bancos de demonstração já existentes, para que o módulo novo apareça com dados.
 */
import { prisma } from "../src/server/db";
import { buildCtx } from "../src/server/context";
import "../src/modules/approvals/register-all";
import { decide } from "../src/modules/approvals/service";
import { createPurchaseOrder, submitPurchaseOrder, postReceipt, registerSupplierInvoice } from "../src/modules/procurement/service";
import { saveProduct, saveWarehouse, postManualMovement, createCategory, openCount, saveCountEntries } from "../src/modules/inventory/service";
import { saveProductOrder, confirmProductOrder, deliverProductOrder } from "../src/modules/inventory/orders";
import { addDays, minDate, monthStart, todayIn } from "../src/lib/dates";

const PRODUCTS = [
  { code: "NB-14", name: "Notebook 14\" para consultores", cat: "Equipamentos", unit: "UN", salePrice: "5900", minStock: "2", maxStock: "8", cost: "4200", qty: "5" },
  { code: "MON-27", name: "Monitor 27\"", cat: "Equipamentos", unit: "UN", salePrice: "1850", minStock: "3", maxStock: "10", cost: "1250", qty: "6" },
  { code: "LIC-OFF", name: "Licença de produtividade (12 meses)", cat: "Licenças revendidas", unit: "UN", salePrice: "690", minStock: "10", maxStock: "50", cost: "480", qty: "30" },
  { code: "CAB-HDMI", name: "Cabo HDMI 2 m", cat: "Acessórios", unit: "UN", salePrice: "45", minStock: "20", maxStock: "100", cost: "18", qty: "15" },
  { code: "KIT-TRN", name: "Kit de material de treinamento", cat: "Materiais de treinamento", unit: "KIT", salePrice: "120", minStock: "10", maxStock: "40", cost: "55", qty: "25" },
];

export async function seedInventory(passwordHash: string) {
  const org = await prisma.organization.findUnique({ where: { slug: "consultoria-demo" } });
  if (!org) return;
  if (await prisma.product.count({ where: { organizationId: org.id } })) return;
  const adminUser = await prisma.user.findUnique({ where: { email: "admin@demo.local" } });
  if (!adminUser) return;
  const admin = await buildCtx(adminUser.id, org.id);
  if (!admin.planModules.includes("inventory")) return;

  // Usuário de estoque/expedição
  const role = await prisma.role.findFirst({ where: { organizationId: org.id, key: "stock_keeper" } });
  const keeperUser = await prisma.user.upsert({ where: { email: "estoque@demo.local" }, create: { email: "estoque@demo.local", name: "Sérgio Estoque", passwordHash }, update: {} });
  if (role && !(await prisma.membership.findFirst({ where: { userId: keeperUser.id, organizationId: org.id } }))) {
    await prisma.membership.create({ data: { userId: keeperUser.id, organizationId: org.id, roleIds: [role.id], allCompanies: true, companyIds: [], kind: "INTERNAL" } });
  }
  const keeper = await buildCtx(keeperUser.id, org.id);

  const company = await prisma.company.findFirstOrThrow({ where: { organizationId: org.id, kind: "HEADQUARTERS" }, orderBy: { createdAt: "asc" } });
  const today = todayIn(admin.timezone);
  const d0 = monthStart(today);
  const d1 = minDate(addDays(d0, 1), today);
  const cd = await saveWarehouse(admin, { companyId: company.id, code: "ALM", name: "Almoxarifado central", allowNegative: false, active: true });
  await saveWarehouse(admin, { companyId: company.id, code: "CAMPO", name: "Estoque de campo (equipe de implantação)", allowNegative: false, active: true });
  const cats = new Map<string, string>();
  for (const name of [...new Set(PRODUCTS.map((p) => p.cat))]) cats.set(name, (await createCategory(admin, { name })).id);
  const ids: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const prod = await saveProduct(admin, { code: p.code, name: p.name, categoryId: cats.get(p.cat), kind: "GOODS", unit: p.unit, salePrice: p.salePrice, minStock: p.minStock, maxStock: p.maxStock, tracksStock: true, active: true });
    ids[p.code] = prod.id;
    await postManualMovement(keeper, { type: "OPENING", productId: prod.id, warehouseId: cd.id, date: d0, quantity: p.qty, unitCost: p.cost, reason: "Saldo de implantação do estoque" });
  }

  // Compra de reposição (item de estoque) com recebimento e documento do fornecedor
  const supplier = await prisma.party.findFirst({ where: { organizationId: org.id, isSupplier: true, active: true }, orderBy: { name: "asc" } });
  const cc = await prisma.costCenter.findFirst({ where: { organizationId: org.id, companyId: company.id } });
  const buyerUser = await prisma.user.findUnique({ where: { email: "compras@demo.local" } });
  const directorUser = await prisma.user.findUnique({ where: { email: "diretor@demo.local" } });
  if (supplier && cc && buyerUser && directorUser) {
    const buyer = await buildCtx(buyerUser.id, org.id);
    const director = await buildCtx(directorUser.id, org.id);
    const po = await createPurchaseOrder(buyer, { companyId: company.id, supplierPartyId: supplier.id, costCenterId: cc.id, warehouseId: cd.id, kind: "ONE_OFF", orderDate: d0, advanceAmount: "0", tolerancePct: "0", notes: "Reposição de estoque", lineKind: ["MATERIAL", "MATERIAL"], lineDescription: ["", ""], lineQuantity: ["4", "40"], linePrice: ["4100", "17.5"], lineProduct: [ids["NB-14"], ids["CAB-HDMI"]] });
    const sub = await submitPurchaseOrder(buyer, po.id);
    if (!sub.approved) {
      const ar = await prisma.approvalRequest.findFirst({ where: { entityId: po.id, status: "PENDING" } });
      if (ar) await decide(director, ar.id, true);
    }
    const lines = await prisma.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id } });
    await postReceipt(keeper, { purchaseOrderId: po.id, date: d1, kind: "GOODS_RECEIPT", lineId: lines.map((l) => l.id), quantity: lines.map((l) => l.quantity.toString()) });
    await registerSupplierInvoice(buyer, { purchaseOrderId: po.id, number: `NF-${po.number}`, issueDate: d1, dueDate: addDays(d1, 28), competence: d1, amount: po.totalAmount.toString() });
  }

  // Vendas: entregue, confirmada (com reserva) e rascunho
  const sellerUser = await prisma.user.findUnique({ where: { email: "comercial@demo.local" } });
  const customers = await prisma.party.findMany({ where: { organizationId: org.id, isCustomer: true, active: true }, orderBy: { name: "asc" }, take: 3 });
  const term = await prisma.paymentTerm.findFirst({ where: { organizationId: org.id, name: "30 dias" } });
  if (sellerUser && customers.length) {
    const seller = await buildCtx(sellerUser.id, org.id);
    const o1 = await saveProductOrder(seller, { companyId: company.id, partyId: customers[0].id, warehouseId: cd.id, orderDate: d1, paymentTermId: term?.id, freightAmount: "80", customerPo: "OC-7781", notes: "Equipamentos para a equipe do cliente", lineProduct: [ids["NB-14"], ids["MON-27"], ids["CAB-HDMI"]], lineQuantity: ["2", "2", "4"], linePrice: ["5900", "1850", "45"], lineDiscount: ["300", "0", "0"] });
    await confirmProductOrder(seller, o1.id);
    await deliverProductOrder(keeper, { id: o1.id, date: today });
    const o2 = await saveProductOrder(seller, { companyId: company.id, partyId: customers[Math.min(1, customers.length - 1)].id, warehouseId: cd.id, orderDate: today, paymentTermId: term?.id, freightAmount: "0", lineProduct: [ids["LIC-OFF"], ids["KIT-TRN"]], lineQuantity: ["12", "12"], linePrice: ["690", "120"], lineDiscount: ["0", "0"] });
    await confirmProductOrder(seller, o2.id);
    await saveProductOrder(seller, { companyId: company.id, partyId: customers[customers.length - 1].id, warehouseId: cd.id, orderDate: today, freightAmount: "0", lineProduct: [ids["MON-27"]], lineQuantity: ["1"], linePrice: ["1850"], lineDiscount: ["0"] });
  }

  // Inventário em andamento no almoxarifado (contagem parcial)
  const count = await openCount(keeper, { warehouseId: cd.id, date: today, onlyWithBalance: true, notes: "Contagem rotativa de acessórios" });
  const line = await prisma.inventoryCountLine.findFirst({ where: { countId: count.id, productId: ids["CAB-HDMI"] } });
  if (line) await saveCountEntries(keeper, { countId: count.id, lineId: [line.id], counted: [line.systemQty.minus(2).toString()] });
}
