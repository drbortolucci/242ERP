import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { readDataExport } from "@/modules/saas/data-export";
import { toAppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const data = await readDataExport(ctx, (await params).id);
    return new NextResponse(new Uint8Array(data), { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="exportacao-${ctx.orgId}.json"`, "Cache-Control": "private, no-store" } });
  } catch (e) {
    return NextResponse.json({ error: toAppError(e).message }, { status: 403 });
  }
}
