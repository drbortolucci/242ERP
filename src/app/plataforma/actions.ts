"use server";
import { z } from "zod";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requirePlatformAdmin, setSessionCookie, requestMeta } from "@/server/auth/next";
import { setOrgStatusManually, updatePlan } from "@/modules/saas/platform";
import { startSupportSession } from "@/modules/saas/support";
import { toAppError } from "@/lib/errors";
import { formToObject, type ActionState } from "@/server/action";
import { parseMoneyInput } from "@/lib/money";

export async function orgStatusAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const u = await requirePlatformAdmin();
  try {
    const i = z.object({ orgId: z.string(), status: z.enum(["ACTIVE", "SUSPENDED"]), reason: z.string() }).parse(formToObject(fd));
    await setOrgStatusManually(u.id, i.orgId, i.status, i.reason);
    revalidatePath(`/plataforma/organizacoes/${i.orgId}`);
    return { ok: true, message: "Situação atualizada." };
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
}

export async function updatePlanAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const u = await requirePlatformAdmin();
  try {
    const raw = formToObject(fd);
    const i = z.object({ id: z.string(), name: z.string().min(2), priceMonthly: z.string(), maxUsers: z.coerce.number().int().min(1), maxCompanies: z.coerce.number().int().min(1), maxStorageMb: z.coerce.number().int().min(10), trialDays: z.coerce.number().int().min(0).max(90), modules: z.preprocess((v) => (Array.isArray(v) ? v : v ? [v] : []), z.array(z.string())), active: z.preprocess((v) => v === "on", z.boolean()) }).parse(raw);
    await updatePlan(u.id, i.id, { ...i, priceMonthly: parseMoneyInput(i.priceMonthly).toFixed(2) });
    revalidatePath("/plataforma/planos");
    return { ok: true, message: "Plano atualizado." };
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
}

export async function supportSessionAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const u = await requirePlatformAdmin();
  try {
    const token = await startSupportSession(u.id, String(fd.get("orgId")), await requestMeta());
    await setSessionCookie(token);
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
  redirect("/app");
}
