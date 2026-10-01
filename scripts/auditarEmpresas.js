'use strict';
/**
 * Auditoria de empresas por aba — somente leitura.
 * Mostra: total de registros, sem empresa, e cada valor distinto
 * com contagem e código canônico (ou "DESCONHECIDO").
 * Não exibe dados de clientes.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const sheets = require('../api/sheets');

// Mesma lógica de empresaCanonica() do api/index.js
function normalizarTexto(t) {
  return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const EMPRESA_MAP = {
  CHIACCHIO: ['chiacchio embalagens', 'chiachio embalagens', 'chiacchio'],
  PLASCHIO:  ['plaschio'],
  TUBAHIA:   ['tubahia', 'cesbap'],
  MASTER:    ['grupo chiacchio'],
};

function empresaCanonica(texto) {
  const norm = normalizarTexto(texto || '');
  if (!norm) return null;
  for (const [cod, grafias] of Object.entries(EMPRESA_MAP)) {
    if (grafias.some(g => norm === g)) return cod;
  }
  return null;
}

const COLUNA_EMPRESA_ABA = {
  MANIFESTACOES:              'EMPRESA_RECLAMADA',
  'Reclamações':              'Empresa',
  'Reclamações + devolutiva': 'Empresa',
  BANCO_HISTORICO:            'DRV_EMPRESA_NORMALIZADA',
  BANCO_RNC:                  'EMPRESA_RECLAMADA',
  DEVOLUTIVAS:                'EMPRESA',
  FILA_APROVACAO:             'EMPRESA',
  CEREBRO_APRENDIZADO:        'EMPRESA',
  PADROES_VALIDADOS:          'EMPRESA',
};

async function auditarAba(nomeAba, campo) {
  let rows;
  try {
    rows = await sheets.lerAba(nomeAba);
  } catch (e) {
    console.log(`  [ERRO ao ler aba: ${e.message}]`);
    return;
  }

  const total = rows.length;
  let semEmpresa = 0;
  const contagem = {};

  for (const row of rows) {
    const val = (row[campo] || '').trim();
    if (!val) { semEmpresa++; continue; }
    contagem[val] = (contagem[val] || 0) + 1;
  }

  console.log(`  Total: ${total} | Sem empresa: ${semEmpresa}`);

  const entradas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  for (const [val, n] of entradas) {
    const cod = empresaCanonica(val) || 'DESCONHECIDO';
    console.log(`  ${String(n).padStart(4)}  "${val}"  →  ${cod}`);
  }
}

(async () => {
  console.log('\n=== AUDITORIA DE EMPRESAS ===\n');
  for (const [aba, campo] of Object.entries(COLUNA_EMPRESA_ABA)) {
    console.log(`Aba: ${aba}  (campo: ${campo})`);
    await auditarAba(aba, campo);
    console.log('');
  }
  process.exit(0);
})();
