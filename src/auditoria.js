/** Trilha de auditoria: quem fez o quê, quando. */

export function auditar(db, ator, acao, entidade, entidadeId = null, detalhe = null) {
  db.prepare(
    "INSERT INTO auditoria (ator, acao, entidade, entidade_id, detalhe) VALUES (?, ?, ?, ?, ?)",
  ).run(
    String(ator || "sistema").slice(0, 120),
    String(acao),
    String(entidade),
    entidadeId == null ? null : String(entidadeId),
    detalhe == null ? null : JSON.stringify(detalhe).slice(0, 2000),
  );
}

export function listarAuditoria(db, { limite = 100 } = {}) {
  const max = Math.min(Math.max(Number(limite) || 100, 1), 500);
  return db
    .prepare("SELECT * FROM auditoria ORDER BY id DESC LIMIT ?")
    .all(max)
    .map((linha) => ({
      id: Number(linha.id),
      ator: linha.ator,
      acao: linha.acao,
      entidade: linha.entidade,
      entidade_id: linha.entidade_id,
      detalhe: linha.detalhe ? JSON.parse(linha.detalhe) : null,
      criado_em: linha.criado_em,
    }));
}
