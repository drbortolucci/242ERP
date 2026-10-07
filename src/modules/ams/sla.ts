/** Carrega política, metas e calendário de SLA (usado por serviços com escopo de tenant e pela varredura do sistema). */
import { prisma } from "@/server/db";
import { toCivil } from "@/lib/dates";
import type { SlaCalendar } from "@/domain/sla";
import { addBusinessMinutes } from "@/domain/sla";

export interface SlaSetup {
  policy: { id: string; name: string; pauseStatuses: string[]; reopenWindowDays: number; autoCloseDays: number } | null;
  targets: Record<string, { responseMinutes: number; resolutionMinutes: number; escalateAfterPct: number }>;
  calendar: SlaCalendar;
}

export const DEFAULT_PAUSE = ["WAITING_CUSTOMER", "WAITING_THIRD_PARTY"];

/** Sem política: SLA não é aplicado (prazos nulos). Sem calendário: seg–sex 09–18 no fuso informado. */
export async function loadSla(orgId: string, policyId: string | null | undefined, fallbackTz: string): Promise<SlaSetup> {
  const policy = policyId
    ? await prisma.slaPolicy.findFirst({ where: { id: policyId, organizationId: orgId } })
    : await prisma.slaPolicy.findFirst({ where: { organizationId: orgId, active: true }, orderBy: { name: "asc" } });
  const targets = policy ? await prisma.slaTarget.findMany({ where: { policyId: policy.id, organizationId: orgId } }) : [];
  const cal = policy?.calendarId
    ? await prisma.workCalendar.findFirst({ where: { id: policy.calendarId, organizationId: orgId } })
    : await prisma.workCalendar.findFirst({ where: { organizationId: orgId, active: true }, orderBy: { createdAt: "asc" } });
  const holidays = cal ? await prisma.holiday.findMany({ where: { calendarId: cal.id, organizationId: orgId } }) : [];
  return {
    policy: policy ? { id: policy.id, name: policy.name, pauseStatuses: policy.pauseStatuses.length ? policy.pauseStatuses : DEFAULT_PAUSE, reopenWindowDays: policy.reopenWindowDays, autoCloseDays: policy.autoCloseDays } : null,
    targets: Object.fromEntries(targets.map((t) => [t.priority, { responseMinutes: t.responseMinutes, resolutionMinutes: t.resolutionMinutes, escalateAfterPct: t.escalateAfterPct }])),
    calendar: {
      timezone: cal?.timezone ?? fallbackTz,
      startMinute: cal?.businessStartMinute ?? 540,
      endMinute: cal?.businessEndMinute ?? 1080,
      weeklyHours: cal ? cal.weeklyHours.map((h) => Number(h)) : [0, 8, 8, 8, 8, 8, 0],
      holidays: new Set(holidays.map((h) => toCivil(h.date))),
    },
  };
}

export function dueDates(setup: SlaSetup, priority: string, openedAt: Date, pausedMinutes = 0) {
  const t = setup.targets[priority];
  if (!t) return { responseDueAt: null, resolutionDueAt: null };
  return { responseDueAt: addBusinessMinutes(openedAt, t.responseMinutes, setup.calendar), resolutionDueAt: addBusinessMinutes(openedAt, t.resolutionMinutes + pausedMinutes, setup.calendar) };
}
