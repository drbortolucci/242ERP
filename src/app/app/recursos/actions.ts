"use server";
import { z } from "zod";
import { makeAction } from "@/server/action";
import { allocationSchema, createAllocation, confirmAllocation, cancelAllocation, previewAllocation } from "@/modules/resources/service";
import { requireCtx } from "@/server/auth/next";
import { formToObject, type ActionState } from "@/server/action";
import { toAppError } from "@/lib/errors";

export async function allocationAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const raw = formToObject(fd);
  try {
    const i = allocationSchema.parse(raw);
    if (raw.mode_action === "preview") {
      const pv = await previewAllocation(ctx, i);
      return { ok: true, message: pv.conflicts.length ? `Simulação: ${pv.totalHours}h no período. ATENÇÃO: conflito em ${pv.conflicts.length} dia(s): ${pv.conflicts.slice(0, 5).map((c) => `${c.day} (${c.allocated}h/${c.capacity}h)`).join(", ")}${pv.conflicts.length > 5 ? "…" : ""}. Salve como provisória ou confirme com autorização e justificativa.` : `Simulação: ${pv.totalHours}h no período, sem conflitos.` };
    }
    const r = await createAllocation(ctx, i);
    const { revalidatePath } = await import("next/cache");
    revalidatePath("/app/recursos");
    return { ok: true, message: `Alocação registrada (${r.allocation.totalHours}h)${r.conflicts.length ? ` com ${r.conflicts.length} dia(s) em conflito — ${r.allocation.status === "TENTATIVE" ? "provisória" : "exceção autorizada"}` : ""}.` };
  } catch (e) {
    const { ZodError } = await import("zod");
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ") };
    return { ok: false, error: toAppError(e).message };
  }
}
const confirmImpl = makeAction(z.object({ id: z.string(), overrideReason: z.string().optional() }), async (ctx, i) => { await confirmAllocation(ctx, i.id, i.overrideReason); return { revalidate: ["/app/recursos"], message: "Alocação confirmada." }; });
const cancelImpl = makeAction(z.object({ id: z.string() }), async (ctx, i) => { await cancelAllocation(ctx, i.id); return { revalidate: ["/app/recursos"] }; });
export async function confirmAllocationAction(p: ActionState | undefined, fd: FormData) { return confirmImpl(p, fd); }
export async function cancelAllocationAction(p: ActionState | undefined, fd: FormData) { return cancelImpl(p, fd); }
