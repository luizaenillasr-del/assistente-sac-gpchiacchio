'use strict';

// CIRCA determinístico: organiza evidências e conhecimento já persistidos.
// Este módulo não chama IA, não decide fora da alçada e não grava dados.

const norm = value => String(value == null ? '' : value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

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

  const recomendacoes = [];
  if (similares.length) recomendacoes.push({ tipo: 'CASOS_SEMELHANTES', origem: 'BANCO_DE_CASOS', quantidade: similares.length, justificativa: 'Há registros históricos relacionados ao texto e à empresa da manifestação.' });
  if (tratamentos.length) recomendacoes.push({ tipo: 'TRATAMENTO', origem: 'MATRIZ_DE_TRATAMENTO', quantidade: tratamentos.length, justificativa: 'Existem tratamentos persistidos para o contexto informado; a seleção continua humana.' });
  if (!causa) recomendacoes.push({ tipo: 'EVIDENCIA_FALTANTE', origem: 'CIRCA_INVESTIGACAO', justificativa: 'A causa ainda não foi confirmada e não deve ser inferida automaticamente.' });

  return {
    versao: '1.0',
    deterministico: true,
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
    governanca: { origem: 'REGRAS_E_REGISTROS_PERSISTIDOS', exigeAprovacaoHumana: true, causaConfirmada: Boolean(causa), tratamentoValidado: tratamentos.length > 0 },
  };
}

module.exports = { analisar, missingFields };
