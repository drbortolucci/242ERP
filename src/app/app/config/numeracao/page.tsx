import { PageHeader, Card } from "@/components/ui/page";
import { ActionForm, Input, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { DOC_PREFIX } from "@/server/sequences";
import { saveSequenceAction } from "../special-actions";

const LABELS: Record<string, string> = { OPPORTUNITY: "Oportunidades", PROPOSAL: "Propostas", SALES_ORDER: "Pedidos de venda", CONTRACT: "Contratos", PROJECT: "Projetos", REQUISITION: "Requisições", PURCHASE_ORDER: "Pedidos de compra", GOODS_RECEIPT: "Aceites/recebimentos", TICKET: "Chamados", MEASUREMENT: "Medições", BILLING_DOCUMENT: "Documentos de cobrança", RECEIVABLE: "Contas a receber", PAYABLE: "Contas a pagar" };
export default async function NumberingPage() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const seqs = await ctx.db.documentSequence.findMany({ where: { companyId: "" } });
  return (
    <>
      <PageHeader title="Numeração de documentos" subtitle="Numeração sequencial atômica; não é permitido retroceder." breadcrumbs={[{ label: "Configurador", href: "/app/config" }, { label: "Numeração" }]} />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Object.entries(DOC_PREFIX).map(([doc, def]) => {
          const s = seqs.find((x) => x.docType === doc);
          return (
            <Card key={doc} title={LABELS[doc] ?? doc}>
              <ActionForm action={saveSequenceAction}>
                <input type="hidden" name="docType" value={doc} />
                <div className="grid grid-cols-2 gap-2"><Input name="prefix" label="Prefixo" defaultValue={s?.prefix ?? def} /><Input name="nextNumber" type="number" label="Próximo número" defaultValue={String(s?.nextNumber ?? 1)} /></div>
                <SubmitButton variant="secondary">Salvar</SubmitButton>
              </ActionForm>
            </Card>
          );
        })}
      </div>
    </>
  );
}
