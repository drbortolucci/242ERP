"use client";
import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  const forbidden = /permiss|alçada|escopo/i.test(error.message);
  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-lg border border-red-200 bg-white p-6 text-center">
      <h1 className="text-lg font-semibold text-slate-900">{forbidden ? "Acesso não permitido" : "Não foi possível concluir"}</h1>
      <p className="mt-2 text-sm text-slate-600">{error.message?.startsWith("Erro") || forbidden ? error.message : "Ocorreu um erro. Tente novamente; se persistir, informe o código abaixo ao suporte."}</p>
      {error.digest && <p className="mt-1 text-xs text-slate-400">Código: {error.digest}</p>}
      <button onClick={reset} className="mt-4 rounded-md border px-3 py-1.5 text-sm">Tentar novamente</button>
    </div>
  );
}
