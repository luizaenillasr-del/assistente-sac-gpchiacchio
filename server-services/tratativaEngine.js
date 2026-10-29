'use strict';
// ================================================================
// MOTOR DE TRATATIVAS — v1.0
// Recebe manifestação + contexto completo, aplica Matriz de
// Tratamento, gera tratativa estruturada com ações tipadas e
// salva no Google Sheets.
// ================================================================

const sheets = require('./sheets');
const matrizService = require('./matrizTratamentoService');
const { filtrarColetas } = require('./etapa2Validacao');

const CABECALHOS_TRATATIVAS = [
  'ID_TRATATIVA','ID_MANIFESTACAO','DATA_CRIACAO','PROBLEMA','CATEGORIA',
  'SUBCATEGORIA','PROCEDENCIA','ORIGEM_PROBLEMA','RESPONSABILIDADE',
  'RISCO','REINCIDENCIA','SETOR_RESPONSAVEL','RESPONSAVEL','PRAZO',
  'STATUS','NECESSITA_APROVACAO','NECESSITA_EVIDENCIA','NECESSITA_ANALISE_TECNICA',
  'NECESSITA_RNC','NECESSITA_ESCALONAMENTO','APROVADO_POR','DATA_APROVACAO',
  'CRIADO_POR','ID_TRATAMENTO_MATRIZ','VERSAO_CEREBRO','ORIGEM_REGRA',
  'CAUSA_STATUS','CONFIANCA',
];

const CABECALHOS_ACOES = [
  'ID_ACAO','ID_MANIFESTACAO','ID_TRATATIVA','TIPO_ACAO','DESCRICAO',
  'RESPONSAVEL','SETOR','PRAZO','STATUS','DATA_CRIACAO',
  'DATA_CONCLUSAO','EVIDENCIA','OBSERVACAO','CRIADO_POR','CONCLUIDO_POR',
];

const CABECALHOS_HISTORICO = [
  'ID_REGISTRO','ID_TRATATIVA','ID_MANIFESTACAO','EVENTO','USUARIO',
  'DATA','VERSAO_CEREBRO','VERSAO_POLITICAS','VERSAO_MATRIZ',
  'REGRAS_CONSULTADAS','CASOS_SIMILARES_IDS','SLA_STATUS','CALCULO_ATRASO',
  'RECOMENDACAO_GERADA','IA_MODELO','IA_TOKENS','DECISAO_HUMANA',
  'ALTERACOES','RESULTADO_FINAL','OBSERVACAO',
];

const STATUS_ACAO = {
  PENDENTE: 'PENDENTE',
  EM_ANDAMENTO: 'EM_ANDAMENTO',
  AGUARDANDO_SETOR: 'AGUARDANDO_SETOR',
  AGUARDANDO_CLIENTE: 'AGUARDANDO_CLIENTE',
  AGUARDANDO_APROVACAO: 'AGUARDANDO_APROVACAO',
  CONCLUIDA: 'CONCLUIDA',
  CANCELADA: 'CANCELADA',
  REABERTA: 'REABERTA',
};

// ─── Calculadora de Atraso ──────────────────────────────────────
const CADEIA_ENTREGA_PADRAO = [
  'PEDIDO','COMERCIAL','PRODUCAO','QUALIDADE','SEPARACAO','EXPEDICAO','TRANSPORTADORA','ENTREGA',
];

async function calcularAtraso(manifestacao) {
  const descricao = String(manifestacao.DESCRICAO || manifestacao.descricao || '').toLowerCase();
  const palavrasAtraso = ['atras','prazo','demor','não chegou','nao chegou','entrega','quando','chegar'];
  if (!palavrasAtraso.some(p => descricao.includes(p))) return null;

  // Tentar ler cadeia configurável
  let cadeia = [...CADEIA_ENTREGA_PADRAO];
  try {
    const params = await sheets.lerAba('PARAMETROS_LOGISTICA', 100).catch(() => []);
    const cadeiaCfg = params.find(r => (r.PARAMETRO || '').toUpperCase() === 'CADEIA_ENTREGA');
    if (cadeiaCfg?.VALOR) cadeia = cadeiaCfg.VALOR.split('|').map(s => s.trim());
  } catch (e) { console.warn('[TratativaEngine] Falha ao ler PARAMETROS_LOGISTICA:', e.message); }

  // Diagnóstico básico por palavras-chave
  let etapaDesviada = null;
  let origem = 'NAO_IDENTIFICADA';

  if (descricao.includes('transport') || descricao.includes('motorist') || descricao.includes('entregador')) {
    etapaDesviada = 'TRANSPORTADORA'; origem = 'TRANSPORTADORA';
  } else if (descricao.includes('expedi') || descricao.includes('separacao') || descricao.includes('separação')) {
    etapaDesviada = 'EXPEDICAO'; origem = 'EXPEDICAO';
  } else if (descricao.includes('produc') || descricao.includes('produção') || descricao.includes('fabricac')) {
    etapaDesviada = 'PRODUCAO'; origem = 'PRODUCAO';
  } else if (descricao.includes('comerci') || descricao.includes('pedido')) {
    etapaDesviada = 'COMERCIAL'; origem = 'COMERCIAL';
  }

  const dataPedido = manifestacao.DATA_PEDIDO || manifestacao.DATA_ABERTURA;
  const dataEntregaPrevista = manifestacao.DATA_ENTREGA_PREVISTA;
  let diasAtraso = null;
  if (dataPedido && dataEntregaPrevista) {
    const hoje = new Date();
    const prev = new Date(dataEntregaPrevista);
    if (!isNaN(prev) && hoje > prev) {
      diasAtraso = Math.floor((hoje - prev) / 86400000);
    }
  }

  return {
    houveAtraso: true,
    diasAtraso,
    etapaDesviada,
    origemPrimaria: origem,
    cadeia,
    responsabilidade: origem !== 'NAO_IDENTIFICADA' ? origem : 'EM_APURACAO',
    causaStatus: 'HIPOTESE',
    novoPrazo: 'A CONFIRMAR',
    eventosPausaSLA: [],
  };
}

// ─── Montar ações a partir da Matriz + motivo ───────────────────
function montarAcoes(regras, ctx, atrasoInfo) {
  const acoes = [];
  const agora = new Date().toISOString();
  const prazo = regras.prazo || null;

  const addAcao = (tipo, descricao, extra = {}) => {
    // Não adicionar ações proibidas
    if (regras.acoesProibidas?.some(p => descricao.toLowerCase().includes(p.toLowerCase().slice(0, 20)))) return;
    acoes.push({ tipo, descricao, responsavel: extra.responsavel || regras.responsavel || '', setor: extra.setor || regras.setorResponsavel || '', prazo: extra.prazo || prazo || 'Conforme SLA aplicável', status: extra.status || STATUS_ACAO.PENDENTE, evidenciaNecessaria: tipo === 'OBRIGATORIA' && regras.necessitaEvidencia });
  };

  // Ações obrigatórias da Matriz / defaults
  (regras.acoesObrigatorias || []).forEach(a => addAcao('OBRIGATORIA', a));
  (regras.acoesRecomendadas || []).forEach(a => addAcao('RECOMENDADA', a));
  (regras.acoesCondicionais || []).forEach(a => addAcao('CONDICIONAL', a, { prazo: 'CONDICIONAL' }));

  // Ações adicionais por diagnóstico de atraso
  if (atrasoInfo?.houveAtraso) {
    if (!acoes.some(a => a.descricao.toLowerCase().includes('rastrea'))) {
      addAcao('OBRIGATORIA', 'Verificar rastreamento e identificar etapa do atraso', { setor: atrasoInfo.etapaDesviada || 'Logística' });
    }
    addAcao('OBRIGATORIA', 'Confirmar novo prazo de entrega e comunicar ao cliente', { prazo: '24h' });
  }

  // Análise técnica se necessário
  if (regras.necessitaAnaliseTecnica && !acoes.some(a => a.descricao.toLowerCase().includes('análise técnica'))) {
    addAcao('OBRIGATORIA', 'Encaminhar para análise técnica do setor de Qualidade');
  }

  // RNC
  if (regras.necessitaRNC && !acoes.some(a => a.descricao.toLowerCase().includes('rnc'))) {
    addAcao('OBRIGATORIA', 'Abrir RNC no sistema de não conformidades');
  }

  // Escalonamento
  if (regras.necessitaEscalonamento || ctx.reincidente) {
    addAcao('CONDICIONAL', 'Escalar para supervisão/gerência dado histórico de reincidência ou criticidade', { prazo: '4h' });
  }

  // Aprovação
  if (regras.necessitaAprovacao) {
    addAcao('OBRIGATORIA', `Aguardar aprovação de ${regras.quemAprova || 'responsável'} antes de prosseguir`, { status: STATUS_ACAO.AGUARDANDO_APROVACAO });
  }

  return acoes;
}

// ─── Gerador de ID para tratativa ──────────────────────────────
async function gerarIdTratativa() {
  return sheets.gerarProximoID('TRATATIVAS', 'TRAT', 'ID_TRATATIVA');
}

async function gerarIdAcao() {
  return sheets.gerarProximoID('TRATATIVAS_ACOES', 'ACAO', 'ID_ACAO');
}

// ─── Diagnosticar causa ─────────────────────────────────────────
function diagnosticarCausa(manifestacao, casosSimilares, iaResultado) {
  // Status da causa: NAO_IDENTIFICADA | HIPOTESE | EM_INVESTIGACAO | CONFIRMADA | DESCARTADA
  const causaIA = iaResultado?.causaProvavel;
  const causaSim = casosSimilares?.[0]?.causa;

  if (!causaIA && !causaSim) return { status: 'NAO_IDENTIFICADA', causa: null };
  if (causaIA && causaIA !== 'DADO_NAO_ENCONTRADO') return { status: 'HIPOTESE', causa: causaIA };
  if (causaSim) return { status: 'HIPOTESE', causa: causaSim };
  return { status: 'NAO_IDENTIFICADA', causa: null };
}

// ─── Motor principal ────────────────────────────────────────────
async function gerarTratativaEstruturada(params) {
  const {
    manifestacao,
    classificacao,
    empresa,
    cliente,
    setor,
    prioridade,
    casosSimilares = [],
    reincidencia = {},
    sla = {},
    iaResultado = {},
    usuario = 'sistema',
    versaoCerebro = '2.0.0',
  } = params;

  const inicio = Date.now();

  // 1. Calculadora de Atraso
  const atrasoInfo = await calcularAtraso(manifestacao).catch(() => null);

  // 2. Contexto para Matriz
  const ctx = {
    empresa: empresa || manifestacao.EMPRESA_RECLAMADA || '',
    tipo: classificacao || '',
    categoria: iaResultado?.classificacao || classificacao || '',
    subcategoria: manifestacao.SUBCATEGORIA || manifestacao.subcategoria || '',
    causa: iaResultado?.causaProvavel || manifestacao.CAUSA_RAIZ_CONFIRMADA || manifestacao.CAUSA_RAIZ || '',
    subcausa: manifestacao.SUBCAUSA_CONFIRMADA || manifestacao.SUBCAUSA || '',
    setor: setor || 'SAC',
    prioridade: prioridade || 'Média',
    reincidente: reincidencia?.detectada || false,
    atraso: !!atrasoInfo?.houveAtraso,
  };

  // 3. Consultar Matriz de Tratamento
  const regras = await matrizService.obterRegras(ctx).catch(() => matrizService.regrasDefault(ctx));

  // 4. Diagnóstico de causa
  const diagCausa = diagnosticarCausa(manifestacao, casosSimilares, iaResultado);

  // 5. Montar ações estruturadas
  const acoes = filtrarColetas(montarAcoes(regras, ctx, atrasoInfo), manifestacao);

  // 6. Verificar conflito entre regras, IA e histórico
  const conflitos = [];
  if (iaResultado?.setorSugerido && regras.setorResponsavel &&
      !iaResultado.setorSugerido.toLowerCase().includes(regras.setorResponsavel.toLowerCase().split(' ')[0])) {
    conflitos.push({
      tipo: 'CONFLITO_SETOR',
      fonteA: { origem: 'IA', valor: iaResultado.setorSugerido },
      fonteB: { origem: regras.origem, valor: regras.setorResponsavel },
      impacto: 'Encaminhamento pode divergir — revisão humana necessária',
      necessitaDecisaoHumana: true,
    });
  }

  const tratativa = {
    diagnostico: {
      problema: String(manifestacao.DESCRICAO || manifestacao.descricao || '').slice(0, 500),
      categoria: ctx.categoria,
      subcategoria: ctx.subcategoria,
      procedencia: 'EM_APURACAO',
      origem: empresa || 'Não identificada',
      responsabilidade: diagCausa.status === 'CONFIRMADA' ? 'IDENTIFICADA' : 'EM_APURACAO',
      risco: regras.risco || 'MÉDIO',
      reincidencia: reincidencia?.detectada || false,
      reincidenciaNivel: reincidencia?.nivel || 'SEM_REINCIDENCIA',
      causa: diagCausa,
      atraso: atrasoInfo,
    },
    regras: {
      idTratamento: regras.idTratamento,
      rastreabilidade: regras.rastreabilidade || null,
      idRegra: regras.idRegra || null,
      origem: regras.origem,
      score: regras.score,
    },
    acoes,
    escalonamento: {
      necessario: regras.necessitaEscalonamento || (reincidencia?.nivel === 'REINCIDENCIA_CONFIRMADA'),
      responsavel: regras.quemAprova || null,
    },
    aprovacao: {
      necessaria: regras.necessitaAprovacao,
      responsavel: regras.quemAprova || null,
    },
    setor: regras.setorResponsavel,
    responsavel: regras.responsavel,
    prazo: regras.prazo,
    prioridade: regras.prioridade,
    necessitaEvidencia: regras.necessitaEvidencia,
    necessitaAnaliseTecnica: regras.necessitaAnaliseTecnica,
    necessitaRNC: regras.necessitaRNC,
    informacoesPermitidas: regras.informacoesPermitidas,
    informacoesProibidas: regras.informacoesProibidas,
    modeloDevolutiva: regras.modeloDevolutiva,
    conflitos,
    confianca: (regras.idTratamento || regras.idRegra) ? 80 : 45,
    tempoMs: Date.now() - inicio,
    geradaEm: new Date().toISOString(),
  };

  return tratativa;
}

// ─── Salvar Tratativa no Sheets ─────────────────────────────────
async function salvarTratativa(idManifestacao, tratativa, usuario) {
  await sheets.garantirAbaComCabecalhos('TRATATIVAS', CABECALHOS_TRATATIVAS).catch(() => {});
  await sheets.garantirAbaComCabecalhos('TRATATIVAS_ACOES', CABECALHOS_ACOES).catch(() => {});
  await sheets.garantirAbaComCabecalhos('TRATATIVAS_HISTORICO', CABECALHOS_HISTORICO).catch(() => {});

  const idTrat = await gerarIdTratativa();
  const agora = new Date().toISOString();

  await sheets.appendObjeto('TRATATIVAS', {
    ID_TRATATIVA: idTrat,
    ID_MANIFESTACAO: idManifestacao,
    DATA_CRIACAO: agora,
    PROBLEMA: tratativa.diagnostico.problema,
    CATEGORIA: tratativa.diagnostico.categoria,
    SUBCATEGORIA: tratativa.diagnostico.subcategoria,
    PROCEDENCIA: tratativa.diagnostico.procedencia,
    ORIGEM_PROBLEMA: tratativa.diagnostico.origem,
    RESPONSABILIDADE: tratativa.diagnostico.responsabilidade,
    RISCO: tratativa.diagnostico.risco,
    REINCIDENCIA: tratativa.diagnostico.reincidencia ? 'SIM' : 'NAO',
    SETOR_RESPONSAVEL: tratativa.setor,
    RESPONSAVEL: tratativa.responsavel,
    PRAZO: tratativa.prazo,
    STATUS: 'GERADA',
    NECESSITA_APROVACAO: tratativa.aprovacao.necessaria ? 'SIM' : 'NAO',
    NECESSITA_EVIDENCIA: tratativa.necessitaEvidencia ? 'SIM' : 'NAO',
    NECESSITA_ANALISE_TECNICA: tratativa.necessitaAnaliseTecnica ? 'SIM' : 'NAO',
    NECESSITA_RNC: tratativa.necessitaRNC ? 'SIM' : 'NAO',
    NECESSITA_ESCALONAMENTO: tratativa.escalonamento.necessario ? 'SIM' : 'NAO',
    APROVADO_POR: '',
    DATA_APROVACAO: '',
    CRIADO_POR: usuario,
    ID_TRATAMENTO_MATRIZ: tratativa.regras.idTratamento || '',
    VERSAO_CEREBRO: '2.0.0',
    ORIGEM_REGRA: tratativa.regras.origem || 'PADRAO',
    CAUSA_STATUS: tratativa.diagnostico.causa?.status || 'NAO_IDENTIFICADA',
    CONFIANCA: tratativa.confianca,
  }).catch(() => {});

  // Salvar ações
  for (const acao of tratativa.acoes) {
    const idAcao = await gerarIdAcao().catch(() => 'ACAO-0000');
    await sheets.appendObjeto('TRATATIVAS_ACOES', {
      ID_ACAO: idAcao,
      ID_MANIFESTACAO: idManifestacao,
      ID_TRATATIVA: idTrat,
      TIPO_ACAO: acao.tipo,
      DESCRICAO: acao.descricao,
      RESPONSAVEL: acao.responsavel,
      SETOR: acao.setor,
      PRAZO: acao.prazo,
      STATUS: acao.status || STATUS_ACAO.PENDENTE,
      DATA_CRIACAO: agora,
      DATA_CONCLUSAO: '',
      EVIDENCIA: '',
      OBSERVACAO: '',
      CRIADO_POR: usuario,
      CONCLUIDO_POR: '',
    }).catch(() => {});
  }

  // Registrar histórico de decisão
  const idHist = await sheets.gerarProximoID('TRATATIVAS_HISTORICO', 'HIST', 'ID_REGISTRO').catch(() => 'HIST-0001');
  await sheets.appendObjeto('TRATATIVAS_HISTORICO', {
    ID_REGISTRO: idHist,
    ID_TRATATIVA: idTrat,
    ID_MANIFESTACAO: idManifestacao,
    EVENTO: 'TRATATIVA_GERADA',
    USUARIO: usuario,
    DATA: agora,
    VERSAO_CEREBRO: '2.0.0',
    VERSAO_POLITICAS: '1.0',
    VERSAO_MATRIZ: '1.0',
    REGRAS_CONSULTADAS: tratativa.regras.idTratamento || tratativa.regras.idRegra || 'PADRAO',
    CASOS_SIMILARES_IDS: '',
    SLA_STATUS: '',
    CALCULO_ATRASO: tratativa.diagnostico.atraso ? JSON.stringify(tratativa.diagnostico.atraso) : '',
    RECOMENDACAO_GERADA: JSON.stringify(tratativa.acoes.map(a => a.descricao)),
    IA_MODELO: '',
    IA_TOKENS: 0,
    DECISAO_HUMANA: '',
    ALTERACOES: '',
    RESULTADO_FINAL: '',
    OBSERVACAO: `${tratativa.acoes.length} ações geradas; confiança ${tratativa.confianca}%`,
  }).catch(() => {});

  return { idTratativa: idTrat, totalAcoes: tratativa.acoes.length };
}

// ─── Atualizar decisão humana (aceitar/editar/rejeitar) ─────────
async function registrarDecisaoHumana(idManifestacao, idTratativa, decisao, dadosAlteracao, usuario) {
  const agora = new Date().toISOString();
  await sheets.atualizarPorID('TRATATIVAS', idTratativa, {
    STATUS: decisao === 'ACEITA' ? 'ACEITA' : decisao === 'REJEITADA' ? 'REJEITADA' : 'EDITADA',
    APROVADO_POR: usuario,
    DATA_APROVACAO: agora,
  }, ['ID_TRATATIVA']).catch(() => {});

  const idHist = await sheets.gerarProximoID('TRATATIVAS_HISTORICO', 'HIST', 'ID_REGISTRO').catch(() => 'HIST-0002');
  await sheets.appendObjeto('TRATATIVAS_HISTORICO', {
    ID_REGISTRO: idHist,
    ID_TRATATIVA: idTratativa,
    ID_MANIFESTACAO: idManifestacao,
    EVENTO: `DECISAO_${decisao}`,
    USUARIO: usuario,
    DATA: agora,
    VERSAO_CEREBRO: '2.0.0',
    VERSAO_POLITICAS: '1.0',
    VERSAO_MATRIZ: '1.0',
    REGRAS_CONSULTADAS: '',
    CASOS_SIMILARES_IDS: '',
    SLA_STATUS: '',
    CALCULO_ATRASO: '',
    RECOMENDACAO_GERADA: '',
    IA_MODELO: '',
    IA_TOKENS: 0,
    DECISAO_HUMANA: decisao,
    ALTERACOES: JSON.stringify(dadosAlteracao?.alteracoes || {}),
    RESULTADO_FINAL: '',
    OBSERVACAO: dadosAlteracao?.motivo || '',
  }).catch(() => {});
}

// ─── Buscar tratativa por manifestação ──────────────────────────
async function buscarTratativaPorManifestacao(idManifestacao) {
  const trats = await sheets.lerAba('TRATATIVAS', 500).catch(() => []);
  const tratativa = trats.find(t => t.ID_MANIFESTACAO === idManifestacao);
  if (!tratativa) return null;
  const acoes = await sheets.lerAba('TRATATIVAS_ACOES', 2000).catch(() => []);
  return { tratativa, acoes: acoes.filter(a => a.ID_TRATATIVA === tratativa.ID_TRATATIVA) };
}

module.exports = {
  gerarTratativaEstruturada,
  salvarTratativa,
  registrarDecisaoHumana,
  buscarTratativaPorManifestacao,
  calcularAtraso,
  STATUS_ACAO,
};
