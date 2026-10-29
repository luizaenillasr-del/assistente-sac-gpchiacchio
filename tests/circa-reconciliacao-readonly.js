'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const recon = require('../scripts/reconciliar-circa-readonly');

async function main() {
const matriz = recon.tratarMatriz([
  { __linha: 2, ID_TRATAMENTO: 'TRAT-OK', EMPRESA: 'CHIACCHIO EMBALAGENS', TIPO_MANIFESTACAO: 'Reclamação', CATEGORIA: 'Logística', SUBCATEGORIA: 'Entrega', SETOR_RESPONSAVEL: 'Logística', TRATATIVA_OBRIGATORIA: 'Verificar rastreio', ATIVO: 'SIM' },
  { __linha: 3, ID_TRATAMENTO: 'TRAT-INCOMPLETO', EMPRESA: 'CHIACCHIO EMBALAGENS', TIPO_MANIFESTACAO: 'Reclamação', ATIVO: 'SIM' },
]);
assert.equal(matriz[0].elegivelCirca, true);
assert.equal(matriz[1].elegivelCirca, false);
assert.ok(matriz[1].motivosInelegibilidade.includes('CATEGORIA'));
assert.match(matriz[0].id, /^id:[a-f0-9]{12}$/);
assert.doesNotMatch(JSON.stringify(matriz), /TRAT-OK|Verificar rastreio/);

const historico = recon.tratarHistorico([
  { __linha: 2, ID_HISTORICO: 'HIST-OK', DRV_EMPRESA_NORMALIZADA: 'PLASCHIO', ORIG_DESCRICAO_RECLAMACAO: 'Texto não deve sair no artefato', STATUS_DADO: 'COMPLETO' },
  { __linha: 3, ID_HISTORICO: 'HIST-SEM-EMPRESA', ORIG_DESCRICAO_RECLAMACAO: 'Outro texto', STATUS_DADO: 'COMPLETO' },
]);
assert.equal(historico[0].elegivelSimilaridade, true);
assert.equal(historico[1].elegivelSimilaridade, false);
assert.doesNotMatch(JSON.stringify(historico), /Texto não deve sair|HIST-OK/);

const modelos = recon.tratarModelos([{ __linha: 2, ID_MODELO: 'MOD-1', EMPRESA: 'TODAS', TITULO: 'Não expor', TEXTO_PADRAO: 'Conteúdo confidencial', STATUS: 'APROVADA', VERSAO: '2' }]);
assert.equal(modelos[0].elegivelDevolutiva, true);
assert.doesNotMatch(JSON.stringify(modelos), /Conteúdo confidencial|MOD-1/);

const workflow = fs.readFileSync(path.resolve(__dirname, '../.github/workflows/circa-reconciliacao-readonly-manual.yml'), 'utf8');
assert.match(workflow, /workflow_dispatch/);
assert.match(workflow, /DATABASE_URL_UNPOOLED/);
assert.doesNotMatch(workflow, /migrate deploy|db push|prisma migrate|INSERT INTO|UPDATE |DELETE FROM/i);
const source = fs.readFileSync(path.resolve(__dirname, '../scripts/reconciliar-circa-readonly.js'), 'utf8');
assert.match(source, /spreadsheets\.readonly/);
assert.match(source, /BEGIN READ ONLY/);
assert.doesNotMatch(source, /\.values\.append|\.values\.update|\.values\.clear|INSERT INTO|UPDATE\s+\w+|DELETE FROM/i);

const previousDb = process.env.DATABASE_URL_UNPOOLED;
delete process.env.DATABASE_URL_UNPOOLED;
const postgresAusente = await recon.lerPostgresReadonly();
if (previousDb !== undefined) process.env.DATABASE_URL_UNPOOLED = previousDb;
assert.equal(postgresAusente.status, 'CONFIGURACAO_AUSENTE');
assert.doesNotMatch(JSON.stringify(postgresAusente), /postgres(ql)?:\/\//i);

console.log('Reconciliação CIRCA somente leitura: máscaras, elegibilidade, privacidade e contrato do workflow aprovados.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
