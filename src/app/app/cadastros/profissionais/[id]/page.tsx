import { toPlain } from "@/lib/utils";
import { notFound } from "next/navigation";
import { PageHeader, Card, StatusBadge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionButton, ActionForm, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { pageAnyPerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { can } from "@/server/context";
import { listCostRates } from "@/modules/professionals/service";
import { Attachments } from "@/components/attachments";
import { formatCivil, todayIn } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ProfessionalForm } from "../professional-form";
import { profLookups } from "../lk";
import { updateProfessionalAction, toggleProfessionalAction, addCostRateAction, addAbsenceAction } from "../actions";

export default async function ProfessionalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  pageAnyPerm(ctx, "master.read", "resource.read");
  const p = await ctx.db.professional.findFirst({ where: { id } });
  if (!p) notFound();
  const [lk, skills, absences] = await Promise.all([profLookups(ctx), ctx.db.professionalSkill.findMany({ where: { professionalId: id } }), ctx.db.absence.findMany({ where: { professionalId: id }, orderBy: { startDate: "desc" } })]);
  const rates = can(ctx, "cost.view") ? await listCostRates(ctx, id) : null;
  const canWrite = can(ctx, "master.write") || can(ctx, "resource.write");
  return (
    <>
      <PageHeader title={p.name} subtitle={<StatusBadge status={p.active ? "ACTIVE" : "INACTIVE"} />} breadcrumbs={[{ label: "Profissionais", href: "/app/cadastros/profissionais" }, { label: p.name }]}
        actions={canWrite && <ActionButton action={toggleProfessionalAction} fields={{ id, active: p.active ? "false" : "true" }}>{p.active ? "Inativar" : "Reativar"}</ActionButton>} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Cadastro">{canWrite ? <ProfessionalForm action={updateProfessionalAction} lk={lk} p={toPlain(p)} skillIds={skills.map((s) => s.skillId)} /> : <p className="text-sm">Somente leitura.</p>}</Card>
          <Card title="Férias e afastamentos">
            <DataTable rows={absences} columns={[{ key: "type", label: "Tipo" }, { key: "startDate", label: "Início", render: (a) => formatCivil(a.startDate) }, { key: "endDate", label: "Fim", render: (a) => formatCivil(a.endDate) }, { key: "notes", label: "Obs.", render: (a) => a.notes ?? "—" }]} empty={<p className="text-sm text-slate-500">Nenhuma ausência registrada.</p>} />
            {canWrite && (
              <ActionForm action={addAbsenceAction} resetOnSuccess className="mt-4">
                <input type="hidden" name="professionalId" value={id} />
                <FormGrid cols={4}>
                  <Select name="type" label="Tipo" options={[{ value: "VACATION", label: "Férias" }, { value: "SICK", label: "Atestado" }, { value: "LEAVE", label: "Licença" }, { value: "TRAINING", label: "Treinamento" }, { value: "OTHER", label: "Outro" }]} />
                  <Input name="startDate" type="date" label="Início" required />
                  <Input name="endDate" type="date" label="Fim" required />
                  <Input name="notes" label="Observação" />
                </FormGrid>
                <SubmitButton variant="secondary">Registrar ausência</SubmitButton>
              </ActionForm>
            )}
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Custo/hora (restrito)">
            {rates === null ? <Notice tone="info">Você não tem permissão para ver custos.</Notice> : (
              <>
                <DataTable rows={rates} columns={[{ key: "hourlyCost", label: "Custo/hora", align: "right", render: (r) => formatMoney(r.hourlyCost) }, { key: "validFrom", label: "De", render: (r) => formatCivil(r.validFrom) }, { key: "validTo", label: "Até", render: (r) => formatCivil(r.validTo) }]} empty={<p className="text-sm text-slate-500">Sem custo cadastrado. Apontamentos ficarão sem custo aplicado.</p>} />
                {can(ctx, "cost.manage") && (
                  <ActionForm action={addCostRateAction} resetOnSuccess className="mt-3">
                    <input type="hidden" name="professionalId" value={id} />
                    <FormGrid cols={2}>
                      <Input name="hourlyCost" label="Novo custo/hora" inputMode="decimal" required />
                      <Input name="validFrom" type="date" label="Vigente a partir de" defaultValue={todayIn(ctx.timezone)} required />
                    </FormGrid>
                    <p className="text-xs text-slate-500">A vigência anterior é encerrada automaticamente. Custos já aplicados em apontamentos não são alterados.</p>
                    <SubmitButton variant="secondary">Registrar custo</SubmitButton>
                  </ActionForm>
                )}
              </>
            )}
          </Card>
          <Attachments ctx={ctx} entity="Professional" entityId={id} back={`/app/cadastros/profissionais/${id}`} title="Documentos restritos" canUpload={canWrite} />
        </div>
      </div>
    </>
  );
}
