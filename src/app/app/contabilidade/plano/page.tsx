import { PageHeader, Card, Badge, Notice, EmptyState } from "@/components/ui/page";
import { ActionButton, ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { NATURE_LABEL, type Nature } from "@/domain/chart-of-accounts";
import { saveAccountAction, saveMappingAction, suggestedChartAction } from "../actions";

const NATURES = (Object.keys(NATURE_LABEL) as Nature[]).map((k) => ({ value: k, label: NATURE_LABEL[k] }));

export const metadata = { title: "Plano de contas contábil" };
export default async function ChartPage() {
  const ctx = await requireCtx();
  const [accounts, banks, managerial, mappings] = await Promise.all([
    ctx.db.ledgerAccount.findMany({ orderBy: { code: "asc" } }), ctx.db.bankAccount.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    ctx.db.managerialAccount.findMany({ where: { active: true }, orderBy: { code: "asc" } }), ctx.db.ledgerMapping.findMany(),
  ]);
  const canWrite = ctx.permissions.has("accounting.write");
  const analytic = accounts.filter((a) => a.analytic && a.active).map((a) => ({ value: a.id, label: `${a.code} ${a.name}` }));
  const mapOf = (type: string, id: string) => mappings.find((m) => m.sourceType === type && m.sourceId === id)?.accountId ?? "";
  return (
    <>
      <PageHeader title="Plano de contas contábil" subtitle="Estrutura sugerida como ponto de partida — revise e valide com o contador responsável" breadcrumbs={[{ label: "Contabilidade" }, { label: "Plano de contas" }]} />
      {accounts.length === 0 ? (
        <EmptyState title="Nenhum plano de contas" description="Crie o plano sugerido (ativo, passivo, PL, receitas, custos e despesas com as contas usadas pelos lançamentos automáticos) e ajuste com o contador." action={canWrite ? <ActionButton action={suggestedChartAction} fields={{}} variant="primary">Criar plano sugerido</ActionButton> : undefined} />
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <Notice>O código do plano referencial (SPED) é informado pelo contador. Contas com chave de sistema recebem os lançamentos automáticos; crie subcontas analíticas e use o de-para para detalhar bancos e despesas.</Notice>
            <table className="mt-3 w-full rounded border bg-white text-sm">
              <thead><tr className="border-b bg-slate-50 text-left text-xs text-slate-500"><th className="px-2 py-1">Código</th><th>Conta</th><th>Natureza</th><th>Tipo</th><th>Referencial</th><th></th></tr></thead>
              <tbody>{accounts.map((a) => (
                <tr key={a.id} className="border-b">
                  <td className="px-2 py-1 font-mono text-xs">{a.code}</td>
                  <td style={{ paddingLeft: `${(a.code.split(".").length - 1) * 12}px` }} className={a.analytic ? "" : "font-semibold"}>{a.name} {a.systemKey && <Badge tone="blue">automática</Badge>} {!a.active && <Badge>inativa</Badge>}</td>
                  <td className="text-xs">{NATURE_LABEL[a.nature as Nature]}</td><td className="text-xs">{a.analytic ? "Analítica" : "Sintética"}</td><td className="text-xs">{a.referentialCode ?? "—"}</td>
                  <td>{canWrite && <details className="text-xs"><summary className="cursor-pointer text-brand-700">editar</summary>
                    <ActionForm action={saveAccountAction} className="mt-1 w-72"><input type="hidden" name="id" value={a.id} /><input type="hidden" name="code" value={a.code} /><input type="hidden" name="nature" value={a.nature} />
                      <Input name="name" label="Nome" defaultValue={a.name} required /><Input name="referentialCode" label="Código referencial" defaultValue={a.referentialCode ?? ""} />
                      <div className="flex gap-4"><Checkbox name="analytic" label="Analítica" defaultChecked={a.analytic} /><Checkbox name="active" label="Ativa" defaultChecked={a.active} /></div>
                      <SubmitButton variant="secondary">Salvar</SubmitButton></ActionForm></details>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {canWrite && (
            <div className="space-y-6">
              <Card title="Nova conta">
                <ActionForm action={saveAccountAction} resetOnSuccess>
                  <FormGrid cols={2}><Input name="code" label="Código" placeholder="1.1.1.03" required /><Select name="nature" label="Natureza" options={NATURES} /></FormGrid>
                  <Input name="name" label="Nome" required /><Input name="referentialCode" label="Código referencial (SPED)" />
                  <div className="flex gap-4"><Checkbox name="analytic" label="Analítica" defaultChecked /><input type="hidden" name="active" value="on" /></div>
                  <SubmitButton>Criar conta</SubmitButton>
                </ActionForm>
              </Card>
              <Card title="De-para: contas bancárias">
                <p className="mb-2 text-xs text-slate-500">Sem de-para, o movimento vai para “Bancos conta movimento”.</p>
                {banks.map((b) => <ActionForm key={b.id} action={saveMappingAction} className="mb-2 flex items-end gap-2"><input type="hidden" name="sourceType" value="BANK_ACCOUNT" /><input type="hidden" name="sourceId" value={b.id} /><Select name="accountId" label={b.name} options={analytic} defaultValue={mapOf("BANK_ACCOUNT", b.id)} placeholder="Padrão" /><SubmitButton variant="secondary">OK</SubmitButton></ActionForm>)}
              </Card>
              <Card title="De-para: contas gerenciais → contábeis">
                <p className="mb-2 text-xs text-slate-500">Usado nos títulos avulsos e contas a pagar com conta gerencial informada (ex.: aluguel, energia, software).</p>
                {managerial.filter((m) => ["OPERATING_EXPENSE", "DIRECT_COST", "REVENUE"].includes(m.type)).map((m) => <ActionForm key={m.id} action={saveMappingAction} className="mb-2 flex items-end gap-2"><input type="hidden" name="sourceType" value="MANAGERIAL_ACCOUNT" /><input type="hidden" name="sourceId" value={m.id} /><Select name="accountId" label={`${m.code} ${m.name}`} options={analytic} defaultValue={mapOf("MANAGERIAL_ACCOUNT", m.id)} placeholder="Padrão" /><SubmitButton variant="secondary">OK</SubmitButton></ActionForm>)}
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
