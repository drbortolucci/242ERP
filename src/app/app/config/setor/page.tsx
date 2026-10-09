import { PageHeader, Card, Notice, Badge } from "@/components/ui/page";
import { ActionForm, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { getSetting } from "@/server/settings";
import { getTerms } from "@/modules/sectors/service";
import { projectTypeTemplate } from "@/modules/projects/service";
import { SECTOR_OPTIONS, SECTOR_PROFILES, TERM_KEYS, sectorProfile, resolveTerms, type TermKey } from "@/domain/sectors";
import { WBS_TEMPLATES, wbsToText } from "@/domain/wbs-templates";
import { applySectorAction, saveTermsAction, saveWbsTemplateAction } from "./actions";

export const metadata = { title: "Setor e terminologia" };

export default async function SectorPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const profile = sectorProfile(ctx.sector);
  const [terms, overrides, types] = await Promise.all([getTerms(ctx), getSetting(ctx, "terminology"), ctx.db.projectType.findMany({ orderBy: { name: "asc" } })]);
  const sectorTerms = resolveTerms(ctx.sector, null);
  return (
    <>
      <PageHeader title="Setor de atividade e terminologia" subtitle="Pontos de partida por setor de serviços. Regras, cálculos e controles são os mesmos para todos os setores." breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Setor e terminologia" }]} />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Setor de atividade">
          <p className="text-sm">Setor atual: <b>{profile.name}</b></p>
          <p className="mb-3 text-xs text-slate-500">{profile.description}</p>
          <ActionForm action={applySectorAction} className="space-y-2">
            <Select name="sector" label="Aplicar setor" options={SECTOR_OPTIONS} defaultValue={ctx.sector} required />
            <SubmitButton confirm="Aplicar o setor? A terminologia passa a seguir o setor escolhido e itens que faltam serão acrescentados (nada é alterado ou removido).">Aplicar setor</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">Aplicar um setor acrescenta somente o que ainda não existe — tipos de projeto, papéis de equipe, serviços, categorias de despesa e competências. Cadastros e documentos existentes não mudam. Desative o que não usar nos respectivos cadastros.</p>
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-brand-700">O que cada setor traz</summary>
            <ul className="mt-2 space-y-2">
              {Object.values(SECTOR_PROFILES).map((p) => (
                <li key={p.key} className="rounded border p-2">
                  <b>{p.name}</b>{p.key === ctx.sector && <> <Badge tone="green">atual</Badge></>}
                  <p className="text-xs text-slate-500">{p.description}</p>
                  <p className="mt-1 text-xs"><b>Tipos de projeto:</b> {p.projectTypes.map((t) => t.name).join(", ")}</p>
                  <p className="text-xs"><b>Serviços:</b> {p.services.map((s) => s.name).join(", ")}</p>
                  <p className="text-xs"><b>Papéis:</b> {p.teamRoles.join(", ")}</p>
                </li>
              ))}
            </ul>
          </details>
        </Card>

        <Card title="Terminologia">
          <p className="mb-3 text-sm text-slate-600">Nomes exibidos no menu e nas telas principais. Deixe em branco para usar o termo do setor (indicado no campo).</p>
          <ActionForm action={saveTermsAction}>
            <FormGrid cols={2}>
              {(Object.keys(TERM_KEYS) as TermKey[]).map((k) => (
                <Input key={k} name={k} label={TERM_KEYS[k].label} placeholder={sectorTerms[k]} defaultValue={overrides[k] ?? ""} maxLength={40} />
              ))}
            </FormGrid>
            <SubmitButton>Salvar terminologia</SubmitButton>
          </ActionForm>
          <p className="mt-2 text-xs text-slate-500">Em uso: {terms.projects} · {terms.professionals} · {terms.tickets} · {terms.supportArea}</p>
        </Card>
      </div>

      <Card title="Modelos de WBS por tipo de projeto" className="mt-6">
        <p className="mb-2 text-sm text-slate-600">Ao criar um {terms.project.toLowerCase()} com &quot;aplicar modelo&quot;, as fases e itens abaixo são gerados com o esforço distribuído pelos percentuais. Defina um modelo próprio para qualquer tipo; em branco, vale o modelo da biblioteca.</p>
        <Notice tone="info">Formato: uma linha por item — <code>Fase | Item | tipo | % | aceite</code>. Tipo: tarefa, entregável ou marco. Aceite: &quot;sim&quot; quando o item exige aceite do cliente. A soma dos percentuais deve ser 100.</Notice>
        <div className="mt-3 space-y-2">
          {types.map((t) => {
            const tpl = projectTypeTemplate(t);
            const own = Array.isArray(t.wbsTemplate) && (t.wbsTemplate as unknown[]).length > 0;
            return (
              <details key={t.id} className="rounded border p-2">
                <summary className="cursor-pointer text-sm"><b>{t.name}</b> — {own ? <Badge tone="blue">modelo próprio</Badge> : t.templateKey && WBS_TEMPLATES[t.templateKey] ? `biblioteca: ${WBS_TEMPLATES[t.templateKey].label}` : "sem modelo"}{!t.active && <> <Badge>inativo</Badge></>}</summary>
                <ActionForm action={saveWbsTemplateAction} className="mt-2 space-y-2">
                  <input type="hidden" name="projectTypeId" value={t.id} />
                  <Textarea name="text" aria-label={`Modelo de WBS de ${t.name}`} rows={8} defaultValue={own && tpl ? wbsToText(tpl) : ""} placeholder={tpl ? wbsToText(tpl) : "Fase | Item | tarefa | 100"} className="font-mono text-xs" />
                  <SubmitButton variant="secondary">Salvar modelo</SubmitButton>
                </ActionForm>
              </details>
            );
          })}
        </div>
      </Card>
    </>
  );
}
