# Sistema de vendas sem interface

API HTTP + servidor MCP para uma IA operar vendas: catálogo, clientes, pedidos, pagamentos (total ou parcial), cobrança Pix, envio, cancelamento, estorno, relatórios e auditoria. Não tem tela: o acesso é por JSON ou pelas ferramentas MCP.

- Node.js 22 ou superior (testado no Node 26)
- SQLite local via `node:sqlite`, sem serviço externo
- Valores em centavos inteiros (`R$ 49,90` = `4990`)
- Uma única fonte de regras (`src/core.js`) para API e MCP
- 18 testes automatizados + smoke test do MCP

## Rodar

```powershell
cd sistema-vendas-mcp
npm install
$env:SALES_API_KEY = "troque-esta-chave"   # chave admin inicial
$env:PIX_CHAVE = "sua-chave-pix"           # opcional, para cobrança Pix
$env:PIX_NOME = "Sua Loja"
$env:PIX_CIDADE = "Sua Cidade"
npm run seed      # opcional: 3 produtos de exemplo
npm run api       # http://127.0.0.1:8787
```

Sem `SALES_API_KEY`, a API usa `dev-local-key` e avisa no console. Essa chave vira a chave **admin** de bootstrap; crie chaves próprias e pare de usar a de desenvolvimento.

| Variável | Padrão | Para quê |
|---|---|---|
| `SALES_API_KEY` | `dev-local-key` | Chave admin criada/garantida no boot |
| `SALES_DB` | `data/vendas.db` | Caminho do banco SQLite (`:memory:` em testes) |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | Porta e interface; use `0.0.0.0` só atrás de proxy/HTTPS |
| `RATE_LIMIT` | `120` | Requisições por minuto por chave/IP |
| `PIX_CHAVE` / `PIX_NOME` / `PIX_CIDADE` | — | Geram o BR Code estático |
| `SALES_TLS_CERT` / `SALES_TLS_KEY` | — | Caminhos do certificado e chave para subir em HTTPS |
| `SALES_BACKUP_DIR` / `SALES_BACKUP_KEEP` | `backups` / `7` | Pasta e retenção dos backups |
| `SALES_RELATORIOS_DIR` | `relatorios` | Saída do fechamento diário |
| `SALES_ESTOQUE_MINIMO` | `5` | Limite do alerta de estoque |

## Permissões

Toda rota (menos `GET /health`) exige `Authorization: Bearer <chave>` ou `x-api-key`.

| Papel | Pode |
|---|---|
| `leitor` | Consultar catálogo, clientes, pedidos, relatórios e estoque baixo |
| `vendedor` | Tudo do leitor + criar cliente/pedido, registrar pagamento, gerar Pix e marcar envio |
| `admin` | Tudo: catálogo, estoque, cancelamento, estorno, chaves e auditoria |

Crie chaves com o admin:

```bash
curl -X POST http://127.0.0.1:8787/chaves \
  -H "Authorization: Bearer $SALES_API_KEY" -H "content-type: application/json" \
  -d '{"nome":"vendedor-ana","papel":"vendedor"}'
```

O token aparece **uma vez**. Guarde-o; o banco só guarda o hash. Revogue com `DELETE /chaves/:id` (a última chave admin não pode ser revogada).

## API

```bash
curl -H "Authorization: Bearer $CHAVE" http://127.0.0.1:8787/produtos

curl -X POST http://127.0.0.1:8787/pedidos \
  -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"cliente_id":1,"itens":[{"produto_id":1,"quantidade":2}]}'

# Cobrança Pix do saldo do pedido (copia e cola + QR Code SVG)
curl -X POST -H "Authorization: Bearer $CHAVE" \
  http://127.0.0.1:8787/pedidos/PED-0001/pix

# Pagamento parcial de R$ 30,00
curl -X POST http://127.0.0.1:8787/pedidos/PED-0001/pagamento \
  -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"metodo":"pix","valor_centavos":3000}'

# Quitar o restante (sem valor = saldo)
curl -X POST http://127.0.0.1:8787/pedidos/PED-0001/pagamento \
  -H "Authorization: Bearer $CHAVE" -H "content-type: application/json" \
  -d '{"metodo":"dinheiro"}'
```

| Rota | Acesso | O que faz |
|---|---|---|
| `GET /health` | pública | Sinal de vida |
| `GET /produtos?somente_ativos=0` | leitor | Catálogo com preço e estoque |
| `POST /produtos` | admin | Cria produto |
| `PATCH /produtos/:id/estoque` | admin | Soma delta (`{"quantidade":5}` ou `-1`) |
| `GET /estoque-baixo?limite=5` | leitor | Produtos para repor |
| `GET /clientes?termo=&limite=` | leitor | Busca por nome, e-mail, telefone ou documento |
| `POST /clientes` | vendedor | Cria cliente (e-mail único) |
| `GET /pedidos?status=&limite=` | leitor | Pedidos recentes |
| `GET /pedidos/busca?termo=&cliente_id=&status=&de=&ate=` | leitor | Busca por cliente, período e status |
| `POST /pedidos` | vendedor | Cria pedido e reserva estoque |
| `GET /pedidos/:id-ou-numero` | leitor | Detalhe com itens, pagamentos, pago e saldo |
| `POST /pedidos/:ref/pagamento` | vendedor | Pagamento total ou parcial |
| `POST /pedidos/:ref/pix` | vendedor | Pix copia e cola + QR do saldo |
| `POST /pedidos/:ref/envio` | vendedor | Marca enviado com rastreio |
| `POST /pedidos/:ref/cancelamento` | admin | Cancela pedido sem pagamento e devolve estoque |
| `POST /pedidos/:ref/estorno` | admin | Estorna pagamentos, devolve estoque e cancela |
| `GET /relatorio?de=&ate=` | leitor | Totais, ticket médio, métodos, top produtos |
| `GET /chaves` / `POST /chaves` / `DELETE /chaves/:id` | admin | Gestão de chaves |
| `GET /auditoria?limite=` | admin | Quem fez o quê, quando |

Erros voltam como `{"erro":{"codigo":"...","mensagem":"..."}}` com HTTP 400, 401, 403, 404, 409 ou 429.

## Ferramentas MCP

Servidor em `src/mcp.js`, transporte stdio, 17 ferramentas:

| Ferramenta | Uso pela IA |
|---|---|
| `criar_produto` / `listar_produtos` | Catálogo |
| `catalogo_para_ia` | Catálogo em texto para apresentar ao cliente |
| `atualizar_estoque` / `resumo_estoque_baixo` | Estoque |
| `criar_cliente` / `buscar_clientes` | Cliente |
| `criar_pedido` / `consultar_pedido` | Pedido |
| `listar_pedidos` / `buscar_pedidos` | Fila e histórico |
| `registrar_pagamento` | Total ou parcial |
| `gerar_cobranca_pix` | Copia e cola + QR do saldo |
| `marcar_como_enviado` | Envio e rastreio |
| `cancelar_pedido` / `estornar_pagamento` | Pós-venda |
| `relatorio_vendas` | Fechamento |

### Conectar no Claude Desktop, Cursor ou outro cliente MCP

```json
{
  "mcpServers": {
    "sistema-vendas": {
      "command": "node",
      "args": ["C:\\Users\\Usuario\\OpenBot\\Agents\\agent-24908997-76c3-4477-a4eb-d2bfb6934af9\\sistema-vendas-mcp\\src\\mcp.js"],
      "env": {
        "SALES_DB": "C:\\Users\\Usuario\\OpenBot\\Agents\\agent-24908997-76c3-4477-a4eb-d2bfb6934af9\\sistema-vendas-mcp\\data\\vendas.db",
        "PIX_CHAVE": "sua-chave-pix",
        "PIX_NOME": "Sua Loja",
        "PIX_CIDADE": "Sua Cidade"
      }
    }
  }
}
```

O MCP roda local (stdio) e não usa chave; ele grava na auditoria como `mcp` (ou `SALES_ACTOR`). Use o mesmo `SALES_DB` da API.

## Ciclo do pedido

```
aguardando_pagamento ──pagamento parcial──> aguardando_pagamento (saldo menor)
        │
        ├── saldo zerado ──> pago ──> enviado
        └── cancelar/estornar ──> cancelado (estoque devolvido)
```

- Criar pedido **reserva** o estoque; cancelar/estornar devolve.
- Pagamentos podem ser parciais; o status vira `pago` só quando o saldo zera.
- Estoque nunca fica negativo; pedido sem estoque é recusado.
- Preço do item é copiado no momento da venda.

## Pix estático

`POST /pedidos/:ref/pix` monta o BR Code EMV com o saldo do pedido e devolve `copia_e_cola` e `qr_code` (data URL SVG). É cobrança **sem gateway**: você recebe o Pix na sua chave e depois registra o pagamento. Não há baixa automática nem webhook.

## Operação

```powershell
npm run backup          # VACUUM INTO + rotação (7 por padrão)
npm run restore:test    # abre o último backup e roda integrity_check
npm run estoque:baixo   # sai com código 2 se houver produto no limite
npm run fechamento      # grava relatorios/fechamento-AAAA-MM-DD.json
npm test                # 18 testes
npm run smoke:mcp       # handshake MCP + venda, Pix e pagamento parcial
```

### Docker

```powershell
$env:SALES_API_KEY = "troque-esta-chave"
docker compose up -d --build
```

O `docker-compose.yml` publica a porta 8787, monta `./data` e `./backups`, tem healthcheck e reinício automático.

### HTTPS

Defina `SALES_TLS_CERT` e `SALES_TLS_KEY` apontando para os arquivos do certificado. Sem eles, a API sobe em HTTP — use só atrás de proxy com TLS.

## Limites conhecidos

- Sem gateway: o Pix é estático e o pagamento é confirmado manualmente.
- Um negócio por banco; sem multiempresa nem login de pessoa física (as chaves são por integração/papel).
- Sem nota fiscal, frete ou imposto.
- Deploy público ainda não foi executado; o pacote Docker está pronto.
- Banco local: para várias máquinas, migre para Postgres ou exponha uma única API com backup.

## Estrutura

```
src/db.js          schema e migrações SQLite
src/core.js        regras de negócio (única fonte de verdade)
src/api.js         HTTP/HTTPS JSON, papéis e limite de requisições
src/auth.js        chaves, hash e papéis
src/auditoria.js   trilha de auditoria
src/pix.js         BR Code + QR Code
src/mcp.js         servidor MCP stdio (17 ferramentas)
src/seed.js        catálogo de exemplo
scripts/           backup, restauração, estoque, fechamento, smoke MCP
test/              regras, HTTP, auth, Pix e backup
Dockerfile / docker-compose.yml
```
