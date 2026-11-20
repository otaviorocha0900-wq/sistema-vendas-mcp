/**
 * Pix estático (BR Code / EMV QRCPS-MPM).
 * Gera o "copia e cola" sem gateway: o recebedor informa chave, nome e cidade por ambiente.
 */
import QRCode from "qrcode";

export function crc16(texto) {
  let crc = 0xffff;
  for (const byte of Buffer.from(texto, "utf8")) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function campo(id, valor) {
  return `${id}${String(Buffer.byteLength(valor, "utf8")).padStart(2, "0")}${valor}`;
}

function limpar(texto, max) {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * @param {object} dados
 * @param {string} dados.chave Chave Pix (CPF/CNPJ, e-mail, telefone ou aleatória)
 * @param {string} dados.nome Nome do recebedor (até 25)
 * @param {string} dados.cidade Cidade do recebedor (até 15)
 * @param {number} dados.valorCentavos Valor em centavos
 * @param {string} dados.txid Identificador da cobrança (até 25, letras e números)
 * @param {string} [dados.descricao] Descrição opcional (até 72)
 */
export function montarPix({ chave, nome, cidade, valorCentavos, txid, descricao = null }) {
  const chaveLimpa = String(chave ?? "").trim();
  const nomeLimpo = limpar(nome, 25);
  const cidadeLimpa = limpar(cidade, 15);
  const txidLimpo = limpar(txid, 25).replace(/[^A-Za-z0-9]/g, "");
  if (!chaveLimpa) throw new Error("Chave Pix não configurada.");
  if (!nomeLimpo) throw new Error("Nome do recebedor não configurado.");
  if (!cidadeLimpa) throw new Error("Cidade do recebedor não configurada.");
  if (!Number.isInteger(valorCentavos) || valorCentavos <= 0) throw new Error("Valor inválido para o Pix.");
  if (!txidLimpo) throw new Error("txid inválido para o Pix.");

  const conta =
    campo("00", "br.gov.bcb.pix") +
    campo("01", chaveLimpa) +
    (descricao ? campo("02", limpar(descricao, 72)) : "");
  const semCrc =
    campo("00", "01") +
    campo("26", conta) +
    campo("52", "0000") +
    campo("53", "986") +
    campo("54", (valorCentavos / 100).toFixed(2)) +
    campo("58", "BR") +
    campo("59", nomeLimpo) +
    campo("60", cidadeLimpa) +
    campo("62", campo("05", txidLimpo)) +
    "6304";
  return semCrc + crc16(semCrc);
}

/** QR Code como data URL SVG, pronto para devolver em JSON. */
export async function qrSvgDataUrl(payload) {
  const svg = await QRCode.toString(payload, { type: "svg", margin: 1, width: 320, errorCorrectionLevel: "M" });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
