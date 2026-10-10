import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { prisma } from "@/server/db";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { saveProduct, saveWarehouse, postManualMovement } from "@/modules/inventory/service";
import { saveProductOrder, confirmProductOrder } from "@/modules/inventory/orders";
import { saveProductRule, validateProductRule, requestProductInvoice, cancelFiscalDocument, retryFiscalDocument, pickRule, estimateTaxes } from "@/modules/fiscal/service";

const company = { kind: "HEADQUARTERS" as const, legalName: "Comércio Fiscal Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };

async function setup() {
  const { ctx, org } = await newOrg();
  const c = await createCompany(ctx, company);
  const wh = await saveWarehouse(ctx, { companyId: c.id, code: "CD", name: "CD", allowNegative: false, active: true });
  const p1 = await saveProduct(ctx, { code: "A1", name: "Produto com NCM", kind: "GOODS", unit: "UN", salePrice: "100", minStock: "0", ncm: "84713012", tracksStock: true, active: true });
  const p2 = await saveProduct(ctx, { code: "B2", name: "Produto específico", kind: "GOODS", unit: "UN", salePrice: "50", minStock: "0", ncm: "85176241", tracksStock: true, active: true });
  for (const p of [p1, p2]) await postManualMovement(ctx, { type: "OPENING", productId: p.id, warehouseId: wh.id, date: "2026-10-01", quantity: "10", unitCost: "10", reason: "Implantação" });
  const cust = await createParty(ctx, { personType: "COMPANY", name: "Cliente NF-e S.A.", document: "11444777000161", isCustomer: true, isSupplier: false, isProspect: false, isPartner: false });
  const o = await saveProductOrder(ctx, { companyId: c.id, partyId: cust.id, warehouseId: wh.id, orderDate: "2026-10-02", freightAmount: "0", lineProduct: [p1.id, p2.id], lineQuantity: ["1", "2"], linePrice: ["100", "50"], lineDiscount: ["0", "0"] });
  return { ctx, org, c, p1, p2, o };
}

describe("fiscal: regras de produto e NF-e", () => {
  it("exige regra vigente e validada por item; aplica a específica do produto antes da do NCM; emite, cancela com justificativa", async () => {
    const { ctx, org, c, p1, p2, o } = await setup();
    const fiscalUser = await addUser(org.id, ["fiscal"]);
    const fin = await addUser(org.id, ["finance"]);
    await expect(requestProductInvoice(fin, o.id)).rejects.toThrow(/confirmado ou entregue/);
    await confirmProductOrder(ctx, o.id);
    await expect(requestProductInvoice(fin, o.id)).rejects.toThrow(/Sem regra fiscal.*A1, B2|Sem regra fiscal.*B2, A1/);

    await expect(saveProductRule(fiscalUser, { companyId: c.id, name: "Sem alvo", cfop: "5102", validFrom: "2026-01-01", active: true })).rejects.toThrow(/produto ou o NCM/);
    await expect(saveProductRule(fiscalUser, { companyId: c.id, name: "CFOP inválido", ncm: "84713012", cfop: "51", validFrom: "2026-01-01", active: true })).rejects.toThrow();
    const byNcm = await saveProductRule(fiscalUser, { companyId: c.id, name: "Venda NCM 8471", ncm: "84713012", cfop: "5102", icmsCst: "00", icmsRatePct: "18", pisCst: "01", pisRatePct: "1.65", cofinsCst: "01", cofinsRatePct: "7.6", validFrom: "2026-01-01", active: true });
    const generic = await saveProductRule(fiscalUser, { companyId: c.id, name: "NCM do B2", ncm: "85176241", cfop: "5102", icmsRatePct: "12", validFrom: "2026-01-01", active: true });
    const specific = await saveProductRule(fiscalUser, { companyId: c.id, name: "B2 específico", productId: p2.id, cfop: "5405", icmsCst: "60", validFrom: "2026-01-01", active: true });
    // sem validação ainda não emite
    await expect(requestProductInvoice(fin, o.id)).rejects.toThrow(/validada/);
    // financeiro não valida regra
    await expect(validateProductRule(fin, { id: byNcm.id, validatedBy: "Fulano" })).rejects.toThrow(/Permissão/);
    for (const r of [byNcm, generic, specific]) await validateProductRule(fiscalUser, { id: r.id, validatedBy: "Contadora Responsável CRC 1SP000000" });
    const rules = await prisma.fiscalProductRule.findMany({ where: { companyId: c.id } });
    expect(pickRule(rules, { id: p2.id, ncm: p2.ncm }, c.id, "2026-10-10")?.cfop).toBe("5405");
    expect(pickRule(rules, { id: p1.id, ncm: p1.ncm }, c.id, "2026-10-10")?.cfop).toBe("5102");
    expect(pickRule(rules, { id: p1.id, ncm: p1.ncm }, c.id, "2025-12-31")).toBeNull();
    expect(estimateTaxes("100", byNcm).icms.toString()).toBe("18");
    expect(estimateTaxes("100", byNcm).cofins.toString()).toBe("7.6");

    // alterar regra exige nova validação
    await saveProductRule(fiscalUser, { id: specific.id, companyId: c.id, name: "B2 específico", productId: p2.id, cfop: "5405", icmsCst: "60", validFrom: "2026-01-01", active: true });
    expect((await prisma.fiscalProductRule.findUniqueOrThrow({ where: { id: specific.id } })).validatedAt).toBeNull();
    await validateProductRule(fiscalUser, { id: specific.id, validatedBy: "Contadora Responsável CRC 1SP000000" });

    const fd = await requestProductInvoice(fin, o.id);
    expect(fd?.status).toBe("AUTHORIZED");
    expect(fd?.environment).toBe("SIMULATED");
    expect(fd?.number).toMatch(/^SIM-NFE-/);
    const payload = fd?.requestPayload as { items: { code: string; cfop: string }[] };
    expect(payload.items.find((i) => i.code === "B2")?.cfop).toBe("5405");
    expect((await prisma.productOrder.findUniqueOrThrow({ where: { id: o.id } })).fiscalStatus).toBe("AUTHORIZED");
    await expect(requestProductInvoice(fin, o.id)).rejects.toThrow(/já autorizada/);

    await expect(cancelFiscalDocument(fin, { id: fd!.id, reason: "curta" })).rejects.toThrow();
    await cancelFiscalDocument(fin, { id: fd!.id, reason: "Pedido cancelado pelo cliente antes da saída" });
    expect((await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: fd!.id } })).status).toBe("CANCELED");
    expect((await prisma.productOrder.findUniqueOrThrow({ where: { id: o.id } })).fiscalStatus).toBe("CANCELED");
  });

  it("rejeição do provedor é registrada e o documento pode ser reprocessado após correção do cadastro", async () => {
    const { ctx, org, c, p1, p2, o } = await setup();
    const fiscalUser = await addUser(org.id, ["fiscal"]);
    await confirmProductOrder(ctx, o.id);
    for (const [p, cfop] of [[p1, "5102"], [p2, "5102"]] as const) {
      const r = await saveProductRule(fiscalUser, { companyId: c.id, name: `Regra ${p.code}`, productId: p.id, cfop, validFrom: "2026-01-01", active: true });
      await validateProductRule(fiscalUser, { id: r.id, validatedBy: "Responsável fiscal" });
    }
    // destinatário sem documento → rejeitado pelo provedor (simulado)
    await prisma.party.update({ where: { id: o.partyId }, data: { document: null } });
    const fd = await requestProductInvoice(fiscalUser, o.id);
    expect(fd?.status).toBe("REJECTED");
    expect(fd?.lastError).toMatch(/CPF\/CNPJ/);
    await prisma.party.update({ where: { id: o.partyId }, data: { document: "11444777000161" } });
    const again = await retryFiscalDocument(fiscalUser, fd!.id);
    expect(again?.status).toBe("AUTHORIZED");
    expect(await prisma.fiscalDocument.count({ where: { productOrderId: o.id } })).toBe(1);
    // isolamento
    const other = await newOrg();
    expect(await other.ctx.db.fiscalProductRule.count()).toBe(0);
  });
});
