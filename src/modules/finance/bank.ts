/** Movimento bancário (livro): base de saldos, conciliação e fluxo de caixa realizado. */
import type { Ctx } from "@/server/context";
import type { TenantTx } from "@/server/tenant-db";
import { civil } from "@/lib/dates";
import { money, type DecimalInput } from "@/lib/money";
import { rule } from "@/lib/errors";

export async function postBankTx(ctx: Ctx, tx: TenantTx, i: { bankAccountId: string; companyId?: string; date: string; amount: DecimalInput; description: string; kind: string; transferId?: string; reversalOfId?: string }) {
  const acc = await tx.bankAccount.findFirst({ where: { id: i.bankAccountId } });
  if (!acc || !acc.active) throw rule("Conta bancária inválida ou inativa.");
  if (i.companyId && acc.companyId !== i.companyId) throw rule("A conta bancária pertence a outra empresa.");
  return tx.bankTransaction.create({ data: { organizationId: ctx.orgId, companyId: acc.companyId, bankAccountId: acc.id, date: civil(i.date), amount: money(i.amount), description: i.description, kind: i.kind, transferId: i.transferId ?? null, reversalOfId: i.reversalOfId ?? null, createdById: ctx.userId } });
}
