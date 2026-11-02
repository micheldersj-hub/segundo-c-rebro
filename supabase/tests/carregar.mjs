// Carrega um módulo .ts das funções no Node (remove os tipos) para testar as regras puras.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'functions');
export async function carregar(rel) {
  const js = stripTypeScriptTypes(readFileSync(join(raiz, rel), 'utf8'));
  const arq = join(mkdtempSync(join(tmpdir(), 'sc-')), rel.replace(/[\/]/g, '_').replace(/\.ts$/, '.mjs'));
  writeFileSync(arq, js);
  return import(pathToFileURL(arq).href);
}
