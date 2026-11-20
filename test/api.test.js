import { test } from "node:test";
import assert from "node:assert/strict";
import { abrirBanco } from "../src/db.js";
import { criarServidor } from "../src/api.js";

const CHAVE = "chave-de-teste";

async function comServidor(fn, opcoes = {}) {
  const db = abrirBanco(":memory:");
  const servidor = criarServidor(db, { chave: CHAVE, ...opcoes });
  await new Promise((resolve) => servidor.listen(0, "127.0.0.1", resolve));
  const { port } = servidor.address();
  const base = `http://127.0.0.1:${port}`;
  const pedir = async (caminho, { metodo = "GET", corpo, chave = CHAVE } = {}) => {
    const resposta = await fetch(base + caminho, {
      method: metodo,
      headers: {
        ...(corpo ? { "content-type": "application/json" } : {}),
        ...(chave ? { authorization: `Bearer ${chave}` } : {}),
      },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { status: resposta.status, corpo: await resposta.json() };
  };
  try {
    await fn(pedir);
  } finally {
    await new Promise((resolve) => servidor.close(resolve));
    db.close();
  }
}

test("API exige chave e mantém o campo status do pedido na resposta", async () => {
  await comServidor(async (pedir) => {
    assert.equal((await pedir("/produtos", { chave: null })).status, 401);
    assert.equal((await pedir("/health", { chave: null })).status, 200);

    const produto = await pedir("/produtos", {
      metodo: "POST",
      corpo: { nome: "Caneca", preco_centavos: 3000, estoque: 5 },
    });
    assert.equal(produto.status, 201);
    assert.equal(produto.corpo.preco_centavos, 3000);
    assert.match(produto.corpo.preco, /R\$\s?30,00/);

    const cliente = await pedir("/clientes", {
      metodo: "POST",
      corpo: { nome: "Bruno Lima", email: "bruno@exemplo.com" },
    });
    assert.equal(cliente.status, 201);

    const pedido = await pedir("/pedidos", {
      metodo: "POST",
      corpo: { cliente_id: cliente.corpo.id, itens: [{ produto_id: produto.corpo.id, quantidade: 2 }] },
    });
    assert.equal(pedido.status, 201);
    assert.equal(pedido.corpo.status, "aguardando_pagamento");
    assert.equal(pedido.corpo.total_centavos, 6000);

    const pago = await pedir(`/pedidos/${pedido.corpo.numero}/pagamento`, {
      metodo: "POST",
      corpo: { metodo: "pix" },
    });
    assert.equal(pago.status, 200);
    assert.equal(pago.corpo.status, "pago");

    const relatorio = await pedir("/relatorio");
    assert.equal(relatorio.status, 200);
    assert.equal(relatorio.corpo.total_centavos, 6000);
    assert.equal(relatorio.corpo.pedidos_pagos, 1);

    const semEstoque = await pedir("/pedidos", {
      metodo: "POST",
      corpo: { cliente_id: cliente.corpo.id, itens: [{ produto_id: produto.corpo.id, quantidade: 99 }] },
    });
    assert.equal(semEstoque.status, 409);
    assert.equal(semEstoque.corpo.erro.codigo, "ESTOQUE_INSUFICIENTE");

    const inexistente = await pedir("/pedidos/PED-9999");
    assert.equal(inexistente.status, 404);
    assert.equal(inexistente.corpo.erro.codigo, "PEDIDO_NAO_ENCONTRADO");
  });
});

test("papéis: leitor só lê, admin cria chave e auditoria guarda o autor", async () => {
  await comServidor(async (pedir) => {
    const chaveLeitor = await pedir("/chaves", {
      metodo: "POST",
      corpo: { nome: "leitor-1", papel: "leitor" },
    });
    assert.equal(chaveLeitor.status, 201);
    const token = chaveLeitor.corpo.token;
    assert.match(token, /^sk_/);
    assert.equal(chaveLeitor.corpo.prefixo, token.slice(0, 10));

    assert.equal((await pedir("/produtos", { chave: token })).status, 200);
    const escrita = await pedir("/produtos", {
      metodo: "POST",
      chave: token,
      corpo: { nome: "Sem permissão", preco_centavos: 100 },
    });
    assert.equal(escrita.status, 403);
    assert.equal(escrita.corpo.erro.codigo, "SEM_PERMISSAO");

    const produto = await pedir("/produtos", {
      metodo: "POST",
      corpo: { nome: "Permitido", preco_centavos: 100, estoque: 1 },
    });
    assert.equal(produto.status, 201);

    const auditoria = await pedir("/auditoria");
    assert.equal(auditoria.status, 200);
    assert.ok(
      auditoria.corpo.some((linha) => linha.acao === "produto.criado" && linha.ator === "bootstrap"),
    );

    const revogada = await pedir(`/chaves/${chaveLeitor.corpo.id}`, { metodo: "DELETE" });
    assert.equal(revogada.status, 200);
    assert.equal((await pedir("/produtos", { chave: token })).status, 401);
  });
});

test("cobrança Pix devolve copia e cola válido e QR Code", async () => {
  process.env.PIX_CHAVE = "vendas@exemplo.com";
  process.env.PIX_NOME = "Loja Exemplo";
  process.env.PIX_CIDADE = "Sao Paulo";
  try {
    await comServidor(async (pedir) => {
      const produto = await pedir("/produtos", {
        metodo: "POST",
        corpo: { nome: "Item Pix", preco_centavos: 2500, estoque: 3 },
      });
      const cliente = await pedir("/clientes", { metodo: "POST", corpo: { nome: "Pix Teste" } });
      const pedido = await pedir("/pedidos", {
        metodo: "POST",
        corpo: { cliente_id: cliente.corpo.id, itens: [{ produto_id: produto.corpo.id, quantidade: 1 }] },
      });
      const cobranca = await pedir(`/pedidos/${pedido.corpo.numero}/pix`, { metodo: "POST" });
      assert.equal(cobranca.status, 200);
      assert.equal(cobranca.corpo.valor_centavos, 2500);
      assert.match(cobranca.corpo.copia_e_cola, /^000201/);
      assert.match(cobranca.corpo.copia_e_cola, /br\.gov\.bcb\.pix/);
      assert.match(cobranca.corpo.qr_code, /^data:image\/svg\+xml;base64,/);
      assert.equal(cobranca.corpo.pedido, pedido.corpo.numero);
    });
  } finally {
    delete process.env.PIX_CHAVE;
    delete process.env.PIX_NOME;
    delete process.env.PIX_CIDADE;
  }
});

test("limite de requisições responde 429", async () => {
  await comServidor(
    async (pedir) => {
      assert.equal((await pedir("/produtos")).status, 200);
      assert.equal((await pedir("/produtos")).status, 200);
      assert.equal((await pedir("/produtos")).status, 200);
      const excedido = await pedir("/produtos");
      assert.equal(excedido.status, 429);
      assert.equal(excedido.corpo.erro.codigo, "LIMITE_EXCEDIDO");
    },
    { limitePorMinuto: 3 },
  );
});
