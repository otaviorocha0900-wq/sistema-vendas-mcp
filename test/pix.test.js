import { test } from "node:test";
import assert from "node:assert/strict";
import { crc16, montarPix, qrSvgDataUrl } from "../src/pix.js";

test("CRC16-CCITT-FALSE bate com o vetor conhecido", () => {
  assert.equal(crc16("123456789"), "29B1");
});

test("BR Code tem estrutura EMV, valor e CRC válido", () => {
  const payload = montarPix({
    chave: "vendas@exemplo.com",
    nome: "Loja Exemplo",
    cidade: "São Paulo",
    valorCentavos: 4990,
    txid: "PED0001ABC123",
    descricao: "PED-0001",
  });

  assert.match(payload, /^000201/);
  assert.match(payload, /26\d{2}0014br\.gov\.bcb\.pix/);
  assert.match(payload, /5303986/);
  assert.match(payload, /540549\.90/);
  assert.match(payload, /5802BR/);
  assert.match(payload, /5912Loja Exemplo/);
  assert.match(payload, /6009Sao Paulo/);
  assert.match(payload, /62170513PED0001ABC123/);

  const corpo = payload.slice(0, -4);
  assert.equal(payload.slice(-4), crc16(corpo));
});

test("configuração ausente e valor inválido são recusados", () => {
  assert.throws(() => montarPix({ chave: "", nome: "Loja", cidade: "SP", valorCentavos: 100, txid: "A1" }));
  assert.throws(() => montarPix({ chave: "a@b.com", nome: "", cidade: "SP", valorCentavos: 100, txid: "A1" }));
  assert.throws(() => montarPix({ chave: "a@b.com", nome: "Loja", cidade: "SP", valorCentavos: 0, txid: "A1" }));
});

test("QR Code vira data URL SVG", async () => {
  const payload = montarPix({
    chave: "vendas@exemplo.com",
    nome: "Loja",
    cidade: "SP",
    valorCentavos: 100,
    txid: "PED0001",
  });
  const dataUrl = await qrSvgDataUrl(payload);
  assert.match(dataUrl, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /<svg/);
});
