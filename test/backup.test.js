import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { abrirBanco } from "../src/db.js";
import { criarCliente, criarPedido, criarProduto } from "../src/core.js";
import { fazerBackup } from "../scripts/backup.js";
import { testarRestauracao } from "../scripts/test-restore.js";

test("backup restaura com integridade e os mesmos dados", () => {
  const pasta = mkdtempSync(join(tmpdir(), "vendas-backup-"));
  const db = abrirBanco(join(pasta, "vendas.db"));
  try {
    const produto = criarProduto(db, { nome: "Backup", preco_centavos: 1000, estoque: 5 });
    const cliente = criarCliente(db, { nome: "Cliente Backup" });
    criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] });

    const destino = join(pasta, "backups");
    const { destino: arquivo } = fazerBackup(db, destino, { manter: 3 });
    assert.ok(readdirSync(destino).includes(basename(arquivo)));

    const resultado = testarRestauracao(arquivo);
    assert.equal(resultado.integridade, "ok");
    assert.equal(resultado.contagem.produtos, 1);
    assert.equal(resultado.contagem.pedidos, 1);
    assert.equal(resultado.contagem.clientes, 1);
    assert.equal(resultado.contagem.pagamentos, 0);
  } finally {
    db.close();
    rmSync(pasta, { recursive: true, force: true });
  }
});
