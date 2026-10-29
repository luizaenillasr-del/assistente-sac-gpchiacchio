'use strict';
// ================================================================
// SERVIÇO DE MATRIZ DE TRATAMENTO — v1.0
// Lê regras configuráveis do Google Sheets e aplica condições
// para determinar tratamento estruturado por tipo/empresa/setor.
// ================================================================

const sheets = require('./sheets');

const CABECALHOS_MATRIZ = [
  'ID_TRATAMENTO','EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','SUBCATEGORIA',
  'CONDICAO','SETOR_RESPONSAVEL','RESPONSAVEL','PRIORIDADE','RISCO',
  'TRATATIVA_OBRIGATORIA','TRATATIVA_RECOMENDADA','TRATATIVA_CONDICIONAL',
  'TRATATIVA_NAO_PERMITIDA','PRAZO_TRATATIVA','NECESSITA_APROVACAO',
  'QUEM_APROVA','NECESSITA_EVIDENCIA','NECESSITA_ANALISE_TECNICA',
  'NECESSITA_RNC','NECESSITA_ESCALONAMENTO','MODELO_DEVOLUTIVA',
  'REGRAS_DEVOLUTIVA','INFORMACOES_PERMITIDAS','INFORMACOES_PROIBIDAS',
  'ATIVO','VERSAO',
];

// Cache em memória com TTL de 5 min
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function carregarMatriz() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;
  // Leitura não pode criar colunas nem abas. A planilha real possui uma
  // versão legada do contrato (ID_REGRA/TRATATIVA_PADRAO); a normalização
  // abaixo permite reutilizar esses registros sem reescrever a fonte.
  const rows = await sheets.lerAba('MATRIZ_TRATAMENTO', 1000).catch(() => []);
  _cache = rows
    .map(normalizarRegra)
    .filter(regraUtilizavel);
  _cacheTs = Date.now();
  return _cache;
}

function normalizarRegra(row = {}) {
  const regra = { ...row };
  // ID_REGRA identifica a regra de seleção; ID_TRATAMENTO identifica o
  // procedimento aplicado. Eles podem coexistir e nunca devem ser
  // substituídos um pelo outro.
  regra.ID_REGRA = regra.ID_REGRA || '';
  regra.ID_TRATAMENTO = regra.ID_TRATAMENTO || '';
  regra.CONTRATO = Object.prototype.hasOwnProperty.call(row, 'ID_TRATAMENTO')
    ? 'CANONICO'
    : (Object.prototype.hasOwnProperty.call(row, 'ID_REGRA') ? 'LEGADO' : 'DESCONHECIDO');
  regra.TIPO_MANIFESTACAO = regra.TIPO_MANIFESTACAO || regra.PROBLEMA_TRATADO || '';
  regra.SUBCATEGORIA = regra.SUBCATEGORIA || regra.SUBCAUSA || '';
  regra.TRATATIVA_OBRIGATORIA = regra.TRATATIVA_OBRIGATORIA || regra.PROCEDIMENTO || '';
  regra.TRATATIVA_RECOMENDADA = regra.TRATATIVA_RECOMENDADA || regra.TRATATIVA_PADRAO || regra.PROCEDIMENTO || '';
  regra.TRATATIVA_CONDICIONAL = regra.TRATATIVA_CONDICIONAL || '';
  regra.TRATATIVA_NAO_PERMITIDA = regra.TRATATIVA_NAO_PERMITIDA || '';
  regra.PRAZO_TRATATIVA = regra.PRAZO_TRATATIVA || regra.SLA_HORAS || '';
  regra.NECESSITA_APROVACAO = regra.NECESSITA_APROVACAO || regra.REQUER_APROVACAO || '';
  regra.MODELO_DEVOLUTIVA = regra.MODELO_DEVOLUTIVA || regra.DEVOLUTIVA_PADRAO || '';
  regra.NECESSITA_EVIDENCIA = regra.NECESSITA_EVIDENCIA || regra.EVIDENCIAS_EXIGIDAS || '';
  regra.MOTIVOS_INCOMPLETUDE = validarRegra(regra).motivos;
  return regra;
}

/** Valida uma regra sem alterar a origem. Regras ativas incompletas não são
 * elegíveis para recomendações do CIRCA. */
function validarRegra(regra = {}) {
  // As planilhas usam tanto "NAO" quanto "NÃO". Normalizar antes de
  // comparar evita que uma regra explicitamente inativa entre no CIRCA.
  const estado = String(regra.ATIVO || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const status = String(regra.STATUS || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
  const ativa = !['NAO', 'INATIVO', 'INACTIVE', '0', 'FALSE'].includes(estado) &&
    !['INATIVO', 'INACTIVE', 'RASCUNHO', 'DESCARTADO'].includes(status);
  const contrato = regra.CONTRATO || (Object.prototype.hasOwnProperty.call(regra, 'ID_TRATAMENTO') ? 'CANONICO' : 'LEGADO');
  const obrigatorios = contrato === 'CANONICO'
    ? [
        ['ID_TRATAMENTO', regra.ID_TRATAMENTO], ['EMPRESA', regra.EMPRESA],
        ['TIPO_MANIFESTACAO', regra.TIPO_MANIFESTACAO], ['CATEGORIA', regra.CATEGORIA],
        ['SUBCATEGORIA', regra.SUBCATEGORIA], ['SETOR_RESPONSAVEL', regra.SETOR_RESPONSAVEL],
        ['TRATATIVA_OBRIGATORIA', regra.TRATATIVA_OBRIGATORIA],
      ]
    : [
        ['ID_REGRA', regra.ID_REGRA], ['EMPRESA', regra.EMPRESA],
        ['TIPO_MANIFESTACAO', regra.TIPO_MANIFESTACAO], ['SETOR_RESPONSAVEL', regra.SETOR_RESPONSAVEL],
        ['SLA_HORAS', regra.SLA_HORAS], ['PRIORIDADE', regra.PRIORIDADE],
        ['TRATATIVA_PADRAO', regra.TRATATIVA_PADRAO || regra.TRATATIVA_RECOMENDADA],
      ];
  const motivos = obrigatorios.filter(([, value]) => String(value ?? '').trim() === '').map(([nome]) => nome);
  // "utilizavel" é deliberadamente igual ao critério do motor: uma regra
  // inativa nunca pode ser recomendada, ainda que esteja completa.
  return { ativa, contrato, motivos, utilizavel: ativa && motivos.length === 0 };
}

function regraUtilizavel(regra = {}) {
  const validacao = validarRegra(regra);
  return validacao.utilizavel;
}

function norm(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function bate(campo, valor) {
  if (!campo || campo === '*' || !campo.trim()) return true;
  return norm(campo).split('|').some(p => {
    const esperado = p.trim();
    return ['*', 'todas', 'todos', 'qualquer', 'global'].includes(esperado) || norm(valor).includes(esperado);
  });
}

function scoreRegra(regra, ctx) {
  let score = 0;
  if (bate(regra.EMPRESA, ctx.empresa)) score++;
  if (bate(regra.TIPO_MANIFESTACAO, ctx.tipo)) score++;
  if (bate(regra.CATEGORIA, ctx.categoria)) score++;
  if (bate(regra.SUBCATEGORIA, ctx.subcategoria)) score++;
  if (bate(regra.CAUSA, ctx.causa)) score += 2;
  if (bate(regra.SUBCAUSA, ctx.subcausa || ctx.subcategoria)) score += 2;
  if (bate(regra.SETOR_RESPONSAVEL, ctx.setor)) score++;
  const cond = norm(regra.CONDICAO || '');
  if (cond === 'reincidente' && ctx.reincidente) score += 2;
  if (cond === 'atraso' && ctx.atraso) score += 2;
  if (cond === 'alta_prioridade' && (ctx.prioridade || '').toLowerCase().includes('alta')) score += 2;
  return score;
}

async function consultarMatriz(ctx) {
  const matriz = await carregarMatriz();
  if (!matriz.length) return null;

  const elegíveis = matriz.filter(r =>
    ['EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','SUBCATEGORIA','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL'].every(c => {
      const valor = c === 'TIPO_MANIFESTACAO' ? ctx.tipo : ctx[c.toLowerCase()];
      return !String(r[c] || '').trim() || !String(valor || '').trim() || bate(r[c], valor || '');
    })
  );

  if (!elegíveis.length) return null;

  const rankeadas = elegíveis
    .map(r => ({ regra: r, score: scoreRegra(r, ctx) }))
    .sort((a, b) => b.score - a.score);

  const melhor = rankeadas[0].regra;
  const criterios = ['EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','SUBCATEGORIA','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL'];
  const correspondencia = Object.fromEntries(criterios.map(c => {
    const encontrado = c === 'TIPO_MANIFESTACAO' ? ctx.tipo : (ctx[c.toLowerCase()] || '');
    return [c, { esperado: melhor[c] || '', encontrado, corresponde: !String(melhor[c] || '').trim() || !String(encontrado || '').trim() || bate(melhor[c], encontrado) }];
  }));

  const split = (v) => (v || '').split(/[;\n]/).map(s => s.trim()).filter(Boolean);

  return {
    idTratamento: melhor.ID_TRATAMENTO || null,
    idRegra: melhor.ID_REGRA || null,
    setorResponsavel: melhor.SETOR_RESPONSAVEL || ctx.setor || 'SAC',
    responsavel: melhor.RESPONSAVEL || '',
    prioridade: melhor.PRIORIDADE || 'Média',
    risco: melhor.RISCO || 'MÉDIO',
    // Prazo de procedimento só existe quando a regra o informa. Os SLAs
    // operacionais (24/72/96h) são exibidos separadamente pelo CIRCA.
    prazo: melhor.PRAZO_TRATATIVA || null,
    acoesObrigatorias: split(melhor.TRATATIVA_OBRIGATORIA),
    acoesRecomendadas: split(melhor.TRATATIVA_RECOMENDADA),
    acoesCondicionais: split(melhor.TRATATIVA_CONDICIONAL),
    acoesProibidas: split(melhor.TRATATIVA_NAO_PERMITIDA),
    necessitaAprovacao: (melhor.NECESSITA_APROVACAO || 'NAO').toUpperCase() === 'SIM',
    quemAprova: melhor.QUEM_APROVA || '',
    necessitaEvidencia: (melhor.NECESSITA_EVIDENCIA || 'NAO').toUpperCase() === 'SIM',
    necessitaAnaliseTecnica: (melhor.NECESSITA_ANALISE_TECNICA || 'NAO').toUpperCase() === 'SIM',
    necessitaRNC: (melhor.NECESSITA_RNC || 'NAO').toUpperCase() === 'SIM',
    necessitaEscalonamento: (melhor.NECESSITA_ESCALONAMENTO || 'NAO').toUpperCase() === 'SIM',
    modeloDevolutiva: melhor.MODELO_DEVOLUTIVA || 'PADRAO',
    regrasDevolutiva: split(melhor.REGRAS_DEVOLUTIVA),
    informacoesPermitidas: split(melhor.INFORMACOES_PERMITIDAS),
    informacoesProibidas: split(melhor.INFORMACOES_PROIBIDAS).length
      ? split(melhor.INFORMACOES_PROIBIDAS)
      : ['Conflitos internos entre setores','Hipóteses não confirmadas','Dados pessoais de funcionários','Decisões ainda não aprovadas','Promessas não autorizadas','Informações comerciais restritas'],
    versao: melhor.VERSAO || '1.0',
    origem: 'MATRIZ',
    score: rankeadas[0].score,
    elegibilidade: Object.values(correspondencia).every(c => c.corresponde),
    criteriosCorrespondencia: correspondencia,
  };
}

function regrasDefault(ctx) {
  const setor = ctx.setor || 'SAC';
  const DEFAULTS = {
    'Qualidade': {
      acoesObrigatorias: ['Identificar lote reclamado','Acionar setor de Qualidade para análise','Verificar parâmetros de produção do lote'],
      acoesRecomendadas: ['Solicitar fotos/amostras ao cliente','Abrir RNC se confirmada não conformidade','Verificar histórico do lote'],
      acoesCondicionais: ['Recolher produto se risco à saúde identificado'],
      acoesProibidas: ['Prometer troca antes da análise técnica','Confirmar defeito antes de análise'],
    },
    'Logística': {
      acoesObrigatorias: ['Identificar NF e transportadora responsável','Verificar rastreamento do pedido'],
      acoesRecomendadas: ['Acionar transportadora para posicionamento formal','Confirmar novo prazo com o cliente'],
      acoesCondicionais: ['Emitir NF de reposição se perda confirmada'],
      acoesProibidas: ['Confirmar responsabilidade antes de apuração'],
    },
    'Financeiro': {
      acoesObrigatorias: ['Coletar NF(s) do cliente','Verificar valor cobrado vs. valor acordado'],
      acoesRecomendadas: ['Acionar faturamento para análise','Emitir crédito ou corrigir NF se pertinente'],
      acoesCondicionais: ['Escalar para gerência financeira se valor > R$10.000'],
      acoesProibidas: ['Confirmar devolução de valor antes de análise aprovada'],
    },
    'Comercial': {
      acoesObrigatorias: ['Contatar representante da região','Verificar histórico do pedido no sistema'],
      acoesRecomendadas: ['Acionar gerente de contas','Verificar condições comerciais acordadas'],
      acoesCondicionais: ['Propor desconto ou bonificação se pertinente'],
      acoesProibidas: ['Prometer desconto sem aprovação gerencial'],
    },
    'SAC': {
      acoesObrigatorias: ['Registrar a manifestação com todos os dados','Acionar setor responsável com contexto completo','Comunicar previsão de retorno ao cliente'],
      acoesRecomendadas: ['Coletar NF, lote ou foto como evidência','Abrir ocorrência interna e monitorar prazo'],
      acoesCondicionais: ['Escalar para supervisão se reincidente'],
      acoesProibidas: ['Encerrar sem retorno ao cliente','Prometer solução sem apuração'],
    },
  };
  const base = DEFAULTS[setor] || DEFAULTS['SAC'];
  return {
    idTratamento: null,
    idRegra: null,
    setorResponsavel: setor,
    responsavel: '',
    prioridade: ctx.prioridade || 'Média',
    risco: 'MÉDIO',
    prazo: null,
    ...base,
    necessitaAprovacao: false,
    quemAprova: '',
    necessitaEvidencia: true,
    necessitaAnaliseTecnica: setor === 'Qualidade',
    necessitaRNC: false,
    necessitaEscalonamento: false,
    modeloDevolutiva: 'PADRAO',
    regrasDevolutiva: ['Demonstrar ação e resolução','Não assumir culpa antes da apuração'],
    informacoesPermitidas: ['Número de protocolo','Previsão de retorno','Setor responsável pela análise'],
    informacoesProibidas: ['Conflitos internos','Hipóteses não confirmadas','Dados pessoais de funcionários','Decisões não aprovadas'],
    versao: '1.0',
    origem: 'PADRAO',
    score: 0,
  };
}

async function obterRegras(ctx) {
  const daMatriz = await consultarMatriz(ctx).catch(() => null);
  return daMatriz || regrasDefault(ctx);
}

module.exports = {
  carregarMatriz,
  consultarMatriz,
  obterRegras,
  regrasDefault,
  normalizarRegra,
  validarRegra,
  regraUtilizavel,
};
