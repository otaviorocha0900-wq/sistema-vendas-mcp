#!/usr/bin/env node
/**
 * Entrada MCP local (stdio). Para acesso remoto por URL + token use POST /mcp na API.
 * Papel padrão do MCP local: admin. Ajuste com SALES_MCP_PAPEL e SALES_ACTOR.
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { abrirBanco } from "./db.js";
import { criarServidorMcp } from "./mcp-server.js";

const db = abrirBanco();
const servidor = criarServidorMcp(db, {
  ator: process.env.SALES_ACTOR || "mcp-local",
  papel: process.env.SALES_MCP_PAPEL || "admin",
});

const transporte = new StdioServerTransport();
await servidor.connect(transporte);
console.error("Servidor MCP sistema-vendas conectado via stdio.");
