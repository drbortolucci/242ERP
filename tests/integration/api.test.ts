import { describe, expect, it } from "vitest";
import { newOrg, addUser } from "../helpers";
import { createCompany } from "@/modules/companies/service";
import { createParty } from "@/modules/parties/service";
import { createApiKey, revokeApiKey, apiList, apiCreate } from "@/modules/api/service";
import { prisma } from "@/server/db";
import { checkConfig } from "@/server/config-check";

const company = { kind: "HEADQUARTERS" as const, legalName: "Consultoria API Ltda", cnpj: "11222333000181", currency: "BRL", timezone: "America/Sao_Paulo" };
const URL_ = (r: string, q = "") => `http://localhost/api/v1/${r}${q}`;

describe("API pública por chave", () => {
  it("autentica por hash, respeita escopos, isola organizações, cria chamado e revoga", async () => {
    const a = await newOrg();
    const b = await newOrg();
    const c = await createCompany(a.ctx, company);
    await createParty(a.ctx, { personType: "COMPANY", name: "Cliente da A", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    await createParty(b.ctx, { personType: "COMPANY", name: "Cliente da B", isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
    const consultant = await addUser(a.org.id, ["consultant"]);
    await expect(createApiKey(consultant, { name: "x", scopes: ["read:parties"] })).rejects.toThrow();
    const { secret, key } = await createApiKey(a.ctx, { name: "Integração ITSM", scopes: ["read:parties", "write:tickets", "read:tickets"] });
    expect(key.keyHash).not.toContain(secret.slice(14)); // só o hash é guardado
    expect((await prisma.apiKey.findUniqueOrThrow({ where: { id: key.id } })).keyHash).toHaveLength(64);
    const auth = `Bearer ${secret}`;
    const list = await apiList("clientes", auth, URL_("clientes", "?limit=10"));
    expect((list.data as { name: string }[]).map((p) => p.name)).toEqual(["Cliente da A"]); // não enxerga a organização B
    await expect(apiList("contratos", auth, URL_("contratos"))).rejects.toThrow(/Escopo necessário/);
    await expect(apiList("clientes", "Bearer erp_00000000_invalida", URL_("clientes"))).rejects.toThrow(/inválida/);
    await expect(apiList("clientes", null, URL_("clientes"))).rejects.toThrow(/inválida/);
    const party = await prisma.party.findFirstOrThrow({ where: { organizationId: a.org.id } });
    const t = await apiCreate("chamados", auth, { partyId: party.id, companyId: c.id, title: "Integração caiu", description: "Fila de mensagens parada", impact: 1, urgency: 1, type: "INCIDENT" });
    expect(t.priority).toBe("P1");
    await expect(apiCreate("chamados", auth, { title: "x" })).rejects.toThrow(/Dados inválidos/);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { organizationId: a.org.id, action: "ticket.open" } });
    expect(log.userId).toBe(`api:${key.id}`);
    await revokeApiKey(a.ctx, key.id);
    await expect(apiList("clientes", auth, URL_("clientes"))).rejects.toThrow(/inválida/);
  });

  it("limita a taxa por chave", async () => {
    const a = await newOrg();
    const { secret } = await createApiKey(a.ctx, { name: "Limite", scopes: ["read:parties"] });
    process.env.API_RATE_LIMIT_PER_MIN = "2";
    try {
      await apiList("clientes", `Bearer ${secret}`, URL_("clientes"));
      await apiList("clientes", `Bearer ${secret}`, URL_("clientes"));
      await expect(apiList("clientes", `Bearer ${secret}`, URL_("clientes"))).rejects.toThrow(/Muitas tentativas/);
    } finally {
      delete process.env.API_RATE_LIMIT_PER_MIN;
    }
  });
});

describe("verificação de configuração", () => {
  it("bloqueia produção com segredo de exemplo e sem HTTPS; avisa provedores simulados", () => {
    const issues = checkConfig({ APP_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "troque-este-valor-em-cada-ambiente", APP_URL: "http://erp.exemplo" } as unknown as NodeJS.ProcessEnv);
    expect(issues.filter((i) => i.level === "error").map((i) => i.message)).toEqual([expect.stringMatching(/SESSION_SECRET/), expect.stringMatching(/HTTPS/)]);
    expect(issues.some((i) => /FISCAL_PROVIDER=simulated/.test(i.message))).toBe(true);
    expect(checkConfig({ APP_ENV: "production", DATABASE_URL: "postgres://x", SESSION_SECRET: "a".repeat(64), APP_URL: "https://erp.exemplo", STORAGE_DIR: "/data", PAYMENT_WEBHOOK_SECRET: "s1", FISCAL_WEBHOOK_SECRET: "s2", EMAIL_PROVIDER: "smtp", PAYMENT_PROVIDER: "x", FISCAL_PROVIDER: "y" } as unknown as NodeJS.ProcessEnv)).toEqual([]);
  });
});
