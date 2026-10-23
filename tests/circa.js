'use strict';

const assert = require('node:assert/strict');
const { analisar, missingFields } = require('../server-services/circaEngine');

const base = {
  ID_MANIFESTACAO: 'MAN-CIRCA-001',
  EMPRESA_RECLAMADA: 'Chiacchio Embalagens',
  CONTATO: 'Cliente teste',
  CANAL: 'PORTAL',
  DESCRICAO: 'Atraso na entrega do pedido',
  STATUS: 'ENCERRADA',
  PRIORIDADE: 'Normal',
  CAUSA_CONFIRMADA: 'Atraso logístico',
  SUBCAUSA_CONFIRMADA: 'Rota não programada',
  DEVOLUTIVA_ENVIADA: 'SIM',
  PROCEDENTE: 'SIM',
};

assert.deepEqual(missingFields(base), [], 'captura completa não deve apresentar campos ausentes');
const result = analisar({
  manifestacao: base,
  similares: [{ ID: 'H-1' }],
  tratamentos: [{ ID: 'T-1', STATUS: 'APROVADO' }],
  tratativa: { PROCEDIMENTO_USADO: 'Reprogramar entrega' },
});

assert.equal(result.deterministico, true);
assert.equal(result.etapas.captura.status, 'CONCLUIDA');
assert.equal(result.etapas.investigacao.casosSemelhantes, 1);
assert.equal(result.etapas.resolucao.autonomiaSAC, true);
assert.equal(result.etapas.conhecimento.promoverAutomaticamente, false);
assert.equal(result.governanca.exigeAprovacaoHumana, true);
assert.ok(result.recomendacoes.some(item => item.origem === 'BANCO_DE_CASOS'));

const incomplete = analisar({ manifestacao: { ID_MANIFESTACAO: 'MAN-2', DESCRICAO: 'Sem dados' } });
assert.equal(incomplete.etapas.captura.status, 'INCOMPLETA');
assert.equal(incomplete.etapas.resolucao.autonomiaSAC, false);
assert.ok(incomplete.recomendacoes.some(item => item.tipo === 'EVIDENCIA_FALTANTE'));
console.log('CIRCA: captura, investigação, resolução, governança e bloqueio de autonomia aprovados.');
