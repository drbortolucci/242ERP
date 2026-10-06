"use server";
import { z } from "zod";
import { makeAction, formToObject } from "@/server/action";
import { saveConfig, setConfigActive } from "@/modules/config/service";
import { requireCtx } from "@/server/auth/next";
import { toAppError } from "@/lib/errors";
import type { ActionState } from "@/server/action";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function saveConfigAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const raw = formToObject(fd);
  const key = String(raw.__key);
  const id = raw.__id ? String(raw.__id) : null;
  try {
    await saveConfig(ctx, key, id, raw);
  } catch (e) {
    const err = toAppError(e);
    return { ok: false, error: err.message, fieldErrors: err.details?.fieldErrors as Record<string, string> | undefined };
  }
  revalidatePath(`/app/config/${key}`);
  if (id) redirect(`/app/config/${key}`);
  return { ok: true, message: "Registro criado." };
}

const toggleConfigActionImpl = makeAction(z.object({ key: z.string(), id: z.string(), active: z.enum(["true", "false"]) }), async (ctx, i) => {
  await setConfigActive(ctx, i.key, i.id, i.active === "true");
  return { revalidate: [`/app/config/${i.key}`], message: i.active === "true" ? "Ativado." : "Inativado." };
});

export async function toggleConfigAction(prev: ActionState | undefined, fd: FormData) {
  return toggleConfigActionImpl(prev, fd);
}
