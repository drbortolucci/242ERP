"use server";
import { z } from "zod";
import { makeAction, formToObject, type ActionState } from "@/server/action";
import { requireCtx } from "@/server/auth/next";
import { partySchema, createParty, updateParty, setPartyActive, contactSchema, saveContact, deleteParty } from "@/modules/parties/service";
import { toAppError } from "@/lib/errors";
import { ZodError } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function zodState(e: unknown): ActionState {
  if (e instanceof ZodError) {
    const fieldErrors: Record<string, string> = {};
    for (const i of e.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Verifique os campos.", fieldErrors };
  }
  return { ok: false, error: toAppError(e).message };
}

export async function savePartyAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const raw = formToObject(fd);
  const id = raw.id ? String(raw.id) : null;
  const back = String(raw.back ?? "clientes");
  let newId = id;
  try {
    const input = partySchema.parse(raw);
    if (id) await updateParty(ctx, id, input);
    else newId = (await createParty(ctx, input)).id;
  } catch (e) {
    return zodState(e);
  }
  revalidatePath(`/app/cadastros/${back}`);
  if (!id) redirect(`/app/cadastros/${back}/${newId}`);
  return { ok: true, message: "Cadastro atualizado." };
}

const togglePartyActionImpl = makeAction(z.object({ id: z.string(), active: z.enum(["true", "false"]), back: z.string() }), async (ctx, i) => {
  await setPartyActive(ctx, i.id, i.active === "true");
  return { revalidate: [`/app/cadastros/${i.back}`, `/app/cadastros/${i.back}/${i.id}`] };
});
const deletePartyActionImpl = makeAction(z.object({ id: z.string(), back: z.string() }), async (ctx, i) => {
  await deleteParty(ctx, i.id);
  return { redirectTo: `/app/cadastros/${i.back}` };
});
const saveContactActionImpl = makeAction(contactSchema.extend({ id: z.string().optional(), back: z.string() }), async (ctx, i) => {
  await saveContact(ctx, i.id || null, i);
  return { revalidate: [`/app/cadastros/${i.back}/${i.partyId}`], message: "Contato salvo." };
});

export async function togglePartyAction(prev: ActionState | undefined, fd: FormData) {
  return togglePartyActionImpl(prev, fd);
}
export async function deletePartyAction(prev: ActionState | undefined, fd: FormData) {
  return deletePartyActionImpl(prev, fd);
}
export async function saveContactAction(prev: ActionState | undefined, fd: FormData) {
  return saveContactActionImpl(prev, fd);
}
