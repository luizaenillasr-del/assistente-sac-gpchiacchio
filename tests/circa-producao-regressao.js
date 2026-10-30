'use strict';

// Reproduz o caso reportado em produção sem acessar Sheets, Neon, Vercel ou
// um provedor de IA. O teste cobre o contrato legado da ficha, a classificação
// de dois problemas e o estado de erro do cliente quando o prazo é excedido.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const circa = require('../server-services/circaEngine');

const relato = 'Atraso de três dias na entrega e aproximadamente 1.200 potes com dificuldade de encaixe das tampas.';
const fichaLegada = {
  EMPRESA_RECLAMADA: 'PLASCHIO',
  CLIENTE_NOME: 'Cliente de teste',
  CANAL_ORIGEM: 'TELEFONE',
  TIPO_MANIFESTACAO: 'Reclamação',
  PRODUTO: 'Potes',
  LOTE: '123',
  NFE: '3215',
  DESCRICAO_MANIFESTACAO: relato,
};

assert.deepEqual(circa.missingFields(fichaLegada), [], 'aliases persistidos não podem virar campos ausentes');
assert.deepEqual(
  circa.classificarHipoteses(fichaLegada).map(item => item.codigo),
  ['ATRASO_LOGISTICO', 'NAO_CONFORMIDADE_PRODUTO'],
  'atraso e possível não conformidade devem permanecer hipóteses distintas',
);
assert.ok(circa.classificarHipoteses(fichaLegada).every(item => item.confirmada === false));

const resultado = circa.analisar({ manifestacao: fichaLegada, categoriasDisponiveis: [{ categoria: 'Qualidade', subcategorias: ['Defeito de produto'] }], tratamentos: [] });
assert.deepEqual(resultado.analiseEstruturada.informacoesAusentes, ['CATEGORIA']);
assert.deepEqual(resultado.analiseEstruturada.procedimentosAplicaveis, [], 'sem regra válida não há procedimento recomendado');
assert.deepEqual(resultado.analiseEstruturada.setoresRecomendados, [], 'setor não pode ser inferido de palavras do relato');
assert.match(resultado.analiseEstruturada.confianca, /SEM_BASE|APOIO/);

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.match(html, /REQUEST_TIMEOUT/, 'timeout deve ser distinguido de erro HTTP');
assert.match(html, /_apiFetch\('\/api\/analise', 60000/, 'análise não pode ser abortada pelo prazo curto de 15s');
assert.match(html, /_nmAnaliseInFlight/, 'cliques concorrentes devem ser serializados');
assert.match(html, /Falha na análise · nenhuma recomendação concluída/, 'erro não pode ser apresentado como análise concluída');
assert.match(html, /const infoAusentesIA = \[/, 'campos ausentes devem combinar somente resultados canônicos');

console.log('CIRCA produção: contrato legado PLASCHIO, duas hipóteses, ausência de regra válida e estado de timeout sem falso resultado aprovados.');
