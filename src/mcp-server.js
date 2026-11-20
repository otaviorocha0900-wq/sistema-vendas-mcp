/**
 * Fábrica do servidor MCP. Cada conexão recebe as ferramentas permitidas
 * para o papel da chave que a abriu (leitor, vendedor ou admin).
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ErroNegocio } from "./core.js";
import { NIVEL_PAPEL } from "./auth.js";
import { criarAcoes, ferramentas } from "./mcp-tools.js";

const NIVEL_ACESSO = { leitura: 1, operacao: 2, admin: 3 };

/** Ferramentas que escrevem ou mexem em dinheiro exigem mais que leitura. */
export const ACESSO_FERRAMENTA = {
  criar_produto: "admin",
  atualizar_estoque: "admin",
  cancelar_pedido: "admin",
  estornar_pagamento: "admin",
  criar_cliente: "operacao",
  criar_pedido: "operacao",
  registrar_pagamento: "operacao",
  gerar_cobranca_pix: "operacao",
  marcar_como_enviado: "operacao",
};

export function acessoDaFerramenta(nome) {
  return ACESSO_FERRAMENTA[nome] ?? "leitura";
}

export function ferramentasPermitidas(papel) {
  const nivel = NIVEL_PAPEL[papel];
  if (!nivel) throw new Error(`Papel inválido para MCP: ${papel}`);
  return ferramentas.filter((ferramenta) => nivel >= NIVEL_ACESSO[acessoDaFerramenta(ferramenta.name)]);
}

export function criarServidorMcp(db, { ator = "mcp", papel = "admin" } = {}) {
  if (!NIVEL_PAPEL[papel]) {
    throw new Error(`Papel inválido para MCP: ${papel}. Use leitor, vendedor ou admin.`);
  }
  const permitidas = ferramentasPermitidas(papel);
  const nomesPermitidos = new Set(permitidas.map((ferramenta) => ferramenta.name));
  const acoes = criarAcoes(db, { ator });

  const servidor = new Server(
    { name: "sistema-vendas", version: "0.3.0" },
    { capabilities: { tools: {} } },
  );

  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: permitidas }));

  servidor.setRequestHandler(CallToolRequestSchema, async (requisicao) => {
    const { name, arguments: argumentos = {} } = requisicao.params;
    if (!nomesPermitidos.has(name)) {
      return {
        content: [
          {
            type: "text",
            text: `SEM_PERMISSAO: a chave com papel "${papel}" não pode usar a ferramenta "${name}".`,
          },
        ],
        isError: true,
      };
    }
    try {
      const resultado = await acoes[name](argumentos);
      const corpo =
        typeof resultado === "string"
          ? { texto: resultado }
          : Array.isArray(resultado)
            ? { itens: resultado }
            : resultado;
      return {
        content: [
          { type: "text", text: typeof resultado === "string" ? resultado : JSON.stringify(corpo, null, 2) },
        ],
        structuredContent: corpo,
      };
    } catch (erro) {
      if (erro instanceof ErroNegocio) {
        return { content: [{ type: "text", text: `${erro.codigo}: ${erro.message}` }], isError: true };
      }
      console.error(erro);
      return { content: [{ type: "text", text: `ERRO_INTERNO: ${erro.message}` }], isError: true };
    }
  });

  return servidor;
}
