'use strict';

// CIRCA determinístico: organiza evidências e conhecimento já persistidos.
// Este módulo não chama IA, não decide fora da alçada e não grava dados.

const norm = value => String(value == null ? '' : value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const workflow = require('./circaWorkflow');

const first = (obj, keys) => {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
  }
  return '';
};

function missingFields(manifestacao) {
  const fields = [
    ['empresa', ['EMPRESA_RECLAMADA', 'EMPRESA']],
    ['cliente', ['CONTATO', 'CLIENTE', 'CLIENTE_NOME']],
    ['descricao', ['DESCRICAO', 'DESCRIÇÃO', 'ORIG_DESCRICAO_RECLAMACAO']],
    ['canal', ['CANAL', 'ORIG_CANAL']],
  ];
  return fields.filter(([, keys]) => !first(manifestacao, keys)).map(([name]) => name);
}

function analisar(input = {}) {
  const m = input.manifestacao || {};
  const similares = Array.isArray(input.similares) ? input.similares : [];
  const tratamentos = Array.isArray(input.tratamentos) ? input.tratamentos : [];
  const causas = Array.isArray(input.causas) ? input.causas : [];
  const tratativa = input.tratativa || {};
  const devolutiva = input.devolutiva || {};
  const status = norm(m.STATUS);
  const encerrada = ['encerrada', 'fechada', 'finalizada', 'resolvida'].includes(status);
  const faltantes = missingFields(m);
  const causa = first(m, ['CAUSA_CONFIRMADA', 'CAUSA_RAIZ', 'CAUSA']);
  const subcausa = first(m, ['SUBCAUSA_CONFIRMADA', 'SUBCAUSA']);
  const procedimento = first(tratativa, ['PROCEDIMENTO', 'PROCEDIMENTO_USADO', 'TRATAMENTO']);
  const devolutivaEnviada = Boolean(first(m, ['DEVOLUTIVA_ENVIADA', 'DATA_DEVOLUTIVA']) || first(devolutiva, ['DATA_ENVIO', 'ENVIADA_EM']));
  const procedencia = first(m, ['PROCEDENTE', 'PROCEDENCIA']);
  const autonomia = !faltantes.length && Boolean(causa || subcausa) && Boolean(procedimento || first(m, ['TRATATIVA_REALIZADA'])) && !['critica', 'alta'].includes(norm(m.PRIORIDADE)) && !m.FORA_ALCADA;
  const procedures = tratamentos.filter(t => norm(t.STATUS || 'APROVADO') === 'aprovado' || !t.STATUS);
  // Enriquecer hipóteses com causas da aba CAUSAS que coincidam com texto da manifestação
  const descNorm = norm(first(m, ['DESCRICAO','DESCRIÇÃO','ORIG_DESCRICAO_RECLAMACAO']) || '');
  const causasMatriz = causas
    .filter(c => {
      const ativo = String(c.ATIVO || 'SIM').toUpperCase() !== 'NAO' && String(c.ATIVO || 'SIM').toUpperCase() !== 'EXCLUIDO';
      if (!ativo || !descNorm) return false;
      const causaN = norm(c.CAUSA || '');
      const subcausaN = norm(c.SUBCAUSA || '');
      const palavras = [...causaN.split(' '), ...subcausaN.split(' ')].filter(p => p.length >= 4);
      return palavras.some(p => descNorm.includes(p));
    })
    .map(c => c.CAUSA + (c.SUBCAUSA ? ` / ${c.SUBCAUSA}` : ''))
    .filter(Boolean)
    .slice(0, 3);
  const hypotheses = workflow.normalizeList([causa, subcausa, ...causasMatriz].filter(Boolean));
  const checklist = workflow.buildChecklist([
    ...faltantes.map(field => ({ descricao: `Completar informação: ${field}`, obrigatoria: true, origem: 'CIRCA_CAPTURA' })),
    ...(!causa ? [{ descricao: 'Confirmar causa com evidência', obrigatoria: true, origem: 'CIRCA_INVESTIGACAO' }] : []),
    ...(!procedimento ? [{ descricao: 'Selecionar procedimento validado ou justificar ausência', obrigatoria: true, origem: 'CIRCA_RESOLUCAO' }] : []),
  ], input.checklist || []);

  const recomendacoes = [];
  if (similares.length) recomendacoes.push({ tipo: 'CASOS_SEMELHANTES', origem: 'BANCO_DE_CASOS', quantidade: similares.length, justificativa: 'Há registros históricos relacionados ao texto e à empresa da manifestação.' });
  if (tratamentos.length) recomendacoes.push({ tipo: 'TRATAMENTO', origem: 'MATRIZ_DE_TRATAMENTO', quantidade: tratamentos.length, justificativa: 'Existem tratamentos persistidos para o contexto informado; a seleção continua humana.' });
  if (!causa) recomendacoes.push({ tipo: 'EVIDENCIA_FALTANTE', origem: 'CIRCA_INVESTIGACAO', justificativa: 'A causa ainda não foi confirmada e não deve ser inferida automaticamente.' });

  return {
    versao: '1.0',
    deterministico: true,
    statusOperacional: workflow.normalizeStatus(m.STATUS),
    etapaAtual: workflow.stageForStatus(m.STATUS),
    idManifestacao: first(m, ['ID_MANIFESTACAO', 'id']),
    empresa: first(m, ['EMPRESA_RECLAMADA', 'EMPRESA']),
    etapas: {
      captura: { status: faltantes.length ? 'INCOMPLETA' : 'CONCLUIDA', faltantes },
      investigacao: { status: causa || similares.length ? 'EM_ANDAMENTO' : 'PENDENTE', casosSemelhantes: similares.length, causa, subcausa, evidencias: first(m, ['EVIDENCIAS', 'ANEXOS']) || '' },
      resolucao: { status: procedimento || first(m, ['TRATATIVA_REALIZADA']) ? 'DISPONIVEL' : 'PENDENTE', procedimento, devolutivaEnviada, autonomiaSAC: autonomia },
      conhecimento: { status: encerrada ? 'ELEGIVEL_PARA_VALIDACAO' : 'AGUARDANDO_ENCERRAMENTO', promoverAutomaticamente: false, procedencia },
      aprimoramento: { status: encerrada && (!causa || !procedimento) ? 'NECESSITA_REVISAO' : 'AGUARDANDO_RESULTADO', eficacia: first(m, ['EFICACIA_TRATAMENTO', 'RESULTADO']) || '' },
    },
    recomendacoes,
    analiseEstruturada: {
      classificacaoPreliminar: first(m, ['TIPO_CONFIRMADO', 'TIPO_SUGERIDO', 'TIPO', 'CATEGORIA']),
      prioridade: first(m, ['PRIORIDADE']) || 'Normal',
      justificativaRisco: first(m, ['GRAVIDADE', 'RISCO_JUSTIFICATIVA']),
      hipotesesCausa: hypotheses,
      informacoesAusentes: faltantes,
      perguntasRecomendadas: faltantes.map(field => `Informe ${field}.`),
      acoesSugeridas: procedures.map(t => first(t, ['PROCEDIMENTO', 'NOME', 'TRATAMENTO'])).filter(Boolean),
      procedimentosAplicaveis: procedures.map(t => first(t, ['ID_TRATAMENTO', 'ID_PROC', 'NOME', 'PROCEDIMENTO'])).filter(Boolean),
      casosSemelhantes: similares.map(item => first(item, ['ID_MANIFESTACAO', 'ID', 'PROTOCOLO'])).filter(Boolean),
      setoresRecomendados: workflow.normalizeList(first(m, ['SETORES_SUGERIDOS', 'SETOR_SUGERIDO'])),
      responsaveisElegiveis: workflow.normalizeList(first(m, ['RESPONSAVEIS_ELEGIVEIS'])),
      condicoesAutonomiaSAC: workflow.autonomia({ procedimentoValidado: procedures.length > 0, compatibilidade: Boolean(causa || subcausa), evidencias: Boolean(first(m, ['EVIDENCIAS', 'ANEXOS'])), risco: !['critica', 'alta'].includes(norm(m.PRIORIDADE)), alçada: !m.FORA_ALCADA, autorizacao: Boolean(m.AUTORIZACAO_SAC || m.STATUS === 'EM TRATAMENTO'), historico: Boolean(first(m, ['ID_MANIFESTACAO'])) }),
      evidenciasNecessarias: faltantes.length ? ['Evidência documental ou registro do setor responsável'] : [],
      origemRecomendacoes: 'REGRAS_E_REGISTROS_PERSISTIDOS',
      confianca: procedures.length || similares.length ? 'APOIO_HISTORICO' : 'SEM_BASE_SUFICIENTE',
    },
    checklist,
    governanca: { origem: 'REGRAS_E_REGISTROS_PERSISTIDOS', exigeAprovacaoHumana: true, causaConfirmada: Boolean(causa), tratamentoValidado: procedures.length > 0, publicarAutomaticamente: false, encerrarAutomaticamente: false },
  };
}

module.exports = { analisar, missingFields };
