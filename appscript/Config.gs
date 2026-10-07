// ============================================================
// CONFIG.gs — Configurações globais e constantes
// ============================================================
'use strict';

var PROP = PropertiesService.getScriptProperties();

function getConfig(key, def) {
  return PROP.getProperty(key) || def || '';
}

// IDs das planilhas (configure nas Propriedades do Script)
var SPREADSHEET_ID        = getConfig('SPREADSHEET_ID');
var PESQUISA_SPREADSHEET_ID = getConfig('PESQUISA_SPREADSHEET_ID') || SPREADSHEET_ID;
var DRIVE_FOLDER_ID       = getConfig('DRIVE_FOLDER_ID');
var APP_URL               = getConfig('APP_URL', ScriptApp.getService().getUrl());
var SESSION_SECRET        = getConfig('SESSION_SECRET', 'chave-padrao-mude-em-producao');
var SESSION_TTL_S         = 8 * 60 * 60; // 8 horas em segundos
var AI_PROVIDER           = getConfig('AI_PROVIDER', 'openai');
var OPENAI_API_KEY        = getConfig('OPENAI_API_KEY');
var ANTHROPIC_API_KEY     = getConfig('ANTHROPIC_API_KEY');
var AI_MODEL              = getConfig('AI_MODEL', 'gpt-4o-mini');
var RESEND_API_KEY        = getConfig('RESEND_API_KEY');
var EMAIL_FROM            = getConfig('EMAIL_FROM', 'SAC Grupo Chiacchio <noreply@grupochiacchio.com.br>');
var DEMO_LOGIN_ENABLED    = getConfig('DEMO_LOGIN_ENABLED', 'false') === 'true';

// Mapa canônico de empresas
var EMPRESA_MAP = {
  'CHIACCHIO': ['chiacchio embalagens','chiachio embalagens','chiacchio'],
  'PLASCHIO':  ['plaschio'],
  'TUBAHIA':   ['tubahia','cesbap'],
  'MASTER':    ['grupo chiacchio','todas','master'],
};

var COLUNA_EMPRESA_ABA = {
  'MANIFESTACOES':              'EMPRESA_RECLAMADA',
  'Reclamações':                'Empresa',
  'Reclamações + devolutiva':   'Empresa',
  'BANCO_HISTORICO':            'DRV_EMPRESA_NORMALIZADA',
  'BANCO_RNC':                  'EMPRESA_RECLAMADA',
  'DEVOLUTIVAS':                'EMPRESA',
  'FILA_APROVACAO':             'EMPRESA',
  'CEREBRO_APRENDIZADO':        'EMPRESA',
  'PADROES_VALIDADOS':          'EMPRESA',
};

var ABAS_CONFIGURACAO = [
  'CONFIG_SETORES','REGRAS_SETORES','PROCEDIMENTOS','POLITICAS','CAUSAS',
  'MATRIZ_CONHECIMENTO','MATRIZ_RISCOS','FAQ_SETORES',
  'TIPOS_RECLAMACAO','REGRAS_ROTEAMENTO','SLA_ESCALONAMENTO','PERGUNTAS_ANALISE',
];

function normalizarTexto(v) {
  return String(v || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().trim();
}

function empresaCanonica(texto) {
  var norm = normalizarTexto(texto || '');
  if (!norm) return null;
  for (var cod in EMPRESA_MAP) {
    if (EMPRESA_MAP[cod].some(function(g) { return norm === g; })) return cod;
  }
  return null;
}

function pertenceEmpresa(userEmpresa, registroEmpresa) {
  if (!userEmpresa || String(userEmpresa).trim() === '') return false;
  var userCod = empresaCanonica(userEmpresa);
  if (!userCod || userCod === 'MASTER') return true;
  var recCod = empresaCanonica(registroEmpresa || '');
  if (!recCod) return false;
  return userCod === recCod;
}

function perfilCanonico(v) {
  var x = normalizarTexto(v).replace(/\s+/g, ' ');
  var map = {
    'master':'MASTER','administrador':'MASTER','admin':'MASTER',
    'analista sac':'ANALISTA SAC','analista':'ANALISTA SAC','sac':'ANALISTA SAC',
    'gestor sac':'ANALISTA SAC','gestor de sac':'ANALISTA SAC',
    'setor responsavel':'SETOR RESPONSÁVEL','setor responsável':'SETOR RESPONSÁVEL',
    'aprovador':'APROVADOR',
    'rca':'RCA / REPRESENTANTE','representante':'RCA / REPRESENTANTE',
    'representante comercial':'RCA / REPRESENTANTE',
  };
  return map[x] || String(v || '').toUpperCase();
}

function erroSeguro(e) {
  if (typeof e === 'string') return e;
  return e && e.message ? String(e.message).slice(0, 200) : 'Erro interno.';
}

function isTeste(item) {
  var campos = ['ID_MANIFESTACAO','ID_RNC','TITULO','NAO_CONFORMIDADE','Motivo da Reclamação','Descrição do Problema'];
  return campos.some(function(c) {
    return String(item[c] || '').toUpperCase().indexOf('TESTE-GOLIVE') === 0;
  });
}
