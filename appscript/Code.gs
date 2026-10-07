// ============================================================
// Code.gs — Entry point do Google Apps Script
// doGet serve o HTML; apiCall é o router único da API
// ============================================================

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || 'index';
  var output = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('SAC GRUPO CHIACCHIO')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return output;
}

// ============================================================
// apiCall — único ponto de entrada para chamadas do frontend
// Recebe params = { path, method, token, body, ...queryParams }
// ============================================================
function apiCall(params) {
  params = params || {};
  var path   = (params.path   || '').replace(/^\/+/, '');
  var method = (params.method || 'GET').toUpperCase();
  var token  = params.token  || '';
  var body   = params.body   || {};

  // Rotas públicas (não exigem autenticação)
  var PUBLIC_PATHS = [
    'auth/login', 'auth/forgot-password', 'auth/reset-password',
    'bootstrap', 'health',
  ];
  var isPublic = PUBLIC_PATHS.some(function(p) { return path === p; });

  var usuario = null;
  var empresaScope = null;

  if (!isPublic) {
    var sessao = verificarSessao(token);
    if (!sessao) return { sucesso: false, erro: 'Não autenticado.', status: 401 };
    usuario = sessao;
    empresaScope = _calcularEmpresaScope(sessao);
  }

  // Injeta contexto nos params
  params._usuario     = usuario;
  params._empresaScope = empresaScope;
  params.body         = body;

  try {
    return _dispatch(path, method, params);
  } catch(e) {
    Logger.log('apiCall error [' + path + ']: ' + e.message);
    return { sucesso: false, erro: erroSeguro(e) };
  }
}

function _calcularEmpresaScope(sessao) {
  var perfil = perfilCanonico(sessao.perfil || '');
  if (perfil === 'MASTER') return null;
  return empresaCanonica(sessao.empresa || '') || null;
}

// ============================================================
// Router — mapeia path+method para handler
// ============================================================
function _dispatch(path, method, params) {
  // ── Auth ──────────────────────────────────────────────────
  if (path === 'auth/login'           && method === 'POST') return handleLogin(params.body);
  if (path === 'auth/logout'          && method === 'POST') return handleLogout(params.token);
  if (path === 'auth/me'                                  ) return handleAuthMe(params.token);
  if (path === 'auth/forgot-password' && method === 'POST') return handleForgotPassword(params.body);
  if (path === 'auth/reset-password'  && method === 'POST') return handleResetPassword(params.body);

  // ── Bootstrap / Health ───────────────────────────────────
  if (path === 'bootstrap') return doBootstrap(params.body);
  if (path === 'health')    return { sucesso: true, status: 'ok', ts: new Date().toISOString() };

  // ── Manifestações ─────────────────────────────────────────
  if (path === 'manifestacoes' && method === 'GET')  return getManifestacoes(params);
  if (path === 'manifestacoes' && method === 'POST') return criarManifestacao(params);
  if (_matchId(path, 'manifestacoes')) {
    params.id = _extractId(path, 'manifestacoes');
    if (method === 'GET')   return getManifestacao(params);
    if (method === 'PUT' || method === 'PATCH') return atualizarManifestacao(params);
  }
  if (_matchSub(path, 'manifestacoes', 'decisao') && method === 'POST') {
    params.id = _extractId(path, 'manifestacoes');
    return decisaoManifestacao(params);
  }

  // ── RNC ───────────────────────────────────────────────────
  if (path === 'rnc' && method === 'GET')  return getRNC(params);
  if (path === 'rnc' && method === 'POST') return criarRNC(params);
  if (_matchId(path, 'rnc')) {
    params.id = _extractId(path, 'rnc');
    if (method === 'GET') return getRNCById(params);
  }
  if (_matchSub(path, 'rnc', 'decisao') && method === 'POST') {
    params.id = _extractId(path, 'rnc');
    return decisaoRNC(params);
  }

  // ── Dashboard ─────────────────────────────────────────────
  if (path === 'dashboard') return getDashboard(params);

  // ── Empresas / Clientes ───────────────────────────────────
  if (path === 'empresas') return getEmpresas(params);
  if (_matchId(path, 'clientes')) {
    params.id = _extractId(path, 'clientes');
    return getCliente(params);
  }

  // ── Setores ───────────────────────────────────────────────
  if (path === 'setores')           return getSetores(params);
  if (path === 'setores/unicos')    return getSetoresUnicos(params);
  if (_matchId(path, 'setores')) {
    params.id = _extractId(path, 'setores');
    if (method === 'GET') return getSetorOperacional(params);
    if (method === 'PUT' || method === 'PATCH') return atualizarSetorOperacional(params);
  }

  // ── Conhecimento / Base ───────────────────────────────────
  if (path === 'conhecimento' && method === 'GET')  return getConhecimento(params);
  if (path === 'matriz-conhecimento' && method === 'GET')  return getMatrizConhecimento(params);
  if (path === 'matriz-conhecimento' && method === 'POST') return criarMatrizConhecimento(params);
  if (_matchId(path, 'matriz-conhecimento')) {
    params.id = _extractId(path, 'matriz-conhecimento');
    if (method === 'GET') return getMatrizConhecimentoById(params);
    if (method === 'PUT' || method === 'PATCH') return atualizarMatrizConhecimento(params);
  }

  // ── IA ────────────────────────────────────────────────────
  if (path === 'ia/analisar'         && method === 'POST') return analisarManifestacao(params);
  if (path === 'ia/similares'        && method === 'POST') return analisarSimilares(params);
  if (path === 'ia/tratativa'        && method === 'POST') return gerarTratativa(params);
  if (path === 'ia/devolutiva'       && method === 'POST') return gerarDevolutiva(params);
  if (path === 'ia/extrair-setor'    && method === 'POST') return extrairSetor(params);

  // ── Usuários / Admin ──────────────────────────────────────
  if (path === 'usuarios' && method === 'GET') return getUsuarios(params);
  if (_matchSub(path, 'usuarios', 'permissoes') && method === 'PUT') {
    params.id = _extractId(path, 'usuarios');
    return atualizarPermissoesUsuario(params);
  }
  if (_matchSub(path, 'usuarios', 'status') && (method === 'PUT' || method === 'PATCH')) {
    params.id = _extractId(path, 'usuarios');
    return ativarDesativarUsuario(params);
  }

  // ── Produtos ──────────────────────────────────────────────
  if (path === 'produtos') return getProdutos(params);

  // ── Biblioteca de Fichas ──────────────────────────────────
  if (path === 'biblioteca-fichas' && method === 'GET') return getBibliotecaFichas(params);
  if (_matchId(path, 'biblioteca-fichas')) {
    params.id = _extractId(path, 'biblioteca-fichas');
    return getBibliotecaFichaById(params);
  }

  // ── Pesquisa / Relatório ──────────────────────────────────
  if (path === 'pesquisa/relatorio') return getPesquisaRelatorio(params);

  // ── Planilha ──────────────────────────────────────────────
  if (path === 'planilha/abas')                return getPlanilhaAbas(params);
  if (_matchSub(path, 'planilha', 'cabecalhos')) {
    params.aba = _extractId(path, 'planilha');
    return getPlanilhaCabecalhos(params);
  }
  if (_matchSub(path, 'planilha', 'dados')) {
    params.aba = _extractId(path, 'planilha');
    if (method === 'GET')  return getPlanilhaAba(params);
    if (method === 'POST') return importarPlanilhaAba(params);
  }

  // ── Alimentação / Status ──────────────────────────────────
  if (path === 'alimentacao/status') return getAlimentacaoStatus(params);

  // ── Reclamações ───────────────────────────────────────────
  if (path === 'reclamacoes') return getReclamacoes(params);

  // ── Histórico ─────────────────────────────────────────────
  if (path === 'historico') return getHistorico(params);

  // ── FAQ / Regras / Procedimentos por setor ────────────────
  var setorRoutes = ['faq', 'regras', 'procedimentos', 'politicas'];
  for (var i = 0; i < setorRoutes.length; i++) {
    var sr = setorRoutes[i];
    if (path === sr || path.indexOf(sr + '/') === 0) {
      if (sr === 'faq')          return getFAQ(params);
      if (sr === 'regras')       return getRegras(params);
      if (sr === 'procedimentos') return getProcedimentos(params);
      if (sr === 'politicas')    return getPoliticas(params);
    }
  }

  // ── Permissões ────────────────────────────────────────────
  if (path === 'permissoes') return getPermissoes(params);

  // ── Upload de arquivos ────────────────────────────────────
  if (path === 'upload' && method === 'POST') return handleUpload(params);

  return { sucesso: false, erro: 'Rota não encontrada: ' + path, status: 404 };
}

// ── Helpers de rota ──────────────────────────────────────────
function _matchId(path, base) {
  var parts = path.split('/');
  return parts.length === 2 && parts[0] === base && parts[1];
}
function _extractId(path, base) {
  return path.split('/')[1] || '';
}
function _matchSub(path, base, sub) {
  var parts = path.split('/');
  return parts.length === 3 && parts[0] === base && parts[2] === sub;
}

// ── Upload handler ───────────────────────────────────────────
function handleUpload(params) {
  var body = params.body || {};
  var nome = body.nome || 'arquivo';
  var mimeType = body.mimeType || 'application/octet-stream';
  var base64 = body.base64 || '';
  if (!base64) return { sucesso: false, erro: 'Arquivo não enviado.' };
  try {
    var result = uploadArquivoDrive(nome, mimeType, base64);
    return { sucesso: true, arquivo: result };
  } catch(e) {
    return { sucesso: false, erro: erroSeguro(e) };
  }
}

// ── Planilha abas ────────────────────────────────────────────
function getPlanilhaAbas(params) {
  try {
    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var abas = ss.getSheets().map(function(s) { return s.getName(); });
    return { sucesso: true, abas: abas };
  } catch(e) {
    return { sucesso: false, erro: erroSeguro(e) };
  }
}
