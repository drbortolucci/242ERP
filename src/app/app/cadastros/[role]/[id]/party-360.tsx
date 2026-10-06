import type { Party } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { Card, DefinitionList } from "@/components/ui/page";
import { formatDocument } from "@/lib/documents";

/** Visão consolidada. Completada nas etapas Comercial (cliente) e Suprimentos (fornecedor). */
export async function Party360({ ctx, party, role }: { ctx: Ctx; party: Party; role: string }) {
  void ctx; void role;
  const a = party.address as Record<string, string>;
  return (
    <Card title="Resumo">
      <DefinitionList items={[
        { label: "Documento", value: formatDocument(party.document) }, { label: "E-mail", value: party.email }, { label: "Telefone", value: party.phone },
        { label: "Cidade/UF", value: [a.city, a.state].filter(Boolean).join("/") || "—" }, { label: "Segmento", value: party.segment },
      ]} />
    </Card>
  );
}
