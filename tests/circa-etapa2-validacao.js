'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
assert.deepEqual(filtrarColetas([{ descricao: 'Solicitar NF e confirmar endereço' }, { descricao: 'Solicitar fotos' }, { descricao: 'Verificar rastreamento' }], { NFE: '987654', ANEXOS: '2 arquivos' }).map(a => a.descricao), ['confirmar endereço', 'Verificar rastreamento']);
const api = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8');
const ui = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.match(api, /CHECKLIST_CIRCA/);
assert.match(api, /PENDENCIAS_VALIDACAO_HUMANA/);
assert.match(ui, /nmSalvarChecklist/);
assert.match(ui, /Validação humana pendente/);
console.log('Etapa 2: regressões aprovadas.');
