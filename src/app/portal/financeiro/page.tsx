import { PageHeader, Card, StatusBadge, Badge } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { requireCtx } from "@/server/auth/next";
import { portalFinance } from "@/modules/portal/service";
import { formatCivil } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Financeiro" };
export default async function PortalFinance() {
  const ctx = await requireCtx();
  const f = await portalFinance(ctx);
  const num = new Map(f.docs.map((d) => [d.id, d.number]));
  return (
    <>
      <PageHeader title="Financeiro" />
      <Card title="Documentos de cobrança">
        <DataTable dense rows={f.docs} empty="Nenhum documento." columns={[{ key: "number", label: "Documento" }, { key: "i", label: "Emissão", render: (d) => formatCivil(d.issueDate) }, { key: "c", label: "Competência", render: (d) => formatCivil(d.competence).slice(3) }, { key: "g", label: "Bruto", align: "right", render: (d) => formatMoney(d.grossAmount) }, { key: "w", label: "Retenções", align: "right", render: (d) => formatMoney(d.withholdingAmount) }, { key: "n", label: "Líquido", align: "right", render: (d) => formatMoney(d.netAmount) },
          { key: "f", label: "NFS-e", render: (d) => d.fiscal ? <Badge tone="green">{d.fiscal.number}{d.fiscal.environment === "SIMULATED" ? " (simulada)" : ""}</Badge> : "—" }, { key: "p", label: "", render: (d) => <a className="text-brand-700 underline" href={`/api/pdf/cobranca/${d.id}`} target="_blank" rel="noreferrer">PDF</a> }]} />
        <p className="mt-2 text-xs text-slate-500">O PDF é um demonstrativo de cobrança; o documento fiscal é a NFS-e.</p>
      </Card>
      <Card title="Títulos" className="mt-6">
        <DataTable dense rows={f.receivables} columns={[{ key: "number", label: "Título" }, { key: "d", label: "Documento", render: (r) => num.get(r.billingDocumentId ?? "") ?? "—" }, { key: "p", label: "Parcela", render: (r) => `${r.installment}/${r.installments}` }, { key: "v", label: "Vencimento", render: (r) => formatCivil(r.dueDate) }, { key: "a", label: "Valor", align: "right", render: (r) => formatMoney(r.amount) }, { key: "o", label: "Em aberto", align: "right", render: (r) => formatMoney(r.openAmount) }, { key: "s", label: "Situação", render: (r) => <StatusBadge status={r.status} /> }]} />
      </Card>
    </>
  );
}
