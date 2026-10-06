import { PageHeader, Card, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { pageAnyPerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { userNameMap } from "@/modules/config/lookups";
import { formatInstant } from "@/lib/dates";
import { exportDataAction, grantSupportAction, revokeSupportAction } from "./actions";

export const metadata = { title: "Privacidade e dados" };

export default async function DataPage() {
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "data.export", "support.grant");
  const [exports, grants] = await Promise.all([ctx.db.dataExport.findMany({ orderBy: { createdAt: "desc" }, take: 20 }), ctx.db.supportAccessGrant.findMany({ orderBy: { createdAt: "desc" }, take: 20 })]);
  const users = await userNameMap([...exports.map((e) => e.requestedById), ...grants.flatMap((g) => [g.platformUserId, g.grantedById])]);
  return (
    <>
      <PageHeader title="Privacidade, exportação e suporte" breadcrumbs={[{ label: "Administração" }, { label: "Privacidade e dados" }]} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Exportação integral dos dados da organização">
          <p className="mb-3 text-sm text-slate-600">Gera arquivo JSON com todos os registros da organização (sem senhas ou tokens). Disponível também após cancelamento, durante o prazo de retenção.</p>
          {ctx.permissions.has("data.export") && ctx.permissions.has("org.manage") && <ActionButton action={exportDataAction} fields={{}} variant="primary">Gerar exportação</ActionButton>}
          <div className="mt-3"><DataTable rows={exports} columns={[{ key: "createdAt", label: "Solicitada", render: (e) => formatInstant(e.createdAt, ctx.timezone) }, { key: "by", label: "Por", render: (e) => users.get(e.requestedById) }, { key: "status", label: "Situação", render: (e) => <StatusBadge status={e.status === "READY" ? "DONE" : e.status} /> }, { key: "dl", label: "", render: (e) => e.status === "READY" && <a className="text-brand-700 underline" href={`/api/data-export/${e.id}`}>Baixar ({Math.ceil((e.sizeBytes ?? 0) / 1024)} KB)</a> }]} empty={<p className="text-sm text-slate-500">Nenhuma exportação.</p>} /></div>
        </Card>
        <Card title="Acesso de suporte da plataforma">
          <p className="mb-3 text-sm text-slate-600">A equipe da plataforma não acessa seus dados por padrão. Autorize acesso temporário, somente leitura e sem custos/margens. Tudo é auditado.</p>
          {ctx.permissions.has("support.grant") && (
            <ActionForm action={grantSupportAction} resetOnSuccess>
              <Input name="email" type="email" label="E-mail do analista de suporte da plataforma" required />
              <Input name="hours" type="number" label="Duração (horas, máx. 72)" defaultValue="4" />
              <Input name="reason" label="Motivo / chamado" required />
              <SubmitButton>Autorizar acesso</SubmitButton>
            </ActionForm>
          )}
          <div className="mt-3"><DataTable rows={grants} columns={[{ key: "p", label: "Suporte", render: (g) => users.get(g.platformUserId) }, { key: "reason", label: "Motivo" }, { key: "exp", label: "Expira", render: (g) => formatInstant(g.expiresAt, ctx.timezone) }, { key: "st", label: "Situação", render: (g) => <StatusBadge status={g.revokedAt ? "CANCELED" : g.expiresAt < new Date() ? "EXPIRED" : "ACTIVE"} /> }, { key: "a", label: "", render: (g) => !g.revokedAt && g.expiresAt > new Date() && <ActionButton action={revokeSupportAction} fields={{ id: g.id }} variant="danger">Revogar</ActionButton> }]} empty={<p className="text-sm text-slate-500">Nenhuma concessão.</p>} /></div>
        </Card>
        <Card title="Dados pessoais" className="lg:col-span-2">
          <Notice tone="info">Recursos disponíveis: exportação (acesso/portabilidade), correção via cadastros, inativação de usuários e cadastros, anexos com visibilidade restrita, retenção após cancelamento. Exclusão de dados pessoais deve preservar registros empresariais obrigatórios e é tratada por solicitação ao administrador. Estes recursos não constituem, por si só, conformidade integral com a LGPD.</Notice>
        </Card>
      </div>
    </>
  );
}
