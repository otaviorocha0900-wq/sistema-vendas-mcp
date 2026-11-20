/**
 * Catálogo de ferramentas MCP do sistema de vendas.
 * Usado pelo servidor stdio local e pelo endpoint remoto /mcp da API.
 */
import { qrSvgDataUrl } from "./pix.js";
import {
  ErroNegocio,
  METODOS_PAGAMENTO,
  STATUS_PEDIDO,
  atualizarEstoque,
  buscarClientes,
  buscarPedidos,
  cancelarPedido,
  catalogoTexto,
  consultarPedido,
  criarCliente,
  criarPedido,
  criarProduto,
  estornarPagamento,
  gerarCobrancaPix,
  listarPedidos,
  listarProdutos,
  marcarComoEnviado,
  registrarPagamento,
  relatorioVendas,
  resumoEstoqueBaixo,
} from "./core.js";

export const ferramentas = [
  {
    name: "criar_produto",
    title: "Criar produto",
    description:
      "Cadastra um produto no catálogo. O preço vai em centavos (R$ 49,90 = 4990). O estoque inicial é opcional.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string", description: "Nome do produto." },
        preco_centavos: { type: "integer", minimum: 0, description: "Preço em centavos, sem vírgula." },
        estoque: { type: "integer", minimum: 0, default: 0, description: "Unidades disponíveis." },
        sku: { type: "string", description: "Código único do produto (opcional)." },
        descricao: { type: "string", description: "Descrição curta (opcional)." },
      },
      required: ["nome", "preco_centavos"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_produtos",
    title: "Listar produtos",
    description:
      "Lista o catálogo com preço, estoque e id. Use antes de montar um pedido para conferir produtos e disponibilidade.",
    inputSchema: {
      type: "object",
      properties: {
        somente_ativos: { type: "boolean", default: true, description: "Incluir só produtos à venda." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "catalogo_para_ia",
    title: "Catálogo em texto",
    description:
      "Devolve o catálogo em texto curto, com id, nome, preço e estoque, pronto para apresentar ao cliente.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "atualizar_estoque",
    title: "Atualizar estoque",
    description:
      "Soma uma quantidade ao estoque de um produto. Use valor negativo para baixar (perda, ajuste). O estoque nunca fica negativo.",
    inputSchema: {
      type: "object",
      properties: {
        produto_id: { type: "integer", minimum: 1 },
        quantidade: { type: "integer", description: "Delta: positivo repõe, negativo baixa." },
      },
      required: ["produto_id", "quantidade"],
      additionalProperties: false,
    },
  },
  {
    name: "resumo_estoque_baixo",
    title: "Estoque baixo",
    description: "Lista produtos ativos com estoque igual ou abaixo do limite informado. Bom para avisar antes de faltar.",
    inputSchema: {
      type: "object",
      properties: {
        limite: { type: "integer", minimum: 0, default: 5 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "criar_cliente",
    title: "Criar cliente",
    description: "Cadastra um cliente. E-mail é único quando informado. Só o nome é obrigatório.",
    inputSchema: {
      type: "object",
      properties: {
        nome: { type: "string" },
        email: { type: "string" },
        telefone: { type: "string" },
        documento: { type: "string", description: "CPF/CNPJ, se o cliente informar." },
      },
      required: ["nome"],
      additionalProperties: false,
    },
  },
  {
    name: "buscar_clientes",
    title: "Buscar clientes",
    description:
      "Busca clientes por nome, e-mail, telefone ou documento. Sem termo, lista os mais recentes. Use para achar o cliente antes de abrir um pedido.",
    inputSchema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "Parte do nome, e-mail, telefone ou documento." },
        limite: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "criar_pedido",
    title: "Criar pedido",
    description:
      "Abre um pedido e reserva o estoque. O pedido nasce com status 'aguardando_pagamento'. Cada item tem produto_id e quantidade; itens repetidos são somados. Preços vêm do catálogo.",
    inputSchema: {
      type: "object",
      properties: {
        cliente_id: { type: "integer", minimum: 1 },
        itens: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              produto_id: { type: "integer", minimum: 1 },
              quantidade: { type: "integer", minimum: 1 },
            },
            required: ["produto_id", "quantidade"],
            additionalProperties: false,
          },
        },
        observacao: { type: "string", description: "Observação do pedido (opcional)." },
      },
      required: ["cliente_id", "itens"],
      additionalProperties: false,
    },
  },
  {
    name: "consultar_pedido",
    title: "Consultar pedido",
    description:
      "Detalha um pedido por id ou número (ex.: 12 ou PED-0012): cliente, itens, total, valor pago, saldo, status, rastreio e pagamentos.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string", description: "Id numérico ou número PED-0000." },
      },
      required: ["pedido"],
      additionalProperties: false,
    },
  },
  {
    name: "listar_pedidos",
    title: "Listar pedidos",
    description: "Lista os pedidos mais recentes, opcionalmente filtrados por status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: STATUS_PEDIDO },
        limite: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "buscar_pedidos",
    title: "Buscar pedidos",
    description:
      "Filtra pedidos por nome/número do cliente, cliente_id, status e período. Use para responder 'meus pedidos' ou fechar um período.",
    inputSchema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "Parte do número do pedido ou do nome/e-mail do cliente." },
        cliente_id: { type: "integer", minimum: 1 },
        status: { type: "string", enum: STATUS_PEDIDO },
        de: { type: "string", description: "Data inicial AAAA-MM-DD." },
        ate: { type: "string", description: "Data final AAAA-MM-DD." },
        limite: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "registrar_pagamento",
    title: "Registrar pagamento",
    description:
      "Registra um pagamento, total ou parcial, em pedido 'aguardando_pagamento' e informa como foi pago. Sem valor, quita o saldo; com valor, aceita qualquer parte até o saldo e o pedido vira 'pago' só quando fecha. Métodos: pix, cartao, boleto, dinheiro, transferencia.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string", description: "Id numérico ou número PED-0000." },
        metodo: { type: "string", enum: METODOS_PAGAMENTO },
        valor_centavos: {
          type: "integer",
          minimum: 1,
          description: "Opcional. Sem ele, registra o saldo restante; com ele, registra pagamento parcial.",
        },
        observacao: {
          type: "string",
          description: "Como foi pago ou referência do comprovante (opcional). Ex.: 'Pix recebido, comprovante 123'.",
        },
      },
      required: ["pedido", "metodo"],
      additionalProperties: false,
    },
  },
  {
    name: "gerar_cobranca_pix",
    title: "Gerar cobrança Pix",
    description:
      "Gera o Pix copia e cola (BR Code) e o QR Code do saldo de um pedido, sem gateway. Precisa de PIX_CHAVE, PIX_NOME e PIX_CIDADE no ambiente. Depois de receber, registre o pagamento com método pix.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string", description: "Id numérico ou número PED-0000." },
      },
      required: ["pedido"],
      additionalProperties: false,
    },
  },
  {
    name: "marcar_como_enviado",
    title: "Marcar como enviado",
    description: "Marca um pedido pago como enviado e guarda o código de rastreio, se houver.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string" },
        rastreio: { type: "string" },
      },
      required: ["pedido"],
      additionalProperties: false,
    },
  },
  {
    name: "cancelar_pedido",
    title: "Cancelar pedido",
    description: "Cancela um pedido sem pagamento confirmado e devolve o estoque. Pedido com pagamento precisa de estorno.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string" },
        motivo: { type: "string" },
      },
      required: ["pedido"],
      additionalProperties: false,
    },
  },
  {
    name: "estornar_pagamento",
    title: "Estornar pagamento",
    description:
      "Estorna todos os pagamentos confirmados de um pedido (inclusive parciais), devolve o estoque e cancela o pedido. Use antes de devolver dinheiro ao cliente.",
    inputSchema: {
      type: "object",
      properties: {
        pedido: { type: "string" },
        motivo: { type: "string" },
      },
      required: ["pedido"],
      additionalProperties: false,
    },
  },
  {
    name: "relatorio_vendas",
    title: "Relatório de vendas",
    description:
      "Resume as vendas pagas no período: total, pedidos, ticket médio, formas de pagamento e produtos que mais venderam. Datas no formato AAAA-MM-DD; sem datas, considera tudo.",
    inputSchema: {
      type: "object",
      properties: {
        de: { type: "string", description: "Data inicial AAAA-MM-DD (opcional)." },
        ate: { type: "string", description: "Data final AAAA-MM-DD (opcional)." },
      },
      additionalProperties: false,
    },
  },
];

export function criarAcoes(db, ctx) {
  return {
  criar_produto: (a) => criarProduto(db, a, ctx),
  listar_produtos: (a) => listarProdutos(db, a),
  catalogo_para_ia: () => catalogoTexto(db),
  atualizar_estoque: (a) => atualizarEstoque(db, a, ctx),
  resumo_estoque_baixo: (a) => resumoEstoqueBaixo(db, a),
  criar_cliente: (a) => criarCliente(db, a, ctx),
  buscar_clientes: (a) => buscarClientes(db, a),
  criar_pedido: (a) =>
    criarPedido(db, { cliente_id: a.cliente_id, itens: a.itens, observacao: a.observacao ?? null }, ctx),
  consultar_pedido: (a) => consultarPedido(db, a.pedido),
  listar_pedidos: (a) => listarPedidos(db, { status: a.status ?? null, limite: a.limite ?? 20 }),
  buscar_pedidos: (a) =>
    buscarPedidos(db, {
      termo: a.termo ?? null,
      cliente_id: a.cliente_id ?? null,
      status: a.status ?? null,
      de: a.de ?? null,
      ate: a.ate ?? null,
      limite: a.limite ?? 20,
    }),
  registrar_pagamento: (a) =>
    registrarPagamento(
      db,
      {
        pedido_id: a.pedido,
        metodo: a.metodo,
        valor_centavos: a.valor_centavos ?? null,
        observacao: a.observacao ?? null,
      },
      ctx,
    ),
  gerar_cobranca_pix: async (a) => {
    const cobranca = gerarCobrancaPix(db, { pedido_id: a.pedido }, ctx);
    return { ...cobranca, qr_code: await qrSvgDataUrl(cobranca.copia_e_cola) };
  },
  marcar_como_enviado: (a) => marcarComoEnviado(db, { pedido_id: a.pedido, rastreio: a.rastreio ?? null }, ctx),
  cancelar_pedido: (a) => cancelarPedido(db, { pedido_id: a.pedido, motivo: a.motivo ?? null }, ctx),
  estornar_pagamento: (a) => estornarPagamento(db, { pedido_id: a.pedido, motivo: a.motivo ?? null }, ctx),
  relatorio_vendas: (a) => relatorioVendas(db, { de: a.de ?? null, ate: a.ate ?? null }),
  };
}
