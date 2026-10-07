"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { apiKeySchema, createApiKey, revokeApiKey } from "@/modules/api/service";

const createApiKeyActionImpl = makeAction(apiKeySchema, async (ctx, i) => { const r = await createApiKey(ctx, i); return { revalidate: ["/app/admin/api"], message: `Chave criada. Copie agora — ela não será exibida novamente: ${r.secret}` }; });
const revokeApiKeyActionImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await revokeApiKey(ctx, i.id); return { revalidate: ["/app/admin/api"], message: "Chave revogada." }; });

export async function createApiKeyAction(prev: ActionState | undefined, fd: FormData) {
  return createApiKeyActionImpl(prev, fd);
}
export async function revokeApiKeyAction(prev: ActionState | undefined, fd: FormData) {
  return revokeApiKeyActionImpl(prev, fd);
}
