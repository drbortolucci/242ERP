export type SearchParams = Record<string, string | string[] | undefined>;

export function sp(params: SearchParams, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v || undefined;
}

export interface PageQuery {
  page: number;
  pageSize: number;
  skip: number;
  take: number;
  q?: string;
}

export function pageQuery(params: SearchParams, pageSize = 25): PageQuery {
  const page = Math.max(1, Number(sp(params, "page") ?? 1) || 1);
  const size = Math.min(200, Math.max(5, Number(sp(params, "size") ?? pageSize) || pageSize));
  return { page, pageSize: size, skip: (page - 1) * size, take: size, q: sp(params, "q")?.trim() || undefined };
}

export function withParams(base: string, params: SearchParams, patch: Record<string, string | number | undefined>) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => u.append(k, x));
    else u.set(k, v);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") u.delete(k);
    else u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `${base}?${s}` : base;
}

/** Busca textual insensível a maiúsculas em vários campos (Prisma). */
export function textSearch(q: string | undefined, fields: string[]) {
  if (!q) return {};
  return { OR: fields.map((f) => ({ [f]: { contains: q, mode: "insensitive" as const } })) };
}
