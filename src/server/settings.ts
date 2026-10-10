import type { Ctx } from "./context";

/** Configurações da organização com valores padrão explícitos. */
export const SETTING_DEFAULTS = {
  /** Segregação de funções */
  sod: {
    requesterCannotApprove: true, // quem solicita não aprova (propostas, compras, despesas, horas próprias)
    approverCannotPay: true, // quem aprova conta a pagar não registra o pagamento
    measurementCreatorCannotApprove: false,
  },
  timesheet: {
    maxHoursPerDay: 12,
    allowFutureDays: 0,
    lockAfterDays: 35, // apontamentos com data anterior a hoje - N dias exigem período aberto e permissão
    overtimeAfterHoursPerDay: 8,
  },
  allocation: {
    overallocationTolerancePct: 0,
  },
  billing: {
    defaultDueDays: 30,
  },
  modules: {
    enabled: ["crm", "projects", "resources", "timesheet", "expenses", "procurement", "ams", "billing", "finance", "controlling", "portal"],
  },
  closing: {
    requireReasonToReopen: true,
  },
  commercial: {
    defaultProposalValidityDays: 30,
    defaultTaxRatePct: "0",
  },
  revenueRecognition: {
    approvedBy: null as string | null,
    approvedAt: null as string | null,
    notes: "Reconhecimento gerencial conforme método do contrato. Requer aprovação do responsável da empresa.",
  },
  /** Personalização da terminologia exibida (vazio = termo do setor). Ver src/domain/sectors.ts */
  terminology: {} as Partial<Record<"project" | "projects" | "professional" | "professionals" | "ticket" | "tickets" | "supportArea" | "balances" | "systemField" | "moduleField", string>>,
  suspension: {
    graceDays: 15, // dias em inadimplência antes de suspender
    retentionDaysAfterCancel: 90,
  },
};

export type SettingKey = keyof typeof SETTING_DEFAULTS;
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K];

export async function getSetting<K extends SettingKey>(ctx: Pick<Ctx, "db">, key: K): Promise<SettingValue<K>> {
  const row = await ctx.db.orgSetting.findFirst({ where: { key } });
  const def = SETTING_DEFAULTS[key];
  if (!row) return def;
  return { ...def, ...(row.value as object) } as SettingValue<K>;
}

export async function setSetting<K extends SettingKey>(ctx: Pick<Ctx, "db" | "orgId">, key: K, value: Partial<SettingValue<K>>) {
  const current = await getSetting(ctx, key);
  const merged = { ...current, ...value };
  await ctx.db.orgSetting.upsert({
    where: { organizationId_key: { organizationId: ctx.orgId, key } },
    create: { organizationId: ctx.orgId, key, value: merged as object },
    update: { value: merged as object },
  });
  return merged;
}
