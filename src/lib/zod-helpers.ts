import { z } from "zod";
import { isCivilDate } from "./dates";
import { parseMoneyInput } from "./money";
import { isValidCnpj, isValidCpf, onlyDigits } from "./documents";

const emptyToUndef = (v: unknown) => (v === "" || v === null ? undefined : v);

export const zStr = (min = 1, msg = "Campo obrigatório") => z.string().trim().min(min, msg);
export const zOptStr = z.preprocess(emptyToUndef, z.string().trim().optional());
export const zId = z.string().min(1, "Selecione uma opção");
export const zOptId = z.preprocess(emptyToUndef, z.string().optional());
export const zDate = z.string().refine(isCivilDate, "Data inválida");
export const zOptDate = z.preprocess(emptyToUndef, z.string().refine(isCivilDate, "Data inválida").optional());
export const zBool = z.preprocess((v) => v === "on" || v === "true" || v === true || v === "1", z.boolean());
export const zInt = z.coerce.number().int("Número inteiro");
export const zOptInt = z.preprocess(emptyToUndef, z.coerce.number().int().optional());

/** Valor decimal como string normalizada (aceita "1.234,56"). */
export const zDecimal = z.preprocess(
  (v) => {
    if (v === undefined || v === null || v === "") return "0";
    try {
      return parseMoneyInput(String(v)).toString();
    } catch {
      return "invalid";
    }
  },
  z.string().refine((s) => s !== "invalid", "Valor inválido"),
);
export const zPositiveDecimal = zDecimal.refine((s) => Number(s) > 0, "Informe um valor maior que zero");
export const zOptDecimal = z.preprocess(emptyToUndef, zDecimal.optional());

export const zCnpj = z.string().transform(onlyDigits).refine(isValidCnpj, "CNPJ inválido (dígitos verificadores)");
export const zDocument = z.preprocess(
  emptyToUndef,
  z.string().transform(onlyDigits).refine((d) => (d.length === 14 ? isValidCnpj(d) : d.length === 11 ? isValidCpf(d) : false), "CNPJ/CPF inválido").optional(),
);
export const zEmail = z.preprocess(emptyToUndef, z.string().trim().toLowerCase().email("E-mail inválido").optional());
export const zArray = z.preprocess((v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]), z.array(z.string()));
