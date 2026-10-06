"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";

const markReadActionImpl = makeAction(z.object({ id: z.string().optional() }), async (ctx, i) => {
  await ctx.db.notification.updateMany({ where: { userId: ctx.userId, readAt: null, ...(i.id ? { id: i.id } : {}) }, data: { readAt: new Date() } });
  return { revalidate: ["/app/notificacoes", "/app"] };
});

export async function markReadAction(prev: ActionState | undefined, fd: FormData) {
  return markReadActionImpl(prev, fd);
}
