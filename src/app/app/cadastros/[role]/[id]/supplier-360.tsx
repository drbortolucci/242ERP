import type { Party } from "@prisma/client";
import type { Ctx } from "@/server/context";
import { Card, DefinitionList } from "@/components/ui/page";
import { formatDocument } from "@/lib/documents";

/** Visão 360° do fornecedor — completada na Etapa 4 (Suprimentos). */
export async function Supplier360({ ctx, party }: { ctx: Ctx; party: Party }) {
  void ctx;
  return <Card title="Fornecedor"><DefinitionList items={[{ label: "Documento", value: formatDocument(party.document) }, { label: "E-mail", value: party.email }]} /></Card>;
}
