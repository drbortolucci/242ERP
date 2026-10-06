import { PageHeader, Card, Notice } from "@/components/ui/page";
import { ActionButton, ActionForm, Input, Select, SubmitButton } from "@/components/ui/form";
import { requireCtx } from "@/server/auth/next";
import { prisma } from "@/server/db";
import { otpauthUrl } from "@/server/auth/totp";
import { changePasswordAction, beginMfaAction, confirmMfaAction, disableMfaAction, savePrefsAction } from "./actions";

export const metadata = { title: "Meu perfil" };
export default async function ProfilePage() {
  const ctx = await requireCtx();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const prefs = (user.preferences ?? {}) as { dashboard?: string; pageSize?: number };
  return (
    <>
      <PageHeader title="Meu perfil e segurança" subtitle={`${user.name} · ${user.email}`} />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Alterar senha">
          <ActionForm action={changePasswordAction} resetOnSuccess>
            <Input name="current" type="password" label="Senha atual" autoComplete="current-password" required />
            <Input name="next" type="password" label="Nova senha" autoComplete="new-password" required />
            <Input name="confirm" type="password" label="Confirmar" autoComplete="new-password" required />
            <SubmitButton>Alterar</SubmitButton>
          </ActionForm>
        </Card>
        <Card title="Autenticação em duas etapas (TOTP)">
          {user.mfaEnabled ? (
            <>
              <Notice tone="success">Ativa.</Notice>
              <ActionForm action={disableMfaAction} className="mt-3"><Input name="password" type="password" label="Senha para desativar" required /><SubmitButton variant="danger">Desativar</SubmitButton></ActionForm>
            </>
          ) : user.mfaSecret ? (
            <>
              <p className="text-sm">Cadastre no aplicativo autenticador:</p>
              <code className="my-2 block break-all rounded bg-slate-100 p-2 text-xs">{otpauthUrl(user.mfaSecret, user.email)}</code>
              <p className="text-xs text-slate-500">Chave: <b>{user.mfaSecret}</b></p>
              <ActionForm action={confirmMfaAction} className="mt-2"><Input name="code" label="Código de 6 dígitos" inputMode="numeric" required /><SubmitButton>Confirmar ativação</SubmitButton></ActionForm>
            </>
          ) : <ActionButton action={beginMfaAction} fields={{}} variant="primary">Configurar</ActionButton>}
        </Card>
        <Card title="Preferências">
          <ActionForm action={savePrefsAction}>
            <Select name="dashboard" label="Painel inicial" defaultValue={prefs.dashboard ?? "auto"} options={[{ value: "auto", label: "Automático pelo perfil" }, { value: "director", label: "Diretoria" }, { value: "sales", label: "Comercial" }, { value: "pmo", label: "Gestão de projetos" }, { value: "purchasing", label: "Compras" }, { value: "finance", label: "Financeiro" }, { value: "controller", label: "Controladoria" }, { value: "consultant", label: "Consultor" }]} />
            <Input name="pageSize" type="number" label="Itens por página" defaultValue={String(prefs.pageSize ?? 25)} />
            <SubmitButton>Salvar</SubmitButton>
          </ActionForm>
        </Card>
      </div>
    </>
  );
}
