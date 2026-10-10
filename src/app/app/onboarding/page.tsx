import Link from "next/link";
import { sectorProfile } from "@/domain/sectors";
import { PageHeader, Card, Notice } from "@/components/ui/page";
import { ActionForm, Checkbox, FormGrid, Input, Select, SubmitButton } from "@/components/ui/form";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { getOnboarding, ONBOARDING_STEPS, LEGAL_CHECKLIST } from "@/modules/companies/onboarding";
import { getSetting } from "@/server/settings";
import { cn } from "@/lib/utils";
import { CompanyForm } from "../admin/empresas/company-form";
import { createBankAccountAction } from "../admin/empresas/actions";
import { Attachments } from "@/components/attachments";
import { companyStepAction, structureStepAction, financeStepAction, operationStepAction, governanceStepAction, checklistAction } from "./actions";
import { todayIn } from "@/lib/dates";

export const metadata = { title: "Configuração inicial" };
const WEEK = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const st = await getOnboarding(ctx);
  const step = Math.min(6, Math.max(1, Number((await searchParams).step ?? st.step) || 1));
  const companyId = st.data.empresa?.companyId as string | undefined;
  const company = companyId ? await ctx.db.company.findFirst({ where: { id: companyId } }) : null;

  return (
    <>
      <PageHeader title="Configuração inicial da empresa" subtitle="Seu progresso é salvo a cada etapa. Você pode sair e retomar quando quiser." breadcrumbs={[{ label: "Início", href: "/app" }, { label: "Configuração inicial" }]} />
      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Etapas">
        {ONBOARDING_STEPS.map((s) => (
          <li key={s.n}>
            <Link href={`/app/onboarding?step=${s.n}`} aria-current={s.n === step ? "step" : undefined}
              className={cn("block rounded-full border px-3 py-1 text-sm", s.n === step ? "border-brand-600 bg-brand-600 text-white" : s.n < st.step ? "border-emerald-300 bg-emerald-50 text-emerald-800" : "border-slate-300 bg-white text-slate-600")}>
              {s.n}. {s.title}
            </Link>
          </li>
        ))}
      </ol>
      {st.completedAt && <div className="mb-4"><Notice tone="success">Configuração inicial concluída. Você pode revisar qualquer etapa.</Notice></div>}

      {step === 1 && (
        <Card title="1. Dados da empresa (matriz)">
          <CompanyForm action={companyStepAction} company={company ? { ...company, address: company.address as Record<string, string> } : undefined} allowBranch={false} submitLabel="Salvar e continuar" />
        </Card>
      )}
      {step === 2 && <StructureStep ctxOrgId={ctx.orgId} />}
      {step === 3 && <FinanceStep companyId={companyId} tz={ctx.timezone} />}
      {step === 4 && <OperationStep />}
      {step === 5 && <GovernanceStep />}
      {step === 6 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="6. Checklist de processos externos">
            <p className="mb-3 text-sm text-slate-600">Acompanhamento apenas. O ERP não realiza registros em órgãos públicos.</p>
            <ActionForm action={checklistAction}>
              <div className="space-y-2">
                {LEGAL_CHECKLIST.map((c) => <Checkbox key={c.key} name="checked[]" value={c.key} label={c.label} defaultChecked={((st.data.checklist?.checked as string[]) ?? []).includes(c.key)} />)}
              </div>
              <div className="flex gap-2">
                <SubmitButton variant="secondary">Salvar checklist</SubmitButton>
                <SubmitButton name="finish" value="1">Concluir configuração</SubmitButton>
              </div>
            </ActionForm>
          </Card>
          {companyId ? <Attachments ctx={ctx} entity="Company" entityId={companyId} back="/app/onboarding?step=6" title="Logotipo e comprovantes" /> : <Notice tone="warn">Cadastre a empresa na etapa 1 para anexar logotipo e documentos.</Notice>}
        </div>
      )}
    </>
  );

  async function StructureStep({ ctxOrgId }: { ctxOrgId: string }) {
    void ctxOrgId;
    const [companies, units, ccs] = await Promise.all([ctx.db.company.findMany(), ctx.db.businessUnit.findMany(), ctx.db.costCenter.findMany()]);
    return (
      <Card title="2. Estrutura: filiais, unidades de negócio e centros de custo">
        <div className="grid gap-4 md:grid-cols-3 text-sm">
          <div><b>Empresas ({companies.length})</b><ul className="mt-1 list-disc pl-5">{companies.map((c) => <li key={c.id}>{c.legalName} {c.kind === "BRANCH" && "(filial)"}</li>)}</ul><Link className="text-brand-700 underline" href="/app/admin/empresas">Adicionar filial/empresa</Link></div>
          <div><b>Unidades ({units.length})</b><ul className="mt-1 list-disc pl-5">{units.map((u) => <li key={u.id}>{u.name}</li>)}</ul><Link className="text-brand-700 underline" href="/app/config/unidades">Cadastrar unidades</Link></div>
          <div><b>Centros de custo ({ccs.length})</b><ul className="mt-1 list-disc pl-5">{ccs.map((u) => <li key={u.id}>{u.code} {u.name}</li>)}</ul><Link className="text-brand-700 underline" href="/app/config/centros-custo">Cadastrar centros de custo</Link></div>
        </div>
        <p className="mt-4 text-sm">Setor de atividade: <b>{sectorProfile(ctx.sector).name}</b> — define tipos de projeto, serviços, papéis e termos iniciais. <Link className="text-brand-700 underline" href="/app/config/setor">Alterar setor ou terminologia</Link></p>
        <ActionForm action={structureStepAction} className="mt-4"><SubmitButton>Continuar</SubmitButton></ActionForm>
      </Card>
    );
  }

  async function FinanceStep({ companyId, tz }: { companyId?: string; tz: string }) {
    const [terms, billing, commercial, accounts] = await Promise.all([ctx.db.paymentTerm.findMany({ where: { active: true } }), getSetting(ctx, "billing"), getSetting(ctx, "commercial"), ctx.db.bankAccount.findMany()]);
    return (
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="3. Preferências financeiras e comerciais">
          <ActionForm action={financeStepAction}>
            <Input name="defaultDueDays" type="number" label="Prazo padrão de vencimento (dias)" defaultValue={String(billing.defaultDueDays)} />
            <Select name="defaultPaymentTermId" label="Condição de pagamento padrão" options={terms.map((t) => ({ value: t.id, label: t.name }))} placeholder="—" />
            <Input name="defaultTaxRatePct" label="Tributos estimados sobre receita para propostas (%)" defaultValue={commercial.defaultTaxRatePct} hint="Estimativa gerencial informada por você — não é regra fiscal." />
            <SubmitButton>Salvar e continuar</SubmitButton>
          </ActionForm>
        </Card>
        <Card title={`Contas bancárias (${accounts.length})`}>
          {companyId ? (
            <ActionForm action={createBankAccountAction} resetOnSuccess>
              <input type="hidden" name="companyId" value={companyId} />
              <FormGrid cols={2}>
                <Input name="name" label="Nome da conta" required />
                <Input name="bankCode" label="Banco" />
                <Input name="agency" label="Agência" />
                <Input name="accountNumber" label="Conta" />
                <Input name="openingBalance" label="Saldo inicial" defaultValue="0,00" />
                <Input name="openingDate" type="date" label="Data do saldo" defaultValue={todayIn(tz)} />
              </FormGrid>
              <SubmitButton variant="secondary">Adicionar conta</SubmitButton>
            </ActionForm>
          ) : <Notice tone="warn">Cadastre a empresa primeiro.</Notice>}
        </Card>
      </div>
    );
  }

  async function OperationStep() {
    const [cal, services] = await Promise.all([ctx.db.workCalendar.findFirst({ orderBy: { createdAt: "asc" } }), ctx.db.service.findMany({ orderBy: { code: "asc" } })]);
    if (!cal) return <Notice tone="error">Calendário padrão não encontrado.</Notice>;
    return (
      <Card title="4. Calendário de trabalho e serviços oferecidos">
        <ActionForm action={operationStepAction}>
          <input type="hidden" name="calendarId" value={cal.id} />
          <fieldset><legend className="mb-2 text-sm font-medium">Horas de trabalho por dia ({cal.name})</legend>
            <div className="grid grid-cols-4 gap-2 md:grid-cols-7">
              {WEEK.map((d, i) => <Input key={d} name={`h${i}`} label={d} defaultValue={String(cal.weeklyHours[i] ?? 0)} inputMode="decimal" />)}
            </div>
          </fieldset>
          <fieldset><legend className="mb-2 text-sm font-medium">Serviços oferecidos</legend>
            <div className="grid gap-2 md:grid-cols-3">{services.map((s) => <Checkbox key={s.id} name="services[]" value={s.id} label={`${s.code} — ${s.name}`} defaultChecked={s.active} />)}</div>
          </fieldset>
          <p className="text-xs text-slate-500">Feriados e outros calendários: Configurador › Calendários.</p>
          <SubmitButton>Salvar e continuar</SubmitButton>
        </ActionForm>
      </Card>
    );
  }

  async function GovernanceStep() {
    const [rules, sod, seqs] = await Promise.all([ctx.db.approvalRule.findMany({ where: { docType: "PROPOSAL" } }), getSetting(ctx, "sod"), ctx.db.documentSequence.findMany({ where: { companyId: "" } })]);
    const disc = rules.find((r) => r.maxDiscountPct !== null)?.maxDiscountPct?.toString() ?? "10";
    const marg = rules.find((r) => r.minMarginPct !== null)?.minMarginPct?.toString() ?? "25";
    const high = rules.find((r) => r.requiredPermission === "proposal.approve_high")?.minAmount?.toString() ?? "500000";
    const pfx = (t: string, d: string) => seqs.find((s) => s.docType === t)?.prefix ?? d;
    return (
      <Card title="5. Regras de aprovação e numeração">
        <ActionForm action={governanceStepAction}>
          <FormGrid cols={3}>
            <Input name="proposalMaxDiscountPct" label="Proposta: aprovar se desconto acima de (%)" defaultValue={disc} />
            <Input name="proposalMinMarginPct" label="Proposta: aprovar se margem abaixo de (%)" defaultValue={marg} />
            <Input name="proposalHighValue" label="Proposta: aprovação da diretoria acima de (R$)" defaultValue={high} />
          </FormGrid>
          <div className="space-y-2">
            <Checkbox name="requesterCannotApprove" label="Segregação: quem solicita não pode aprovar" defaultChecked={sod.requesterCannotApprove} />
            <Checkbox name="approverCannotPay" label="Segregação: quem aprova a conta a pagar não registra o pagamento" defaultChecked={sod.approverCannotPay} />
          </div>
          <FormGrid cols={4}>
            <Input name="prefixProposal" label="Prefixo propostas" defaultValue={pfx("PROPOSAL", "PRP")} />
            <Input name="prefixContract" label="Prefixo contratos" defaultValue={pfx("CONTRACT", "CTR")} />
            <Input name="prefixProject" label="Prefixo projetos" defaultValue={pfx("PROJECT", "PRJ")} />
            <Input name="prefixBilling" label="Prefixo cobranças" defaultValue={pfx("BILLING_DOCUMENT", "COB")} />
          </FormGrid>
          <p className="text-xs text-slate-500">Demais alçadas (compras, despesas, pagamentos, medições): Configurador › Regras de aprovação.</p>
          <SubmitButton>Salvar e continuar</SubmitButton>
        </ActionForm>
      </Card>
    );
  }
}
