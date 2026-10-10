import { ActionForm, Checkbox, FormGrid, Input, SubmitButton, Textarea } from "@/components/ui/form";
import { saveArticleAction } from "../actions";

export function ArticleForm({ a, systemLabel = "Sistema" }: { systemLabel?: string; a?: { id: string; title: string; body: string; tags: string[]; system: string | null; clientVisible: boolean; published: boolean } }) {
  return (
    <ActionForm action={saveArticleAction}>
      {a && <input type="hidden" name="id" value={a.id} />}
      <Input name="title" label="Título" defaultValue={a?.title} required />
      <FormGrid cols={2}><Input name="system" label={systemLabel} defaultValue={a?.system ?? ""} /><Input name="tags" label="Etiquetas (separadas por vírgula)" defaultValue={a?.tags.join(", ")} /></FormGrid>
      <Textarea name="body" label="Conteúdo" defaultValue={a?.body} rows={10} required />
      <div className="flex gap-6"><Checkbox name="published" label="Publicado" defaultChecked={a?.published ?? true} /><Checkbox name="clientVisible" label="Visível ao cliente no portal" defaultChecked={a?.clientVisible ?? false} /></div>
      <SubmitButton>{a ? "Salvar" : "Publicar artigo"}</SubmitButton>
    </ActionForm>
  );
}
