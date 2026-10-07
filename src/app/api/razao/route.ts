import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { ledgerExportRows } from "@/modules/controlling/service";
import { audit } from "@/server/audit";

/** Exportação contábil (CSV; separador ;) dos lançamentos gerenciais da competência. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.permissions.has("controlling.read")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const u = new URL(req.url);
  const companyId = u.searchParams.get("empresa");
  const month = u.searchParams.get("mes");
  if (!companyId || !month) return NextResponse.json({ error: "Informe empresa e mês" }, { status: 400 });
  const rows = await ledgerExportRows(ctx, companyId, month);
  const esc = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = ["competencia", "conta", "nomeConta", "centroCusto", "projeto", "valor", "origem", "documento", "historico"];
  const csv = "﻿" + [header.join(";"), ...rows.map((r) => header.map((h) => esc(String(r[h as keyof typeof r] ?? ""))).join(";"))].join("\n");
  await audit(ctx, { action: "ledger.export", entity: "Company", entityId: companyId, changes: { month, rows: rows.length } });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="razao-${month.slice(0, 7)}.csv"` } });
}
