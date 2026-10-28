'use strict';
/**
 * Geração atômica de protocolo de ficha única.
 *
 * Estratégia dual:
 *  1. PostgreSQL (preferido): INSERT … ON CONFLICT DO UPDATE RETURNING seq
 *     garante unicidade entre instâncias serverless sem lock em memória.
 *  2. Sheets (fallback): claim-row em CONTADORES_PROTOCOLO + leitura por
 *     posição de inserção dentro de uma janela de 3 s. Muito mais robusto que
 *     o read-max-increment anterior, mas não é completamente atômico sob
 *     concorrência intensa — recomenda-se PostgreSQL para alta carga.
 *
 * Nenhuma estratégia usa mutex em memória, timestamps como garantia de
 * unicidade, ou renumeração retroativa de protocolos existentes.
 */

const fichaUnica = require('./fichaUnica');

let _deps = null;

/**
 * @param {{ lerAba, appendObjeto, invalidarCacheAba, garantirAbaComCabecalhos, prisma?, claimWindowMs? }} deps
 *   claimWindowMs: tempo de espera após append antes de ler o contador (default 250).
 *                  Use 0 em testes sequenciais.
 */
function init(deps) {
  _deps = deps;
}

const _HEADERS_CONTADOR = ['CHAVE', 'CLAIM_ID', 'MAX_INICIAL', 'DATA_HORA'];

async function _maxExistente(base) {
  const rows = await _deps.lerAba('MANIFESTACOES', 5000).catch(() => []);
  return rows.reduce((cur, item) => {
    const v = String(item.PROTOCOLO || '');
    if (!v.startsWith(base)) return cur;
    const n = Number(v.slice(base.length));
    return Number.isFinite(n) ? Math.max(cur, n) : cur;
  }, 0);
}

async function _seqPostgres(chave, maxExistente) {
  const prisma = _deps.prisma;
  await prisma.$executeRaw`
    CREATE TABLE IF NOT EXISTS protocol_counter (
      chave TEXT PRIMARY KEY,
      seq   INT  NOT NULL DEFAULT 0
    )`;
  const rows = await prisma.$queryRaw`
    INSERT INTO protocol_counter (chave, seq)
    VALUES (${chave}, ${maxExistente + 1})
    ON CONFLICT (chave) DO UPDATE
      SET seq = GREATEST(protocol_counter.seq, ${maxExistente}) + 1
    RETURNING seq`;
  return Number(rows[0].seq);
}

async function _seqSheets(chave, maxExistente) {
  const claimId = Date.now().toString(36).toUpperCase() + '-' +
    Math.random().toString(36).slice(2, 6).toUpperCase();
  const claimTime = Date.now();

  await _deps.garantirAbaComCabecalhos('CONTADORES_PROTOCOLO', _HEADERS_CONTADOR);
  await _deps.appendObjeto('CONTADORES_PROTOCOLO', {
    CHAVE: chave,
    CLAIM_ID: claimId,
    MAX_INICIAL: String(maxExistente),
    DATA_HORA: new Date(claimTime).toISOString(),
  });
  _deps.invalidarCacheAba('CONTADORES_PROTOCOLO');

  const windowMs = typeof _deps.claimWindowMs === 'number' ? _deps.claimWindowMs : 250;
  if (windowMs > 0) await new Promise(r => setTimeout(r, windowMs));

  const linhas = await _deps.lerAba('CONTADORES_PROTOCOLO').catch(() => []);
  // Conta somente claims dentro de uma janela de 3 s ao redor do nosso append:
  // impede que claims de gerações anteriores do mesmo dia/canal inflem a posição.
  const windowSec = 3000;
  const concurrent = linhas.filter(r => {
    if (String(r.CHAVE || '') !== chave) return false;
    const t = new Date(r.DATA_HORA || 0).getTime();
    return Math.abs(t - claimTime) <= windowSec;
  });

  const pos = concurrent.findIndex(r => String(r.CLAIM_ID || '') === claimId);
  if (pos < 0) {
    // Fallback conservador: retorna seq mínimo seguro e emite aviso para reconciliação.
    console.warn(`[protocoloAtomico] claim ${claimId} não encontrado após append para chave ${chave}; usando fallback seq=${maxExistente + 1}`);
    return maxExistente + 1;
  }
  return maxExistente + pos + 1;
}

/**
 * Gera o próximo protocolo oficial para a combinação empresa/canal/data.
 * Preserva prefixos CHIA/PLA/TUB e compatibilidade com protocolos históricos.
 *
 * @param {string}      empresa
 * @param {string}      canal
 * @param {Date|string} agora
 * @returns {Promise<string>}  ex: 'PLA-20261028-06-0001'
 */
async function gerarProtocolo(empresa, canal, agora = new Date()) {
  if (!_deps) throw new Error('[protocoloAtomico] init() deve ser chamado antes de gerarProtocolo()');
  const dataObj = agora instanceof Date ? agora : new Date(agora);
  const dataStr = fichaUnica.dataProtocolo(dataObj);
  const prefixo = fichaUnica.prefixoEmpresa(empresa);
  const codigo = fichaUnica.codigoCanal(canal);
  const chave = `${prefixo}-${dataStr}-${codigo}`;
  const base = `${chave}-`;

  const maxExistente = await _maxExistente(base);

  let seq;
  if (_deps.prisma) {
    seq = await _seqPostgres(chave, maxExistente);
  } else {
    seq = await _seqSheets(chave, maxExistente);
  }
  return fichaUnica.montarProtocolo({ empresa, canal, data: dataObj, sequencial: seq });
}

module.exports = { init, gerarProtocolo };
