/**
 * Organização fictícia "Consultoria Demo" (2 empresas jurídicas) + organização isolada "Outra Consultoria".
 * Todos os registros são criados via serviços (regras, validações e auditoria aplicadas).
 */
import { prisma } from "../src/server/db";
import { provisionOrganization } from "../src/modules/saas/provision";
import { buildCtx, type Ctx } from "../src/server/context";
import { hashPassword } from "../src/server/auth/crypto";
import { createCompany, createBankAccount } from "../src/modules/companies/service";
import { saveCompanyStep, saveChecklist } from "../src/modules/companies/onboarding";
import { saveConfig } from "../src/modules/config/service";
import { createPriceTable, addPriceItem, addHoliday } from "../src/modules/config/special";
import { createParty, saveContact } from "../src/modules/parties/service";
import { createProfessional, addCostRate } from "../src/modules/professionals/service";
import { cnpjFromBase } from "../src/lib/documents";
import { addMonths, monthStart, todayIn } from "../src/lib/dates";

export interface DemoContext {
  admin: Ctx;
  orgId: string;
  today: string;
  companies: { main: string; second: string };
  users: Record<string, { userId: string; ctx: Ctx }>;
  parties: Record<string, string>;
  professionals: Record<string, string>;
  refs: Record<string, string>;
}

async function addMember(orgId: string, email: string, name: string, roleKeys: string[], pw: string, extra: { professionalId?: string; companyIds?: string[]; kind?: "INTERNAL" | "CLIENT"; partyId?: string } = {}) {
  const roles = await prisma.role.findMany({ where: { organizationId: orgId, key: { in: roleKeys } } });
  const user = await prisma.user.upsert({ where: { email }, create: { email, name, passwordHash: pw }, update: {} });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: orgId, roleIds: roles.map((r) => r.id), professionalId: extra.professionalId ?? null, allCompanies: !extra.companyIds, companyIds: extra.companyIds ?? [], kind: extra.kind ?? "INTERNAL", partyId: extra.partyId ?? null },
  });
  return { userId: user.id, ctx: await buildCtx(user.id, orgId) };
}

export async function seedFoundation(password: string): Promise<DemoContext> {
  const pw = await hashPassword(password);
  const { org, user } = await provisionOrganization({ orgName: "Consultoria Demo", userName: "Ana Administradora", email: "admin@demo.local", password, planCode: "ENTERPRISE" });
  const admin = await buildCtx(user.id, org.id);
  const today = todayIn(admin.timezone);

  // Empresas jurídicas
  const main = await saveCompanyStep(admin, { kind: "HEADQUARTERS", legalName: "Demo Consultoria em Sistemas Ltda", tradeName: "Demo Consultoria", cnpj: cnpjFromBase("123456780001"), taxRegime: "Lucro Presumido", email: "contato@demo.local", city: "São Paulo", state: "SP", municipalityCode: "3550308", currency: "BRL", timezone: "America/Sao_Paulo", responsibleName: "Ana Administradora", responsibleEmail: "admin@demo.local" });
  const second = await createCompany(admin, { kind: "HEADQUARTERS", legalName: "Demo Treinamentos e AMS Ltda", tradeName: "Demo AMS", cnpj: cnpjFromBase("987654320001"), taxRegime: "Simples Nacional", city: "Campinas", state: "SP", municipalityCode: "3509502", currency: "BRL", timezone: "America/Sao_Paulo" });
  await createCompany(admin, { kind: "BRANCH", parentId: main.id, legalName: "Demo Consultoria em Sistemas Ltda — Filial RJ", tradeName: "Demo RJ", cnpj: cnpjFromBase("123456780002"), city: "Rio de Janeiro", state: "RJ", currency: "BRL", timezone: "America/Sao_Paulo" });

  // Estrutura
  const bu1 = await saveConfig(admin, "unidades", null, { code: "IMPL", name: "Implementação", companyId: main.id });
  const bu2 = await saveConfig(admin, "unidades", null, { code: "AMS", name: "Sustentação AMS", companyId: second.id });
  const ccOp = await saveConfig(admin, "centros-custo", null, { code: "100", name: "Delivery Implementação", companyId: main.id, kind: "OPERATIONAL" });
  const ccAms = await saveConfig(admin, "centros-custo", null, { code: "200", name: "Delivery AMS", companyId: second.id, kind: "OPERATIONAL" });
  const ccAdm = await saveConfig(admin, "centros-custo", null, { code: "900", name: "Administrativo", companyId: main.id, kind: "ADMINISTRATIVE" });
  const ccCom = await saveConfig(admin, "centros-custo", null, { code: "800", name: "Comercial", companyId: main.id, kind: "COMMERCIAL" });
  const openingDate = monthStart(addMonths(today, -6));
  const bank1 = await createBankAccount(admin, { companyId: main.id, name: "Banco Alfa — CC 1001-2", bankCode: "999", agency: "0001", accountNumber: "1001-2", openingBalance: "250000.00", openingDate });
  const bank2 = await createBankAccount(admin, { companyId: main.id, name: "Banco Beta — Aplicação", bankCode: "998", agency: "0002", accountNumber: "5005-0", openingBalance: "100000.00", openingDate });
  const bank3 = await createBankAccount(admin, { companyId: second.id, name: "Banco Alfa — CC 2002-3", bankCode: "999", agency: "0001", accountNumber: "2002-3", openingBalance: "80000.00", openingDate });

  const cal = await prisma.workCalendar.findFirstOrThrow({ where: { organizationId: org.id } });
  const year = today.slice(0, 4);
  for (const [d, n] of [[`${year}-01-01`, "Confraternização Universal"], [`${year}-04-21`, "Tiradentes"], [`${year}-05-01`, "Dia do Trabalho"], [`${year}-09-07`, "Independência"], [`${year}-10-12`, "Nossa Senhora Aparecida"], [`${year}-11-02`, "Finados"], [`${year}-11-15`, "Proclamação da República"], [`${year}-12-25`, "Natal"]]) {
    await addHoliday(admin, { calendarId: cal.id, date: d, name: n });
  }

  // Competências
  const skills: Record<string, string> = {};
  for (const s of ["SAP FI", "SAP SD", "SAP MM", "SAP ABAP", "Oracle NetSuite", "TOTVS Protheus", "Integrações (APIs)", "Gestão de projetos", "Power BI"]) {
    skills[s] = (await saveConfig(admin, "competencias", null, { name: s, category: s.startsWith("SAP") ? "SAP" : "Outras" })).id;
  }
  const roles = Object.fromEntries((await prisma.teamRole.findMany({ where: { organizationId: org.id } })).map((r) => [r.name, r.id]));
  const sens = Object.fromEntries((await prisma.seniorityLevel.findMany({ where: { organizationId: org.id } })).map((r) => [r.name, r.id]));

  // Tabela comercial vigente
  const table = await createPriceTable(admin, { name: `Tabela ${year}`, validFrom: `${year}-01-01` });
  const rates: [string, string, string, string][] = [
    ["Gerente de projeto", "Sênior", "320", "160"], ["Arquiteto de soluções", "Especialista", "380", "190"], ["Consultor funcional", "Sênior", "260", "120"],
    ["Consultor funcional", "Pleno", "200", "90"], ["Consultor técnico", "Pleno", "190", "85"], ["Desenvolvedor", "Pleno", "170", "75"], ["Analista de suporte", "Pleno", "150", "65"], ["Instrutor", "Sênior", "220", "100"],
  ];
  for (const [r, s, rate, cost] of rates) await addPriceItem(admin, { priceTableId: table.id, teamRoleId: roles[r], seniorityId: sens[s], hourlyRate: rate, referenceCost: cost });

  // Profissionais (custos distintos, vínculos distintos)
  const supplierPj = await createParty(admin, { personType: "COMPANY", name: "Carlos Dev Serviços de TI ME", document: cnpjFromBase("555666770001"), isSupplier: true, isCustomer: false, isProspect: false, isPartner: false, email: "carlos@carlosdev.local" });
  const profDefs: [string, string, "CLT" | "PJ" | "PARTNER", string, string, string, string[], string?][] = [
    ["Bruno Gerente", "bruno@demo.local", "CLT", "Gerente de projeto", "Sênior", "150", ["Gestão de projetos"]],
    ["Camila Arquiteta", "camila@demo.local", "CLT", "Arquiteto de soluções", "Especialista", "185", ["SAP FI", "SAP SD", "Integrações (APIs)"]],
    ["Diego Funcional FI", "diego@demo.local", "CLT", "Consultor funcional", "Sênior", "115", ["SAP FI"]],
    ["Elisa Funcional SD", "elisa@demo.local", "CLT", "Consultor funcional", "Pleno", "88", ["SAP SD", "SAP MM"]],
    ["Fábio ABAP", "fabio@demo.local", "CLT", "Desenvolvedor", "Pleno", "72", ["SAP ABAP"]],
    ["Gabriela Suporte", "gabriela@demo.local", "CLT", "Analista de suporte", "Pleno", "60", ["SAP FI", "TOTVS Protheus"]],
    ["Carlos PJ (desenvolvedor)", "carlos@carlosdev.local", "PJ", "Desenvolvedor", "Pleno", "95", ["Integrações (APIs)", "Power BI"], supplierPj.id],
  ];
  const professionals: Record<string, string> = {};
  for (const [name, email, type, role, sen, cost, sk, supplier] of profDefs) {
    const companyId = name.startsWith("Gabriela") ? second.id : main.id;
    const p = await createProfessional(admin, { companyId, name, email, employmentType: type, supplierPartyId: supplier, teamRoleId: roles[role], seniorityId: sens[sen], capacityPct: "100", certifications: sk.filter((x) => x.startsWith("SAP")).map((x) => `${x} Certified`), skillIds: sk.map((x) => skills[x]), calendarId: cal.id, costCenterId: companyId === main.id ? ccOp.id : ccAms.id, businessUnitId: companyId === main.id ? bu1.id : bu2.id, managerId: undefined });
    await addCostRate(admin, { professionalId: p.id, hourlyCost: cost, validFrom: `${year}-01-01` });
    professionals[name.split(" ")[0]] = p.id;
  }
  // Reajuste de custo no meio do ano (preserva custos históricos)
  await addCostRate(admin, { professionalId: professionals["Diego"], hourlyCost: "122", validFrom: monthStart(addMonths(today, -2)) });

  // Usuários por perfil
  const users: DemoContext["users"] = {};
  users.diretor = await addMember(org.id, "diretor@demo.local", "Daniela Diretora", ["director"], pw);
  users.comercial = await addMember(org.id, "comercial@demo.local", "Rafael Comercial", ["sales"], pw);
  users.pmo = await addMember(org.id, "pmo@demo.local", "Bruno Gerente", ["pmo"], pw, { professionalId: professionals["Bruno"] });
  users.ams = await addMember(org.id, "ams@demo.local", "Marina Gestora AMS", ["ams_manager"], pw);
  users.recursos = await addMember(org.id, "recursos@demo.local", "Renato Recursos", ["resource_manager"], pw);
  users.financeiro = await addMember(org.id, "financeiro@demo.local", "Fernanda Financeiro", ["finance"], pw);
  users.controladoria = await addMember(org.id, "controladoria@demo.local", "Cláudio Controller", ["controller"], pw);
  users.compras = await addMember(org.id, "compras@demo.local", "Paula Compras", ["purchasing"], pw);
  users.consultor = await addMember(org.id, "consultor@demo.local", "Diego Funcional FI", ["consultant"], pw, { professionalId: professionals["Diego"] });
  users.consultor2 = await addMember(org.id, "elisa@demo.local", "Elisa Funcional SD", ["consultant"], pw, { professionalId: professionals["Elisa"] });
  users.suporte = await addMember(org.id, "gabriela@demo.local", "Gabriela Suporte", ["consultant"], pw, { professionalId: professionals["Gabriela"], companyIds: [second.id] });
  users.financeiroAms = await addMember(org.id, "financeiro.ams@demo.local", "Otávio Financeiro AMS", ["finance"], pw, { companyIds: [second.id] });

  // Clientes, fornecedores e parceiros
  const parties: Record<string, string> = {};
  const custDefs: [string, string, string, string][] = [
    ["Indústria Alfa S.A.", "Alfa", "111111110001", "Indústria"], ["Varejo Beta Ltda", "Beta", "222222220001", "Varejo"], ["Logística Gama Ltda", "Gama", "333333330001", "Logística"],
    ["Saúde Delta S.A.", "Delta", "444444440001", "Saúde"], ["Energia Épsilon S.A.", "Epsilon", "777777770001", "Energia"],
  ];
  for (const [name, key, base, seg] of custDefs) {
    const p = await createParty(admin, { personType: "COMPANY", name, tradeName: key, document: cnpjFromBase(base), isCustomer: key !== "Epsilon", isProspect: key === "Epsilon", isSupplier: key === "Gama", isPartner: false, segment: seg, email: `contato@${key.toLowerCase()}.local`, city: "São Paulo", state: "SP", ownerUserId: users.comercial.userId });
    parties[key] = p.id;
    await saveContact(admin, null, { partyId: p.id, name: `Sponsor ${key}`, email: `sponsor@${key.toLowerCase()}.local`, roles: ["DECISOR", "SPONSOR"], jobTitle: "Diretor de TI" });
    await saveContact(admin, null, { partyId: p.id, name: `Aprovador ${key}`, email: `aprovador@${key.toLowerCase()}.local`, roles: ["APROVADOR_HORAS"], jobTitle: "Gerente" });
    await saveContact(admin, null, { partyId: p.id, name: `Financeiro ${key}`, email: `financeiro@${key.toLowerCase()}.local`, roles: ["FINANCEIRO"] });
  }
  const supDefs: [string, string, string][] = [["Nuvem Licenças Ltda", "Nuvem", "121212120001"], ["Hotelaria Viagem Ltda", "Viagem", "131313130001"], ["Integra Parceiros de TI Ltda", "Integra", "141414140001"]];
  for (const [name, key, base] of supDefs) parties[key] = (await createParty(admin, { personType: "COMPANY", name, tradeName: key, document: cnpjFromBase(base), isSupplier: true, isCustomer: false, isProspect: false, isPartner: false, email: `comercial@${key.toLowerCase()}.local` })).id;
  parties.CarlosDev = supplierPj.id;
  parties.Canal = (await createParty(admin, { personType: "COMPANY", name: "Canal Revenda Consultores Ltda", tradeName: "Canal", document: cnpjFromBase("151515150001"), isPartner: true, isCustomer: false, isProspect: false, isSupplier: false })).id;

  // Portal do cliente (Alfa)
  users.portalAlfa = await addMember(org.id, "cliente@alfa.local", "Aprovador Alfa", ["client_approver"], pw, { kind: "CLIENT", partyId: parties.Alfa });
  users.portalBeta = await addMember(org.id, "cliente@beta.local", "Usuário Beta", ["client_user"], pw, { kind: "CLIENT", partyId: parties.Beta });

  await saveChecklist(admin, ["cnpj", "municipal", "bank"], true);

  return {
    admin, orgId: org.id, today, companies: { main: main.id, second: second.id }, users, parties, professionals,
    refs: { bank1: bank1.id, bank2: bank2.id, bank3: bank3.id, ccOp: ccOp.id, ccAms: ccAms.id, ccAdm: ccAdm.id, ccCom: ccCom.id, bu1: bu1.id, bu2: bu2.id, calendar: cal.id, priceTable: table.id, ...Object.fromEntries(Object.entries(skills).map(([k, v]) => [`skill:${k}`, v])) },
  };
}

export async function seedSecondOrg(password: string) {
  const { org, user } = await provisionOrganization({ orgName: "Outra Consultoria", userName: "Otto Admin", email: "admin@outra.local", password, planCode: "STARTER" });
  const ctx = await buildCtx(user.id, org.id);
  await saveCompanyStep(ctx, { kind: "HEADQUARTERS", legalName: "Outra Consultoria Ltda", cnpj: cnpjFromBase("246813570001"), currency: "BRL", timezone: "America/Sao_Paulo" });
  await createParty(ctx, { personType: "COMPANY", name: "Cliente Exclusivo da Outra S.A.", document: cnpjFromBase("864213570001"), isCustomer: true, isProspect: false, isSupplier: false, isPartner: false });
  await saveChecklist(ctx, [], true);
}

export async function seedDemo(password: string) {
  const demo = await seedFoundation(password);
  const { seedCommercial } = await import("./seed-commercial");
  const contracts = await seedCommercial(demo);
  Object.assign(demo.refs, contracts);
  const { seedOperations } = await import("./seed-operations");
  const projects = await seedOperations(demo);
  Object.assign(demo.refs, Object.fromEntries(Object.entries(projects).map(([k, v]) => [`project:${k}`, v])));
  const { seedProcurement } = await import("./seed-procurement");
  Object.assign(demo.refs, await seedProcurement(demo));
  const { seedAms } = await import("./seed-ams");
  await seedAms(demo);
  await seedSecondOrg(password);
  return demo;
}
