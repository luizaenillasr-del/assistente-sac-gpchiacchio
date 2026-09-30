'use strict';
// ============================================================
// CÉREBRO DO ASSISTENTE SAC — v3.0
// Módulo central de inteligência: análise, rastreabilidade,
// regras, histórico, conhecimento, IA e validação humana.
// ============================================================

const sheets = require('./sheets');
const tratativaEngine = require('./tratativaEngine');
const devolutivaEngine = require('./devolutivaEngine');
const matrizTratamento = require('./matrizTratamentoService');
const assertividade = require('./assertividadeService');

const CEREBRO_VERSION = '3.0.0';
const BASE_CONHECIMENTO_VERSION = '1.0';
const POLITICAS_VERSION = '1.0';
const MATRIZ_VERSION = '1.0';

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
// 1. CASOS SIMILARES
// ──────────────────────────────────────────────────────────────

async function buscarCasosSimilares(manifestacao, limite = 8) {
  try {
    const historico = await sheets.lerAba('BANCO_HISTORICO', 5000);
    const descricao = campo(manifestacao, ['DESCRICAO','DESCRIÇÃO','ORIG_DESCRICAO_RECLAMACAO','DESCRICAO_RECLAMACAO','MOTIVO_RELATADO_BRUTO']);
    if (!descricao) return [];
    return historico
      .filter(h => campo(h, ['ORIG_DESCRICAO_RECLAMACAO','DESCRICAO_RECLAMACAO','DESCRICAO']))
      .map(h => {
        const dh = campo(h, ['ORIG_DESCRICAO_RECLAMACAO','DESCRICAO_RECLAMACAO','DESCRICAO']);
        return {
          id: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']),
          empresa: campo(h, ['ORIG_EMPRESA','EMPRESA_RECLAMADA','EMPRESA']),
          cliente: campo(h, ['ORIG_CONTATO','EMPRESA_RECLAMANTE','CLIENTE']),
          descricao: dh.slice(0, 300),
          motivo: campo(h, ['ORIG_MOTIVO_RELATADO','MOTIVO_RELATADO_BRUTO','MOTIVO']),
          tipo: campo(h, ['COMP_TIPO_PROBLEMA_VALIDADO','TIPO_PROBLEMA_VALIDADO','TIPO']),
          causa: campo(h, ['COMP_CAUSA_PROVAVEL','CAUSA_RAIZ','CAUSA']),
          subcausa: campo(h, ['COMP_SUBCAUSA','SUBCAUSA','SUB_CAUSA']),
          setor: campo(h, ['SETOR_RESPONSAVEL','SETOR']),
          tratativa: campo(h, ['TRATATIVA_REALIZADA','ORIG_TRATATIVA','TRATATIVA','ORIG_TRATATIVA_REALIZADA']),
          resultado: campo(h, ['RESULTADO','STATUS_FINAL','DESFECHO']),
          devolutiva: campo(h, ['DEVOLUTIVA_FINAL','ORIG_DEVOLUTIVA','DEVOLUTIVA']),
          data: campo(h, ['ORIG_DATA_ABERTURA','DATA_ABERTURA']),
          protocolo: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']),
          similaridade: calcularSimilaridade(descricao, dh),
        };
      })
      .filter(caso => caso.similaridade >= 10)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, limite);
  } catch (erro) {
    console.error('Erro ao buscar casos similares:', erro.message);
    return [];
  }
}

// ──────────────────────────────────────────────────────────────
// 2. REINCIDÊNCIA
// ──────────────────────────────────────────────────────────────

async function detectarReincidencia(manifestacao) {
  try {
    const historico = await sheets.lerAba('MANIFESTACOES', 5000);
    const historicoBanco = await sheets.lerAba('BANCO_HISTORICO', 5000).catch(() => []);
    const todos = [...historico, ...historicoBanco];

    const cliente = normalizar(campo(manifestacao, ['EMPRESA_RECLAMANTE','CLIENTE','CONTATO','ORIG_CONTATO']));
    const produto = normalizar(campo(manifestacao, ['PRODUTO']));
    const tipo = normalizar(campo(manifestacao, ['TIPO','TIPO_PROBLEMA_VALIDADO']));
    const idAtual = campo(manifestacao, ['ID_MANIFESTACAO','protocolo']);

    if (!cliente) return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] };

    const casos = todos.filter(h => {
      const cH = normalizar(campo(h, ['ORIG_CONTATO','EMPRESA_RECLAMANTE','CLIENTE','CONTATO']));
      const idH = campo(h, ['ID_HISTORICO','ID_MANIFESTACAO','ID']);
      return cH && cH === cliente && idH !== idAtual;
    });

    // Verificar reincidência por produto
    const casosComMesmoProblema = produto
      ? casos.filter(h => normalizar(campo(h, ['PRODUTO'])).includes(produto.slice(0, 5)))
      : [];

    let nivel = 'SEM_REINCIDENCIA';
    if (casosComMesmoProblema.length >= 2) nivel = 'REINCIDENCIA_CONFIRMADA';
    else if (casosComMesmoProblema.length >= 1 || casos.length >= 3) nivel = 'POSSIVEL_REINCIDENCIA';

    return {
      nivel,
      detectada: casos.length > 0,
      quantidade: casos.length,
      quantidadeMesmoProblema: casosComMesmoProblema.length,
      casos: casos.slice(-10).map(h => ({
        id: campo(h, ['ID_HISTORICO','ID_MANIFESTACAO']),
        data: campo(h, ['ORIG_DATA_ABERTURA','DATA_ABERTURA','DATA_CRIACAO']),
        motivo: campo(h, ['ORIG_MOTIVO_RELATADO','MOTIVO','TIPO']),
        causa: campo(h, ['COMP_CAUSA_PROVAVEL','CAUSA_RAIZ','CAUSA']),
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

function calcularSLA(dataAbertura, slaHoras) {
  if (!dataAbertura || !slaHoras) return { status: 'SEM_SLA', prazoHoras: null, horasDecorridas: null, horasRestantes: null };
  const abertura = new Date(dataAbertura);
  if (isNaN(abertura)) return { status: 'SEM_SLA', prazoHoras: null, horasDecorridas: null, horasRestantes: null };
  const prazo = new Date(abertura.getTime() + Number(slaHoras) * 3600000);
  const agora = Date.now();
  const horasDecorridas = Math.round((agora - abertura.getTime()) / 3600000);
  const horasRestantes = Math.round((prazo.getTime() - agora) / 3600000);
  const percentDecorrido = Math.min(100, Math.round((horasDecorridas / Number(slaHoras)) * 100));

  let status;
  if (horasRestantes < 0) status = 'VENCIDO';
  else if (percentDecorrido >= 90) status = 'PROXIMO_DO_VENCIMENTO';
  else status = 'DENTRO_DO_PRAZO';

  return {
    status,
    prazoHoras: Number(slaHoras),
    horasDecorridas,
    horasRestantes,
    percentDecorrido,
    prazoFinal: prazo.toISOString(),
    setorResponsavel: 'SAC',
  };
}

// ──────────────────────────────────────────────────────────────
// 4. BASE DE CONHECIMENTO
// ──────────────────────────────────────────────────────────────

async function consultarBaseConhecimento(tipo, setor) {
  try {
    const [politicas, procedimentos] = await Promise.all([
      sheets.lerAba('POLITICAS', 200).catch(() => []),
      sheets.lerAba('PROCEDIMENTOS', 200).catch(() => []),
    ]);

    const setorN = normalizar(setor || '');
    const tipoN = normalizar(tipo || '');
    const relevantes = [];

    politicas.forEach(p => {
      const setorP = normalizar(p.SETOR_RESPONSAVEL || p.SETOR || '');
      const ativo = (p.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      if (ativo && (setorN && setorP && setorP.includes(setorN.split(' ')[0]))) {
        relevantes.push({
          tipo: 'Política',
          id: p.ID_POLITICA || p.ID,
          nome: p.POLITICA || p.NOME,
          descricao: p.DESCRICAO || '',
          setor: p.SETOR_RESPONSAVEL || p.SETOR,
          versao: POLITICAS_VERSION,
        });
      }
    });

    procedimentos.forEach(p => {
      const setorP = normalizar(p.SETOR_RESPONSAVEL || p.SETOR || '');
      const tiposProc = normalizar(p.TIPO_RECLAMACAO || '');
      const ativo = (p.ATIVO || 'SIM').toUpperCase() !== 'NAO';
      const matchSetor = setorN && setorP && setorP.includes(setorN.split(' ')[0]);
      const matchTipo = tipoN && tiposProc && tiposProc.includes(tipoN.split(' ')[0]);
      if (ativo && (matchSetor || matchTipo)) {
        relevantes.push({
          tipo: 'Procedimento',
          id: p.ID_PROCEDIMENTO || p.ID,
          nome: p.NOME,
          passos: p.PASSOS || '',
          setor: p.SETOR_RESPONSAVEL || p.SETOR,
          versao: BASE_CONHECIMENTO_VERSION,
        });
      }
    });

    return {
      status: relevantes.length > 0 ? 'CONHECIMENTO_RELEVANTE' : 'CONHECIMENTO_INSUFICIENTE',
      itens: relevantes,
      total: relevantes.length,
      fonte: 'POLITICAS + PROCEDIMENTOS',
      versao: BASE_CONHECIMENTO_VERSION,
    };
  } catch (e) {
    console.error('Erro base conhecimento:', e.message);
    return { status: 'CONHECIMENTO_INSUFICIENTE', itens: [], total: 0 };
  }
}

// ──────────────────────────────────────────────────────────────
// 5. SUGESTÃO DE TRATATIVA
// ──────────────────────────────────────────────────────────────

// Tratativas específicas por palavra-chave no tipo/descrição do problema
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

function gerarSugestaoTratativaDefault(tipo, setores, descricao) {
  const textoBusca = normalizar((tipo||'') + ' ' + (descricao||''));
  // Busca por motivo específico primeiro
  for (const regra of TRATATIVAS_POR_MOTIVO) {
    if (regra.palavras.some(p => textoBusca.includes(normalizar(p)))) {
      return {
        aplicavel: true,
        confianca: 50,
        sugestao: regra.sugestao,
        acoes: regra.acoes || [],
        quantidadeCasos: 0,
        evidencia: [],
        origem: 'PADRAO_ESPECIFICO',
        todasSugestoes: [regra.sugestao],
      };
    }
  }
  // Fallback por setor
  const setor = (Array.isArray(setores) ? setores[0] : setores) || 'SAC';
  const lista = TRATATIVAS_PADRAO[setor] || TRATATIVAS_PADRAO['SAC'];
  return {
    aplicavel: true,
    confianca: 30,
    sugestao: lista[0],
    acoes: [],
    quantidadeCasos: 0,
    evidencia: [],
    origem: 'PADRAO',
    todasSugestoes: lista,
  };
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
    aplicavel: true,
    confianca,
    sugestao: tratativa,
    quantidadeCasos: quantidade,
    evidencia: comTratativa
      .filter(c => c.tratativa.trim() === tratativa)
      .slice(0, 5)
      .map(c => ({ id: c.id, compatibilidade: c.similaridade, tratativa: c.tratativa, resultado: c.resultado })),
    origem: 'HISTORICO',
    todasSugestoes: ordenadas.slice(0,4).map(([t])=>t),
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
// 8. DETECÇÃO DE CONFLITOS
// ──────────────────────────────────────────────────────────────

function detectarConflitos(dados) {
  const conflitos = [];

  const setorIA = normalizar(dados.ia?.setorSugerido || '');
  const setorRegra = normalizar(dados.setores?.[0] || '');
  if (setorIA && setorRegra && !setorIA.includes(setorRegra.split(' ')[0]) && !setorRegra.includes(setorIA.split(' ')[0])) {
    conflitos.push({
      tipo: 'CONFLITO_SETOR',
      descricao: `IA sugere "${dados.ia?.setorSugerido}", regras indicam "${dados.setores?.[0]}"`,
      fonte1: { origem: 'IA', valor: dados.ia?.setorSugerido },
      fonte2: { origem: 'REGRAS_ROTEAMENTO', valor: dados.setores?.[0] },
    });
  }

  const tipoIA = normalizar(dados.ia?.classificacao || '');
  const tipoRegra = normalizar(dados.tipoDetectado || '');
  const excluir = ['nao identificado', 'não identificado', ''];
  if (tipoIA && tipoRegra && !excluir.includes(tipoIA) && !excluir.includes(tipoRegra)) {
    if (!tipoIA.includes(tipoRegra.split(' ')[0]) && !tipoRegra.includes(tipoIA.split(' ')[0])) {
      conflitos.push({
        tipo: 'CONFLITO_CLASSIFICACAO',
        descricao: `IA classifica como "${dados.ia?.classificacao}", regras identificaram "${dados.tipoDetectado}"`,
        fonte1: { origem: 'IA', valor: dados.ia?.classificacao },
        fonte2: { origem: 'TIPOS_RECLAMACAO', valor: dados.tipoDetectado },
      });
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
    dados.casosSimilares.slice(0, 3).forEach(c => {
      linhas.push(`  • ${c.id} — ${c.similaridade}% similares — causa: ${c.causa || c.motivo || 'não registrada'}`);
    });
  } else {
    linhas.push('[HISTÓRICO] Nenhum caso similar encontrado no banco histórico');
  }

  if (dados.reincidencia?.detectada) {
    linhas.push(`[REINCIDÊNCIA] ${dados.reincidencia.nivel}: ${dados.reincidencia.quantidade} ocorrência(s) anterior(es) para este cliente`);
  } else {
    linhas.push('[REINCIDÊNCIA] Sem reincidência detectada para este cliente');
  }

  if (dados.baseConhecimento?.total > 0) {
    linhas.push(`[CONHECIMENTO] ${dados.baseConhecimento.total} documento(s) relevante(s) consultado(s) na base`);
    dados.baseConhecimento.itens.slice(0, 2).forEach(d => linhas.push(`  • ${d.tipo}: ${d.nome}`));
  } else {
    linhas.push('[CONHECIMENTO] Base de conhecimento insuficiente para este tipo/setor');
  }

  if (dados.conflitos?.length) {
    linhas.push(`[CONFLITOS] ${dados.conflitos.length} conflito(s) detectado(s) — revisão humana recomendada`);
    dados.conflitos.forEach(c => linhas.push(`  • ${c.tipo}: ${c.descricao}`));
  }

  linhas.push(`[CONFIANÇA] Nível: ${dados.confianca?.nivel || 'BAIXA'} (${dados.confianca?.score || 0} pontos) — ${(dados.confianca?.fatores || []).join('; ') || 'dados insuficientes'}`);

  return {
    resumo: linhas.join('\n'),
    linhas,
    versoesSistema: {
      cerebro: CEREBRO_VERSION,
      baseConhecimento: BASE_CONHECIMENTO_VERSION,
      politicas: POLITICAS_VERSION,
      matriz: MATRIZ_VERSION,
    },
    geradaEm: new Date().toISOString(),
  };
}

// ──────────────────────────────────────────────────────────────
// 10. CHAMADA IA (CLAUDE)
// ──────────────────────────────────────────────────────────────

async function chamarIA(contexto) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { disponivel: false, motivo: 'ANTHROPIC_API_KEY não configurada — análise determinística apenas' };

  const prompt = `Você é o módulo de IA do Assistente SAC do Grupo Chiacchio (fabricante de embalagens e produtos plásticos). Analise a manifestação e responda SOMENTE em JSON válido, sem texto adicional.

MANIFESTAÇÃO:
${JSON.stringify({
  descricao: contexto.manifestacao.descricao || contexto.manifestacao.DESCRICAO,
  empresa: contexto.manifestacao.empresaReclamada || contexto.manifestacao.EMPRESA_RECLAMADA,
  cliente: contexto.manifestacao.empresaReclamante || contexto.manifestacao.EMPRESA_RECLAMANTE,
  produto: contexto.manifestacao.produto || contexto.manifestacao.PRODUTO,
  tipo: contexto.manifestacao.tipo || contexto.manifestacao.TIPO,
}, null, 2)}

CONTEXTO DO SISTEMA:
- Tipo identificado pelas regras: ${contexto.tipoDetectado || 'não identificado'}
- Setores sugeridos: ${(contexto.setores || []).join(', ') || 'nenhum'}
- Casos similares (${contexto.casosSimilares?.length || 0} encontrados): ${JSON.stringify(
  (contexto.casosSimilares || []).slice(0, 3).map(c => ({ id: c.id, similaridade: c.similaridade, causa: c.causa, tratativa: c.tratativa }))
)}
- Reincidência: ${contexto.reincidencia?.nivel || 'SEM_REINCIDENCIA'} (${contexto.reincidencia?.quantidade || 0} ocorrência(s))
- SLA: ${contexto.sla?.status || 'SEM_SLA'} — ${contexto.sla?.horasRestantes != null ? contexto.sla.horasRestantes + 'h restantes' : 'sem dados'}
- Conhecimento relevante (${contexto.baseConhecimento?.total || 0} documentos)

REGRAS OBRIGATÓRIAS:
1. NÃO invente informações. Use "DADO_NAO_ENCONTRADO" quando não souber.
2. NÃO crie políticas nem regras que não existam no contexto.
3. NÃO tome decisões irreversíveis. Recomende, não decida.
4. A decisão final é sempre do humano.

Responda com este JSON exato:
{
  "classificacao": "string",
  "causaProvavel": "string ou DADO_NAO_ENCONTRADO",
  "evidencias": ["string"],
  "setorSugerido": "string",
  "risco": "BAIXO|MÉDIO|ALTO",
  "tratamentoRecomendado": "string",
  "justificativa": "string",
  "devolutivaSugerida": "string",
  "informacoesAusentes": ["string"],
  "nivelConfianca": 0
}`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      return { disponivel: true, erro: `API ${resp.status}: ${err.slice(0, 200)}` };
    }

    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { disponivel: true, erro: 'Resposta fora do formato JSON', raw: text.slice(0, 500) };

    const resultado = JSON.parse(match[0]);
    return {
      disponivel: true,
      modelo: data.model || 'claude-haiku-4-5',
      tokensEntrada: data.usage?.input_tokens || 0,
      tokensSaida: data.usage?.output_tokens || 0,
      ...resultado,
    };
  } catch (e) {
    return { disponivel: true, erro: e.message };
  }
}

// ──────────────────────────────────────────────────────────────
// 11. AUDITORIA DE ANÁLISE
// ──────────────────────────────────────────────────────────────

async function registrarAuditoriaAnalise(protocolo, usuario, analise) {
  try {
    await sheets.garantirAbaComCabecalhos('LOG_ANALISES', [
      'TIMESTAMP','PROTOCOLO','USUARIO','VERSAO_CEREBRO','TIPO_DETECTADO','SETORES',
      'SIMILARES_ENCONTRADOS','REINCIDENCIA','SLA_STATUS','CONFIANCA_NIVEL','CONFIANCA_SCORE',
      'IA_DISPONIVEL','IA_MODELO','IA_TOKENS_ENTRADA','IA_TOKENS_SAIDA',
      'CONFLITOS','NECESSITA_VALIDACAO','TEMPO_MS','ERROS',
    ]).catch(() => {});

    const linha = {
      TIMESTAMP: new Date().toISOString(),
      PROTOCOLO: protocolo || '',
      USUARIO: usuario || 'sistema',
      VERSAO_CEREBRO: CEREBRO_VERSION,
      TIPO_DETECTADO: analise.tipoDetectado || '',
      SETORES: (analise.setores || []).join(', '),
      SIMILARES_ENCONTRADOS: analise.casosSimilares?.length || 0,
      REINCIDENCIA: analise.reincidencia?.nivel || 'SEM_REINCIDENCIA',
      SLA_STATUS: analise.sla?.status || 'SEM_SLA',
      CONFIANCA_NIVEL: analise.confianca?.nivel || 'BAIXA',
      CONFIANCA_SCORE: analise.confianca?.score || 0,
      IA_DISPONIVEL: analise.ia?.disponivel ? 'SIM' : 'NÃO',
      IA_MODELO: analise.ia?.modelo || '',
      IA_TOKENS_ENTRADA: analise.ia?.tokensEntrada || 0,
      IA_TOKENS_SAIDA: analise.ia?.tokensSaida || 0,
      CONFLITOS: analise.conflitos?.length || 0,
      NECESSITA_VALIDACAO: analise.necessitaValidacaoHumana ? 'SIM' : 'NÃO',
      TEMPO_MS: analise.tempoMs || 0,
      ERROS: analise.erros?.join('; ') || '',
    };

    await sheets.appendObjeto('LOG_ANALISES', linha).catch(() => {});
  } catch (e) {
    console.error('Erro ao registrar auditoria de análise:', e.message);
  }
}

// ──────────────────────────────────────────────────────────────
// 12. ANÁLISE COMPLETA (NOVO - v2.0)
// ──────────────────────────────────────────────────────────────

async function analisarManifestacaoCompleta(manifestacao, regras = {}, usuario = 'sistema') {
  const inicio = Date.now();
  const erros = [];

  // Validação de entrada
  const descricao = campo(manifestacao, ['descricao','DESCRICAO','DESCRICAO_RECLAMACAO']);
  const informacoesAusentes = [];
  if (!descricao) informacoesAusentes.push('DESCRICAO');
  if (!campo(manifestacao, ['empresa','EMPRESA_RECLAMADA','empresaReclamada'])) informacoesAusentes.push('EMPRESA_RECLAMADA');
  if (!campo(manifestacao, ['cliente','EMPRESA_RECLAMANTE','empresaReclamante'])) informacoesAusentes.push('EMPRESA_RECLAMANTE');

  const protocolo = campo(manifestacao, ['protocolo','ID_MANIFESTACAO']);
  const setor = regras.setores?.[0] || '';
  const tipo = regras.tipoDetectado || '';
  const dataAbertura = campo(manifestacao, ['dataAbertura','DATA_ABERTURA','DATA_CRIACAO']);

  // Executar etapas em paralelo onde possível
  const [casosSimilares, reincidencia, baseConhecimento] = await Promise.all([
    buscarCasosSimilares(manifestacao, 8).catch(e => { erros.push('similares: ' + e.message); return []; }),
    detectarReincidencia(manifestacao).catch(e => { erros.push('reincidencia: ' + e.message); return { nivel: 'SEM_REINCIDENCIA', detectada: false, quantidade: 0, casos: [] }; }),
    consultarBaseConhecimento(tipo, setor).catch(e => { erros.push('conhecimento: ' + e.message); return { status: 'CONHECIMENTO_INSUFICIENTE', itens: [], total: 0 }; }),
  ]);

  const sla = calcularSLA(dataAbertura, regras.slaHoras || 72);
  const tratativa = gerarSugestaoTratativa(casosSimilares, tipo, regras.setores, descricao);

  // Contexto para IA
  const contextoIA = {
    manifestacao,
    tipoDetectado: tipo,
    setores: regras.setores || [],
    casosSimilares,
    reincidencia,
    sla,
    baseConhecimento,
  };

  const ia = await chamarIA(contextoIA).catch(e => { erros.push('ia: ' + e.message); return { disponivel: false, erro: e.message }; });

  // ── Tratativa estruturada (motor v3) ─────────────────────────
  const empresa = campo(manifestacao, ['empresaReclamada','EMPRESA_RECLAMADA']);
  const reincidenteBool = reincidencia.nivel === 'REINCIDENCIA_CONFIRMADA';

  let tratativaEstruturada = null;
  try {
    tratativaEstruturada = await tratativaEngine.gerarTratativaEstruturada({
      manifestacao: {
        ...manifestacao,
        DESCRICAO: descricao,
        EMPRESA_RECLAMADA: empresa,
        DATA_ABERTURA: campo(manifestacao, ['DATA_ABERTURA','dataAbertura']) || '',
        PRODUTO: campo(manifestacao, ['PRODUTO','produto']) || '',
        CATEGORIA: campo(manifestacao, ['CATEGORIA','categoria']) || '',
        SUBCATEGORIA: campo(manifestacao, ['SUBCATEGORIA','subcategoria']) || '',
      },
      classificacao: tipo,
      empresa,
      cliente: campo(manifestacao, ['CONTATO','NOME_CONTATO','nomeCliente']) || '',
      setor,
      prioridade: regras.prioridade || 'Média',
      casosSimilares,
      reincidencia,
      sla,
      iaResultado: ia || {},
      usuario: campo(manifestacao, ['USUARIO_CRIACAO','usuario']) || 'sistema',
      versaoCerebro: CEREBRO_VERSION,
    });
  } catch (e) { erros.push('tratativaEngine: ' + e.message); }

  // ── Devolutiva estruturada (engine v3) ────────────────────────
  let devolutivaEstruturada = null;
  try {
    devolutivaEstruturada = await devolutivaEngine.gerarDevolutiva({
      idManifestacao: protocolo,
      tipo: 'RECEBIMENTO',
      empresa,
      tipoManifestacao: tipo,
      categoria: campo(manifestacao, ['CATEGORIA','categoria']) || '',
      setor,
      protocolo,
      prazo: (regras.slaHoras || 72) + ' horas úteis',
      setorResponsavel: setor || regras.setores?.[0] || 'SAC',
      reincidente: reincidenteBool,
      prioridade: regras.prioridade || 'Média',
      diagnostico: tratativaEstruturada?.diagnostico?.descricao || '',
    });
  } catch (e) { erros.push('devolutivaEngine: ' + e.message); }

  // Devolutiva textual: prefere IA, depois engine, depois fallback
  const devolutiva = (ia?.devolutivaSugerida && !ia.erro)
    ? ia.devolutivaSugerida
    : (devolutivaEstruturada?.textoGerado || gerarDevolutiva(
        campo(manifestacao, ['empresaReclamante','EMPRESA_RECLAMANTE']),
        tipo,
        setor,
        tratativa.sugestao
      ));

  // Consolidação
  const dadosParaConfianca = { regraAplicada: regras.regraAplicada, tipoDetectado: tipo, tipoConfianca: regras.tipoConfianca, casosSimilares, baseConhecimento, ia };
  const confianca = calcularConfianca(dadosParaConfianca);
  const conflitos = detectarConflitos({ ...regras, casosSimilares, reincidencia, ia });

  // Conflitos do motor de tratativas
  if (tratativaEstruturada?.conflitos?.length) {
    conflitos.push(...tratativaEstruturada.conflitos.map(c => ({ tipo: 'CONFLITO_TRATATIVA', descricao: c })));
  }

  const necessitaValidacaoHumana = confianca.nivel === 'BAIXA' || conflitos.length > 0 || reincidencia.nivel === 'REINCIDENCIA_CONFIRMADA'
    || tratativaEstruturada?.necessitaAprovacao;

  const analise = {
    protocolo,
    tipoDetectado: tipo,
    tipoConfianca: regras.tipoConfianca || 0,
    setores: regras.setores || ['SAC'],
    regraAplicada: regras.regraAplicada || null,
    prioridade: regras.prioridade || 'Média',
    slaHoras: regras.slaHoras || 72,
    geraRNC: regras.geraRNC || false,
    procedimentoSugerido: regras.procedimentoSugerido || null,
    perguntasNecessarias: regras.perguntasNecessarias || [],
    casosSimilares,
    reincidencia,
    sla,
    baseConhecimento,
    tratativaSugerida: { aplicavel: tratativa.aplicavel, confianca: tratativa.confianca, sugestao: tratativa.sugestao, quantidadeCasos: tratativa.quantidadeCasos, evidencia: tratativa.evidencia, origem: tratativa.origem||'HISTORICO', todasSugestoes: tratativa.todasSugestoes||[] },
    tratativaEstruturada,
    devolutivaEstruturada,
    ia,
    confianca,
    conflitos,
    informacoesAusentes,
    devolutivaSugerida: devolutiva,
    necessitaValidacaoHumana,
    explicabilidade: null, // preenchido abaixo
    versoes: { cerebro: CEREBRO_VERSION, baseConhecimento: BASE_CONHECIMENTO_VERSION, politicas: POLITICAS_VERSION, matriz: MATRIZ_VERSION },
    tempoMs: Date.now() - inicio,
    erros,
    geradaEm: new Date().toISOString(),
    // compat v1
    versaoIA: CEREBRO_VERSION,
  };

  analise.explicabilidade = gerarExplicabilidade(analise);

  // Auditoria assíncrona (não bloqueia resposta)
  registrarAuditoriaAnalise(protocolo, usuario, analise).catch(() => {});

  return analise;
}

// ──────────────────────────────────────────────────────────────
// 13. ANÁLISE LEGADA (compatibilidade v1)
// ──────────────────────────────────────────────────────────────

async function analisarManifestacao(manifestacao, regras = {}) {
  return analisarManifestacaoCompleta(manifestacao, regras, 'sistema');
}

// ──────────────────────────────────────────────────────────────
// EXPORTS
// ──────────────────────────────────────────────────────────────

module.exports = {
  // Utilitários
  normalizar,
  calcularSimilaridade,
  // Análise
  buscarCasosSimilares,
  detectarReincidencia,
  gerarSugestaoTratativa,
  gerarDevolutiva,
  calcularSLA,
  consultarBaseConhecimento,
  calcularConfianca,
  detectarConflitos,
  gerarExplicabilidade,
  chamarIA,
  // Principal
  analisarManifestacao,          // v1 (compat)
  analisarManifestacaoCompleta,  // v3 (completa com tratativa + devolutiva)
  // Engines (re-exportados para uso nas rotas)
  tratativaEngine,
  devolutivaEngine,
  assertividade,
  matrizTratamento,
  // Constantes
  CEREBRO_VERSION,
};
