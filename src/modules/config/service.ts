import { z } from "zod";
import { requirePerm, requireWritable, type Ctx } from "@/server/context";
import { audit, diff } from "@/server/audit";
import { CONFIG_ENTITIES, getConfigEntity, type ConfigEntity, type ConfigField } from "./registry";
import { conflict, notFound, validation } from "@/lib/errors";
import { civil, isCivilDate, toCivil } from "@/lib/dates";
import { parseMoneyInput } from "@/lib/money";
import { textSearch, type PageQuery } from "@/lib/query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDelegate = any;
function delegate(ctx: Ctx, model: string): AnyDelegate {
  return (ctx.db as unknown as Record<string, AnyDelegate>)[model];
}

function fieldSchema(f: ConfigField) {
  const empty = (v: unknown) => (v === "" || v === undefined || v === null ? undefined : v);
  let s: z.ZodTypeAny;
  switch (f.type) {
    case "int": s = z.preprocess(empty, z.coerce.number().int(`${f.label}: número inteiro`).optional()); break;
    case "decimal": s = z.preprocess(empty, z.string().transform((v, c) => { try { return parseMoneyInput(v).toString(); } catch { c.addIssue({ code: "custom", message: `${f.label}: valor inválido` }); return z.NEVER; } }).optional()); break;
    case "bool": s = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()); break;
    case "date": s = z.preprocess(empty, z.string().refine(isCivilDate, `${f.label}: data inválida`).optional()); break;
    case "tags": s = z.preprocess((v) => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean) : v ?? []), z.array(z.string())); break;
    case "select": s = z.preprocess(empty, z.string().refine((v) => !f.options || f.options.some((o) => o.value === v), `${f.label}: opção inválida`).optional()); break;
    default: s = z.preprocess(empty, z.string().trim().optional());
  }
  if (f.required && f.type !== "bool" && f.type !== "tags") s = s.refine((v) => v !== undefined && v !== null && v !== "", `${f.label}: obrigatório`);
  return s;
}

export function entitySchema(e: ConfigEntity) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of e.fields) shape[f.name] = fieldSchema(f);
  return z.object(shape);
}

function toDb(e: ConfigEntity, data: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of e.fields) {
    const v = data[f.name];
    if (f.type === "date") out[f.name] = v ? civil(v as string) : null;
    else if (f.type === "bool" || f.type === "tags") out[f.name] = v;
    else out[f.name] = v ?? null;
  }
  return out;
}

export function fromDb(e: ConfigEntity, row: Record<string, unknown>) {
  const out: Record<string, string | boolean | string[]> = {};
  for (const f of e.fields) {
    const v = row[f.name];
    if (v === null || v === undefined) out[f.name] = f.type === "bool" ? false : "";
    else if (v instanceof Date) out[f.name] = toCivil(v);
    else if (Array.isArray(v)) out[f.name] = v.map(String);
    else if (typeof v === "boolean") out[f.name] = v;
    else out[f.name] = String(v);
  }
  return out;
}

async function validateLookups(ctx: Ctx, e: ConfigEntity, data: Record<string, unknown>) {
  for (const f of e.fields) {
    if (f.type !== "lookup" || !data[f.name]) continue;
    const found = await delegate(ctx, f.lookup!.entity).findFirst({ where: { id: data[f.name] } });
    if (!found) throw validation(`${f.label}: registro inexistente.`);
  }
  if (e.key === "campos-adicionais" && data.key && !/^[a-z0-9_]+$/.test(String(data.key))) throw validation("Chave técnica inválida.");
}

async function assertUnique(ctx: Ctx, e: ConfigEntity, data: Record<string, unknown>, exceptId?: string) {
  for (const u of e.unique ?? []) {
    if (!data[u]) continue;
    const dup = await delegate(ctx, e.model).findFirst({ where: { [u]: data[u], ...(exceptId ? { NOT: { id: exceptId } } : {}) } });
    if (dup) throw conflict(`Já existe um registro com ${e.fields.find((f) => f.name === u)?.label ?? u} = "${data[u]}".`);
  }
}

export async function listConfig(ctx: Ctx, key: string, q: PageQuery) {
  requirePerm(ctx, "settings.manage");
  const e = getConfigEntity(key);
  if (!e) throw notFound("Configuração");
  const textFields = e.fields.filter((f) => f.type === "text").map((f) => f.name);
  const where = textSearch(q.q, textFields);
  const [rows, total] = await Promise.all([
    delegate(ctx, e.model).findMany({ where, orderBy: e.orderBy ?? { id: "asc" }, skip: q.skip, take: q.take }),
    delegate(ctx, e.model).count({ where }),
  ]);
  // Resolve rótulos de lookups
  const labels: Record<string, Map<string, string>> = {};
  for (const f of e.fields.filter((x) => x.type === "lookup")) {
    const ids = [...new Set(rows.map((r: Record<string, unknown>) => r[f.name]).filter(Boolean))] as string[];
    const found = ids.length ? await delegate(ctx, f.lookup!.entity).findMany({ where: { id: { in: ids } } }) : [];
    labels[f.name] = new Map(found.map((x: Record<string, string>) => [x.id, x[f.lookup!.labelField]]));
  }
  return { entity: e, rows: rows as Record<string, unknown>[], total, labels };
}

export async function lookupOptions(ctx: Ctx, f: ConfigField) {
  if (f.type !== "lookup" || !f.lookup) return [];
  const rows = await delegate(ctx, f.lookup.entity).findMany({ where: { ...(f.lookup.where ?? {}) }, orderBy: { [f.lookup.labelField]: "asc" }, take: 500 });
  return rows.map((r: Record<string, string>) => ({ value: r.id, label: r[f.lookup!.labelField] }));
}

export async function getConfig(ctx: Ctx, key: string, id: string) {
  requirePerm(ctx, "settings.manage");
  const e = getConfigEntity(key);
  if (!e) throw notFound("Configuração");
  const row = await delegate(ctx, e.model).findFirst({ where: { id } });
  if (!row) throw notFound();
  return { entity: e, row };
}

export async function saveConfig(ctx: Ctx, key: string, id: string | null, raw: Record<string, unknown>) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const e = getConfigEntity(key);
  if (!e) throw notFound("Configuração");
  const parsed = entitySchema(e).safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    throw validation("Verifique os campos.", { fieldErrors });
  }
  const data = parsed.data as Record<string, unknown>;
  await validateLookups(ctx, e, data);
  await assertUnique(ctx, e, data, id ?? undefined);
  if (e.key === "comissoes" || e.key === "alcadas" || e.key === "retencoes") {
    for (const k of ["ratePct", "maxDiscountPct", "minMarginPct"]) {
      if (data[k] !== undefined && (Number(data[k]) < 0 || Number(data[k]) > 100)) throw validation("Percentual deve estar entre 0 e 100.");
    }
  }
  const dbData = toDb(e, data);
  if (id) {
    const before = await delegate(ctx, e.model).findFirst({ where: { id } });
    if (!before) throw notFound();
    const after = await delegate(ctx, e.model).update({ where: { id }, data: dbData });
    await audit(ctx, { action: `config.${e.key}.update`, entity: e.model, entityId: id, changes: diff(before, after) });
    return after;
  }
  const created = await delegate(ctx, e.model).create({ data: dbData });
  await audit(ctx, { action: `config.${e.key}.create`, entity: e.model, entityId: created.id, changes: dbData });
  return created;
}

export async function setConfigActive(ctx: Ctx, key: string, id: string, active: boolean) {
  requirePerm(ctx, "settings.manage");
  requireWritable(ctx);
  const e = getConfigEntity(key);
  if (!e || !e.hasActive) throw notFound("Configuração");
  const before = await delegate(ctx, e.model).findFirst({ where: { id } });
  if (!before) throw notFound();
  if (e.model === "managerialAccount" && before.systemKey && !active) throw validation("Contas usadas pelas integrações internas não podem ser inativadas.");
  await delegate(ctx, e.model).update({ where: { id }, data: { active } });
  await audit(ctx, { action: `config.${e.key}.${active ? "activate" : "deactivate"}`, entity: e.model, entityId: id });
}

export const CONFIG_GROUPS = [...new Set(CONFIG_ENTITIES.map((e) => e.group))];
