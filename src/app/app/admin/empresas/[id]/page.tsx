import { notFound } from "next/navigation";
import { PageHeader, Card } from "@/components/ui/page";
import { DataTable } from "@/components/ui/table";
import { ActionForm, FormGrid, Input, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { requirePerm } from "@/server/context";
import { Attachments } from "@/components/attachments";
import { formatMoney } from "@/lib/money";
import { formatCivil, todayIn } from "@/lib/dates";
import { CompanyForm } from "../company-form";
import { updateCompanyAction, createBankAccountAction } from "../actions";

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  requirePerm(ctx, "company.manage");
  const c = await ctx.db.company.findFirst({ where: { id } });
  if (!c) notFound();
  const [accounts, units, ccs, parents] = await Promise.all([
    ctx.db.bankAccount.findMany({ where: { companyId: id } }),
    ctx.db.businessUnit.findMany({ where: { companyId: id } }),
    ctx.db.costCenter.findMany({ where: { companyId: id } }),
    ctx.db.company.findMany({ where: { kind: "HEADQUARTERS", NOT: { id } } }),
  ]);
  return (
    <>
      <PageHeader title={c.legalName} subtitle="Cadastro dentro do ERP. Registros oficiais (Receita, prefeitura) são processos externos." breadcrumbs={[{ label: "Empresas", href: "/app/admin/empresas" }, { label: c.tradeName ?? c.legalName }]} />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <Card title="Dados cadastrais">
            <CompanyForm action={updateCompanyAction} company={{ ...c, address: c.address as Record<string, string> }} parents={parents.map((p) => ({ value: p.id, label: p.legalName }))} hidden={{ id }} />
          </Card>
          <Card title="Contas bancárias">
            <DataTable rows={accounts} columns={[
              { key: "name", label: "Conta" }, { key: "bankCode", label: "Banco", render: (a) => a.bankCode ?? "—" },
              { key: "agency", label: "Agência/Conta", render: (a) => `${a.agency ?? "—"} / ${a.accountNumber ?? "—"}` },
              { key: "openingBalance", label: "Saldo inicial", align: "right", render: (a) => formatMoney(a.openingBalance) },
              { key: "openingDate", label: "Data do saldo", render: (a) => formatCivil(a.openingDate) },
            ]} empty={<p className="text-sm text-slate-500">Nenhuma conta cadastrada.</p>} />
            <div className="mt-4 border-t pt-4">
              <ActionForm action={createBankAccountAction} resetOnSuccess>
                <input type="hidden" name="companyId" value={id} />
                <FormGrid cols={3}>
                  <Input name="name" label="Nome da conta" required />
                  <Input name="bankCode" label="Código do banco" />
                  <Input name="agency" label="Agência" />
                  <Input name="accountNumber" label="Conta" />
                  <Input name="openingBalance" label="Saldo inicial" inputMode="decimal" defaultValue="0,00" />
                  <Input name="openingDate" type="date" label="Data do saldo inicial" defaultValue={todayIn(ctx.timezone)} required />
                </FormGrid>
                <SubmitButton>Adicionar conta</SubmitButton>
              </ActionForm>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card title="Unidades de negócio">{units.length ? <ul className="text-sm">{units.map((u) => <li key={u.id}>{u.code} — {u.name}</li>)}</ul> : <p className="text-sm text-slate-500">Cadastre em Configurador › Unidades de negócio.</p>}</Card>
          <Card title="Centros de custo">{ccs.length ? <ul className="text-sm">{ccs.map((u) => <li key={u.id}>{u.code} — {u.name}</li>)}</ul> : <p className="text-sm text-slate-500">Cadastre em Configurador › Centros de custo.</p>}</Card>
          <Attachments ctx={ctx} entity="Company" entityId={id} back={`/app/admin/empresas/${id}`} title="Logotipo e documentos" />
        </div>
      </div>
    </>
  );
}
