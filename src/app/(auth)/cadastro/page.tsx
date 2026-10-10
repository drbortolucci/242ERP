import Link from "next/link";
import { ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { DEFAULT_SECTOR, SECTOR_OPTIONS } from "@/domain/sectors";
import { signupAction } from "../actions";
import { prisma } from "@/server/db";
import { ensurePlans } from "@/modules/saas/plans";
import { formatMoney } from "@/lib/money";

export const metadata = { title: "Criar organização" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  await ensurePlans();
  const plans = await prisma.plan.findMany({ where: { active: true, isPublic: true }, orderBy: { rank: "asc" } });
  return (
    <>
      <h1 className="mb-1 text-lg font-semibold">Criar organização</h1>
      <p className="mb-4 text-sm text-slate-600">Comece com um período de avaliação gratuito. Nenhum cartão é solicitado.</p>
      <ActionForm action={signupAction}>
        <Input label="Nome da organização (sua empresa)" name="orgName" required />
        <Select label="Setor de atividade" name="sector" options={SECTOR_OPTIONS} defaultValue={DEFAULT_SECTOR} required hint="Define tipos de projeto, serviços, papéis e termos iniciais. Tudo pode ser alterado depois no configurador." />
        <Input label="Seu nome" name="userName" required />
        <Input label="E-mail" name="email" type="email" required autoComplete="email" />
        <Input label="Senha" name="password" type="password" required autoComplete="new-password" hint="Mínimo de 10 caracteres, com letras e números." />
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-700">Plano</legend>
          <div className="space-y-2">
            {plans.map((p, i) => (
              <label key={p.id} className="flex cursor-pointer items-start gap-2 rounded border p-2 text-sm has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
                <input type="radio" name="planCode" value={p.code} defaultChecked={i === 1} className="mt-1" />
                <span>
                  <b>{p.name}</b> — {formatMoney(p.priceMonthly)}/mês · {p.trialDays} dias grátis
                  <span className="block text-xs text-slate-500">até {p.maxUsers} usuários, {p.maxCompanies} empresa(s), {Math.round(p.maxStorageMb / 1024)} GB · {p.description}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="flex items-start gap-2 text-xs text-slate-600"><input type="checkbox" name="accept" className="mt-0.5" /> Li e aceito os termos de uso e a política de privacidade.</label>
        <SubmitButton className="w-full">Criar organização</SubmitButton>
      </ActionForm>
      <p className="mt-4 text-center text-sm"><Link className="text-brand-700 hover:underline" href="/login">Já tenho conta</Link></p>
    </>
  );
}
