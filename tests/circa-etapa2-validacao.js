'use strict';
const assert = require('node:assert/strict');
const { classificacaoTipos, alertaProduto, slaOperacional, filtrarColetas } = require('../server-services/etapa2Validacao');
const relato = 'Atraso de três dias na entrega e 1.200 potes plásticos com dificuldade de encaixe das tampas.';
const resultado = classificacaoTipos(relato, [
  { ID_TIPO: 'CONVERSAO', TIPO: 'Outras não conformidades de conversão', PALAVRAS_CHAVE: 'sem aba, embalagens coladas', ATIVO: 'SIM' },
  { ID_TIPO: 'ATRASO', TIPO: 'Atraso logístico', PALAVRAS_CHAVE: 'atraso, entrega, prazo', ATIVO: 'SIM' },
]);
assert.equal(resultado.escolhido.tipoID, 'ATRASO');
assert.equal(resultado.escolhido.origem, 'TIPOS_RECLAMACAO');
assert.equal(alertaProduto('sacola', relato).requerValidacaoHumana, true);
assert.deepEqual(slaOperacional(48), { triagemSAC: 24, retornoSetor: 72, retornoCliente: 96, procedimento: 48 });
assert.deepEqual(filtrarColetas([{ descricao: 'Solicitar NF e lote' }, { descricao: 'Solicitar fotos' }, { descricao: 'Verificar rastreamento' }], { NFE: '987654', LOTE: '123456', ANEXOS: '2 arquivos' }).map(a => a.descricao), ['Verificar rastreamento']);
console.log('Etapa 2: regressões aprovadas.');
