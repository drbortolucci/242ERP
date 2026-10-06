import type { Ctx } from "@/server/context";
import { listAttachments } from "@/modules/attachments/service";
import { formatInstant } from "@/lib/dates";
import { Card } from "./ui/page";
import { UploadForm } from "./upload-form";

export async function Attachments({ ctx, entity, entityId, back, canUpload = true, allowClientVisibility = false, title = "Documentos e anexos" }: { ctx: Ctx; entity: string; entityId: string; back: string; canUpload?: boolean; allowClientVisibility?: boolean; title?: string }) {
  const items = await listAttachments(ctx, entity, entityId);
  return (
    <Card title={title}>
      {items.length === 0 ? <p className="text-sm text-slate-500">Nenhum anexo.</p> : (
        <ul className="mb-3 divide-y text-sm">
          {items.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 py-1.5">
              <a className="text-brand-700 hover:underline" href={`/api/files/${a.id}`}>{a.fileName}</a>
              <span className="text-xs text-slate-500">{Math.ceil(a.sizeBytes / 1024)} KB · {a.visibility === "CLIENT" ? "visível ao cliente" : a.visibility === "RESTRICTED" ? "restrito" : "interno"} · {formatInstant(a.createdAt, ctx.timezone)}</span>
            </li>
          ))}
        </ul>
      )}
      {canUpload && <UploadForm entity={entity} entityId={entityId} back={back} allowClientVisibility={allowClientVisibility} />}
    </Card>
  );
}
