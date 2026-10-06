import type { Ctx } from "@/server/context";
import { validation } from "@/lib/errors";
import { isCivilDate } from "@/lib/dates";

/** Valida e normaliza valores de campos adicionais conforme definições ativas da entidade. */
export async function validateCustomFields(ctx: Ctx, entity: string, raw: Record<string, unknown>) {
  const defs = await ctx.db.customFieldDef.findMany({ where: { entity, active: true } });
  const out: Record<string, string | number | boolean | null> = {};
  for (const d of defs) {
    const v = raw[`cf_${d.key}`];
    const empty = v === undefined || v === null || v === "";
    if (empty) {
      if (d.required && d.type !== "BOOLEAN") throw validation(`Campo adicional obrigatório: ${d.label}.`);
      out[d.key] = d.type === "BOOLEAN" ? false : null;
      continue;
    }
    switch (d.type) {
      case "NUMBER": {
        const s = String(v).replace(",", ".");
        if (!/^-?\d+(\.\d+)?$/.test(s)) throw validation(`${d.label}: número inválido.`);
        out[d.key] = s as unknown as number;
        break;
      }
      case "DATE":
        if (!isCivilDate(String(v))) throw validation(`${d.label}: data inválida.`);
        out[d.key] = String(v);
        break;
      case "BOOLEAN":
        out[d.key] = v === "on" || v === "true" || v === true;
        break;
      case "SELECT":
        if (!d.options.includes(String(v))) throw validation(`${d.label}: opção inválida.`);
        out[d.key] = String(v);
        break;
      default:
        out[d.key] = String(v).slice(0, 500);
    }
  }
  return out;
}

export async function customFieldDefs(ctx: Ctx, entity: string) {
  return ctx.db.customFieldDef.findMany({ where: { entity, active: true }, orderBy: { label: "asc" } });
}
