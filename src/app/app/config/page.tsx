import Link from "next/link";
import { PageHeader, Card } from "@/components/ui/page";
import { pagePerm } from "@/server/page-guard";
import { requireCtx } from "@/server/auth/next";
import { CONFIG_ENTITIES } from "@/modules/config/registry";
import { CONFIG_GROUPS } from "@/modules/config/service";

export const metadata = { title: "Configurador" };

const SPECIAL = [
  { group: "Organização", items: [
    { href: "/app/config/setor", title: "Setor de atividade e terminologia", description: "Perfil do setor de serviços, termos exibidos (projeto, chamado, profissional…) e modelos de WBS por tipo de projeto." },
    { href: "/app/admin/empresas", title: "Empresas, filiais e contas bancárias", description: "Entidades jurídicas, CNPJ, regime informado, endereço, contas." },
    { href: "/app/config/calendarios", title: "Calendários, feriados e capacidade", description: "Horas por dia da semana, janela de atendimento e feriados." },
    { href: "/app/config/politicas", title: "Políticas e módulos", description: "Segregação de funções, limites de horas, fechamento, módulos habilitados, reconhecimento de receita." },
    { href: "/app/config/numeracao", title: "Numeração de documentos", description: "Prefixos e próximos números por tipo de documento." },
  ] },
  { group: "Comercial", items: [
    { href: "/app/config/tabelas-preco", title: "Tabelas de preços e custos", description: "Tarifas por papel/senioridade/serviço com vigência." },
    { href: "/app/config/condicoes-pagamento", title: "Condições de pagamento", description: "Parcelas em dias e percentuais (soma 100%)." },
  ] },
  { group: "Atendimento e contratos recorrentes", items: [{ href: "/app/config/sla", title: "Regras de SLA", description: "Prazos de resposta/solução por prioridade, pausas, reabertura e encerramento." }] },
  { group: "Integrações", items: [{ href: "/app/config/integracoes", title: "Integrações", description: "E-mail, NFS-e, assinatura eletrônica, bancos, contabilidade, API." }] },
];

export default async function ConfigIndex() {
  const ctx = await requireCtx();
  pagePerm(ctx, "settings.manage");
  const groups = [...new Set([...SPECIAL.map((s) => s.group), ...CONFIG_GROUPS])];
  return (
    <>
      <PageHeader title="Configurador central" subtitle="Parâmetros dos processos da empresa. Alterações são auditadas; documentos emitidos preservam valores históricos (snapshot/vigência)." breadcrumbs={[{ label: "Início", href: "/app" }, { label: "Configurador" }]} />
      <div className="space-y-6">
        {groups.map((g) => (
          <Card key={g} title={g}>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {SPECIAL.filter((s) => s.group === g).flatMap((s) => s.items).map((i) => (
                <li key={i.href}><Link href={i.href} className="block rounded border border-slate-200 p-3 hover:border-brand-500"><b className="text-sm">{i.title}</b><p className="text-xs text-slate-500">{i.description}</p></Link></li>
              ))}
              {CONFIG_ENTITIES.filter((e) => e.group === g).map((e) => (
                <li key={e.key}><Link href={`/app/config/${e.key}`} className="block rounded border border-slate-200 p-3 hover:border-brand-500"><b className="text-sm">{e.title}</b><p className="text-xs text-slate-500">{e.description}</p></Link></li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </>
  );
}
