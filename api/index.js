const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ===== AUTH GOOGLE =====
function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getSheets() {
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

// ===== LEITURA DE ABA =====
async function lerAba(nomeAba, maxRows) {
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:Z${maxRows}` : nomeAba;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
    return obj;
  });
}

// ===== ESCRITA =====
async function appendLinha(nomeAba, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueInputOption: 'RAW',
    resource: { values: [linha] },
  });
}

async function updateLinha(nomeAba, rowIndex, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!A${rowIndex}`,
    valueInputOption: 'RAW',
    resource: { values: [linha] },
  });
}

// ===== GERAR ID =====
async function gerarProximoID(nomeAba, prefixo, campoID) {
  const dados = await lerAba(nomeAba, 2000);
  let max = 0;
  dados.forEach(r => {
    const campo = r[campoID] || r.ID_MANIFESTACAO || r.ID_HISTORICO || r.ID || '';
    const match = campo.match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1]));
  });
  return `${prefixo}-${String(max + 1).padStart(3, '0')}`;
}

// ===== AUDITORIA =====
async function registrarAuditoria(usuario, acao, idManifestacao, entidade, valorAnterior, valorNovo) {
  try {
    const linha = [
      new Date().toISOString(),
      usuario || 'sistema',
      acao,
      idManifestacao || '',
      entidade || '',
      typeof valorAnterior === 'object' ? JSON.stringify(valorAnterior) : (valorAnterior || ''),
      typeof valorNovo === 'object' ? JSON.stringify(valorNovo) : (valorNovo || ''),
    ];
    await appendLinha('LOG_SISTEMA', linha);
  } catch (e) {
    console.error('Erro auditoria:', e.message);
  }
}

// ===== MOTOR DE REGRAS =====
async function motorRegras(descricao, tipo, empresa) {
  try {
    const [regras, tipos, procedimentos, slaData, perguntas] = await Promise.all([
      lerAba('REGRAS_ROTEAMENTO', 500),
      lerAba('TIPOS_RECLAMACAO', 500),
      lerAba('PROCEDIMENTOS', 200),
      lerAba('SLA_ESCALONAMENTO', 50),
      lerAba('PERGUNTAS_ANALISE', 200),
    ]);

    const texto = (descricao || '').toLowerCase();

    // 1. Classificar tipo por palavras-chave
    let tipoDetectado = null;
    let tipoConfianca = 0;
    let tipoID = null;

    for (const t of tipos) {
      const palavras = (t.PALAVRAS_CHAVE || '').toLowerCase().split(',').map(p => p.trim()).filter(Boolean);
      let matches = 0;
      for (const p of palavras) {
        if (p && texto.includes(p)) matches++;
      }
      if (matches > 0) {
        const conf = Math.min(99, Math.round((matches / Math.max(palavras.length, 1)) * 100 * 2));
        if (conf > tipoConfianca) {
          tipoConfianca = conf;
          tipoDetectado = t.TIPO || t.ID_TIPO;
          tipoID = t.ID_TIPO;
        }
      }
    }
    if (!tipoDetectado) { tipoDetectado = 'Não identificado'; tipoConfianca = 0; }

    // 2. Encontrar regra de roteamento
    let setores = [];
    let regraAplicada = null;
    for (const r of regras) {
      if (r.ATIVO !== 'SIM') continue;
      const tiposRegra = (r.TIPO || '').split('/').map(t => t.trim());
      if (tiposRegra.includes(tipoID) || tiposRegra.some(t => (tipoID || '').includes(t))) {
        const setoresStr = r.SETORES_ENVOLVIDOS || '';
        setores = setoresStr.split('+').map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        regraAplicada = r.ID_REGRA;
        break;
      }
    }
    if (setores.length === 0) {
      // fallback por palavras no texto
      if (texto.includes('entrega') || texto.includes('prazo') || texto.includes('atraso')) setores = ['Logística'];
      else if (texto.includes('qualidade') || texto.includes('defeito') || texto.includes('ruptura') || texto.includes('abriu')) setores = ['Qualidade'];
      else if (texto.includes('nota') || texto.includes('nf') || texto.includes('cobrança')) setores = ['Financeiro'];
      else if (texto.includes('comercial') || texto.includes('preço') || texto.includes('pedido')) setores = ['Comercial'];
      else setores = ['SAC'];
    }

    // 3. SLA
    let slaHoras = 72;
    const slaSetor = slaData.find(s => s.SETOR && s.SETOR.includes('SAC'));
    if (slaSetor) {
      const match = (slaSetor.SLA_PADRAO_HORAS || '72').match(/\d+/);
      if (match) slaHoras = parseInt(match[0]);
    }

    // 4. Prioridade
    let prioridade = 'Média';
    if (texto.includes('urgente') || texto.includes('urgência') || texto.includes('perda') || texto.includes('cliente perdido')) prioridade = 'Alta';
    else if (texto.includes('elogio') || texto.includes('satisfeito') || texto.includes('sugestão')) prioridade = 'Baixa';

    // 5. Procedimento sugerido
    let procedimentoSugerido = null;
    for (const p of procedimentos) {
      const tiposProc = (p.TIPO_RECLAMACAO || '').split(',').map(t => t.trim());
      if (tiposProc.includes(tipoID) || tiposProc.some(t => (tipoID || '').includes(t))) {
        procedimentoSugerido = { id: p.ID_PROCEDIMENTO, nome: p.NOME, passos: p.PASSOS, documentos: p.DOCUMENTOS_NECESSARIOS };
        break;
      }
    }

    // 6. Perguntas necessárias
    const perguntasNecessarias = perguntas
      .filter(p => p.TIPO_RECLAMACAO === 'TODOS' || (tipoID && (p.TIPO_RECLAMACAO || '').includes(tipoID)))
      .slice(0, 6)
      .map(p => ({ id: p.ID_PERGUNTA, pergunta: p.PERGUNTA, obrigatoria: p.OBRIGATORIA === 'SIM' }));

    // 7. Gera RNC?
    const geraRNC = texto.includes('reincidência') || texto.includes('terceira') || texto.includes('repetiu') || prioridade === 'Alta';

    return {
      tipoDetectado,
      tipoID,
      tipoConfianca,
      setores,
      regraAplicada,
      slaHoras,
      prioridade,
      procedimentoSugerido,
      perguntasNecessarias,
      geraRNC,
    };
  } catch (e) {
    console.error('Erro motor regras:', e.message);
    return { tipoDetectado: 'Não identificado', tipoConfianca: 0, setores: ['SAC'], slaHoras: 72, prioridade: 'Média', geraRNC: false };
  }
}

// ===== SIMILARIDADE TF-IDF =====
function calcSimilaridade(texto1, texto2) {
  if (!texto1 || !texto2) return 0;
  const stopwords = new Set(['de','a','o','e','que','do','da','em','um','uma','para','com','por','se','não','na','no','os','as','ao','à','mais','mas','ou','é','ele','ela','este','esta','esse','essa','seu','sua','ter','foi','ser','tem','são','quando','como','qual','quais','sobre','após','até','desde','entre','isso','isto','aqui','lá']);
  const tokenizar = t => t.toLowerCase().replace(/[^a-záàãâéêíóôõúç\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
  const t1 = tokenizar(texto1);
  const t2 = tokenizar(texto2);
  const set1 = new Set(t1);
  const set2 = new Set(t2);
  const intersect = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? Math.round((intersect / union) * 100) : 0;
}

async function buscarSimilares(descricao, empresa, limit = 5) {
  try {
    const historico = await lerAba('BANCO_HISTORICO', 1000);
    const scores = historico
      .filter(h => h.ORIG_DESCRICAO_RECLAMACAO)
      .map(h => ({
        id: h.ID_HISTORICO,
        empresa: h.ORIG_EMPRESA || '',
        descricao: (h.ORIG_DESCRICAO_RECLAMACAO || '').slice(0, 200),
        motivo: h.ORIG_MOTIVO_RELATADO || '',
        causa: h.COMP_CAUSA_PROVAVEL || '',
        tratativa: (h.ORIG_TRATATIVA || '').slice(0, 200),
        devolutiva: (h.ORIG_DEVOLUTIVA || '').slice(0, 200),
        tipo: h.COMP_TIPO_PROBLEMA_VALIDADO || '',
        status: h.ORIG_STATUS || '',
        similaridade: calcSimilaridade(descricao, h.ORIG_DESCRICAO_RECLAMACAO),
      }))
      .filter(h => h.similaridade > 10)
      .sort((a, b) => b.similaridade - a.similaridade)
      .slice(0, limit);
    return scores;
  } catch (e) {
    console.error('Erro similaridade:', e.message);
    return [];
  }
}

// ===== DEVOLUTIVA SUGERIDA =====
function gerarDevolutiva(empresa, tipo, setores, tratativa) {
  const setor = setores[0] || 'nossos setores responsáveis';
  return `Prezado(a) cliente da ${empresa || 'empresa'},\n\nRecebemos seu relato referente a ${tipo || 'sua manifestação'} e registramos formalmente em nosso sistema.\n\nEncaminhamos o caso ao setor de ${setor} para análise e providências.\n\nRetornaremos com um posicionamento completo dentro do prazo estabelecido.\n\nAgradecemos o contato e pedimos desculpas pelos transtornos causados.\n\nAtenciosamente,\nEquipe SAC — Grupo Chiacchio`;
}

// ===== ANÁLISE COMPLETA =====
async function executarAnalise(manifestacao) {
  const inicio = Date.now();
  const regras = await motorRegras(manifestacao.descricao, manifestacao.tipo, manifestacao.empresaReclamada);
  const similares = await buscarSimilares(manifestacao.descricao, manifestacao.empresaReclamada);
  const reincidente = similares.some(s => (s.empresa || '').includes(manifestacao.empresaReclamante || ''));
  const devolutiva = gerarDevolutiva(manifestacao.empresaReclamante, regras.tipoDetectado, regras.setores, null);
  const tempoSeg = Math.round((Date.now() - inicio) / 1000);

  return {
    tipoSugerido: regras.tipoDetectado,
    tipoID: regras.tipoID,
    confianca: regras.tipoConfianca,
    prioridade: regras.prioridade,
    slaHoras: regras.slaHoras,
    setoresSugeridos: regras.setores,
    regraAplicada: regras.regraAplicada,
    procedimentoSugerido: regras.procedimentoSugerido,
    perguntasNecessarias: regras.perguntasNecessarias,
    geraRNC: regras.geraRNC,
    casosSemelhantes: similares,
    reincidente,
    devolutivaSugerida: devolutiva,
    tempoAnaliseSegundos: tempoSeg,
    versaoIA: '1.0-regras',
    geradaEm: new Date().toISOString(),
  };
}

// ===== NORMALIZAR EMPRESA =====
function normalizarEmpresa(raw) {
  if (!raw) return null;
  const r = raw.toUpperCase().trim();
  if (r.includes('CHIACH') || r.includes('EMBALAGEM')) return 'CHIACCHIO EMBALAGENS';
  if (r.includes('PLASCH') || r.includes('PLASCHIO')) return 'PLASCHIO';
  if (r.includes('TUBAH')) return 'TUBAHIA';
  if (r.includes('CESBAP')) return 'CESBAP';
  // Rejeitar códigos que não são empresas
  if (/^TR\d+/.test(r) || r === 'TR01' || r === 'TR08') return null;
  return raw.trim();
}

// ===== NORMALIZAR DATA =====
function normalizarData(val) {
  if (!val) return null;
  if (typeof val === 'number') {
    // Número de série Excel → data
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return null;
}

// ===========================================================
// ROTAS
// ===========================================================

// Health
app.get('/api/health', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '3.0.0', sistema: 'Assistente SAC Chiacchio', ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '3.0.0', sistema: 'Assistente SAC Chiacchio', rotas: ['/api/health','/api/manifestacoes','/api/reclamacoes','/api/dashboard','/api/analise','/api/rnc','/api/setores','/api/procedimentos','/api/politicas','/api/tipos','/api/sla','/api/historico','/api/conhecimento','/api/validacoes','/api/auditoria'] });
});

// ===== MANIFESTAÇÕES =====
app.get('/api/manifestacoes', async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 2000);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

app.get('/api/manifestacoes/:id', async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 2000);
    const item = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.', dados: null });
    res.json({ sucesso: true, manifestacao: item });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: null });
  }
});

app.post('/api/manifestacoes', async (req, res) => {
  try {
    const {
      empresaReclamada, empresaReclamante, contato, produto, lote, nfe,
      descricao, tipo, canal, cnpj, telefone, email, quantidade, valor, usuario
    } = req.body;

    // Validação
    if (!empresaReclamante || !descricao) {
      return res.status(400).json({ sucesso: false, erro: 'Empresa reclamante e descrição são obrigatórios.', dados: null });
    }

    // Validar empresa reclamada
    const empNorm = normalizarEmpresa(empresaReclamada);
    const empresasValidas = ['CHIACCHIO EMBALAGENS', 'PLASCHIO', 'TUBAHIA', 'CESBAP'];
    if (empNorm && !empresasValidas.includes(empNorm)) {
      return res.status(400).json({ sucesso: false, erro: `Empresa reclamada inválida: ${empresaReclamada}. Use: ${empresasValidas.join(', ')}`, dados: null });
    }

    const id = await gerarProximoID('MANIFESTACOES', 'MAN', 'ID_MANIFESTACAO');
    const agora = new Date().toISOString();
    const tipoFinal = tipo || 'Reclamação';

    const linha = [
      id, agora, empresaReclamante, contato || '', produto || '', lote || '',
      descricao, 'EM ANÁLISE', tipoFinal, '', // SETOR preenchido depois
      'NÃO', 'NÃO', agora, agora,
      empNorm || empresaReclamada || '', empresaReclamante, nfe || '',
      '', '', '', '', '', '', '', '', '',
      '', 'PENDENTE', '', '', '', '', '', '', '', '', '',
      '', canal || '', cnpj || '', telefone || '', email || '',
      quantidade || '', valor || '',
    ];

    await appendLinha('MANIFESTACOES', linha);
    await registrarAuditoria(usuario || 'sistema', 'CRIOU_MANIFESTAÇÃO', id, 'MANIFESTACOES', null, { empresaReclamante, tipo: tipoFinal });

    res.json({ sucesso: true, id, mensagem: 'Manifestação registrada. Iniciando análise...' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message, dados: null });
  }
});

// Decisão da analista
app.post('/api/manifestacoes/:id/decisao', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      tipoConfirmado, setoresConfirmados, procedimentoUsado,
      prioridade, slaHoras, geraRNC, observacoes,
      devolutivaEnviada, usuario, decisaoStatus
    } = req.body;

    if (!tipoConfirmado || !setoresConfirmados || !usuario) {
      return res.status(400).json({ sucesso: false, erro: 'Tipo, setores e usuário são obrigatórios.', dados: null });
    }

    const data = await lerAba('MANIFESTACOES', 2000);
    const idx = data.findIndex(r => r.ID_MANIFESTACAO === id);
    if (idx < 0) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.', dados: null });

    const item = data[idx];
    const agora = new Date().toISOString();
    const setoresStr = Array.isArray(setoresConfirmados) ? setoresConfirmados.join(', ') : setoresConfirmados;
    const novoStatus = decisaoStatus === 'APROVADA' ? 'APROVADA' : (decisaoStatus === 'REJEITADA' ? 'REJEITADA' : 'AGUARDANDO_ENCAMINHAMENTO');

    // Registrar validação
    const idValidacao = await gerarProximoID('HISTORICO_VALIDACOES', 'VAL', 'ID_VALIDACAO');
    const linhaVal = [
      idValidacao, id, agora, '1.0-regras', 'ANALISE_MANIFESTACAO',
      item.TIPO_SUGERIDO || '', item.ASSERTIVIDADE || '',
      item.SETOR_SUGERIDO || '', item.ID_PROCEDIMENTO_APLICADO || '',
      item.SLA_HORAS || '', item.PRIORIDADE || '',
      '', item.DEVOLUTIVA_SUGERIDA || '', '',
      novoStatus,
      tipoConfirmado, setoresStr, procedimentoUsado || '',
      devolutivaEnviada || '', observacoes || '',
      usuario, agora,
      '', '', '', item.SLA_HORAS || slaHoras || '72', '',
      setoresStr, item.EMPRESA_RECLAMADA || '', tipoConfirmado, agora.slice(0,7)
    ];
    await appendLinha('HISTORICO_VALIDACOES', linhaVal);
    await registrarAuditoria(usuario, novoStatus === 'APROVADA' ? 'APROVOU_RECOMENDAÇÃO' : 'REJEITOU_RECOMENDAÇÃO', id, 'MANIFESTACOES', item.STATUS, novoStatus);

    res.json({ sucesso: true, id, validacaoId: idValidacao, status: novoStatus, mensagem: `Decisão registrada: ${novoStatus}` });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message, dados: null });
  }
});

// ===== ANÁLISE IA =====
app.post('/api/analise', async (req, res) => {
  try {
    const { descricao, tipo, empresaReclamada, empresaReclamante, produto, lote, id } = req.body;
    if (!descricao) return res.status(400).json({ sucesso: false, erro: 'Descrição é obrigatória.', dados: null });

    const analise = await executarAnalise({ descricao, tipo, empresaReclamada, empresaReclamante, produto, lote });

    // Se tiver ID, salvar na manifestação
    if (id) {
      await registrarAuditoria('sistema', 'VISUALIZOU_ANÁLISE_IA', id, 'ANALISE', null, { tipoSugerido: analise.tipoSugerido });
    }

    res.json({ sucesso: true, analise });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message, dados: null });
  }
});

app.post('/api/analise/similares', async (req, res) => {
  try {
    const { descricao, empresa } = req.body;
    if (!descricao) return res.status(400).json({ sucesso: false, erro: 'Descrição obrigatória.', dados: [] });
    const similares = await buscarSimilares(descricao, empresa, 8);
    res.json({ sucesso: true, total: similares.length, similares });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== DASHBOARD =====
app.get('/api/dashboard', async (req, res) => {
  try {
    const [mans, recs] = await Promise.all([
      lerAba('MANIFESTACOES', 2000),
      lerAba('Reclamações + devolutiva', 2000),
    ]);

    const empresasValidas = ['CHIACCHIO EMBALAGENS', 'PLASCHIO', 'TUBAHIA', 'CESBAP'];

    // KPIs manifestações internas
    const emAndamento = mans.filter(m => !['FINALIZADA','ENCERRADA','CONCLUÍDA'].some(s => (m.STATUS||'').toUpperCase().includes(s))).length;
    const rncsAbertas = mans.filter(m => m.ID_RNC && m.ID_RNC !== '').length;

    // KPIs reclamações históricas
    const recComSLA = recs.filter(r => r['Dentro do prazo? '] || r['Dentro do prazo?']);
    const dentroPrazo = recComSLA.filter(r => {
      const v = (r['Dentro do prazo? '] || r['Dentro do prazo?'] || '').toUpperCase().trim();
      return v === 'SIM' || v === 'S';
    }).length;
    const slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo / recComSLA.length * 100) : null;

    // Empresas (normalizado, sem TR01/TR08)
    const porEmpresa = {};
    recs.forEach(r => {
      const emp = normalizarEmpresa(r['Empresa']);
      if (!emp || !empresasValidas.includes(emp)) return;
      if (!porEmpresa[emp]) porEmpresa[emp] = { total: 0, finaliz: 0, sla: 0, foraSLA: 0 };
      porEmpresa[emp].total++;
      const st = (r['Status'] || r['Situação Final'] || '').toUpperCase();
      if (st.includes('FINALIZ') || st.includes('CONCLUÍD')) porEmpresa[emp].finaliz++;
      const slaV = (r['Dentro do prazo? '] || r['Dentro do prazo?'] || '').toUpperCase().trim();
      if (slaV === 'SIM') porEmpresa[emp].sla++;
      else if (slaV === 'NÃO' || slaV === 'NAO') porEmpresa[emp].foraSLA++;
    });

    // Motivos (sem fictícios)
    const motivos = {};
    recs.forEach(r => {
      const m = (r['Motivo da Reclamação'] || '').trim();
      if (m && m !== 'Não identificado') motivos[m] = (motivos[m] || 0) + 1;
    });

    // Status internos
    const statusCount = {};
    mans.forEach(m => { const s = m.STATUS || 'EM ANÁLISE'; statusCount[s] = (statusCount[s]||0)+1; });

    // Datas para gráfico (semanas)
    const semanas = [];
    const agora = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora);
      d.setDate(d.getDate() - i*7);
      semanas.push({ label: d.toLocaleDateString('pt-BR', {day:'2-digit',month:'short'}).replace('.',''), count: 0, inicio: d.getTime() });
    }
    recs.forEach(r => {
      let dataVal = r['Data do Registro'];
      let dc;
      if (typeof dataVal === 'number') dc = new Date((dataVal - 25569)*86400*1000);
      else dc = new Date(dataVal);
      if (!dc || isNaN(dc)) return;
      const diffDays = Math.floor((agora - dc)/(1000*60*60*24));
      const idx = 11 - Math.floor(diffDays/7);
      if (idx >= 0 && idx < 12) semanas[idx].count++;
    });

    res.json({
      sucesso: true,
      dados: {
        kpis: {
          emAndamento,
          totalManifestacoes: mans.length,
          totalReclamacoes: recs.length,
          rncsAbertas,
          slaPercent: slaPercent !== null ? slaPercent : 'Sem dados suficientes',
          foraPrazo: recComSLA.length - dentroPrazo,
        },
        statusCount,
        porEmpresa,
        motivos: Object.entries(motivos).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,c])=>({motivo:m,count:c})),
        semanas: semanas.map(s => ({ label: s.label, count: s.count })),
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message, dados: {} });
  }
});

// ===== RNC =====
app.get('/api/rnc', async (req, res) => {
  try {
    const data = await lerAba('BANCO_RNC', 500);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== CLIENTES =====
app.get('/api/clientes/:cnpj', async (req, res) => {
  try {
    const cnpj = req.params.cnpj.replace(/\D/g,'');
    const historico = await lerAba('BANCO_HISTORICO', 2000);
    const casos = historico.filter(h => {
      const hcnpj = (h.ORIG_CONTATO || '').replace(/\D/g,'');
      return hcnpj.includes(cnpj) || cnpj.includes(hcnpj);
    });
    if (casos.length === 0) return res.json({ sucesso: true, encontrado: false, cliente: null, historico: [] });
    const ultimo = casos[casos.length-1];
    res.json({
      sucesso: true,
      encontrado: true,
      cliente: { contato: ultimo.ORIG_CONTATO, empresa: normalizarEmpresa(ultimo.ORIG_EMPRESA) || ultimo.ORIG_EMPRESA, reincidente: casos.length > 1 },
      historico: casos.slice(-5).map(c => ({
        id: c.ID_HISTORICO, data: normalizarData(c.ORIG_DATA_ABERTURA),
        descricao: (c.ORIG_DESCRICAO_RECLAMACAO||'').slice(0,100),
        status: c.ORIG_STATUS, tipo: c.COMP_TIPO_PROBLEMA_VALIDADO,
      })),
      totalCasos: casos.length,
    });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: null });
  }
});

// ===== RECLAMAÇÕES =====
app.get('/api/reclamacoes', async (req, res) => {
  try {
    const data = await lerAba('Reclamações + devolutiva', 2000);
    // Normalizar datas e empresas
    const normalizado = data.map(r => ({
      ...r,
      'Data do Registro': normalizarData(r['Data do Registro']),
      'Empresa': normalizarEmpresa(r['Empresa']) || r['Empresa'],
    })).filter(r => r['Empresa'] && !['TR01','TR08'].includes(r['Empresa']));
    res.json({ sucesso: true, total: normalizado.length, itens: normalizado });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== HISTORICO =====
app.get('/api/historico', async (req, res) => {
  try {
    const data = await lerAba('BANCO_HISTORICO', 1000);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== SETORES =====
app.get('/api/setores', async (req, res) => {
  try {
    const data = await lerAba('CONFIG_SETORES', 50);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== CONHECIMENTO =====
app.get('/api/conhecimento', async (req, res) => {
  try {
    const data = await lerAba('CONHECIMENTO_SETORES', 200);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== PROCEDIMENTOS =====
app.get('/api/procedimentos', async (req, res) => {
  try {
    const data = await lerAba('PROCEDIMENTOS', 200);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== POLÍTICAS =====
app.get('/api/politicas', async (req, res) => {
  try {
    const data = await lerAba('POLITICAS', 200);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== TIPOS =====
app.get('/api/tipos', async (req, res) => {
  try {
    const data = await lerAba('TIPOS_RECLAMACAO', 200);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== SLA =====
app.get('/api/sla', async (req, res) => {
  try {
    const data = await lerAba('SLA_ESCALONAMENTO', 50);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== VALIDAÇÕES =====
app.get('/api/validacoes', async (req, res) => {
  try {
    const data = await lerAba('HISTORICO_VALIDACOES', 1000);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== AUDITORIA =====
app.get('/api/auditoria', async (req, res) => {
  try {
    const data = await lerAba('LOG_SISTEMA', 1000);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, dados: [] });
  }
});

// ===== AUTH BACKEND =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body;
    const usuarios = JSON.parse(process.env.USUARIOS_JSON || '{}');
    if (!usuarios[usuario] || usuarios[usuario] !== senha) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha incorretos.' });
    }
    await registrarAuditoria(usuario, 'LOGIN', null, 'AUTH', null, { ts: new Date().toISOString() });
    res.json({ sucesso: true, usuario, perfil: 'analista', nome: usuario.charAt(0).toUpperCase() + usuario.slice(1) });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// ===== CATCH ALL =====
app.use((req, res) => {
  res.status(404).json({ sucesso: false, erro: `Rota não encontrada: ${req.method} ${req.path}`, dados: null });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ sucesso: false, erro: 'Erro interno do servidor.', dados: null });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`SAC Chiacchio API v3.0 rodando na porta ${PORT}`));

module.exports = app;
