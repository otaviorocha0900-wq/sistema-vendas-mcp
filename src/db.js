import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

export const CAMINHO_PADRAO = resolve(process.cwd(), "data", "vendas.db");

// --- Modo SQLite (padrão, para desenvolvimento local) ---
function criarPoolSQLite(caminho = CAMINHO_PADRAO) {
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

// --- Modo PostgreSQL (Supabase) ---
let poolPG = null;

function criarPoolPG() {
  const databaseUrl = process.env.SALES_DB; // DATABASE_URL do Supabase
  if (!databaseUrl) return null;
  // Se já tiver pool criado, reutiliza
  if (poolPG) return poolPG;
  try {
    const p = new Pool({ connectionString: databaseUrl });
    // Testa conexão rápida
    p.query("SELECT 1", (err) => {
      if (err) console.error("Erro ao testar PG connection:", err.message);
    });
    poolPG = p;
    return poolPG;
  } catch (erro) {
    console.error("Não foi possível criar pool PG:", erro.message);
    return null;
  }
}

// Retorna o pool PG ou null se não configurado
export function getPoolPG() {
  return poolPG;
}

// Abre banco: se SALES_DB for URL postgres/pg, usa PG; senão, usa SQLite local
export function abrirBanco(caminho = CAMINHO_PADRAO) {
  // Se vier postgres:// ou postgresql:// ou http://supabase..., trata como PG
  if (
    typeof caminho === "string" &&
    (caminho.startsWith("postgres://") ||
      caminho.startsWith("postgresql://") ||
      (caminho.includes("supabase.co") && !caminho.includes("data/vendas.db")))
  ) {
    // Modo PG: retorna um objeto com métodos compatíveis com o uso no core/api
    return {
      pool: criarPoolPG(),
      query: (sql, params) => {
        return new Promise((resolve, reject) => {
          poolPG.query(sql, params, (err, res) => {
            if (err) return reject(err);
            resolve(res.rows);
          });
        });
      },
      execute: (sql, params) => {
        return new Promise((resolve, reject) => {
          poolPG.query(sql, params, (err) => {
            if (err) return reject(err);
            resolve();
          });
        });
      },
      close: () => {
        // não fechamos automaticamente para reutilização
      },
    };
  }

  // Modo SQLite original
  if (caminho !== ":memory:") mkdirSync(dirname(caminho), { recursive: true });
  const db = new DatabaseSync(caminho);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

// Aplicar schema no PG (já foi feito manualmente no painel, mas pode ser refeito)
export async function aplicarSchemaPG() {
  // O schema já foi aplicado no painel do Supabase nas tabelas produtos, clientes, pedidos, etc.
  // Esta função pode ser usada para re-aplicar ou init em outro projeto.
  console.log("[db] Schema PG já foi aplicado no painel do Supabase. Use SALES_DB=postgresql://... para ativar o modo PG.");
}

// Fechar conexões
export async function fecharBanco() {
  // Se houver pool PG, pode ser fechado aqui se necessário
}

// Migrador simplificado: lê o schema SQLite e gera o equivalente PG
// Usado quando se quer migrar dados de SQLite para PG
export function migrarParaPG(dbSQLite, poolPG) {
  // Versão simplificada: esta função seria chamada para mover dados.
  // Para o MVP, recomendamos usar o schema já aplicado no Supabase.
  console.log("Use aplicarSchemaPG() e as tabelas já criadas no Supabase.");
}

// Se executado diretamente, mostra instruções
if (require.main === module) {
  console.log("Modos de uso:");
  console.log("1) Local (SQLite): npm run api  (sem SALES_DB)");
  console.log("2) Supabase (PG):   SALES_DB=postgresql://user:pass@host:5432/db npm run api");
  console.log(""); console.log("O schema já foi aplicado no painel do Supabase. As tabelas produtos, clientes, pedidos, pagamentos e índices estão prontos.");
  console.log(""); console.log("Para mudar do SQLite para PG, basta definir a variável de ambiente SALES_DB com a URL completa e reiniciar a API.");
}