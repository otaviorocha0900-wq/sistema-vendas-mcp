/**
 * Verificação de fumaça do servidor MCP: inicia o processo, faz o handshake,
 * lista as ferramentas e executa a venda completa por tools/call.
 * Uso: npm run smoke:mcp
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const filho = spawn(process.execPath, [join(raiz, "src", "mcp.js")], {
  cwd: raiz,
  env: {
    ...process.env,
    SALES_DB: ":memory:",
    PIX_CHAVE: "smoke@exemplo.com",
    PIX_NOME: "Loja Smoke",
    PIX_CIDADE: "Sao Paulo",
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let buffer = "";
let proximoId = 0;
const pendentes = new Map();

filho.stdout.on("data", (pedaco) => {
  buffer += pedaco.toString("utf8");
  let quebra;
  while ((quebra = buffer.indexOf("\n")) >= 0) {
    const linha = buffer.slice(0, quebra).trim();
    buffer = buffer.slice(quebra + 1);
    if (!linha) continue;
    const mensagem = JSON.parse(linha);
    if (mensagem.id != null && pendentes.has(mensagem.id)) {
      const { resolver, rejeitar } = pendentes.get(mensagem.id);
      pendentes.delete(mensagem.id);
      if (mensagem.error) rejeitar(new Error(mensagem.error.message));
      else resolver(mensagem.result);
    }
  }
});

filho.stderr.on("data", (pedaco) => {
  const texto = pedaco.toString("utf8").trim();
  if (texto) console.error(`[mcp] ${texto}`);
});

const falhar = setTimeout(() => {
  console.error("Tempo esgotado no smoke test do MCP.");
  filho.kill();
  process.exit(1);
}, 15_000);

function pedir(method, params = {}) {
  const id = ++proximoId;
  return new Promise((resolver, rejeitar) => {
    pendentes.set(id, { resolver, rejeitar });
    filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

function chamar(name, argumentos = {}) {
  return pedir("tools/call", { name, arguments: argumentos });
}

try {
  await pedir("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "smoke-mcp", version: "1.0.0" },
  });
  filho.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

  const { tools } = await pedir("tools/list");
  console.log(`Ferramentas expostas (${tools.length}): ${tools.map((t) => t.name).join(", ")}`);
  if (tools.length !== 17) throw new Error(`Esperava 17 ferramentas, recebi ${tools.length}.`);

  const produto = JSON.parse(
    (await chamar("criar_produto", { nome: "Produto smoke", preco_centavos: 4500, estoque: 10 })).content[0].text,
  );
  const cliente = JSON.parse(
    (await chamar("criar_cliente", { nome: "Cliente smoke", email: "smoke@exemplo.com" })).content[0].text,
  );
  const pedido = JSON.parse(
    (await chamar("criar_pedido", { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 2 }] }))
      .content[0].text,
  );
  const pago = JSON.parse(
    (await chamar("registrar_pagamento", { pedido: pedido.numero, metodo: "pix" })).content[0].text,
  );
  const envio = JSON.parse(
    (await chamar("marcar_como_enviado", { pedido: pedido.numero, rastreio: "SMOKE123" })).content[0].text,
  );

  console.log(`Pedido ${pedido.numero}: ${pedido.total} → ${pago.status} → ${envio.status} (${envio.rastreio})`);

  const catalogo = (await chamar("catalogo_para_ia", {})).content[0].text;
  if (!catalogo.includes("Produto smoke")) throw new Error("Catálogo em texto não listou o produto.");

  const busca = JSON.parse(
    (await chamar("buscar_pedidos", { termo: "Cliente smoke" })).content[0].text,
  ).itens;
  if (busca.length !== 1) throw new Error(`Busca de pedidos esperava 1, recebeu ${busca.length}.`);

  const baixo = JSON.parse((await chamar("resumo_estoque_baixo", { limite: 100 })).content[0].text);
  if (!baixo.produtos.some((item) => item.nome === "Produto smoke")) {
    throw new Error("Estoque baixo não listou o produto.");
  }

  const pedido2 = JSON.parse(
    (await chamar("criar_pedido", { cliente_id: cliente.id, itens: [{ produto_id: produto.id, quantidade: 1 }] }))
      .content[0].text,
  );
  const pix = JSON.parse((await chamar("gerar_cobranca_pix", { pedido: pedido2.numero })).content[0].text);
  if (!pix.copia_e_cola.startsWith("000201") || !pix.qr_code.startsWith("data:image/svg+xml;base64,")) {
    throw new Error("Cobrança Pix inválida.");
  }
  const parcial = JSON.parse(
    (await chamar("registrar_pagamento", { pedido: pedido2.numero, metodo: "pix", valor_centavos: 1000 }))
      .content[0].text,
  );
  if (parcial.status !== "aguardando_pagamento" || parcial.saldo_centavos !== 3500) {
    throw new Error("Pagamento parcial não ficou em aberto com saldo.");
  }
  console.log(`Pix ${pix.txid}: ${pix.valor} | parcial ${parcial.valor_pago} | saldo ${parcial.saldo}`);

  const invalido = await chamar("consultar_pedido", { pedido: "PED-9999" });
  if (!invalido.isError) throw new Error("Era esperado erro para pedido inexistente.");
  console.log(`Erro tratado corretamente: ${invalido.content[0].text}`);

  console.log("Smoke test do MCP: OK");
} catch (erro) {
  console.error(`Smoke test do MCP falhou: ${erro.message}`);
  process.exitCode = 1;
} finally {
  clearTimeout(falhar);
  filho.kill();
}
