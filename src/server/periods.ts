import { AppError } from "@/lib/errors";
import { civil, monthStart, toCivil, type CivilDate } from "@/lib/dates";

type PeriodReader = { accountingPeriod: { findFirst: (args: { where: Record<string, unknown> }) => Promise<{ status: string } | null> } };

/** Garante que o período (mês da data) está aberto para a empresa. Período sem registro = aberto. */
export async function assertPeriodOpen(db: PeriodReader, companyId: string, date: CivilDate | Date, what = "Operação") {
  const d = typeof date === "string" ? date : toCivil(date);
  const p = await db.accountingPeriod.findFirst({ where: { companyId, month: civil(monthStart(d)) } });
  if (p?.status === "CLOSED") {
    throw new AppError("PERIOD_CLOSED", `${what} não permitida: o período ${d.slice(5, 7)}/${d.slice(0, 4)} está fechado. Solicite reabertura à controladoria.`);
  }
}

export async function isPeriodOpen(db: PeriodReader, companyId: string, date: CivilDate) {
  const p = await db.accountingPeriod.findFirst({ where: { companyId, month: civil(monthStart(date)) } });
  return p?.status !== "CLOSED";
}
