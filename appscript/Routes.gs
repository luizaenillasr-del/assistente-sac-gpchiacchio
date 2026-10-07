// ============================================================
// Routes.gs — Handlers de todas as rotas da API
// Equivalente ao api/index.js do Node.js (sem o Express)
// ============================================================

function normalizarEmpresa(v) {
  if (!v) return '';
  var norm = normalizarTexto(v);
  for (var cod in EMPRESA_MAP) {
    if (EMPRESA_MAP[cod].some(function(g) { return norm.indexOf(g) >= 0; })) {
      return EMPRESA_MAP[cod][0]; // retorna a grafia canônica
    }
  }
  return v;
}

// ===== MANIFESTAÇÕES =====

function getManifestacoes(params) {
  var usuario = params._usuario;
  var status = params.status || '';
  var empresa = params.empresa || '';
  var setor = params.setor || '';
  var limit = parseInt(params.limit || '200');

  var data = [];
  try { data = lerAba('MANIFESTACOES', 2000); } catch(e) {}

  // Filtro de empresa do usuário
  var userEmpresa = params._empresaScope || null;
  data = filtrarPorEmpresaHistorico(data, userEmpresa, COLUNA_EMPRESA_ABA.MANIFESTACOES);

  if (status) data = data.filter(function(m) { return (m.STATUS||'').toUpperCase().indexOf(status.toUpperCase()) >= 0; });
  if (empresa) {
    var empCod = empresaCanonica(empresa);
    if (empCod && empCod !== 'MASTER') {
      data = data.filter(function(m) { return empresaCanonica(m.EMPRESA_RECLAMADA||'') === empCod; });
    }
  }
  if (setor) data = data.filter(function(m) { return (m.SETOR_DESTINADO||m.SETOR_CONFIRMADO||m.SETOR_SUGERIDO||'').indexOf(setor) >= 0; });

  return { sucesso: true, total: data.length, itens: data.slice(0, limit) };
}

function getManifestacao(params) {
  var id = params.id;
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var item = data.find(function(r) { return r.ID_MANIFESTACAO === id; });
  if (!item) return { sucesso: false, erro: 'Manifestação não encontrada.' };
  if (userEmpresa && !pertenceEmpresa(userEmpresa, item.EMPRESA_RECLAMADA||'')) {
    return { sucesso: false, erro: 'Acesso não autorizado para esta manifestação.' };
  }
  return { sucesso: true, manifestacao: item };
}

function criarManifestacao(params) {
  var body = params.body || {};
  var usuario = params._usuario || {};
  var empNorm = normalizarEmpresa(body.empresaReclamada);
  var id = gerarProximoID('MANIFESTACOES', 'MAN', 'ID_MANIFESTACAO');
  var agora = new Date().toISOString();
  var tipoFinal = body.tipo || 'Reclamação';
  var objeto = {
    ID_MANIFESTACAO: id, DATA_ABERTURA: agora, DATA_REGISTRO: agora,
    EMPRESA_RECLAMANTE: body.empresaReclamante || '', CONTATO: body.contato || '',
    PRODUTO: body.produto || '', LOTE: body.lote || '', NFE: body.nfe || '',
    DESCRICAO: body.descricao || '', DESCRICAO_MANIFESTACAO: body.descricao || '',
    STATUS: 'EM ANÁLISE', TIPO: tipoFinal, TIPO_SUGERIDO: '',
    SETOR_SUGERIDO: '', SETORES_SUGERIDOS: '', SLA_HORAS: '', PRIORIDADE: '',
    RNC_SUGERIDO: 'NÃO', RNC_SINALIZADO: '',
    EMPRESA_RECLAMADA: empNorm || body.empresaReclamada || '',
    CANAL: body.canal || '', CNPJ: body.cnpj || '', TELEFONE: body.telefone || '',
    EMAIL: body.email || '', QUANTIDADE: body.quantidade || '', VALOR: body.valor || '',
    TRATATIVA_SUGERIDA: '', TRATATIVA_APLICAVEL: '', TRATATIVA_REALIZADA: '',
    STATUS_TRATATIVA: 'NÃO INICIADA', DEVOLUTIVA_SUGERIDA: '', DEVOLUTIVA_FINAL: '',
    DEVOLUTIVA_ENVIADA: '', ORIGEM_DOCUMENTO: body.origemDocumento || '',
    ARQUIVO_ORIGEM: body.arquivoOrigem || '',
    USUARIO_CRIACAO: usuario.usuario || 'sistema', ORIGEM: body.origem || 'SAC',
  };

  try {
    garantirAbaComCabecalhos('MANIFESTACOES', Object.keys(objeto));
    appendObjeto('MANIFESTACOES', objeto);
  } catch(e) {
    return { sucesso: false, erro: erroSeguro(e) };
  }

  // Análise automática com motor de regras
  var analise = null;
  try {
    analise = motorRegras(body.descricao, body.tipo, body.empresaReclamada);
    if (analise) {
      var updAnalise = {
        TIPO_SUGERIDO: analise.tipoDetectado || '',
        SETOR_SUGERIDO: analise.setores && analise.setores[0] ? analise.setores[0] : '',
        SETORES_SUGERIDOS: analise.setores ? analise.setores.join(', ') : '',
        SLA_HORAS: analise.slaHoras || '', PRIORIDADE: analise.prioridade || '',
        RNC_SUGERIDO: 'NÃO', RNC_SINALIZADO: analise.rncSinalizado ? 'REVISAR' : '',
        STATUS: 'AGUARDANDO_DECISÃO',
      };
      try { atualizarPorID('MANIFESTACOES', id, updAnalise); } catch(e) {}
    }
  } catch(e) { Logger.log('Análise automática falhou: ' + e.message); }

  try { registrarAuditoria(usuario.usuario || 'sistema', 'CRIOU_MANIFESTAÇÃO', id, 'MANIFESTACOES', null, { tipo: tipoFinal }); } catch(e) {}
  return { sucesso: true, id: id, analise: analise, mensagem: 'Manifestação registrada com sucesso.' };
}

function atualizarManifestacao(params) {
  var id = params.id;
  var body = params.body || {};
  var usuario = params._usuario || {};
  var userEmpresa = (usuario.empresa || '');

  var todas = [];
  try { todas = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var itemExistente = todas.find(function(r) { return r.ID_MANIFESTACAO === id; });
  if (!itemExistente) return { sucesso: false, erro: 'Manifestação não encontrada.' };
  if (!pertenceEmpresa(userEmpresa, itemExistente.EMPRESA_RECLAMADA||'')) {
    return { sucesso: false, erro: 'Acesso negado: manifestação pertence a outra empresa.' };
  }

  var STATUS_VALIDOS = ['EM ANÁLISE','AGUARDANDO_DECISÃO','EM TRATAMENTO','AGUARDANDO_DEVOLUTIVA','ENCERRADA','REJEITADA','APROVADA'];
  var dados = {};
  if (body.status) {
    if (STATUS_VALIDOS.indexOf(body.status) < 0) return { sucesso: false, erro: 'Status inválido: ' + body.status };
    dados.STATUS = body.status;
    if (body.status === 'ENCERRADA') { dados.DATA_ENCERRAMENTO = new Date().toISOString(); dados.ENCERRADA_POR = usuario.usuario || 'sistema'; }
  }
  if (body.tratativa !== undefined) dados.TRATATIVA_REALIZADA = body.tratativa;
  if (body.devolutiva !== undefined) { dados.DEVOLUTIVA_FINAL = body.devolutiva; dados.DEVOLUTIVA_ENVIADA = body.devolutiva; }
  if (body.setor !== undefined) dados.SETOR_CONFIRMADO = body.setor;
  if (body.responsavel !== undefined) dados.RESPONSAVEL = body.responsavel;
  if (!Object.keys(dados).length) return { sucesso: false, erro: 'Nenhum campo para atualizar.' };

  try { atualizarPorID('MANIFESTACOES', id, dados); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  try { registrarAuditoria(usuario.usuario || 'sistema', 'ATUALIZOU_MANIFESTAÇÃO', id, 'MANIFESTACOES', null, dados); } catch(e) {}
  return { sucesso: true, id: id, atualizado: dados };
}

function decisaoManifestacao(params) {
  var id = params.id;
  var body = params.body || {};
  var usuario = params._usuario || {};

  var data = [];
  try { data = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var item = data.find(function(r) { return r.ID_MANIFESTACAO === id; });
  if (!item) return { sucesso: false, erro: 'Manifestação não encontrada.' };

  var agora = new Date().toISOString();
  var setoresStr = Array.isArray(body.setoresConfirmados) ? body.setoresConfirmados.join(', ') : (body.setoresConfirmados || '');
  var novoStatus = body.decisaoStatus === 'REJEITADA' ? 'REJEITADA' : 'EM TRATAMENTO';

  var upd = {
    TIPO: body.tipoConfirmado || item.TIPO || '',
    TIPO_CONFIRMADO: body.tipoConfirmado || '',
    SETORES_CONFIRMADOS: setoresStr,
    SETOR_SUGERIDO: setoresStr,
    PRIORIDADE: body.prioridade || item.PRIORIDADE || '',
    SLA_HORAS: body.slaHoras || item.SLA_HORAS || '',
    GERA_RNC: body.geraRNC || 'NÃO',
    STATUS: novoStatus,
    TRATATIVA_APLICAVEL: body.tratativaAplicavel || '',
    TRATATIVA_REALIZADA: body.tratativaRealizada || '',
    DATA_INICIO_TRATATIVA: body.dataInicioTratativa || '',
    STATUS_TRATATIVA: body.statusTratativa || 'NÃO INICIADA',
    DATA_CONCLUSAO_TRATATIVA: body.dataConclusaoTratativa || '',
    DEVOLUTIVA_FINAL: body.devolutivaFinal || '',
    DEVOLUTIVA_ENVIADA: body.devolutivaEnviada || '',
    DATA_DEVOLUTIVA: body.devolutivaEnviada ? agora : '',
  };
  try { atualizarPorID('MANIFESTACOES', id, upd); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  try { registrarAuditoria(body.usuario || usuario.usuario || 'sistema', 'DECISAO_MANIFESTACAO', id, 'MANIFESTACOES', item.STATUS, { novoStatus: novoStatus }); } catch(e) {}
  return { sucesso: true, id: id, status: novoStatus };
}

// ===== DASHBOARD =====

function getDashboard(params) {
  var userEmpresa = params._empresaScope || null;
  var mans = [];
  var recs = [];
  try { mans = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  try { recs = lerAbaReclamacoes(2000); } catch(e) {}

  mans = filtrarPorEmpresaHistorico(mans, userEmpresa, COLUNA_EMPRESA_ABA.MANIFESTACOES).filter(function(m) { return !isTeste(m); });
  recs = filtrarPorEmpresaHistorico(recs, userEmpresa, COLUNA_EMPRESA_ABA['Reclamações']).filter(function(r) { return !isTeste(r); });

  var emAndamento = mans.filter(function(m) {
    return !['FINALIZADA','ENCERRADA','CONCLUÍDA'].some(function(s) { return (m.STATUS||'').toUpperCase().indexOf(s) >= 0; });
  }).length;
  var rncsAbertas = mans.filter(function(m) { return m.ID_RNC && m.ID_RNC !== ''; }).length;

  function getSLA(r) { return (r['Dentro do Prazo? Cliente']||r['Dentro do Prazo? Setor']||r['Dentro do prazo? ']||r['Dentro do prazo?']||'').toUpperCase().trim(); }
  var recComSLA = recs.filter(function(r) { var v=getSLA(r); return v==='SIM'||v==='S'||v==='NÃO'||v==='NAO'; });
  var dentroPrazo = recComSLA.filter(function(r) { var v=getSLA(r); return v==='SIM'||v==='S'; }).length;
  var slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo/recComSLA.length*100) : null;

  var porEmpresa = {};
  recs.forEach(function(r) {
    var emp = (r['Empresa']||'').trim();
    if (!emp) return;
    if (!porEmpresa[emp]) porEmpresa[emp] = { total:0, finaliz:0, sla:0, foraSLA:0 };
    porEmpresa[emp].total++;
    var st = (r['Status']||r['Situação Final']||'').toUpperCase();
    if (st.indexOf('FINALIZ') >= 0 || st.indexOf('CONCLUÍD') >= 0) porEmpresa[emp].finaliz++;
    var slaV = getSLA(r);
    if (slaV === 'SIM') porEmpresa[emp].sla++; else if (slaV === 'NÃO'||slaV === 'NAO') porEmpresa[emp].foraSLA++;
  });

  var motivos = {};
  recs.forEach(function(r) { var m=(r['Motivo da Reclamação']||r['Setor']||'').trim(); if(m&&m!=='Não identificado') motivos[m]=(motivos[m]||0)+1; });

  var statusCount = {};
  mans.forEach(function(m) { var s=m.STATUS||'EM ANÁLISE'; statusCount[s]=(statusCount[s]||0)+1; });

  var semanas = [];
  var agora = new Date();
  for (var i = 11; i >= 0; i--) {
    var d = new Date(agora); d.setDate(d.getDate() - i * 7);
    semanas.push({ label: Utilities.formatDate(d, 'America/Sao_Paulo', 'dd/MM'), count: 0 });
  }
  recs.forEach(function(r) {
    var dv = r['Data de Registro']||r['Data do Registro'];
    if (!dv) return;
    var dc = new Date(dv);
    if (!dc || isNaN(dc)) return;
    var diff = Math.floor((agora - dc) / 86400000);
    var idx = 11 - Math.floor(diff / 7);
    if (idx >= 0 && idx < 12) semanas[idx].count++;
  });

  return {
    sucesso: true,
    dados: {
      kpis: { emAndamento: emAndamento, totalManifestacoes: mans.length, totalReclamacoes: recs.length, rncsAbertas: rncsAbertas, slaPercent: slaPercent !== null ? slaPercent : 'Sem dados', foraPrazo: recComSLA.length - dentroPrazo },
      statusCount: statusCount,
      porEmpresa: porEmpresa,
      motivos: Object.keys(motivos).map(function(m) { return { motivo: m, count: motivos[m] }; }).sort(function(a,b){return b.count-a.count;}).slice(0,10),
      semanas: semanas,
    }
  };
}

// ===== RNC =====

function getRNC(params) {
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('BANCO_RNC', 5000); } catch(e) {}
  data = filtrarPorEmpresaHistorico(data, userEmpresa, COLUNA_EMPRESA_ABA.BANCO_RNC);
  if (params.status) data = data.filter(function(x) { return (x.STATUS||'').toUpperCase() === params.status.toUpperCase(); });
  return { sucesso: true, total: data.length, itens: data };
}

function criarRNC(params) {
  var body = params.body || {};
  var usuario = params._usuario || {};
  if (!body.COMPETENCIA && !body.competencia) return { sucesso: false, erro: 'Competência da RNC é obrigatória.' };
  var id = gerarProximoID('BANCO_RNC', 'RNC', 'ID_RNC');
  var agora = new Date().toISOString();
  var competencia = body.COMPETENCIA || body.competencia;
  var usuarioCriador = usuario.usuario || body.usuario || 'sistema';
  try {
    appendObjeto('BANCO_RNC', {
      ID_RNC: id, DATA_ABERTURA: agora, EMPRESA: body.EMPRESA || body.empresa || '',
      SETOR: body.SETOR || body.setor || '', COMPETENCIA: competencia,
      NAO_CONFORMIDADE: body.NAO_CONFORMIDADE || body.naoConformidade || '',
      CAUSA: body.CAUSA || body.causa || '',
      RESPONSAVEL: body.RESPONSAVEL || body.responsavel || '',
      PRIORIDADE: body.PRIORIDADE || body.prioridade || 'Média',
      PRAZO: body.PRAZO || body.prazo || '',
      STATUS: 'AGUARDANDO_APROVACAO', USUARIO_CRIACAO: usuarioCriador,
    });
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  try { registrarAuditoria(usuarioCriador, 'CRIOU_RNC', id, 'BANCO_RNC', null, { competencia: competencia }); } catch(e) {}
  return { sucesso: true, id: id, competencia: competencia, status: 'AGUARDANDO_APROVACAO' };
}

function getRNCById(params) {
  var id = params.id;
  var userEmpresa = params._empresaScope || null;
  var rnc = (lerAba('BANCO_RNC', 5000) || []).find(function(x) { return x.ID_RNC === id; });
  if (!rnc) return { sucesso: false, erro: 'RNC não encontrada.' };
  if (userEmpresa && !pertenceEmpresa(userEmpresa, rnc.EMPRESA||'')) return { sucesso: false, erro: 'Acesso não autorizado para esta RNC.' };
  var eventos = (lerAba('RNC_EVENTOS', 5000) || []).filter(function(x) { return x.ID_RNC === id; });
  var anexos = (lerAba('ANEXOS', 5000) || []).filter(function(x) { return x.ID_ENTIDADE === id; });
  return { sucesso: true, rnc: rnc, eventos: eventos, anexos: anexos };
}

function decisaoRNC(params) {
  var id = params.id;
  var body = params.body || {};
  var usuario = params._usuario || {};
  var decisao = body.decisao || '';
  if (!decisao) return { sucesso: false, erro: 'Decisão é obrigatória.' };
  var rnc = (lerAba('BANCO_RNC', 5000) || []).find(function(x) { return x.ID_RNC === id; });
  if (!rnc) return { sucesso: false, erro: 'RNC não encontrada.' };
  if (!pertenceEmpresa(usuario.empresa||'', rnc.EMPRESA||'')) return { sucesso: false, erro: 'Acesso não autorizado para esta RNC.' };
  var d = String(decisao).toUpperCase();
  if (d !== 'APROVAR' && (!body.observacoes || !String(body.observacoes).trim())) return { sucesso: false, erro: 'Justificativa é obrigatória.' };
  var status = d === 'APROVAR' ? 'APROVADA' : (d === 'REJEITAR' ? 'REJEITADA' : 'DEVOLVIDA');
  var agora = new Date().toISOString();
  try {
    atualizarPorID('BANCO_RNC', id, { STATUS: status, APROVADOR_DECISAO: usuario.usuario||'', DATA_DECISAO: agora, OBSERVACOES_APROVACAO: body.observacoes||'' }, ['ID_RNC']);
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  try { registrarAuditoria(usuario.usuario||'sistema', 'DECISAO_RNC', id, 'BANCO_RNC', rnc.STATUS, { status: status }); } catch(e) {}
  return { sucesso: true, id: id, status: status };
}

// ===== EMPRESAS =====

function getEmpresas(params) {
  var data = [];
  try { data = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var empresas = {};
  data.forEach(function(r) {
    var emp = (r.EMPRESA_RECLAMADA || '').trim();
    if (emp) empresas[emp] = (empresas[emp] || 0) + 1;
  });
  var itens = Object.keys(empresas).map(function(e) { return { nome: e, total: empresas[e] }; });
  return { sucesso: true, total: itens.length, itens: itens };
}

function getCliente(params) {
  var cnpj = params.cnpj;
  var data = [];
  try { data = lerAba('CLIENTES', 5000); } catch(e) {}
  if (!data.length) try { data = lerAba('EMPRESAS_CLIENTES', 5000); } catch(e) {}
  var cliente = data.find(function(c) { return (c.CNPJ||'').replace(/\D/g,'') === cnpj.replace(/\D/g,''); });
  if (!cliente) return { sucesso: false, erro: 'Cliente não encontrado.' };
  return { sucesso: true, cliente: cliente };
}

// ===== SETORES =====

function getSetores(params) {
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('CONFIG_SETORES', 500); } catch(e) {}
  data = filtrarPorEmpresaConfig(data, userEmpresa, 'EMPRESA');
  return { sucesso: true, itens: data };
}

function getSetoresUnicos(params) {
  var mans = [];
  var recs = [];
  try { mans = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  try { recs = lerAbaReclamacoes(2000); } catch(e) {}
  var set = {};
  mans.forEach(function(m) {
    var s = m.SETOR_DESTINADO || m.SETOR_CONFIRMADO || m.SETOR_SUGERIDO || '';
    if (s) s.split(',').forEach(function(x) { x = x.trim(); if (x) set[x] = true; });
  });
  recs.forEach(function(r) {
    var s = r['Setor'] || r['Setor Responsável'] || '';
    if (s) set[s.trim()] = true;
  });
  return { sucesso: true, setores: Object.keys(set).sort() };
}

function getSetorOperacional(params) {
  var setor = params.setor;
  var data = [];
  try { data = lerAba('CONFIG_SETORES', 500); } catch(e) {}
  var item = data.find(function(s) { return (s.SETOR||'') === setor; });
  return { sucesso: true, item: item || null };
}

function atualizarSetorOperacional(params) {
  var setor = params.setor;
  var body = params.body || {};
  var usuario = params._usuario || {};
  var upd = Object.assign({}, body, { ULTIMA_ATUALIZACAO: new Date().toISOString(), ATUALIZADO_POR: usuario.usuario||'' });
  try { atualizarPorID('CONFIG_SETORES', setor, upd, ['SETOR']); } catch(e) {
    try { appendObjeto('CONFIG_SETORES', Object.assign({ SETOR: setor }, upd)); } catch(e2) {}
  }
  return { sucesso: true };
}

// ===== CONHECIMENTO / MATRIZ =====

function getConhecimento(params) {
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('MATRIZ_CONHECIMENTO', 1000); } catch(e) {}
  data = filtrarPorEmpresaConfig(data, userEmpresa, 'EMPRESA');
  return { sucesso: true, itens: data };
}

function getMatrizConhecimento(params) {
  var data = [];
  try { data = lerAba('MATRIZ_CONHECIMENTO', 2000); } catch(e) {}
  var empresa = params.empresa || '';
  var setor = params.setor || '';
  var status = params.status || '';
  if (empresa) {
    var empCod = empresaCanonica(empresa);
    if (empCod && empCod !== 'MASTER') data = data.filter(function(x) { return !x.EMPRESA || empresaCanonica(x.EMPRESA||'') === empCod; });
  }
  if (setor) data = data.filter(function(x) { return (x.SETOR||'') === setor; });
  if (status) data = data.filter(function(x) { return (x.STATUS||'') === status; });
  return { sucesso: true, total: data.length, itens: data };
}

function getMatrizConhecimentoById(params) {
  var id = params.id;
  var data = [];
  try { data = lerAba('MATRIZ_CONHECIMENTO', 2000); } catch(e) {}
  var item = data.find(function(x) { return x.ID === id || x.ID_MATRIZ === id; });
  if (!item) return { sucesso: false, erro: 'Item não encontrado.' };
  var itens = (lerAba('MC_ITENS', 1000)||[]).filter(function(x) { return x.ID_MATRIZ === id; });
  var evidencias = (lerAba('MC_EVIDENCIAS', 1000)||[]).filter(function(x) { return x.ID_MATRIZ === id; });
  var excecoes = (lerAba('MC_EXCECOES', 1000)||[]).filter(function(x) { return x.ID_MATRIZ === id; });
  return { sucesso: true, item: item, itens: itens, evidencias: evidencias, excecoes: excecoes };
}

function criarMatrizConhecimento(params) {
  var body = params.body || {};
  var usuario = params._usuario || {};
  var id = gerarProximoID('MATRIZ_CONHECIMENTO', 'MC', 'ID');
  var agora = new Date().toISOString();
  var obj = Object.assign({}, body, { ID: id, DATA_CRIACAO: agora, CRIADO_POR: usuario.usuario||'', STATUS: body.STATUS || 'ATIVO' });
  try { appendObjeto('MATRIZ_CONHECIMENTO', obj); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  return { sucesso: true, id: id };
}

function atualizarMatrizConhecimento(params) {
  var id = params.id;
  var body = params.body || {};
  var usuario = params._usuario || {};
  var upd = Object.assign({}, body, { ATUALIZADO_EM: new Date().toISOString(), ATUALIZADO_POR: usuario.usuario||'' });
  try { atualizarPorID('MATRIZ_CONHECIMENTO', id, upd, ['ID','ID_MATRIZ']); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  return { sucesso: true };
}

// ===== ANÁLISE IA =====

function analisarManifestacao(params) {
  var body = params.body || {};
  try {
    var regras = motorRegras(body.descricao || '', body.tipo || '', body.empresa || '');
    return { sucesso: true, analise: regras };
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
}

function analisarSimilares(params) {
  var body = params.body || {};
  var descricao = body.descricao || '';
  var mans = [];
  try { mans = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var similares = mans.filter(function(m) {
    if (!m.DESCRICAO) return false;
    var score = calcularSimilaridade(descricao, m.DESCRICAO);
    m._score = score;
    return score > 0.3;
  }).sort(function(a,b){return b._score-a._score;}).slice(0,5);
  return { sucesso: true, similares: similares };
}

function calcularSimilaridade(a, b) {
  var wa = normalizarTexto(a).split(/\s+/);
  var wb = normalizarTexto(b).split(/\s+/);
  var setA = {};
  wa.forEach(function(w) { if (w.length > 3) setA[w] = true; });
  var intersect = 0;
  wb.forEach(function(w) { if (setA[w]) intersect++; });
  var union = Object.keys(setA).length + wb.filter(function(w) { return w.length > 3; }).length - intersect;
  return union > 0 ? intersect / union : 0;
}

function gerarTratativa(params) {
  var id = params.id;
  var body = params.body || {};
  var mans = [];
  try { mans = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var item = mans.find(function(r) { return r.ID_MANIFESTACAO === id; });
  if (!item) return { sucesso: false, erro: 'Manifestação não encontrada.' };
  try {
    var resultado = gerarTratativaComIA(item, body.contexto || '');
    atualizarPorID('MANIFESTACOES', id, { TRATATIVA_SUGERIDA: resultado.texto, STATUS: 'AGUARDANDO_DECISÃO' });
    return { sucesso: true, tratativa: resultado.texto, modelo: resultado.modelo };
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
}

function gerarDevolutiva(params) {
  var id = params.id;
  var body = params.body || {};
  var mans = [];
  try { mans = lerAba('MANIFESTACOES', 2000); } catch(e) {}
  var item = mans.find(function(r) { return r.ID_MANIFESTACAO === id; });
  if (!item) return { sucesso: false, erro: 'Manifestação não encontrada.' };
  var tratativa = item.TRATATIVA_REALIZADA || item.TRATATIVA_SUGERIDA || '';
  try {
    var resultado = gerarDevolutivaComIA(item, body.tratativa || tratativa);
    atualizarPorID('MANIFESTACOES', id, { DEVOLUTIVA_SUGERIDA: resultado.texto });
    return { sucesso: true, devolutiva: resultado.texto, modelo: resultado.modelo };
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
}

function extrairSetor(params) {
  var body = params.body || {};
  try {
    var resultado = extrairSetorComIA(body.descricao || '');
    return { sucesso: true, setor: resultado.setor };
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
}

// ===== MOTOR DE REGRAS =====

function motorRegras(descricao, tipo, empresa) {
  var regras = []; var tipos = []; var procedimentos = []; var slaData = []; var perguntas = [];
  try { regras = lerAba('REGRAS_ROTEAMENTO', 500); } catch(e) {}
  try { tipos = lerAba('TIPOS_RECLAMACAO', 500); } catch(e) {}
  try { procedimentos = lerAba('PROCEDIMENTOS', 200); } catch(e) {}
  try { slaData = lerAba('SLA_ESCALONAMENTO', 50); } catch(e) {}
  try { perguntas = lerAba('PERGUNTAS_ANALISE', 200); } catch(e) {}

  var texto = (descricao || '').toLowerCase();
  var tipoDetectado = 'Não identificado', tipoConfianca = 0, tipoID = null;
  tipos.forEach(function(t) {
    var palavras = (t.PALAVRAS_CHAVE || '').toLowerCase().split(',').map(function(p) { return p.trim(); }).filter(Boolean);
    var matches = palavras.filter(function(p) { return p && texto.indexOf(p) >= 0; }).length;
    if (matches > 0) {
      var conf = Math.min(99, Math.round((matches / Math.max(palavras.length, 1)) * 200));
      if (conf > tipoConfianca) { tipoConfianca = conf; tipoDetectado = t.TIPO || t.ID_TIPO; tipoID = t.ID_TIPO; }
    }
  });

  var setoresSet = {};
  regras.forEach(function(r) {
    if (r.ATIVO !== 'SIM') return;
    var tiposRegra = (r.TIPO || '').split('/').map(function(t) { return t.trim(); });
    if (tiposRegra.indexOf(tipoID) >= 0 || tiposRegra.some(function(t) { return (tipoID||'').indexOf(t) >= 0; })) {
      (r.SETORES_ENVOLVIDOS || '').split('+').map(function(s) { return s.trim().split('(')[0].trim(); }).filter(Boolean).forEach(function(s) { setoresSet[s] = true; });
    }
  });

  if (!Object.keys(setoresSet).length) {
    if (texto.indexOf('entrega') >= 0 || texto.indexOf('prazo') >= 0 || texto.indexOf('atraso') >= 0) setoresSet['Logística'] = true;
    if (texto.indexOf('qualidade') >= 0 || texto.indexOf('defeito') >= 0 || texto.indexOf('ruptura') >= 0) setoresSet['Qualidade'] = true;
    if (texto.indexOf('nota') >= 0 || texto.indexOf('cobrança') >= 0 || texto.indexOf('valor') >= 0) setoresSet['Financeiro'] = true;
    if (texto.indexOf('comercial') >= 0 || texto.indexOf('pedido') >= 0) setoresSet['Comercial'] = true;
    if (!Object.keys(setoresSet).length) setoresSet['SAC'] = true;
  }

  var setores = Object.keys(setoresSet);
  var slaHoras = 72;
  var slaSetor = slaData.find(function(s) { return s.SETOR && s.SETOR.indexOf('SAC') >= 0; });
  if (slaSetor) { var m = (slaSetor.SLA_PADRAO_HORAS||'72').match(/\d+/); if (m) slaHoras = parseInt(m[0]); }

  var prioridade = 'Média';
  if (texto.indexOf('urgente') >= 0 || texto.indexOf('perda') >= 0 || setores.length >= 3) prioridade = 'Alta';
  else if (texto.indexOf('elogio') >= 0 || texto.indexOf('satisfeito') >= 0) prioridade = 'Baixa';

  var procedimentoSugerido = null;
  for (var pi = 0; pi < procedimentos.length; pi++) {
    var p = procedimentos[pi];
    var tiposProc = (p.TIPO_RECLAMACAO || '').split(',').map(function(t) { return t.trim(); });
    if (tiposProc.indexOf(tipoID) >= 0 || tiposProc.some(function(t) { return (tipoID||'').indexOf(t) >= 0; })) {
      procedimentoSugerido = { id: p.ID_PROCEDIMENTO, nome: p.NOME, passos: p.PASSOS, documentos: p.DOCUMENTOS_NECESSARIOS };
      break;
    }
  }

  var perguntasNecessarias = perguntas.filter(function(p) {
    return p.TIPO_RECLAMACAO === 'TODOS' || (tipoID && (p.TIPO_RECLAMACAO||'').indexOf(tipoID) >= 0);
  }).slice(0, 6).map(function(p) { return { id: p.ID_PERGUNTA, pergunta: p.PERGUNTA, obrigatoria: p.OBRIGATORIA === 'SIM' }; });

  var rncSinalizado = texto.indexOf('reincidência') >= 0 || texto.indexOf('terceira') >= 0 || prioridade === 'Alta';

  return {
    tipoDetectado: tipoDetectado, tipoID: tipoID, tipoConfianca: tipoConfianca,
    setores: setores, slaHoras: slaHoras, prioridade: prioridade,
    procedimentoSugerido: procedimentoSugerido, perguntasNecessarias: perguntasNecessarias,
    geraRNC: false, rncSinalizado: rncSinalizado,
  };
}

// ===== ADMIN / USUÁRIOS =====

function getUsuarios(params) {
  var data = [];
  try { data = carregarUsuarios(); } catch(e) {}
  var itens = data.map(function(u) { return usuarioPublico(u); });
  return { sucesso: true, total: itens.length, itens: itens };
}

function atualizarPermissoesUsuario(params) {
  var id = params.id;
  var body = params.body || {};
  var usuario = params._usuario || {};
  var upd = {};
  if (body.perfil) upd.PERFIL = body.perfil;
  if (body.status) upd.STATUS = body.status;
  if (body.empresa !== undefined) upd.EMPRESA = body.empresa;
  if (body.setor !== undefined) upd.SETOR = body.setor;
  upd.ATUALIZADO_POR = usuario.usuario || '';
  upd.ATUALIZADO_EM = new Date().toISOString();
  try { atualizarPorID('USUARIOS', id, upd, ['ID_USUARIO','USUARIO']); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  return { sucesso: true };
}

function ativarDesativarUsuario(params) {
  var id = params.id;
  var novoStatus = params.acao === 'ativar' ? 'ATIVO' : 'INATIVO';
  try { atualizarPorID('USUARIOS', id, { STATUS: novoStatus }, ['ID_USUARIO','USUARIO']); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  return { sucesso: true, status: novoStatus };
}

// ===== PRODUTOS / SETORES IMPORT =====

function getProdutos(params) {
  var data = [];
  try { data = lerAba('PRODUTOS', 2000); } catch(e) {}
  return { sucesso: true, itens: data };
}

// ===== BIBLIOTECA DE FICHAS =====

function getBibliotecaFichas(params) {
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('FICHAS', 2000); } catch(e) {}
  try { if (!data.length) data = lerAba('BIBLIOTECA_FICHAS', 2000); } catch(e) {}
  data = filtrarPorEmpresaHistorico(data, userEmpresa, 'EMPRESA');
  if (params.setor) data = data.filter(function(f) { return (f.SETOR||'') === params.setor; });
  if (params.tipo) data = data.filter(function(f) { return (f.TIPO||'') === params.tipo; });
  if (params.busca) {
    var q = normalizarTexto(params.busca);
    data = data.filter(function(f) { return normalizarTexto(JSON.stringify(f)).indexOf(q) >= 0; });
  }
  return { sucesso: true, total: data.length, itens: data.slice(0, parseInt(params.max||'50')) };
}

function getBibliotecaFichaById(params) {
  var id = params.id;
  var data = [];
  try { data = lerAba('FICHAS', 2000); } catch(e) {}
  try { if (!data.length) data = lerAba('BIBLIOTECA_FICHAS', 2000); } catch(e) {}
  var item = data.find(function(f) { return f.ID === id || f.ID_FICHA === id; });
  if (!item) return { sucesso: false, erro: 'Ficha não encontrada.' };
  return { sucesso: true, ficha: item };
}

// ===== PESQUISA DE SATISFAÇÃO =====

function getPesquisaRelatorio(params) {
  var empresa = params.empresa || '';
  var ano = params.ano || '';
  var mes = params.mes || '';
  var data = [];
  try { data = lerAbaPesquisa('PESQUISAS', 5000); } catch(e) {}
  if (empresa) data = data.filter(function(r) { return (r.EMPRESA||'') === empresa; });
  if (ano) data = data.filter(function(r) { return String(r.ANO||'') === String(ano); });
  if (mes) data = data.filter(function(r) { return String(r.MES||'') === String(mes); });
  return { sucesso: true, dados: data };
}

// ===== PLANILHA (Alimentação) =====

function getPlanilhaAba(params) {
  var aba = params.aba;
  var max = parseInt(params.max || '5000');
  if (!aba) return { sucesso: false, erro: 'Aba não informada.' };
  var data = [];
  try { data = lerAba(aba, max); } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
  return { sucesso: true, itens: data, total: data.length };
}

function getPlanilhaCabecalhos(params) {
  var aba = params.aba;
  if (!aba) return { sucesso: false, erro: 'Aba não informada.' };
  try {
    var headers = obterCabecalhos(aba);
    return { sucesso: true, cabecalhos: headers };
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }
}

function importarPlanilhaAba(params) {
  var aba = params.aba;
  var body = params.body || {};
  var itens = body.itens || [];
  if (!aba) return { sucesso: false, erro: 'Aba não informada.' };
  var erros = 0;
  itens.forEach(function(item) {
    try { appendObjeto(aba, item); } catch(e) { erros++; }
  });
  invalidarCacheAba(aba);
  return { sucesso: true, importados: itens.length - erros, erros: erros };
}

// ===== ALIMENTAÇÃO STATUS =====

function getAlimentacaoStatus(params) {
  var abas = ['MANIFESTACOES','BANCO_RNC','USUARIOS','CONFIG_SETORES','TIPOS_RECLAMACAO','MATRIZ_CONHECIMENTO'];
  var status = {};
  abas.forEach(function(aba) {
    try {
      var data = lerAba(aba, 100);
      status[aba] = { linhas: data.length, ok: true };
    } catch(e) {
      status[aba] = { linhas: 0, ok: false, erro: e.message };
    }
  });
  return { sucesso: true, status: status };
}

// ===== RECLAMAÇÕES / HISTÓRICO =====

function getReclamacoes(params) {
  var userEmpresa = params._empresaScope || null;
  var data = lerAbaReclamacoes(2000);
  data = filtrarPorEmpresaHistorico(data, userEmpresa, COLUNA_EMPRESA_ABA['Reclamações']);
  return { sucesso: true, total: data.length, itens: data };
}

function getHistorico(params) {
  var userEmpresa = params._empresaScope || null;
  var data = [];
  try { data = lerAba('BANCO_HISTORICO', 5000); } catch(e) {}
  data = filtrarPorEmpresaHistorico(data, userEmpresa, COLUNA_EMPRESA_ABA.BANCO_HISTORICO);
  return { sucesso: true, total: data.length, itens: data };
}

// ===== FAQ / REGRAS / PROCEDIMENTOS POR SETOR =====

function getSetorFAQ(params) {
  var setor = params.setor;
  var data = [];
  try { data = lerAba('FAQ_SETORES', 500); } catch(e) {}
  var itens = setor ? data.filter(function(x) { return (x.SETOR||'') === setor; }) : data;
  return { sucesso: true, itens: itens };
}

function getSetorRegras(params) {
  var setor = params.setor;
  var data = [];
  try { data = lerAba('REGRAS_SETORES', 500); } catch(e) {}
  var itens = setor ? data.filter(function(x) { return (x.SETOR||'') === setor; }) : data;
  return { sucesso: true, itens: itens };
}

function getSetorProcedimentos(params) {
  var setor = params.setor;
  var data = [];
  try { data = lerAba('PROCEDIMENTOS', 200); } catch(e) {}
  var itens = setor ? data.filter(function(x) { return (x.SETOR||'') === setor; }) : data;
  return { sucesso: true, itens: itens };
}

function getSetorPoliticas(params) {
  var setor = params.setor;
  var data = [];
  try { data = lerAba('POLITICAS', 200); } catch(e) {}
  var itens = setor ? data.filter(function(x) { return (x.SETOR||'') === setor; }) : data;
  return { sucesso: true, itens: itens };
}

function getSetorConhecimentoCompleto(params) {
  var setor = params.setor;
  var userEmpresa = params._empresaScope || null;
  var faq = []; var regras = []; var procs = []; var pols = [];
  try { faq = lerAba('FAQ_SETORES', 500).filter(function(x){return x.SETOR===setor;}); } catch(e) {}
  try { regras = lerAba('REGRAS_SETORES', 500).filter(function(x){return x.SETOR===setor;}); } catch(e) {}
  try { procs = lerAba('PROCEDIMENTOS', 200).filter(function(x){return x.SETOR===setor;}); } catch(e) {}
  try { pols = lerAba('POLITICAS', 200).filter(function(x){return x.SETOR===setor;}); } catch(e) {}
  return { sucesso: true, faq: faq, regras: regras, procedimentos: procs, politicas: pols };
}

// ===== PERMISSÕES =====

function getPermissoes(params) {
  var usuario = params._usuario || {};
  var perfil = perfilCanonico(usuario.perfil || '');
  var perms = {
    podeVerDashboard: ['MASTER','ANALISTA SAC','APROVADOR'].indexOf(perfil) >= 0,
    podeCriarManifestacao: ['MASTER','ANALISTA SAC'].indexOf(perfil) >= 0,
    podeAprovarRNC: ['MASTER','APROVADOR'].indexOf(perfil) >= 0,
    podeVerAdmin: perfil === 'MASTER',
    podeVerCentral: ['MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'].indexOf(perfil) >= 0,
    podeVerCerebro: ['MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'].indexOf(perfil) >= 0,
    podeAlimentar: perfil === 'MASTER',
    perfil: perfil,
    empresa: usuario.empresa || '',
  };
  return { sucesso: true, permissoes: perms };
}

// ===== BOOTSTRAP (criação do primeiro usuário MASTER) =====

function doBootstrap(body) {
  var usuario = (body.usuario || '').trim();
  var nome = (body.nome || '').trim();
  var senha = body.senha || '';
  if (!usuario || !nome || !senha) return { sucesso: false, erro: 'Todos os campos são obrigatórios.' };

  var usuarios = [];
  try { usuarios = lerAba('USUARIOS', 100); } catch(e) {}

  // Só permite bootstrap se não houver nenhum MASTER
  var masters = usuarios.filter(function(u) { return perfilCanonico(u.PERFIL||'') === 'MASTER' && normalizarTexto(u.STATUS||'ATIVO') === 'ativo'; });
  if (masters.length > 0) return { sucesso: false, erro: 'Usuário MASTER já existe.' };

  var hash = 'sha256:' + sha256Hex(senha);
  var id = gerarProximoID('USUARIOS', 'USR', 'ID_USUARIO');
  var agora = new Date().toISOString();
  try {
    garantirAbaComCabecalhos('USUARIOS', ['ID_USUARIO','USUARIO','EMAIL','NOME','PERFIL','EMPRESA','SETOR','STATUS','SENHA','SENHA_HASH','CODIGO_RCA','DATA_CRIACAO','ULTIMO_ACESSO']);
    appendObjeto('USUARIOS', {
      ID_USUARIO: id, USUARIO: usuario, EMAIL: '', NOME: nome,
      PERFIL: 'MASTER', EMPRESA: 'Grupo Chiacchio', SETOR: 'SAC',
      STATUS: 'ATIVO', SENHA: hash, SENHA_HASH: hash, CODIGO_RCA: '',
      DATA_CRIACAO: agora, ULTIMO_ACESSO: agora,
    });
  } catch(e) { return { sucesso: false, erro: erroSeguro(e) }; }

  return { sucesso: true, mensagem: 'Usuário MASTER criado com sucesso.' };
}
