"use client";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { useActionState, startTransition } from "react";
import { priceProposal, type LineKind } from "@/domain/pricing";
import { formatMoney, formatPct } from "@/lib/money";
import { saveDraftAction } from "./actions";

type Opt = { value: string; label: string };
type Line = { kind: LineKind; description: string; serviceId: string; teamRoleId: string; seniorityId: string; hours: string; quantity: string; unitPrice: string; unitCost: string; billable: boolean };
export interface EditorValues {
  commercialModel: string; scope: string; deliverables: string; assumptions: string; exclusions: string; schedule: string; startDate: string; endDate: string; months: string; validUntil: string;
  paymentTermId: string; discountPct: string; taxRatePct: string; lines: Line[];
}
const KINDS: Opt[] = [["LABOR", "Perfil/esforço (horas)"], ["FIXED", "Valor fechado"], ["RECURRING", "Recorrente (meses)"], ["EXPENSE", "Despesa reembolsável"], ["THIRD_PARTY", "Terceiro"], ["LICENSE", "Licença"]].map(([value, label]) => ({ value, label }));
const MODELS: Opt[] = [["FIXED_PRICE", "Preço fechado"], ["TIME_MATERIAL", "Time & material"], ["MONTHLY_ALLOCATION", "Alocação mensal"], ["HOUR_PACKAGE", "Pacote de horas"], ["AMS_RECURRING", "Recorrente com franquia (AMS, manutenção, fee)"], ["ADVISORY", "Advisory"], ["TRAINING", "Treinamento"], ["HYBRID", "Híbrido"]].map(([value, label]) => ({ value, label }));
const n = (s: string) => { const v = (s ?? "").trim(); if (!v) return "0"; const x = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v; return /^-?\d+(\.\d+)?$/.test(x) ? x : "0"; };
const cls = "w-full rounded border border-slate-300 px-1.5 py-1 text-sm";

export function ProposalEditor({ proposalId, initial, lk, readOnly, showCost, rateHints }: { proposalId: string; initial: EditorValues; lk: { services: Opt[]; roles: Opt[]; seniorities: Opt[]; terms: Opt[] }; readOnly: boolean; showCost: boolean; rateHints: Record<string, { rate: string; cost: string }> }) {
  const { register, control, handleSubmit, setValue, getValues } = useForm<EditorValues>({ defaultValues: initial });
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const watched = useWatch({ control });
  const [state, action, pending] = useActionState(saveDraftAction, undefined);
  let totals: ReturnType<typeof priceProposal> | null = null;
  let calcError = "";
  try {
    totals = priceProposal((watched.lines ?? []).map((l) => ({ kind: (l?.kind ?? "LABOR") as LineKind, hours: n(l?.hours ?? ""), quantity: n(l?.quantity ?? "1"), unitPrice: n(l?.unitPrice ?? ""), unitCost: n(l?.unitCost ?? ""), billable: l?.billable !== false })), n(watched.discountPct ?? "0"), n(watched.taxRatePct ?? "0"));
  } catch (e) { calcError = (e as Error).message; }

  function onSubmit(v: EditorValues) {
    const fd = new FormData();
    fd.set("proposalId", proposalId);
    for (const k of ["commercialModel", "scope", "deliverables", "assumptions", "exclusions", "schedule", "startDate", "endDate", "months", "validUntil", "paymentTermId", "discountPct", "taxRatePct"] as const) fd.set(k, String(v[k] ?? ""));
    for (const l of v.lines) {
      fd.append("lineKind[]", l.kind); fd.append("lineDescription[]", l.description); fd.append("lineServiceId[]", l.serviceId); fd.append("lineTeamRoleId[]", l.teamRoleId);
      fd.append("lineSeniorityId[]", l.seniorityId); fd.append("lineHours[]", l.hours); fd.append("lineQuantity[]", l.quantity); fd.append("lineUnitPrice[]", l.unitPrice); fd.append("lineUnitCost[]", l.unitCost); fd.append("lineBillable[]", l.billable ? "1" : "0");
    }
    startTransition(() => action(fd));
  }
  function suggest(i: number) {
    const l = getValues(`lines.${i}`);
    const h = rateHints[`${l.teamRoleId}|${l.seniorityId}`] ?? rateHints[`${l.teamRoleId}|`];
    if (h) { setValue(`lines.${i}.unitPrice`, h.rate); if (showCost) setValue(`lines.${i}.unitCost`, h.cost); }
  }
  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <fieldset disabled={readOnly} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <label className="text-xs font-medium">Modelo comercial<select className={cls} {...register("commercialModel")}>{MODELS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}</select></label>
          <label className="text-xs font-medium">Início<input type="date" className={cls} {...register("startDate")} /></label>
          <label className="text-xs font-medium">Término<input type="date" className={cls} {...register("endDate")} /></label>
          <label className="text-xs font-medium">Meses (recorrência)<input type="number" min={1} className={cls} {...register("months")} /></label>
          <label className="text-xs font-medium">Validade da proposta<input type="date" className={cls} {...register("validUntil")} /></label>
          <label className="text-xs font-medium">Condição de pagamento<select className={cls} {...register("paymentTermId")}><option value="">—</option>{lk.terms.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
          <label className="text-xs font-medium">Desconto (%)<input className={cls} {...register("discountPct")} /></label>
          <label className="text-xs font-medium">Tributos estimados (%)<input className={cls} {...register("taxRatePct")} /></label>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500"><th className="p-1">Tipo</th><th className="p-1">Descrição</th><th className="p-1">Serviço</th><th className="p-1">Papel</th><th className="p-1">Senioridade</th><th className="p-1">Horas</th><th className="p-1">Qtd.</th><th className="p-1">Preço unit./tarifa</th>{showCost && <th className="p-1">Custo unit.</th>}<th className="p-1">Fat.</th><th className="p-1 text-right">Receita</th>{showCost && <th className="p-1 text-right">Custo</th>}<th /></tr></thead>
            <tbody>
              {fields.map((f, i) => (
                <tr key={f.id} className="border-t align-top">
                  <td className="p-1"><select aria-label="Tipo" className={cls} {...register(`lines.${i}.kind`)}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></td>
                  <td className="p-1"><input aria-label="Descrição" className={cls} {...register(`lines.${i}.description`)} /></td>
                  <td className="p-1"><select aria-label="Serviço" className={cls} {...register(`lines.${i}.serviceId`)}><option value="">—</option>{lk.services.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></td>
                  <td className="p-1"><select aria-label="Papel" className={cls} {...register(`lines.${i}.teamRoleId`, { onChange: () => suggest(i) })}><option value="">—</option>{lk.roles.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></td>
                  <td className="p-1"><select aria-label="Senioridade" className={cls} {...register(`lines.${i}.seniorityId`, { onChange: () => suggest(i) })}><option value="">—</option>{lk.seniorities.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select></td>
                  <td className="p-1"><input aria-label="Horas" className={`${cls} w-20`} {...register(`lines.${i}.hours`)} /></td>
                  <td className="p-1"><input aria-label="Quantidade" className={`${cls} w-16`} {...register(`lines.${i}.quantity`)} /></td>
                  <td className="p-1"><input aria-label="Preço unitário" className={`${cls} w-24`} {...register(`lines.${i}.unitPrice`)} /></td>
                  {showCost && <td className="p-1"><input aria-label="Custo unitário" className={`${cls} w-24`} {...register(`lines.${i}.unitCost`)} /></td>}
                  <td className="p-1 text-center"><input aria-label="Faturável" type="checkbox" {...register(`lines.${i}.billable`)} /></td>
                  <td className="p-1 text-right tabular-nums">{totals ? formatMoney(totals.lines[i]?.revenue ?? 0) : "—"}</td>
                  {showCost && <td className="p-1 text-right tabular-nums">{totals ? formatMoney(totals.lines[i]?.cost ?? 0) : "—"}</td>}
                  <td className="p-1">{!readOnly && <button type="button" onClick={() => remove(i)} className="text-xs text-red-700">remover</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!readOnly && <button type="button" className="mt-2 text-sm text-brand-700" onClick={() => append({ kind: "LABOR", description: "", serviceId: "", teamRoleId: "", seniorityId: "", hours: "0", quantity: "1", unitPrice: "0", unitCost: "0", billable: true })}>+ adicionar linha</button>}
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {(["scope", "deliverables", "assumptions", "exclusions", "schedule"] as const).map((k) => (
            <label key={k} className="text-xs font-medium">{{ scope: "Escopo", deliverables: "Entregáveis", assumptions: "Premissas e restrições", exclusions: "Exclusões", schedule: "Cronograma" }[k]}<textarea rows={3} className={cls} {...register(k)} /></label>
          ))}
        </div>
      </fieldset>
      <div className="rounded-lg border bg-slate-50 p-3 text-sm" aria-live="polite">
        {calcError ? <p className="text-red-700">{calcError}</p> : totals && (
          <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <div><dt className="text-xs text-slate-500">Receita bruta</dt><dd className="font-medium">{formatMoney(totals.grossRevenue)}</dd></div>
            <div><dt className="text-xs text-slate-500">Desconto</dt><dd>{formatMoney(totals.discountAmount)}</dd></div>
            <div><dt className="text-xs text-slate-500">Receita líquida</dt><dd className="font-semibold">{formatMoney(totals.netRevenue)}</dd></div>
            <div><dt className="text-xs text-slate-500">Tributos estimados</dt><dd>{formatMoney(totals.taxAmount)}</dd></div>
            {showCost && <>
              <div><dt className="text-xs text-slate-500">Custo de pessoal</dt><dd>{formatMoney(totals.laborCost)}</dd></div>
              <div><dt className="text-xs text-slate-500">Terceiros/licenças</dt><dd>{formatMoney(totals.thirdPartyCost)}</dd></div>
              <div><dt className="text-xs text-slate-500">Despesas</dt><dd>{formatMoney(totals.expenseCost)}</dd></div>
              <div><dt className="text-xs text-slate-500">Margem de contribuição</dt><dd className="font-semibold">{formatMoney(totals.contributionMargin)} ({formatPct(totals.marginPct)})</dd></div>
              <div><dt className="text-xs text-slate-500">Markup</dt><dd>{formatPct(totals.markup)}</dd></div>
            </>}
            <div><dt className="text-xs text-slate-500">Horas</dt><dd>{totals.totalHours.toString()}</dd></div>
          </dl>
        )}
      </div>
      {state?.error && <div role="alert" className="rounded border border-red-200 bg-red-50 p-2 text-sm text-red-800">{state.error}</div>}
      {state?.ok && <div role="status" className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">{state.message}</div>}
      {!readOnly && <button type="submit" disabled={pending} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Salvando…" : "Salvar rascunho"}</button>}
    </form>
  );
}
