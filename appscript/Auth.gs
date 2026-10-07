// ============================================================
// Auth.gs — Autenticação e gerenciamento de sessão
// Usa CacheService (script cache) para armazenar sessões
// ============================================================

var _loginAttempts = {};

function verificarRateLimit(ip) {
  var agora = Date.now();
  var janela = 15 * 60 * 1000;
  var MAX = 10;
  if (!_loginAttempts[ip]) _loginAttempts[ip] = [];
  _loginAttempts[ip] = _loginAttempts[ip].filter(function(t) { return agora - t < janela; });
  if (_loginAttempts[ip].length >= MAX) return false;
  _loginAttempts[ip].push(agora);
  return true;
}

function gerarToken() {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  var token = '';
  for (var i = 0; i < 64; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return token;
}

function criarSessao(payload) {
  var token = gerarToken();
  var cache = CacheService.getScriptCache();
  var data = JSON.stringify(Object.assign({}, payload, { _criado: Date.now() }));
  cache.put('sess_' + token, data, SESSION_TTL_S);
  return token;
}

function verificarSessao(token) {
  if (!token) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('sess_' + token);
  if (!raw) return null;
  try {
    var payload = JSON.parse(raw);
    if (!payload) return null;
    // Renovar TTL a cada uso
    cache.put('sess_' + token, raw, SESSION_TTL_S);
    return payload;
  } catch(e) { return null; }
}

function destruirSessao(token) {
  if (!token) return;
  CacheService.getScriptCache().remove('sess_' + token);
}

// Usuários demo (apenas quando DEMO_LOGIN_ENABLED=true)
var DEMO_USUARIOS = [
  {ID_USUARIO:'USR-DEMO-001',USUARIO:'demo.master',EMAIL:'',NOME:'Demo Master',PERFIL:'MASTER',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:b5d54c39e66671c9731b9f471e585d8262cd4f54daa9d7d033747a98ea9a9ef0',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-002',USUARIO:'joao.aprovador',EMAIL:'',NOME:'João Silva',PERFIL:'APROVADOR',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:6dac17e7e0b3cb2daab875c67f0d7aca8cc55c76bbda66a98bf0998adce94c24',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-003',USUARIO:'ana.sac',EMAIL:'',NOME:'Ana Lima',PERFIL:'ANALISTA SAC',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:9da73d36e056bc7f73238b4d8ee869a0991788cf56e909d585a6071e45d45f0a',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-004',USUARIO:'carlos.rca',EMAIL:'',NOME:'Carlos Silva',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'Chiacchio',SETOR:'Comercial',STATUS:'ATIVO',SENHA:'sha256:63b64c1e65ce5ca36cb6a6f2378519135ae7165cc9720ece1fa2783b71853ece',CODIGO_RCA:'RCA-023'},
  {ID_USUARIO:'USR-DEMO-005',USUARIO:'maria.qualidade',EMAIL:'',NOME:'Maria Santos',PERFIL:'SETOR RESPONSÁVEL',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:9e5c100eb752ffcd3836498f695fb63ba122a41223f770d7921713d7ed7700e4',CODIGO_RCA:''}
];

function sha256Hex(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function senhaValida(informada, armazenada) {
  if (armazenada === undefined || armazenada === null) return false;
  var s = String(armazenada);
  if (s.indexOf('sha256:') === 0) {
    return ('sha256:' + sha256Hex(String(informada || ''))) === s;
  }
  return false;
}

function carregarUsuarios() {
  var rows = [];
  try { rows = lerAba('USUARIOS', 1000); } catch(e) {}
  if (DEMO_LOGIN_ENABLED) rows = rows.concat(DEMO_USUARIOS);
  return rows;
}

function carregarUsuarioPorLogin(login) {
  var alvo = normalizarTexto(login);
  if (DEMO_LOGIN_ENABLED) {
    var demo = DEMO_USUARIOS.find(function(u) { return normalizarTexto(u.USUARIO) === alvo; });
    if (demo) return demo;
  }
  var usuarios = carregarUsuarios();
  return usuarios.find(function(u) {
    return normalizarTexto(u.USUARIO || u.EMAIL || u.ID_USUARIO) === alvo &&
           normalizarTexto(u.STATUS || 'ATIVO') !== 'inativo';
  }) || null;
}

function usuarioPublico(u) {
  return {
    id: u.ID_USUARIO || u.ID || u.USUARIO || u.EMAIL,
    usuario: u.USUARIO || u.EMAIL || u.ID_USUARIO,
    nome: u.NOME || u.NOME_COMPLETO || u.USUARIO || u.EMAIL,
    email: u.EMAIL || '',
    perfil: perfilCanonico(u.PERFIL || u.PERFIL_USUARIO),
    empresa: u.EMPRESA || '',
    setor: u.SETOR || '',
    codigoRCA: u.CODIGO_RCA || u.RCA || '',
    status: u.STATUS || 'ATIVO',
    ultimoAcesso: u.ULTIMO_ACESSO || '',
    dataCriacao: u.DATA_CRIACAO || '',
  };
}

function registrarAcessoUsuario(usuario) {
  try {
    atualizarPorID('USUARIOS', usuario.ID_USUARIO || usuario.USUARIO || usuario.EMAIL,
      { ULTIMO_ACESSO: new Date().toISOString() }, ['ID_USUARIO','USUARIO','EMAIL']);
  } catch(e) {}
}

// ===== Handlers de Auth (chamados pelo router) =====

function handleLogin(body) {
  var usuario = (body.usuario || '').trim();
  var senha = body.senha || '';
  if (!usuario) return { sucesso: false, erro: 'Usuário é obrigatório.' };
  if (!senha) return { sucesso: false, erro: 'Senha é obrigatória.' };

  var registro = carregarUsuarioPorLogin(usuario);
  if (!registro) return { sucesso: false, erro: 'Usuário ou senha inválidos.' };
  var pub = usuarioPublico(registro);
  if (normalizarTexto(pub.status) === 'inativo') return { sucesso: false, erro: 'Usuário inativo.' };
  var senhaOk = senhaValida(senha, registro.SENHA_HASH || registro.SENHA);
  if (!senhaOk) return { sucesso: false, erro: 'Usuário ou senha inválidos.' };

  var payload = {
    sub: pub.id, usuario: pub.usuario, nome: pub.nome, email: pub.email,
    perfil: pub.perfil, empresa: pub.empresa, setor: pub.setor,
    codigoRCA: pub.codigoRCA, iat: Date.now(),
  };
  var token = criarSessao(payload);

  var isDemo = String(registro.ID_USUARIO || '').indexOf('USR-DEMO-') === 0;
  if (!isDemo) {
    try { registrarAcessoUsuario(registro); } catch(e) {}
    try { registrarAuditoria(pub.usuario, 'LOGIN', null, 'AUTH', null, { perfil: pub.perfil }); } catch(e) {}
  }

  return { sucesso: true, token: token, usuario: pub.usuario, usuarioInfo: pub, modo: isDemo ? 'DEMO' : 'PRODUCAO' };
}

function handleLogout(token) {
  destruirSessao(token);
  return { sucesso: true };
}

function handleAuthMe(token) {
  var payload = verificarSessao(token);
  if (!payload) return { sucesso: false, erro: 'Sessão inválida.' };
  return { sucesso: true, usuario: payload };
}

function handleForgotPassword(body) {
  var login = ((body.usuario || body.email) || '').trim().toLowerCase();
  if (!login) return { sucesso: false, erro: 'Informe usuário ou e-mail.' };

  var MSG_OK = 'Se o usuário existir, um link de redefinição será enviado para o e-mail cadastrado.';
  var usuarios = [];
  try { usuarios = lerAba('USUARIOS', 500); } catch(e) {}
  var usuario = usuarios.find(function(u) {
    return (u.USUARIO || u.EMAIL || '').trim().toLowerCase() === login ||
           (u.EMAIL || '').trim().toLowerCase() === login;
  });

  if (!usuario || !usuario.EMAIL) return { sucesso: true, mensagem: MSG_OK };
  if (!RESEND_API_KEY) {
    return { sucesso: true, mensagem: 'Solicitação registrada. O administrador deverá redefinir a senha.' };
  }

  var tokenReset = gerarToken() + gerarToken().slice(0, 0); // 64 chars
  var expMs = Date.now() + 60 * 60 * 1000;

  try {
    garantirAbaComCabecalhos('RESET_TOKENS', ['TOKEN','USUARIO','EMAIL','EXP','USADO']);
    appendObjeto('RESET_TOKENS', {
      TOKEN: tokenReset, USUARIO: usuario.USUARIO || usuario.EMAIL,
      EMAIL: usuario.EMAIL, EXP: new Date(expMs).toISOString(), USADO: 'NAO',
    });
  } catch(e) {
    return { sucesso: false, erro: 'Erro interno ao gerar token.' };
  }

  var link = APP_URL + '?page=reset-password&token=' + tokenReset;
  try {
    enviarEmail(usuario.EMAIL,
      'Redefinição de senha — SAC Grupo Chiacchio',
      '<p>Olá, <strong>' + (usuario.NOME || usuario.USUARIO) + '</strong>.</p>' +
      '<p>Clique no link para redefinir sua senha:</p>' +
      '<p><a href="' + link + '" style="background:#c70602;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none">Redefinir minha senha</a></p>' +
      '<p>Link válido por <strong>1 hora</strong>.</p>'
    );
  } catch(e) {
    return { sucesso: false, erro: 'Erro ao enviar e-mail.' };
  }

  return { sucesso: true, mensagem: MSG_OK };
}

function handleResetPassword(body) {
  var token = body.token || '';
  var novaSenha = body.novaSenha || '';
  if (!token || !novaSenha) return { sucesso: false, erro: 'Token e nova senha são obrigatórios.' };
  if (novaSenha.length < 6) return { sucesso: false, erro: 'Senha deve ter ao menos 6 caracteres.' };

  var tokens = [];
  try { tokens = lerAba('RESET_TOKENS', 1000); } catch(e) {}
  var registro = tokens.find(function(t) { return t.TOKEN === token && t.USADO === 'NAO'; });
  if (!registro) return { sucesso: false, erro: 'Token inválido ou já utilizado.' };
  if (Date.now() > new Date(registro.EXP).getTime()) return { sucesso: false, erro: 'Token expirado.' };

  var hash = 'sha256:' + sha256Hex(novaSenha);
  try {
    atualizarPorID('USUARIOS', registro.USUARIO, { SENHA: hash, SENHA_HASH: hash }, ['USUARIO','EMAIL']);
    atualizarPorID('RESET_TOKENS', token, { USADO: 'SIM' }, ['TOKEN']);
  } catch(e) {
    return { sucesso: false, erro: 'Erro ao atualizar senha.' };
  }

  return { sucesso: true, mensagem: 'Senha redefinida com sucesso.' };
}
