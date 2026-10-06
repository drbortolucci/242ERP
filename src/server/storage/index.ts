import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

/** Adaptador de armazenamento de arquivos. Implementação local; substituível por S3/compatível. */
export interface StorageAdapter {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

function root() {
  return path.resolve(process.env.STORAGE_DIR ?? "./storage");
}

function safePath(key: string) {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Chave de armazenamento inválida");
  return path.join(root(), key);
}

export const localStorage: StorageAdapter = {
  async put(key, data) {
    const p = safePath(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  },
  async get(key) {
    return readFile(safePath(key));
  },
  async remove(key) {
    await unlink(safePath(key)).catch(() => undefined);
  },
};

export const storage: StorageAdapter = localStorage;
