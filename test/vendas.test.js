import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { abrirBanco } from "../src/db.js";
import {
  ErroNegocio,
  atualizarEstoque,
  buscarClientes,
  cancelarPedido,
  consultarPedido,
  criarCliente,
  criarPedido,
  criarProduto,
  estornarPagamento,
  listarPedidos,
  marcarComoEnviado,
  registrarPagamento,
  relatorioVendas,
} from "../src/core.js";

function bancoTemporario() {
  const pasta = mkdtempSync(join(tmpdir(), "vendas-teste-"));
  const db = abrirBanco(join(pasta, "vendas.db"));
  return {
    db,
    fechar() {
      db.close();
      rmSync(pasta, { recursive: true, force: true });
    },
  };
}

function cenario(db) {
  const produto = criarProduto(db, { nome: "Camiseta", preco_centavos: 5000, estoque: 10, sku: "CAM-1" });
  const cliente = criarCliente(db, { nome: "Ana Souza", email: "ana@exemplo.com", telefone: "11999990000" });
  return { produto, cliente };
}

test("fluxo completo: pedido, pagamento, envio e relatório", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    const pedido = criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] });

    assert.equal(pedido.status, "aguardando_pagamento");
    assert.equal(pedido.total_centavos, 10000);
    assert.equal(pedido.numero, "PED-0001");
    assert.equal(pedido.itens.length, 1);
    assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = ?").get(produto.id).estoque, 8);

    const pago = registrarPagamento(db, { pedido_id: pedido.id, metodo: "pix" });
    assert.equal(pago.status, "pago");
    assert.equal(pago.pagamentos.length, 1);
    assert.equal(pago.pagamentos[0].valor_centavos, 10000);

    const enviado = marcarComoEnviado(db, { pedido_id: pedido.numero, rastreio: "BR123" });
    assert.equal(enviado.status, "enviado");
    assert.equal(enviado.rastreio, "BR123");

    const relatorio = relatorioVendas(db, {});
    assert.equal(relatorio.pedidos_pagos, 1);
    assert.equal(relatorio.total_centavos, 10000);
    assert.equal(relatorio.ticket_medio_centavos, 10000);
    assert.equal(relatorio.por_metodo[0].metodo, "pix");
    assert.equal(relatorio.top_produtos[0].produto, "Camiseta");
    assert.equal(relatorio.top_produtos[0].quantidade, 2);
  } finally {
    fechar();
  }
});

test("itens repetidos são somados e pedido vazio é recusado", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    const pedido = criarPedido(db, {
      cliente_id: cliente.id,
      itens: [
        { produto_id: produto.id, quantidade: 1 },
        { produto_id: produto.id, quantidade: 2 },
      ],
    });
    assert.equal(pedido.itens.length, 1);
    assert.equal(pedido.itens[0].quantidade, 3);
    assert.equal(pedido.total_centavos, 15000);

    assert.throws(
      () => criarPedido(db, { cliente_id: cliente.id, itens: [] }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "PEDIDO_SEM_ITENS",
    );
  } finally {
    fechar();
  }
});

test("estoque insuficiente não cria pedido", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    assert.throws(
      () => criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 11 }] }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "ESTOQUE_INSUFICIENTE",
    );
    assert.equal(listarPedidos(db).length, 0);
    assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = ?").get(produto.id).estoque, 10);
  } finally {
    fechar();
  }
});

test("pagamento parcial acumula e quita só no fim; excesso é recusado", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    const pedido = criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 1 }] });

    const parcial = registrarPagamento(db, { pedido_id: pedido.id, metodo: "pix", valor_centavos: 2000 });
    assert.equal(parcial.status, "aguardando_pagamento");
    assert.equal(parcial.valor_pago_centavos, 2000);
    assert.equal(parcial.saldo_centavos, 3000);

    assert.throws(
      () => registrarPagamento(db, { pedido_id: pedido.id, metodo: "pix", valor_centavos: 4000 }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "VALOR_EXCEDENTE",
    );

    assert.throws(
      () => registrarPagamento(db, { pedido_id: pedido.id, metodo: "cheque" }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "METODO_INVALIDO",
    );

    const quitado = registrarPagamento(db, { pedido_id: pedido.id, metodo: "dinheiro" });
    assert.equal(quitado.status, "pago");
    assert.equal(quitado.valor_pago_centavos, 5000);
    assert.equal(quitado.saldo_centavos, 0);
    assert.equal(quitado.pagamentos.length, 2);

    const relatorio = relatorioVendas(db);
    assert.equal(relatorio.total_centavos, 5000);
    assert.equal(relatorio.pedidos_pagos, 1);
  } finally {
    fechar();
  }
});

test("pedido com pagamento parcial só cancela por estorno", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    const pedido = criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] });
    registrarPagamento(db, { pedido_id: pedido.id, metodo: "pix", valor_centavos: 3000 });

    assert.throws(
      () => cancelarPedido(db, { pedido_id: pedido.id }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "PEDIDO_PAGO",
    );

    const estornado = estornarPagamento(db, { pedido_id: pedido.id, motivo: "desistiu" });
    assert.equal(estornado.status, "cancelado");
    assert.equal(estornado.valor_pago_centavos, 0);
    assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = ?").get(produto.id).estoque, 10);
    assert.equal(relatorioVendas(db).total_centavos, 0);
  } finally {
    fechar();
  }
});

test("cancelamento devolve estoque; pedido pago exige estorno", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto, cliente } = cenario(db);
    const pedido = criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 4 }] });
    const cancelado = cancelarPedido(db, { pedido_id: pedido.id, motivo: "cliente desistiu" });
    assert.equal(cancelado.status, "cancelado");
    assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = ?").get(produto.id).estoque, 10);

    const pago = criarPedido(db, { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] });
    registrarPagamento(db, { pedido_id: pago.id, metodo: "cartao" });
    assert.throws(
      () => cancelarPedido(db, { pedido_id: pago.id }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "PEDIDO_PAGO",
    );

    const estornado = estornarPagamento(db, { pedido_id: pago.id, motivo: "devolução" });
    assert.equal(estornado.status, "cancelado");
    assert.equal(estornado.pagamentos[0].status, "estornado");
    assert.equal(db.prepare("SELECT estoque FROM produtos WHERE id = ?").get(produto.id).estoque, 10);
    assert.equal(relatorioVendas(db).total_centavos, 0);
  } finally {
    fechar();
  }
});

test("estoque não pode ficar negativo e e-mail de cliente é único", () => {
  const { db, fechar } = bancoTemporario();
  try {
    const { produto } = cenario(db);
    assert.throws(
      () => atualizarEstoque(db, { produto_id: produto.id, quantidade: -50 }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "ESTOQUE_INSUFICIENTE",
    );
    assert.equal(atualizarEstoque(db, { produto_id: produto.id, quantidade: 5 }).estoque, 15);

    assert.throws(
      () => criarCliente(db, { nome: "Outra", email: "ANA@exemplo.com" }),
      (erro) => erro instanceof ErroNegocio && erro.codigo === "EMAIL_DUPLICADO",
    );
    assert.equal(buscarClientes(db, { termo: "ana" }).length, 1);
    assert.equal(buscarClientes(db, { termo: "119999" }).length, 1);
  } finally {
    fechar();
  }
});
