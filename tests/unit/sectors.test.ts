import { describe, expect, it } from "vitest";
import { DEFAULT_SECTOR, DEFAULT_TERMS, SECTOR_PROFILES, SERVICE_CATEGORIES, resolveTerms, sectorProfile } from "@/domain/sectors";
import { WBS_TEMPLATES, parseWbsText, wbsShareTotal, wbsToText } from "@/domain/wbs-templates";

const MODELS = ["FIXED_PRICE", "TIME_MATERIAL", "MONTHLY_ALLOCATION", "HOUR_PACKAGE", "AMS_RECURRING", "ADVISORY", "TRAINING", "HYBRID"];

describe("catálogo de setores", () => {
  it("todo modelo de WBS soma 100% e tem itens", () => {
    for (const [key, t] of Object.entries(WBS_TEMPLATES)) {
      expect(t.phases.length, key).toBeGreaterThan(0);
      expect(Math.abs(wbsShareTotal(t.phases) - 100), key).toBeLessThan(1e-9);
    }
  });

  it("perfis referenciam modelos, categorias e modelos comerciais existentes, sem duplicidades", () => {
    const cats = new Set<string>(SERVICE_CATEGORIES.map((c) => c.value));
    expect(Object.keys(SECTOR_PROFILES).length).toBeGreaterThanOrEqual(8);
    for (const p of Object.values(SECTOR_PROFILES)) {
      for (const t of p.projectTypes) expect(WBS_TEMPLATES[t.templateKey], `${p.key}:${t.templateKey}`).toBeDefined();
      for (const s of p.services) {
        expect(cats.has(s.category), `${p.key}:${s.code}`).toBe(true);
        expect(MODELS).toContain(s.defaultModel);
      }
      for (const list of [p.projectTypes.map((t) => t.name), p.teamRoles, p.services.map((s) => s.code), p.expenseCategories.map((c) => c.name), p.skills]) {
        expect(new Set(list.map((x) => x.toLowerCase())).size).toBe(list.length);
      }
      expect(p.projectTypes.length).toBeGreaterThan(0);
      expect(p.services.length).toBeGreaterThan(0);
    }
  });

  it("setor padrão é consultoria e TI e setor desconhecido cai no padrão", () => {
    expect(DEFAULT_SECTOR).toBe("CONSULTING_IT");
    expect(sectorProfile("NAO_EXISTE").key).toBe(DEFAULT_SECTOR);
  });

  it("terminologia: padrão ← setor ← personalização (vazio ignorado, limite de tamanho)", () => {
    expect(resolveTerms("GENERAL_SERVICES", null).project).toBe(DEFAULT_TERMS.project);
    expect(resolveTerms("AGENCY", null).projects).toBe("Jobs");
    expect(resolveTerms("FIELD_SERVICES", null).tickets).toBe("Ordens de serviço");
    const t = resolveTerms("AGENCY", { projects: "  Campanhas ", ticket: "", professional: "x".repeat(60) });
    expect(t.projects).toBe("Campanhas");
    expect(t.ticket).toBe("Solicitação");
    expect(t.professional).toHaveLength(40);
  });
});

describe("modelo de WBS em texto", () => {
  it("lê, valida a soma e volta ao texto", () => {
    const { template, errors } = parseWbsText("Briefing | Briefing aprovado | entregável | 10 | sim\n# comentário\nExecução | Produção | tarefa | 80\nExecução | Entrega | marco | 10");
    expect(errors).toEqual([]);
    expect(template).toHaveLength(2);
    expect(template[0].items[0]).toEqual({ name: "Briefing aprovado", kind: "DELIVERABLE", share: 10, acceptance: true });
    expect(template[1].items.map((i) => i.kind)).toEqual(["TASK", "MILESTONE"]);
    expect(parseWbsText(wbsToText(template)).template).toEqual(template);
  });

  it("recusa soma diferente de 100, tipo inválido e linhas incompletas", () => {
    expect(parseWbsText("A | B | tarefa | 90").errors.join()).toMatch(/soma/);
    expect(parseWbsText("A | B | outra | 100").errors.join()).toMatch(/tipo/);
    expect(parseWbsText("A |  | tarefa | 100").errors.join()).toMatch(/fase e item/);
    expect(parseWbsText("A | B | tarefa | abc").errors.join()).toMatch(/percentual/);
    expect(parseWbsText("   ").errors.join()).toMatch(/ao menos um item/);
  });
});
