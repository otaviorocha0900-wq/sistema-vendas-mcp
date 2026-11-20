/**
 * Lista produtos com estoque baixo. Sai com código 2 quando encontra algum (útil em cron).
 * Uso: npm run estoque:baixo   (SALES_ESTOQUE_MINIMO define o limite, padrão 5)
 */
import { abrirBanco } from "../src/db.js";
import { resumoEstoqueBaixo } from "../src/core.js";

const db = abrirBanco();
const limite = Number(process.env.SALES_ESTOQUE_MINIMO || 5);
const resultado = resumoEstoqueBaixo(db, { limite });
db.close();

if (resultado.produtos.length === 0) {
  console.log(`Nenhum produto com estoque <= ${limite}.`);
} else {
  console.log(`Estoque baixo (<= ${limite}):`);
  for (const produto of resultado.produtos) {
    console.log(`- ${produto.nome}: ${produto.estoque} un. (id ${produto.id})`);
  }
  process.exitCode = 2;
}
