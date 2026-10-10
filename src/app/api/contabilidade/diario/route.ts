import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { journalCsv } from "@/modules/accounting/service";
import { audit } from "@/server/audit";
import { isCivilDate } from "@/lib/dates";

/** Diário contábil em CSV (separador ;) para conferência e importação pelo escritório contábil. */
export async function GET(req: Request) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!ctx.permissions.has("accounting.read")) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const u = new URL(req.url);
  const companyId = u.searchParams.get("empresa");
  const from = u.searchParams.get("de") ?? "";
  const to = u.searchParams.get("ate") ?? "";
  if (!companyId || !isCivilDate(from) || !isCivilDate(to)) return NextResponse.json({ error: "Informe empresa, de e até (AAAA-MM-DD)" }, { status: 400 });
  const csv = "﻿" + (await journalCsv(ctx, companyId, from, to));
  await audit(ctx, { action: "journal.export", entity: "Company", entityId: companyId, changes: { from, to } });
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="diario-${from}-a-${to}.csv"` } });
}
