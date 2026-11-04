'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const matriz = require('../server-services/matrizTratamentoService');

// A classificação não pode depender apenas do cabeçalho da aba: linhas
// legadas podem estar em uma planilha que também possui colunas canônicas.
const legadoComColunasMistas = matriz.normalizarRegra({
  ID_TRATAMENTO: '', ID_REGRA: 'TRAT-001', EMPRESA: 'CHIACCHIO',
  TIPO_MANIFESTACAO: 'Reclamação', SETOR_RESPONSAVEL: 'SAC',
  SLA_HORAS: '72', PRIORIDADE: 'NORMAL', TRATATIVA_PADRAO: 'Verificar pedido',
  ATIVO: 'SIM',
});
assert.equal(legadoComColunasMistas.CONTRATO, 'LEGADO');
assert.equal(legadoComColunasMistas.ID_TRATAMENTO, '');
assert.equal(matriz.regraUtilizavel(legadoComColunasMistas), true);

const incompleto = matriz.normalizarRegra({
  ID_TRATAMENTO: 'TRAT-001', EMPRESA: 'CHIACCHIO', ATIVO: 'SIM', STATUS: 'APROVADO',
});
assert.equal(matriz.regraUtilizavel(incompleto), false);
assert.ok(incompleto.MOTIVOS_INCOMPLETUDE.includes('CATEGORIA'));

const api = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
const inicio = api.indexOf("app.get('/api/cerebro/matriz-operacional'");
const fim = api.indexOf("app.get('/api/cerebro/causas/consultar'");
const fonte = api.slice(inicio, fim);
assert.match(fonte, /CAUSAS_SUBCAUSAS/);
assert.match(fonte, /_pendenciasDados/);
assert.match(fonte, /tratamentosElegiveis/);
assert.match(fonte, /PENDENTE_VALIDACAO/);
assert.doesNotMatch(fonte, /tratamentosValidos\)\s*:/, 'a listagem não pode ocultar tratamentos incompletos');
assert.match(api.slice(api.indexOf("app.get('/api/causas'"), api.indexOf("app.post('/api/causas'")), /lerCatalogoCausas/);

console.log('Matriz operacional: contratos legados, pendências visíveis e fallback de causas aprovados.');
