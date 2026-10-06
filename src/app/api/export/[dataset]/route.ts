import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { exportDataset } from "@/modules/exports/service";
import "@/modules/exports/datasets";
import { toAppError } from "@/lib/errors";

export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const url = new URL(req.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  try {
    const out = await exportDataset(ctx, (await params).dataset, format, url.searchParams);
    return new NextResponse(new Uint8Array(out.body), { headers: { "Content-Type": out.mime, "Content-Disposition": `attachment; filename="${out.fileName}"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 400 });
  }
}
