import { describe, expect, it } from "vitest";
import { canOpenRoute, routeRule } from "@/lib/route-access";

const all = ["crm", "projects", "resources", "timesheet", "expenses", "procurement", "ams", "billing", "finance", "controlling", "portal"];

describe("mapa de acesso às rotas", () => {
  it("regra mais específica vence", () => {
    expect(routeRule("/app/horas/aprovacao")?.any).toEqual(["time.approve"]);
    expect(routeRule("/app/horas?projeto=x")?.any).toEqual(["time.write", "time.approve"]);
    expect(routeRule("/app/financeiro/conciliacao")?.any).toEqual(["treasury.manage"]);
    expect(routeRule("/app/despesas/abc")?.any).toContain("finance.read");
    expect(routeRule("/app/despesas")?.any).not.toContain("finance.read");
  });
  it("exige módulo contratado", () => {
    expect(canOpenRoute("/app/controladoria/dre", new Set(["controlling.read"]), ["finance"])).toBe(false);
    expect(canOpenRoute("/app/controladoria/dre", new Set(["controlling.read"]), all)).toBe(true);
  });
  it("exige ao menos uma das permissões", () => {
    expect(canOpenRoute("/app/horas?projeto=1", new Set(["project.read"]), all)).toBe(false);
    expect(canOpenRoute("/app/despesas/1", new Set(["finance.read"]), all)).toBe(true);
    expect(canOpenRoute("/app/despesas", new Set(["finance.read"]), all)).toBe(false);
    expect(canOpenRoute("/app/config/servicos", new Set(["master.read"]), all)).toBe(false);
    expect(canOpenRoute("/app/cadastros/servicos", new Set(["master.read"]), all)).toBe(true);
  });
  it("rotas sem regra e externas ficam liberadas", () => {
    expect(canOpenRoute("/app/notificacoes", new Set(), [])).toBe(true);
    expect(canOpenRoute("/portal", new Set(), [])).toBe(true);
    expect(canOpenRoute("#", new Set(), [])).toBe(true);
  });
  it("prefixo não casa com rota de nome parecido", () => {
    expect(routeRule("/app/projetosx")).toBeUndefined();
  });
});
