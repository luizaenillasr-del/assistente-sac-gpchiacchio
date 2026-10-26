'use strict';

const assert = require('assert');
const fs = require('fs');

const html = fs.readFileSync('public/index.html', 'utf8');

assert.ok(html.includes('data-nm-step="1"'), 'etapa 1 deve existir');
assert.ok(html.includes('data-nm-step="7"'), 'etapa 7 deve existir');
assert.ok(html.includes('id="nm-btn-continuar"'), 'botão Continuar deve existir');
assert.ok(html.includes('onclick="nmProximaEtapa()"'), 'Continuar deve usar a navegação CIRCA');
assert.ok(html.includes('salvarRascunho({silent:true})'), 'avanço deve aguardar o salvamento do rascunho');
assert.ok(html.includes("nmSetCaminhoTratativa('COMPLEMENTO',this)"), 'a solicitação de complementação deve ter caminho próprio');
assert.ok(html.includes("caminho==='COMPLEMENTO' && !val('nm-complemento-pedido')"), 'o caminho de complementação deve validar o pedido');
assert.ok(html.includes("caminho==='SETOR'"), 'o encaminhamento ao setor deve validar o escopo');
assert.ok(!html.includes('Decisão da Analista</div>'), 'card legado de decisão não deve ser renderizado');
assert.ok(!html.includes('onclick="rejeitarAnalise()"'), 'ação legada de rejeição não deve ser renderizada');
assert.ok(!html.includes('onclick="editarAnalise()"'), 'ação legada de ajuste não deve ser renderizada');
assert.ok(!html.includes('onclick="aceitarAnalise()"'), 'ação legada de aceite não deve ser renderizada');
assert.ok(html.includes('Não calculada'), 'confiança sem cálculo real deve ser identificada');
assert.ok(html.includes('Setor: ${esc(x)}'), 'setores devem ser exibidos como itens normalizados');
assert.ok(html.includes('Responsável: ${esc(x)}'), 'responsáveis devem ser separados dos setores');
assert.ok(!html.includes('Deseja registrar sem decisão?'), 'o envio não deve ser bloqueado pelo fluxo decisório antigo');
assert.ok(!html.includes('body.decisaoCompleta = window._nmDecisaoPayload'), 'o fluxo antigo não deve modificar o payload do registro');

console.log('Nova manifestação v4: fluxo de sete etapas, avanço com persistência e remoção dos controles legados aprovados.');
