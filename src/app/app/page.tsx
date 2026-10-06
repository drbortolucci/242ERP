import Link from "next/link";
import { PageHeader, Card, Notice } from "@/components/ui/page";
import { requireCtx } from "@/server/auth/next";
import { prisma } from "@/server/db";

export const metadata = { title: "Painel" };

export default async function Dashboard() {
  const ctx = await requireCtx();
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: ctx.orgId } });
  return (
    <>
      <PageHeader title={`Olá, ${ctx.userName.split(" ")[0]}`} subtitle={ctx.orgName} />
      {!org.onboardingDone && ctx.permissions.has("settings.manage") && (
        <div className="mb-6"><Notice tone="info">Conclua a <Link className="font-medium underline" href="/app/onboarding">configuração inicial da empresa</Link> para começar a operar.</Notice></div>
      )}
      <Card title="Painel">
        <p className="text-sm text-slate-600">Os indicadores do seu perfil aparecem aqui conforme os módulos forem utilizados.</p>
      </Card>
    </>
  );
}
