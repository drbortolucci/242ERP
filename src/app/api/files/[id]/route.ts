import { NextResponse } from "next/server";
import { getCtx } from "@/server/auth/next";
import { readAttachment } from "@/modules/attachments/service";
import { toAppError } from "@/lib/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  try {
    const { att, data } = await readAttachment(ctx, (await params).id);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": att.mimeType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(att.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const err = toAppError(e);
    return NextResponse.json({ error: err.message }, { status: err.code === "FORBIDDEN" ? 403 : 404 });
  }
}
