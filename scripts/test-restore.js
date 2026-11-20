/**
 * Prova que o último backup restaura: abre a cópia, roda integrity_check e confere as tabelas.
 * Uso: npm run restore:test
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { abrirBanco } from "../src/db.js";
import { fazerBackup } from "./backup.js";

export function ultimoBackup(pasta) {
  const arquivos = readdirSync(pasta)
    .filter((arquivo) => arquivo.startsWith("vendas-") && arquivo.endsWith(".db"))
    .map((arquivo) => ({ arquivo, mtime: statSync(join(pasta, arquivo)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  return arquivos.length ? join(pasta, arquivos[0].arquivo) : null;
}

export function testarRestauracao(caminhoBackup) {
  const copia = new DatabaseSync(caminhoBackup, { readOnly: true });
  try {
    const integridade = copia.prepare("PRAGMA integrity_check").get();
    const valor = Object.values(integridade)[0];
    const tabelas = copia
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((linha) => linha.name);
    const contagem = {};
    for (const tabela of tabelas) {
      contagem[tabela] = Number(copia.prepare(`SELECT COUNT(*) AS total FROM ${tabela}`).get().total);
    }
    return { integridade: valor, tabelas, contagem };
  } finally {
    copia.close();
  }
}

const executadoDireto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (executadoDireto) {
  const pasta = resolve(process.env.SALES_BACKUP_DIR || "backups");
  let caminho = ultimoBackup(pasta);
  if (!caminho) {
    const db = abrirBanco();
    caminho = fazerBackup(db, pasta).destino;
    db.close();
    console.log(`Nenhum backup existente; criei um novo em ${caminho}`);
  }
  const resultado = testarRestauracao(caminho);
  if (resultado.integridade !== "ok") {
    console.error(`FALHOU: integrity_check = ${resultado.integridade}`);
    process.exit(1);
  }
  console.log(`Backup OK: ${caminho}`);
  console.log(`Tabelas conferidas: ${resultado.tabelas.length}`);
  console.log(JSON.stringify(resultado.contagem, null, 2));
}
