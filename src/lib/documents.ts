/** Validação de CNPJ e CPF (formato e dígitos verificadores). Não consulta órgãos públicos. */
export function onlyDigits(s: string): string {
  return (s || "").replace(/\D/g, "");
}

export function isValidCnpj(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 14 || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (base: string, weights: number[]) => {
    const s = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(c.slice(0, 12), w1);
  const d2 = calc(c.slice(0, 12) + d1, w2);
  return c.endsWith(`${d1}${d2}`);
}

export function isValidCpf(input: string): boolean {
  const c = onlyDigits(input);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const calc = (len: number) => {
    let s = 0;
    for (let i = 0; i < len; i++) s += Number(c[i]) * (len + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(c[9]) && calc(10) === Number(c[10]);
}

export function formatCnpj(input: string): string {
  const c = onlyDigits(input);
  if (c.length !== 14) return input;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

export function formatDocument(input: string | null | undefined): string {
  if (!input) return "—";
  const c = onlyDigits(input);
  if (c.length === 14) return formatCnpj(c);
  if (c.length === 11) return `${c.slice(0, 3)}.${c.slice(3, 6)}.${c.slice(6, 9)}-${c.slice(9)}`;
  return input;
}

/** Gera CNPJ válido a partir de 12 dígitos base (uso em dados fictícios/testes). */
export function cnpjFromBase(base12: string): string {
  const calc = (base: string, weights: number[]) => {
    const s = base.split("").reduce((acc, d, i) => acc + Number(d) * weights[i], 0);
    const r = s % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = calc(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calc(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return `${base12}${d1}${d2}`;
}
