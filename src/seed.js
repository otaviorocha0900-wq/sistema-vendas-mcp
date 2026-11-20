import { abrirBanco } from "./db.js";
import { criarProduto } from "./core.js";

const db = abrirBanco();
const { total } = db.prepare("SELECT COUNT(*) AS total FROM produtos").get();

if (Number(total) > 0) {
  console.log(`Catálogo já tem ${total} produto(s); seed não alterou nada.`);
  process.exit(0);
}

const exemplos = [
  { nome: "Camiseta básica (exemplo)", sku: "CAM-001", preco_centavos: 4990, estoque: 20, descricao: "Dado de exemplo para testar o fluxo." },
  { nome: "Caneca 300 ml (exemplo)", sku: "CAN-001", preco_centavos: 2990, estoque: 15, descricao: "Dado de exemplo para testar o fluxo." },
  { nome: "Kit presente (exemplo)", sku: "KIT-001", preco_centavos: 12990, estoque: 5, descricao: "Dado de exemplo para testar o fluxo." },
];

for (const exemplo of exemplos) {
  const produto = criarProduto(db, exemplo);
  console.log(`+ ${produto.nome} — ${produto.preco} — estoque ${produto.estoque} — id ${produto.id}`);
}

db.close();
console.log("Seed concluído (dados de exemplo).");
