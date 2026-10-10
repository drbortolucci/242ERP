import Link from "@/components/ui/access-link";
import { PageHeader, Card, Badge, Notice } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton, Textarea } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { pagePerm } from "@/server/page-guard";
import { lookups } from "@/modules/config/lookups";
import { formatCivil, todayIn, toCivil } from "@/lib/dates";
import { saveFiscalRuleAction, validateFiscalRuleAction } from "../actions";

export const metadata = { title: "Regras fiscais de produtos" };
export default async function FiscalRulesPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "fiscal.read");
  const [rules, companies, products] = await Promise.all([
    ctx.db.fiscalProductRule.findMany({ orderBy: [{ companyId: "asc" }, { name: "asc" }] }), lookups.companies(ctx),
    ctx.db.product.findMany({ where: { active: true }, orderBy: { code: "asc" } }),
  ]);
  const company = new Map(companies.map((c) => [c.value, c.label]));
  const prod = new Map(products.map((p) => [p.id, p]));
  const today = todayIn(ctx.timezone);
  const canManage = ctx.permissions.has("fiscal.manage");
  const canValidate = ctx.permissions.has("fiscal.validate");
  const pct = (v: unknown) => (v === null || v === undefined ? "—" : `${String(v)}%`);
  return (
    <>
      <PageHeader title="Regras fiscais de produtos (NF-e)" subtitle="CFOP, CST/CSOSN e alíquotas informados e validados pelo responsável fiscal da empresa" breadcrumbs={[{ label: "Fiscal" }, { label: "Regras de produtos" }]} />
      <Notice tone="warn">O sistema não define classificação fiscal, CFOP, CST/CSOSN nem alíquotas e não trata substituição tributária, DIFAL, reduções de base ou benefícios. A NF-e só é emitida com regra vigente e <b>validada</b> para cada item; o provedor homologado faz a validação final junto à SEFAZ. Códigos de serviço (NFS-e) e retenções ficam no <Link className="underline" href="/app/config/codigos-fiscais">Configurador</Link>.</Notice>
      <div className="mt-4 grid gap-6 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          <DataTable rows={rules} empty="Nenhuma regra cadastrada." columns={[
            { key: "n", label: "Regra", render: (r) => <><b>{r.name}</b><div className="text-xs text-slate-500">{company.get(r.companyId)}</div></> },
            { key: "a", label: "Aplica-se a", render: (r) => (r.productId ? `Produto ${prod.get(r.productId)?.code ?? ""}` : `NCM ${r.ncm}`) },
            { key: "c", label: "CFOP", render: (r) => r.cfop }, { key: "i", label: "ICMS", render: (r) => `${r.icmsCst ?? "—"} · ${pct(r.icmsRatePct)}` },
            { key: "p", label: "PIS/COFINS", render: (r) => `${pct(r.pisRatePct)} / ${pct(r.cofinsRatePct)}` }, { key: "ipi", label: "IPI", render: (r) => pct(r.ipiRatePct) },
            { key: "v", label: "Vigência", render: (r) => `${formatCivil(r.validFrom)}${r.validTo ? ` a ${formatCivil(r.validTo)}` : ""}` },
            { key: "s", label: "Validação", render: (r) => !r.active ? <Badge>inativa</Badge> : r.validatedAt ? <Badge tone="green">validada por {r.validatedBy}</Badge> : <Badge tone="amber">aguarda validação</Badge> },
            { key: "x", label: "", render: (r) => canValidate && r.active && !r.validatedAt ? <ActionForm action={validateFiscalRuleAction} className="flex items-end gap-1"><input type="hidden" name="id" value={r.id} /><Input name="validatedBy" aria-label="Responsável fiscal" placeholder="Nome e CRC/registro" required /><SubmitButton variant="secondary" confirm="Confirmar que a regra foi conferida pelo responsável fiscal?">Validar</SubmitButton></ActionForm> : null },
          ]} />
          {canManage && rules.map((r) => (
            <details key={r.id} className="rounded border bg-white p-2 text-sm">
              <summary className="cursor-pointer">Editar “{r.name}” (alterar exige nova validação)</summary>
              <RuleForm companies={companies} products={products.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} v={{ ...r, icmsRatePct: r.icmsRatePct?.toString() ?? "", ipiRatePct: r.ipiRatePct?.toString() ?? "", pisRatePct: r.pisRatePct?.toString() ?? "", cofinsRatePct: r.cofinsRatePct?.toString() ?? "", validFrom: toCivil(r.validFrom), validTo: r.validTo ? toCivil(r.validTo) : "" }} />
            </details>
          ))}
        </div>
        {canManage && <Card title="Nova regra"><RuleForm companies={companies} products={products.map((p) => ({ value: p.id, label: `${p.code} — ${p.name}` }))} v={{ validFrom: today }} /></Card>}
      </div>
    </>
  );
}

type V = Partial<Record<"id" | "companyId" | "name" | "productId" | "ncm" | "cfop" | "icmsCst" | "icmsRatePct" | "ipiCst" | "ipiRatePct" | "pisCst" | "pisRatePct" | "cofinsCst" | "cofinsRatePct" | "notes" | "validFrom" | "validTo", string | null>> & { active?: boolean };
function RuleForm({ companies, products, v }: { companies: { value: string; label: string }[]; products: { value: string; label: string }[]; v: V }) {
  const d = (k: keyof V) => (v[k] as string | null | undefined) ?? "";
  return (
    <ActionForm action={saveFiscalRuleAction} className="mt-2">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <Select name="companyId" label="Empresa (emitente)" options={companies} defaultValue={d("companyId")} required />
      <Input name="name" label="Nome da regra" defaultValue={d("name")} required placeholder="Ex.: Venda de mercadoria dentro do estado" />
      <FormGrid cols={2}><Select name="productId" label="Produto" options={products} placeholder="— (aplicar pelo NCM)" defaultValue={d("productId")} /><Input name="ncm" label="ou NCM" defaultValue={d("ncm")} /></FormGrid>
      <FormGrid cols={3}><Input name="cfop" label="CFOP" defaultValue={d("cfop")} required /><Input name="icmsCst" label="CST/CSOSN ICMS" defaultValue={d("icmsCst")} /><Input name="icmsRatePct" label="Alíquota ICMS %" defaultValue={d("icmsRatePct")} /></FormGrid>
      <FormGrid cols={3}><Input name="pisCst" label="CST PIS" defaultValue={d("pisCst")} /><Input name="pisRatePct" label="PIS %" defaultValue={d("pisRatePct")} /><Input name="cofinsCst" label="CST COFINS" defaultValue={d("cofinsCst")} /></FormGrid>
      <FormGrid cols={3}><Input name="cofinsRatePct" label="COFINS %" defaultValue={d("cofinsRatePct")} /><Input name="ipiCst" label="CST IPI" defaultValue={d("ipiCst")} /><Input name="ipiRatePct" label="IPI %" defaultValue={d("ipiRatePct")} /></FormGrid>
      <FormGrid cols={2}><Input name="validFrom" type="date" label="Vigência início" defaultValue={d("validFrom")} required /><Input name="validTo" type="date" label="Vigência fim" defaultValue={d("validTo")} /></FormGrid>
      <Textarea name="notes" label="Fundamentação / observações do responsável fiscal" defaultValue={d("notes")} />
      <Checkbox name="active" label="Ativa" defaultChecked={v.active ?? true} />
      <SubmitButton>{v.id ? "Salvar alterações" : "Criar regra"}</SubmitButton>
    </ActionForm>
  );
}
