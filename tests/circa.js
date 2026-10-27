'use strict';

const assert = require('node:assert/strict');
const { analisar, missingFields } = require('../server-services/circaEngine');
const workflow = require('../server-services/circaWorkflow');

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
  EVIDENCIAS: 'Registro do setor',
  AUTORIZACAO_SAC: 'SIM',
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
assert.equal(result.analiseEstruturada.condicoesAutonomiaSAC.permitida, true);
assert.equal(result.checklist.length, 0);
assert.equal(workflow.stageForStatus('AGUARDANDO_VALIDACAO_SAC'), 5);
assert.equal(workflow.canTransition('EM_TRATAMENTO', 'AGUARDANDO_VALIDACAO_SAC'), true);
assert.equal(workflow.canTransition('FINALIZADA', 'AGUARDANDO_TRIAGEM_SAC'), false);
const tarefas = workflow.buildChecklist([{ descricao: 'Confirmar causa' }], [{ id: 'T1', chave: 'confirmar causa', descricao: 'Confirmar causa', status: 'CONCLUIDA' }]);
assert.equal(tarefas.length, 1);
assert.equal(tarefas[0].status, 'CONCLUIDA', 'reanálise preserva tarefa já executada');
assert.deepEqual(workflow.validateClosure({ status:'AGUARDANDO_ENCERRAMENTO', investigationComplete:true, validationDone:true, devolutivaDone:true }), { permitido:true, erros:[] });
assert.equal(workflow.validateClosure({ status:'AGUARDANDO_ENCERRAMENTO', investigationComplete:false, validationDone:true, devolutivaDone:true }).permitido, false);
console.log('CIRCA: captura, investigação, resolução, governança e bloqueio de autonomia aprovados.');
