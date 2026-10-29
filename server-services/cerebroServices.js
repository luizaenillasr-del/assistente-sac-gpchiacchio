'use strict';
// ============================================================
// CÉREBRO DO ASSISTENTE SAC — v4.0
// PostgreSQL (Neon/Prisma) como fonte primária.
// Google Sheets como fallback durante período de transição.
// ============================================================

const sheets = require('./sheets');
const tratativaEngine = require('./tratativaEngine');
const devolutivaEngine = require('./devolutivaEngine');
const matrizTratamento = require('./matrizTratamentoService');
const assertividade = require('./assertividadeService');
const aiService = require('./aiService');
const circaEngine = require('./circaEngine');

let manifestacaoRepo, conhecimentoRepo, prisma;
try {
  manifestacaoRepo = require('../database/repositories/manifestacaoRepository');
  conhecimentoRepo = require('../database/repositories/conhecimentoRepository');
  prisma = require('../database/connection');
} catch (e) {
  console.warn('Repositórios PG não disponíveis, usando Sheets:', e.message);
}

const CEREBRO_VERSION = '4.0.0';
const BASE_CONHECIMENTO_VERSION = '2.0';
const POLITICAS_VERSION = '2.0';
const MATRIZ_VERSION = '2.0';

// ──────────────────────────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────────────────────────

function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function campo(obj, nomes) {
  for (const nome of nomes) {
    if (obj && obj[nome] !== undefined && obj[nome] !== null && String(obj[nome]).trim() !== '') {
      return obj[nome];
    }
  }
  return '';
}

// Registros históricos são preservados para rastreabilidade, mas só podem
// alimentar o CIRCA quando possuem identidade, empresa e relato confiáveis.
// Isso impede que linhas incompletas (ou chaves formadas apenas por vazios e
// data) gerem reincidência, similaridade ou conhecimento confirmado.
function historicoIdConfiavel(row = {}) {
  return Boolean(String(campo(row, ['ID_HISTORICO', 'ORIG_ID_MANIFESTACAO', 'ID_MANIFESTACAO', 'PROTOCOLO', 'ID'])).trim());
}

function historicoIdentificador(row = {}) {
  return String(campo(row, ['ORIG_ID_MANIFESTACAO', 'ID_MANIFESTACAO', 'ID_HISTORICO', 'PROTOCOLO', 'ID'])).trim();
}

function historicoPodeAlimentarCirca(row = {}) {
  const status = normalizar(campo(row, ['STATUS_DADO', 'STATUS_HISTORICO']));
  if (status.includes('incomplet') || status.includes('incomplete') || status.includes('pendente')) return false;
  const empresa = campo(row, ['DRV_EMPRESA_NORMALIZADA', 'ORIG_EMPRESA', 'EMPRESA_RECLAMADA', 'EMPRESA']);
  const descricao = campo(row, ['ORIG_DESCRICAO_RECLAMACAO', 'DESCRICAO_RECLAMACAO', 'DESCRICAO']);
  return historicoIdConfiavel(row) && Boolean(String(empresa).trim()) && Boolean(String(descricao).trim());
}

function mesmaEmpresaCirca(a, b) {
  const na = normalizar(a), nb = normalizar(b);
  if (!na || !nb) return false;
  const ca = _empresaCodigoSimil(a), cb = _empresaCodigoSimil(b);
  return ca && cb ? ca === cb : na === nb;
}

const STOPWORDS = new Set([
  'a','o','e','de','da','do','das','dos','em','no','na','nos','nas',
  'um','uma','para','por','com','que','se','foi','ser','está','esta',
  'este','mais','mas','ou','não','nao','ao','à','as','os','é','do','da'
]);

function tokens(texto) {
  return new Set(
    normalizar(texto)
      .split(' ')
      .filter(p => p.length >= 3 && !STOPWORDS.has(p))
  );
}

function calcularSimilaridade(texto1, texto2) {
  const a = tokens(texto1);
  const b = tokens(texto2);
  if (!a.size || !b.size) return 0;
  let intersecao = 0;
  a.forEach(token => { if (b.has(token)) intersecao++; });
  const uniao = new Set([...a, ...b]).size;
  return uniao ? Math.round((intersecao / uniao) * 100) : 0;
}

// ──────────────────────────────────────────────────────────────
// 1. CASOS SIMILARES (PostgreSQL → fallback Sheets)
// ──────────────────────────────────────────────────────────────

// Mapa canônico de empresas (espelho do api/index.js para isolamento B2)
const _EMPRESA_MAP_SIMIL = {
  CHIACCHIO: ['chiacchio embalagens', 'chiachio embalagens', 'chiacchio'],
  PLASCHIO:  ['plaschio'],
  TUBAHIA:   ['tubahia', 'cesbap'],
  MASTER:    ['grupo chiacchio'],
};
function _empresaCodigoSimil(texto) {
  const n = String(texto||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
  if (!n) return null;
  for (const [cod, grafias] of Object.entries(_EMPRESA_MAP_SIMIL)) {
    if (grafias.some(g => n === g)) return cod;
  }
  return null;
}

async function buscarCasosSimilares(manifestacao, limite = 8, empresaFiltro = null) {
  const descricao = campo(manifestacao, ['DESCRICAO','DESCRIÇÃO','descricao','ORIG_DESCRICAO_RECLAMACAO','DESCRICAO_RECLAMACAO']);
  if (!descricao) return [];

  // B2/Item11: código canônico do usuário para filtrar resultado
  const userCod = _empresaCodigoSimil(empresaFiltro);

  function filtrarPorEmpresaSimil(items) {
    if (!userCod || userCod === 'MASTER') return items;
    return items.filter(item => {
      const empItem = item.empresa || '';
      const cod = _empresaCodigoSimil(empItem);
      return cod === userCod;
    });
  }

  try {
    // Tentar PostgreSQL primeiro — distinguir PG vazio de PG offline
    if (manifestacaoRepo) {
      let historico;
      try {
        historico = await manifestacaoRepo.buscarParaSimilaridade(2000);
      } catch (pgErr) {
        // PG offline ou erro de conexão — registrar e cair no fallback
        console.error('[PG] buscarParaSimilaridade falhou (PG offline?):', pgErr.message);
        historico = null; // null = offline; [] = vazio
      }
      if (historico !== null && historico.length > 0) {
        const mapeados = historico
          .map(h => {
            const dh = h.descricao || '';
            return {
              id: h.idOriginal || String(h.id),
              empresa: h.empresa?.nome || '',
              cliente: h.cliente?.nome || '',
              descricao: dh.slice(0, 300),
              tipo: h.tipo || '',
              setor: h.setor?.nome || '',
              tratativa: h.tratativas?.[0]?.descricaoTratativa || '',
              resultado: h.tratativas?.[0]?.resultado || '',
              data: h.criadaEm ? h.criadaEm.toISOString().split('T')[0] : '',
              protocolo: h.protocolo || h.idOriginal || String(h.id),
              similaridade: calcularSimilaridade(descricao, dh),
            };
          })
          .filter(c => c.similaridade >= 10);
        return filtrarPorEmpresaSimil(mapeados)
          .sort((a, b) => b.similaridade - a.similaridade)
          .slice(0, limite);
      }
      if (historico !== null && historico.length === 0) {
        // PG online mas vazio — registrar estado de sincronização
        console.info('[PG] buscarParaSimilaridade: PG online mas sem registros (aguardando sincronização). Usando Sheets.');
      }
    }
  } catch (e) {
    console.warn('[PG] Fallback Sheets para similares (erro inesperado):', e.message);
  }

  // Fallback: Google Sheets
  try {
    const historico = await sheets.lerAba('BANCO_HISTORICO', 5000);
    const mapeados = historico
      .filter(h => historicoPodeAlimentarCirca(h))
      .map(h => {
        const dh = campo(h, ['ORIG_DESCRICAO_RECLAMACAO','DESCRICAO_RECLAMACAO','DESCRICAO']);
        return {
          id: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']),
          empresa: campo(h, ['DRV_EMPRESA_NORMALIZADA','ORIG_EMPRESA','EMPRESA_RECLAMADA','EMPRESA']),
          cliente: campo(h, ['ORIG_CONTATO','EMPRESA_RECLAMANTE','CLIENTE']),
          descricao: dh.slice(0, 300),
          motivo: campo(h, ['ORIG_MOTIVO_RELATADO','MOTIVO_RELATADO_BRUTO','MOTIVO']),
          tipo: campo(h, ['COMP_TIPO_PROBLEMA_VALIDADO','TIPO_PROBLEMA_VALIDADO','TIPO']),
          causa: campo(h, ['COMP_CAUSA_PROVAVEL','CAUSA_RAIZ','CAUSA']),
          setor: campo(h, ['SETOR_RESPONSAVEL','SETOR']),
          tratativa: campo(h, ['TRATATIVA_REALIZADA','ORIG_TRATATIVA','TRATATIVA']),
          resultado: campo(h, ['RESULTADO','STATUS_FINAL','DESFECHO']),
          devolutiva: campo(h, ['DEVOLUTIVA_FINAL','ORIG_DEVOLUTIVA','DEVOLUTIVA']),
          data: campo(h, ['ORIG_DATA_ABERTURA','DATA_ABERTURA']),
          protocolo: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']),
          similaridade: calcularSimilaridade(descricao, dh),
        };
      })
      .filter(caso => caso.similaridade >= 10)
      .filter(caso => !empresaFiltro || mesmaEmpresaCirca(empresaFiltro, caso.empresa));
    return filtrarPorEmpresaSimil(mapeados)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, limite);
  } catch (erro) {
    console.error('Erro ao buscar casos similares:', erro.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// 2. REINCIDÊNCIA (PostgreSQL → fallback Sheets)
// ──────────────────────────────────────────────────────────────

async function detectarReincidencia(manifestacao) {
  const clienteNome = normalizar(campo(manifestacao, ['EMPRESA_RECLAMANTE','CLIENTE','CONTATO','nomeCliente']));
  const produto = normalizar(campo(manifestacao, ['PRODUTO','produto']));
  const idAtual = campo(manifestacao, ['ID_MANIFESTACAO','protocolo']);
  const empresaAtual = campo(manifestacao, ['EMPRESA_RECLAMADA','EMPRESA','empresa']);

  if (!clienteNome || !empresaAtual) return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] };

  try {
    if (prisma) {
      // Busca cliente por nome
      let empresaId;
      const empresaObj = await prisma.empresa.findFirst({
        where: { OR: [{ codigo: { equals: empresaAtual, mode: 'insensitive' } }, { nome: { equals: empresaAtual, mode: 'insensitive' } }] },
        select: { id: true },
      }).catch(() => null);
      empresaId = empresaObj?.id;
      if (!empresaId) return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] };
      const cliente = await prisma.cliente.findFirst({
        where: { nome: { contains: clienteNome, mode: 'insensitive' }, empresaId },
      });
      if (cliente) {
        const manifestacoes = await prisma.manifestacao.findMany({
          where: {
            clienteId: cliente.id,
            protocolo: idAtual ? { not: idAtual } : undefined,
          },
          orderBy: { criadaEm: 'desc' },
          take: 50,
          select: {
            id: true, protocolo: true, descricao: true, tipo: true,
            produto: true, criadaEm: true, status: true,
            tratativas: { select: { descricaoTratativa: true }, take: 1 },
          },
        });

        const comMesmoProblema = produto
          ? manifestacoes.filter(m => normalizar(m.produto || '').includes(produto.slice(0, 5)))
          : [];

        let nivel = 'SEM_REINCIDENCIA';
        if (comMesmoProblema.length >= 2) nivel = 'REINCIDENCIA_CONFIRMADA';
        else if (comMesmoProblema.length >= 1) nivel = 'POSSIVEL_REINCIDENCIA';

        return {
          nivel,
          detectada: comMesmoProblema.length > 0,
          quantidade: comMesmoProblema.length,
          quantidadeMesmoProblema: comMesmoProblema.length,
          fonte: 'postgresql',
          casos: comMesmoProblema.slice(0, 10).map(m => ({
            id: m.protocolo || String(m.id),
            data: m.criadaEm?.toISOString().split('T')[0],
            motivo: m.tipo,
            tratativa: m.tratativas?.[0]?.descricaoTratativa || '',
            produto: m.produto,
          })),
        };
      }
    }
  } catch (e) {
    console.warn('Fallback Sheets para reincidência:', e.message);
  }

  // Fallback Sheets
  try {
    const historico = await sheets.lerAba('MANIFESTACOES', 5000);
    const historicoBanco = await sheets.lerAba('BANCO_HISTORICO', 5000).catch(() => []);
    // A manifestação pode aparecer nas duas bases durante a transição. Use
    // o identificador persistido para não contar a mesma ocorrência duas vezes.
    const idsVistos = new Set();
    const todos = [
      ...historico.map(h => ({ ...h, __fonteCirca: 'MANIFESTACOES' })),
      ...historicoBanco.map(h => ({ ...h, __fonteCirca: 'BANCO_HISTORICO' })),
    ].filter(h => {
      const id = historicoIdentificador(h);
      if (h.__fonteCirca === 'BANCO_HISTORICO' && !historicoPodeAlimentarCirca(h)) return false;
      if (!historicoIdConfiavel(h)) return false;
      if (idsVistos.has(id)) return false;
      idsVistos.add(id);
      const empresaH = campo(h, ['DRV_EMPRESA_NORMALIZADA','ORIG_EMPRESA','EMPRESA_RECLAMADA','EMPRESA']);
      return mesmaEmpresaCirca(empresaAtual, empresaH);
    });

    const casos = todos.filter(h => {
      const cH = normalizar(campo(h, ['ORIG_CONTATO','EMPRESA_RECLAMANTE','CLIENTE','CONTATO']));
      const idH = campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']);
      return cH && cH === clienteNome && idH !== idAtual;
    });

    const casosComMesmoProblema = produto
      ? casos.filter(h => normalizar(campo(h, ['PRODUTO'])).includes(produto.slice(0, 5)))
      : [];

    let nivel = 'SEM_REINCIDENCIA';
    if (casosComMesmoProblema.length >= 2) nivel = 'REINCIDENCIA_CONFIRMADA';
    else if (casosComMesmoProblema.length >= 1) nivel = 'POSSIVEL_REINCIDENCIA';

    return {
      nivel,
      detectada: casosComMesmoProblema.length > 0,
      quantidade: casosComMesmoProblema.length,
      quantidadeMesmoProblema: casosComMesmoProblema.length,
      fonte: 'sheets',
      casos: casosComMesmoProblema.slice(-10).map(h => ({
        id: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO']),
        data: campo(h, ['ORIG_DATA_ABERTURA','DATA_ABERTURA']),
        motivo: campo(h, ['ORIG_MOTIVO_RELATADO','MOTIVO','TIPO']),
        causa: campo(h, ['CAUSA_RAIZ_VALIDADA','COMP_CAUSA_PROVAVEL','COMP_CAUSA_RAIZ','CAUSA_RAIZ','CAUSA']),
        tratativa: campo(h, ['TRATATIVA_REALIZADA','ORIG_TRATATIVA']),
        produto: campo(h, ['PRODUTO']),
      })),
    };
  } catch (erro) {
    console.error('Erro reincidência:', erro.message);
    return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] };
  }
}

// ──────────────────────────────────────────────────────────────
// 3. SLA
// ──────────────────────────────────────────────────────────────

// B4: Configuração centralizada de SLA — timezone Brasil, sem UTC implícito
const SLA_CONFIG = {
  timezone: process.env.SLA_TIMEZONE || 'America/Sao_Paulo',
  // Horas úteis (apenas referência para exibição; cálculo ainda em horas corridas)
  // Para cálculo em horas úteis reais, configure SLA_MODO=UTEIS e defina calendário externo
  modo: process.env.SLA_MODO || 'CORRIDO', // CORRIDO | UTEIS (futuro)
};

function calcularSLA(dataAbertura, slaHoras) {
  if (!dataAbertura || !slaHoras) return { status: 'SEM_SLA', prazoHoras: null, horasDecorridas: null, horasRestantes: null };
  const abertura = new Date(dataAbertura);
  if (isNaN(abertura)) return { status: 'SEM_SLA', prazoHoras: null, horasDecorridas: null, horasRestantes: null };

  const prazo = new Date(abertura.getTime() + Number(slaHoras) * 3600000);
  // B4: usar data atual corretamente (não UTC fixo)
  const agora = Date.now();
  const horasDecorridas = Math.round((agora - abertura.getTime()) / 3600000);
  const horasRestantes = Math.round((prazo.getTime() - agora) / 3600000);
  const percentDecorrido = Math.min(100, Math.round((horasDecorridas / Number(slaHoras)) * 100));

  let status;
  if (horasRestantes < 0) status = 'VENCIDO';
  else if (percentDecorrido >= 80) status = 'PROXIMO_DO_VENCIMENTO';
  else status = 'DENTRO_DO_PRAZO';

  // Formatar prazoFinal no timezone configurado para exibição
  let prazoFinalLocal;
  try {
    prazoFinalLocal = prazo.toLocaleString('pt-BR', { timeZone: SLA_CONFIG.timezone, dateStyle: 'short', timeStyle: 'short' });
  } catch (e) {
    prazoFinalLocal = prazo.toISOString();
  }

  return {
    status,
    prazoHoras: Number(slaHoras),
    horasDecorridas,
    horasRestantes,
    percentDecorrido,
    prazoFinal: prazo.toISOString(),
    prazoFinalLocal,
    timezone: SLA_CONFIG.timezone,
    modo: SLA_CONFIG.modo,
    setorResponsavel: 'SAC',
  };
}

// SLA configurável do banco
async function obterSlaConfigurado({ empresaId, setorId, tipo, categoria } = {}) {
  try {
    if (conhecimentoRepo) {
      const sla = await conhecimentoRepo.findSla({ empresaId, setorId, tipo, categoria });
      if (sla) return sla.prazoHoras;
    }
  } catch (e) { console.warn('[SLA] Falha ao consultar SLA no PG:', e.message); }

  // Fallback via Sheets
  try {
    const slaData = await sheets.lerAba('SLA_ESCALONAMENTO', 50).catch(() => []);
    const slaSetor = slaData.find(s => s.SETOR && s.SETOR.includes('SAC'));
    if (slaSetor) {
      const match = (slaSetor.SLA_PADRAO_HORAS || '72').match(/\d+/);
      if (match) return parseInt(match[0]);
    }
  } catch (e) { console.warn('[SLA] Falha ao consultar SLA_ESCALONAMENTO no Sheets:', e.message); }

  console.info('[SLA] Usando valor padrão de 72 horas (SLA_CONFIG não encontrado).');
  return 72; // padrão centralizado
}

// ──────────────────────────────────────────────────────────────
// 4. BASE DE CONHECIMENTO (PostgreSQL → fallback Sheets)
// ──────────────────────────────────────────────────────────────

async function consultarBaseConhecimento(tipo, setor, empresaId, descricao) {
  const relevantes = [];
  const idsVistos = new Set();

  function adicionarSeNovo(item) {
    const chave = item.fonte_aba + ':' + (item.id || item.nome || '');
    if (idsVistos.has(chave)) return;
    idsVistos.add(chave);
    relevantes.push(item);
  }

  try {
    if (conhecimentoRepo) {
      let setorId;
      if (setor && prisma) {
        const setorObj = await prisma.setor.findFirst({
          where: { nome: { contains: setor, mode: 'insensitive' } },
        });
        setorId = setorObj?.id;
      }

      const [politicas, procedimentos] = await Promise.all([
        conhecimentoRepo.findPoliticas({ empresaId, setorId }),
        conhecimentoRepo.findProcedimentos({ empresaId, setorId, tipo }),
      ]);

      politicas.forEach(p => adicionarSeNovo({
        tipo: 'Política', id: String(p.id), nome: p.nome, descricao: p.descricao,
        setor, versao: POLITICAS_VERSION, fonte: 'postgresql', fonte_aba: 'POLITICAS',
      }));
      procedimentos.forEach(p => adicionarSeNovo({
        tipo: 'Procedimento', id: String(p.id), nome: p.nome, passos: p.passos,
        setor, versao: BASE_CONHECIMENTO_VERSION, fonte: 'postgresql', fonte_aba: 'PROCEDIMENTOS',
      }));

      if (relevantes.length > 0) {
        return { status: 'CONHECIMENTO_RELEVANTE', itens: relevantes, total: relevantes.length, fonte: 'POSTGRESQL', versao: BASE_CONHECIMENTO_VERSION };
      }
    }
  } catch (e) {
    console.warn('Fallback Sheets para conhecimento:', e.message);
  }

  // Fallback Sheets — consulta POLITICAS, PROCEDIMENTOS, BASE_CONHECIMENTO
  // (FAQs), CAUSAS e o histórico sanitizado para hipóteses não confirmadas.
  try {
    const [politicas, procedimentos, faqs, causasTab, historicoTab] = await Promise.all([
      sheets.lerAba('POLITICAS', 200).catch(() => []),
      sheets.lerAba('PROCEDIMENTOS', 200).catch(() => []),
      sheets.lerAba('BASE_CONHECIMENTO', 500).catch(() => []),
      sheets.lerAba('CAUSAS', 500).catch(() => []),
      sheets.lerAba('BANCO_HISTORICO', 5000).catch(() => []),
    ]);

    const setorN = normalizar(setor || '');
    const tipoN = normalizar(tipo || '');
    const descN = normalizar(descricao || '');
    const tokensDesc = descN ? descN.split(' ').filter(t => t.length >= 4 && !STOPWORDS.has(t)) : [];

    politicas.forEach(p => {
      const setorP = normalizar(p.SETOR_RESPONSAVEL || p.SETOR || '');
      const ativo = (p.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      if (ativo && setorN && setorP && setorP.includes(setorN.split(' ')[0])) {
        adicionarSeNovo({ tipo: 'Política', id: p.ID_POLITICA || p.ID, nome: p.POLITICA || p.NOME, descricao: p.DESCRICAO || '', setor: p.SETOR_RESPONSAVEL || p.SETOR, versao: POLITICAS_VERSION, fonte: 'sheets', fonte_aba: 'POLITICAS' });
      }
    });
    procedimentos.forEach(p => {
      const setorP = normalizar(p.SETOR_RESPONSAVEL || p.SETOR || '');
      const tiposProc = normalizar(p.TIPO_RECLAMACAO || '');
      const ativo = (p.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      const matchSetor = setorN && setorP && setorP.includes(setorN.split(' ')[0]);
      const matchTipo = tipoN && tiposProc && tiposProc.includes(tipoN.split(' ')[0]);
      if (ativo && (matchSetor || matchTipo)) {
        adicionarSeNovo({ tipo: 'Procedimento', id: p.ID_PROCEDIMENTO || p.ID, nome: p.NOME, passos: p.PASSOS || '', setor: p.SETOR_RESPONSAVEL || p.SETOR, versao: BASE_CONHECIMENTO_VERSION, fonte: 'sheets', fonte_aba: 'PROCEDIMENTOS' });
      }
    });

    // FAQs da BASE_CONHECIMENTO — match por palavras-chave da descrição
    faqs.forEach(faq => {
      const ativo = (faq.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      if (!ativo) return;
      const pergunta = normalizar(faq.PERGUNTA || faq.TITULO || faq.NOME || '');
      const resposta = normalizar(faq.RESPOSTA || faq.CONTEUDO || faq.DESCRICAO || '');
      const textoFaq = pergunta + ' ' + resposta;
      const matchPalavras = tokensDesc.length > 0 && tokensDesc.some(t => textoFaq.includes(t));
      const matchTipo = tipoN && (pergunta.includes(tipoN.split(' ')[0]) || resposta.includes(tipoN.split(' ')[0]));
      if (matchPalavras || matchTipo) {
        adicionarSeNovo({ tipo: 'FAQ', id: faq.ID_FAQ || faq.ID || faq.TITULO, nome: faq.PERGUNTA || faq.TITULO || faq.NOME, descricao: faq.RESPOSTA || faq.CONTEUDO || '', setor: faq.SETOR || '', versao: BASE_CONHECIMENTO_VERSION, fonte: 'sheets', fonte_aba: 'BASE_CONHECIMENTO' });
      }
    });

    // Causas da CAUSAS tab — match por palavras-chave da descrição ou tipo
    causasTab.forEach(c => {
      const ativo = (c.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      if (!ativo) return;
      const causa = normalizar(c.CAUSA || '');
      const subcausa = normalizar(c.SUBCAUSA || '');
      const categoria = normalizar(c.CATEGORIA || '');
      const textoCausa = causa + ' ' + subcausa + ' ' + categoria;
      const matchPalavras = tokensDesc.length > 0 && tokensDesc.some(t => textoCausa.includes(t));
      const matchTipo = tipoN && textoCausa.includes(tipoN.split(' ')[0]);
      if (matchPalavras || matchTipo) {
        adicionarSeNovo({ tipo: 'Causa', id: c.ID_CAUSA || c.ID, nome: c.CAUSA, subcausa: c.SUBCAUSA || '', categoria: c.CATEGORIA || '', descricao: c.SUBCAUSA || c.CAUSA, setor: c.SETOR_RESPONSAVEL || '', versao: BASE_CONHECIMENTO_VERSION, fonte: 'sheets', fonte_aba: 'CAUSAS' });
      }
    });

    // O inventário encontrou o catálogo CAUSAS vazio, embora o histórico
    // contenha causas úteis. Elas entram somente como hipóteses históricas:
    // nunca são marcadas como confirmadas nem substituem uma decisão humana.
    historicoTab.filter(h => historicoPodeAlimentarCirca(h)).forEach(h => {
      const causa = campo(h, ['CAUSA_RAIZ_VALIDADA','COMP_CAUSA_PROVAVEL','COMP_CAUSA_RAIZ','CAUSA_RAIZ','CAUSA']);
      if (!causa) return;
      const subcausa = campo(h, ['COMP_SUBCAUSA','SUBCAUSA','SUBCAUSA_CONFIRMADA']);
      const categoria = campo(h, ['COMP_CATEGORIA','CATEGORIA','COMP_TIPO_PROBLEMA_VALIDADO','TIPO_PROBLEMA_VALIDADO']);
      const textoCausa = normalizar(`${causa} ${subcausa} ${categoria}`);
      const matchPalavras = tokensDesc.length > 0 && tokensDesc.some(t => textoCausa.includes(t));
      const matchTipo = tipoN && categoria && normalizar(categoria).includes(tipoN.split(' ')[0]);
      if (!matchPalavras && !matchTipo) return;
      const idHistorico = campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID','PROTOCOLO']);
      adicionarSeNovo({
        tipo: 'Causa',
        id: `${idHistorico || causa}:HIPOTESE`,
        nome: causa,
        subcausa,
        categoria,
        descricao: 'Hipótese derivada de caso histórico; requer validação humana.',
        setor: campo(h, ['SETOR_RESPONSAVEL','SETOR']),
        versao: BASE_CONHECIMENTO_VERSION,
        fonte: 'sheets',
        fonte_aba: 'BANCO_HISTORICO',
        nivel: 'HIPOTESE_HISTORICA',
        confirmada: false,
      });
    });
  } catch (e) {
    console.error('Erro base conhecimento:', e.message);
  }

  return {
    status: relevantes.length > 0 ? 'CONHECIMENTO_RELEVANTE' : 'CONHECIMENTO_INSUFICIENTE',
    itens: relevantes,
    total: relevantes.length,
    fonte: 'POLITICAS + PROCEDIMENTOS + BASE_CONHECIMENTO + CAUSAS + BANCO_HISTORICO (sheets)',
    versao: BASE_CONHECIMENTO_VERSION,
  };
}

// ──────────────────────────────────────────────────────────────
// 5. TRATATIVAS HARDCODED (F8 — ainda existem como fallback seguro)
// ──────────────────────────────────────────────────────────────

// REGRAS DE TRATATIVA — serão migradas para banco progressivamente.
// Enquanto o banco não tiver dados de regras, estas são o fallback determinístico.
const TRATATIVAS_POR_MOTIVO = [
  { palavras: ['arte','impressao','impressão','grafica','gráfica','layout','embalagem personalizada','especificacao','especificação','divergencia de arte'],
    sugestao: 'Solicitar ao cliente o arquivo da arte aprovada e comparar com amostra ou foto da embalagem reclamada. Acionar o setor responsável (arte/design/qualidade) para verificar se houve desvio na reprodução. Identificar responsabilidade (erro interno ou briefing do cliente) e definir prazo para reimpressão, crédito ou justificativa técnica.',
    acoes: ['Coletar amostra ou foto da embalagem reclamada','Localizar arte aprovada pelo cliente (arquivo e data de aprovação)','Comparar especificação aprovada vs. produto entregue','Identificar responsabilidade: erro interno vs. mudança não informada','Definir solução: reimpressão, crédito ou justificativa técnica'],
  },
  { palavras: ['atraso','entrega atrasada','prazo','fora do prazo','nao chegou','não chegou','nao recebeu','não recebeu'],
    sugestao: 'Verificar rastreamento do pedido junto à transportadora e identificar a etapa do atraso. Acionar comercial/logística para confirmar o novo prazo de entrega. Comunicar ao cliente com prazo confirmado e responsabilidade definida.',
    acoes: ['Identificar NF e transportadora responsável','Verificar rastreamento e localizar etapa do atraso','Contatar transportadora para posicionamento formal','Confirmar novo prazo com o cliente','Registrar ocorrência para análise de recorrência'],
  },
  { palavras: ['produto danificado','avaria','avariado','danificado','quebrado','amassado','violado'],
    sugestao: 'Solicitar fotos da embalagem e do produto danificado ao cliente. Acionar logística para apurar responsabilidade (dano em trânsito ou no armazém). Abrir ocorrência com a transportadora se dano for de transporte. Acionar qualidade para análise de lote se dano for de fabricação.',
    acoes: ['Solicitar fotos da embalagem e do produto','Verificar se dano é de fabricação ou transporte','Acionar logística/transportadora ou qualidade conforme resultado','Definir solução: reposição, crédito ou devolução'],
  },
  { palavras: ['nota fiscal','nf','faturamento','cobrança indevida','valor incorreto','divergencia de valor','divergência de valor'],
    sugestao: 'Solicitar NF(s) de referência ao cliente. Acionar faturamento para verificar valor cobrado versus valor acordado. Identificar origem da divergência e, se confirmada, emitir nota de crédito ou NF de correção no prazo.',
    acoes: ['Coletar NF(s) do cliente','Verificar valor acordado vs. valor faturado no sistema','Acionar faturamento para análise','Emitir crédito ou corrigir NF se pertinente'],
  },
  { palavras: ['quantidade','falta','faltou','faltando','volume','incompleto','pedido incompleto'],
    sugestao: 'Solicitar ao cliente lista dos itens recebidos e confrontar com o romaneio/NF. Verificar no sistema se houve separação parcial ou divergência de estoque. Acionar logística para verificar se volumes foram entregues. Definir complementação ou crédito.',
    acoes: ['Conferir NF vs. romaneio','Verificar registro de separação no sistema','Acionar logística para apurar entrega','Definir reposição, complementação ou crédito'],
  },
  { palavras: ['prazo de validade','validade','vencido','vencimento','expirado'],
    sugestao: 'Acionar Qualidade imediatamente para rastreabilidade do lote. Solicitar fotos do produto com data de validade visível. Verificar parâmetros do lote no controle de produção. Avaliar necessidade de recolhimento. Abrir RNC se houver desvio de processo.',
    acoes: ['Solicitar foto do produto com data visível','Acionar Qualidade para rastreabilidade do lote','Verificar lote no controle de produção','Avaliar alerta de recall se necessário','Abrir RNC'],
  },
  { palavras: ['reincidente','reincidência','reincidencia','novo problema','mesmo problema','ocorreu novamente','segunda vez'],
    sugestao: 'Identificar o histórico completo do cliente e o padrão de recorrência. Acionar o setor responsável com contexto de reincidência. Escalar para gerência se for 3ª ocorrência ou mais. Definir ação corretiva estruturada para evitar nova recorrência.',
    acoes: ['Mapear histórico completo do cliente','Identificar padrão/causa raiz da recorrência','Escalar para supervisão/gerência conforme frequência','Definir ação corretiva com prazo e responsável'],
  },
];

const TRATATIVAS_PADRAO = {
  'Qualidade': [
    'Acionar o setor de Qualidade para análise do lote indicado e abertura de RNC se confirmada não conformidade. Solicitar evidências fotográficas ao cliente e comparar com laudo de produção.',
    'Solicitar amostras retidas do lote reclamado e enviar para análise laboratorial interna.',
    'Verificar parâmetros de produção do lote no sistema e acionar supervisão da fábrica.',
  ],
  'Logística': [
    'Verificar rastreamento da entrega junto à transportadora, solicitar posicionamento formal e confirmar novo prazo com o cliente.',
    'Contatar transportadora para localizar volumes e reagendar entrega com o cliente.',
    'Emitir NF de substituição e acionar logística para envio imediato ao cliente.',
  ],
  'Financeiro': [
    'Solicitar NF de referência ao cliente e acionar faturamento para análise de divergência. Se confirmada, emitir nota de crédito ou corrigir a NF no prazo.',
    'Verificar no sistema a NF indicada e encaminhar análise para faturamento.',
  ],
  'Comercial': [
    'Contatar representante da região para alinhamento e verificar histórico do pedido. Acionar gerente de contas do cliente para definir solução.',
    'Verificar condições comerciais acordadas e acionar comercial para revisão de prazo e condições.',
  ],
  'SAC': [
    'Registrar a manifestação, acionar o setor responsável com contexto completo e comunicar previsão de retorno ao cliente com data confirmada.',
    'Coletar informações complementares (NF, lote, fotos) e encaminhar para análise técnica do setor responsável.',
  ],
};

// Tentar buscar regras do banco antes de usar hardcoded
async function buscarRegrasDeBanco(tipo, setor, descricao, empresaId) {
  if (!conhecimentoRepo) return null;
  try {
    const regras = await conhecimentoRepo.findRegras({ empresaId });
    if (!regras.length) return null;

    const textoBusca = normalizar((tipo || '') + ' ' + (descricao || ''));
    for (const regra of regras) {
      const palavras = (regra.palavrasGatilho || []).map(p => normalizar(p));
      if (palavras.some(p => textoBusca.includes(p))) {
        return { sugestao: regra.acao, acoes: [], confianca: 70, origem: 'BANCO_REGRAS' };
      }
    }
  } catch (e) { console.warn('[Cérebro] buscarRegrasDeBanco falhou:', e.message); }
  return null;
}

function gerarSugestaoTratativaDefault(tipo, setores, descricao) {
  const textoBusca = normalizar((tipo||'') + ' ' + (descricao||''));
  for (const regra of TRATATIVAS_POR_MOTIVO) {
    if (regra.palavras.some(p => textoBusca.includes(normalizar(p)))) {
      return { aplicavel: true, confianca: 50, sugestao: regra.sugestao, acoes: regra.acoes || [], quantidadeCasos: 0, evidencia: [], origem: 'PADRAO_ESPECIFICO', todasSugestoes: [regra.sugestao] };
    }
  }
  const setor = (Array.isArray(setores) ? setores[0] : setores) || 'SAC';
  const lista = TRATATIVAS_PADRAO[setor] || TRATATIVAS_PADRAO['SAC'];
  return { aplicavel: true, confianca: 30, sugestao: lista[0], acoes: [], quantidadeCasos: 0, evidencia: [], origem: 'PADRAO', todasSugestoes: lista };
}

function gerarSugestaoTratativa(casosSimilares, tipo, setores, descricao) {
  const comTratativa = casosSimilares.filter(c => c.tratativa && c.tratativa.trim());
  if (!comTratativa.length) return gerarSugestaoTratativaDefault(tipo, setores, descricao);
  const contagem = {};
  comTratativa.forEach(c => { const k = c.tratativa.trim(); contagem[k] = (contagem[k] || 0) + 1; });
  const ordenadas = Object.entries(contagem).sort((a, b) => b[1] - a[1]);
  const [tratativa, quantidade] = ordenadas[0];
  const confianca = Math.round((quantidade / comTratativa.length) * 100);
  return {
    aplicavel: true, confianca, sugestao: tratativa, quantidadeCasos: quantidade,
    evidencia: comTratativa.filter(c => c.tratativa.trim() === tratativa).slice(0, 5).map(c => ({ id: c.id, compatibilidade: c.similaridade, tratativa: c.tratativa, resultado: c.resultado })),
    origem: 'HISTORICO', todasSugestoes: ordenadas.slice(0,4).map(([t])=>t),
  };
}

// ──────────────────────────────────────────────────────────────
// 6. DEVOLUTIVA SUGERIDA
// ──────────────────────────────────────────────────────────────

function gerarDevolutiva(empresa, tipo, setor, tratativa) {
  const s = setor || 'nossos setores responsáveis';
  return `Prezado(a) cliente da ${empresa || 'empresa'},\n\nRecebemos seu relato referente a ${tipo || 'sua manifestação'} e registramos formalmente em nosso sistema.\n\nEncaminhamos o caso ao setor de ${s} para análise e providências.\n\nRetornaremos com um posicionamento completo dentro do prazo estabelecido.\n\nAgradecemos o contato e pedimos desculpas pelos transtornos causados.\n\nAtenciosamente,\nEquipe SAC — Grupo Chiacchio`;
}

// ──────────────────────────────────────────────────────────────
// 7. CONFIANÇA
// ──────────────────────────────────────────────────────────────

function calcularConfianca(dados) {
  let score = 0;
  const fatores = [];

  if (dados.regraAplicada) { score += 30; fatores.push('regra de roteamento identificada'); }
  if (dados.tipoDetectado && dados.tipoDetectado !== 'Não identificado' && dados.tipoDetectado !== 'nao identificado') {
    score += 10; fatores.push('tipo de manifestação identificado');
  }

  const qtdSimilares = dados.casosSimilares?.length || 0;
  if (qtdSimilares >= 5) { score += 25; fatores.push(`${qtdSimilares} casos históricos similares`); }
  else if (qtdSimilares >= 2) { score += 15; fatores.push(`${qtdSimilares} casos históricos similares`); }
  else if (qtdSimilares >= 1) { score += 8; fatores.push('1 caso histórico similar'); }

  const simTop = dados.casosSimilares?.[0]?.similaridade || 0;
  if (simTop >= 60) { score += 20; fatores.push(`${simTop}% de similaridade com caso histórico`); }
  else if (simTop >= 30) { score += 10; fatores.push(`${simTop}% de similaridade`); }

  if (dados.baseConhecimento?.total > 0) { score += 15; fatores.push('base de conhecimento com documentos relevantes'); }

  if (dados.ia?.disponivel && !dados.ia?.erro) { score = Math.min(score + 10, 100); fatores.push('análise de IA disponível'); }

  let nivel;
  if (score >= 70) nivel = 'ALTA';
  else if (score >= 40) nivel = 'MÉDIA';
  else nivel = 'BAIXA';

  return { nivel, score, fatores };
}

// ──────────────────────────────────────────────────────────────
// 8. CONFLITOS
// ──────────────────────────────────────────────────────────────

function detectarConflitos(dados) {
  const conflitos = [];
  const setorIA = normalizar(dados.ia?.setorSugerido || '');
  const setorRegra = normalizar(dados.setores?.[0] || '');
  if (setorIA && setorRegra && !setorIA.includes(setorRegra.split(' ')[0]) && !setorRegra.includes(setorIA.split(' ')[0])) {
    conflitos.push({ tipo: 'CONFLITO_SETOR', descricao: `IA sugere "${dados.ia?.setorSugerido}", regras indicam "${dados.setores?.[0]}"`, fonte1: { origem: 'IA', valor: dados.ia?.setorSugerido }, fonte2: { origem: 'REGRAS_ROTEAMENTO', valor: dados.setores?.[0] } });
  }
  const tipoIA = normalizar(dados.ia?.classificacao || '');
  const tipoRegra = normalizar(dados.tipoDetectado || '');
  const excluir = ['nao identificado', 'não identificado', ''];
  if (tipoIA && tipoRegra && !excluir.includes(tipoIA) && !excluir.includes(tipoRegra)) {
    if (!tipoIA.includes(tipoRegra.split(' ')[0]) && !tipoRegra.includes(tipoIA.split(' ')[0])) {
      conflitos.push({ tipo: 'CONFLITO_CLASSIFICACAO', descricao: `IA classifica como "${dados.ia?.classificacao}", regras identificaram "${dados.tipoDetectado}"`, fonte1: { origem: 'IA', valor: dados.ia?.classificacao }, fonte2: { origem: 'TIPOS_RECLAMACAO', valor: dados.tipoDetectado } });
    }
  }
  return conflitos;
}

// ──────────────────────────────────────────────────────────────
// 9. EXPLICABILIDADE
// ──────────────────────────────────────────────────────────────

function gerarExplicabilidade(dados) {
  const linhas = [];
  linhas.push(`[CLASSIFICAÇÃO] Tipo: ${dados.tipoDetectado || 'não identificado'} (confiança: ${dados.tipoConfianca || 0}%)`);
  if (dados.regraAplicada) linhas.push(`[ROTEAMENTO] Regra aplicada: ${dados.regraAplicada}`);
  else linhas.push('[ROTEAMENTO] Nenhuma regra específica encontrada — setor sugerido por palavras-chave da descrição');
  if (dados.setores?.length) linhas.push(`[DESTINO] Setor(es): ${dados.setores.join(', ')}`);
  if (dados.casosSimilares?.length) {
    linhas.push(`[HISTÓRICO] ${dados.casosSimilares.length} caso(s) semelhante(s) encontrado(s):`);
    dados.casosSimilares.slice(0, 3).forEach(c => linhas.push(`  • ${c.id} — ${c.similaridade}% similares — causa: ${c.causa || c.motivo || 'não registrada'}`));
  } else {
    linhas.push('[HISTÓRICO] Nenhum caso similar encontrado');
  }
  if (dados.reincidencia?.detectada) {
    linhas.push(`[REINCIDÊNCIA] ${dados.reincidencia.nivel}: ${dados.reincidencia.quantidade} ocorrência(s) anterior(es) para este cliente`);
  } else {
    linhas.push('[REINCIDÊNCIA] Sem reincidência detectada para este cliente');
  }
  if (dados.baseConhecimento?.total > 0) {
    linhas.push(`[CONHECIMENTO] ${dados.baseConhecimento.total} documento(s) relevante(s) — fonte: ${dados.baseConhecimento.fonte || 'desconhecida'}`);
  } else {
    linhas.push('[CONHECIMENTO] Base de conhecimento insuficiente para este tipo/setor');
  }
  if (dados.conflitos?.length) {
    linhas.push(`[CONFLITOS] ${dados.conflitos.length} conflito(s) detectado(s) — revisão humana recomendada`);
    dados.conflitos.forEach(c => linhas.push(`  • ${c.tipo}: ${c.descricao}`));
  }
  linhas.push(`[CONFIANÇA] Nível: ${dados.confianca?.nivel || 'BAIXA'} (${dados.confianca?.score || 0} pontos)`);
  return {
    resumo: linhas.join('\n'),
    linhas,
    versoesSistema: { cerebro: CEREBRO_VERSION, baseConhecimento: BASE_CONHECIMENTO_VERSION, politicas: POLITICAS_VERSION, matriz: MATRIZ_VERSION },
    geradaEm: new Date().toISOString(),
  };
}

// Remove perguntas sobre campos já preenchidos na manifestação
function _filtrarPerguntasContextuais(perguntas, manifestacao) {
  if (!perguntas || !perguntas.length) return perguntas;
  // Mapa de palavras-chave por campo preenchido
  const campoKeywords = {
    descricao: ['descricao','descrição','relato','ocorrência','problema'],
    produto: ['produto','material','item'],
    lote: ['lote','batch','rastreabilidade'],
    quantidade: ['quantidade','qtd','volume'],
    empresa: ['empresa','fornecedor','reclamada'],
    cliente: ['cliente','reclamante'],
    nfe: ['nota fiscal','nfe','nf '],
    categoria: ['categoria','tipo de','classificação'],
  };
  const preenchidos = new Set();
  const m = manifestacao;
  if (campo(m, ['descricao','DESCRICAO'])) preenchidos.add('descricao');
  if (campo(m, ['produto','PRODUTO'])) preenchidos.add('produto');
  if (campo(m, ['lote','LOTE'])) preenchidos.add('lote');
  if (campo(m, ['quantidade','QUANTIDADE'])) preenchidos.add('quantidade');
  if (campo(m, ['empresaReclamada','EMPRESA_RECLAMADA'])) preenchidos.add('empresa');
  if (campo(m, ['empresaReclamante','EMPRESA_RECLAMANTE'])) preenchidos.add('cliente');
  if (campo(m, ['nfe','NF_NUMERO','NFE'])) preenchidos.add('nfe');
  if (campo(m, ['categoria','CATEGORIA'])) preenchidos.add('categoria');

  return perguntas.filter(p => {
    const texto = normalizar(p.pergunta || '');
    for (const [campoNome, kws] of Object.entries(campoKeywords)) {
      if (preenchidos.has(campoNome) && kws.some(k => texto.includes(k))) return false;
    }
    return true;
  });
}

// ──────────────────────────────────────────────────────────────
// 10. CHAMADA IA — Usa aiService (F11 desacoplamento)
// ──────────────────────────────────────────────────────────────

async function chamarIA(contexto) {
  if (!aiService.isDisponivel()) {
    return { disponivel: false, motivo: 'AI_PROVIDER não configurado — análise determinística apenas' };
  }

  // C2: Sanitizar campos do usuário antes de incluir no prompt (evitar prompt injection)
  function _sanitizarCampoPrompt(v) {
    if (!v) return '';
    return String(v)
      .slice(0, 2000) // truncar campos longos
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // remover caracteres de controle
      .replace(/Ignore (all )?previous instructions?/gi, '[CONTEÚDO FILTRADO]')
      .replace(/You are now/gi, '[CONTEÚDO FILTRADO]')
      .replace(/SYSTEM:/gi, '[CONTEÚDO FILTRADO]')
      .trim();
  }

  const m = contexto.manifestacao;
  const dadosManifestacao = {
    descricao: _sanitizarCampoPrompt(m.descricao || m.DESCRICAO),
    empresa: _sanitizarCampoPrompt(m.empresaReclamada || m.EMPRESA_RECLAMADA),
    cliente: _sanitizarCampoPrompt(m.empresaReclamante || m.EMPRESA_RECLAMANTE),
    canal: _sanitizarCampoPrompt(m.canal || m.CANAL || m.origem || m.ORIGEM),
    produto: _sanitizarCampoPrompt(m.produto || m.PRODUTO),
    lote: _sanitizarCampoPrompt(m.lote || m.LOTE),
    quantidade: _sanitizarCampoPrompt(String(m.quantidade || m.QUANTIDADE || '')),
    categoria: _sanitizarCampoPrompt(m.categoria || m.CATEGORIA),
    subcategoria: _sanitizarCampoPrompt(m.subcategoria || m.SUBCATEGORIA),
    nomeContato: _sanitizarCampoPrompt(m.nomeCliente || m.NOME_CONTATO || m.CONTATO),
    dataAbertura: _sanitizarCampoPrompt(m.dataAbertura || m.DATA_ABERTURA || m.DATA_CRIACAO),
    tipo: _sanitizarCampoPrompt(m.tipo || m.TIPO),
  };

  // Lista de campos já preenchidos — a IA não deve perguntar sobre eles
  const camposPreenchidos = Object.entries(dadosManifestacao)
    .filter(([, v]) => v && v !== 'DADO_NAO_ENCONTRADO')
    .map(([k]) => k);

  const prompt = `Você é o módulo de IA do Assistente SAC do Grupo Chiacchio (fabricante de embalagens e produtos plásticos). Analise a manifestação e responda SOMENTE em JSON válido, sem texto adicional.

MANIFESTAÇÃO (campos já preenchidos na ficha: ${camposPreenchidos.join(', ')}):
${JSON.stringify(dadosManifestacao, null, 2)}

CONTEXTO DO SISTEMA:
- Tipo identificado pelas regras: ${contexto.tipoDetectado || 'não identificado'}
- Setores sugeridos: ${(contexto.setores || []).join(', ') || 'nenhum'}
- Casos similares (${contexto.casosSimilares?.length || 0} encontrados): ${JSON.stringify((contexto.casosSimilares || []).slice(0, 3).map(c => ({ id: c.id, similaridade: c.similaridade, causa: c.causa, tratativa: c.tratativa })))}
- Reincidência: ${contexto.reincidencia?.nivel || 'SEM_REINCIDENCIA'} (${contexto.reincidencia?.quantidade || 0} ocorrência(s))
- SLA: ${contexto.sla?.status || 'SEM_SLA'} — ${contexto.sla?.horasRestantes != null ? contexto.sla.horasRestantes + 'h restantes' : 'sem dados'}
- Conhecimento relevante (${contexto.baseConhecimento?.total || 0} documentos)
${contexto.matrizConhecimento && contexto.matrizConhecimento.status === 'RESOLVIDA' ? `- Matriz de Conhecimento aplicável: ${contexto.matrizConhecimento.matrizes?.length || 0} matriz(es) encontrada(s). Itens de conhecimento: ${JSON.stringify((contexto.matrizConhecimento.itensConhecimento || []).slice(0, 5).map(i => ({ tipo: i.TIPO_FONTE, conteudo: (i.CONTEUDO || '').slice(0, 200) })))}` : '- Matriz de Conhecimento: nenhuma aplicável ao caso'}

REGRAS OBRIGATÓRIAS:
1. NÃO invente informações. Use "DADO_NAO_ENCONTRADO" quando não souber.
2. NÃO crie políticas nem regras que não existam no contexto.
3. NÃO tome decisões irreversíveis. Recomende, não decida.
4. A decisão final é sempre do humano.
5. SAC NÃO gera RNC automaticamente. Apenas reincidência confirmada pode sugerir investigação.
6. "informacoesAusentes" deve listar APENAS dados não presentes na ficha. NÃO pergunte sobre: ${camposPreenchidos.join(', ')}.
7. "problemaIdentificado" deve ser específico ao caso, não genérico.
8. "acaoImediata" deve ser concreta (ex: "Acionar Qualidade para inspecionar lote X"), não vaga.

Responda com este JSON exato:
{
  "classificacao": "string",
  "problemaIdentificado": "descrição específica do problema concreto identificado na manifestação",
  "causaProvavel": "string ou DADO_NAO_ENCONTRADO",
  "nivelCausa": "FATO|HIPÓTESE|RISCO|INFORMAÇÃO_PENDENTE",
  "impactoOperacional": "como isso afeta o cliente/operação",
  "evidencias": ["string"],
  "setorSugerido": "string",
  "risco": "BAIXO|MÉDIO|ALTO",
  "acaoImediata": "o que o SAC deve fazer agora (ação concreta e executável)",
  "tratamentoRecomendado": "string",
  "justificativa": "string",
  "devolutivaSugerida": "string",
  "informacoesAusentes": ["somente o que não está na ficha e é necessário para a análise"],
  "nivelConfianca": 0
}`;

  try {
    const resultado = await aiService.chamar(prompt, { contexto: 'analise_manifestacao', timeout: 15000 });
    if (!resultado.disponivel) return resultado;

    const json = aiService.extrairJSON(resultado.texto);
    if (!json) return { disponivel: true, erro: 'Resposta fora do formato JSON', raw: resultado.texto?.slice(0, 500) };

    return {
      disponivel: true,
      modelo: resultado.modelo,
      tokensEntrada: resultado.tokensEntrada,
      tokensSaida: resultado.tokensSaida,
      provider: resultado.provider,
      ...json,
    };
  } catch (e) {
    return { disponivel: true, erro: e.message };
  }
}

// ──────────────────────────────────────────────────────────────
// 11. AUDITORIA (PostgreSQL → fallback Sheets)
// ──────────────────────────────────────────────────────────────

async function registrarAuditoriaAnalise(protocolo, usuario, analise) {
  // Tentar salvar no PostgreSQL
  if (prisma) {
    try {
      await prisma.logAnalise.create({
        data: {
          protocolo: protocolo || '',
          usuario: usuario || 'sistema',
          versaoCerebro: CEREBRO_VERSION,
          tipoDetectado: analise.tipoDetectado || '',
          setores: (analise.setores || []).join(', '),
          similaresEncontrados: analise.casosSimilares?.length || 0,
          reincidencia: analise.reincidencia?.nivel || 'SEM_REINCIDENCIA',
          slaStatus: analise.sla?.status || 'SEM_SLA',
          confiancaNivel: analise.confianca?.nivel || 'BAIXA',
          confiancaScore: analise.confianca?.score || 0,
          iaDisponivel: analise.ia?.disponivel || false,
          iaModelo: analise.ia?.modelo || null,
          iaTokensEntrada: analise.ia?.tokensEntrada || 0,
          iaTokensSaida: analise.ia?.tokensSaida || 0,
          conflitos: analise.conflitos?.length || 0,
          necessitaValidacao: analise.necessitaValidacaoHumana || false,
          tempoMs: analise.tempoMs || 0,
          erros: (analise.erros || []).join('; ') || null,
        },
      });
      return;
    } catch (e) {
      console.warn('Falha auditoria PG, usando Sheets:', e.message);
    }
  }

  // Fallback Sheets
  try {
    await sheets.garantirAbaComCabecalhos('LOG_ANALISES', [
      'TIMESTAMP','PROTOCOLO','USUARIO','VERSAO_CEREBRO','TIPO_DETECTADO','SETORES',
      'SIMILARES_ENCONTRADOS','REINCIDENCIA','SLA_STATUS','CONFIANCA_NIVEL','CONFIANCA_SCORE',
      'IA_DISPONIVEL','IA_MODELO','IA_TOKENS_ENTRADA','IA_TOKENS_SAIDA',
      'CONFLITOS','NECESSITA_VALIDACAO','TEMPO_MS','ERROS',
    ]).catch(() => {});

    await sheets.appendObjeto('LOG_ANALISES', {
      TIMESTAMP: new Date().toISOString(), PROTOCOLO: protocolo || '', USUARIO: usuario || 'sistema',
      VERSAO_CEREBRO: CEREBRO_VERSION, TIPO_DETECTADO: analise.tipoDetectado || '',
      SETORES: (analise.setores || []).join(', '), SIMILARES_ENCONTRADOS: analise.casosSimilares?.length || 0,
      REINCIDENCIA: analise.reincidencia?.nivel || 'SEM_REINCIDENCIA', SLA_STATUS: analise.sla?.status || 'SEM_SLA',
      CONFIANCA_NIVEL: analise.confianca?.nivel || 'BAIXA', CONFIANCA_SCORE: analise.confianca?.score || 0,
      IA_DISPONIVEL: analise.ia?.disponivel ? 'SIM' : 'NÃO', IA_MODELO: analise.ia?.modelo || '',
      IA_TOKENS_ENTRADA: analise.ia?.tokensEntrada || 0, IA_TOKENS_SAIDA: analise.ia?.tokensSaida || 0,
      CONFLITOS: analise.conflitos?.length || 0, NECESSITA_VALIDACAO: analise.necessitaValidacaoHumana ? 'SIM' : 'NÃO',
      TEMPO_MS: analise.tempoMs || 0, ERROS: analise.erros?.join('; ') || '',
    }).catch(() => {});
  } catch (e) {
    console.error('Erro ao registrar auditoria de análise:', e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// 12. ANÁLISE COMPLETA v4.0
// ──────────────────────────────────────────────────────────────

async function analisarManifestacaoCompleta(manifestacao, regras = {}, usuario = 'sistema') {
  const inicio = Date.now();
  const erros = [];

  const descricao = campo(manifestacao, ['descricao','DESCRICAO','DESCRICAO_RECLAMACAO']);
  const informacoesAusentes = [];
  if (!descricao) informacoesAusentes.push('DESCRICAO');
  if (!campo(manifestacao, ['empresa','EMPRESA_RECLAMADA','empresaReclamada'])) informacoesAusentes.push('EMPRESA_RECLAMADA');
  if (!campo(manifestacao, ['cliente','EMPRESA_RECLAMANTE','empresaReclamante'])) informacoesAusentes.push('EMPRESA_RECLAMANTE');
  if (!campo(manifestacao, ['canal','CANAL','ORIG_CANAL','CANAL_RECEBIMENTO','origem','ORIGEM'])) informacoesAusentes.push('CANAL');

  const protocolo = campo(manifestacao, ['protocolo','ID_MANIFESTACAO']);
  const setor = regras.setores?.[0] || '';
  const tipo = regras.tipoDetectado || '';
  const dataAbertura = campo(manifestacao, ['dataAbertura','DATA_ABERTURA','DATA_CRIACAO']);

  const empresaManif = campo(manifestacao, ['empresaReclamada','EMPRESA_RECLAMADA']);
  const [casosSimilares, reincidencia, baseConhecimento] = await Promise.all([
    buscarCasosSimilares(manifestacao, 8, empresaManif).catch(e => { erros.push('similares: ' + e.message); return []; }),
    detectarReincidencia(manifestacao).catch(e => { erros.push('reincidencia: ' + e.message); return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] }; }),
    consultarBaseConhecimento(tipo, setor, undefined, descricao).catch(e => { erros.push('conhecimento: ' + e.message); return { status: 'CONHECIMENTO_INSUFICIENTE', itens: [], total: 0 }; }),
  ]);

  const sla = calcularSLA(dataAbertura, regras.slaHoras || 72);
  const tratativa = gerarSugestaoTratativa(casosSimilares, tipo, regras.setores, descricao);

  // Busca modelos de devolutiva aprovados e setores competentes em paralelo
  const [modelosDevolutiva, setoresConfig] = await Promise.all([
    sheets.lerAba('MODELOS_DEVOLUTIVA', 200).catch(() => []),
    sheets.lerAba('CONFIG_SETORES', 500).catch(() => []),
  ]);

  // Setores relevantes a partir de CONFIG_SETORES (match por tipo/categoria)
  const tipoN = normalizar(tipo || '');
  const setoresRecomendadosConfig = setoresConfig
    .filter(s => {
      const ativo = (s.ATIVO || 'SIM').toUpperCase() !== 'EXCLUIDO' && (s.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      if (!ativo) return false;
      const resp = normalizar(s.RESPONSABILIDADES || s.REGRAS_OPERACIONAIS || '');
      return tipoN && resp && resp.includes(tipoN.split(' ')[0]);
    })
    .map(s => s.SETOR)
    .filter(Boolean);

  // Modelo de devolutiva aprovado mais relevante para o tipo/empresa
  const _cNrm = v => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/_/g, ' ').trim();
  const modeloAprovado = modelosDevolutiva.find(m => {
    const st = _cNrm(m.STATUS || '');
    const aprovado = st === 'aprovada' || st === 'publicada' || st === 'aprovado';
    if (!aprovado) return false;
    const tipoMod = normalizar(m.TIPO_MANIFESTACAO || '');
    const empMod = normalizar(m.EMPRESA || '');
    const matchTipo = !tipoMod || !tipoN || tipoMod.includes(tipoN.split(' ')[0]) || tipoN.includes(tipoMod.split(' ')[0]);
    const matchEmp = !empMod || !empresaManif || normalizar(empresaManif).includes(empMod.split(' ')[0]);
    return matchTipo && matchEmp;
  });
  const devolutivaModelo = modeloAprovado ? (modeloAprovado.TEXTO_PADRAO || '') : null;

  const matrizConhecimento = manifestacao.matrizConhecimento || null;
  const contextoIA = { manifestacao, tipoDetectado: tipo, setores: regras.setores || [], casosSimilares, reincidencia, sla, baseConhecimento, matrizConhecimento };
  const ia = await chamarIA(contextoIA).catch(e => { erros.push('ia: ' + e.message); return { disponivel: false, erro: e.message }; });
  // A resposta do modelo pode repetir um campo como ausente mesmo quando o
  // formulário o preencheu. Filtre somente contra os valores canônicos antes
  // de expor o resultado ao frontend.
  if (ia && Array.isArray(ia.informacoesAusentes)) {
    const preenchidos = new Set([
      ['DESCRICAO', descricao],
      ['EMPRESA_RECLAMADA', campo(manifestacao, ['empresa','EMPRESA_RECLAMADA','empresaReclamada'])],
      ['EMPRESA_RECLAMANTE', campo(manifestacao, ['cliente','EMPRESA_RECLAMANTE','empresaReclamante'])],
      ['CANAL', campo(manifestacao, ['canal','CANAL','ORIG_CANAL','CANAL_RECEBIMENTO','origem','ORIGEM'])],
    ].filter(([, valor]) => String(valor || '').trim()).map(([nome]) => nome));
    ia.informacoesAusentes = ia.informacoesAusentes.filter(item => {
      const chave = normalizar(item).replace(/\s+/g, '_').toUpperCase();
      if (preenchidos.has(chave)) return false;
      // Modelos podem devolver frases ("canal de recebimento ausente") em
      // vez do nome da coluna. Remova somente a indicação correspondente a
      // um valor realmente preenchido, sem inventar um valor para a ficha.
      if (preenchidos.has('DESCRICAO') && (chave.includes('DESCRICAO') || chave.includes('RELATO'))) return false;
      if (preenchidos.has('CANAL') && chave.includes('CANAL')) return false;
      if (preenchidos.has('EMPRESA_RECLAMADA') && chave.includes('EMPRESA')) return false;
      if (preenchidos.has('EMPRESA_RECLAMANTE') && (chave.includes('CLIENTE') || chave.includes('CONTATO') || chave.includes('RECLAMANTE'))) return false;
      return true;
    });
  }

  const empresa = campo(manifestacao, ['empresaReclamada','EMPRESA_RECLAMADA']);
  const reincidenteBool = reincidencia.nivel === 'REINCIDENCIA_CONFIRMADA';

  let tratativaEstruturada = null;
  try {
    tratativaEstruturada = await tratativaEngine.gerarTratativaEstruturada({
      manifestacao: { ...manifestacao, DESCRICAO: descricao, EMPRESA_RECLAMADA: empresa, DATA_ABERTURA: campo(manifestacao, ['DATA_ABERTURA','dataAbertura']) || '', PRODUTO: campo(manifestacao, ['PRODUTO','produto']) || '', CATEGORIA: campo(manifestacao, ['CATEGORIA','categoria']) || '', SUBCATEGORIA: campo(manifestacao, ['SUBCATEGORIA','subcategoria']) || '' },
      classificacao: tipo, empresa, cliente: campo(manifestacao, ['CONTATO','NOME_CONTATO','nomeCliente']) || '',
      setor, prioridade: regras.prioridade || 'Média', casosSimilares, reincidencia, sla,
      iaResultado: ia || {}, usuario: campo(manifestacao, ['USUARIO_CRIACAO','usuario']) || 'sistema',
      versaoCerebro: CEREBRO_VERSION,
    });
  } catch (e) { erros.push('tratativaEngine: ' + e.message); }

  let devolutivaEstruturada = null;
  try {
    devolutivaEstruturada = await devolutivaEngine.gerarDevolutiva({
      idManifestacao: protocolo, tipo: 'RECEBIMENTO', empresa, tipoManifestacao: tipo,
      categoria: campo(manifestacao, ['CATEGORIA','categoria']) || '',
      subcategoria: campo(manifestacao, ['SUBCATEGORIA','subcategoria','SUBCAUSA','SUBCAUSA_CONFIRMADA']) || '',
      causa: campo(manifestacao, ['CAUSA_RAIZ_CONFIRMADA','CAUSA_RAIZ_VALIDADA','CAUSA_RAIZ','CAUSA']) || ia?.causaProvavel || '',
      subcausa: campo(manifestacao, ['SUBCAUSA_CONFIRMADA','SUBCAUSA']) || '',
      setor, protocolo,
      prazo: (regras.slaHoras || 72) + ' horas úteis', setorResponsavel: setor || regras.setores?.[0] || 'SAC',
      reincidente: reincidenteBool, prioridade: regras.prioridade || 'Média',
      diagnostico: tratativaEstruturada?.diagnostico?.descricao || '',
    });
  } catch (e) { erros.push('devolutivaEngine: ' + e.message); }

  // Prioridade: 1) devolutiva de caso histórico similar, 2) modelo aprovado do banco, 3) IA como complemento, 4) template estruturado
  const devolutivaHistorica = casosSimilares?.find(c => c.devolutiva && c.devolutiva.trim().length > 20 && c.similaridade >= 30)?.devolutiva || null;
  const devolutiva = devolutivaHistorica ||
    (devolutivaModelo && devolutivaModelo.trim().length > 20 ? devolutivaModelo : null) ||
    (ia?.devolutivaSugerida && !ia.erro ? ia.devolutivaSugerida : null) ||
    (devolutivaEstruturada?.textoGerado || gerarDevolutiva(campo(manifestacao, ['empresaReclamante','EMPRESA_RECLAMANTE']), tipo, setor, tratativa.sugestao));
  const origemDevolutiva = devolutivaHistorica ? 'HISTORICO' : (devolutivaModelo && devolutivaModelo.trim().length > 20 ? 'MODELO_APROVADO' : (ia?.devolutivaSugerida && !ia.erro ? 'IA' : 'TEMPLATE'));

  const dadosParaConfianca = { regraAplicada: regras.regraAplicada, tipoDetectado: tipo, tipoConfianca: regras.tipoConfianca, casosSimilares, baseConhecimento, ia };
  const confianca = calcularConfianca(dadosParaConfianca);
  const conflitos = detectarConflitos({ ...regras, casosSimilares, reincidencia, ia });

  if (tratativaEstruturada?.conflitos?.length) {
    conflitos.push(...tratativaEstruturada.conflitos.map(c => ({ tipo: 'CONFLITO_TRATATIVA', descricao: c })));
  }

  const necessitaValidacaoHumana = confianca.nivel === 'BAIXA' || conflitos.length > 0 || reincidencia.nivel === 'REINCIDENCIA_CONFIRMADA' || tratativaEstruturada?.necessitaAprovacao;

  const setoresFinais = [
    ...(regras.setores || []),
    ...setoresRecomendadosConfig.filter(s => !(regras.setores || []).includes(s)),
  ].filter(Boolean).slice(0, 5);
  const hipotesesClassificacao = circaEngine.classificarHipoteses(manifestacao);
  const limitacoes = [];
  if (!regras.regraAplicada && !setoresFinais.length) {
    limitacoes.push('Nenhuma regra ou setor elegível foi encontrado nas bases canônicas; a classificação e o encaminhamento dependem de decisão humana.');
  }

  const analise = {
    protocolo, tipoDetectado: tipo, tipoConfianca: regras.tipoConfianca || 0,
    setores: setoresFinais, regraAplicada: regras.regraAplicada || null,
    hipotesesClassificacao,
    limitacoes,
    setoresRecomendadosConfig,
    prioridade: regras.prioridade || 'Média', slaHoras: regras.slaHoras || 72,
    geraRNC: false, // RNC nunca automático — apenas por critério humano/auditoria
    procedimentoSugerido: regras.procedimentoSugerido || null, perguntasNecessarias: _filtrarPerguntasContextuais(regras.perguntasNecessarias || [], manifestacao),
    casosSimilares, reincidencia, sla, baseConhecimento,
    tratativaSugerida: { aplicavel: tratativa.aplicavel, confianca: tratativa.confianca, sugestao: tratativa.sugestao, quantidadeCasos: tratativa.quantidadeCasos, evidencia: tratativa.evidencia, origem: tratativa.origem||'HISTORICO', todasSugestoes: tratativa.todasSugestoes||[] },
    tratativaEstruturada, devolutivaEstruturada, ia, confianca, conflitos,
    informacoesAusentes, devolutivaSugerida: devolutiva, origemDevolutiva,
    modeloDevolutivaId: modeloAprovado ? (modeloAprovado.ID_MODELO || '') : null,
    necessitaValidacaoHumana,
    explicabilidade: null,
    versoes: { cerebro: CEREBRO_VERSION, baseConhecimento: BASE_CONHECIMENTO_VERSION, politicas: POLITICAS_VERSION, matriz: MATRIZ_VERSION },
    tempoMs: Date.now() - inicio, erros, geradaEm: new Date().toISOString(),
    versaoIA: CEREBRO_VERSION,
  };

  analise.explicabilidade = gerarExplicabilidade(analise);
  registrarAuditoriaAnalise(protocolo, usuario, analise).catch(() => {});

  return analise;
}

async function analisarManifestacao(manifestacao, regras = {}) {
  return analisarManifestacaoCompleta(manifestacao, regras, 'sistema');
}

// ──────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────

module.exports = {
  normalizar,
  historicoIdConfiavel,
  historicoIdentificador,
  historicoPodeAlimentarCirca,
  mesmaEmpresaCirca,
  calcularSimilaridade,
  buscarCasosSimilares,
  detectarReincidencia,
  gerarSugestaoTratativa,
  gerarDevolutiva,
  calcularSLA,
  obterSlaConfigurado,
  consultarBaseConhecimento,
  calcularConfianca,
  detectarConflitos,
  gerarExplicabilidade,
  chamarIA,
  analisarManifestacao,
  analisarManifestacaoCompleta,
  tratativaEngine,
  devolutivaEngine,
  assertividade,
  matrizTratamento,
  CEREBRO_VERSION,
};
