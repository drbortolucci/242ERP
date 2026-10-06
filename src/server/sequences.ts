import { randomUUID } from "node:crypto";

export const DOC_PREFIX: Record<string, string> = {
  OPPORTUNITY: "OPP",
  PROPOSAL: "PRP",
  SALES_ORDER: "PV",
  CONTRACT: "CTR",
  PROJECT: "PRJ",
  REQUISITION: "REQ",
  PURCHASE_ORDER: "PC",
  GOODS_RECEIPT: "ACT",
  TICKET: "CH",
  MEASUREMENT: "MED",
  BILLING_DOCUMENT: "COB",
  RECEIVABLE: "CR",
  PAYABLE: "CP",
};

type RawCapable = { $queryRawUnsafe: <T = unknown>(query: string, ...values: unknown[]) => Promise<T> };

/**
 * Próximo número de documento — atômico (INSERT ... ON CONFLICT DO UPDATE ... RETURNING).
 * Seguro sob concorrência; executar dentro da transação da operação para não "pular" números em rollback.
 */
export async function nextNumber(db: RawCapable, orgId: string, docType: string, companyId = ""): Promise<string> {
  const prefix = DOC_PREFIX[docType] ?? docType.slice(0, 3);
  const rows = await db.$queryRawUnsafe<{ n: number; prefix: string; padding: number }[]>(
    `INSERT INTO "DocumentSequence" ("id","organizationId","companyId","docType","prefix","nextNumber","padding")
     VALUES ($1,$2,$3,$4,$5,2,5)
     ON CONFLICT ("organizationId","companyId","docType") DO UPDATE SET "nextNumber" = "DocumentSequence"."nextNumber" + 1
     RETURNING ("nextNumber" - 1) AS n, "prefix", "padding"`,
    randomUUID(), orgId, companyId, docType, prefix,
  );
  const r = rows[0];
  return `${r.prefix}-${String(r.n).padStart(r.padding, "0")}`;
}
