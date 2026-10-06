import type { Ctx } from "@/server/context";
import { approvalsFor } from "@/modules/approvals/service";
import { userNameMap } from "@/modules/config/lookups";
import { formatInstant } from "@/lib/dates";
import { Card, StatusBadge } from "./ui/page";
import { DecideForm } from "./decide-form";

export async function ApprovalPanel({ ctx, entity, entityId, back }: { ctx: Ctx; entity: string; entityId: string; back: string }) {
  const rows = await approvalsFor(ctx, entity, entityId);
  if (!rows.length) return null;
  const users = await userNameMap(rows.flatMap((r) => [r.requestedById, r.decidedById]));
  const minPending = Math.min(...rows.filter((r) => r.status === "PENDING").map((r) => r.level));
  return (
    <Card title="Aprovações">
      <ul className="space-y-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="rounded border border-slate-200 p-2">
            <div className="flex items-center justify-between gap-2"><span>Nível {r.level} · {r.reasons.join("; ")}</span><StatusBadge status={r.status} /></div>
            <div className="text-xs text-slate-500">Solicitado por {users.get(r.requestedById)} em {formatInstant(r.createdAt, ctx.timezone)} · exige <code>{r.requiredPermission}</code>
              {r.decidedById && <> · decidido por {users.get(r.decidedById)} {r.comment && `— “${r.comment}”`}</>}</div>
            {r.status === "PENDING" && r.level === minPending && ctx.permissions.has(r.requiredPermission) && <DecideForm id={r.id} back={back} />}
          </li>
        ))}
      </ul>
    </Card>
  );
}
