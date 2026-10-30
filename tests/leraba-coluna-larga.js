'use strict';

// Regressão: lerAba com maxRows não deve truncar colunas além de AZ (coluna 52).
// Este teste verifica que a função lê todas as colunas quando as linhas são limitadas.
// O bug original usava range "ABA!A1:AZ${maxRows}" — ANALISE_IA estava na coluna ~68.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

// Cria mock que simula planilha com colunas além de AZ
let capturedRange = null;
const mockSheets = {
  spreadsheets: {
    values: {
      get({ range }) {
        capturedRange = range;
        // Simula planilha com 70 colunas, onde ANALISE_IA está na posição 68
        const headers = [];
        for (let i = 0; i < 70; i++) headers.push(`COL_${String(i).padStart(2, '0')}`);
        headers[67] = 'ANALISE_IA'; // coluna 68 (índice 67)

        const dataRow = new Array(70).fill('');
        dataRow[67] = JSON.stringify({ complementacoes: { CANAL: { valor: 'TELEFONE', status: 'PREENCHIDA' } } });

        // Simula truncamento da range original (A1:AZ = 52 colunas)
        const match = range.match(/!A1:AZ(\d+)/);
        if (match) {
          // Comportamento do BUG: retorna só 52 colunas
          return Promise.resolve({ data: { values: [headers.slice(0, 52), dataRow.slice(0, 52)] } });
        }
        // Comportamento CORRETO após correção: retorna todas as colunas
        return Promise.resolve({ data: { values: [headers, dataRow] } });
      },
    },
  },
};

(async () => {

// Verifica que a range gerada não limita colunas
const maxRows = 5000;
const nomeAba = 'MANIFESTACOES';

// ANTES da correção: range era `MANIFESTACOES!A1:AZ5000` → trunca em coluna 52
const rangeAntigo = `${nomeAba}!A1:AZ${maxRows}`;
assert.match(rangeAntigo, /!A1:AZ\d+/, 'range antigo deve ter limite de coluna AZ');

// Simula leitura com range antigo
const resultadoBugado = mockSheets.spreadsheets.values.get({ range: rangeAntigo });
const headersBugados = (await resultadoBugado).data.values[0];
const rowBugada = (await resultadoBugado).data.values[1];
const objBugado = {};
headersBugados.forEach((h, i) => { if (h && !(h in objBugado)) objBugado[h] = rowBugada[i] || ''; });
assert.equal(objBugado['ANALISE_IA'], undefined, 'BUG: ANALISE_IA não está disponível com range A1:AZ');

// APÓS a correção: range é `MANIFESTACOES!1:5001` → todas as colunas
const rangeCerto = `${nomeAba}!1:${maxRows + 1}`;
assert.doesNotMatch(rangeCerto, /!A1:AZ/, 'range correto não deve ter limite de coluna AZ');
assert.match(rangeCerto, /!\d+:\d+/, 'range correto deve usar notação de linhas sem limite de coluna');

// Simula leitura com range correto
const resultadoCorreto = mockSheets.spreadsheets.values.get({ range: rangeCerto });
const headersCorretos = (await resultadoCorreto).data.values[0];
const rowCorreta = (await resultadoCorreto).data.values[1];
const objCorreto = {};
headersCorretos.forEach((h, i) => { if (h && !(h in objCorreto)) objCorreto[h] = rowCorreta[i] || ''; });
assert.ok(objCorreto['ANALISE_IA'] !== undefined, 'CORREÇÃO: ANALISE_IA deve estar disponível com range sem limite de coluna');
const analiseIa = JSON.parse(objCorreto['ANALISE_IA'] || '{}');
assert.equal(analiseIa.complementacoes?.CANAL?.valor, 'TELEFONE', 'ANALISE_IA deve conter complementações salvas');

const apiSrc = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8');
assert.doesNotMatch(apiSrc, /const range = maxRows \? `\$\{nomeAba\}!A1:AZ\$\{maxRows\}` : nomeAba/, 'api/index.js não deve mais usar range A1:AZ limitante');
assert.match(apiSrc, /const range = maxRows \? `\$\{nomeAba\}!1:\$\{maxRows \+ 1\}` : nomeAba/, 'api/index.js deve usar range sem limite de coluna');

console.log('lerAba coluna larga: range sem truncamento de colunas confirmado.');
})().catch(e => { console.error(e); process.exitCode = 1; });
