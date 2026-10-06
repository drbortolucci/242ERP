"use client";
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type ReactNode, type ComponentProps, type FormEvent } from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/utils";
import type { ActionState } from "@/server/action";

type Action = (prev: ActionState | undefined, fd: FormData) => Promise<ActionState>;


/** Formulário ligado a uma Server Action com mensagens de erro/sucesso e erros por campo. */
const PendingContext = createContext(false);

/**
 * Formulário ligado a uma Server Action com mensagens de erro/sucesso.
 * Submete via transição (sem a prop `action`) para que o React NÃO limpe os campos quando há erro.
 */
export function ActionForm({ action, children, className, resetOnSuccess, successMessage = true, id }: { action: Action; children: ReactNode; className?: string; resetOnSuccess?: boolean; successMessage?: boolean; id?: string }) {
  const [state, formAction, pending] = useActionState(action, undefined);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
  }, [state, resetOnSuccess]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  }
  return (
    <PendingContext.Provider value={pending}>
    <form ref={ref} onSubmit={onSubmit} className={cn("space-y-4", className)} id={id} noValidate aria-busy={pending}>
      {state?.error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{state.error}
        {state.fieldErrors && Object.keys(state.fieldErrors).length > 0 && (
          <ul className="mt-1 list-disc pl-5 text-xs">{Object.entries(state.fieldErrors).map(([k, v]) => <li key={k}><b>{k}</b>: {v}</li>)}</ul>
        )}
      </div>}
      {state?.ok && successMessage && state.message && <div role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</div>}
      {children}
    </form>
    </PendingContext.Provider>
  );
}

export function SubmitButton({ children = "Salvar", variant = "primary", className, confirm, name, value }: { children?: ReactNode; variant?: "primary" | "secondary" | "danger"; className?: string; confirm?: string; name?: string; value?: string }) {
  const ctxPending = useContext(PendingContext);
  const { pending: statusPending } = useFormStatus();
  const pending = ctxPending || statusPending;
  const v = { primary: "bg-brand-600 text-white hover:bg-brand-700", secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50", danger: "bg-red-600 text-white hover:bg-red-700" }[variant];
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={pending}
      onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
      className={cn("inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60", v, className)}>
      {pending ? "Processando…" : children}
    </button>
  );
}

export function Field({ label, name, hint, children, className, required }: { label: string; name?: string; hint?: string; children: ReactNode; className?: string; required?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={name} className="text-xs font-medium text-slate-700">{label}{required && <span className="text-red-600"> *</span>}</label>
      {children}
      {hint && <p className="text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

const inputCls = "w-full rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 disabled:bg-slate-100";

export function Input({ label, hint, className, required, ...props }: ComponentProps<"input"> & { label?: string; hint?: string }) {
  const el = <input id={props.name} required={required} className={cn(inputCls, className)} {...props} />;
  return label ? <Field label={label} name={props.name} hint={hint} required={required}>{el}</Field> : el;
}

export function MoneyInput(props: ComponentProps<"input"> & { label?: string; hint?: string }) {
  return <Input inputMode="decimal" placeholder="0,00" {...props} />;
}

export function Textarea({ label, hint, className, required, ...props }: ComponentProps<"textarea"> & { label?: string; hint?: string }) {
  const el = <textarea id={props.name} rows={3} required={required} className={cn(inputCls, className)} {...props} />;
  return label ? <Field label={label} name={props.name} hint={hint} required={required}>{el}</Field> : el;
}

export function Select({ label, hint, options, placeholder, className, required, ...props }: ComponentProps<"select"> & { label?: string; hint?: string; options: { value: string; label: string }[]; placeholder?: string }) {
  const el = (
    <select id={props.name} required={required} className={cn(inputCls, className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  return label ? <Field label={label} name={props.name} hint={hint} required={required}>{el}</Field> : el;
}

export function Checkbox({ label, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" {...props} />
      {label}
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const map = { 1: "", 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-2 lg:grid-cols-4" };
  return <div className={cn("grid grid-cols-1 gap-4", map[cols])}>{children}</div>;
}

/** Botão que dispara uma Server Action simples (formulário oculto) com confirmação opcional. */
export function ActionButton({ action, fields, children, variant = "secondary", confirm }: { action: Action; fields: Record<string, string>; children: ReactNode; variant?: "primary" | "secondary" | "danger"; confirm?: string }) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="inline-flex flex-col items-start">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <SubmitButton variant={variant} confirm={confirm}>{children}</SubmitButton>
      {state?.error && <span role="alert" className="mt-1 max-w-xs text-xs text-red-700">{state.error}</span>}
      {state?.ok && state.message && <span role="status" className="mt-1 text-xs text-emerald-700">{state.message}</span>}
    </form>
  );
}
