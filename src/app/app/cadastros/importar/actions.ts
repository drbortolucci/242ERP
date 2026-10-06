"use server";
import { requireCtx } from "@/server/auth/next";
import { parseSheet, previewImport, runImport, type ImportLayout, IMPORT_LAYOUTS } from "@/modules/imports/service";
import { toAppError } from "@/lib/errors";
import type { ActionState } from "@/server/action";

export async function importAction(_: ActionState | undefined, fd: FormData): Promise<ActionState> {
  const ctx = await requireCtx();
  const file = fd.get("file");
  const layout = String(fd.get("layout")) as ImportLayout;
  const companyId = String(fd.get("companyId") ?? "") || undefined;
  const confirm = String(fd.get("mode")) === "import";
  if (!(layout in IMPORT_LAYOUTS)) return { ok: false, error: "Layout inválido." };
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecione o arquivo." };
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "Arquivo acima de 5 MB." };
  try {
    const rows = await parseSheet(file.name, Buffer.from(await file.arrayBuffer()));
    if (!confirm) {
      const preview = await previewImport(ctx, layout, rows, companyId);
      const valid = preview.filter((p) => p.ok).length;
      return { ok: true, message: `Pré-visualização: ${valid} linha(s) válida(s), ${preview.length - valid} com erro.`, data: { preview } };
    }
    const r = await runImport(ctx, layout, rows, companyId);
    return { ok: true, message: `Importação concluída: ${r.created} registro(s) criado(s), ${r.failures.length} não importado(s).`, data: { preview: r.failures } };
  } catch (e) {
    return { ok: false, error: toAppError(e).message };
  }
}
