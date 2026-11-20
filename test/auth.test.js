import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db.js";
import { autenticar, criarChave, garantirChaveBootstrap, listarChaves, revogarChave } from "../src/auth.js";
import { listarAuditoria } from "../src/auditoria.js";

test("chave criada autentica com papel e some ao revogar", () => {
  const db = abrirBanco(":memory:");
  try {
    garantirChaveBootstrap(db, "chave-admin-raiz");
    const vendedor = criarChave(db, { nome: "vendedor-1", papel: "vendedor" }, { ator: "bootstrap" });

    assert.equal(autenticar(db, vendedor.token).papel, "vendedor");
    assert.equal(autenticar(db, vendedor.token).nome, "vendedor-1");
    assert.equal(autenticar(db, "token-errado"), null);
    assert.equal(autenticar(db, ""), null);

    const lista = listarChaves(db);
    assert.equal(lista.length, 2);
    assert.ok(lista.every((chave) => !("hash" in chave) && !("token" in chave)));

    revogarChave(db, vendedor.id, { ator: "bootstrap" });
    assert.equal(autenticar(db, vendedor.token), null);
    assert.equal(listarChaves(db).find((c) => c.id === vendedor.id).ativo, false);

    const auditoria = listarAuditoria(db);
    assert.deepEqual(
      auditoria.map((linha) => linha.acao),
      ["chave.revogada", "chave.criada"],
    );
  } finally {
    db.close();
  }
});

test("papel inválido é recusado e o último admin não pode ser revogado", () => {
  const db = abrirBanco(":memory:");
  try {
    const raiz = garantirChaveBootstrap(db, "chave-admin-raiz");
    assert.throws(
      () => criarChave(db, { nome: "x", papel: "gerente" }),
      (erro) => erro.codigo === "PAPEL_INVALIDO",
    );

    const segundo = criarChave(db, { nome: "admin-2", papel: "admin" });
    revogarChave(db, raiz.id);
    assert.throws(
      () => revogarChave(db, segundo.id),
      (erro) => erro.codigo === "ULTIMO_ADMIN",
    );
    assert.ok(autenticar(db, segundo.token));
  } finally {
    db.close();
  }
});
