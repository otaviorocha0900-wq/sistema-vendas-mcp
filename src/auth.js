import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { auditar } from "./auditoria.js";
import { ErroNegocio } from "./core.js";

export const PAPEIS = ["leitor", "vendedor", "admin"];
export const NIVEL_PAPEL = { leitor: 1, vendedor: 2, admin: 3 };

export function hashToken(token) {
  return createHash("sha256").update(String(token)).digest("hex");
}

export function gerarToken() {
  return `sk_${randomBytes(24).toString("base64url")}`;
}

export function criarChave(db, { nome, papel = "vendedor" }, ctx = {}) {
  const nomeLimpo = String(nome ?? "").trim();
  if (!nomeLimpo) throw new ErroNegocio("CAMPO_OBRIGATORIO", 'Informe o campo "nome".');
  if (!PAPEIS.includes(papel)) {
    throw new ErroNegocio("PAPEL_INVALIDO", `Papel deve ser um de: ${PAPEIS.join(", ")}.`);
  }
  const token = gerarToken();
  const info = db
    .prepare("INSERT INTO chaves_api (nome, prefixo, hash, papel) VALUES (?, ?, ?, ?)")
    .run(nomeLimpo.slice(0, 120), token.slice(0, 10), hashToken(token), papel);
  const id = Number(info.lastInsertRowid);
  auditar(db, ctx.ator ?? "sistema", "chave.criada", "chave", id, { nome: nomeLimpo, papel });
  return {
    id,
    nome: nomeLimpo,
    papel,
    prefixo: token.slice(0, 10),
    token,
    aviso: "Guarde o token agora: ele não é exibido de novo.",
  };
}

export function listarChaves(db) {
  return db
    .prepare("SELECT id, nome, prefixo, papel, ativo, criado_em, revogado_em FROM chaves_api ORDER BY id")
    .all()
    .map((linha) => ({
      id: Number(linha.id),
      nome: linha.nome,
      prefixo: linha.prefixo,
      papel: linha.papel,
      ativo: Boolean(linha.ativo),
      criado_em: linha.criado_em,
      revogado_em: linha.revogado_em,
    }));
}

export function revogarChave(db, id, ctx = {}) {
  const chave = db.prepare("SELECT * FROM chaves_api WHERE id = ?").get(Number(id));
  if (!chave) throw new ErroNegocio("CHAVE_NAO_ENCONTRADA", `Chave ${id} não encontrada.`, 404);
  if (!chave.ativo) throw new ErroNegocio("CHAVE_JA_REVOGADA", "Essa chave já foi revogada.", 409);
  if (chave.papel === "admin") {
    const ativos = db
      .prepare("SELECT COUNT(*) AS total FROM chaves_api WHERE ativo = 1 AND papel = 'admin'")
      .get();
    if (Number(ativos.total) <= 1) {
      throw new ErroNegocio("ULTIMO_ADMIN", "Não dá para revogar a única chave de administrador ativa.", 409);
    }
  }
  db.prepare("UPDATE chaves_api SET ativo = 0, revogado_em = ? WHERE id = ?").run(new Date().toISOString(), chave.id);
  auditar(db, ctx.ator ?? "sistema", "chave.revogada", "chave", chave.id, { nome: chave.nome });
  return { id: Number(chave.id), nome: chave.nome, ativo: false };
}

/** Devolve o principal autenticado ou null. */
export function autenticar(db, token) {
  if (!token) return null;
  const alvo = hashToken(token);
  const linhas = db.prepare("SELECT * FROM chaves_api WHERE ativo = 1").all();
  for (const linha of linhas) {
    const guardado = Buffer.from(linha.hash, "hex");
    const calculado = Buffer.from(alvo, "hex");
    if (guardado.length === calculado.length && timingSafeEqual(guardado, calculado)) {
      return { id: Number(linha.id), nome: linha.nome, papel: linha.papel };
    }
  }
  return null;
}

/** Cria (ou promove) a chave de bootstrap vinda do ambiente. */
export function garantirChaveBootstrap(db, token, { nome = "bootstrap", papel = "admin" } = {}) {
  if (!token) return null;
  const hash = hashToken(token);
  const existente = db.prepare("SELECT * FROM chaves_api WHERE hash = ?").get(hash);
  if (existente) {
    db.prepare("UPDATE chaves_api SET ativo = 1, papel = ? WHERE id = ?").run(papel, existente.id);
    return { id: Number(existente.id), nome: existente.nome, papel };
  }
  const info = db
    .prepare("INSERT INTO chaves_api (nome, prefixo, hash, papel) VALUES (?, ?, ?, ?)")
    .run(nome, token.slice(0, 10), hash, papel);
  return { id: Number(info.lastInsertRowid), nome, papel };
}
