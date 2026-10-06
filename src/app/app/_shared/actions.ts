"use server";
import { revalidatePath } from "next/cache";
import { requireCtx } from "@/server/auth/next";
import { uploadAttachment } from "@/modules/attachments/service";
import { toAppError } from "@/lib/errors";
import type { ActionState } from "@/server/action";

export async function uploadAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecione um arquivo." };
  try {
    await uploadAttachment(ctx, {
      entity: String(fd.get("entity")), entityId: String(fd.get("entityId")), fileName: file.name,
      data: Buffer.from(await file.arrayBuffer()), visibility: (String(fd.get("visibility") || "INTERNAL") as "INTERNAL" | "CLIENT" | "RESTRICTED"),
    });
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
  const back = String(fd.get("back") ?? "");
  if (back.startsWith("/")) revalidatePath(back);
  return { ok: true, message: "Arquivo anexado." };
}
