'use strict';

// CIRCA determinístico: organiza evidências e conhecimento já persistidos.
// Este módulo não chama IA, não decide fora da alçada e não grava dados.

const norm = value => String(value == null ? '' : value)
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const workflow = require('./circaWorkflow');
const { alertaProduto } = require('./etapa2Validacao');

const first = (obj, keys) => {
  for (const key of keys) {
    if (obj && obj[key] != null && String(obj[key]).trim() !== '') return obj[key];
  }
  return '';
};

// Os registros chegam de três contratos (formulário, Sheets e ficha). A
// análise não deve depender da capitalização ou do nome histórico da coluna.
const FIELD_ALIASES = {
  empresa: ['EMPRESA_RECLAMADA', 'EMPRESA', 'empresaReclamada', 'empresa', 'ORIG_EMPRESA', 'ORIG_EMPRESA_RECLAMADA'],
  cliente: ['CONTATO', 'CLIENTE', 'CLIENTE_NOME', 'contato', 'cliente', 'empresaReclamante', 'EMPRESA_RECLAMANTE', 'ORIG_CONTATO', 'NOME_CONTATO'],
  descricao: [
    'DESCRICAO', 'DESCRIÇÃO', 'descricao', 'DESCRICAO_MANIFESTACAO',
    'DESCRICAO_RECLAMACAO', 'ORIG_DESCRICAO_RECLAMACAO', 'RELATO_ORIGINAL',
    'RELATO_CLIENTE', 'relato', 'RELATO', 'MENSAGEM',
  ],
  canal: [
    'CANAL', 'canal', 'CANAL_ORIGEM', 'ORIGEM_CANAL', 'ORIG_CANAL',
    'CANAL_RECEBIMENTO', 'MEIO_CONTATO', 'TIPO_CANAL', 'origem', 'ORIGEM',
  ],
};

function normalizarManifestacao(manifestacao = {}) {
  const m = { ...manifestacao };
  for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
    const value = first(manifestacao, aliases);
    if (value !== '') {
      const target = canonical === 'empresa' ? 'EMPRESA_RECLAMADA'
        : canonical === 'cliente' ? 'CONTATO'
        : canonical === 'descricao' ? 'DESCRICAO' : 'CANAL';
      if (!first(m, [target])) m[target] = value;
    }
  }
  return m;
}

function missingFields(manifestacao) {
  const fields = Object.entries(FIELD_ALIASES);
  return fields.filter(([, keys]) => !first(manifestacao, keys)).map(([name]) => name);
}

/**
 * Reconhece problemas distintos somente como hipóteses de classificação. A
 * confirmação continua dependente da investigação e de uma causa cadastrada.
 */
function classificarHipoteses(manifestacao = {}) {
  const descricao = norm(first(manifestacao, FIELD_ALIASES.descricao));
  const result = [];
  if (/\b(atras|entreg|prazo|logistic|pedido)\w*/.test(descricao)) {
    result.push({ codigo: 'ATRASO_LOGISTICO', descricao: 'Possível atraso logístico na entrega', origem: 'RELATO', confirmada: false });
  }
  if (/(tamp|encaix|pote|produto|defeit|nao conform|conformidade)/.test(descricao)) {
    result.push({ codigo: 'NAO_CONFORMIDADE_PRODUTO', descricao: 'Possível não conformidade do produto ou do encaixe', origem: 'RELATO', confirmada: false });
  }
  return result;
}

function analisar(input = {}) {
  const m = normalizarManifestacao(input.manifestacao || {});
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
  const criterioBate = (esperado, encontrado) => {
    if (!String(esperado || '').trim()) return true;
    if (!String(encontrado || '').trim()) return false;
    const e = norm(esperado); const v = norm(encontrado);
    return e.split('|').some(item => item === '*' || v.includes(item.trim()));
  };
  const tratamentoCompativel = t => {
    const campos = [
      ['EMPRESA', first(t, ['EMPRESA','EMPRESA_RECLAMADA']), first(m, ['EMPRESA_RECLAMADA','EMPRESA'])],
      ['TIPO_MANIFESTACAO', first(t, ['TIPO_MANIFESTACAO','TIPO']), first(m, ['TIPO','TIPO_MANIFESTACAO'])],
      ['CATEGORIA', first(t, ['CATEGORIA']), first(m, ['CATEGORIA'])],
      ['SUBCATEGORIA', first(t, ['SUBCATEGORIA','SUBCAUSA']), first(m, ['SUBCATEGORIA','SUBCAUSA'])],
      ['SETOR_RESPONSAVEL', first(t, ['SETOR_RESPONSAVEL','SETOR']), first(m, ['SETOR_SUGERIDO','SETOR'])],
    ];
    // Critérios ainda não informados na ficha ficam pendentes para triagem;
    // não são tratados como conflito. Todo critério que já possui valor,
    // porém, precisa corresponder e ao menos um critério concreto deve existir.
    const comparaveis = campos.filter(([, esperado, encontrado]) => String(esperado || '').trim() && String(encontrado || '').trim());
    return comparaveis.length > 0 && comparaveis.every(([, esperado, encontrado]) => criterioBate(esperado, encontrado));
  };
  const procedures = tratamentos.filter(t => {
    const status = norm(t.STATUS || t.ATIVO);
    const id = first(t, ['ID_TRATAMENTO', 'ID_REGRA', 'ID_PROC', 'ID']);
    // A validação estrutural da Matriz ocorre antes deste módulo. Aqui
    // mantemos compatibilidade com registros já normalizados pelo endpoint;
    // somente itens explicitamente aprovados/ativos e identificados entram.
    return ['aprovado', 'publicada', 'ativo', 'sim'].includes(status) && Boolean(id) && tratamentoCompativel(t);
  });
  // Enriquecer hipóteses com causas da aba CAUSAS que coincidam com texto da manifestação
  const descNorm = norm(first(m, ['DESCRICAO','DESCRIÇÃO','ORIG_DESCRICAO_RECLAMACAO']) || '');
  const causasMatriz = causas
    .filter(c => {
      const ativo = !['NAO', 'NÃO', 'EXCLUIDO', 'EXCLUÍDO', 'INATIVO', 'RASCUNHO'].includes(String(c.ATIVO || '').toUpperCase()) &&
        !['NAO', 'NÃO', 'EXCLUIDO', 'EXCLUÍDO', 'INATIVO', 'RASCUNHO'].includes(String(c.STATUS || c.STATUS_VALIDACAO || '').toUpperCase());
      if (!ativo || !descNorm) return false;
      if (!first(c, ['ID_CAUSA', 'ID', 'CODIGO'])) return false;
      const causaN = norm(first(c, ['CAUSA', 'DESCRICAO']));
      const subcausaN = norm(first(c, ['SUBCAUSA', 'SUBCAUSA_DESCRICAO']));
      const palavras = [...causaN.split(' '), ...subcausaN.split(' ')].filter(p => p.length >= 4);
      return palavras.some(p => descNorm.includes(p));
    })
    .map(c => first(c, ['CAUSA', 'DESCRICAO']) + (first(c, ['SUBCAUSA', 'SUBCAUSA_DESCRICAO']) ? ` / ${first(c, ['SUBCAUSA', 'SUBCAUSA_DESCRICAO'])}` : ''))
    .filter(Boolean)
    .slice(0, 3);
  const hypotheses = workflow.normalizeList([causa, subcausa, ...causasMatriz].filter(Boolean));
  const hipotesesClassificacao = classificarHipoteses(m);
  const alertaProdutoManifestacao = alertaProduto(first(m, ['PRODUTO','produto']), first(m, FIELD_ALIASES.descricao));
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
    hipotesesClassificacao,
    analiseEstruturada: {
      classificacaoPreliminar: first(m, ['TIPO_CONFIRMADO', 'TIPO_SUGERIDO', 'TIPO', 'CATEGORIA']) || (hipotesesClassificacao.length ? 'Não identificado' : ''),
      classificacaoStatus: first(m, ['TIPO_CONFIRMADO']) ? 'CONFIRMADA' : (hipotesesClassificacao.length ? 'PENDENTE_VALIDACAO' : 'NAO_IDENTIFICADA'),
      prioridade: first(m, ['PRIORIDADE']) || 'Normal',
      justificativaRisco: first(m, ['GRAVIDADE', 'RISCO_JUSTIFICATIVA']),
      hipotesesCausa: hypotheses,
      hipotesesClassificacao,
      informacoesAusentes: faltantes,
      perguntasRecomendadas: faltantes.map(field => `Informe ${field}.`),
      acoesSugeridas: procedures.map(t => first(t, ['PROCEDIMENTO', 'NOME', 'TRATAMENTO'])).filter(Boolean),
      procedimentosAplicaveis: procedures.map(t => first(t, ['ID_TRATAMENTO', 'ID_PROC', 'NOME', 'PROCEDIMENTO'])).filter(Boolean),
      casosSemelhantes: similares.map(item => first(item, ['ID_MANIFESTACAO', 'ID', 'PROTOCOLO'])).filter(Boolean),
      setoresRecomendados: workflow.normalizeList(first(m, ['SETORES_SUGERIDOS', 'SETOR_SUGERIDO'])),
      responsaveisElegiveis: workflow.normalizeList(first(m, ['RESPONSAVEIS_ELEGIVEIS'])),
      // Autonomia mede a tratativa efetivamente registrada, não a existência
      // de uma recomendação automática da Matriz.
      condicoesAutonomiaSAC: workflow.autonomia({ procedimentoValidado: Boolean(procedimento || first(m, ['TRATATIVA_REALIZADA'])), compatibilidade: Boolean(causa || subcausa), evidencias: Boolean(first(m, ['EVIDENCIAS', 'ANEXOS'])), risco: !['critica', 'alta'].includes(norm(m.PRIORIDADE)), alçada: !m.FORA_ALCADA, autorizacao: Boolean(m.AUTORIZACAO_SAC || m.STATUS === 'EM TRATAMENTO'), historico: Boolean(first(m, ['ID_MANIFESTACAO'])) }),
      evidenciasNecessarias: faltantes.length ? ['Evidência documental ou registro do setor responsável'] : [],
      origemRecomendacoes: 'REGRAS_E_REGISTROS_PERSISTIDOS',
      confianca: procedures.length || similares.length ? 'APOIO_HISTORICO' : 'SEM_BASE_SUFICIENTE',
      alertaProduto: alertaProdutoManifestacao,
    },
    checklist,
    governanca: { origem: 'REGRAS_E_REGISTROS_PERSISTIDOS', exigeAprovacaoHumana: true, causaConfirmada: Boolean(causa), tratamentoValidado: procedures.length > 0, publicarAutomaticamente: false, encerrarAutomaticamente: false },
  };
}

module.exports = { analisar, missingFields, classificarHipoteses, normalizarManifestacao };
