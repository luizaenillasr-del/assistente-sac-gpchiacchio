'use strict';
// ============================================================
// MATRIZ DE CONHECIMENTO — v1.0
// Camada de roteamento de conhecimento para o Cérebro SAC.
// Responde: "QUAL CONHECIMENTO DEVE SER CONSULTADO?"
// ============================================================

const sheets = require('./sheets');
const crypto = require('crypto');

const MC_SHEET = 'MATRIZ_CONHECIMENTO';
const MC_ITENS_SHEET = 'MC_ITENS_CONHECIMENTO';
const MC_EVIDENCIAS_SHEET = 'MC_EVIDENCIAS_NECESSARIAS';
const MC_EXCECOES_SHEET = 'MC_EXCECOES';
const MC_AUDIT_SHEET = 'MC_AUDIT_LOG';

const MC_HEADERS = [
  'ID','CODIGO','NOME','DESCRICAO','EMPRESA','SETOR','TIPO_MANIFESTACAO',
  'CATEGORIA','SUBCATEGORIA','PRODUTO','FAMILIA_PRODUTO','CANAL','PRIORIDADE','RISCO',
  'TIPO_OCORRENCIA','NECESSITA_ANALISE_TECNICA','SETOR_ANALISE_TECNICA','PRAZO_ANALISE',
  'TIPO_ANALISE','SETOR_DETENTOR_CONHECIMENTO','TERMOS_REFERENCIA','STATUS',
  'VERSAO','DATA_INICIO_VIGENCIA','DATA_FIM_VIGENCIA',
  'CRIADO_POR','CRIADO_EM','ATUALIZADO_POR','ATUALIZADO_EM'
];

const MC_ITENS_HEADERS = [
  'ID','MATRIZ_ID','TIPO_FONTE','FONTE_ID','TITULO','DESCRICAO',
  'PRIORIDADE','OBRIGATORIO','ORDEM','ATIVO','VERSAO','CRIADO_EM'
];

const MC_EVIDENCIAS_HEADERS = [
  'ID','MATRIZ_ID','TITULO','TIPO_EVIDENCIA','OBRIGATORIA','DESCRICAO','CONDICAO','ATIVO','CRIADO_EM'
];

const MC_EXCECOES_HEADERS = [
  'ID','MATRIZ_ID','TIPO_EXCECAO','CONDICAO','CONHECIMENTO_ALTERNATIVO','OBSERVACAO','ATIVO','CRIADO_EM'
];

const MC_AUDIT_HEADERS = [
  'ID','MANIFESTACAO_ID','MATRIZ_ID','VERSAO','FONTES_CONSULTADAS','CONHECIMENTOS_OBRIGATORIOS',
  'CONHECIMENTOS_COMPLEMENTARES','EVIDENCIAS_ENCONTRADAS','EVIDENCIAS_AUSENTES','CONFLITOS',
  'BRAIN_VERSION','DATA','USUARIO'
];

// Tipos de fonte válidos
const TIPOS_FONTE = [
  'BASE_CONHECIMENTO','PROCEDIMENTO','POLITICA','REGRA','FAQ',
  'DOCUMENTO','INSTRUCAO_TECNICA','ESPECIFICACAO','CRITERIO_QUALIDADE',
  'CRITERIO_COMERCIAL','SLA','MATRIZ_TRATAMENTO','OUTRA_FONTE'
];

const PRIORIDADES_FONTE = ['CRITICA','ALTA','MEDIA','BAIXA','CONTEXTO'];

const STATUS_MATRIZ = ['RASCUNHO','EM_REVISAO','APROVADA','PUBLICADA','SUSPENSA','ARQUIVADA'];

// ──────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────────────────────────

function normalizar(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

function gerarId(prefixo) {
  return prefixo + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase();
}

function vigente(matriz, data) {
  const ref = data ? new Date(data) : new Date();
  if (matriz.DATA_INICIO_VIGENCIA) {
    const ini = new Date(matriz.DATA_INICIO_VIGENCIA);
    if (!isNaN(ini) && ref < ini) return false;
  }
  if (matriz.DATA_FIM_VIGENCIA) {
    const fim = new Date(matriz.DATA_FIM_VIGENCIA);
    if (!isNaN(fim) && ref > fim) return false;
  }
  return true;
}

async function garantirAbas() {
  await Promise.all([
    sheets.garantirAbaComCabecalhos(MC_SHEET, MC_HEADERS).catch(() => {}),
    sheets.garantirAbaComCabecalhos(MC_ITENS_SHEET, MC_ITENS_HEADERS).catch(() => {}),
    sheets.garantirAbaComCabecalhos(MC_EVIDENCIAS_SHEET, MC_EVIDENCIAS_HEADERS).catch(() => {}),
    sheets.garantirAbaComCabecalhos(MC_EXCECOES_SHEET, MC_EXCECOES_HEADERS).catch(() => {}),
    sheets.garantirAbaComCabecalhos(MC_AUDIT_SHEET, MC_AUDIT_HEADERS).catch(() => {}),
  ]);
}

// ──────────────────────────────────────────────────────────────
// SCORE DE ADERÊNCIA
// Hierarquia: empresa(5) > tipo(4) > categoria(3) > subcategoria(3)
//             > produto(2) > setor(2) > canal(1)
// ──────────────────────────────────────────────────────────────

function calcularAdherencia(matriz, ctx) {
  let score = 0;
  const m = (a, b) => a && b && normalizar(a) === normalizar(b);
  const mi = (a, b) => a && b && normalizar(b).includes(normalizar(a));

  if (matriz.EMPRESA && m(matriz.EMPRESA, ctx.empresa)) score += 5;
  if (matriz.TIPO_MANIFESTACAO && m(matriz.TIPO_MANIFESTACAO, ctx.tipo)) score += 4;
  if (matriz.CATEGORIA && m(matriz.CATEGORIA, ctx.categoria)) score += 3;
  if (matriz.SUBCATEGORIA && m(matriz.SUBCATEGORIA, ctx.subcategoria)) score += 3;
  if (matriz.PRODUTO && (m(matriz.PRODUTO, ctx.produto) || mi(matriz.PRODUTO, ctx.produto))) score += 2;
  if (matriz.FAMILIA_PRODUTO && mi(matriz.FAMILIA_PRODUTO, ctx.produto)) score += 1;
  if (matriz.SETOR && m(matriz.SETOR, ctx.setor)) score += 2;
  if (matriz.CANAL && m(matriz.CANAL, ctx.canal)) score += 1;
  if (matriz.RISCO && m(matriz.RISCO, ctx.risco)) score += 1;

  // Termos de referência como sinal auxiliar
  if (matriz.TERMOS_REFERENCIA && ctx.descricao) {
    const termos = String(matriz.TERMOS_REFERENCIA).split(/[,;|]/).map(t => t.trim()).filter(Boolean);
    const descN = normalizar(ctx.descricao);
    for (const t of termos) {
      if (descN.includes(normalizar(t))) { score += 0.5; break; }
    }
  }

  return Math.round(score * 10) / 10;
}

// ──────────────────────────────────────────────────────────────
// DETECÇÃO DE CONFLITOS ENTRE FONTES
// ──────────────────────────────────────────────────────────────

function detectarConflitosConhecimento(itens) {
  const conflitos = [];
  const porTipo = {};
  for (const it of itens) {
    const k = it.TIPO_FONTE;
    if (!porTipo[k]) porTipo[k] = [];
    porTipo[k].push(it);
  }
  for (const [tipo, grupo] of Object.entries(porTipo)) {
    if (grupo.length > 1) {
      // Verifica versões conflitantes (mesma fonte, versões diferentes)
      const versoes = [...new Set(grupo.map(g => g.VERSAO).filter(Boolean))];
      if (versoes.length > 1) {
        conflitos.push({
          tipo: 'VERSAO_CONFLITANTE',
          tipoFonte: tipo,
          fontes: grupo.map(g => ({ id: g.FONTE_ID, titulo: g.TITULO, versao: g.VERSAO })),
          descricao: `Múltiplas versões de ${tipo} aplicáveis`,
          impacto: 'Recomenda validação humana antes de utilizar',
        });
      }
    }
  }
  return conflitos;
}

// ──────────────────────────────────────────────────────────────
// CRUD — MATRIZES
// ──────────────────────────────────────────────────────────────

async function listarMatrizes(filtros = {}) {
  await garantirAbas();
  let rows = await sheets.lerAba(MC_SHEET, 2000);

  if (filtros.empresa) rows = rows.filter(r => normalizar(r.EMPRESA) === normalizar(filtros.empresa) || !r.EMPRESA);
  if (filtros.setor) rows = rows.filter(r => normalizar(r.SETOR) === normalizar(filtros.setor) || !r.SETOR);
  if (filtros.tipo) rows = rows.filter(r => normalizar(r.TIPO_MANIFESTACAO) === normalizar(filtros.tipo) || !r.TIPO_MANIFESTACAO);
  if (filtros.categoria) rows = rows.filter(r => normalizar(r.CATEGORIA) === normalizar(filtros.categoria) || !r.CATEGORIA);
  if (filtros.subcategoria) rows = rows.filter(r => normalizar(r.SUBCATEGORIA) === normalizar(filtros.subcategoria) || !r.SUBCATEGORIA);
  if (filtros.status) rows = rows.filter(r => normalizar(r.STATUS) === normalizar(filtros.status));
  if (filtros.ativo !== undefined) rows = rows.filter(r => String(r.STATUS).toUpperCase() !== 'ARQUIVADA');
  if (filtros.q) {
    const q = normalizar(filtros.q);
    rows = rows.filter(r => normalizar(r.NOME + ' ' + r.CODIGO + ' ' + r.DESCRICAO).includes(q));
  }

  return rows.sort((a, b) => (b.CRIADO_EM || '').localeCompare(a.CRIADO_EM || ''));
}

async function obterMatriz(id) {
  await garantirAbas();
  const rows = await sheets.lerAba(MC_SHEET, 2000);
  return rows.find(r => r.ID === id || r.CODIGO === id) || null;
}

async function criarMatriz(dados, usuario) {
  await garantirAbas();
  const id = gerarId('MC');
  const agora = new Date().toISOString();
  const obj = {
    ID: id,
    CODIGO: dados.codigo || ('MC-' + String(Date.now()).slice(-6)),
    NOME: dados.nome || '',
    DESCRICAO: dados.descricao || '',
    EMPRESA: dados.empresa || '',
    SETOR: dados.setor || '',
    TIPO_MANIFESTACAO: dados.tipoManifestacao || '',
    CATEGORIA: dados.categoria || '',
    SUBCATEGORIA: dados.subcategoria || '',
    PRODUTO: dados.produto || '',
    FAMILIA_PRODUTO: dados.familiaProduto || '',
    CANAL: dados.canal || '',
    PRIORIDADE: dados.prioridade || 'MEDIA',
    RISCO: dados.risco || '',
    TIPO_OCORRENCIA: dados.tipoOcorrencia || '',
    NECESSITA_ANALISE_TECNICA: dados.necessitaAnaliseTecnica || 'NÃO',
    SETOR_ANALISE_TECNICA: dados.setorAnaliseTecnica || '',
    PRAZO_ANALISE: dados.prazoAnalise || '',
    TIPO_ANALISE: dados.tipoAnalise || '',
    SETOR_DETENTOR_CONHECIMENTO: dados.setorDetentorConhecimento || '',
    TERMOS_REFERENCIA: Array.isArray(dados.termosReferencia) ? dados.termosReferencia.join(';') : (dados.termosReferencia || ''),
    STATUS: 'RASCUNHO',
    VERSAO: '1',
    DATA_INICIO_VIGENCIA: dados.dataInicioVigencia || '',
    DATA_FIM_VIGENCIA: dados.dataFimVigencia || '',
    CRIADO_POR: usuario,
    CRIADO_EM: agora,
    ATUALIZADO_POR: usuario,
    ATUALIZADO_EM: agora,
  };
  await sheets.appendObjeto(MC_SHEET, obj);
  return obj;
}

async function atualizarMatriz(id, dados, usuario) {
  const agora = new Date().toISOString();
  const update = { ...dados, ATUALIZADO_POR: usuario, ATUALIZADO_EM: agora };
  // Ao editar campo crítico, volta para RASCUNHO se estava PUBLICADA
  const criticos = ['TIPO_MANIFESTACAO','CATEGORIA','SUBCATEGORIA','EMPRESA','SETOR','PRODUTO'];
  const temCritico = criticos.some(c => dados[c] !== undefined);
  const atual = await obterMatriz(id);
  if (atual && atual.STATUS === 'PUBLICADA' && temCritico) {
    update.STATUS = 'RASCUNHO';
    update.VERSAO = String((parseInt(atual.VERSAO || '1') + 1));
  }
  const reg = await sheets.atualizarPorID(MC_SHEET, id, update, ['ID']);
  if (!reg) throw new Error('Matriz não encontrada: ' + id);
  return reg;
}

async function mudarStatusMatriz(id, novoStatus, usuario) {
  if (!STATUS_MATRIZ.includes(novoStatus)) throw new Error('Status inválido: ' + novoStatus);
  const atual = await obterMatriz(id);
  if (!atual) throw new Error('Matriz não encontrada');
  // Ao publicar, incrementa versão se em rascunho
  const update = { STATUS: novoStatus, ATUALIZADO_POR: usuario, ATUALIZADO_EM: new Date().toISOString() };
  if (novoStatus === 'PUBLICADA' && atual.STATUS !== 'PUBLICADA') {
    update.VERSAO = String((parseInt(atual.VERSAO || '1') + 1));
  }
  return sheets.atualizarPorID(MC_SHEET, id, update, ['ID']);
}

// ──────────────────────────────────────────────────────────────
// CRUD — ITENS DE CONHECIMENTO
// ──────────────────────────────────────────────────────────────

async function listarItens(matrizId) {
  await garantirAbas();
  const rows = await sheets.lerAba(MC_ITENS_SHEET, 5000);
  return rows.filter(r => r.MATRIZ_ID === matrizId && String(r.ATIVO).toUpperCase() !== 'NÃO')
    .sort((a, b) => Number(a.ORDEM || 0) - Number(b.ORDEM || 0));
}

async function adicionarItem(matrizId, dados, usuario) {
  await garantirAbas();
  const existentes = await listarItens(matrizId);
  const obj = {
    ID: gerarId('MCI'),
    MATRIZ_ID: matrizId,
    TIPO_FONTE: dados.tipoFonte || 'BASE_CONHECIMENTO',
    FONTE_ID: dados.fonteId || '',
    TITULO: dados.titulo || '',
    DESCRICAO: dados.descricao || '',
    PRIORIDADE: dados.prioridade || 'MEDIA',
    OBRIGATORIO: dados.obrigatorio || 'NÃO',
    ORDEM: dados.ordem || String(existentes.length + 1),
    ATIVO: 'SIM',
    VERSAO: dados.versao || '1',
    CRIADO_EM: new Date().toISOString(),
  };
  await sheets.appendObjeto(MC_ITENS_SHEET, obj);
  return obj;
}

async function removerItem(itemId, usuario) {
  return sheets.atualizarPorID(MC_ITENS_SHEET, itemId, { ATIVO: 'NÃO' }, ['ID']);
}

// ──────────────────────────────────────────────────────────────
// CRUD — EVIDÊNCIAS NECESSÁRIAS
// ──────────────────────────────────────────────────────────────

async function listarEvidencias(matrizId) {
  await garantirAbas();
  const rows = await sheets.lerAba(MC_EVIDENCIAS_SHEET, 5000);
  return rows.filter(r => r.MATRIZ_ID === matrizId && String(r.ATIVO).toUpperCase() !== 'NÃO');
}

async function adicionarEvidencia(matrizId, dados) {
  await garantirAbas();
  const obj = {
    ID: gerarId('MCE'),
    MATRIZ_ID: matrizId,
    TITULO: dados.titulo || '',
    TIPO_EVIDENCIA: dados.tipoEvidencia || '',
    OBRIGATORIA: dados.obrigatoria || 'SIM',
    DESCRICAO: dados.descricao || '',
    CONDICAO: dados.condicao || '',
    ATIVO: 'SIM',
    CRIADO_EM: new Date().toISOString(),
  };
  await sheets.appendObjeto(MC_EVIDENCIAS_SHEET, obj);
  return obj;
}

async function removerEvidencia(evidenciaId) {
  return sheets.atualizarPorID(MC_EVIDENCIAS_SHEET, evidenciaId, { ATIVO: 'NÃO' }, ['ID']);
}

// ──────────────────────────────────────────────────────────────
// CRUD — EXCEÇÕES
// ──────────────────────────────────────────────────────────────

async function listarExcecoes(matrizId) {
  await garantirAbas();
  const rows = await sheets.lerAba(MC_EXCECOES_SHEET, 5000);
  return rows.filter(r => r.MATRIZ_ID === matrizId && String(r.ATIVO).toUpperCase() !== 'NÃO');
}

async function adicionarExcecao(matrizId, dados) {
  await garantirAbas();
  const obj = {
    ID: gerarId('MCX'),
    MATRIZ_ID: matrizId,
    TIPO_EXCECAO: dados.tipoExcecao || '',
    CONDICAO: dados.condicao || '',
    CONHECIMENTO_ALTERNATIVO: dados.conhecimentoAlternativo || '',
    OBSERVACAO: dados.observacao || '',
    ATIVO: 'SIM',
    CRIADO_EM: new Date().toISOString(),
  };
  await sheets.appendObjeto(MC_EXCECOES_SHEET, obj);
  return obj;
}

// ──────────────────────────────────────────────────────────────
// RESOLVER CONHECIMENTO — SERVIÇO PRINCIPAL DO CÉREBRO
// ──────────────────────────────────────────────────────────────

async function resolverConhecimento(manifestacao, opcoes = {}) {
  const ctx = {
    empresa: manifestacao.EMPRESA_RECLAMADA || manifestacao.empresa || '',
    tipo: manifestacao.TIPO_MANIFESTACAO || manifestacao.tipoDetectado || manifestacao.tipo || '',
    categoria: manifestacao.CATEGORIA || manifestacao.categoria || '',
    subcategoria: manifestacao.SUBCATEGORIA || manifestacao.subcategoria || '',
    produto: manifestacao.PRODUTO || manifestacao.produto || '',
    setor: manifestacao.SETOR || manifestacao.setor || '',
    canal: manifestacao.CANAL_RECEBIMENTO || manifestacao.canal || '',
    risco: manifestacao.RISCO || manifestacao.risco || '',
    descricao: manifestacao.DESCRICAO || manifestacao.descricao || '',
    data: manifestacao.DATA_ABERTURA || manifestacao.dataAbertura || new Date().toISOString(),
  };

  await garantirAbas();
  const todasMatrizes = await sheets.lerAba(MC_SHEET, 2000).catch(() => []);

  // Filtrar apenas publicadas e vigentes
  const matricesPublicadas = todasMatrizes.filter(m =>
    m.STATUS === 'PUBLICADA' && vigente(m, ctx.data)
  );

  // Calcular aderência
  const comScore = matricesPublicadas
    .map(m => ({ ...m, _score: calcularAdherencia(m, ctx) }))
    .filter(m => m._score > 0)
    .sort((a, b) => b._score - a._score);

  const matrizesAplicaveis = comScore.slice(0, 5); // máximo 5 matrizes

  if (matrizesAplicaveis.length === 0) {
    return {
      status: 'SEM_MATRIZ',
      mensagem: 'Conhecimento específico não localizado.',
      matrizesAplicaveis: [],
      conhecimentosObrigatorios: [],
      conhecimentosComplementares: [],
      procedimentos: [],
      politicas: [],
      regras: [],
      faq: [],
      documentos: [],
      evidenciasNecessarias: [],
      necessitaAnaliseTecnica: false,
      setorDetentorConhecimento: [],
      excecoes: [],
      conflitos: [],
      versoesUtilizadas: [],
    };
  }

  // Carregar itens, evidências e exceções de todas as matrizes aplicáveis
  const [todosItens, todasEvidencias, todasExcecoes] = await Promise.all([
    sheets.lerAba(MC_ITENS_SHEET, 5000).catch(() => []),
    sheets.lerAba(MC_EVIDENCIAS_SHEET, 5000).catch(() => []),
    sheets.lerAba(MC_EXCECOES_SHEET, 5000).catch(() => []),
  ]);

  const idsMatrizes = new Set(matrizesAplicaveis.map(m => m.ID));
  const itensAtivos = todosItens.filter(i => idsMatrizes.has(i.MATRIZ_ID) && String(i.ATIVO).toUpperCase() !== 'NÃO');
  const evidenciasAtivas = todasEvidencias.filter(e => idsMatrizes.has(e.MATRIZ_ID) && String(e.ATIVO).toUpperCase() !== 'NÃO');
  const excecoesAtivas = todasExcecoes.filter(x => idsMatrizes.has(x.MATRIZ_ID) && String(x.ATIVO).toUpperCase() !== 'NÃO');

  // Separar obrigatórios vs complementares
  const obrigatorios = itensAtivos.filter(i => String(i.OBRIGATORIO).toUpperCase() === 'SIM');
  const complementares = itensAtivos.filter(i => String(i.OBRIGATORIO).toUpperCase() !== 'SIM');

  // Verificar conhecimentos obrigatórios ausentes (sem FONTE_ID)
  const obrigatoriosAusentes = obrigatorios.filter(i => !i.FONTE_ID || !i.TITULO);
  if (obrigatoriosAusentes.length > 0) {
    console.warn('[MatrizConhecimento] Conhecimentos obrigatórios sem fonte:', obrigatoriosAusentes.map(i => i.TITULO));
  }

  // Separar por tipo de fonte
  const porTipo = (lista, tipo) => lista.filter(i => i.TIPO_FONTE === tipo);
  const procedimentos = [...porTipo(obrigatorios, 'PROCEDIMENTO'), ...porTipo(complementares, 'PROCEDIMENTO')];
  const politicas = [...porTipo(obrigatorios, 'POLITICA'), ...porTipo(complementares, 'POLITICA')];
  const regras = [...porTipo(obrigatorios, 'REGRA'), ...porTipo(complementares, 'REGRA')];
  const faq = [...porTipo(obrigatorios, 'FAQ'), ...porTipo(complementares, 'FAQ')];
  const documentos = [...porTipo(obrigatorios, 'DOCUMENTO'), ...porTipo(complementares, 'DOCUMENTO'), ...porTipo(obrigatorios, 'INSTRUCAO_TECNICA'), ...porTipo(complementares, 'INSTRUCAO_TECNICA')];

  // Análise técnica (se qualquer matriz exigir)
  const necessitaAnaliseTecnica = matrizesAplicaveis.some(m => String(m.NECESSITA_ANALISE_TECNICA).toUpperCase() === 'SIM');
  const setoresAnalise = [...new Set(matrizesAplicaveis.filter(m => m.SETOR_ANALISE_TECNICA).map(m => m.SETOR_ANALISE_TECNICA))];
  const setoresDetentores = [...new Set(matrizesAplicaveis.filter(m => m.SETOR_DETENTOR_CONHECIMENTO).map(m => m.SETOR_DETENTOR_CONHECIMENTO))];

  // Detectar conflitos
  const conflitos = detectarConflitosConhecimento(itensAtivos);

  // Versões utilizadas
  const versoesUtilizadas = matrizesAplicaveis.map(m => ({
    matrizId: m.ID,
    codigo: m.CODIGO,
    nome: m.NOME,
    versao: m.VERSAO,
    score: m._score,
  }));

  return {
    status: conflitos.length > 0 ? 'CONFLITO_CONHECIMENTO' : (obrigatoriosAusentes.length > 0 ? 'CONHECIMENTO_OBRIGATORIO_AUSENTE' : 'CONHECIMENTO_RESOLVIDO'),
    matrizesAplicaveis: matrizesAplicaveis.map(m => ({ id: m.ID, codigo: m.CODIGO, nome: m.NOME, score: m._score, versao: m.VERSAO })),
    conhecimentosObrigatorios: obrigatorios.map(i => ({ id: i.ID, tipo: i.TIPO_FONTE, fonteId: i.FONTE_ID, titulo: i.TITULO, descricao: i.DESCRICAO, prioridade: i.PRIORIDADE, versao: i.VERSAO })),
    conhecimentosComplementares: complementares.map(i => ({ id: i.ID, tipo: i.TIPO_FONTE, fonteId: i.FONTE_ID, titulo: i.TITULO, descricao: i.DESCRICAO, prioridade: i.PRIORIDADE })),
    procedimentos: procedimentos.map(i => ({ id: i.FONTE_ID, titulo: i.TITULO, obrigatorio: i.OBRIGATORIO, prioridade: i.PRIORIDADE })),
    politicas: politicas.map(i => ({ id: i.FONTE_ID, titulo: i.TITULO, obrigatorio: i.OBRIGATORIO, prioridade: i.PRIORIDADE })),
    regras: regras.map(i => ({ id: i.FONTE_ID, titulo: i.TITULO, obrigatorio: i.OBRIGATORIO })),
    faq: faq.map(i => ({ id: i.FONTE_ID, titulo: i.TITULO })),
    documentos: documentos.map(i => ({ id: i.FONTE_ID, titulo: i.TITULO, tipo: i.TIPO_FONTE })),
    evidenciasNecessarias: evidenciasAtivas.map(e => ({ id: e.ID, titulo: e.TITULO, tipo: e.TIPO_EVIDENCIA, obrigatoria: e.OBRIGATORIA, descricao: e.DESCRICAO, condicao: e.CONDICAO })),
    necessitaAnaliseTecnica,
    setorAnaliseTecnica: setoresAnalise,
    setorDetentorConhecimento: setoresDetentores,
    excecoes: excecoesAtivas.map(x => ({ id: x.ID, tipo: x.TIPO_EXCECAO, condicao: x.CONDICAO, alternativo: x.CONHECIMENTO_ALTERNATIVO, observacao: x.OBSERVACAO })),
    conflitos,
    versoesUtilizadas,
    obrigatoriosAusentes: obrigatoriosAusentes.map(i => i.TITULO || i.ID),
    explicabilidade: gerarExplicabilidadeConhecimento(matrizesAplicaveis, ctx),
  };
}

function gerarExplicabilidadeConhecimento(matrizes, ctx) {
  if (!matrizes.length) return null;
  const motivos = [];
  if (ctx.empresa) motivos.push(`empresa = ${ctx.empresa}`);
  if (ctx.tipo) motivos.push(`tipo = ${ctx.tipo}`);
  if (ctx.categoria) motivos.push(`categoria = ${ctx.categoria}`);
  if (ctx.subcategoria) motivos.push(`subcategoria = ${ctx.subcategoria}`);
  if (ctx.produto) motivos.push(`produto = ${ctx.produto}`);
  if (ctx.setor) motivos.push(`setor = ${ctx.setor}`);
  return {
    contextoAplicado: motivos,
    matrizPrincipal: matrizes[0] ? { codigo: matrizes[0].CODIGO, nome: matrizes[0].NOME, versao: matrizes[0].VERSAO, score: matrizes[0]._score } : null,
    totalMatrizesAplicaveis: matrizes.length,
  };
}

// ──────────────────────────────────────────────────────────────
// AUDITORIA
// ──────────────────────────────────────────────────────────────

async function registrarAuditoria(manifestacaoId, resultado, usuario, brainVersion) {
  try {
    await garantirAbas();
    const obj = {
      ID: gerarId('MCA'),
      MANIFESTACAO_ID: manifestacaoId || '',
      MATRIZ_ID: resultado.matrizesAplicaveis?.[0]?.id || '',
      VERSAO: resultado.versoesUtilizadas?.map(v => `${v.codigo}@v${v.versao}`).join(';') || '',
      FONTES_CONSULTADAS: resultado.conhecimentosObrigatorios?.length + resultado.conhecimentosComplementares?.length || 0,
      CONHECIMENTOS_OBRIGATORIOS: resultado.conhecimentosObrigatorios?.map(k => k.titulo).join(';') || '',
      CONHECIMENTOS_COMPLEMENTARES: resultado.conhecimentosComplementares?.map(k => k.titulo).join(';') || '',
      EVIDENCIAS_ENCONTRADAS: resultado.evidenciasNecessarias?.filter(e => e.obrigatoria === 'SIM').map(e => e.titulo).join(';') || '',
      EVIDENCIAS_AUSENTES: resultado.obrigatoriosAusentes?.join(';') || '',
      CONFLITOS: resultado.conflitos?.length ? JSON.stringify(resultado.conflitos) : '',
      BRAIN_VERSION: brainVersion || '4.0.0',
      DATA: new Date().toISOString(),
      USUARIO: usuario || 'sistema',
    };
    await sheets.appendObjeto(MC_AUDIT_SHEET, obj);
  } catch (e) {
    console.warn('[MatrizConhecimento] Falha auditoria:', e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────

module.exports = {
  resolverConhecimento,
  listarMatrizes,
  obterMatriz,
  criarMatriz,
  atualizarMatriz,
  mudarStatusMatriz,
  listarItens,
  adicionarItem,
  removerItem,
  listarEvidencias,
  adicionarEvidencia,
  removerEvidencia,
  listarExcecoes,
  adicionarExcecao,
  registrarAuditoria,
  TIPOS_FONTE,
  PRIORIDADES_FONTE,
  STATUS_MATRIZ,
};
