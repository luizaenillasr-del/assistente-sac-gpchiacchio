'use strict';
// ================================================================
// MOTOR DE DEVOLUTIVAS — v1.0
// Gera devolutivas estruturadas para o cliente com base no
// tipo de manifestação, tratativa, diagnóstico e regras da
// INFORMACOES_PERMITIDAS / INFORMACOES_PROIBIDAS.
// ================================================================

const sheets = require('./sheets');
const { obterRegras } = require('./matrizTratamentoService');

const TIPOS_DEVOLUTIVA = {
  RECEBIMENTO:            'Confirmação de recebimento da manifestação',
  SOLICITACAO_INFORMACAO: 'Solicitação de informações adicionais ao cliente',
  EM_ANALISE:             'Manifestação em análise interna',
  ATUALIZACAO_STATUS:     'Atualização do andamento da análise',
  ATRASO:                 'Comunicado de atraso na resolução',
  SOLUCAO:                'Apresentação da solução encontrada',
  PROCEDENCIA:            'Confirmação de procedência da reclamação',
  IMPROCEDENCIA:          'Declaração de improcedência com justificativa',
  CONCLUSAO:              'Encerramento formal da manifestação',
  REABERTURA:             'Confirmação de reabertura da manifestação',
  ESCALONAMENTO:          'Comunicado de escalonamento para nível superior',
};

const CABECALHOS_DEVOLUTIVAS = [
  'ID_DEVOLUTIVA','ID_MANIFESTACAO','ID_TRATATIVA','TIPO_DEVOLUTIVA',
  'TEXTO_GERADO','TEXTO_APROVADO','STATUS',
  'CONFIANCA','INFORMACOES_USADAS','INFORMACOES_BLOQUEADAS',
  'GERADA_EM','APROVADA_EM','APROVADA_POR',
  'DECISAO','MOTIVO_EDICAO','VERSAO_FINAL',
  'CANAL_ENVIO','ENVIADA_EM','ENVIADA_POR','EMPRESA',
];

let _devCache = null;
let _devCacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

async function _carregarTemplates() {
  if (_devCache && Date.now() - _devCacheTs < CACHE_TTL) return _devCache;
  // Gerar uma sugestão é uma leitura. A criação da aba DEVOLUTIVAS fica
  // restrita a salvarDevolutiva(), quando há uma decisão explícita de gravar.
  const modelos = await sheets.lerAba('MODELOS_DEVOLUTIVA', 5000).catch(() => []);
  _devCache = modelos.filter(modelo => {
    const status = normalizar(modelo.STATUS);
    return ['aprovada', 'publicada', 'aprovado'].includes(status) && String(modelo.TEXTO_PADRAO || '').trim();
  });
  _devCacheTs = Date.now();
  return _devCache;
}

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function modeloCompativel(modelo, params) {
  const campos = [
    ['EMPRESA', params.empresa],
    ['TIPO_MANIFESTACAO', params.tipoManifestacao],
    ['CATEGORIA', params.categoria],
    ['SITUACAO', params.situacao],
    ['TIPO_DEVOLUTIVA', params.tipo],
  ];
  let score = 0;
  for (const [campo, valor] of campos) {
    const configurado = normalizar(modelo[campo]);
    const procurado = normalizar(valor);
    if (!configurado || !procurado) continue;
    if (['todas', 'todos', 'qualquer', 'global'].includes(configurado)) { score++; continue; }
    if (!configurado.includes(procurado) && !procurado.includes(configurado)) return null;
    score += campo === 'EMPRESA' ? 4 : campo === 'TIPO_DEVOLUTIVA' ? 3 : 2;
  }
  return score;
}

function selecionarModeloDevolutiva(modelos, params) {
  return (modelos || [])
    .map(modelo => ({ modelo, score: modeloCompativel(modelo, params) }))
    .filter(item => item.score !== null)
    .sort((a, b) => b.score - a.score || Number(b.modelo.VERSAO || 0) - Number(a.modelo.VERSAO || 0))[0]?.modelo || null;
}

function preencherModelo(texto, params) {
  const valores = {
    protocolo: params.protocolo || params.idManifestacao || '',
    idManifestacao: params.idManifestacao || '',
    nomeCliente: params.nomeCliente || '',
    empresa: params.empresa || '',
    prazo: params.prazo || '72 horas úteis',
    setorResponsavel: params.setorResponsavel || params.setor || 'SAC',
    tipoManifestacao: params.tipoManifestacao || '',
    categoria: params.categoria || '',
    causa: params.causa || '',
    subcausa: params.subcausa || '',
    descricaoSolucao: params.descricaoSolucao || '',
    acoesTomadas: params.acoesTomadas || '',
    resumoConclusao: params.resumoConclusao || '',
    informacoesSolicitadas: params.informacoesSolicitadas || '',
  };
  return String(texto || '').replace(/{{\s*([\wÀ-ÿ]+)\s*}}/gi, (_, chave) => valores[chave] == null ? '' : String(valores[chave]));
}

// ── Filtra texto para remover informações proibidas ──────────────
function aplicarFiltroInformacoes(texto, permitidas, proibidas) {
  const bloqueadas = [];
  let textofinal = texto;

  for (const proibida of (proibidas || [])) {
    const re = new RegExp(proibida.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(textofinal)) {
      bloqueadas.push(proibida);
      textofinal = textofinal.replace(re, '[INFORMAÇÃO OMITIDA]');
    }
  }

  return { texto: textofinal, bloqueadas };
}

// ── Saudação configurável por empresa ────────────────────────────
function montarSaudacao(empresa, nomeCliente) {
  const nome = nomeCliente ? `, ${nomeCliente}` : '';
  return `Prezado(a) cliente${nome},`;
}

// ── Templates base por tipo de devolutiva ────────────────────────
function templateBase(tipo, ctx) {
  const proto = ctx.protocolo || ctx.idManifestacao || 'SEM-PROTOCOLO';
  const empresa = ctx.empresa || 'nossa empresa';
  const prazo = ctx.prazo || '72 horas úteis';
  const setor = ctx.setorResponsavel || 'equipe responsável';

  const templates = {
    RECEBIMENTO: `Confirmamos o recebimento da sua manifestação, registrada sob o protocolo **${proto}**.

Nossa equipe irá analisar o seu caso e retornaremos com uma posição em até **${prazo}**.

Agradecemos o contato e reforçamos nosso compromisso com a qualidade.`,

    SOLICITACAO_INFORMACAO: `Estamos analisando a sua manifestação (protocolo **${proto}**) e precisamos de informações adicionais para prosseguir com a apuração.

${ctx.informacoesSolicitadas || 'Por favor, nos forneça mais detalhes sobre a ocorrência.'}

Aguardamos seu retorno para darmos continuidade ao processo.`,

    EM_ANALISE: `A sua manifestação (protocolo **${proto}**) está sendo analisada internamente pelo setor de **${setor}**.

Estamos levantando todos os dados necessários para oferecer uma resposta completa. Em breve entraremos em contato.`,

    ATUALIZACAO_STATUS: `Gostaríamos de informar que a análise da sua manifestação (protocolo **${proto}**) está em andamento.

${ctx.atualizacao || 'Nosso time está trabalhando na apuração e em breve teremos mais informações.'}

Previsão de retorno: **${prazo}**.`,

    ATRASO: `Informamos que a resolução da sua manifestação (protocolo **${proto}**) está sendo processada com um prazo adicional.

${ctx.motivoAtraso || 'A análise requer um tempo maior do que o previsto inicialmente.'}

Novo prazo de retorno: **${prazo}**. Pedimos desculpas pelo inconveniente.`,

    SOLUCAO: `Concluímos a análise da sua manifestação (protocolo **${proto}**) e temos uma posição a apresentar.

${ctx.descricaoSolucao || 'A situação foi analisada e as medidas cabíveis foram tomadas.'}

${ctx.acoesTomadas ? `**Ações realizadas:**\n${ctx.acoesTomadas}` : ''}

Qualquer dúvida, estamos à disposição.`,

    PROCEDENCIA: `Após análise detalhada da sua manifestação (protocolo **${proto}**), confirmamos a procedência da ocorrência relatada.

${ctx.descricaoProcedencia || 'Reconhecemos o problema e tomaremos as providências necessárias.'}

${ctx.acoesTomadas ? `**Providências adotadas:**\n${ctx.acoesTomadas}` : ''}

Agradecemos por nos comunicar e pedimos desculpas pelo transtorno.`,

    IMPROCEDENCIA: `Após análise criteriosa da sua manifestação (protocolo **${proto}**), concluímos que a ocorrência não pôde ser confirmada.

${ctx.justificativaImprocedencia || 'Com base nas informações levantadas, não foi possível identificar irregularidade por parte da empresa.'}

Permanecemos à disposição para esclarecimentos adicionais.`,

    CONCLUSAO: `Informamos que a sua manifestação (protocolo **${proto}**) foi encerrada formalmente em nosso sistema.

${ctx.resumoConclusao || 'Esperamos ter atendido às suas expectativas.'}

Caso necessite de novas informações ou o problema persista, não hesite em nos contatar.`,

    REABERTURA: `Confirmamos a reabertura da sua manifestação (protocolo **${proto}**) conforme solicitado.

Nossa equipe irá reexaminar o caso e retornaremos em até **${prazo}**.`,

    ESCALONAMENTO: `Informamos que a sua manifestação (protocolo **${proto}**) foi encaminhada para análise de nível superior, pelo setor de **${setor}**.

${ctx.motivoEscalonamento || 'A situação requer atenção especial de nossa equipe.'}

Retornaremos com uma posição em até **${prazo}**.`,
  };

  return templates[tipo] || templates.RECEBIMENTO;
}

// ── Gerador principal ─────────────────────────────────────────────
async function gerarDevolutiva(params) {
  const {
    idManifestacao,
    idTratativa,
    tipo = 'RECEBIMENTO',
    empresa,
    tipoManifestacao,
    categoria,
    subcategoria,
    setor,
    nomeCliente,
    protocolo,
    prazo,
    setorResponsavel,
    diagnostico,
    acoesTomadas,
    descricaoSolucao,
    atualizacao,
    motivoAtraso,
    motivoEscalonamento,
    justificativaImprocedencia,
    descricaoProcedencia,
    resumoConclusao,
    informacoesSolicitadas,
    reincidente,
    prioridade,
    situacao,
    causa,
    subcausa,
  } = params;

  const modelos = await _carregarTemplates();

  // Busca regras da matriz para informações permitidas/proibidas
  const regras = await obterRegras({
    empresa, tipo: tipoManifestacao, categoria, subcategoria, setor, reincidente, prioridade,
  }).catch(() => null);

  const permitidas = regras?.informacoesPermitidas || [];
  const proibidas  = regras?.informacoesProibidas  || [
    'Conflitos internos entre setores',
    'Hipóteses não confirmadas',
    'Dados pessoais de funcionários',
    'Decisões ainda não aprovadas',
    'Promessas não autorizadas',
    'Informações comerciais restritas',
  ];

  if (!TIPOS_DEVOLUTIVA[tipo]) {
    throw new Error(`Tipo de devolutiva inválido: ${tipo}. Use: ${Object.keys(TIPOS_DEVOLUTIVA).join(', ')}`);
  }

  const ctx = {
    idManifestacao, protocolo: protocolo || idManifestacao, empresa, prazo: prazo || '72 horas úteis',
    setorResponsavel: setorResponsavel || setor || 'SAC',
    acoesTomadas, descricaoSolucao, atualizacao, motivoAtraso, motivoEscalonamento,
    justificativaImprocedencia, descricaoProcedencia, resumoConclusao, informacoesSolicitadas,
  };

  const modelo = selecionarModeloDevolutiva(modelos, { empresa, tipoManifestacao, categoria, situacao, tipo });
  const saudacao = montarSaudacao(empresa, nomeCliente);
  const corpo = modelo
    ? preencherModelo(modelo.TEXTO_PADRAO, { ...params, protocolo: protocolo || idManifestacao })
    : templateBase(tipo, ctx);
  const assinatura = modelo ? '' : `\nAtenciosamente,\nEquipe SAC – ${empresa || 'G.P. Chiacchio'}`;

  const textoCompleto = modelo ? corpo : `${saudacao}\n\n${corpo}${assinatura}`;

  const { texto: textoFiltrado, bloqueadas } = aplicarFiltroInformacoes(textoCompleto, permitidas, proibidas);

  // Confiança baseada em completude dos dados
  let confianca = 0.7;
  if (diagnostico) confianca += 0.1;
  if (acoesTomadas) confianca += 0.1;
  if (bloqueadas.length === 0) confianca += 0.05;
  if (regras?.origem === 'MATRIZ') confianca += 0.05;
  confianca = Math.min(confianca, 0.98);

  return {
    tipo,
    descricaoTipo: TIPOS_DEVOLUTIVA[tipo],
    textoGerado: textoFiltrado,
    textoBruto: textoCompleto,
    informacoesPermitidas: permitidas,
    informacoesProibidas: proibidas,
    informacoesBloqueadas: bloqueadas,
    confianca: Math.round(confianca * 100),
    status: 'AGUARDANDO_APROVACAO',
    modeloDevolutiva: modelo?.ID_MODELO || regras?.modeloDevolutiva || 'PADRAO',
    modeloDevolutivaTitulo: modelo?.TITULO || '',
    modeloDevolutivaVersao: modelo?.VERSAO || '',
    modeloDevolutivaOrigem: modelo ? 'MODELOS_DEVOLUTIVA' : 'TEMPLATE_PADRAO',
    regrasDevolutiva: regras?.regrasDevolutiva || [],
    geradaEm: new Date().toISOString(),
  };
}

// ── Salvar devolutiva no Sheets ───────────────────────────────────
async function salvarDevolutiva(idManifestacao, devolutiva, idTratativa, empresa, usuario) {
  await sheets.garantirAbaComCabecalhos('DEVOLUTIVAS', CABECALHOS_DEVOLUTIVAS).catch(() => {});

  const idDev = await sheets.gerarProximoID('DEVOLUTIVAS', 'DEV', 'ID_DEVOLUTIVA').catch(() =>
    'DEV-' + Date.now().toString().slice(-6)
  );

  const linha = {
    ID_DEVOLUTIVA:        idDev,
    ID_MANIFESTACAO:      idManifestacao,
    ID_TRATATIVA:         idTratativa || '',
    TIPO_DEVOLUTIVA:      devolutiva.tipo,
    TEXTO_GERADO:         devolutiva.textoGerado,
    TEXTO_APROVADO:       '',
    STATUS:               'AGUARDANDO_APROVACAO',
    CONFIANCA:            devolutiva.confianca,
    INFORMACOES_USADAS:   (devolutiva.informacoesPermitidas || []).join('; '),
    INFORMACOES_BLOQUEADAS: (devolutiva.informacoesBloqueadas || []).join('; '),
    GERADA_EM:            devolutiva.geradaEm || new Date().toISOString(),
    APROVADA_EM:          '',
    APROVADA_POR:         '',
    DECISAO:              '',
    MOTIVO_EDICAO:        '',
    VERSAO_FINAL:         '',
    CANAL_ENVIO:          '',
    ENVIADA_EM:           '',
    ENVIADA_POR:          '',
    EMPRESA:              empresa || '',
  };

  await sheets.appendObjeto('DEVOLUTIVAS', linha);
  return { id: idDev, ...linha };
}

// ── Registrar decisão humana sobre devolutiva ─────────────────────
async function registrarDecisaoDevolutiva(idDevolutiva, decisao, textoAprovado, motivo, usuario) {
  const todas = await sheets.lerAba('DEVOLUTIVAS', 5000);
  const found = todas.find(r => r.ID_DEVOLUTIVA === idDevolutiva);
  if (!found) throw new Error(`Devolutiva ${idDevolutiva} não encontrada.`);

  const atualizacao = {
    STATUS:         decisao === 'APROVADA' ? 'APROVADA' : decisao === 'REJEITADA' ? 'REJEITADA' : 'EDITADA',
    DECISAO:        decisao,
    TEXTO_APROVADO: textoAprovado || found.TEXTO_GERADO,
    VERSAO_FINAL:   textoAprovado || found.TEXTO_GERADO,
    APROVADA_EM:    new Date().toISOString(),
    APROVADA_POR:   usuario || 'SISTEMA',
    MOTIVO_EDICAO:  motivo || '',
  };

  await sheets.atualizarPorID('DEVOLUTIVAS', idDevolutiva, atualizacao, ['ID_DEVOLUTIVA']);
  return { ...found, ...atualizacao };
}

// ── Buscar devolutivas de uma manifestação ────────────────────────
async function buscarDevolutivasPorManifestacao(idManifestacao) {
  const { lerAba } = sheets;
  const todas = await lerAba('DEVOLUTIVAS', 5000);
  return todas.filter(r => r.ID_MANIFESTACAO === idManifestacao);
}

module.exports = {
  TIPOS_DEVOLUTIVA,
  gerarDevolutiva,
  selecionarModeloDevolutiva,
  preencherModelo,
  salvarDevolutiva,
  registrarDecisaoDevolutiva,
  buscarDevolutivasPorManifestacao,
};
