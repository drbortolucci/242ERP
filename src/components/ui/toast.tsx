"use client";
import { useEffect, useState } from "react";

type Toast = { id: number; tone: "success" | "error"; text: string };
const listeners = new Set<(t: Toast) => void>();
let seq = 0;

/** Publica um aviso global (sobrevive à desmontagem do botão/formulário que executou a ação). */
export function pushToast(tone: Toast["tone"], text: string) {
  const t = { id: ++seq, tone, text };
  for (const l of listeners) l(t);
}

/** Área de avisos fixa no canto da tela (montada uma vez no layout da aplicação). */
export function Toaster() {
  const [items, setItems] = useState<Toast[]>([]);
  useEffect(() => {
    const on = (t: Toast) => {
      setItems((xs) => [...xs.slice(-3), t]);
      setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== t.id)), t.tone === "error" ? 9000 : 5000);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, []);
  if (!items.length) return null;
  return (
    <div aria-live="polite" className="no-print fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2">
      {items.map((t) => (
        <div key={t.id} role={t.tone === "error" ? "alert" : "status"} className={`rounded-md border px-3 py-2 text-sm shadow ${t.tone === "error" ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
