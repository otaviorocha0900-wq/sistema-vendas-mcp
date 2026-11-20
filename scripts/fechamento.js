/**
 * Fechamento do dia: grava o relatório em JSON dentro de relatorios/.
 * Uso: npm run fechamento   (SALES_DIA=AAAA-MM-DD para um dia específico)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { abrirBanco } from "../src/db.js";
import { relatorioVendas } from "../src/core.js";

const db = abrirBanco();
const dia = process.env.SALES_DIA || new Date().toISOString().slice(0, 10);
const relatorio = relatorioVendas(db, { de: dia, ate: dia });
db.close();

const pasta = resolve(process.env.SALES_RELATORIOS_DIR || "relatorios");
mkdirSync(pasta, { recursive: true });
const arquivo = join(pasta, `fechamento-${dia}.json`);
writeFileSync(arquivo, JSON.stringify(relatorio, null, 2), "utf8");

console.log(`Fechamento de ${dia}: ${relatorio.pedidos_pagos} pedido(s), ${relatorio.total}`);
console.log(`Arquivo: ${arquivo}`);
