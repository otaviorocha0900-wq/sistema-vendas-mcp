/**
 * Regras de negócio do sistema de vendas.
 * Usado tanto pela API HTTP quanto pelo servidor MCP — uma única fonte de verdade.
 * Todos os valores monetários são inteiros em centavos.
 */
import { randomBytes } from "node:crypto";
import { auditar } from "./auditoria.js";
import { montarPix } from "./pix.js";

export class ErroNegocio extends Error {
  constructor(codigo, mensagem, statusHttp = 400) {
    super(mensagem);
    this.name = "ErroNegocio";
    this.codigo = codigo;
    this.statusHttp = statusHttp;
  }
}

export const METODOS_PAGAMENTO = ["pix", "cartao", "boleto", "dinheiro", "transferencia"];
export const STATUS_PEDIDO = ["aguardando_pagamento", "pago", "enviado", "cancelado"];

export function brl(centavos) {
  return (Number(centavos) / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

function agora() {
  return new Date().toISOString();
}

function exigirTexto(valor, campo, { max = 200 } = {}) {
  const texto = String(valor ?? "").trim();
  if (!texto) throw new ErroNegocio("CAMPO_OBRIGATORIO", `Informe o campo "${campo}".`);
  if (texto.length > max) throw new ErroNegocio("CAMPO_LONGO", `O campo "${campo}" passa de ${max} caracteres.`);
  return texto;
}

function exigirInteiro(valor, campo, { min = 0 } = {}) {
  const numero = Number(valor);
  if (!Number.isInteger(numero) || numero < min) {
    throw new ErroNegocio("VALOR_INVALIDO", `O campo "${campo}" deve ser um inteiro maior ou igual a ${min}.`);
  }
  return numero;
}

function transacao(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultado = fn();
    db.exec("COMMIT");
    return resultado;
  } catch (erro) {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* a transação já pode ter sido encerrada */
    }
    throw erro;
  }
}

function mapProduto(linha) {
  if (!linha) return null;
  return {
    id: Number(linha.id),
    sku: linha.sku,
    nome: linha.nome,
    descricao: linha.descricao,
    preco_centavos: Number(linha.preco_centavos),
    preco: brl(linha.preco_centavos),
    estoque: Number(linha.estoque),
    ativo: Boolean(linha.ativo),
    criado_em: linha.criado_em,
  };
}

function mapCliente(linha) {
  if (!linha) return null;
  return {
    id: Number(linha.id),
    nome: linha.nome,
    email: linha.email,
    telefone: linha.telefone,
    documento: linha.documento,
    criado_em: linha.criado_em,
  };
}

/* ------------------------------- Produtos ------------------------------- */

export function criarProduto(
  db,
  { nome, preco_centavos, estoque = 0, sku = null, descricao = null },
  ctx = {},
) {
  const dados = {
    nome: exigirTexto(nome, "nome"),
    preco_centavos: exigirInteiro(preco_centavos, "preco_centavos", { min: 0 }),
    estoque: exigirInteiro(estoque, "estoque", { min: 0 }),
    sku: sku ? exigirTexto(sku, "sku", { max: 60 }).toUpperCase() : null,
    descricao: descricao ? String(descricao).trim().slice(0, 1000) : null,
  };
  try {
    const info = db
      .prepare(
        "INSERT INTO produtos (nome, sku, descricao, preco_centavos, estoque) VALUES (?, ?, ?, ?, ?)",
      )
      .run(dados.nome, dados.sku, dados.descricao, dados.preco_centavos, dados.estoque);
    const id = Number(info.lastInsertRowid);
    auditar(db, ctx.ator, "produto.criado", "produto", id, {
      nome: dados.nome,
      preco_centavos: dados.preco_centavos,
    });
    return consultarProduto(db, id);
  } catch (erro) {
    if (String(erro.message).includes("UNIQUE")) {
      throw new ErroNegocio("SKU_DUPLICADO", `Já existe um produto com o SKU ${dados.sku}.`, 409);
    }
    throw erro;
  }
}

export function consultarProduto(db, id) {
  const linha = db.prepare("SELECT * FROM produtos WHERE id = ?").get(Number(id));
  if (!linha) throw new ErroNegocio("PRODUTO_NAO_ENCONTRADO", `Produto ${id} não encontrado.`, 404);
  return mapProduto(linha);
}

export function listarProdutos(db, { somente_ativos = true } = {}) {
  const sql = somente_ativos
    ? "SELECT * FROM produtos WHERE ativo = 1 ORDER BY nome"
    : "SELECT * FROM produtos ORDER BY nome";
  return db.prepare(sql).all().map(mapProduto);
}

/** Repõe (ou corrige) o estoque somando um delta. Delta negativo também é aceito. */
export function atualizarEstoque(db, { produto_id, quantidade }, ctx = {}) {
  const produto = consultarProduto(db, produto_id);
  const delta = exigirInteiro(quantidade, "quantidade", { min: -1_000_000 });
  if (delta === 0) throw new ErroNegocio("VALOR_INVALIDO", "Informe uma quantidade diferente de zero.");
  const novo = produto.estoque + delta;
  if (novo < 0) {
    throw new ErroNegocio(
      "ESTOQUE_INSUFICIENTE",
      `O produto "${produto.nome}" tem ${produto.estoque} unidade(s); não dá para remover ${Math.abs(delta)}.`,
      409,
    );
  }
  db.prepare("UPDATE produtos SET estoque = ? WHERE id = ?").run(novo, produto.id);
  auditar(db, ctx.ator, "estoque.ajustado", "produto", produto.id, {
    de: produto.estoque,
    para: novo,
  });
  return { produto_id: produto.id, nome: produto.nome, estoque_anterior: produto.estoque, estoque: novo };
}

export function resumoEstoqueBaixo(db, { limite = 5 } = {}) {
  const max = exigirInteiro(limite, "limite", { min: 0 });
  const linhas = db
    .prepare("SELECT * FROM produtos WHERE ativo = 1 AND estoque <= ? ORDER BY estoque, nome")
    .all(max);
  return {
    limite: max,
    produtos: linhas.map((linha) => ({
      id: Number(linha.id),
      nome: linha.nome,
      sku: linha.sku,
      estoque: Number(linha.estoque),
      preco: brl(linha.preco_centavos),
    })),
  };
}

/** Catálogo em texto curto, pronto para a IA responder ao cliente. */
export function catalogoTexto(db) {
  const produtos = listarProdutos(db);
  if (produtos.length === 0) return "Catálogo vazio.";
  return produtos
    .map(
      (p) =>
        `${p.id}. ${p.nome} — ${p.preco} — ${p.estoque} un. em estoque${p.sku ? ` — SKU ${p.sku}` : ""}`,
    )
    .join("\n");
}

/* ------------------------------- Clientes ------------------------------- */

export function criarCliente(db, { nome, email = null, telefone = null, documento = null }, ctx = {}) {
  const dados = {
    nome: exigirTexto(nome, "nome"),
    email: email ? String(email).trim().toLowerCase() : null,
    telefone: telefone ? String(telefone).trim() : null,
    documento: documento ? String(documento).trim() : null,
  };
  if (dados.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
    throw new ErroNegocio("EMAIL_INVALIDO", "E-mail inválido.");
  }
  try {
    const info = db
      .prepare("INSERT INTO clientes (nome, email, telefone, documento) VALUES (?, ?, ?, ?)")
      .run(dados.nome, dados.email, dados.telefone, dados.documento);
    const id = Number(info.lastInsertRowid);
    auditar(db, ctx.ator, "cliente.criado", "cliente", id, { nome: dados.nome });
    return consultarCliente(db, id);
  } catch (erro) {
    if (String(erro.message).includes("UNIQUE")) {
      throw new ErroNegocio("EMAIL_DUPLICADO", `Já existe um cliente com o e-mail ${dados.email}.`, 409);
    }
    throw erro;
  }
}

export function consultarCliente(db, id) {
  const linha = db.prepare("SELECT * FROM clientes WHERE id = ?").get(Number(id));
  if (!linha) throw new ErroNegocio("CLIENTE_NAO_ENCONTRADO", `Cliente ${id} não encontrado.`, 404);
  return mapCliente(linha);
}

export function buscarClientes(db, { termo = "", limite = 20 } = {}) {
  const max = Math.min(Math.max(Number(limite) || 20, 1), 100);
  const busca = String(termo ?? "").trim();
  if (!busca) {
    return db.prepare("SELECT * FROM clientes ORDER BY id DESC LIMIT ?").all(max).map(mapCliente);
  }
  const como = `%${busca.replace(/[%_]/g, "")}%`;
  return db
    .prepare(
      `SELECT * FROM clientes
       WHERE nome LIKE ? OR email LIKE ? OR telefone LIKE ? OR documento LIKE ?
       ORDER BY nome LIMIT ?`,
    )
    .all(como, como, como, como, max)
    .map(mapCliente);
}

/* -------------------------------- Pedidos ------------------------------- */

function mapaPedido(linha) {
  if (!linha) return null;
  const total = Number(linha.total_centavos);
  const pago = Number(linha.valor_pago_centavos ?? 0);
  return {
    id: Number(linha.id),
    numero: linha.numero,
    cliente_id: Number(linha.cliente_id),
    cliente_nome: linha.cliente_nome ?? undefined,
    status: linha.status,
    total_centavos: total,
    total: brl(total),
    valor_pago_centavos: pago,
    valor_pago: brl(pago),
    saldo_centavos: Math.max(total - pago, 0),
    saldo: brl(Math.max(total - pago, 0)),
    observacao: linha.observacao,
    rastreio: linha.rastreio,
    criado_em: linha.criado_em,
    atualizado_em: linha.atualizado_em,
  };
}

export function resolverPedido(db, referencia) {
  const ref = String(referencia ?? "").trim();
  const linha = /^PED-/i.test(ref)
    ? db.prepare("SELECT * FROM pedidos WHERE numero = ?").get(ref.toUpperCase())
    : db.prepare("SELECT * FROM pedidos WHERE id = ?").get(Number(ref));
  if (!linha) {
    throw new ErroNegocio("PEDIDO_NAO_ENCONTRADO", `Pedido "${ref}" não encontrado.`, 404);
  }
  return linha;
}

export function consultarPedido(db, referencia) {
  const pedido = resolverPedido(db, referencia);
  const cliente = db.prepare("SELECT * FROM clientes WHERE id = ?").get(pedido.cliente_id);
  const itens = db
    .prepare("SELECT * FROM itens_pedido WHERE pedido_id = ? ORDER BY id")
    .all(pedido.id)
    .map((item) => ({
      produto_id: Number(item.produto_id),
      nome_produto: item.nome_produto,
      quantidade: Number(item.quantidade),
      preco_unitario_centavos: Number(item.preco_unitario_centavos),
      preco_unitario: brl(item.preco_unitario_centavos),
      subtotal_centavos: Number(item.subtotal_centavos),
      subtotal: brl(item.subtotal_centavos),
    }));
  const pagamentos = db
    .prepare("SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY id")
    .all(pedido.id)
    .map((pagamento) => ({
      id: Number(pagamento.id),
      metodo: pagamento.metodo,
      valor_centavos: Number(pagamento.valor_centavos),
      valor: brl(pagamento.valor_centavos),
      status: pagamento.status,
      observacao: pagamento.observacao,
      criado_em: pagamento.criado_em,
    }));
  return {
    ...mapaPedido(pedido),
    cliente: mapCliente(cliente),
    itens,
    pagamentos,
  };
}

export function criarPedido(db, { cliente_id, itens, observacao = null }, ctx = {}) {
  const cliente = consultarCliente(db, cliente_id);
  if (!Array.isArray(itens) || itens.length === 0) {
    throw new ErroNegocio("PEDIDO_SEM_ITENS", "O pedido precisa de pelo menos um item.");
  }

  // Junta itens repetidos do mesmo produto.
  const agrupados = new Map();
  for (const item of itens) {
    const produtoId = exigirInteiro(item?.produto_id, "produto_id", { min: 1 });
    const quantidade = exigirInteiro(item?.quantidade, "quantidade", { min: 1 });
    agrupados.set(produtoId, (agrupados.get(produtoId) || 0) + quantidade);
  }

  return transacao(db, () => {
    let total = 0;
    const preparados = [];
    for (const [produtoId, quantidade] of agrupados) {
      const produto = consultarProduto(db, produtoId);
      if (!produto.ativo) {
        throw new ErroNegocio("PRODUTO_INATIVO", `O produto "${produto.nome}" está fora de venda.`, 409);
      }
      if (produto.estoque < quantidade) {
        throw new ErroNegocio(
          "ESTOQUE_INSUFICIENTE",
          `O produto "${produto.nome}" tem ${produto.estoque} unidade(s) e o pedido pede ${quantidade}.`,
          409,
        );
      }
      const subtotal = produto.preco_centavos * quantidade;
      total += subtotal;
      preparados.push({ produto, quantidade, subtotal });
    }

    const info = db
      .prepare("INSERT INTO pedidos (cliente_id, total_centavos, observacao) VALUES (?, ?, ?)")
      .run(cliente.id, total, observacao ? String(observacao).slice(0, 500) : null);
    const pedidoId = Number(info.lastInsertRowid);
    db.prepare("UPDATE pedidos SET numero = ? WHERE id = ?").run(
      `PED-${String(pedidoId).padStart(4, "0")}`,
      pedidoId,
    );

    const inserirItem = db.prepare(
      `INSERT INTO itens_pedido
        (pedido_id, produto_id, nome_produto, quantidade, preco_unitario_centavos, subtotal_centavos)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const baixarEstoque = db.prepare("UPDATE produtos SET estoque = estoque - ? WHERE id = ?");
    for (const { produto, quantidade, subtotal } of preparados) {
      inserirItem.run(pedidoId, produto.id, produto.nome, quantidade, produto.preco_centavos, subtotal);
      baixarEstoque.run(quantidade, produto.id);
    }

    auditar(db, ctx.ator, "pedido.criado", "pedido", pedidoId, {
      cliente_id: cliente.id,
      total_centavos: total,
    });
    return consultarPedido(db, pedidoId);
  });
}

export function listarPedidos(db, { status = null, limite = 20 } = {}) {
  const max = Math.min(Math.max(Number(limite) || 20, 1), 100);
  if (status && !STATUS_PEDIDO.includes(status)) {
    throw new ErroNegocio("STATUS_INVALIDO", `Status deve ser um de: ${STATUS_PEDIDO.join(", ")}.`);
  }
  const sql = `
    SELECT p.*, c.nome AS cliente_nome
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
    ${status ? "WHERE p.status = ?" : ""}
    ORDER BY p.id DESC LIMIT ?`;
  const linhas = status ? db.prepare(sql).all(status, max) : db.prepare(sql).all(max);
  return linhas.map(mapaPedido);
}

export function buscarPedidos(
  db,
  { termo = null, cliente_id = null, status = null, de = null, ate = null, limite = 20 } = {},
) {
  const max = Math.min(Math.max(Number(limite) || 20, 1), 100);
  if (status && !STATUS_PEDIDO.includes(status)) {
    throw new ErroNegocio("STATUS_INVALIDO", `Status deve ser um de: ${STATUS_PEDIDO.join(", ")}.`);
  }
  const condicoes = [];
  const valores = [];
  if (termo) {
    condicoes.push("(p.numero LIKE ? OR c.nome LIKE ? OR c.email LIKE ?)");
    const como = `%${String(termo).replace(/[%_]/g, "")}%`;
    valores.push(como, como, como);
  }
  if (cliente_id != null) {
    condicoes.push("p.cliente_id = ?");
    valores.push(exigirInteiro(cliente_id, "cliente_id", { min: 1 }));
  }
  if (status) {
    condicoes.push("p.status = ?");
    valores.push(status);
  }
  if (de) {
    condicoes.push("p.criado_em >= ?");
    valores.push(`${de}T00:00:00.000Z`);
  }
  if (ate) {
    condicoes.push("p.criado_em <= ?");
    valores.push(`${ate}T23:59:59.999Z`);
  }
  const sql = `
    SELECT p.*, c.nome AS cliente_nome
    FROM pedidos p JOIN clientes c ON c.id = p.cliente_id
    ${condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : ""}
    ORDER BY p.id DESC LIMIT ?`;
  return db.prepare(sql).all(...valores, max).map(mapaPedido);
}

function totalPago(db, pedidoId) {
  const linha = db
    .prepare(
      "SELECT COALESCE(SUM(valor_centavos), 0) AS pago FROM pagamentos WHERE pedido_id = ? AND status = 'confirmado'",
    )
    .get(pedidoId);
  return Number(linha.pago);
}

export function registrarPagamento(
  db,
  { pedido_id, metodo, valor_centavos = null, observacao = null },
  ctx = {},
) {
  const pedido = resolverPedido(db, pedido_id);
  if (pedido.status !== "aguardando_pagamento") {
    throw new ErroNegocio(
      "PEDIDO_NAO_AGUARDA_PAGAMENTO",
      `O pedido ${pedido.numero} está com status "${pedido.status}" e não aceita novo pagamento.`,
      409,
    );
  }
  if (!METODOS_PAGAMENTO.includes(metodo)) {
    throw new ErroNegocio("METODO_INVALIDO", `Método deve ser um de: ${METODOS_PAGAMENTO.join(", ")}.`);
  }
  const pago = totalPago(db, pedido.id);
  const saldo = Number(pedido.total_centavos) - pago;
  if (saldo <= 0) {
    throw new ErroNegocio("PEDIDO_JA_PAGO", `O pedido ${pedido.numero} já está totalmente pago.`, 409);
  }
  const valor = valor_centavos == null ? saldo : exigirInteiro(valor_centavos, "valor_centavos", { min: 1 });
  if (valor > saldo) {
    throw new ErroNegocio(
      "VALOR_EXCEDENTE",
      `O saldo do pedido ${pedido.numero} é ${brl(saldo)}; recebido ${brl(valor)}.`,
      409,
    );
  }

  return transacao(db, () => {
    db.prepare(
      "INSERT INTO pagamentos (pedido_id, metodo, valor_centavos, observacao) VALUES (?, ?, ?, ?)",
    ).run(pedido.id, metodo, valor, observacao ? String(observacao).slice(0, 500) : null);
    const novoPago = pago + valor;
    const novoStatus = novoPago === Number(pedido.total_centavos) ? "pago" : "aguardando_pagamento";
    db.prepare(
      "UPDATE pedidos SET valor_pago_centavos = ?, status = ?, atualizado_em = ? WHERE id = ?",
    ).run(novoPago, novoStatus, agora(), pedido.id);
    auditar(db, ctx.ator, "pagamento.registrado", "pedido", pedido.id, {
      metodo,
      valor_centavos: valor,
      status: novoStatus,
      observacao: observacao ? String(observacao).slice(0, 500) : null,
    });
    return consultarPedido(db, pedido.id);
  });
}

export function marcarComoEnviado(db, { pedido_id, rastreio = null }, ctx = {}) {
  const pedido = resolverPedido(db, pedido_id);
  if (pedido.status !== "pago") {
    throw new ErroNegocio(
      "STATUS_INVALIDO",
      `Só dá para enviar um pedido pago. O pedido ${pedido.numero} está "${pedido.status}".`,
      409,
    );
  }
  db.prepare("UPDATE pedidos SET status = 'enviado', rastreio = ?, atualizado_em = ? WHERE id = ?").run(
    rastreio ? String(rastreio).trim().slice(0, 120) : null,
    agora(),
    pedido.id,
  );
  auditar(db, ctx.ator, "pedido.enviado", "pedido", pedido.id, { rastreio });
  return consultarPedido(db, pedido.id);
}

function devolverEstoque(db, pedidoId) {
  const itens = db.prepare("SELECT produto_id, quantidade FROM itens_pedido WHERE pedido_id = ?").all(pedidoId);
  const devolver = db.prepare("UPDATE produtos SET estoque = estoque + ? WHERE id = ?");
  for (const item of itens) devolver.run(item.quantidade, item.produto_id);
}

export function cancelarPedido(db, { pedido_id, motivo = null }, ctx = {}) {
  const pedido = resolverPedido(db, pedido_id);
  if (pedido.status === "cancelado") {
    throw new ErroNegocio("PEDIDO_JA_CANCELADO", `O pedido ${pedido.numero} já está cancelado.`, 409);
  }
  if (totalPago(db, pedido.id) > 0) {
    throw new ErroNegocio(
      "PEDIDO_PAGO",
      `O pedido ${pedido.numero} tem pagamento registrado. Use o estorno para cancelar e devolver o valor.`,
      409,
    );
  }
  return transacao(db, () => {
    devolverEstoque(db, pedido.id);
    db.prepare(
      "UPDATE pedidos SET status = 'cancelado', observacao = COALESCE(?, observacao), atualizado_em = ? WHERE id = ?",
    ).run(motivo ? `Cancelado: ${String(motivo).slice(0, 400)}` : null, agora(), pedido.id);
    auditar(db, ctx.ator, "pedido.cancelado", "pedido", pedido.id, { motivo });
    return consultarPedido(db, pedido.id);
  });
}

export function estornarPagamento(db, { pedido_id, motivo = null }, ctx = {}) {
  const pedido = resolverPedido(db, pedido_id);
  if (pedido.status === "cancelado") {
    throw new ErroNegocio("PEDIDO_JA_CANCELADO", `O pedido ${pedido.numero} já está cancelado.`, 409);
  }
  const pago = totalPago(db, pedido.id);
  if (pago === 0) {
    throw new ErroNegocio(
      "PEDIDO_SEM_PAGAMENTO",
      `O pedido ${pedido.numero} não tem pagamento confirmado; use cancelar_pedido.`,
      409,
    );
  }
  return transacao(db, () => {
    db.prepare("UPDATE pagamentos SET status = 'estornado' WHERE pedido_id = ? AND status = 'confirmado'").run(
      pedido.id,
    );
    devolverEstoque(db, pedido.id);
    db.prepare(
      "UPDATE pedidos SET status = 'cancelado', valor_pago_centavos = 0, observacao = COALESCE(?, observacao), atualizado_em = ? WHERE id = ?",
    ).run(motivo ? `Estorno: ${String(motivo).slice(0, 400)}` : "Estorno do pagamento", agora(), pedido.id);
    auditar(db, ctx.ator, "pagamento.estornado", "pedido", pedido.id, {
      valor_centavos: pago,
      motivo,
    });
    return consultarPedido(db, pedido.id);
  });
}

/* ------------------------------ Cobrança Pix ----------------------------- */

export function gerarCobrancaPix(
  db,
  { pedido_id, chave = process.env.PIX_CHAVE, nome = process.env.PIX_NOME, cidade = process.env.PIX_CIDADE },
  ctx = {},
) {
  const pedido = resolverPedido(db, pedido_id);
  if (pedido.status !== "aguardando_pagamento") {
    throw new ErroNegocio(
      "PEDIDO_NAO_AGUARDA_PAGAMENTO",
      `O pedido ${pedido.numero} está "${pedido.status}" e não precisa de nova cobrança.`,
      409,
    );
  }
  const pago = totalPago(db, pedido.id);
  const saldo = Number(pedido.total_centavos) - pago;
  if (saldo <= 0) throw new ErroNegocio("PEDIDO_JA_PAGO", "O pedido já está totalmente pago.", 409);

  const txid = `PED${String(pedido.id).padStart(4, "0")}${randomBytes(3).toString("hex").toUpperCase()}`;
  let payload;
  try {
    payload = montarPix({
      chave,
      nome,
      cidade,
      valorCentavos: saldo,
      txid,
      descricao: pedido.numero,
    });
  } catch (erro) {
    throw new ErroNegocio(
      "PIX_NAO_CONFIGURADO",
      `${erro.message} Defina PIX_CHAVE, PIX_NOME e PIX_CIDADE no ambiente para gerar a cobrança.`,
      503,
    );
  }

  db.prepare(
    "INSERT INTO cobrancas_pix (pedido_id, txid, valor_centavos, payload) VALUES (?, ?, ?, ?)",
  ).run(pedido.id, txid, saldo, payload);
  auditar(db, ctx.ator, "pix.cobranca_gerada", "pedido", pedido.id, {
    txid,
    valor_centavos: saldo,
  });

  return {
    pedido: pedido.numero,
    txid,
    valor_centavos: saldo,
    valor: brl(saldo),
    copia_e_cola: payload,
    aviso: "Cobrança estática: confirme o Pix recebido e registre o pagamento com o método pix.",
  };
}

/* ------------------------------- Relatórios ------------------------------ */

function intervalo({ de = null, ate = null }) {
  const dataValida = (valor) => !valor || /^\d{4}-\d{2}-\d{2}$/.test(valor);
  if (!dataValida(de) || !dataValida(ate)) {
    throw new ErroNegocio("DATA_INVALIDA", "Use datas no formato AAAA-MM-DD.");
  }
  return [
    de ? `${de}T00:00:00.000Z` : "1970-01-01T00:00:00.000Z",
    ate ? `${ate}T23:59:59.999Z` : "9999-12-31T23:59:59.999Z",
  ];
}

export function relatorioVendas(db, { de = null, ate = null } = {}) {
  const [inicio, fim] = intervalo({ de, ate });
  const base = `
    FROM pagamentos pg
    JOIN pedidos p ON p.id = pg.pedido_id
    WHERE pg.status = 'confirmado' AND p.status IN ('pago','enviado')
      AND pg.criado_em >= ? AND pg.criado_em <= ?`;

  const resumo = db
    .prepare(`SELECT COUNT(DISTINCT p.id) AS pedidos, COALESCE(SUM(pg.valor_centavos), 0) AS total ${base}`)
    .get(inicio, fim);
  const pedidos = Number(resumo.pedidos);
  const total = Number(resumo.total);

  const porMetodo = db
    .prepare(
      `SELECT pg.metodo, COUNT(*) AS quantidade, SUM(pg.valor_centavos) AS total ${base} GROUP BY pg.metodo ORDER BY total DESC`,
    )
    .all(inicio, fim)
    .map((linha) => ({
      metodo: linha.metodo,
      quantidade: Number(linha.quantidade),
      total_centavos: Number(linha.total),
      total: brl(linha.total),
    }));

  // Um pedido entra uma vez, mesmo com pagamentos parciais.
  const topProdutos = db
    .prepare(
      `SELECT ip.nome_produto, SUM(ip.quantidade) AS quantidade, SUM(ip.subtotal_centavos) AS receita
       FROM itens_pedido ip
       JOIN pedidos p ON p.id = ip.pedido_id
       WHERE p.status IN ('pago','enviado')
         AND EXISTS (
           SELECT 1 FROM pagamentos pg
           WHERE pg.pedido_id = p.id AND pg.status = 'confirmado'
             AND pg.criado_em >= ? AND pg.criado_em <= ?
         )
       GROUP BY ip.nome_produto
       ORDER BY receita DESC LIMIT 5`,
    )
    .all(inicio, fim)
    .map((linha) => ({
      produto: linha.nome_produto,
      quantidade: Number(linha.quantidade),
      receita_centavos: Number(linha.receita),
      receita: brl(linha.receita),
    }));

  return {
    periodo: { de: de || "início", ate: ate || "hoje" },
    pedidos_pagos: pedidos,
    total_centavos: total,
    total: brl(total),
    ticket_medio_centavos: pedidos ? Math.round(total / pedidos) : 0,
    ticket_medio: brl(pedidos ? Math.round(total / pedidos) : 0),
    por_metodo: porMetodo,
    top_produtos: topProdutos,
  };
}
