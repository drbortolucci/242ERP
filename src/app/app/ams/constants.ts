export const TYPE_OPTIONS = [{ value: "INCIDENT", label: "Incidente" }, { value: "REQUEST", label: "Requisição" }, { value: "PROBLEM", label: "Problema" }, { value: "CHANGE", label: "Mudança" }];
export const LEVEL_OPTIONS = [{ value: "1", label: "1 — Alto" }, { value: "2", label: "2 — Médio" }, { value: "3", label: "3 — Baixo" }];
export const typeLabel = (v: string) => TYPE_OPTIONS.find((o) => o.value === v)?.label ?? v;
export const PRIORITY_TONE: Record<string, "red" | "amber" | "blue" | "slate"> = { P1: "red", P2: "amber", P3: "blue", P4: "slate" };
