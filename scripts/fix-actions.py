"""Converte `export const X = makeAction(...)` em funções async exportadas (exigência dos arquivos 'use server')."""
import re, sys, pathlib
for path in sys.argv[1:]:
    p = pathlib.Path(path)
    s = p.read_text()
    if '"use server"' not in s.split("\n")[0]:
        continue
    names = re.findall(r"^export const (\w+) = makeAction\(", s, flags=re.M)
    if not names:
        continue
    s = re.sub(r"^export const (\w+) = makeAction\(", r"const \1Impl = makeAction(", s, flags=re.M)
    if "type ActionState" not in s and "ActionState }" not in s and ", type ActionState" not in s:
        s = s.replace('"use server";\n', '"use server";\nimport type { ActionState } from "@/server/action";\n', 1)
    s = s.rstrip() + "\n\n" + "\n".join(f"export async function {n}(prev: ActionState | undefined, fd: FormData) {{\n  return {n}Impl(prev, fd);\n}}" for n in names) + "\n"
    p.write_text(s)
    print("fixed", path, len(names))
