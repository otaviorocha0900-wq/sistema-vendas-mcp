/**
 * Backup online do SQLite com rotação.
 * Uso: npm run backup   (SALES_DB e SALES_BACKUP_DIR opcionais)
 */
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { abrirBanco } from "../src/db.js";

export function fazerBackup(db, pasta, { manter = 7 } = {}) {
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = join(pasta, `vendas-${carimbo}.db`);
  db.prepare("VACUUM INTO ?").run(destino);

  const backups = readdirSync(pasta)
    .filter((arquivo) => arquivo.startsWith("vendas-") && arquivo.endsWith(".db"))
    .map((arquivo) => ({ arquivo, mtime: statSync(join(pasta, arquivo)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const antigo of backups.slice(Math.max(manter, 1))) {
    unlinkSync(join(pasta, antigo.arquivo));
  }
  return { destino, tamanho_bytes: statSync(destino).size, mantidos: Math.min(backups.length, manter) };
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDireto) {
  const db = abrirBanco();
  const pasta = resolve(process.env.SALES_BACKUP_DIR || "backups");
  const resultado = fazerBackup(db, pasta, { manter: Number(process.env.SALES_BACKUP_KEEP || 7) });
  db.close();
  console.log(`Backup criado: ${resultado.destino} (${resultado.tamanho_bytes} bytes)`);
}
