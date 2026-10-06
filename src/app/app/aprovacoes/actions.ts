"use server";
import type { ActionState } from "@/server/action";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { decide } from "@/modules/approvals/service";
import "@/modules/approvals/register-all";

const decideActionImpl = makeAction(z.object({ id: z.string(), decision: z.enum(["approve", "reject"]), comment: z.string().optional(), back: z.string().optional() }), async (ctx, i) => {
  await decide(ctx, i.id, i.decision === "approve", i.comment);
  return { revalidate: ["/app/aprovacoes", ...(i.back ? [i.back] : [])], message: i.decision === "approve" ? "Aprovado." : "Rejeitado." };
});

export async function decideAction(prev: ActionState | undefined, fd: FormData) {
  return decideActionImpl(prev, fd);
}
