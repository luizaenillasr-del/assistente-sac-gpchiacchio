const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { Resend } = require('resend');
const _resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'SAC Grupo Chiacchio <noreply@grupochiacchio.com.br>';
const APP_URL = (process.env.APP_URL || 'https://assistente-sac-gpchiacchio.vercel.app').replace(/\/$/, '');
const cerebroService = require('./services/cerebroServices');
const mcService = require('./services/matrizConhecimentoService');
const documentService = require('./services/documentService');
const aiService = require('./services/aiService');
const { tratativaEngine, devolutivaEngine, assertividade: assertividadeService } = cerebroService;
const permissoesService = require('./services/permissoesService');

// Injeção de mock Sheets para testes — nunca ativo em produção (env var não existe em prod)
const _sheetsMock = process.env.SHEETS_MOCK_PATH ? (() => { try { return require(process.env.SHEETS_MOCK_PATH); } catch(e) { console.warn('[MOCK] falhou ao carregar:', e.message); return null; } })() : null;

// F8: leituras de pesquisa/relatório — Postgres primeiro, Sheets como fallback
async function lerRespostasPesquisa() {
  let pgData = [];
  if (pesquisaRepo) {
    try { pgData = await pesquisaRepo.listarRespostas({}); } catch (e) { console.warn('[F8] respostas PG falhou:', e.message); }
  }
  const sheetsData = await lerAba('PESQUISA_RESPOSTAS', 5000).catch(() => []);
  if (!pgData.length) return sheetsData;
  const pgIds = new Set(pgData.map(r => r.ID_RESPOSTA).filter(Boolean));
  const sheetsOnly = sheetsData.filter(r => r.ID_RESPOSTA && !pgIds.has(r.ID_RESPOSTA));
  return [...pgData, ...sheetsOnly];
}
async function lerHistoricoPesquisa() {
  return lerAba('PESQUISA_HISTORICO', 500).catch(() => []);
}
async function lerRelatoriosSac() {
  if (pesquisaRepo) {
    try { const r = await pesquisaRepo.listarRelatorios({}); if (r && r.length) return r; } catch (e) { console.warn('[F8] relatorios PG falhou:', e.message); }
  }
  return lerAba('RELATORIOS_SAC', 500).catch(() => []);
}

// Escopo B2: resolve o nome/código de empresa do usuário → id numérico do Postgres.
// Retorna -1 se não encontrar (findAll filtra por -1 → 0 linhas → cai no fallback Sheets, que aplica o próprio filtro de empresa).
async function resolverEmpresaIdScope(valor) {
  if (!empresaRepo || !valor) return undefined;
  try {
    const byCod = await empresaRepo.findByCodigo(String(valor)).catch(() => null);
    if (byCod) return byCod.id;
    const todas = await empresaRepo.findAll().catch(() => []);
    const vl = String(valor).toLowerCase().trim();
    const e = todas.find(x => x.codigo.toLowerCase() === vl || x.nome.toLowerCase().includes(vl) || vl.includes(x.codigo.toLowerCase()));
    return e ? e.id : -1;
  } catch { return -1; }
}

const app = express();
const ALLOWED_ORIGINS = [
  'https://assistente-sac-gpchiacchio.vercel.app',
  'https://assistente-sac-gpchiacchio-grudfk40c-luiza4.vercel.app',
];
const _ORIGIN_RE = /^https:\/\/assistente-sac-gpchiacchio[a-z0-9-]*\.vercel\.app$/;
const corsOptions = { origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin) || _ORIGIN_RE.test(origin)) cb(null, true);
  else cb(null, false);
}, credentials: true };
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '25mb' }));

// ===== SECURITY HEADERS =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});

function getAuth() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS não configurada.');
  const creds = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

// PDF service
let gerarFichaPDF;
try { ({ gerarFichaPDF } = require('./services/pdfFicha')); } catch(e) { console.warn('[PDF] pdfFicha não disponível:', e.message); }

// Google Drive upload (usa mesma service account com scope drive.file)
async function uploadArquivoDrive(nome, mimeType, bufferOuBase64) {
  const buf = Buffer.isBuffer(bufferOuBase64) ? bufferOuBase64 : Buffer.from(bufferOuBase64, 'base64');
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const stream = Readable.from(buf);
  const folderId = process.env.DRIVE_FOLDER_ID || null;
  const meta = { name: nome, mimeType };
  if (folderId) meta.parents = [folderId];
  const res = await drive.files.create({
    requestBody: meta,
    media: { mimeType, body: stream },
    fields: 'id,name,webViewLink,webContentLink',
  });
  const fileId = res.data.id;
  // Torna o arquivo acessível para qualquer pessoa com o link
  try {
    await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
  } catch (permErr) {
    console.warn('[DRIVE] Não foi possível tornar o arquivo público:', permErr.message);
  }
  return res.data; // { id, name, webViewLink, webContentLink }
}
// C5: alertas de variáveis obrigatórias em produção
// C1: verificar AI_PROVIDER para garantir uso de OpenAI conforme mandato
if (!process.env.AI_PROVIDER) {
  console.warn('[AVISO C1] AI_PROVIDER não definida — usando padrão openai. Defina AI_PROVIDER=openai em produção para clareza.');
} else if (process.env.AI_PROVIDER.toLowerCase() !== 'openai') {
  console.warn(`[AVISO C1] AI_PROVIDER=${process.env.AI_PROVIDER} — sistema configurado para usar exclusivamente OpenAI.`);
}
if (!process.env.SPREADSHEET_ID) {
  console.error('[FATAL C5] SPREADSHEET_ID não configurada. Defina SPREADSHEET_ID nas variáveis de ambiente antes de ir para produção.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
if (!process.env.PESQUISA_SPREADSHEET_ID) {
  console.warn('[AVISO C5] PESQUISA_SPREADSHEET_ID não configurada — módulo de pesquisas usará planilha de fallback hardcoded. Configure em produção.');
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET não definida ou com menos de 32 caracteres. Defina SESSION_SECRET nas variáveis de ambiente.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
// B5: Aviso explícito sobre usuários demo em produção
if (String(process.env.DEMO_LOGIN_ENABLED || 'false').toLowerCase() === 'true' && process.env.NODE_ENV === 'production') {
  console.error('[SEGURANÇA B5] DEMO_LOGIN_ENABLED=true em NODE_ENV=production. Usuários demo ATIVOS em produção. Defina DEMO_LOGIN_ENABLED=false imediatamente.');
}
if (String(process.env.DEMO_LOGIN_ENABLED || 'false').toLowerCase() !== 'true') {
  console.info('[SEGURANÇA] Usuários demo desabilitados (DEMO_LOGIN_ENABLED != true). Correto para produção.');
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function normalizarTexto(v){
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
}

// \u2500\u2500\u2500 Mapa can\u00f4nico de empresas do Grupo Chiacchio \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// C\u00f3digo can\u00f4nico \u2192 lista de grafias aceitas (normalizadas)
const EMPRESA_MAP = {
  CHIACCHIO: ['chiacchio embalagens', 'chiachio embalagens', 'chiacchio'],
  PLASCHIO:  ['plaschio'],
  TUBAHIA:   ['tubahia', 'cesbap'],
  LOGCHIO:   ['logchio'],
  SOLARCHIO: ['solarchio'],
  PREMOCHIO: ['premochio'],
  MASTER:    ['grupo chiacchio', 'todas', 'master', 'todas as empresas'], // empresa do usu\u00e1rio MASTER = acesso global
};

// Coluna de empresa correta por aba
const COLUNA_EMPRESA_ABA = {
  MANIFESTACOES:              'EMPRESA_RECLAMADA',
  'Reclama\u00e7\u00f5es':              'Empresa',
  'Reclama\u00e7\u00f5es + devolutiva': 'Empresa',
  BANCO_HISTORICO:            'DRV_EMPRESA_NORMALIZADA',
  BANCO_RNC:                  'EMPRESA_RECLAMADA',
  DEVOLUTIVAS:                'EMPRESA',
  FILA_APROVACAO:             'EMPRESA',
  CEREBRO_APRENDIZADO:        'EMPRESA',
  PADROES_VALIDADOS:          'EMPRESA',
};

// Abas de configura\u00e7\u00e3o: sem empresa = global (vis\u00edvel para todos)
const ABAS_CONFIGURACAO = new Set([
  'CONFIG_SETORES','REGRAS_SETORES','PROCEDIMENTOS','POLITICAS','CAUSAS',
  'MATRIZ_CONHECIMENTO','MATRIZ_RISCOS','FAQ_SETORES',
  'TIPOS_RECLAMACAO','REGRAS_ROTEAMENTO','SLA_ESCALONAMENTO','PERGUNTAS_ANALISE',
]);

// Retorna o c\u00f3digo can\u00f4nico (CHIACCHIO | PLASCHIO | TUBAHIA | MASTER) ou null
function empresaCanonica(texto) {
  const norm = normalizarTexto(texto || '');
  if (!norm) return null;
  for (const [cod, grafias] of Object.entries(EMPRESA_MAP)) {
    if (grafias.some(g => norm === g)) return cod;
  }
  return null;
}
function b64url(v){ return Buffer.from(v).toString('base64url'); }
function assinarToken(payload){
  const body=b64url(JSON.stringify(payload));
  const sig=crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body+'.'+sig;
}
function verificarToken(token){
  try{
    const [body,sig]=String(token||'').split('.');
    if(!body||!sig) return null;
    const expected=crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    if(!crypto.timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) return null;
    const payload=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));
    if(!payload.exp || Date.now()>payload.exp) return null;
    return payload;
  }catch(e){ return null; }
}
async function senhaValida(informada, armazenada){
  if(armazenada === undefined || armazenada === null) return false;
  const s=String(armazenada);
  // bcrypt (preferencial — com salt) — formato: $2a$ ou $2b$
  if(s.startsWith('$2a$') || s.startsWith('$2b$')) return bcrypt.compare(String(informada||''), s);
  // sha256 legado sem salt — aceita no login e migra automaticamente para bcrypt
  if(s.startsWith('sha256:')) return 'sha256:'+crypto.createHash('sha256').update(String(informada||'')).digest('hex')===s;
  // Senha sem hash no storage = configuração inválida.
  console.warn('[SEGURANÇA] Tentativa de login com senha sem hash no storage. Configure bcrypt no campo SENHA.');
  return false;
}

// Gera hash bcrypt (cost 12) para uma senha em texto puro
async function hashSenha(senha) {
  return bcrypt.hash(String(senha), 12);
}

const DEMO_USUARIOS = [
  {ID_USUARIO:'USR-DEMO-001',USUARIO:'demo.master',EMAIL:'',NOME:'Demo Master',PERFIL:'MASTER',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:b5d54c39e66671c9731b9f471e585d8262cd4f54daa9d7d033747a98ea9a9ef0',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-002',USUARIO:'joao.aprovador',EMAIL:'',NOME:'João Silva',PERFIL:'APROVADOR',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:6dac17e7e0b3cb2daab875c67f0d7aca8cc55c76bbda66a98bf0998adce94c24',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-003',USUARIO:'ana.sac',EMAIL:'',NOME:'Ana Lima',PERFIL:'ANALISTA SAC',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:9da73d36e056bc7f73238b4d8ee869a0991788cf56e909d585a6071e45d45f0a',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-004',USUARIO:'carlos.rca',EMAIL:'',NOME:'Carlos Silva',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'Chiacchio',SETOR:'Comercial',STATUS:'ATIVO',SENHA:'sha256:63b64c1e65ce5ca36cb6a6f2378519135ae7165cc9720ece1fa2783b71853ece',CODIGO_RCA:'RCA-023'},
  {ID_USUARIO:'USR-DEMO-005',USUARIO:'maria.qualidade',EMAIL:'',NOME:'Maria Santos',PERFIL:'SETOR RESPONSÁVEL',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:9e5c100eb752ffcd3836498f695fb63ba122a41223f770d7921713d7ed7700e4',CODIGO_RCA:''}
];

async function carregarUsuarios(){
  let rows=[];
  try{ rows=await lerAba('USUARIOS',1000); }catch(e){ console.warn('USUARIOS não disponível:',e.message); }
  const raw=process.env.USUARIOS_JSON||'{}';
  let envUsers=[];
  try{
    const parsed=JSON.parse(raw);
    envUsers=Object.entries(parsed).map(([usuario,val])=>typeof val==='string'
      ? {ID_USUARIO:usuario,USUARIO:usuario,SENHA:val,NOME:usuario,PERFIL:'ANALISTA SAC',STATUS:'ATIVO'}
      : {ID_USUARIO:usuario,USUARIO:usuario,...val});
  }catch(e){}
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'false').toLowerCase()==='true';
  return [...rows,...envUsers,...(demoEnabled?DEMO_USUARIOS:[])];
}

function perfilCanonico(v){
  const x=normalizarTexto(v).replace(/\s+/g,' ');
  const map={
    // ADMINISTRADOR
    'master':'MASTER','administrador':'MASTER','admin':'MASTER',
    // GESTOR SAC — perfil próprio (não mais alias de ANALISTA SAC)
    'gestor sac':'GESTOR SAC','gestor de sac':'GESTOR SAC','gestor':'GESTOR SAC',
    // ANALISTA SAC
    'analista sac':'ANALISTA SAC','analista':'ANALISTA SAC','sac':'ANALISTA SAC',
    // ATENDENTE SAC
    'atendente sac':'ATENDENTE SAC','atendente':'ATENDENTE SAC',
    // SETOR RESPONSÁVEL
    'setor responsavel':'SETOR RESPONSÁVEL','setor responsável':'SETOR RESPONSÁVEL',
    'gestor de setor':'SETOR RESPONSÁVEL','gestor setor':'SETOR RESPONSÁVEL',
    'usuario de setor':'SETOR RESPONSÁVEL','usuário de setor':'SETOR RESPONSÁVEL',
    // ESPECIALISTA
    'especialista':'ESPECIALISTA','responsavel especialista':'ESPECIALISTA','responsável especialista':'ESPECIALISTA',
    // APROVADOR
    'aprovador':'APROVADOR',
    // APROVADOR MASTER
    'aprovador master':'APROVADOR MASTER','aprovadormaster':'APROVADOR MASTER',
    // RCA
    'rca':'RCA / REPRESENTANTE','representante':'RCA / REPRESENTANTE','representante comercial':'RCA / REPRESENTANTE',
    'responsavel rca':'RCA / REPRESENTANTE','responsável rca':'RCA / REPRESENTANTE',
    // DIRETOR
    'diretor':'DIRETOR','diretora':'DIRETOR','director':'DIRETOR',
    // VISUALIZADOR / AUDITOR
    'visualizador':'VISUALIZADOR','consulta':'VISUALIZADOR','auditor':'AUDITOR',
    // PERFIS SETORIAIS
    'setor sac':'SETOR SAC',
    'setor comercial':'SETOR COMERCIAL','comercial':'SETOR COMERCIAL',
    'setor logistica':'SETOR LOGISTICA','setor logística':'SETOR LOGISTICA','logistica':'SETOR LOGISTICA','logística':'SETOR LOGISTICA',
    'setor producao':'SETOR PRODUCAO','setor produção':'SETOR PRODUCAO','producao':'SETOR PRODUCAO','produção':'SETOR PRODUCAO',
    'setor qualidade':'SETOR QUALIDADE','qualidade':'SETOR QUALIDADE',
    'setor financeiro':'SETOR FINANCEIRO','financeiro':'SETOR FINANCEIRO',
    'setor ti':'SETOR TI','ti':'SETOR TI','tecnologia':'SETOR TI',
    'setor marketing':'SETOR MARKETING','marketing':'SETOR MARKETING',
    'setor diretoria':'SETOR DIRETORIA','diretoria':'SETOR DIRETORIA',
  };
  return map[x]||String(v||'').toUpperCase();
}

// Helpers de perfil — evita repetição de listas longas nos requerPerfil
const P_ADMIN=['MASTER'];
const P_GESTORES=['MASTER','GESTOR SAC'];
const P_SAC=['MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC'];
const P_OPERACIONAL=['MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA'];
const P_LEITURA=['MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR','RCA / REPRESENTANTE','DIRETOR','VISUALIZADOR','AUDITOR'];
const P_RNC=['MASTER','GESTOR SAC','ANALISTA SAC','SETOR RESPONSÁVEL','ESPECIALISTA','RCA / REPRESENTANTE'];
const P_APROVACAO=['MASTER','APROVADOR MASTER','APROVADOR'];
const P_RELATORIO=['MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR','RCA / REPRESENTANTE','DIRETOR','VISUALIZADOR','AUDITOR'];

function usuarioPublico(u){
  let permissoes_custom=null;
  if(u.PERMISSOES_CUSTOM){try{permissoes_custom=typeof u.PERMISSOES_CUSTOM==='string'?JSON.parse(u.PERMISSOES_CUSTOM):u.PERMISSOES_CUSTOM;}catch(e){}}
  let permissoes_granted=null;
  if(u.PERMISSOES_GRANTED){try{permissoes_granted=typeof u.PERMISSOES_GRANTED==='string'?JSON.parse(u.PERMISSOES_GRANTED):u.PERMISSOES_GRANTED;}catch(e){}}
  let permissoes_blocked=null;
  if(u.PERMISSOES_BLOCKED){try{permissoes_blocked=typeof u.PERMISSOES_BLOCKED==='string'?JSON.parse(u.PERMISSOES_BLOCKED):u.PERMISSOES_BLOCKED;}catch(e){}}
  // migrate: if granted not set, fall back to custom
  if(!Array.isArray(permissoes_granted)&&Array.isArray(permissoes_custom)&&permissoes_custom.length) permissoes_granted=permissoes_custom;
  return {
    id:u.ID_USUARIO||u.ID||u.USUARIO||u.EMAIL,
    usuario:u.USUARIO||u.EMAIL||u.ID_USUARIO,
    nome:u.NOME||u.NOME_COMPLETO||u.USUARIO||u.EMAIL,
    email:u.EMAIL||'',
    perfil:perfilCanonico(u.PERFIL||u.PERFIL_USUARIO),
    empresa:u.EMPRESA||'', setor:u.SETOR||'', cargo:u.CARGO||'', telefone:u.TELEFONE||'',
    codigoRCA:u.CODIGO_RCA||u.RCA||'', status:u.STATUS||'ATIVO',
    ultimoAcesso:u.ULTIMO_ACESSO||'', dataCriacao:u.DATA_CRIACAO||'',
    permissoes_custom: Array.isArray(permissoes_custom)&&permissoes_custom.length?permissoes_custom:null,
    permissoes_granted: Array.isArray(permissoes_granted)&&permissoes_granted.length?permissoes_granted:null,
    permissoes_blocked: Array.isArray(permissoes_blocked)&&permissoes_blocked.length?permissoes_blocked:null,
  };
}

function requerPerfil(...perfis){
  return (req,res,next)=>{
    const permitido=perfis.map(perfilCanonico).includes(perfilCanonico(req.user?.perfil));
    if(!permitido) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para este perfil.'});
    next();
  };
}

// Permissões padrão por perfil (espelha frontend _PERM_PADRAO)
const _PERM_PADRAO_API = {
  'MASTER':             ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','manifestacoes.gerenciar','manifestacoes.aprovar','manifestacoes.excluir','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','cerebro.adicionar_regras','cerebro.adicionar_politicas','cerebro.editar_faq','cerebro.gerenciar','rca.visualizar','rca.criar','rca.editar','rca.gerenciar','pesquisas.visualizar','pesquisas.criar','pesquisas.editar','pesquisas.gerenciar','dashboard.visualizar','dashboard.gerenciar','configuracoes.visualizar','configuracoes.editar','configuracoes.gerenciar','usuarios.visualizar','usuarios.criar','usuarios.editar','usuarios.gerenciar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar'],
  'ADMINISTRADOR':      ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','manifestacoes.gerenciar','cerebro.visualizar','cerebro.gerenciar','rca.visualizar','rca.gerenciar','pesquisas.visualizar','pesquisas.gerenciar','dashboard.visualizar','dashboard.gerenciar','configuracoes.visualizar','configuracoes.editar','configuracoes.gerenciar','usuarios.visualizar','usuarios.criar','usuarios.editar','usuarios.gerenciar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar'],
  'GESTOR SAC':         ['manifestacoes.visualizar','manifestacoes.editar','manifestacoes.gerenciar','manifestacoes.aprovar','cerebro.visualizar','cerebro.gerenciar','rca.visualizar','pesquisas.visualizar','pesquisas.gerenciar','dashboard.visualizar','dashboard.gerenciar','configuracoes.visualizar','configuracoes.editar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar'],
  'ANALISTA SAC':       ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','cerebro.adicionar_regras','cerebro.adicionar_politicas','cerebro.editar_faq','pesquisas.visualizar','pesquisas.criar','dashboard.visualizar','aprovacoes.visualizar'],
  'APROVADOR':          ['manifestacoes.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','pesquisas.visualizar'],
  'APROVADOR MASTER':   ['manifestacoes.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','pesquisas.visualizar','dashboard.visualizar'],
  'ATENDENTE SAC':      ['manifestacoes.visualizar','manifestacoes.abrir','cerebro.visualizar','dashboard.visualizar'],
  'SETOR RESPONSÁVEL':  ['manifestacoes.visualizar','manifestacoes.editar'],
  'ESPECIALISTA':       ['cerebro.visualizar','dashboard.visualizar'],
  'RCA / REPRESENTANTE':['manifestacoes.visualizar','manifestacoes.abrir','rca.visualizar','rca.criar'],
  'DIRETOR':            ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar','dashboard.gerenciar','rca.visualizar'],
  'VISUALIZADOR':       ['manifestacoes.visualizar','dashboard.visualizar','pesquisas.visualizar'],
  'AUDITOR':            ['manifestacoes.visualizar','manifestacoes.gerenciar','dashboard.visualizar'],
  // Perfis setoriais — representam colaboradores de setores internos com acesso restrito ao SAC
  'SETOR SAC':          ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','manifestacoes.gerenciar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','pesquisas.visualizar','pesquisas.criar','dashboard.visualizar','aprovacoes.visualizar'],
  'SETOR COMERCIAL':    ['manifestacoes.visualizar','manifestacoes.editar','rca.visualizar','rca.criar','dashboard.visualizar'],
  'SETOR LOGISTICA':    ['manifestacoes.visualizar','manifestacoes.editar','cerebro.visualizar','dashboard.visualizar'],
  'SETOR PRODUCAO':     ['manifestacoes.visualizar','manifestacoes.editar','cerebro.visualizar','dashboard.visualizar'],
  'SETOR QUALIDADE':    ['manifestacoes.visualizar','manifestacoes.editar','manifestacoes.aprovar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','cerebro.adicionar_regras','cerebro.adicionar_politicas','dashboard.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar'],
  'SETOR FINANCEIRO':   ['manifestacoes.visualizar','manifestacoes.editar','dashboard.visualizar','pesquisas.visualizar'],
  'SETOR TI':           ['manifestacoes.visualizar','cerebro.visualizar','cerebro.gerenciar','dashboard.visualizar','configuracoes.visualizar','configuracoes.editar'],
  'SETOR MARKETING':    ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar'],
  'SETOR DIRETORIA':    ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar','dashboard.gerenciar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','rca.visualizar'],
};

// Mapeamento chaves granulares da UI → chaves de enforcement das rotas API
// Permite que permissões concedidas via UI (chaves novas) sejam reconhecidas pelas rotas (chaves antigas)
const _CHAVE_UI_PARA_API = {
  'manifestacoes.criar':       'manifestacoes.abrir',
  'manifestacoes.excluir':     'manifestacoes.gerenciar',
  'manifestacoes.encaminhar':  'manifestacoes.editar',
  'manifestacoes.classificar': 'manifestacoes.editar',
  'manifestacoes.historico':   'manifestacoes.visualizar',
  'manifestacoes.anexar':      'manifestacoes.editar',
  'manifestacoes.evidencias':  'manifestacoes.visualizar',
  'manifestacoes.reabrir':     'manifestacoes.editar',
  'manifestacoes.encerrar':    'manifestacoes.gerenciar',
  'manifestacoes.arquivar':    'manifestacoes.gerenciar',
  'manifestacoes.desarquivar': 'manifestacoes.gerenciar',
  'aprovacoes.reprovar':       'aprovacoes.rejeitar',
  'aprovacoes.devolver':       'aprovacoes.rejeitar',
  'aprovacoes.parecer':        'aprovacoes.visualizar',
  'aprovacoes.pendentes':      'aprovacoes.visualizar',
  'rnc.abrir':                 'manifestacoes.editar',
  'rnc.editar':                'manifestacoes.editar',
  'rnc.visualizar':            'manifestacoes.visualizar',
  'rnc.aprovar':               'manifestacoes.aprovar',
  'fichas.acessar':            'manifestacoes.visualizar',
  'fichas.exportar':           'manifestacoes.gerenciar',
  'fichas.arquivar':           'manifestacoes.gerenciar',
  'fichas.desarquivar':        'manifestacoes.gerenciar',
  'cerebro.consultar':         'cerebro.visualizar',
  'cerebro.criar':             'cerebro.adicionar_conteudo',
  'cerebro.editar':            'cerebro.editar_conteudo',
  'cerebro.faqs':              'cerebro.editar_faq',
  'cerebro.procedimentos':     'cerebro.adicionar_politicas',
  'cerebro.politicas':         'cerebro.adicionar_politicas',
  'cerebro.regras':            'cerebro.adicionar_regras',
  'cerebro.setores':           'cerebro.gerenciar',
  'cerebro.responsabilidades': 'cerebro.gerenciar',
  'cerebro.matriz':            'cerebro.gerenciar',
  'cerebro.submeter':          'cerebro.editar_conteudo',
  'cerebro.aprovar':           'cerebro.gerenciar',
  'cerebro.publicar':          'cerebro.gerenciar',
  'ia.acessar':                'cerebro.visualizar',
  'indicadores.visualizar':    'dashboard.visualizar',
  'indicadores.empresa':       'dashboard.visualizar',
  'indicadores.setor':         'dashboard.visualizar',
  'indicadores.sla':           'dashboard.visualizar',
  'indicadores.reincidencias': 'dashboard.visualizar',
  'indicadores.ia':            'dashboard.visualizar',
  'indicadores.exportar':      'dashboard.gerenciar',
  'pesquisas.respostas':       'pesquisas.visualizar',
  'pesquisas.filtros':         'pesquisas.visualizar',
  'pesquisas.empresa':         'pesquisas.visualizar',
  'pesquisas.periodo':         'pesquisas.visualizar',
  'pesquisas.criticas':        'pesquisas.visualizar',
  'pesquisas.encaminhar':      'pesquisas.criar',
  'pesquisas.exportar':        'pesquisas.gerenciar',
  'usuarios.bloquear':         'usuarios.gerenciar',
  'usuarios.ativar':           'usuarios.gerenciar',
  'usuarios.excluir':          'usuarios.gerenciar',
  'usuarios.perfil':           'usuarios.editar',
  'usuarios.escopo':           'usuarios.editar',
  'usuarios.historico':        'usuarios.visualizar',
  'config.consultar':          'configuracoes.visualizar',
  'config.editar':             'configuracoes.editar',
  'config.sla':                'configuracoes.editar',
  'auditoria.logs':            'configuracoes.visualizar',
  'auditoria.exportar':        'configuracoes.gerenciar',
  'auditoria.historico':       'configuracoes.visualizar',
};

// Verifica se o usuário tem uma permissão: bloqueadas > concedidas > padrão do perfil
function usuarioTemPermissao(user, chave) {
  const p = perfilCanonico(user?.perfil || '');
  if (p === 'MASTER') return true;
  // blocked by Master → denied (verifica chave direta e alias)
  const blocked = user?.permissoes_blocked;
  if (Array.isArray(blocked)) {
    if (blocked.includes(chave)) return false;
    // se a chave da UI mapeia para esta chave de API e a chave UI está bloqueada, também bloqueia
    for (const [uiKey, apiKey] of Object.entries(_CHAVE_UI_PARA_API)) {
      if (apiKey === chave && blocked.includes(uiKey)) return false;
    }
  }
  // explicitly granted by Master → allowed (verifica chave direta e alias)
  const granted = user?.permissoes_granted;
  if (Array.isArray(granted)) {
    if (granted.includes(chave)) return true;
    // se uma chave UI que mapeia para esta chave API foi concedida, também concede
    for (const [uiKey, apiKey] of Object.entries(_CHAVE_UI_PARA_API)) {
      if (apiKey === chave && granted.includes(uiKey)) return true;
    }
  }
  // legacy custom (migration path)
  if (Array.isArray(user?.permissoes_custom) && user.permissoes_custom.length && !Array.isArray(user?.permissoes_granted)) {
    return user.permissoes_custom.includes(chave);
  }
  return (_PERM_PADRAO_API[p] || []).includes(chave);
}

// Traduz níveis de módulo (tela legada de permissões por nível → PERMISSOES_USUARIO)
// para as CHAVES granulares que as rotas realmente exigem (permissoes_granted).
// Mantém uma única fonte de verdade enforced: conceder acesso pela tela de níveis
// passa a surtir efeito nas 28 rotas de `requerPermissao` e na UI.
const _MODULO_PARA_CHAVES = {
  DASHBOARD:      { ns:'dashboard',     niveis:{1:['visualizar'], 4:['visualizar','gerenciar']} },
  MANIFESTACOES:  { ns:'manifestacoes', niveis:{1:['visualizar'], 2:['visualizar','abrir','editar'], 3:['visualizar','abrir','editar','aprovar'], 4:['visualizar','abrir','editar','gerenciar','aprovar']} },
  FILA_APROVACAO: { ns:'aprovacoes',    niveis:{1:['visualizar'], 3:['visualizar','aprovar','rejeitar']} },
  CEREBRO:        { ns:'cerebro',       niveis:{1:['visualizar'], 2:['visualizar','adicionar_conteudo','editar_conteudo','adicionar_regras','adicionar_politicas','editar_faq'], 4:['visualizar','adicionar_conteudo','editar_conteudo','adicionar_regras','adicionar_politicas','editar_faq','gerenciar']} },
  CONHECIMENTO:   { ns:'cerebro',       niveis:{1:['visualizar'], 2:['visualizar','adicionar_conteudo','editar_conteudo','editar_faq'], 4:['visualizar','adicionar_conteudo','editar_conteudo','editar_faq','gerenciar']} },
  RELATORIOS:     { ns:'pesquisas',     niveis:{1:['visualizar'], 2:['visualizar','criar'], 3:['visualizar','criar','editar'], 4:['visualizar','criar','editar','gerenciar']} },
  USUARIOS:       { ns:'usuarios',      niveis:{1:['visualizar'], 2:['visualizar','criar','editar'], 4:['visualizar','criar','editar','gerenciar']} },
  CONFIGURACOES:  { ns:'configuracoes', niveis:{1:['visualizar'], 2:['visualizar','editar'], 4:['visualizar','editar','gerenciar']} },
};
function permissoesGranularDeModulos(modulosNiveis) {
  const out = new Set();
  if (!modulosNiveis || typeof modulosNiveis !== 'object') return [];
  for (const [mod, nivelRaw] of Object.entries(modulosNiveis)) {
    const cfg = _MODULO_PARA_CHAVES[mod];
    const nivel = Number(nivelRaw) || 0;
    if (!cfg || nivel <= 0) continue;
    // escolhe o maior patamar definido que seja <= nível concedido
    const patamares = Object.keys(cfg.niveis).map(Number).sort((a,b)=>a-b);
    let escolhido = patamares[0];
    for (const p of patamares) { if (nivel >= p) escolhido = p; }
    (cfg.niveis[escolhido]||[]).forEach(k => out.add(`${cfg.ns}.${k}`));
  }
  return [...out];
}

// Middleware: exige que o usuário tenha TODAS as permissões listadas
function requerPermissao(...chaves) {
  return (req, res, next) => {
    const faltando = chaves.find(c => !usuarioTemPermissao(req.user, c));
    if (faltando) return res.status(403).json({ sucesso: false, erro: 'Sem permissão: ' + faltando });
    next();
  };
}

// B2: Isolamento de empresa — comparação por código canônico
function pertenceEmpresa(userEmpresa, registroEmpresa) {
  if (!userEmpresa || String(userEmpresa).trim() === '') return false; // empresa vazia = sem acesso (não é MASTER)
  const userCod = empresaCanonica(userEmpresa);
  if (!userCod || userCod === 'MASTER') return true; // MASTER vê tudo
  const recCod = empresaCanonica(registroEmpresa || '');
  if (!recCod) return false; // empresa desconhecida = invisível para não-MASTER
  return userCod === recCod;
}

function middlewareEscopoEmpresa() {
  return (req, res, next) => {
    if (!req.user) return next();
    const perfil = perfilCanonico(req.user.perfil);
    if (perfil === 'MASTER') return next(); // MASTER tem acesso global
    const empresa = req.user.empresa || '';
    if (!empresa.trim()) return res.status(403).json({ sucesso: false, erro: 'Usuário sem empresa configurada. Contate o administrador.' });
    req._empresaScope = empresa;
    next();
  };
}

// Filtra itens de atendimento pelo escopo de empresa do usuário.
// campoEmpresa: coluna exata do campo de empresa nesta aba (use COLUNA_EMPRESA_ABA).
// Sem empresa no item → invisível para não-MASTER (dado sem dono).
function filtrarPorEmpresa(itens, req, campoEmpresa) {
  if (!req._empresaScope) return itens;
  const userCod = empresaCanonica(req._empresaScope);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return false;
    return empresaCanonica(val) === userCod;
  });
}

// Filtra dados históricos/operacionais legados onde empresa pode estar vazia.
// Sem empresa → dado anterior ao isolamento B2 → visível para todos (global).
// Com empresa preenchida → apenas daquela empresa e MASTER.
function filtrarPorEmpresaHistorico(itens, req, campoEmpresa) {
  if (!req._empresaScope) return itens;
  const userCod = empresaCanonica(req._empresaScope);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return true; // legado sem empresa = compartilhado
    return empresaCanonica(val) === userCod;
  });
}

// Filtra itens de configuração/conhecimento.
// Sem empresa no item → global (visível para todos). Com empresa → apenas daquela empresa e MASTER.
function filtrarPorEmpresaConfig(itens, req, campoEmpresa = 'EMPRESA') {
  if (!req._empresaScope) return itens;
  const userCod = empresaCanonica(req._empresaScope);
  if (!userCod || userCod === 'MASTER') return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return true; // sem empresa = global
    return empresaCanonica(val) === userCod;
  });
}

function middlewareEscopoSetor() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ sucesso: false, erro: 'Sessão inválida.' });
    if (perfilCanonico(req.user.perfil) === 'MASTER') return next();
    if (!req._empresaScope) return res.status(403).json({ sucesso: false, erro: 'Token sem empresa definida.' });
    const userCod = empresaCanonica(req._empresaScope);
    if (!userCod || userCod === 'MASTER') return next();
    const nome = decodeURIComponent(req.params.setor || '');
    try {
      const rows = await lerAba('CONFIG_SETORES', 500).catch(() => []);
      const setorRow = rows.find(r => normalizarTexto(r.SETOR || r.NOME_SETOR || '') === normalizarTexto(nome));
      if (!setorRow || !(setorRow.EMPRESA || '').trim()) return next(); // setor global ou não encontrado
      if (empresaCanonica(setorRow.EMPRESA) !== userCod) {
        return res.status(403).json({ sucesso: false, erro: 'Acesso restrito à empresa do setor.' });
      }
      next();
    } catch (e) {
      return res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
    }
  };
}

async function carregarUsuarioPorLogin(login){
  const alvo=normalizarTexto(login);
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'false').toLowerCase()==='true';
  const emProducao = process.env.NODE_ENV==='production' || process.env.VERCEL_ENV==='production';
  if(demoEnabled && !emProducao){
    const demo=DEMO_USUARIOS.find(u=>normalizarTexto(u.USUARIO)===alvo);
    if(demo) return demo;
  }
  const usuarios=await carregarUsuarios();
  return usuarios.find(u=>normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO)===alvo && normalizarTexto(u.STATUS||'ATIVO')!=='inativo') || null;
}

async function registrarAcessoUsuario(usuario){
  try{
    await atualizarPorID('USUARIOS',usuario.ID_USUARIO||usuario.USUARIO||usuario.EMAIL,{ULTIMO_ACESSO:new Date().toISOString()},['ID_USUARIO','USUARIO','EMAIL']);
  }catch(e){}
}

async function getSheets() {
  if (_sheetsMock?.getSheets) return _sheetsMock.getSheets();
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function _sheetsGetComRetry(sheets, params, tentativas = 3) {
  let espera = 1000;
  for (let i = 0; i < tentativas; i++) {
    try {
      return await sheets.spreadsheets.values.get(params);
    } catch (e) {
      const status = e?.response?.status || e?.code;
      // Retry apenas em 429 (rate limit) e 503 (serviço indisponível)
      if ((status === 429 || status === 503) && i < tentativas - 1) {
        await new Promise(r => setTimeout(r, espera));
        espera *= 2;
        continue;
      }
      throw e;
    }
  }
}

// Cache em memória para leituras do Sheets (60 s TTL) — evita quota exceeded
const _lerAbaCache = new Map();
const LER_ABA_TTL_MS = 60_000;

async function lerAba(nomeAba, maxRows) {
  if (_sheetsMock?.lerAba) return _sheetsMock.lerAba(nomeAba, maxRows);
  const cacheKey = `${nomeAba}|${maxRows||''}`;
  const cached = _lerAbaCache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < LER_ABA_TTL_MS) return cached.data;
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:AZ${maxRows}` : nomeAba;
  const res = await _sheetsGetComRetry(sheets, { spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values || [];
  if (rows.length < 2) { _lerAbaCache.set(cacheKey, { data: [], ts: Date.now() }); return []; }
  const headers = rows[0];
  const data = rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
    return obj;
  });
  _lerAbaCache.set(cacheKey, { data, ts: Date.now() });
  return data;
}

function invalidarCacheAba(nomeAba) {
  for (const key of _lerAbaCache.keys()) {
    if (key.startsWith(nomeAba + '|')) _lerAbaCache.delete(key);
  }
}

// Tenta 'Reclamações + devolutiva' primeiro; cai para 'Reclamações' se vazio
async function lerAbaReclamacoes(max = 2000) {
  if (_sheetsMock?.lerAbaReclamacoes) return _sheetsMock.lerAbaReclamacoes(max);
  const r1 = await lerAba('Reclamações + devolutiva', max).catch(() => []);
  if (r1.length > 0) return r1;
  return lerAba('Reclamações', max).catch(() => []);
}

function _sanitizarFormula(v) {
  if (typeof v !== 'string') return v;
  return /^[\s]*[=+\-@|]/.test(v) ? "'" + v : v;
}

async function appendLinha(nomeAba, linha) {
  if (_sheetsMock?.appendLinha) return _sheetsMock.appendLinha(nomeAba, linha);
  let espera = 1000;
  for (let i = 0; i < 3; i++) {
    try {
      const sheets = await getSheets();
      await sheets.spreadsheets.values.append({
        spreadsheetId: SPREADSHEET_ID, range: nomeAba,
        valueInputOption: 'RAW', resource: { values: [linha.map(_sanitizarFormula)] },
      });
      return;
    } catch (e) {
      const status = e?.response?.status || e?.code;
      // Só retentar em 429 (rate limit). 503 pode ter gravado — retry causaria duplicata.
      if (status === 429 && i < 2) {
        console.warn(`[appendLinha] retry ${i+1} após ${espera}ms (429 rate limit)`);
        await new Promise(r => setTimeout(r, espera));
        espera *= 2;
        continue;
      }
      throw e;
    }
  }
}

async function updateLinha(nomeAba, rowIndex, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `${nomeAba}!A${rowIndex}`,
    valueInputOption: 'RAW', resource: { values: [linha] },
  });
}

async function obterCabecalhos(nomeAba) {
  if (_sheetsMock?.obterCabecalhos) return _sheetsMock.obterCabecalhos(nomeAba);
  const sheets = await getSheets();
  const res = await _sheetsGetComRetry(sheets, {
    spreadsheetId: SPREADSHEET_ID, range: `${nomeAba}!1:1`, valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values?.[0] || [];
}

async function appendObjeto(nomeAba, objeto) {
  const headers = await obterCabecalhos(nomeAba);
  if (!headers.length) throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  const linha = headers.map(h => objeto[h] !== undefined ? objeto[h] : '');
  await appendLinha(nomeAba, linha);
  invalidarCacheAba(nomeAba);
  return { headers, linha };
}

async function atualizarPorID(nomeAba, id, dados, camposID = ['ID_MANIFESTACAO','ID_RNC','ID_APROVADOR','ID_SUGESTAO','ID_ANEXO','ID_EVENTO']) {
  if (_sheetsMock?.atualizarPorID) return _sheetsMock.atualizarPorID(nomeAba, id, dados, camposID);
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: nomeAba, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = res.data.values || [];
  if (rows.length < 2) return null;
  const headers = rows[0];
  // Coleta índices de todos os campos candidatos que existem no cabeçalho
  const idxCandidatos = camposID.map(c => headers.indexOf(c)).filter(i => i !== -1);
  if (!idxCandidatos.length) return null;
  let rowIndex = -1;
  const idNorm = String(id).trim();
  for (let i=1;i<rows.length;i++) {
    if (idxCandidatos.some(idx => String(rows[i][idx] || '').trim() === idNorm)) { rowIndex=i+1; break; }
  }
  if (rowIndex < 0) return null;
  const valores = [...rows[rowIndex-1]];
  headers.forEach((h,i)=>{ if(Object.prototype.hasOwnProperty.call(dados,h)) valores[i]=dados[h]; });
  await updateLinha(nomeAba,rowIndex,valores);
  invalidarCacheAba(nomeAba);
  return { rowIndex, headers, valores };
}

async function deletarLinhaPorID(nomeAba, id, camposID = ['ID_MANIFESTACAO']) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: nomeAba, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = res.data.values || [];
  if (rows.length < 2) return null;
  const headers = rows[0];
  const idxCandidatos = camposID.map(c => headers.indexOf(c)).filter(i => i !== -1);
  if (!idxCandidatos.length) return null;
  const idNorm = String(id).trim();
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (idxCandidatos.some(idx => String(rows[i][idx] || '').trim() === idNorm)) { rowIndex = i; break; }
  }
  if (rowIndex < 0) return null;
  // Obter sheetId da aba
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID, fields: 'sheets.properties' });
  const sheet = (meta.data.sheets || []).find(s => s.properties.title === nomeAba);
  if (!sheet) return null;
  const sheetId = sheet.properties.sheetId;
  await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: rowIndex, endIndex: rowIndex + 1 } } }] } });
  invalidarCacheAba(nomeAba);
  return { rowIndex };
}

async function gerarProximoID(nomeAba, prefixo, campoID) {
  // Usa timestamp + random para evitar race condition em ambiente serverless
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `${prefixo}-${ts}${rand}`;
}

async function buscarPorID(nomeAba, id, camposID = ['ID_MANIFESTACAO','ID_RNC','ID_SETOR','ID']) {
  const dados = await lerAba(nomeAba, 5000).catch(() => []);
  return dados.find(r => camposID.some(c => String(r[c] || '').trim() === String(id).trim())) || null;
}

async function registrarAuditoria(usuario, acao, idManifestacao, entidade, valorAnterior, valorNovo) {
  try {
    const linha = [
      new Date().toISOString(), usuario || 'sistema', acao, idManifestacao || '', entidade || '',
      typeof valorAnterior === 'object' ? JSON.stringify(valorAnterior) : (valorAnterior || ''),
      typeof valorNovo === 'object' ? JSON.stringify(valorNovo) : (valorNovo || ''),
    ];
    await appendLinha('LOG_SISTEMA', linha);
  } catch (e) { console.error('Erro auditoria:', e.message); }
}

// Filtra itens de teste (prefixo TESTE-GOLIVE) das métricas
function isTeste(item) {
  const campos = ['ID_MANIFESTACAO','ID_RNC','TITULO','NAO_CONFORMIDADE','Motivo da Reclamação','Descrição do Problema'];
  return campos.some(c => String(item[c] || '').toUpperCase().startsWith('TESTE-GOLIVE'));
}

// ===== MOTOR DE REGRAS — MÚLTIPLOS SETORES =====
async function motorRegras(descricao, tipo, empresa) {
  try {
    const [regras, tipos, procedimentos, slaData, perguntas] = await Promise.all([
      lerAba('REGRAS_ROTEAMENTO', 500).catch(()=>[]), lerAba('TIPOS_RECLAMACAO', 500).catch(()=>[]),
      lerAba('PROCEDIMENTOS', 200).catch(()=>[]), lerAba('SLA_ESCALONAMENTO', 50).catch(()=>[]), lerAba('PERGUNTAS_ANALISE', 200).catch(()=>[]),
    ]);
    const texto = (descricao || '').toLowerCase();

    let tipoDetectado = null, tipoConfianca = 0, tipoID = null;
    for (const t of tipos) {
      const palavras = (t.PALAVRAS_CHAVE || '').toLowerCase().split(',').map(p => p.trim()).filter(Boolean);
      let matches = 0;
      for (const p of palavras) { if (p && texto.includes(p)) matches++; }
      if (matches > 0) {
        const conf = Math.min(99, Math.round((matches / Math.max(palavras.length, 1)) * 100 * 2));
        if (conf > tipoConfianca) { tipoConfianca = conf; tipoDetectado = t.TIPO || t.ID_TIPO; tipoID = t.ID_TIPO; }
      }
    }
    if (!tipoDetectado) { tipoDetectado = 'Não identificado'; tipoConfianca = 0; }

    const setoresSet = new Set();
    let regraAplicada = null;
    for (const r of regras) {
      if (r.ATIVO !== 'SIM') continue;
      const tiposRegra = (r.TIPO || '').split('/').map(t => t.trim());
      if (tiposRegra.includes(tipoID) || tiposRegra.some(t => (tipoID || '').includes(t))) {
        (r.SETORES_ENVOLVIDOS || '').split('+').map(s => s.trim().split('(')[0].trim()).filter(Boolean).forEach(s => setoresSet.add(s));
        if (!regraAplicada) regraAplicada = r.ID_REGRA;
      }
    }

    if (setoresSet.size === 0) {
      if (texto.includes('entrega') || texto.includes('prazo') || texto.includes('atraso')) setoresSet.add('Logística');
      if (texto.includes('qualidade') || texto.includes('defeito') || texto.includes('ruptura') || texto.includes('embalagem') || texto.includes('quantidade') || texto.includes('padrao') || texto.includes('padrão')) setoresSet.add('Qualidade');
      if (texto.includes('nota') || texto.includes('nf') || texto.includes('cobrança') || texto.includes('valor') || texto.includes('preco') || texto.includes('preço') || texto.includes('cobrado')) setoresSet.add('Financeiro');
      if (texto.includes('comercial') || texto.includes('pedido')) setoresSet.add('Comercial');
      if (setoresSet.size === 0) setoresSet.add('SAC');
    }

    const setores = [...setoresSet];

    let slaHoras = 72;
    const slaSetor = slaData.find(s => s.SETOR && s.SETOR.includes('SAC'));
    if (slaSetor) { const match = (slaSetor.SLA_PADRAO_HORAS || '72').match(/\d+/); if (match) slaHoras = parseInt(match[0]); }

    let prioridade = 'Média';
    if (texto.includes('urgente') || texto.includes('urgência') || texto.includes('perda') || setores.length >= 3) prioridade = 'Alta';
    else if (texto.includes('elogio') || texto.includes('satisfeito') || texto.includes('sugestão')) prioridade = 'Baixa';

    let procedimentoSugerido = null;
    for (const p of procedimentos) {
      const tiposProc = (p.TIPO_RECLAMACAO || '').split(',').map(t => t.trim());
      if (tiposProc.includes(tipoID) || tiposProc.some(t => (tipoID || '').includes(t))) {
        procedimentoSugerido = { id: p.ID_PROCEDIMENTO, nome: p.NOME, passos: p.PASSOS, documentos: p.DOCUMENTOS_NECESSARIOS }; break;
      }
    }

    const perguntasNecessarias = perguntas
      .filter(p => p.TIPO_RECLAMACAO === 'TODOS' || (tipoID && (p.TIPO_RECLAMACAO || '').includes(tipoID)))
      .slice(0, 6).map(p => ({ id: p.ID_PERGUNTA, pergunta: p.PERGUNTA, obrigatoria: p.OBRIGATORIA === 'SIM' }));

    // B6: geraRNC NUNCA é definido automaticamente por palavras-chave.
    // RNC é sempre decisão humana. Motor de regras sinaliza para revisão, não cria RNC.
    // rncSinalizado indica que o caso tem características que MERECEM revisão de RNC.
    const rncSinalizado = texto.includes('reincidência') || texto.includes('terceira') || texto.includes('repetiu') || prioridade === 'Alta';
    const geraRNC = false; // Imutável. RNC só é criado por decisão humana explícita.

    return { tipoDetectado, tipoID, tipoConfianca, setores, regraAplicada, slaHoras, prioridade, procedimentoSugerido, perguntasNecessarias, geraRNC, rncSinalizado };
  } catch (e) {
    console.error('Erro motor regras:', e.message);
    return { tipoDetectado: 'Não identificado', tipoConfianca: 0, setores: ['SAC'], slaHoras: 72, prioridade: 'Média', geraRNC: false };
  }
}

function calcSimilaridade(texto1, texto2) {
  if (!texto1 || !texto2) return 0;
  const stopwords = new Set(['de','a','o','e','que','do','da','em','um','uma','para','com','por','se','não','na','no','os','as','ao','à','mais','mas','ou','é']);
  const tokenizar = t => t.toLowerCase().replace(/[^a-záàãâéêíóôõúç\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !stopwords.has(w));
  const t1 = tokenizar(texto1); const t2 = tokenizar(texto2);
  const set1 = new Set(t1); const set2 = new Set(t2);
  const intersect = [...set1].filter(w => set2.has(w)).length;
  const union = new Set([...set1, ...set2]).size;
  return union > 0 ? Math.round((intersect / union) * 100) : 0;
}

function gerarDevolutiva(empresa, tipo, setores, tratativa) {
  const setor = (Array.isArray(setores) ? setores.join(', ') : setores) || 'nossos setores responsáveis';
  return `Prezado(a) cliente da ${empresa || 'empresa'},\n\nRecebemos seu relato referente a ${tipo || 'sua manifestação'} e registramos formalmente em nosso sistema.\n\nEncaminhamos o caso aos setores de ${setor} para análise e providências.\n\nRetornaremos com um posicionamento completo dentro do prazo estabelecido.\n\nAgradecemos o contato e pedimos desculpas pelos transtornos causados.\n\nAtenciosamente,\nEquipe SAC — Grupo Chiacchio`;
}

async function executarAnalise(manifestacao) {
  const inicio = Date.now();
  const regras = await motorRegras(
    manifestacao.descricao || manifestacao.DESCRICAO || '',
    manifestacao.tipo || manifestacao.TIPO || '',
    manifestacao.empresaReclamada || manifestacao.EMPRESA_RECLAMADA || ''
  );
  // Resolver Matriz de Conhecimento antes de chamar o Cérebro
  const matrizConhecimento = await mcService.resolverConhecimento({
    ...manifestacao,
    EMPRESA_RECLAMADA: manifestacao.empresaReclamada || manifestacao.EMPRESA_RECLAMADA || '',
    TIPO_MANIFESTACAO: manifestacao.tipo || manifestacao.TIPO || regras.tipoDetectado || '',
    CATEGORIA: manifestacao.categoria || manifestacao.CATEGORIA || '',
    SUBCATEGORIA: manifestacao.subcategoria || manifestacao.SUBCATEGORIA || '',
    PRODUTO: manifestacao.produto || manifestacao.PRODUTO || '',
    SETOR: regras.setores?.[0] || '',
    DESCRICAO: manifestacao.descricao || manifestacao.DESCRICAO || '',
  }).catch(e => { console.warn('[MC] resolverConhecimento falhou:', e.message); return null; });

  const analise = await cerebroService.analisarManifestacao({
    ...manifestacao,
    empresaReclamante: manifestacao.empresaReclamante || manifestacao.EMPRESA_RECLAMANTE,
    descricao: manifestacao.descricao || manifestacao.DESCRICAO,
    matrizConhecimento,
  }, regras);

  // Registrar auditoria da Matriz
  if (matrizConhecimento) {
    const protocolo = manifestacao.protocolo || manifestacao.ID_MANIFESTACAO || '';
    mcService.registrarAuditoria(protocolo, matrizConhecimento, 'sistema', analise.versoes?.cerebro || '4.0.0').catch(() => {});
  }

  return { ...analise, matrizConhecimento, tipoID: regras.tipoID, tempoAnaliseSegundos: Math.round((Date.now() - inicio) / 1000) };
}

function normalizarEmpresa(raw) {
  if (!raw) return null;
  const r = raw.toUpperCase().trim();
  if (r.includes('CHIACH') || r.includes('EMBALAGEM')) return 'CHIACCHIO EMBALAGENS';
  if (r.includes('PLASCH') || r.includes('PLASCHIO')) return 'PLASCHIO';
  if (r.includes('TUBAH')) return 'TUBAHIA';
  if (r.includes('CESBAP')) return 'CESBAP';
  if (/^TR\d+/.test(r) || r === 'TR01' || r === 'TR08') return null;
  return raw.trim();
}

function normalizarData(val) {
  if (!val) return null;
  if (typeof val === 'number') { const d = new Date((val - 25569) * 86400 * 1000); return isNaN(d) ? null : d.toISOString().split('T')[0]; }
  if (typeof val === 'string') {
    const br = val.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (br) { let y=Number(br[3]); if(y<100)y+=2000; const d=new Date(y,Number(br[2])-1,Number(br[1])); return isNaN(d)?null:d.toISOString().split('T')[0]; }
    const d = new Date(val); return isNaN(d) ? null : d.toISOString().split('T')[0];
  }
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return null;
}

// ===========================================================
// ROTAS
// ===========================================================

app.get('/api/health', async (req, res) => {
  const saude = {
    sucesso: true, status: 'ok', versao: '5.6.0',
    sistema: 'Assistente SAC Chiacchio', ts: new Date().toISOString(),
    postgresql: 'não utilizado',
    sheets: 'não verificado',
    demoAtivo: String(process.env.DEMO_LOGIN_ENABLED || 'false').toLowerCase() === 'true',
  };
  // Verificar Sheets (rápido)
  try {
    const rows = await lerAba('MANIFESTACOES', 2).catch(() => null);
    saude.sheets = rows !== null ? 'acessível' : 'inacessível';
  } catch (e) { saude.sheets = 'erro'; }
  // Diagnóstico de usuários
  saude.pgLeituraAtiva = !!usuarioRepo;
  try {
    if (usuarioRepo) {
      const pgUsers = await usuarioRepo.findAll({ ativo: undefined });
      saude.pgUsuariosCount = pgUsers ? pgUsers.length : 0;
    } else {
      saude.pgUsuariosCount = 'repo_nulo';
    }
  } catch(e) { saude.pgUsuariosCount = 'erro: ' + e.message; }
  try {
    const sheetsUsers = await lerAba('USUARIOS', 5).catch(() => null);
    saude.sheetsUsuariosCount = sheetsUsers !== null ? sheetsUsers.length : 'inacessível';
  } catch(e) { saude.sheetsUsuariosCount = 'erro'; }
  res.json(saude);
});

app.get('/', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '5.6.0', sistema: 'Assistente SAC Chiacchio' });
});

// ===== MIDDLEWARE AUTH =====
// Cache leve de status de usuário: evita ler Sheets a cada request.
// TTL 2 minutos — usuário desativado expulso em até 2 min.
const _statusCache = new Map(); // login → { status, ts }
const _STATUS_CACHE_TTL = 2 * 60 * 1000;

async function verificarStatusUsuario(login) {
  const agora = Date.now();
  const cached = _statusCache.get(login);
  if (cached && (agora - cached.ts) < _STATUS_CACHE_TTL) return cached;
  // F4: PostgreSQL primeiro — evita tratar usuário que só existe no PG como inativo.
  if (usuarioRepo) {
    try {
      const pgU = await usuarioRepo.findByLogin(login).catch(() => null);
      if (pgU) {
        const entry = { status: pgU.ativo === false ? 'INATIVO' : 'ATIVO', ts: agora, permissoes_granted: null, permissoes_blocked: null };
        _statusCache.set(login, entry);
        return entry;
      }
    } catch (e) { /* cai no Sheets */ }
  }
  try {
    const rows = await lerAba('USUARIOS', 1000);
    const u = rows.find(r => normalizarTexto(r.USUARIO||'') === normalizarTexto(login));
    // Se não encontrado no Sheets mas encontrado antes (cache expirado), mantém como ATIVO —
    // usuário criado via PG pode não existir no Sheets.
    const status = u ? (u.STATUS || 'ATIVO').toUpperCase() : (cached ? cached.status : 'INATIVO');
    let permissoes_granted = null, permissoes_blocked = null;
    if (u) {
      try { if (u.PERMISSOES_GRANTED) permissoes_granted = JSON.parse(u.PERMISSOES_GRANTED); } catch(_) {}
      try { if (u.PERMISSOES_BLOCKED) permissoes_blocked = JSON.parse(u.PERMISSOES_BLOCKED); } catch(_) {}
    } else if (cached) {
      permissoes_granted = cached.permissoes_granted;
      permissoes_blocked = cached.permissoes_blocked;
    }
    const entry = { status, ts: agora, permissoes_granted, permissoes_blocked };
    _statusCache.set(login, entry);
    if (_statusCache.size > 2000) {
      for (const [k, v] of _statusCache) {
        if (agora - v.ts >= _STATUS_CACHE_TTL) _statusCache.delete(k);
      }
    }
    return entry;
  } catch(e) {
    // Falha ao ler Sheets: se houver cache anterior, usa-o para não derrubar sessões ativas.
    // Se não há cache, nega acesso por segurança.
    console.error('[verificarStatusUsuario] Erro ao ler planilha:', e.message || e);
    if (cached) return { ...cached, ts: agora };
    return { status: 'INATIVO', ts: agora, permissoes_granted: null, permissoes_blocked: null };
  }
}

app.use('/api', async (req,res,next)=>{
  const publicPaths = new Set([
    '/health',
    '/',
    '/auth/login',
    '/auth/forgot-password',
    '/auth/reset-password',
    '/bootstrap',
    '/public/solicitar-acesso',
    '/public/reclamacoes',
    '/public/empresas',
    '/pesquisas/resposta-publica',
    '/pesquisas/resposta-token',
    '/pesquisa',
  ]);
  if(publicPaths.has(req.path) || req.path.startsWith('/pesquisa/')) return next();
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida ou expirada.'});
  // Item10: verificar se usuário ainda está ativo (detecta desativação pós-login)
  const infoAtual = await verificarStatusUsuario(payload.usuario);
  if (infoAtual.status === 'INATIVO') {
    _statusCache.delete(payload.usuario); // forçar re-verificação na próxima vez
    return res.status(401).json({sucesso:false,erro:'Usuário inativo. Sessão encerrada.'});
  }
  if (!verificarRateLimitAuth(payload.usuario)) {
    return res.status(429).json({ sucesso: false, erro: 'Muitas requisições. Tente novamente em instantes.' });
  }
  // Sobrescreve permissões do JWT com as versões frescas do Sheets (cache 2 min)
  // Isso permite que mudanças de permissão pelo MASTER sejam refletidas sem re-login
  req.user = {
    ...payload,
    permissoes_granted: infoAtual.permissoes_granted ?? payload.permissoes_granted,
    permissoes_blocked: infoAtual.permissoes_blocked ?? payload.permissoes_blocked,
  };
  next();
});

// ===== HELPER DE ERRO SEGURO (E2) =====
function erroSeguro(e, contexto) {
  const msg = e?.message || 'Erro desconhecido';
  console.error(`[${contexto || 'API'}]`, msg, e?.stack ? e.stack.split('\n')[1] : '');
  if (process.env.NODE_ENV === 'production') return 'Erro interno do servidor.';
  return msg;
}

// ===== RATE LIMITING =====
// Login: 10 tentativas por IP em 15 minutos (por instância).
// O bcrypt com cost 12 já impõe ~300ms por tentativa, tornando força bruta
// muito lenta mesmo que o contador seja por instância em serverless.

const _loginAttempts = new Map();
function verificarRateLimit(ip) {
  const agora = Date.now();
  const janela = 15 * 60 * 1000;
  const max = 10;
  const tentativas = (_loginAttempts.get(ip) || []).filter(t => agora - t < janela);
  if (tentativas.length >= max) return false;
  tentativas.push(agora);
  _loginAttempts.set(ip, tentativas);
  if (_loginAttempts.size > 2000) {
    for (const [k, v] of _loginAttempts) {
      if (v.every(t => agora - t >= janela)) _loginAttempts.delete(k);
    }
  }
  return true;
}

// Rotas autenticadas: 120 req/min por usuário
const _authAttempts = new Map();
function verificarRateLimitAuth(user) {
  const agora = Date.now();
  const janela = 60 * 1000;
  const max = 120;
  const tentativas = (_authAttempts.get(user) || []).filter(t => agora - t < janela);
  if (tentativas.length >= max) return false;
  tentativas.push(agora);
  _authAttempts.set(user, tentativas);
  if (_authAttempts.size > 5000) {
    for (const [k, v] of _authAttempts) {
      if (v.every(t => agora - t >= janela)) _authAttempts.delete(k);
    }
  }
  return true;
}

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
    if (!verificarRateLimit(ip)) return res.status(429).json({ sucesso: false, erro: 'Muitas tentativas de login. Aguarde 15 minutos.' });
    const { usuario, senha } = req.body || {};
    if(!usuario) return res.status(400).json({sucesso:false,erro:'Usuário é obrigatório.'});
    if(!senha) return res.status(400).json({sucesso:false,erro:'Senha é obrigatória.'});
    const registro=await carregarUsuarioPorLogin(usuario);
    if(!registro) return res.status(401).json({ sucesso:false, erro:'Usuário ou senha inválidos.' });
    const pub=usuarioPublico(registro);
    const statusNorm=normalizarTexto(pub.status||'');
    if(statusNorm==='inativo') return res.status(403).json({sucesso:false,erro:'Usuário inativo. Contate o administrador.'});
    if(statusNorm==='bloqueado') return res.status(403).json({sucesso:false,erro:'Usuário bloqueado. Contate o administrador.'});
    const senhaOk = await senhaValida(senha, registro.SENHA_HASH || registro.SENHA);
    if(!senhaOk) return res.status(401).json({sucesso:false,erro:'Usuário ou senha inválidos.'});
    const agora=Date.now();
    const primeroAcesso = statusNorm === 'primeiro_acesso' || statusNorm === 'primeiroacesso';
    const payload={
      sub:pub.id, usuario:pub.usuario, nome:pub.nome, email:pub.email, perfil:pub.perfil,
      empresa:pub.empresa, setor:pub.setor, cargo:pub.cargo||'', telefone:pub.telefone||'',
      codigoRCA:pub.codigoRCA,
      permissoes_custom: Array.isArray(pub.permissoes_custom)&&pub.permissoes_custom.length ? pub.permissoes_custom : null,
      permissoes_granted: Array.isArray(pub.permissoes_granted)&&pub.permissoes_granted.length ? pub.permissoes_granted : null,
      permissoes_blocked: Array.isArray(pub.permissoes_blocked)&&pub.permissoes_blocked.length ? pub.permissoes_blocked : null,
      primeiro_acesso: primeroAcesso || undefined,
      iat:agora, exp:agora+SESSION_TTL_MS
    };
    const isDemo = String(registro.ID_USUARIO||'').startsWith('USR-DEMO-');
    if (!isDemo) {
      // Migração automática sha256→bcrypt: se hash for legado, atualiza no Sheets
      const hashAtual = String(registro.SENHA_HASH || registro.SENHA || '');
      if (hashAtual.startsWith('sha256:')) {
        const novoHash = await hashSenha(senha);
        atualizarPorID('USUARIOS', registro.ID_USUARIO || registro.USUARIO,
          { SENHA_HASH: novoHash }, ['ID_USUARIO', 'USUARIO']
        ).catch(e => console.warn('[MIGRAÇÃO SENHA] falhou:', e.message));
      }
      await registrarAcessoUsuario(registro);
      await registrarAuditoria(pub.usuario,'LOGIN',null,'AUTH',null,{perfil:pub.perfil});
    }
    res.json({ sucesso:true, token:assinarToken(payload), usuario:pub.usuario, usuarioInfo:pub, modo:isDemo?'DEMO':'PRODUCAO' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

app.get('/api/auth/me', async (req,res)=>{
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida.'});
  res.json({sucesso:true,usuario:payload});
});

app.post('/api/auth/refresh', async (req,res)=>{
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida ou expirada.'});
  const agora=Date.now();
  // Re-lê dados frescos do usuário (permissões podem ter mudado desde o login)
  let usuarioInfo = null;
  try {
    const registro = await carregarUsuarioPorLogin(payload.usuario);
    if (registro) {
      const pub = usuarioPublico(registro);
      usuarioInfo = pub;
      const novoPayload = {
        sub: pub.id, usuario: pub.usuario, nome: pub.nome, email: pub.email, perfil: pub.perfil,
        empresa: pub.empresa, setor: pub.setor, cargo: pub.cargo||'', telefone: pub.telefone||'',
        codigoRCA: pub.codigoRCA,
        permissoes_granted: pub.permissoes_granted,
        permissoes_blocked: pub.permissoes_blocked,
        iat: agora, exp: agora+SESSION_TTL_MS,
      };
      return res.json({sucesso:true, token:assinarToken(novoPayload), usuarioInfo});
    }
  } catch(e) { /* cai no fallback abaixo */ }
  // Fallback: renova apenas o prazo sem alterar dados
  const novoPayload={...payload, iat:agora, exp:agora+SESSION_TTL_MS};
  res.json({sucesso:true, token:assinarToken(novoPayload), usuarioInfo: null});
});

// ===== COMPLETAR PRIMEIRO ACESSO =====
app.post('/api/auth/completar-primeiro-acesso', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verificarToken(token);
  if (!payload) return res.status(401).json({ sucesso: false, erro: 'Sessão inválida.' });

  try {
    const { nome, cargo, setor, telefone, senha, confirmacao } = req.body || {};
    if (!senha || senha.length < 6) return res.status(400).json({ sucesso: false, erro: 'A senha deve ter no mínimo 6 caracteres.' });
    if (senha !== confirmacao) return res.status(400).json({ sucesso: false, erro: 'As senhas não coincidem.' });
    if (!nome?.trim()) return res.status(400).json({ sucesso: false, erro: 'Nome obrigatório.' });

    const usuarios = await carregarUsuarios();
    const usuario = usuarios.find(u => u.ID_USUARIO === payload.sub || (u.USUARIO||'').toLowerCase() === (payload.usuario||'').toLowerCase());
    if (!usuario) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

    const senhaHash = await hashSenha(senha);
    const agora = new Date().toISOString();
    await atualizarPorID('USUARIOS', usuario.ID_USUARIO || usuario.USUARIO, {
      NOME: nome.trim(),
      CARGO: cargo?.trim() || usuario.CARGO || '',
      SETOR: setor?.trim() || usuario.SETOR || '',
      TELEFONE: telefone?.trim() || '',
      SENHA_HASH: senhaHash,
      STATUS: 'ATIVO',
      DATA_PRIMEIRO_ACESSO: agora,
      DATA_ULTIMA_ALTERACAO: agora,
    }, ['ID_USUARIO', 'USUARIO']);

    // Emite novo JWT sem primeiro_acesso
    const agoraN = Date.now();
    const pub = usuarioPublico({ ...usuario, NOME: nome.trim(), CARGO: cargo?.trim() || usuario.CARGO || '', SETOR: setor?.trim() || usuario.SETOR || '', TELEFONE: telefone?.trim() || '', STATUS: 'ATIVO' });
    const novoPayload = {
      sub: pub.id, usuario: pub.usuario, nome: pub.nome, email: pub.email, perfil: pub.perfil,
      empresa: pub.empresa, setor: pub.setor, cargo: pub.cargo || '', telefone: pub.telefone || '',
      codigoRCA: pub.codigoRCA,
      permissoes_custom: payload.permissoes_custom || null,
      permissoes_granted: payload.permissoes_granted || null,
      permissoes_blocked: payload.permissoes_blocked || null,
      iat: agoraN, exp: agoraN + SESSION_TTL_MS,
    };
    await registrarAuditoria(pub.usuario, 'PRIMEIRO_ACESSO_CONCLUIDO', null, 'AUTH', null, {});
    invalidarCachePermissoes(pub.email || pub.usuario);
    res.json({ sucesso: true, token: assinarToken(novoPayload), usuarioInfo: pub });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

app.post('/api/auth/forgot-password', async (req,res)=>{
  const login=(req.body?.usuario||req.body?.email||'').trim().toLowerCase();
  if(!login) return res.status(400).json({sucesso:false,erro:'Informe usuário ou e-mail.'});
  await registrarAuditoria(login,'SOLICITOU_RECUPERACAO_SENHA',null,'AUTH',null,{});

  // Localizar usuário
  let usuarios = [];
  try { usuarios = await lerAba('USUARIOS', 500); } catch(e) {}
  const usuario = usuarios.find(u => {
    const u_login = (u.USUARIO||u.EMAIL||'').trim().toLowerCase();
    const u_email = (u.EMAIL||'').trim().toLowerCase();
    return u_login === login || u_email === login;
  });

  // Resposta genérica independente de o usuário existir (evita enumeração)
  const MSG_OK = 'Se o usuário existir, um link de redefinição será enviado para o e-mail cadastrado.';

  if (!usuario || !usuario.EMAIL) {
    return res.json({sucesso:true, mensagem: MSG_OK});
  }

  if (!_resend) {
    // Sem serviço de e-mail configurado — fallback manual
    console.warn('[forgot-password] RESEND_API_KEY não configurada. Envio ignorado para:', login);
    return res.json({sucesso:true, mensagem:'Solicitação registrada. O administrador deverá redefinir a senha.'});
  }

  // Gerar token seguro de 1h
  const token = crypto.randomBytes(32).toString('hex');
  const expMs = Date.now() + 60 * 60 * 1000;

  // Gravar token na aba RESET_TOKENS (cria aba se não existir)
  try {
    await garantirAbaComCabecalhos('RESET_TOKENS', ['TOKEN','USUARIO','EMAIL','EXP','USADO']);
    await appendObjeto('RESET_TOKENS', {
      TOKEN: token,
      USUARIO: usuario.USUARIO || usuario.EMAIL,
      EMAIL: usuario.EMAIL,
      EXP: new Date(expMs).toISOString(),
      USADO: 'NAO',
    });
  } catch(e) {
    console.error('[forgot-password] erro ao gravar token:', e.message);
    return res.status(500).json({sucesso:false, erro:'Erro interno ao gerar token.'});
  }

  const link = `${APP_URL}/#reset-password?token=${token}`;
  try {
    await _resend.emails.send({
      from: EMAIL_FROM,
      to: usuario.EMAIL,
      subject: 'Redefinição de senha — SAC Grupo Chiacchio',
      html: `
        <p>Olá, <strong>${usuario.NOME||usuario.USUARIO}</strong>.</p>
        <p>Recebemos uma solicitação de redefinição de senha para sua conta no <strong>Assistente SAC</strong>.</p>
        <p><a href="${link}" style="background:#c8571a;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;display:inline-block;margin:12px 0">Redefinir minha senha</a></p>
        <p>Este link é válido por <strong>1 hora</strong>. Se você não solicitou a redefinição, ignore este e-mail.</p>
        <hr style="margin:20px 0;border:none;border-top:1px solid #eee">
        <p style="color:#999;font-size:12px">SAC Grupo Chiacchio — sistema interno</p>
      `,
    });
    await registrarAuditoria(login,'EMAIL_RESET_ENVIADO',null,'AUTH',null,{email:usuario.EMAIL});
  } catch(e) {
    console.error('[forgot-password] erro ao enviar e-mail:', e.message);
    return res.status(500).json({sucesso:false, erro:'Erro ao enviar e-mail. Tente novamente.'});
  }

  res.json({sucesso:true, mensagem: MSG_OK});
});

app.post('/api/auth/reset-password', async (req,res)=>{
  const { token, novaSenha } = req.body || {};
  if (!token || !novaSenha) return res.status(400).json({sucesso:false, erro:'Token e nova senha são obrigatórios.'});
  if (novaSenha.length < 6) return res.status(400).json({sucesso:false, erro:'Senha deve ter ao menos 6 caracteres.'});

  let tokens = [];
  try { tokens = await lerAba('RESET_TOKENS', 1000); } catch(e) {}
  const registro = tokens.find(t => t.TOKEN === token && t.USADO === 'NAO');
  if (!registro) return res.status(400).json({sucesso:false, erro:'Token inválido ou já utilizado.'});
  if (Date.now() > new Date(registro.EXP).getTime()) return res.status(400).json({sucesso:false, erro:'Token expirado. Solicite um novo link.'});

  // Hash da nova senha com bcrypt
  const hash = await hashSenha(novaSenha);

  // Atualizar senha do usuário
  try {
    await atualizarPorID('USUARIOS', registro.USUARIO, {SENHA: hash, SENHA_HASH: hash}, ['USUARIO','EMAIL']);
  } catch(e) {
    return res.status(500).json({sucesso:false, erro:'Erro ao atualizar senha.'});
  }

  // Marcar token como usado e invalidar cache imediatamente (impede reutilização em janela de 60s)
  try {
    await atualizarPorID('RESET_TOKENS', token, {USADO:'SIM'}, ['TOKEN']);
    invalidarCacheAba('RESET_TOKENS');
  } catch(e) { /* não crítico */ }

  await registrarAuditoria(registro.USUARIO,'SENHA_REDEFINIDA_VIA_TOKEN',null,'AUTH',null,{});
  res.json({sucesso:true, mensagem:'Senha redefinida com sucesso. Faça login com a nova senha.'});
});

// ===== ANÁLISE IA =====
app.post('/api/analise', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR'), async (req, res) => {
  try {
    const { descricao, tipo, empresaReclamada, empresaReclamante, produto, lote } = req.body;
    if (!descricao) return res.status(400).json({ sucesso: false, erro: 'Descrição é obrigatória.' });
    const analise = await executarAnalise({ descricao, tipo, empresaReclamada, empresaReclamante, produto, lote });
    // A ferramenta "se alimenta" das avaliações: anexa aprendizado do histórico de assertividade
    try {
      const rowsAssert = await lerAba('ASSERTIVIDADE_IA', 2000).catch(() => []);
      const setorSug = analise.setorSugerido || (Array.isArray(analise.setores) ? analise.setores[0] : '') || analise.setor || '';
      const causaSug = analise.causaProvavel || analise.causaRaiz || analise.causa || '';
      analise.aprendizado = assertividadeService.aprendizadoPorContexto(rowsAssert, { setor: setorSug, causa: causaSug, tipo });
    } catch (_) {}
    res.json({ sucesso: true, analise });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

app.post('/api/analise/similares', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req, res) => {
  try {
    // B2/Item11: isolar similares por empresa do usuário autenticado
    const empresaFiltro = req.user?.empresa || null;
    const similares = await cerebroService.buscarCasosSimilares(req.body || {}, Number(req.body?.limite || 8), empresaFiltro);
    res.json({ sucesso:true, total:similares.length, itens:similares });
  } catch(e) {
    res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] });
  }
});

// ===== PORTAL RCA =====
app.get('/api/representantes/meus-clientes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const rows=await lerAba('CLIENTES_REPRESENTANTES',5000).catch(()=>[]);
    const key=normalizarTexto(req.user.codigoRCA||req.user.usuario);
    const itens=rows.filter(x=>normalizarTexto(x.ID_REPRESENTANTE||x.CODIGO_RCA||x.RCA)===key);
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.get('/api/representantes/minhas-manifestacoes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const rows=await lerAba('MANIFESTACOES',5000);
    const key=normalizarTexto(req.user.codigoRCA||req.user.usuario);
    const itens=rows.filter(x=>normalizarTexto(x.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(x.CODIGO_RCA||'')===key);
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.post('/api/representantes/manifestacoes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const b=req.body||{};
    if(!b.clienteId||!b.descricao) return res.status(400).json({sucesso:false,erro:'Cliente e descrição são obrigatórios.'});
    const id=await gerarProximoID('MANIFESTACOES','MAN','ID_MANIFESTACAO');
    const agora=new Date().toISOString();
    const objeto={ID_MANIFESTACAO:id,DATA_ABERTURA:agora,DATA_REGISTRO:agora,EMPRESA_RECLAMANTE:b.empresa||req.user.empresa||'',CONTATO:b.contato||'',PRODUTO:b.produto||'',LOTE:b.lote||'',NFE:b.nfe||'',DESCRICAO:b.descricao,DESCRICAO_MANIFESTACAO:b.descricao,STATUS:'RECEBIDA',TIPO:'Reclamação',CANAL:'RCA',CNPJ:b.cnpj||'',TELEFONE:b.telefone||'',EMAIL:b.email||'',QUANTIDADE:b.quantidade||'',EMPRESA_RECLAMADA:b.empresaReclamada||'',AREA_RECLAMACAO:b.areaReclamacao||'',EVIDENCIA_NC:b.evidenciaNC||'NÃO SEI',CODIGO_RCA:req.user.codigoRCA||'',USUARIO_CRIACAO:req.user.usuario,ORIGEM:'REPRESENTANTE',STATUS_TRATATIVA:'NÃO INICIADA'};
    await appendObjeto('MANIFESTACOES',objeto);
    res.json({sucesso:true,id});
  }catch(e){console.error(e);res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// ===== MANIFESTAÇÕES =====
// Agregação do dashboard feita no Postgres (COUNT/GROUP BY) — instantâneo mesmo com milhares.
app.get('/api/dashboard-resumo', requerPermissao('dashboard.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    if (manifestacaoRepo && typeof manifestacaoRepo.aggregateDashboard === 'function') {
      const _isMaster = perfilCanonico(req.user?.perfil) === 'MASTER';
      const empresaId = _isMaster ? null : await resolverEmpresaIdScope(req.user?.empresa);
      const agg = await manifestacaoRepo.aggregateDashboard({ empresaId });
      return res.json({ sucesso: true, fonte: 'postgresql', ...agg });
    }
    return res.status(503).json({ sucesso: false, erro: 'Agregação Postgres indisponível (rode em modo PG).' });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.get('/api/manifestacoes', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    let data = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    if (req.user && perfilCanonico(req.user.perfil)==='RCA / REPRESENTANTE') {
      const rca=normalizarTexto(req.user.codigoRCA||req.user.usuario);
      data=data.filter(r=>normalizarTexto(r.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(r.CODIGO_RCA||'')===rca||normalizarTexto(r.RCA||'')===rca);
    }
    // B2: legado sem empresa = global; com empresa = apenas daquela empresa
    data = filtrarPorEmpresaHistorico(data, req, COLUNA_EMPRESA_ABA.MANIFESTACOES);
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e), dados: [] }); }
});

app.get('/api/manifestacoes/:id', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    const item = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    // B2: verificar escopo de empresa
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, item.EMPRESA_RECLAMADA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta manifestação.' });
    }
    res.json({ sucesso: true, manifestacao: item });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/manifestacoes', requerPermissao('manifestacoes.abrir'), async (req, res) => {
  try {
    const { empresaReclamada, empresaReclamante, contato, produto, lote, nfe, descricao, tipo, canal, cnpj, telefone, email, quantidade, valor, usuario, anexos = [], origemDocumento = '', arquivoOrigem = '' } = req.body;
    if (!empresaReclamante || !descricao) return res.status(400).json({ sucesso:false, erro:'Empresa reclamante e descrição são obrigatórios.' });
    const empNorm = normalizarEmpresa(empresaReclamada);
    // Não bloqueia na criação de colunas — a aba já existe em produção
    // RNC_SINALIZADO: campo novo para indicar que o caso merece revisão de RNC (B6)
    garantirAbaComCabecalhos('MANIFESTACOES',['ID_MANIFESTACAO','DATA_ABERTURA','DATA_REGISTRO','EMPRESA_RECLAMANTE','CONTATO','PRODUTO','LOTE','NFE','DESCRICAO','DESCRICAO_MANIFESTACAO','STATUS','TIPO','TIPO_SUGERIDO','SETOR_SUGERIDO','SETORES_SUGERIDOS','PROCEDIMENTO_SUGERIDO','SLA_HORAS','PRIORIDADE','RNC_SUGERIDO','RNC_SINALIZADO','EMPRESA_RECLAMADA','CANAL','CNPJ','TELEFONE','EMAIL','QUANTIDADE','VALOR','TRATATIVA_SUGERIDA','TRATATIVA_APLICAVEL','TRATATIVA_REALIZADA','STATUS_TRATATIVA','DEVOLUTIVA_SUGERIDA','DEVOLUTIVA_FINAL','DEVOLUTIVA_ENVIADA','ORIGEM_DOCUMENTO','ARQUIVO_ORIGEM','USUARIO_CRIACAO','ORIGEM','TIPO_CONFIRMADO','SETORES_CONFIRMADOS','ID_PROCEDIMENTO_APLICADO','GERA_RNC','DATA_INICIO_TRATATIVA','DATA_CONCLUSAO_TRATATIVA','DATA_DEVOLUTIVA','DATA_CONCLUSAO_MANIFESTACAO','STATUS_FICHA','PROCEDENTE','PROCEDENTE_JUSTIFICATIVA','CAMINHO_TRATATIVA','DATA_ENCAMINHAMENTO','PRAZO_RETORNO_SAC','TRATATIVA_SAC_INTERNA','RESP_SETOR_O_QUE','RESP_SETOR_CAUSA','RESP_SETOR_RESOLUCAO','RESP_SETOR_ACAO_PREV','RESP_SETOR_RESPONSAVEL','RESP_SETOR_PRAZO','DATA_RESPOSTA_SETOR','APROV_SETOR_DECISAO','APROV_SETOR_MOTIVO','APROV_SETOR_ORIENTACAO','VALID_SAC_DATA_RETORNO','VALID_SAC_CLIENTE_INFORMADO','VALID_SAC_RESOLVIDA','OBSERVACOES_FINAIS','DATA_VALIDACAO_SAC']).catch(()=>{});
    const id = await gerarProximoID('MANIFESTACOES','MAN','ID_MANIFESTACAO');
    const agora = new Date().toISOString();
    const tipoFinal = tipo || 'Reclamação';
    const objeto = {
      ID_MANIFESTACAO:id, DATA_ABERTURA:agora, DATA_REGISTRO:agora, EMPRESA_RECLAMANTE:empresaReclamante,
      CONTATO:contato||'', PRODUTO:produto||'', LOTE:lote||'', NFE:nfe||'', DESCRICAO:descricao,
      DESCRICAO_MANIFESTACAO:descricao, STATUS:'EM ANÁLISE', TIPO:tipoFinal, TIPO_SUGERIDO:'',
      SETOR_SUGERIDO:'', SETORES_SUGERIDOS:'', PROCEDIMENTO_SUGERIDO:'', SLA_HORAS:'', PRIORIDADE:'',
      RNC_SUGERIDO:'NÃO', EMPRESA_RECLAMADA:empNorm||empresaReclamada||'', CANAL:canal||'',
      CNPJ:cnpj||'', TELEFONE:telefone||'', EMAIL:email||'', QUANTIDADE:quantidade||'', VALOR:valor||'',
      TRATATIVA_SUGERIDA:'', TRATATIVA_APLICAVEL:'', TRATATIVA_REALIZADA:'', STATUS_TRATATIVA:'NÃO INICIADA',
      DEVOLUTIVA_SUGERIDA:'', DEVOLUTIVA_FINAL:'', DEVOLUTIVA_ENVIADA:'',
      ORIGEM_DOCUMENTO:origemDocumento||'', ARQUIVO_ORIGEM:arquivoOrigem||'',
      USUARIO_CRIACAO:usuario||req.user?.usuario||'sistema', ORIGEM:req.body.origem||'SAC',
      STATUS_FICHA:req.body.statusFicha||'ABERTA',
      PROCEDENTE:req.body.procedente||'',
      PROCEDENTE_JUSTIFICATIVA:req.body.procedenteJustificativa||'',
      CAMINHO_TRATATIVA:req.body.caminhoTratativa||'',
      DATA_ENCAMINHAMENTO:req.body.dataEncaminhamento||'',
      PRAZO_RETORNO_SAC:req.body.prazoRetornoSAC||'72 horas',
      TRATATIVA_SAC_INTERNA:req.body.tratativaSACInterna||'',
    };
    await appendObjeto('MANIFESTACOES', objeto).catch(e => {
      console.error('[MANIFESTACOES][appendObjeto] FALHOU:', e.message, e?.stack);
      throw e;
    });
    registrarAuditoria(usuario||'sistema','CRIOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,{empresaReclamante,tipo:tipoFinal}).catch(()=>{});
    // Executar análise de IA de forma síncrona antes de responder
    // (setImmediate não funciona em Vercel serverless)
    const decisaoCompleta = req.body.decisaoCompleta;
    let analise = null;
    try {
      analise = await executarAnalise({ ...objeto, empresaReclamante, empresaReclamada, descricao, tipo:tipoFinal });
      if (analise) {
        await atualizarPorID('MANIFESTACOES', id, {
          TIPO_SUGERIDO:analise.tipoDetectado||analise.tipoSugerido||'',
          SETOR_SUGERIDO:Array.isArray(analise.setores)?analise.setores[0]||'':analise.setoresSugeridos?.[0]||'',
          SETORES_SUGERIDOS:Array.isArray(analise.setores)?analise.setores.join(', '):(analise.setoresSugeridos||[]).join(', '),
          PROCEDIMENTO_SUGERIDO:analise.procedimentoSugerido?.nome||'',
          SLA_HORAS:Number(analise.slaHoras)||72, PRIORIDADE:analise.prioridade||'',
          // B6: RNC_SUGERIDO sempre NÃO — RNC só por decisão humana explícita
          RNC_SUGERIDO:'NÃO', RNC_SINALIZADO:analise.rncSinalizado?'REVISAR':'', TRATATIVA_SUGERIDA:analise.tratativaSugerida?.sugestao||'',
          DEVOLUTIVA_SUGERIDA:analise.devolutivaSugerida||'', STATUS:'AGUARDANDO_DECISÃO'
        }).catch(()=>{});
      }
      if (decisaoCompleta && decisaoCompleta.tipo) {
        const tipoDecisao = decisaoCompleta.tipo;
        const df = decisaoCompleta.decisaoFinal || {};
        let novoStatus = 'AGUARDANDO_DECISÃO';
        if (tipoDecisao === 'rejeitada') novoStatus = 'REJEITADA';
        else if (tipoDecisao === 'aceita' || tipoDecisao === 'editada') novoStatus = 'EM TRATAMENTO';
        await atualizarPorID('MANIFESTACOES', id, {
          STATUS: novoStatus,
          TIPO_CONFIRMADO: df.tipo || analise?.tipoDetectado || '',
          SETOR_CONFIRMADO: df.setor || (Array.isArray(analise?.setores) ? analise.setores[0] : '') || '',
          TRATATIVA_REALIZADA: df.tratativa || '',
          DEVOLUTIVA_FINAL: df.devolutiva || '',
          CAUSA_PROVAVEL: df.causa || '',
          DECISAO_ANALISTA: tipoDecisao,
        }).catch(() => {});
      }
    } catch (e) { console.error('Falha na análise automática:', e.message); }
    res.json({ sucesso:true, id, analise, mensagem:'Manifestação registrada e analisada com sucesso.' });
  } catch (e) {
    console.error('[POST /api/manifestacoes] ERRO:', e?.message, e?.response?.status, e?.stack?.split('\n')[1]);
    const status = e?.response?.status || e?.code;
    const msgClara = status === 429
      ? 'Limite de requisições ao Google Sheets atingido. Aguarde alguns segundos e tente novamente.'
      : status === 403
      ? 'Sem permissão para gravar na planilha. Verifique as credenciais da conta de serviço.'
      : erroSeguro(e);
    res.status(500).json({ sucesso:false, erro: msgClara });
  }
});

// Ficha de encaminhamento — atualização por seção
app.patch('/api/manifestacoes/:id/ficha', requerPermissao('manifestacoes.editar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { acao } = req.body;
    const todas = await lerAba('MANIFESTACOES', 5000);
    const item = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, item.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado para esta manifestação.' });
    }
    const agora = new Date().toISOString();
    let dados = {};
    if (acao === 'resposta_setor') {
      dados = {
        RESP_SETOR_O_QUE: req.body.respSetorOQue || '',
        RESP_SETOR_CAUSA: req.body.respSetorCausa || '',
        RESP_SETOR_RESOLUCAO: req.body.respSetorResolucao || '',
        RESP_SETOR_ACAO_PREV: req.body.respSetorAcaoPrev || '',
        RESP_SETOR_RESPONSAVEL: req.body.respSetorResponsavel || '',
        RESP_SETOR_PRAZO: req.body.respSetorPrazo || '',
        DATA_RESPOSTA_SETOR: agora,
        STATUS_FICHA: 'EM_ANDAMENTO',
      };
    } else if (acao === 'aprovacao_setor') {
      const decisao = req.body.aprovDecisao;
      if (!['OK','NAO_ACEITO'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
      dados = {
        APROV_SETOR_DECISAO: decisao,
        APROV_SETOR_MOTIVO: req.body.aprovMotivo || '',
        APROV_SETOR_ORIENTACAO: req.body.aprovOrientacao || '',
      };
    } else if (acao === 'validacao_sac') {
      dados = {
        VALID_SAC_DATA_RETORNO: req.body.validDataRetorno || '',
        VALID_SAC_CLIENTE_INFORMADO: req.body.validClienteInformado || '',
        VALID_SAC_RESOLVIDA: req.body.validResolvida || '',
        OBSERVACOES_FINAIS: req.body.observacoesFinais || '',
        DATA_VALIDACAO_SAC: agora,
        STATUS_FICHA: 'FECHADA',
        STATUS: 'ENCERRADA',
        DATA_CONCLUSAO_MANIFESTACAO: agora,
      };
    } else if (acao === 'encaminhar_aprovacao') {
      dados = {
        STATUS_FICHA: 'AGUARDANDO_APROVACAO',
        TRATATIVA_SAC_INTERNA: req.body.tratativaSACInterna || item.TRATATIVA_SAC_INTERNA || '',
        DATA_ENCAMINHAMENTO: agora,
        ENCAMINHADO_POR: req.user?.usuario || '',
      };
    } else {
      return res.status(400).json({ sucesso:false, erro:'Ação não reconhecida.' });
    }
    await atualizarPorID('MANIFESTACOES', id, dados, ['ID_MANIFESTACAO']);
    invalidarCacheAba('MANIFESTACOES');
    res.json({ sucesso:true });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});


// ============================================================
// CARD DE APROVAÇÃO SAC
// GET  /api/manifestacoes/:id/aprovacao — retorna dados filtrados por perfil
// POST /api/manifestacoes/:id/aprovacao — grava decisão e muda status
// ============================================================

const STATUS_FICHA_LEGIVEL = {
  ABERTA: 'Aberta', EM_ANDAMENTO: 'Em andamento', AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  AGUARDANDO_DEVOLUTIVA: 'Aguardando devolutiva', TRATATIVA_SAC: 'Em tratativa SAC', FECHADA: 'Fechada',
};
const DECISAO_APROVACAO_VALIDAS = ['APROVAR', 'SEGUIR_TRATATIVA', 'DEVOLVER'];

function formatarDataBrasilia(isoStr) {
  if (!isoStr) return '';
  try {
    return new Date(isoStr).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return isoStr; }
}

app.get('/api/manifestacoes/:id/aprovacao', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const todas = await lerAba('MANIFESTACOES', 5000);
    const item = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, item.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso negado: manifestação pertence a outra empresa.' });
    }
    const perfil = perfilCanonico(req.user?.perfil);
    // Apenas APROVADOR setorial é bloqueado pelo STATUS_FICHA
    // APROVADOR MASTER, MASTER, GESTOR SAC e ANALISTA SAC têm acesso irrestrito
    if (perfil === 'APROVADOR' && item.STATUS_FICHA !== 'AGUARDANDO_APROVACAO') {
      return res.status(403).json({ sucesso:false, erro:'Esta manifestação não está aguardando aprovação do setor.' });
    }
    // Calcular SLA restante
    // Failsafe: sem data de abertura nem registro, marcar como VENCIDO em vez de usar Date.now() (falso positivo)
    const _dataAberturaRaw = item.DATA_ABERTURA || item.DATA_REGISTRO;
    const abertura = _dataAberturaRaw ? new Date(_dataAberturaRaw) : null;
    const slaHoras = Number(item.SLA_HORAS || 72);
    // Se abertura é null (data desconhecida), adotar postura conservadora: SLA vencido
    const prazoMs = abertura ? abertura.getTime() + slaHoras * 3600000 : null;
    const restMs = prazoMs !== null ? prazoMs - Date.now() : -1;
    const restH = prazoMs !== null ? Math.round(restMs / 3600000) : null;
    const vence = prazoMs !== null ? formatarDataBrasilia(new Date(prazoMs).toISOString()) : 'data desconhecida';
    const slaLabel = restH === null
      ? 'SLA vencido (data desconhecida)'
      : restH > 0
        ? `${restH}h restantes (${slaHoras}h SLA)`
        : `SLA vencido há ${Math.abs(restH)}h`;
    const slaPrazo = restH === null
      ? 'Vencido · data desconhecida'
      : restH > 0
        ? `${restH}h · vence em ${vence}`
        : `Venceu em ${vence}`;

    const card = {
      idManifestacao: item.ID_MANIFESTACAO,
      protocolo: item.ID_MANIFESTACAO,
      statusFicha: item.STATUS_FICHA || 'ABERTA',
      statusFichaLegivel: STATUS_FICHA_LEGIVEL[item.STATUS_FICHA] || item.STATUS_FICHA || 'Aberta',
      status: item.STATUS || '',
      // Dados enriquecidos para o card visual
      sla: slaLabel,
      slaPrazo,
      sub: [item.EMPRESA_RECLAMANTE || item.CONTATO, item.EMPRESA_RECLAMADA, item.TIPO, item.PRIORIDADE ? `Prioridade ${(item.PRIORIDADE||'').toLowerCase()}` : null].filter(Boolean).join(' · '),
      dataRegistro: formatarDataBrasilia(item.DATA_REGISTRO || item.DATA_ABERTURA),
      nomeCliente: item.EMPRESA_RECLAMANTE || item.CONTATO || '',
      empresa: item.EMPRESA_RECLAMADA || '',
      tipoManifestacao: item.TIPO || '',
      motivoManifestacao: item.DESCRICAO || item.DESCRICAO_MANIFESTACAO || '',
      caminhoTratativa: item.CAMINHO_TRATATIVA || '',
      tratativaSACInterna: item.TRATATIVA_SAC_INTERNA || '',
      tratativaSugerida: item.TRATATIVA_SUGERIDA || '',
      procedente: item.PROCEDENTE || '',
      procedenteJustificativa: item.PROCEDENTE_JUSTIFICATIVA || '',
      setor: item.SETOR_SUGERIDO || item.SETORES_CONFIRMADOS || '',
      respSetorOQue: item.RESP_SETOR_O_QUE || '',
      respSetorCausa: item.RESP_SETOR_CAUSA || '',
      respSetorResolucao: item.RESP_SETOR_RESOLUCAO || '',
      respSetorResponsavel: item.RESP_SETOR_RESPONSAVEL || '',
      dataRespostaSetor: formatarDataBrasilia(item.DATA_RESPOSTA_SETOR),
      aprovSetorDecisao: item.APROV_SETOR_DECISAO || '',
      aprovSetorMotivo: item.APROV_SETOR_MOTIVO || '',
      aprovSetorOrientacao: item.APROV_SETOR_ORIENTACAO || '',
      // Campos extras para o card
      campos: [
        { l: 'CLIENTE',        v: item.EMPRESA_RECLAMANTE || item.CONTATO || '—', fw: '600' },
        { l: 'EMPRESA',        v: item.EMPRESA_RECLAMADA || '—', fw: '400' },
        { l: 'PRODUTO / LOTE', v: [item.PRODUTO, item.LOTE].filter(Boolean).join(' · ') || '—', fw: '400' },
        { l: 'NOTA FISCAL',    v: item.NFE || '—', fw: '400' },
        { l: 'ABERTURA',       v: formatarDataBrasilia(item.DATA_ABERTURA || item.DATA_REGISTRO), fw: '400' },
        { l: 'RESPONSÁVEL SAC',v: item.USUARIO_CRIACAO || '—', fw: '400' },
      ].filter(c => c.v !== '—'),
    };
    res.json({ sucesso:true, card });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/aprovacao', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { decisao, motivo, orientacao } = req.body || {};
    if (!DECISAO_APROVACAO_VALIDAS.includes(decisao)) {
      return res.status(400).json({ sucesso:false, erro:'Decisão inválida. Use: APROVAR, SEGUIR_TRATATIVA ou DEVOLVER.' });
    }
    if (decisao === 'DEVOLVER' && !motivo?.trim()) {
      return res.status(422).json({ sucesso:false, erro:'Motivo obrigatório ao devolver para ajuste.' });
    }
    const todas = await lerAba('MANIFESTACOES', 5000);
    const item = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, item.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso negado: manifestação pertence a outra empresa.' });
    }
    const perfil = perfilCanonico(req.user?.perfil);
    // Bloquear autoaprovação: quem encaminhou para aprovação não pode aprovar
    if (item.ENCAMINHADO_POR && normalizarTexto(item.ENCAMINHADO_POR) === normalizarTexto(req.user?.usuario || '')) {
      return res.status(403).json({ sucesso:false, erro:'Autoaprovação não permitida. Você não pode aprovar uma manifestação que você mesmo encaminhou para aprovação.' });
    }
    // Apenas APROVADOR setorial é bloqueado pelo STATUS_FICHA
    // APROVADOR MASTER, MASTER, GESTOR SAC e ANALISTA SAC aprovam sem restrição de status
    if (perfil === 'APROVADOR' && item.STATUS_FICHA !== 'AGUARDANDO_APROVACAO') {
      return res.status(403).json({ sucesso:false, erro:'Esta manifestação não está aguardando aprovação do setor.' });
    }
    const agora = new Date().toISOString();
    let novoStatusFicha, novoStatus;
    if (decisao === 'APROVAR' || decisao === 'SEGUIR_TRATATIVA') {
      novoStatusFicha = 'AGUARDANDO_DEVOLUTIVA';
      novoStatus = 'AGUARDANDO_DEVOLUTIVA';
    } else { // DEVOLVER
      novoStatusFicha = 'TRATATIVA_SAC';
      novoStatus = item.STATUS || 'EM ANÁLISE';
    }
    await garantirAbaComCabecalhos('MANIFESTACOES', ['ID_MANIFESTACAO','STATUS_FICHA','APROV_SETOR_DECISAO','APROV_SETOR_MOTIVO','APROV_SETOR_ORIENTACAO','DATA_APROVACAO_SETOR','APROVADOR_USUARIO','STATUS','ENCAMINHADO_POR']).catch(()=>{});
    const _DECISAO_PASSADO = { APROVAR: 'APROVADO', DEVOLVER: 'DEVOLVIDO', SEGUIR_TRATATIVA: 'APROVADO', RESSALVA: 'APROVADO' };
    const decisaoGravada = _DECISAO_PASSADO[decisao] || decisao;
    await atualizarPorID('MANIFESTACOES', id, {
      STATUS_FICHA: novoStatusFicha,
      STATUS: novoStatus,
      APROV_SETOR_DECISAO: decisaoGravada,
      APROV_SETOR_MOTIVO: motivo || '',
      APROV_SETOR_ORIENTACAO: orientacao || '',
      DATA_APROVACAO_SETOR: agora,
      APROVADOR_USUARIO: req.user?.usuario || '',
    }, ['ID_MANIFESTACAO']);
    invalidarCacheAba('MANIFESTACOES');
    await registrarAuditoria(req.user?.usuario || 'sistema', 'APROVACAO_SAC_' + decisao, id, 'MANIFESTACOES', item.STATUS_FICHA, { novoStatusFicha, decisao, motivo: motivo || '', orientacao: orientacao || '' });
    const agoraBr = formatarDataBrasilia(agora);
    const aprovador = req.user?.nome || req.user?.usuario || 'Aprovador';
    const MSG = {
      APROVAR:          'Aprovação registrada. O SAC foi notificado para enviar a devolutiva.',
      SEGUIR_TRATATIVA: 'Confirmado. A tratativa segue como proposta pelo SAC.',
      DEVOLVER:         'Manifestação devolvida para ajuste. O SAC receberá sua orientação.',
    };
    res.json({
      sucesso: true,
      id,
      decisao,
      statusFicha: novoStatusFicha,
      statusFichaLegivel: STATUS_FICHA_LEGIVEL[novoStatusFicha] || novoStatusFicha,
      mensagem: MSG[decisao] || 'Decisão registrada.',
      data: agoraBr,
      aprovador,
    });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});


app.patch('/api/manifestacoes/:id', requerPermissao('manifestacoes.editar'), async (req, res) => {
  try {
    const { id } = req.params;
    // B2/Item18: verificar pertencimento de empresa antes de gravar
    const todas = await lerAba('MANIFESTACOES', 5000);
    const itemExistente = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!itemExistente) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, itemExistente.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso negado: manifestação pertence a outra empresa.' });
    }
    const STATUS_VALIDOS = ['EM ANÁLISE','AGUARDANDO_DECISÃO','EM TRATAMENTO','AGUARDANDO_DEVOLUTIVA','ENCERRADA','REJEITADA','APROVADA'];
    const dados = {};
    const { status, tratativa, devolutiva, setor, responsavel, observacoes } = req.body || {};
    if (status) {
      if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ sucesso:false, erro:`Status inválido: ${status}` });
      dados.STATUS = status;
      if (status === 'ENCERRADA') { dados.DATA_ENCERRAMENTO = new Date().toISOString(); dados.ENCERRADA_POR = req.user?.usuario||'sistema'; }
    }
    if (tratativa !== undefined) dados.TRATATIVA_REALIZADA = tratativa;
    if (devolutiva !== undefined) {
      // REQUER_APROVACAO: se a regra da MATRIZ_TRATAMENTO exige aprovação para este
      // tipo/causa, bloquear envio direto e exigir fluxo de aprovação.
      const tipo  = itemExistente.TIPO  || itemExistente.TIPO_CONFIRMADO || '';
      const causa = itemExistente.CAUSA || itemExistente.CAUSA_CONFIRMADA || '';
      const empresa = itemExistente.EMPRESA_RECLAMADA || '';
      const matrizRows = await lerAba('MATRIZ_TRATAMENTO', 5000).catch(() => []);
      const regra = matrizRows.find(r =>
        r.ATIVO !== 'NAO' &&
        (!r.TIPO_MANIFESTACAO || r.TIPO_MANIFESTACAO.trim().toLowerCase() === tipo.trim().toLowerCase()) &&
        (!r.CAUSA            || r.CAUSA.trim().toLowerCase()            === causa.trim().toLowerCase()) &&
        (!r.EMPRESA          || r.EMPRESA === 'TODAS' || r.EMPRESA.trim().toLowerCase() === empresa.trim().toLowerCase())
      );
      if (regra && String(regra.REQUER_APROVACAO).trim().toUpperCase() === 'SIM' && status === 'ENCERRADA') {
        return res.status(409).json({
          sucesso: false,
          requerAprovacao: true,
          erro: 'Esta manifestação requer aprovação antes do envio da devolutiva ao cliente. Use o fluxo "Para aprovação".',
        });
      }
      dados.DEVOLUTIVA_FINAL = devolutiva; dados.DEVOLUTIVA_ENVIADA = devolutiva;
    }
    if (setor !== undefined) dados.SETOR_CONFIRMADO = setor;
    if (responsavel !== undefined) dados.RESPONSAVEL = responsavel;
    if (!Object.keys(dados).length) return res.status(400).json({ sucesso:false, erro:'Nenhum campo para atualizar.' });
    await atualizarPorID('MANIFESTACOES', id, dados);
    // Dual-write Postgres: reflete a edição no banco estruturado (status/tratativa/devolutiva/responsável)
    if (manifestacaoRepo) {
      try {
        const pg = (await manifestacaoRepo.findByProtocolo(id).catch(() => null))
                || (await manifestacaoRepo.findByIdOriginal(id).catch(() => null));
        if (pg) {
          const pgData = {};
          if (dados.STATUS !== undefined) pgData.status = dados.STATUS;
          if (dados.DATA_ENCERRAMENTO !== undefined) pgData.dataEncerramento = dados.DATA_ENCERRAMENTO ? new Date(dados.DATA_ENCERRAMENTO) : null;
          let setorId = pg.setorId || null;
          if (dados.SETOR_CONFIRMADO && typeof manifestacaoRepo.resolverSetorId === 'function') {
            const sid = await manifestacaoRepo.resolverSetorId(pg.empresaId, dados.SETOR_CONFIRMADO);
            if (sid) { pgData.setorId = sid; setorId = sid; }
          }
          if (dados.RESPONSAVEL && setorId && typeof manifestacaoRepo.resolverResponsavelId === 'function') {
            const rid = await manifestacaoRepo.resolverResponsavelId(setorId, dados.RESPONSAVEL);
            if (rid) pgData.responsavelId = rid;
          }
          if (Object.keys(pgData).length) await manifestacaoRepo.update(pg.id, pgData);
          // Tratativa e devolutiva viram linhas nas tabelas próprias
          if (dados.TRATATIVA_REALIZADA && typeof manifestacaoRepo.criarTratativa === 'function') {
            await manifestacaoRepo.criarTratativa(pg.id, dados.TRATATIVA_REALIZADA, { setorId });
          }
          if ((dados.DEVOLUTIVA_FINAL || dados.DEVOLUTIVA_ENVIADA) && typeof manifestacaoRepo.criarDevolutiva === 'function') {
            await manifestacaoRepo.criarDevolutiva(pg.id, dados.DEVOLUTIVA_FINAL || dados.DEVOLUTIVA_ENVIADA);
          }
        }
      } catch (e) { console.warn('[PG] dual-write update manifestacao falhou:', e.message); }
    }
    await registrarAuditoria(req.user?.usuario||'sistema','ATUALIZOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,dados);
    res.json({ sucesso:true, id, atualizado: dados });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.delete('/api/manifestacoes/:id', requerPermissao('manifestacoes.excluir'), async (req, res) => {
  try {
    const { id } = req.params;
    const todas = await lerAba('MANIFESTACOES', 5000);
    const item = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    await deletarLinhaPorID('MANIFESTACOES', id);
    // Remove do PG também, se existir
    if (manifestacaoRepo) {
      try {
        const pg = (await manifestacaoRepo.findByProtocolo(id).catch(() => null))
                || (await manifestacaoRepo.findByIdOriginal(id).catch(() => null));
        if (pg && typeof manifestacaoRepo.deletar === 'function') await manifestacaoRepo.deletar(pg.id);
      } catch (e) { console.warn('[PG] deletar manifestacao falhou:', e.message); }
    }
    await registrarAuditoria(req.user?.usuario || 'sistema', 'EXCLUIU_MANIFESTAÇÃO', id, 'MANIFESTACOES', item, null);
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/decisao', requerPermissao('manifestacoes.aprovar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tipoConfirmado, setoresConfirmados, procedimentoUsado, prioridade, slaHoras, geraRNC, observacoes, usuario, decisaoStatus, tratativaAplicavel, tratativaRealizada, dataInicioTratativa, dependeOutroSetor, setoresDependentes, dataAcionamentoSetor, prazoSetorSolicitado, dataRetornoSetor, statusTratativa, dataConclusaoTratativa, devolutivaFinal, devolutivaEnviada } = req.body;
    if (!usuario) return res.status(400).json({ sucesso:false, erro:'Usuário é obrigatório.' });
    const data = await lerAba('MANIFESTACOES',5000);
    const item = data.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    // B2/Item18: verificar pertencimento de empresa antes de gravar decisão
    if (!pertenceEmpresa(req.user?.empresa, item.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso negado: manifestação pertence a outra empresa.' });
    }
    const agora = new Date().toISOString();
    const setoresStr = Array.isArray(setoresConfirmados) ? setoresConfirmados.join(', ') : (setoresConfirmados || '');
    const depStr = Array.isArray(setoresDependentes) ? setoresDependentes.join(', ') : (setoresDependentes || '');
    const status = statusTratativa || (tratativaAplicavel === 'NÃO' ? 'NÃO APLICÁVEL' : (dataConclusaoTratativa ? 'CONCLUÍDA' : (dependeOutroSetor === 'SIM' && !dataRetornoSetor ? 'AGUARDANDO OUTRO SETOR' : (dataInicioTratativa ? 'EM ANDAMENTO' : 'NÃO INICIADA'))));
    const novoStatus = decisaoStatus === 'APROVADA' ? 'EM TRATAMENTO' : (decisaoStatus === 'REJEITADA' ? 'REJEITADA' : 'EM TRATAMENTO');
    await atualizarPorID('MANIFESTACOES', id, {
      TIPO:tipoConfirmado||item.TIPO||'', TIPO_CONFIRMADO:tipoConfirmado||'',
      SETOR_SUGERIDO:setoresStr, SETORES_CONFIRMADOS:setoresStr,
      ID_PROCEDIMENTO_APLICADO:procedimentoUsado||'', PRIORIDADE:prioridade||item.PRIORIDADE||'',
      SLA_HORAS:slaHoras||item.SLA_HORAS||'', GERA_RNC:geraRNC||'NÃO', STATUS:novoStatus,
      TRATATIVA_APLICAVEL:tratativaAplicavel||'', TRATATIVA_REALIZADA:tratativaRealizada||'',
      DATA_INICIO_TRATATIVA:dataInicioTratativa||'', DEPENDE_OUTRO_SETOR:dependeOutroSetor||'NÃO',
      SETOR_DEPENDENTE:depStr, STATUS_TRATATIVA:status, DATA_CONCLUSAO_TRATATIVA:dataConclusaoTratativa||'',
      DEVOLUTIVA_FINAL:devolutivaFinal||'', DEVOLUTIVA_ENVIADA:devolutivaEnviada||'',
      DATA_DEVOLUTIVA:devolutivaEnviada?agora:'',
      DATA_CONCLUSAO_MANIFESTACAO:devolutivaEnviada&&dataConclusaoTratativa?agora:''
    });
    await registrarAuditoria(usuario,'DECISAO_MANIFESTACAO',id,'MANIFESTACOES',item.STATUS,{novoStatus,status});
    // Registrar assertividade se tratativa foi aceita/editada/rejeitada
    if (tratativaAplicavel) {
      const decisaoAssert = tratativaRealizada && tratativaRealizada !== item.TRATATIVA_SUGERIDA ? 'EDITADA' : (tratativaAplicavel==='NÃO'?'REJEITADA':'ACEITA');
      assertividadeService.registrarDecisao({
        idManifestacao: id, tipoRegistro:'TRATATIVA', decisao:decisaoAssert,
        empresa:item.EMPRESA_RECLAMADA||'', tipoManifestacao:item.TIPO||'',
        setor:setoresStr, usuario, motivoEdicao:observacoes||'',
        textoOriginal:item.TRATATIVA_SUGERIDA||'', textoEditado:tratativaRealizada||'',
      }).catch(()=>{});
    }
    res.json({ sucesso:true, id, status:novoStatus, statusTratativa:status });
  } catch(e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});


// ============================================================
// TRATATIVAS ESTRUTURADAS
// ============================================================

app.get('/api/manifestacoes/:id/tratativa', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    if (req._empresaScope) {
      const mData = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
      const mCheck = mData.find(r => r.ID_MANIFESTACAO === req.params.id);
      if (!mCheck || !pertenceEmpresa(req._empresaScope, mCheck.EMPRESA_RECLAMADA || ''))
        return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    const t = await tratativaEngine.buscarTratativaPorManifestacao(req.params.id);
    if (!t) return res.status(404).json({ sucesso:false, erro:'Nenhuma tratativa encontrada.' });
    res.json({ sucesso:true, tratativa:t });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/tratativa/gerar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','SETOR RESPONSÁVEL','ESPECIALISTA'), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if(!pertenceEmpresa(req.user?.empresa, m.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
    const analise = await executarAnalise({ ...m, empresaReclamante: m.EMPRESA_RECLAMANTE, empresaReclamada: m.EMPRESA_RECLAMADA, descricao: m.DESCRICAO });
    const tratativa = analise.tratativaEstruturada;
    if (tratativa) await tratativaEngine.salvarTratativa(id, tratativa, req.user?.usuario||'sistema').catch(()=>{});
    res.json({ sucesso:true, tratativa, analise });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/tratativa/decisao', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','SETOR RESPONSÁVEL','ESPECIALISTA'), async (req,res)=>{
  try {
    const { decisao, observacoes, textoEditado } = req.body;
    if (!['ACEITA','EDITADA','REJEITADA'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if(!pertenceEmpresa(req.user?.empresa, m.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
    await assertividadeService.registrarDecisao({
      idManifestacao: req.params.id,
      tipoRegistro: 'TRATATIVA',
      decisao,
      empresa: m.EMPRESA_RECLAMADA||'',
      tipoManifestacao: m.TIPO||'',
      categoria: m.CATEGORIA||'',
      setor: m.SETOR_SUGERIDO||'',
      usuario: req.user?.usuario||'sistema',
      motivoEdicao: observacoes||'',
      textoOriginal: m.TRATATIVA_SUGERIDA||'',
      textoEditado: textoEditado||'',
    }).catch(()=>{});
    await atualizarPorID('MANIFESTACOES', req.params.id, {
      STATUS_TRATATIVA: decisao==='ACEITA'?'ACEITA':decisao==='REJEITADA'?'REJEITADA':'EDITADA',
      TRATATIVA_REALIZADA: textoEditado||m.TRATATIVA_SUGERIDA||'',
    });
    res.json({ sucesso:true, decisao });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ============================================================
// DEVOLUTIVAS ESTRUTURADAS
// ============================================================

// Registrar e listar visualizações de uma manifestação
app.post('/api/manifestacoes/:id/visualizacao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const id=req.params.id;
    const _manV = (await lerAba('MANIFESTACOES',5000)).find(r=>r.ID_MANIFESTACAO===id);
    if(!_manV) return res.status(404).json({sucesso:false,erro:'Manifestação não encontrada.'});
    if(!pertenceEmpresa(req.user?.empresa, _manV.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
    const agora=new Date().toISOString();
    await garantirAbaComCabecalhos('LOG_VISUALIZACOES',['ID_MANIFESTACAO','USUARIO','NOME','PERFIL','DATA_HORA']).catch(()=>{});
    await appendObjeto('LOG_VISUALIZACOES',{ID_MANIFESTACAO:id,USUARIO:req.user.usuario,NOME:req.user.nome||req.user.usuario,PERFIL:req.user.perfil,DATA_HORA:agora});
    res.json({sucesso:true});
  } catch(e){ res.json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/manifestacoes/:id/visualizacoes', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id=req.params.id;
    if (req._empresaScope) {
      const mData = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
      const mCheck = mData.find(r => r.ID_MANIFESTACAO === id);
      if (!mCheck || !pertenceEmpresa(req._empresaScope, mCheck.EMPRESA_RECLAMADA || ''))
        return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    const rows=await lerAba('LOG_VISUALIZACOES',5000).catch(()=>[]);
    const itens=rows.filter(r=>r.ID_MANIFESTACAO===id);
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

app.get('/api/manifestacoes/:id/devolutivas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    if (req._empresaScope) {
      const mData = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
      const mCheck = mData.find(r => r.ID_MANIFESTACAO === req.params.id);
      if (!mCheck || !pertenceEmpresa(req._empresaScope, mCheck.EMPRESA_RECLAMADA || ''))
        return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    const devs = await devolutivaEngine.buscarDevolutivasPorManifestacao(req.params.id);
    res.json({ sucesso:true, total:devs.length, itens:devs });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/devolutiva/gerar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado para esta manifestação.' });
    }
    const tipo = req.body.tipo || 'RECEBIMENTO';
    const extra = req.body || {};
    const dev = await devolutivaEngine.gerarDevolutiva({
      idManifestacao: id,
      tipo,
      empresa: m.EMPRESA_RECLAMADA||'',
      tipoManifestacao: m.TIPO||'',
      setor: m.SETOR_SUGERIDO||'SAC',
      protocolo: id,
      prazo: (m.SLA_HORAS||72)+' horas corridas',
      setorResponsavel: m.SETOR_SUGERIDO||'SAC',
      diagnostico: extra.diagnostico||'',
      acoesTomadas: extra.acoesTomadas||'',
      descricaoSolucao: extra.descricaoSolucao||'',
      atualizacao: extra.atualizacao||'',
      motivoAtraso: extra.motivoAtraso||'',
      motivoEscalonamento: extra.motivoEscalonamento||'',
      justificativaImprocedencia: extra.justificativaImprocedencia||'',
      descricaoProcedencia: extra.descricaoProcedencia||'',
      resumoConclusao: extra.resumoConclusao||'',
    });
    const salva = await devolutivaEngine.salvarDevolutiva(id, dev, '', m.EMPRESA_RECLAMADA||'', req.user?.usuario||'sistema').catch(()=>null);
    res.json({ sucesso:true, devolutiva:dev, id: salva?.ID_DEVOLUTIVA });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/devolutivas/:idDev/decisao', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), async (req,res)=>{
  try {
    const { decisao, textoAprovado, motivo } = req.body;
    if (!['APROVADA','EDITADA','REJEITADA'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
    const _devRows = await lerAba('DEVOLUTIVAS', 2000).catch(()=>[]);
    const devExist = _devRows.find(r => r.ID_DEVOLUTIVA === req.params.idDev);
    if (devExist && !pertenceEmpresa(req.user?.empresa, devExist.EMPRESA||devExist.EMPRESA_RECLAMADA||'')) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado para esta devolutiva.' });
    }
    const result = await devolutivaEngine.registrarDecisaoDevolutiva(req.params.idDev, decisao, textoAprovado, motivo, req.user?.usuario||'sistema');
    // Registrar assertividade
    await assertividadeService.registrarDecisao({
      idDevolutiva: req.params.idDev,
      tipoRegistro: 'DEVOLUTIVA',
      decisao,
      usuario: req.user?.usuario||'sistema',
      motivoEdicao: motivo||'',
      textoOriginal: result.TEXTO_GERADO||'',
      textoEditado: textoAprovado||'',
    }).catch(()=>{});
    // Encerrar a manifestação quando devolutiva é aprovada
    if (decisao === 'APROVADA' && result.ID_MANIFESTACAO) {
      await atualizarPorID('MANIFESTACOES', result.ID_MANIFESTACAO, {
        STATUS: 'ENCERRADA',
        DATA_ENCERRAMENTO: new Date().toISOString(),
        ENCERRADA_POR: req.user?.usuario || 'sistema',
        DEVOLUTIVA_ENVIADA: result.VERSAO_FINAL || result.TEXTO_APROVADO || '',
      }).catch(() => {});
    }
    res.json({ sucesso:true, devolutiva:result });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ============================================================
// ASSERTIVIDADE E MÉTRICAS
// ============================================================

app.get('/api/assertividade/metricas', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), async (req,res)=>{
  try {
    const _perfAss = perfilCanonico(req.user?.perfil||'');
    const filtros = {
      empresa: _perfAss === 'MASTER' ? (req.query.empresa||undefined) : (req.user?.empresa||undefined),
      tipoManifestacao: req.query.tipo,
      categoria: req.query.categoria,
      setor: req.query.setor,
      dias: req.query.dias ? Number(req.query.dias) : 30,
    };
    const metricas = await assertividadeService.calcularMetricas(filtros);
    res.json({ sucesso:true, ...metricas });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/assertividade/sugestoes', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const result = await assertividadeService.gerarSugestoes();
    res.json({ sucesso:true, ...result });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/assertividade/resultado', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), async (req,res)=>{
  try {
    const r = await assertividadeService.registrarResultado({ ...req.body, usuario: req.user?.usuario });
    res.json({ sucesso:true, id:r.id });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ============================================================
// MATRIZ DE TRATAMENTO
// ============================================================

app.get('/api/matriz-tratamento', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR'), async (req,res)=>{
  try {
    const { matrizTratamento } = cerebroService;
    const regras = await matrizTratamento.carregarMatriz();
    res.json({ sucesso:true, total:regras.length, itens:regras });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/matriz-tratamento/consultar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR'), async (req,res)=>{
  try {
    const { matrizTratamento } = cerebroService;
    const resultado = await matrizTratamento.obterRegras(req.body||{});
    res.json({ sucesso:true, regra:resultado });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ============================================================
// CADASTRO OPERACIONAL DE SETORES + FAQ + CALCULADORA DE ATRASO
// ============================================================
const EMPRESAS_VALIDAS = ['CHIACCHIO','PLASCHIO','TUBAHIA/CESBAP','TODAS'];
const SETOR_OPERACIONAL_FIELDS = [
  'FUNCAO_SETOR','PALAVRAS_CHAVE','COMPETENCIAS','LIMITES_ATUACAO',
  'TRATATIVAS_PERMITIDAS','REGRA_ESPECIAL',
  'EMPRESA','QUANDO_ACIONAR','QUANDO_NAO_ACIONAR',
  'SLA_CRITICO','SLA_ANALISE_TECNICA','SLA_RETORNO_SAC',
  'ESCALONAMENTO_CONDICAO','ESCALONAMENTO_RESPONSAVEL','ESCALONAMENTO_PRAZO',
  'REINCIDENCIA_CRITERIO','REINCIDENCIA_PERIODO','REINCIDENCIA_ACAO',
  'RNC_CRITERIO','RNC_RESPONSAVEL','RNC_PRAZO',
  'DEVOLUTIVA_CAMPOS','LIMITACOES_IA','SETORES_RELACIONADOS'
];
const FAQ_HEADERS = ['ID_FAQ','SETOR','EMPRESA','CODIGO','PERGUNTA','RESPOSTA','PALAVRAS_CHAVE_FAQ','FONTE','STATUS','ATIVO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'];
const REGRAS_HEADERS = ['ID_REGRA','SETOR','EMPRESA','NOME','CONDICAO','PALAVRAS_GATILHO','ACAO','PRIORIDADE','NECESSITA_APROVACAO','QUEM_APROVA','AUTOMATICA','EXCECOES','SLA','STATUS','FONTE','DATA_ATUALIZACAO','USUARIO'];
const PROCEDIMENTOS_HEADERS = ['ID_PROC','SETOR','EMPRESA','NOME','OBJETIVO','QUANDO_USAR','PASSOS','RESPONSAVEL','SETORES_ENVOLVIDOS','RESULTADO_ESPERADO','PRAZO','STATUS','FONTE','DATA_ATUALIZACAO','USUARIO'];
const POLITICAS_HEADERS = ['ID_POL','SETOR','EMPRESA','NOME','OBJETIVO','REGRA_OFICIAL','LIMITES','CONDICOES','EXCECOES','QUEM_APROVA','PRAZO','VIGENCIA','STATUS','FONTE','DATA_ATUALIZACAO','USUARIO'];
const PERGUNTAS_IA_HEADERS = ['ID_PERG','SETOR','EMPRESA','PERGUNTA','OBRIGATORIA','MOTIVO','CAMPO_DESTINO','TIPO_RESPOSTA','ORDEM','ATIVO','DATA_ATUALIZACAO','USUARIO'];
const PALAVRAS_HEADERS = ['ID_PC','SETOR','EMPRESA','PALAVRA','CATEGORIA','ATIVO','DATA_ATUALIZACAO','USUARIO'];
const DOCS_SETOR_HEADERS = ['ID_DOC','SETOR','EMPRESA','NOME','TIPO','CATEGORIA','DESCRICAO','VERSAO','STATUS','FONTE_CONHECIMENTO','URL_ARQUIVO','DRIVE_FILE_ID','DATA_UPLOAD','USUARIO'];

async function crudSetorGet(aba, headers, setor) {
  await garantirAbaComCabecalhos(aba, headers).catch(()=>{});
  const rows = await lerAba(aba, 2000);
  return rows.filter(r => normalizarTexto(r.SETOR||'') === normalizarTexto(setor));
}
async function crudSetorPost(aba, headers, setor, body, prefixo, campoId, usuario) {
  garantirAbaComCabecalhos(aba, headers).catch(()=>{});
  const id = await gerarProximoID(aba, prefixo, campoId);
  const obj = { [campoId]: id, SETOR: setor, ...body, DATA_ATUALIZACAO: new Date().toISOString(), USUARIO: usuario || 'sistema' };
  await appendObjeto(aba, obj);
  return obj;
}
async function crudSetorPatch(aba, id, body, campoId, usuario) {
  const dados = { ...body, DATA_ATUALIZACAO: new Date().toISOString(), USUARIO: usuario || 'sistema' };
  return atualizarPorID(aba, id, dados, [campoId, 'ID']);
}
const LOG_HEADERS = ['ID','UF','CIDADE','REGIAO','TIPO_DIA','PRAZO_TRANSPORTE_DIAS','PRAZO_MIN_DIAS','PRAZO_MAX_DIAS','OBSERVACAO','FONTE','VERSAO','VIGENCIA_INICIO','VIGENCIA_FIM','USUARIO_ATUALIZACAO','DATA_ATUALIZACAO','ATIVO'];
const PROD_HEADERS = ['ID','TIPO_PRODUTO','PROCESSO','FAMILIA_PRODUTO','TEMPO_MEDIO_DIAS','TEMPO_MIN_DIAS','TEMPO_MAX_DIAS','TIPO_DIA','VIGENCIA_INICIO','VIGENCIA_FIM','FONTE','VERSAO','USUARIO_ATUALIZACAO','DATA_ATUALIZACAO','ATIVO','OBSERVACAO'];

function colLetter(n){let s='';while(n>0){let r=(n-1)%26;s=String.fromCharCode(65+r)+s;n=Math.floor((n-1)/26);}return s;}
const _abaCache = new Map(); // P015: cache de abas já verificadas (TTL 5min)
async function garantirAbaComCabecalhos(nomeAba, headers){
  if (_sheetsMock?.garantirAbaComCabecalhos) return _sheetsMock.garantirAbaComCabecalhos(nomeAba, headers);
  const cacheKey = `${nomeAba}:${headers.join(',')}`;
  const cached = _abaCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 300000) return cached.headers;
  const sheets=await getSheets();
  let meta=await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
  let sh=meta.data.sheets?.find(s=>s.properties?.title===nomeAba);
  if(!sh){
    await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,resource:{requests:[{addSheet:{properties:{title:nomeAba}}}]}});
    sh=(await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID})).data.sheets.find(s=>s.properties.title===nomeAba);
  }
  const atual=await obterCabecalhos(nomeAba);
  const faltantes=headers.filter(h=>!atual.includes(h));
  if(faltantes.length){
    const todos=[...atual,...faltantes];
    await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${nomeAba}!A1:${colLetter(todos.length)}1`,valueInputOption:'RAW',resource:{values:[todos]}});
  }
  const result = [...(await obterCabecalhos(nomeAba))];
  _abaCache.set(cacheKey, { ts: Date.now(), headers: result });
  return result;
}
async function atualizarOuCriarSetor(nomeSetor,dados,usuario){
  const headers=await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','DESCRICAO','RESPONSAVEL','SUBSTITUTO','EMAIL_RESPONSAVEL','SLA_HORAS','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS','ATIVO',...SETOR_OPERACIONAL_FIELDS]);
  const rows=await lerAba('CONFIG_SETORES',500);
  const existente=rows.find(r=>normalizarTexto(r.SETOR)===normalizarTexto(nomeSetor));
  const payload={...dados,SETOR:existente?.SETOR||nomeSetor,DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:usuario||'sistema'};
  if(existente?.ID_SETOR||existente?.ID) await atualizarPorID('CONFIG_SETORES',existente.ID_SETOR||existente.ID,payload,['ID_SETOR','ID']);
  else {payload.ID_SETOR=await gerarProximoID('CONFIG_SETORES','SET','ID_SETOR');payload.ATIVO=payload.ATIVO||'SIM';await appendObjeto('CONFIG_SETORES',payload);}
  return payload;
}

app.post('/api/setores', requerPerfil('MASTER'), async(req,res)=>{
  try {
    const HEADERS=['ID_SETOR','SETOR','DESCRICAO','RESPONSAVEL','EMPRESA','SLA_HORAS','ATIVO'];
    await garantirAbaComCabecalhos('CONFIG_SETORES', HEADERS);
    const { SETOR, DESCRICAO, RESPONSAVEL, EMPRESA, SLA_HORAS, ATIVO } = req.body;
    if (!SETOR) return res.status(400).json({ sucesso: false, erro: 'SETOR é obrigatório.' });
    const rows = await lerAba('CONFIG_SETORES', 500);
    const existe = rows.find(r => normalizarTexto(r.SETOR) === normalizarTexto(SETOR));
    if (existe) return res.status(409).json({ sucesso: false, erro: 'Setor já cadastrado.' });
    const id = await gerarProximoID('CONFIG_SETORES', 'SET', 'ID_SETOR');
    const obj = { ID_SETOR: id, SETOR, DESCRICAO: DESCRICAO||'', RESPONSAVEL: RESPONSAVEL||'', EMPRESA: EMPRESA||'', SLA_HORAS: SLA_HORAS||'72', ATIVO: ATIVO||'SIM' };
    await appendObjeto('CONFIG_SETORES', obj);
    if (empresaRepo && typeof empresaRepo.criarSetor === 'function') await empresaRepo.criarSetor({ nome: SETOR, empresa: EMPRESA, descricao: DESCRICAO }).catch(e => console.warn('[F7] criarSetor PG:', e.message));
    await registrarAuditoria(req.user.usuario, 'CRIOU_SETOR', id, 'CONFIG_SETORES', null, obj);
    res.status(201).json({ sucesso: true, setor: obj });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.patch('/api/setores/:id', requerPerfil('MASTER'), async(req,res)=>{
  try {
    const id = req.params.id;
    await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','EMPRESA','DESCRICAO','RESPONSAVEL','SLA_HORAS','ATIVO']).catch(()=>{});
    const campos = ['SETOR','DESCRICAO','RESPONSAVEL','EMPRESA','SLA_HORAS','ATIVO'];
    const dados = {};
    campos.forEach(c => { if (req.body[c] !== undefined) dados[c] = req.body[c]; });
    await atualizarPorID('CONFIG_SETORES', id, dados, ['ID_SETOR']);
    if (empresaRepo && typeof empresaRepo.atualizarSetorPorCodigo === 'function') {
      const _ativo = dados.ATIVO !== undefined ? (String(dados.ATIVO).toUpperCase() !== 'EXCLUIDO' && String(dados.ATIVO).toUpperCase() !== 'NÃO') : undefined;
      await empresaRepo.atualizarSetorPorCodigo(id, { nome: dados.SETOR, descricao: dados.DESCRICAO, ativo: _ativo }).catch(e => console.warn('[F7] atualizarSetor PG:', e.message));
    }
    const atualizado = await buscarPorID('CONFIG_SETORES', id, ['ID_SETOR']);
    await registrarAuditoria(req.user.usuario, 'ATUALIZOU_SETOR', id, 'CONFIG_SETORES', null, dados);
    res.json({ sucesso: true, setor: atualizado });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.delete('/api/setores/:id', requerPerfil('MASTER'), async(req,res)=>{
  try {
    const id = req.params.id;
    await atualizarPorID('CONFIG_SETORES', id, { ATIVO: 'EXCLUIDO' }, ['ID_SETOR']);
    if (empresaRepo && typeof empresaRepo.excluirSetorPorCodigo === 'function') await empresaRepo.excluirSetorPorCodigo(id).catch(e => console.warn('[F7] excluirSetor PG:', e.message));
    invalidarCacheAba('CONFIG_SETORES');
    await registrarAuditoria(req.user.usuario, 'EXCLUIU_SETOR', id, 'CONFIG_SETORES', null, {});
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/setores/importar', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try {
    const { itens } = req.body;
    if (!Array.isArray(itens) || !itens.length) return res.status(400).json({sucesso:false,erro:'Nenhum item.'});
    await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','EMPRESA','DESCRICAO','RESPONSAVEL','SLA_HORAS','ATIVO']);
    let criados = 0;
    for (const item of itens) {
      if (!item.SETOR && !item.setor) continue;
      const id = await gerarProximoID('CONFIG_SETORES','SET','ID_SETOR');
      await appendObjeto('CONFIG_SETORES', {
        ID_SETOR: id,
        SETOR: item.SETOR || item.setor || '',
        EMPRESA: item.EMPRESA || item.empresa || '',
        DESCRICAO: item.DESCRICAO || item.descricao || '',
        RESPONSAVEL: item.RESPONSAVEL || item.responsavel || '',
        SLA_HORAS: item.SLA_HORAS || item.sla_horas || '72',
        ATIVO: item.ATIVO || item.ativo || 'SIM',
      });
      criados++;
    }
    res.json({sucesso:true, criados});
  } catch(e) { res.status(500).json({sucesso:false, erro:erroSeguro(e)}); }
});

// ===== PRODUTOS =====
app.get('/api/produtos', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR SAC','AUDITOR','CONSULTA'), async(req,res)=>{
  try {
    await garantirAbaComCabecalhos('PRODUTOS',['ID_PRODUTO','EMPRESA','PRODUTO','DESCRICAO','CATEGORIA','UNIDADE','ATIVO']);
    const rows = await lerAba('PRODUTOS', 2000);
    const _pfProd = perfilCanonico(req.user?.perfil||'');
    const empresa = _pfProd === 'MASTER' ? (req.query.empresa||null) : (req.user?.empresa||null);
    const itens = empresa ? rows.filter(r => normalizarTexto(r.EMPRESA||'') === normalizarTexto(empresa)) : rows;
    res.json({ sucesso: true, total: itens.length, itens });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e), itens: [] }); }
});

app.post('/api/produtos/importar', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try {
    const { itens } = req.body;
    if (!Array.isArray(itens) || itens.length === 0) return res.status(400).json({ sucesso: false, erro: 'Nenhum item enviado.' });
    const HEADERS=['ID_PRODUTO','EMPRESA','PRODUTO','DESCRICAO','CATEGORIA','UNIDADE','ATIVO'];
    await garantirAbaComCabecalhos('PRODUTOS', HEADERS);
    const existentes = await lerAba('PRODUTOS', 5000);
    let criados = 0; let atualizados = 0;
    for (const item of itens) {
      const empresa = (item.EMPRESA||item.empresa||'').trim();
      const produto = (item.PRODUTO||item.produto||item.NOME||item.nome||'').trim();
      if (!produto) continue;
      const chave = normalizarTexto(empresa+'|'+produto);
      const existe = existentes.find(r => normalizarTexto((r.EMPRESA||'')+'|'+(r.PRODUTO||'')) === chave);
      const obj = {
        EMPRESA: empresa,
        PRODUTO: produto,
        DESCRICAO: item.DESCRICAO||item.descricao||'',
        CATEGORIA: item.CATEGORIA||item.categoria||'',
        UNIDADE: item.UNIDADE||item.unidade||'UN',
        ATIVO: 'SIM',
      };
      if (existe) {
        await atualizarPorID('PRODUTOS', existe.ID_PRODUTO, obj, ['ID_PRODUTO']);
        atualizados++;
      } else {
        const rows2 = await lerAba('PRODUTOS', 5000);
        let max = 0;
        rows2.forEach(r => { const m = String(r.ID_PRODUTO||'').match(/(\d+)$/); if(m) max = Math.max(max, parseInt(m[1],10)); });
        obj.ID_PRODUTO = `PRD-${String(max+1).padStart(4,'0')}`;
        await appendObjeto('PRODUTOS', obj);
        existentes.push(obj);
        criados++;
      }
    }
    await registrarAuditoria(req.user.usuario, 'IMPORTOU_PRODUTOS', `${criados}c/${atualizados}a`, 'PRODUTOS', null, { total: itens.length });
    res.json({ sucesso: true, criados, atualizados, total: criados + atualizados });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.get('/api/setores/:setor/operacional', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR','DIRETOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','DESCRICAO','RESPONSAVEL','SUBSTITUTO','EMAIL_RESPONSAVEL','SLA_HORAS','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS','ATIVO',...SETOR_OPERACIONAL_FIELDS]);
    await garantirAbaComCabecalhos('FAQ_SETORES',FAQ_HEADERS);
    const rows=await lerAba('CONFIG_SETORES',500); const setor=rows.find(r=>normalizarTexto(r.SETOR)===normalizarTexto(nome))||{SETOR:nome,ATIVO:'SIM'};
    const faq=(await lerAba('FAQ_SETORES',1000)).filter(r=>normalizarTexto(r.SETOR)===normalizarTexto(nome)&&normalizarTexto(r.ATIVO||'SIM')!=='nao');
    res.json({sucesso:true,setor,faq});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/operacional', requerPerfil('MASTER'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const TODOS_CAMPOS=[
      'DESCRICAO','RESPONSAVEL','SUBSTITUTO','EMAIL_RESPONSAVEL','SLA_HORAS',
      'RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS',
      ...SETOR_OPERACIONAL_FIELDS
    ];
    const dados={};
    for(const c of TODOS_CAMPOS){if(req.body?.[c]!==undefined)dados[c]=req.body[c];}
    dados.ATIVO=req.body?.ATIVO||'SIM';
    const out=await atualizarOuCriarSetor(nome,dados,req.user.usuario);
    await registrarAuditoria(req.user.usuario,'ATUALIZOU_FICHA_SETOR',nome,'CONFIG_SETORES',null,dados);
    res.json({sucesso:true,setor:out});
  }
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/setores/:setor/faq', requerPerfil('MASTER'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    await garantirAbaComCabecalhos('FAQ_SETORES',FAQ_HEADERS);
    const b=req.body||{};
    if(!b.PERGUNTA) return res.status(400).json({sucesso:false,erro:'PERGUNTA é obrigatória.'});
    const existentes=await lerAba('FAQ_SETORES',2000);
    const ex=b.ID_FAQ?existentes.find(r=>r.ID_FAQ===b.ID_FAQ):null;
    const dados={SETOR:nome,EMPRESA:b.EMPRESA||'TODAS',CODIGO:b.CODIGO||'',PERGUNTA:b.PERGUNTA,RESPOSTA:b.RESPOSTA||'',PALAVRAS_CHAVE_FAQ:b.PALAVRAS_CHAVE_FAQ||'',FONTE:b.FONTE||'',STATUS:b.STATUS||'A VALIDAR',ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};
    if(ex?.ID_FAQ){await atualizarPorID('FAQ_SETORES',ex.ID_FAQ,dados,['ID_FAQ']);res.json({sucesso:true,id:ex.ID_FAQ});}
    else{dados.ID_FAQ=await gerarProximoID('FAQ_SETORES','FAQ','ID_FAQ');await appendObjeto('FAQ_SETORES',dados);res.json({sucesso:true,id:dados.ID_FAQ});}
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// FAQ GET list
app.get('/api/setores/:setor/faq', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const itens=await crudSetorGet('FAQ_SETORES',FAQ_HEADERS,nome);
    res.json({sucesso:true,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

// REGRAS
app.get('/api/setores/:setor/regras', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('REGRAS_SETORES',REGRAS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/setores/:setor/regras', requerPerfil('MASTER'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('REGRAS_SETORES',REGRAS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,CONDICAO:req.body.CONDICAO||'',PALAVRAS_GATILHO:req.body.PALAVRAS_GATILHO||'',ACAO:req.body.ACAO||'',PRIORIDADE:req.body.PRIORIDADE||'Média',NECESSITA_APROVACAO:req.body.NECESSITA_APROVACAO||'NÃO',QUEM_APROVA:req.body.QUEM_APROVA||'',AUTOMATICA:req.body.AUTOMATICA||'NÃO',EXCECOES:req.body.EXCECOES||'',SLA:req.body.SLA||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'RGR','ID_REGRA',req.user.usuario);res.json({sucesso:true,id:obj.ID_REGRA});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/regras/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async(req,res)=>{
  try{const reg=await crudSetorPatch('REGRAS_SETORES',req.params.id,req.body,'ID_REGRA',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Regra não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// PROCEDIMENTOS
app.get('/api/setores/:setor/procedimentos', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/setores/:setor/procedimentos', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,OBJETIVO:req.body.OBJETIVO||'',QUANDO_USAR:req.body.QUANDO_USAR||'',PASSOS:req.body.PASSOS||'',RESPONSAVEL:req.body.RESPONSAVEL||'',SETORES_ENVOLVIDOS:req.body.SETORES_ENVOLVIDOS||'',RESULTADO_ESPERADO:req.body.RESULTADO_ESPERADO||'',PRAZO:req.body.PRAZO||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'PRC','ID_PROC',req.user.usuario);res.json({sucesso:true,id:obj.ID_PROC});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/procedimentos/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async(req,res)=>{
  try{const reg=await crudSetorPatch('PROCEDIMENTOS_SETORES',req.params.id,req.body,'ID_PROC',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Procedimento não encontrado.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// POLÍTICAS
app.get('/api/setores/:setor/politicas', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('POLITICAS_SETORES',POLITICAS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/setores/:setor/politicas', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('POLITICAS_SETORES',POLITICAS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,OBJETIVO:req.body.OBJETIVO||'',REGRA_OFICIAL:req.body.REGRA_OFICIAL||'',LIMITES:req.body.LIMITES||'',CONDICOES:req.body.CONDICOES||'',EXCECOES:req.body.EXCECOES||'',QUEM_APROVA:req.body.QUEM_APROVA||'',PRAZO:req.body.PRAZO||'',VIGENCIA:req.body.VIGENCIA||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'POL','ID_POL',req.user.usuario);res.json({sucesso:true,id:obj.ID_POL});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/politicas/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async(req,res)=>{
  try{const reg=await crudSetorPatch('POLITICAS_SETORES',req.params.id,req.body,'ID_POL',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Política não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// PERGUNTAS DA IA
app.get('/api/setores/:setor/perguntas-ia', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome);res.json({sucesso:true,itens:itens.sort((a,b)=>parseInt(a.ORDEM||99)-parseInt(b.ORDEM||99))});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/setores/:setor/perguntas-ia', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.PERGUNTA)return res.status(400).json({sucesso:false,erro:'PERGUNTA obrigatória.'});const obj=await crudSetorPost('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',PERGUNTA:req.body.PERGUNTA,OBRIGATORIA:req.body.OBRIGATORIA||'SIM',MOTIVO:req.body.MOTIVO||'',CAMPO_DESTINO:req.body.CAMPO_DESTINO||'',TIPO_RESPOSTA:req.body.TIPO_RESPOSTA||'texto',ORDEM:req.body.ORDEM||99,ATIVO:req.body.ATIVO||'SIM'},'PRG','ID_PERG',req.user.usuario);res.json({sucesso:true,id:obj.ID_PERG});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/perguntas-ia/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('PERGUNTAS_IA_SETORES',req.params.id,req.body,'ID_PERG',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Pergunta não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// DOCUMENTOS DO SETOR (metadados — upload usa /api/anexos)
app.get('/api/setores/:setor/documentos', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('DOCUMENTOS_SETORES',DOCS_SETOR_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/setores/:setor/documentos', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const b=req.body||{};
    if(!b.NOME) return res.status(400).json({sucesso:false,erro:'NOME do documento obrigatório.'});
    // Se vier arquivo base64, salvar via Google Drive
    let urlArquivo='', driveId='';
    if(b.arquivo?.dataBase64){
      const resultado=await salvarAnexo({...b.arquivo,categoria:b.CATEGORIA||'DOCUMENTO'},{tipoEntidade:'SETOR',idEntidade:nome,usuario:req.user.usuario});
      urlArquivo=resultado.url||''; driveId=resultado.fileId||'';
    }
    const obj=await crudSetorPost('DOCUMENTOS_SETORES',DOCS_SETOR_HEADERS,nome,{EMPRESA:b.EMPRESA||'TODAS',NOME:b.NOME,TIPO:b.TIPO||'',CATEGORIA:b.CATEGORIA||'Documento de apoio',DESCRICAO:b.DESCRICAO||'',VERSAO:b.VERSAO||'1.0',STATUS:b.STATUS||'A VALIDAR',FONTE_CONHECIMENTO:b.FONTE_CONHECIMENTO||'NÃO',URL_ARQUIVO:urlArquivo,DRIVE_FILE_ID:driveId,DATA_UPLOAD:new Date().toISOString()},'DOC','ID_DOC',req.user.usuario);
    res.json({sucesso:true,id:obj.ID_DOC,url:urlArquivo});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/setores/:setor/documentos/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async(req,res)=>{
  try{const reg=await crudSetorPatch('DOCUMENTOS_SETORES',req.params.id,req.body,'ID_DOC',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Documento não encontrado.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// CONHECIMENTO COMPLETO — rota para o cérebro da IA
app.get('/api/setores/:setor/conhecimento-completo', middlewareEscopoEmpresa(), middlewareEscopoSetor(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const empresa=req.query.empresa||null;
    const filtroEmpresa=r=>!empresa||r.EMPRESA==='TODAS'||r.EMPRESA===empresa;
    const [config,faqs,regras,procs,pols,pergs,docs]=await Promise.all([
      lerAba('CONFIG_SETORES',500).catch(()=>[]).then(rows=>rows.find(r=>normalizarTexto(r.SETOR||'')===normalizarTexto(nome))||{}),
      crudSetorGet('FAQ_SETORES',FAQ_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>(r.ATIVO||'SIM')!=='NÃO')),
      crudSetorGet('REGRAS_SETORES',REGRAS_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS!=='OBSOLETA')),
      crudSetorGet('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS!=='OBSOLETA')),
      crudSetorGet('POLITICAS_SETORES',POLITICAS_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS==='VALIDADA')),
      crudSetorGet('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>(r.ATIVO||'SIM')!=='NÃO').sort((a,b)=>parseInt(a.ORDEM||99)-parseInt(b.ORDEM||99))),
      crudSetorGet('DOCUMENTOS_SETORES',DOCS_SETOR_HEADERS,nome).catch(()=>[]).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.FONTE_CONHECIMENTO==='SIM'&&r.STATUS==='VALIDADA')),
    ]);
    res.json({sucesso:true,setor:nome,empresa:empresa||'TODAS',config,faqs,regras,procedimentos:procs,politicas:pols,perguntas_ia:pergs,documentos_fonte:docs});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

function ativoAgora(r){const hoje=new Date();const ini=r.VIGENCIA_INICIO?new Date(r.VIGENCIA_INICIO):null;const fim=r.VIGENCIA_FIM?new Date(r.VIGENCIA_FIM):null;return normalizarTexto(r.ATIVO||'sim')!=='nao'&&(!ini||hoje>=ini)&&(!fim||hoje<=fim);}
function adicionarDiasCalendario(data,qtd,tipo){if(!data||qtd===null||qtd===undefined||isNaN(Number(qtd)))return null;let d=new Date(String(data)+'T00:00:00');let n=0;while(n<Number(qtd)){d.setDate(d.getDate()+1);if(normalizarTexto(tipo).includes('util')){const w=d.getDay();if(w===0||w===6)continue;}n++;}return d.toISOString().slice(0,10);}
function diffDias(a,b){if(!a||!b)return null;return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);}
function acharLogistica(rows,b){const cidade=normalizarTexto(b.cidade),uf=normalizarTexto(b.uf),reg=normalizarTexto(b.regiao);const ativos=rows.filter(ativoAgora);const score=r=>(normalizarTexto(r.CIDADE)===cidade&&normalizarTexto(r.UF)===uf?100:0)+(normalizarTexto(r.UF)===uf?20:0)+(reg&&normalizarTexto(r.REGIAO)===reg?10:0);return ativos.sort((a,c)=>score(c)-score(a))[0]||null;}
function acharProducao(rows,b){const t=normalizarTexto(b.tipoProduto),f=normalizarTexto(b.familiaProduto),p=normalizarTexto(b.processo);const ativos=rows.filter(ativoAgora);const score=r=>(t&&normalizarTexto(r.TIPO_PRODUTO)===t?50:0)+(f&&normalizarTexto(r.FAMILIA_PRODUTO)===f?30:0)+(p&&normalizarTexto(r.PROCESSO)===p?20:0);return ativos.sort((a,c)=>score(c)-score(a))[0]||null;}
app.get('/api/calculadora/parametros', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{try{const [l,p]=await Promise.all([lerAba('PARAMETROS_LOGISTICA',2000).catch(()=>[]),lerAba('PARAMETROS_PRODUCAO',2000).catch(()=>[])]);res.json({sucesso:true,logistica:l,producao:p});}catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}});
app.post('/api/calculadora/calcular', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const b=req.body||{};const tipo=normalizarTexto(b.tipoProduto||b.tipo)==='personalizado'?'PERSONALIZADO':'ESTOQUE';
    const [logs,prods]=await Promise.all([lerAba('PARAMETROS_LOGISTICA',2000).catch(()=>[]),lerAba('PARAMETROS_PRODUCAO',2000).catch(()=>[])]);
    const log=acharLogistica(logs,b);const prod=tipo==='PERSONALIZADO'?acharProducao(prods,b):null;
    const prazoTrans=log?Number(log.PRAZO_TRANSPORTE_DIAS||log.PRAZO_MAX_DIAS||0):0;const tipoDiaLog=log?.TIPO_DIA||'CORRIDOS';
    const prazoProd=prod?Number(prod.TEMPO_MEDIO_DIAS||prod.TEMPO_MAX_DIAS||0):0;const tipoDiaProd=prod?.TIPO_DIA||'CORRIDOS';
    let baseProd=b.dataInicioProducao||b.dataImplantacao||b.dataPedido;let dataProdEst=tipo==='PERSONALIZADO'&&baseProd&&prazoProd?adicionarDiasCalendario(baseProd,prazoProd,tipoDiaProd):null;
    const baseEntrega=b.dataExpedicao||b.dataFaturamento||b.dataPedido;const dataEntEst=baseEntrega&&prazoTrans?adicionarDiasCalendario(baseEntrega,prazoTrans,tipoDiaLog):null;
    const desvioProd=tipo==='PERSONALIZADO'&&dataProdEst&&b.dataFimProducao?Math.max(0,diffDias(dataProdEst,b.dataFimProducao)):0;
    const desvioTrans=dataEntEst&&b.dataEntrega?Math.max(0,diffDias(dataEntEst,b.dataEntrega)):0;
    const desvioDias=(desvioProd||0)+(desvioTrans||0);
    let etapa='SEM DESVIO';if(desvioProd>0&&desvioTrans>0)etapa='ATRASO MISTO';else if(desvioProd>0)etapa='ATRASO NA PRODUÇÃO';else if(desvioTrans>0)etapa='ATRASO NO TRANSPORTE';
    if(!log&&b.dataEntrega)etapa='SEM PARÂMETRO DE LOGÍSTICA';if(tipo==='PERSONALIZADO'&&!prod)etapa='SEM PARÂMETRO DE PRODUÇÃO';
    const status=desvioDias>0?'ATRASADO':(dataEntEst&&!b.dataEntrega?'AGUARDANDO ENTREGA':'NO PRAZO');
    res.json({sucesso:true,resultado:{tipo,tempoProducao:prazoProd||null,prazoTransporte:prazoTrans||null,dataProducaoEstimada:dataProdEst,dataEntregaEstimada:dataEntEst,desvioProducao:desvioProd,desvioTransporte:desvioTrans,desvioDias,etapaDesvio:etapa,statusPrazo:status,parametroLogistica:log,parametroProducao:prod}});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/calculadora/parametros/logistica', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{try{await garantirAbaComCabecalhos('PARAMETROS_LOGISTICA',LOG_HEADERS);const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_LOGISTICA','LOG','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_LOGISTICA',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}});
app.patch('/api/calculadora/parametros/logistica/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{try{const dados={...req.body,DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await atualizarPorID('PARAMETROS_LOGISTICA',req.params.id,dados,['ID']);res.json({sucesso:true});}catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}});
app.delete('/api/calculadora/parametros/logistica/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{try{await atualizarPorID('PARAMETROS_LOGISTICA',req.params.id,{ATIVO:'NAO',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario},['ID']);res.json({sucesso:true});}catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}});
app.post('/api/calculadora/parametros/producao', requerPerfil('MASTER'), async(req,res)=>{try{garantirAbaComCabecalhos('PARAMETROS_PRODUCAO',PROD_HEADERS).catch(()=>{});const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_PRODUCAO','PROD','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_PRODUCAO',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}});

// ════════════════════════════════════════════════════════════════
// CALCULADORA DE ATRASO — ANÁLISE COMPLETA (prazo prometido + regional)
// ════════════════════════════════════════════════════════════════

// Gatilhos que indicam reclamação de atraso
const GATILHOS_ATRASO = ['atraso','atrasado','atrasada','demora','demorou','demorado','demorada','entrega atrasada','pedido nao chegou','pedido não chegou','nao chegou','não chegou','nao recebeu','não recebeu','prazo ultrapassado','fora do prazo','nao chegou','previsao de entrega ultrapassada','previsão de entrega ultrapassada','produto nao recebido','produto não recebido','nao foi entregue','não foi entregue','transporte demorando','demora na entrega','demora no transporte','ainda nao recebi','ainda não recebi','entrega fora do prazo'];

function detectarGatilhoAtraso(texto) {
  if (!texto) return false;
  const t = normalizarTexto(texto);
  return GATILHOS_ATRASO.some(g => t.includes(normalizarTexto(g)));
}

// Busca prazo regional com suporte a múltiplas correspondências
function buscarPrazoRegional(rows, { cidade, uf, regiao } = {}) {
  const ativos = rows.filter(ativoAgora);
  if (!cidade && !uf && !regiao) return { encontrado: false, motivo: 'SEM_LOCALIZACAO', itens: [] };

  const cN = normalizarTexto(cidade||'');
  const ufN = normalizarTexto(uf||'');
  const regN = normalizarTexto(regiao||'');

  const scoreItem = r => {
    let s = 0;
    if (cN && normalizarTexto(r.CIDADE||'') === cN) s += 100;
    if (ufN && normalizarTexto(r.UF||'') === ufN) s += 20;
    if (regN && normalizarTexto(r.REGIAO||'') === regN) s += 10;
    return s;
  };

  const com_score = ativos.map(r => ({ ...r, _score: scoreItem(r) })).filter(r => r._score > 0).sort((a,b) => b._score - a._score);
  if (com_score.length === 0) return { encontrado: false, motivo: 'SEM_REFERENCIA', itens: [] };

  const top = com_score[0]._score;
  const empatados = com_score.filter(r => r._score === top);
  if (empatados.length > 1 && top < 100) {
    return { encontrado: false, motivo: 'MULTIPLAS_REFERENCIAS', itens: empatados };
  }
  return { encontrado: true, item: com_score[0], itens: [com_score[0]] };
}

// Classifica o nível do diagnóstico
function classificarNivelAtraso({ prazoPrometido, prazoRealizado, prazoMedioRegional }) {
  const temPrometido = prazoPrometido !== null && prazoPrometido !== undefined && !isNaN(Number(prazoPrometido));
  const temRealizado = prazoRealizado !== null && prazoRealizado !== undefined && !isNaN(Number(prazoRealizado));
  const temRegional = prazoMedioRegional !== null && prazoMedioRegional !== undefined && !isNaN(Number(prazoMedioRegional));

  if (!temRealizado) return 'DADOS_INSUFICIENTES';

  const atrasadoPrometido = temPrometido && Number(prazoRealizado) > Number(prazoPrometido);
  const acimaMediaRegional = temRegional && Number(prazoRealizado) > Number(prazoMedioRegional);

  if (atrasadoPrometido && acimaMediaRegional) return 'ATRASO_E_ACIMA_DA_MEDIA_REGIONAL';
  if (atrasadoPrometido) return 'ATRASO_EM_RELACAO_AO_PRAZO_PROMETIDO';
  if (acimaMediaRegional) return 'ACIMA_DA_MEDIA_REGIONAL';
  return 'DENTRO_DO_PADRAO_REGIONAL';
}

// Identifica etapa provável do atraso com base nas datas
function identificarEtapaAtraso(b) {
  const etapas = [];
  const diffOpt = (de, ate) => { const d = diffDias(de, ate); return d !== null ? d : null; };

  if (b.dataInicioProducao && b.dataFimProducao) {
    const durProd = diffOpt(b.dataInicioProducao, b.dataFimProducao);
    const prazoProd = b.prazoPrevistoProd ? Number(b.prazoPrevistoProd) : null;
    if (durProd !== null) {
      const desvio = prazoProd !== null ? durProd - prazoProd : null;
      etapas.push({ etapa: 'PRODUCAO', duracao: durProd, prazoEsperado: prazoProd, desvio, status: desvio !== null ? (desvio > 0 ? 'ATRASADO' : 'NO_PRAZO') : 'SEM_PARAMETRO' });
    }
  }
  if (b.dataFimProducao && b.dataExpedicao) {
    const durExp = diffOpt(b.dataFimProducao, b.dataExpedicao);
    etapas.push({ etapa: 'EXPEDICAO', duracao: durExp, prazoEsperado: null, desvio: null, status: durExp !== null && durExp > 3 ? 'ATRASADO' : (durExp !== null ? 'NO_PRAZO' : 'SEM_DADO') });
  }
  if (b.dataExpedicao && b.dataEntrega) {
    const durTrans = diffOpt(b.dataExpedicao, b.dataEntrega);
    const prazoReg = b.prazoMedioRegional ? Number(b.prazoMedioRegional) : null;
    const desvio = prazoReg !== null && durTrans !== null ? durTrans - prazoReg : null;
    etapas.push({ etapa: 'TRANSPORTE', duracao: durTrans, prazoEsperado: prazoReg, desvio, status: desvio !== null ? (desvio > 0 ? 'ACIMA_DA_MEDIA' : 'DENTRO_DO_PADRAO') : (durTrans !== null ? 'SEM_REFERENCIA_REGIONAL' : 'SEM_DADO') });
  }
  if (b.dataEntrega && b.dataImplantacao) {
    const durImpl = diffOpt(b.dataEntrega, b.dataImplantacao);
    etapas.push({ etapa: 'IMPLANTACAO', duracao: durImpl, prazoEsperado: null, desvio: null, status: 'INFORMATIVO' });
  }

  // Origem provável
  const atrasadas = etapas.filter(e => e.status === 'ATRASADO' || e.status === 'ACIMA_DA_MEDIA');
  let origemProvavel = 'NAO_IDENTIFICADO';
  if (atrasadas.length === 1) origemProvavel = atrasadas[0].etapa;
  else if (atrasadas.length > 1) origemProvavel = 'MISTO';

  return { etapas, origemProvavel };
}

// POST /api/calculadora/analisar-atraso — análise completa integrada
app.post('/api/calculadora/analisar-atraso', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const b = req.body || {};
    const logs = await lerAba('PARAMETROS_LOGISTICA', 2000).catch(() => []);

    // Busca prazo regional
    const buscaRegional = buscarPrazoRegional(logs, { cidade: b.cidade, uf: b.uf, regiao: b.regiao });

    const prazoMedioRegional = buscaRegional.encontrado
      ? Number(buscaRegional.item.PRAZO_TRANSPORTE_DIAS || buscaRegional.item.PRAZO_MAX_DIAS || 0) || null
      : null;
    const prazoMinRegional = buscaRegional.encontrado ? Number(buscaRegional.item.PRAZO_MIN_DIAS || 0) || null : null;
    const prazoMaxRegional = buscaRegional.encontrado ? Number(buscaRegional.item.PRAZO_MAX_DIAS || 0) || null : null;

    const prazoPrometido = b.prazoPrometido !== undefined && b.prazoPrometido !== '' ? Number(b.prazoPrometido) : null;
    const prazoRealizado = b.prazoRealizado !== undefined && b.prazoRealizado !== '' ? Number(b.prazoRealizado) : null;

    const atrasoDiasPrometido = prazoPrometido !== null && prazoRealizado !== null ? prazoRealizado - prazoPrometido : null;
    const desvioMediaRegional = prazoMedioRegional !== null && prazoRealizado !== null ? prazoRealizado - prazoMedioRegional : null;

    const nivel = classificarNivelAtraso({ prazoPrometido, prazoRealizado, prazoMedioRegional });
    const { etapas, origemProvavel } = identificarEtapaAtraso({ ...b, prazoMedioRegional });

    // Confiança do diagnóstico
    let confianca = 'BAIXO';
    const dadosDisponiveis = [prazoPrometido, prazoRealizado, prazoMedioRegional, b.dataExpedicao, b.dataEntrega].filter(v => v !== null && v !== undefined && v !== '').length;
    if (dadosDisponiveis >= 4) confianca = 'ALTO';
    else if (dadosDisponiveis >= 2) confianca = 'MEDIO';

    res.json({
      sucesso: true,
      analise: {
        nivel,
        prazoPrometido,
        prazoRealizado,
        prazoMedioRegional,
        prazoMinRegional,
        prazoMaxRegional,
        atrasoDiasPrometido,
        desvioMediaRegional,
        referenciaRegional: buscaRegional.encontrado ? {
          cidade: buscaRegional.item.CIDADE,
          uf: buscaRegional.item.UF,
          regiao: buscaRegional.item.REGIAO,
          modalidade: buscaRegional.item.MODALIDADE || '',
          fonte: buscaRegional.item.FONTE || '',
          vigenciaInicio: buscaRegional.item.VIGENCIA_INICIO || '',
        } : null,
        statusBuscaRegional: buscaRegional.motivo || 'OK',
        multiplosResultados: buscaRegional.motivo === 'MULTIPLAS_REFERENCIAS' ? buscaRegional.itens.map(i => ({ cidade: i.CIDADE, uf: i.UF, regiao: i.REGIAO, prazo: i.PRAZO_TRANSPORTE_DIAS })) : null,
        etapas,
        origemProvavel,
        confianca,
        cidade: b.cidade || '',
        uf: b.uf || '',
        regiao: b.regiao || '',
        analisadoEm: new Date().toISOString(),
        analisadoPor: req.user.usuario,
        classificacaoIA: nivel,
      }
    });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// PATCH /api/manifestacoes/:id/diagnostico-atraso — salva diagnóstico na manifestação
app.patch('/api/manifestacoes/:id/diagnostico-atraso', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const b = req.body || {};
    const todasMan = await lerAba('MANIFESTACOES', 5000);
    const itemMan = todasMan.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!itemMan) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!pertenceEmpresa(req.user?.empresa, itemMan.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado para esta manifestação.' });
    }
    const dados = {
      HOUVE_ATRASO: b.houveAtraso || '',
      PRAZO_PROMETIDO_DIAS: b.prazoPrometido != null ? String(b.prazoPrometido) : '',
      PRAZO_REALIZADO_DIAS: b.prazoRealizado != null ? String(b.prazoRealizado) : '',
      PRAZO_MEDIO_REGIONAL_DIAS: b.prazoMedioRegional != null ? String(b.prazoMedioRegional) : '',
      ATRASO_DIAS: b.atrasoDiasPrometido != null ? String(b.atrasoDiasPrometido) : '',
      DESVIO_MEDIA_REGIONAL_DIAS: b.desvioMediaRegional != null ? String(b.desvioMediaRegional) : '',
      CIDADE_DESTINO: b.cidade || '',
      UF_DESTINO: b.uf || '',
      REGIAO_DESTINO: b.regiao || '',
      ORIGEM_PROVAVEL_ATRASO: b.origemProvavel || '',
      SETOR_RELACIONADO_ATRASO: b.setorRelacionado || '',
      NIVEL_DIAGNOSTICO_ATRASO: b.nivel || '',
      CONFIANCA_DIAGNOSTICO_ATRASO: b.confianca || '',
      JUSTIFICATIVA_ATRASO: b.justificativa || '',
      CLASSIFICACAO_IA_ATRASO: b.classificacaoIA || '',
      CLASSIFICACAO_ANALISTA_ATRASO: b.classificacaoAnalista || b.nivel || '',
      ACERTO_IA_ATRASO: b.classificacaoIA && b.classificacaoAnalista ? (b.classificacaoIA === b.classificacaoAnalista ? 'SIM' : 'NÃO') : '',
      DATA_ANALISE_ATRASO: new Date().toISOString(),
      USUARIO_ANALISE_ATRASO: req.user.usuario,
    };
    await atualizarPorID('MANIFESTACOES', req.params.id, dados, ['ID_MANIFESTACAO']);
    registrarAuditoria(req.user.usuario, 'DIAGNOSTICO_ATRASO', req.params.id, 'MANIFESTACOES', null, dados).catch(() => {});
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// GET /api/calculadora/prazos-regionais — listagem paginada para a tela de gestão
app.get('/api/calculadora/prazos-regionais', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PARAMETROS_LOGISTICA', LOG_HEADERS);
    let rows = await lerAba('PARAMETROS_LOGISTICA', 5000).catch(() => []);
    const { q, uf, regiao, ativo = 'SIM' } = req.query;
    if (ativo) rows = rows.filter(r => normalizarTexto(r.ATIVO||'SIM') === normalizarTexto(ativo));
    if (uf) rows = rows.filter(r => normalizarTexto(r.UF||'') === normalizarTexto(uf));
    if (regiao) rows = rows.filter(r => normalizarTexto(r.REGIAO||'') === normalizarTexto(regiao));
    if (q) { const qN = normalizarTexto(q); rows = rows.filter(r => normalizarTexto(r.CIDADE||'').includes(qN) || normalizarTexto(r.UF||'').includes(qN) || normalizarTexto(r.REGIAO||'').includes(qN)); }
    rows = rows.sort((a,b) => (a.UF||'').localeCompare(b.UF||'') || (a.CIDADE||'').localeCompare(b.CIDADE||''));
    const ufs = [...new Set(await lerAba('PARAMETROS_LOGISTICA', 5000).catch(()=>[]).then(r => r.map(x => x.UF).filter(Boolean)))].sort();
    const regioes = [...new Set(await lerAba('PARAMETROS_LOGISTICA', 5000).catch(()=>[]).then(r => r.map(x => x.REGIAO).filter(Boolean)))].sort();
    res.json({ sucesso: true, total: rows.length, itens: rows, filtros: { ufs, regioes } });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== DASHBOARD =====
app.get('/api/dashboard', middlewareEscopoEmpresa(), requerPermissao('dashboard.visualizar'), async (req, res) => {
  try {
    let [mans, recs] = await Promise.all([lerAba('MANIFESTACOES', 5000).catch(()=>[]), lerAbaReclamacoes(2000)]);
    mans = filtrarPorEmpresaHistorico(mans, req, COLUNA_EMPRESA_ABA.MANIFESTACOES).filter(m => !isTeste(m));
    recs = filtrarPorEmpresaHistorico(recs, req, COLUNA_EMPRESA_ABA['Reclamações']).filter(r => !isTeste(r));
    const emAndamento = mans.filter(m => !['FINALIZADA','ENCERRADA','CONCLUÍDA'].some(s => (m.STATUS||'').toUpperCase().includes(s))).length;
    const rncsAbertas = mans.filter(m => m.ID_RNC && m.ID_RNC !== '').length;
    const recComSLA = recs.filter(r => r['Dentro do Prazo? Cliente'] || r['Dentro do Prazo? Setor'] || r['Dentro do prazo? '] || r['Dentro do prazo?']);
    const _getSLA = r => (r['Dentro do Prazo? Cliente'] || r['Dentro do Prazo? Setor'] || r['Dentro do prazo? '] || r['Dentro do prazo?'] || '').toUpperCase().trim();
    const dentroPrazo = recComSLA.filter(r => { const v=_getSLA(r); return v==='SIM'||v==='S'; }).length;
    const slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo/recComSLA.length*100) : null;
    const EMP_DISPLAY = { CHIACCHIO:'Chiacchio Embalagens', PLASCHIO:'Plaschio', TUBAHIA:'Tubahia', LOGCHIO:'Logchio', SOLARCHIO:'Solarchio', PREMOCHIO:'Premochio' };
    const porEmpresa = {};
    recs.forEach(r => {
      const empRaw = (r['Empresa']||'').trim();
      if(!empRaw) return;
      const _cod = empresaCanonica(empRaw);
      const emp = (_cod && EMP_DISPLAY[_cod]) ? EMP_DISPLAY[_cod] : empRaw;
      if(!porEmpresa[emp]) porEmpresa[emp]={total:0,finaliz:0,sla:0,foraSLA:0};
      porEmpresa[emp].total++;
      const st=(r['Status']||r['Situação Final']||'').toUpperCase();
      if(st.includes('FINALIZ')||st.includes('CONCLUÍD'))porEmpresa[emp].finaliz++;
      const slaV=_getSLA(r);
      if(slaV==='SIM')porEmpresa[emp].sla++; else if(slaV==='NÃO'||slaV==='NAO')porEmpresa[emp].foraSLA++;
    });
    const motivos = {};
    recs.forEach(r=>{const m=(r['Motivo da Reclamação']||r['Setor']||'').trim();if(m&&m!=='Não identificado')motivos[m]=(motivos[m]||0)+1;});
    const statusCount = {};
    mans.forEach(m=>{const s=m.STATUS||'EM ANÁLISE';statusCount[s]=(statusCount[s]||0)+1;});
    const semanas = [];
    const agora = new Date();
    for(let i=11;i>=0;i--){const d=new Date(agora);d.setDate(d.getDate()-i*7);semanas.push({label:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.',''),count:0});}
    recs.forEach(r=>{
      let dc; const dv=r['Data de Registro']||r['Data do Registro'];
      if(typeof dv==='number')dc=new Date((dv-25569)*86400*1000); else dc=new Date(dv);
      if(!dc||isNaN(dc))return;
      const diff=Math.floor((agora-dc)/86400000); const idx=11-Math.floor(diff/7);
      if(idx>=0&&idx<12)semanas[idx].count++;
    });
    res.json({sucesso:true,fontesDados:{manifestacoes:'Google Sheets (MANIFESTACOES)',reclamacoes:'Google Sheets (Reclamações)'},dados:{kpis:{emAndamento,totalManifestacoes:mans.length,totalReclamacoes:recs.length,rncsAbertas,slaPercent:slaPercent!==null?slaPercent:'Sem dados',foraPrazo:recComSLA.length-dentroPrazo},statusCount,porEmpresa,motivos:Object.entries(motivos).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,c])=>({motivo:m,count:c})),semanas}});
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e), dados:{} }); }
});

// ===== RNC =====
app.get('/api/rnc', middlewareEscopoEmpresa(), requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    let data=await lerAba('BANCO_RNC',5000).catch(()=>[]);
    data = filtrarPorEmpresaHistorico(data, req, COLUNA_EMPRESA_ABA.BANCO_RNC);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});

app.post('/api/rnc', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const body=req.body||{};
    if(!body.COMPETENCIA&&!body.competencia) return res.status(400).json({sucesso:false,erro:'Competência da RNC é obrigatória.'});
    const id=await gerarProximoID('BANCO_RNC','RNC','ID_RNC'); const agora=new Date().toISOString();
    const competencia=body.COMPETENCIA||body.competencia;
    const usuarioCriador=req.user?.usuario||body.usuario||'sistema';
    await appendObjeto('BANCO_RNC',{ID_RNC:id,DATA_ABERTURA:agora,EMPRESA:body.EMPRESA||body.empresa||'',SETOR:body.SETOR||body.setor||'',COMPETENCIA:competencia,NAO_CONFORMIDADE:body.NAO_CONFORMIDADE||body.naoConformidade||'',CAUSA:body.CAUSA||body.causa||'',RESPONSAVEL:body.RESPONSAVEL||body.responsavel||'',PRIORIDADE:body.PRIORIDADE||body.prioridade||'Média',PRAZO:body.PRAZO||body.prazo||'',STATUS:body.STATUS||'AGUARDANDO_APROVACAO',USUARIO_CRIACAO:usuarioCriador});
    await registrarAuditoria(usuarioCriador,'CRIOU_RNC',id,'BANCO_RNC',null,{competencia});
    res.json({sucesso:true,id,competencia,status:'AGUARDANDO_APROVACAO'});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/rnc/:id', requerPerfil('APROVADOR','MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if(!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
    const eventos=await lerAba('RNC_EVENTOS',5000).catch(()=>[]);
    const anexos=await lerAba('ANEXOS',5000).catch(()=>[]);
    res.json({sucesso:true,rnc,eventos:eventos.filter(x=>x.ID_RNC===req.params.id),anexos:anexos.filter(x=>x.ID_ENTIDADE===req.params.id)});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-get')});}
});

app.post('/api/rnc/:id/decisao', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try{
    const {decisao,observacoes}=req.body||{};
    if(!decisao) return res.status(400).json({sucesso:false,erro:'Decisão é obrigatória.'});
    const rnc=(await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if(!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
    const d=String(decisao).toUpperCase();
    if(d!=='APROVAR'&&(!observacoes||!String(observacoes).trim())) return res.status(400).json({sucesso:false,erro:'Justificativa é obrigatória.'});
    const status=d==='APROVAR'?'APROVADA':(d==='REJEITAR'?'REJEITADA':'DEVOLVIDA'); const agora=new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,{STATUS:status,APROVADOR_DECISAO:req.user.usuario,DATA_DECISAO:agora,OBSERVACOES_APROVACAO:observacoes||''},['ID_RNC','ID']);
    await registrarAuditoria(req.user.usuario,'DECISAO_RNC',req.params.id,'BANCO_RNC',rnc.STATUS,{status});
    res.json({sucesso:true,id:req.params.id,status});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.post('/api/rnc/:id/visualizacao', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try{
    const agora=new Date().toISOString(); const idEvento=await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvento,ID_RNC:req.params.id,TIPO_EVENTO:'VISUALIZOU',USUARIO:req.user.usuario,DATA_EVENTO:agora,DETALHES:'RNC visualizada'});
    res.json({sucesso:true,idEvento});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/rnc/:id/eventos', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async(req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
    if(rnc && !pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const data=await lerAba('RNC_EVENTOS',5000);res.json({sucesso:true,itens:data.filter(x=>x.ID_RNC===req.params.id)});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.patch('/api/rnc/:id/execucao', requerPerfil('SETOR RESPONSÁVEL','MASTER','ANALISTA SAC'), async(req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if(!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
    const b=req.body||{}; const dados={};
    const campos=['CAUSA','ACAO_CONTENCAO','ACAO_CORRETIVA','RESPONSAVEL_ACAO','PRAZO_ACAO','STATUS_ACAO','RESPONSAVEL_EFICACIA','DATA_EFICACIA','RESULTADO_EFICACIA'];
    for(const c of campos){if(b[c]!==undefined)dados[c]=b[c];}
    dados.ULTIMA_ALTERACAO_POR=req.user.usuario; dados.ULTIMA_ALTERACAO_DATA=new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,dados,['ID_RNC','ID']);
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/rnc-metricas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try{
    const _perfRnc = perfilCanonico(req.user?.perfil||'');
    const _empRnc = _perfRnc === 'MASTER' ? null : (req.user?.empresa||null);
    let data=await lerAba('BANCO_RNC',5000);
    if (_empRnc) data = data.filter(x=>pertenceEmpresa(_empRnc, x.EMPRESA||''));
    const now=Date.now();
    const pend=data.filter(x=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(x.STATUS||'').toUpperCase()));
    const aprov=data.filter(x=>String(x.STATUS||'').toUpperCase()==='APROVADA');
    const overdue=pend.filter(x=>x.PRAZO&&!isNaN(Date.parse(x.PRAZO))&&Date.parse(x.PRAZO)<now);
    res.json({sucesso:true,total:data.length,pendentes:pend.length,aprovadas:aprov.length,atrasadas:overdue.length,percentualDentroPrazo:data.length?Math.round((data.length-overdue.length)/data.length*100):0});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// ===== EMPRESAS =====
app.get('/api/empresas', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR'), async (req, res) => {
  try {
    const sheets = await getSheets();
    const res1 = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'MANIFESTACOES!A1:Z1000',
      valueRenderOption: 'FORMATTED_VALUE'
    });
    const rows = res1.data.values || [];
    if (rows.length === 0) {
      return res.json({ sucesso: true, total: 0, itens: [] });
    }
    const headers = rows[0];
    const empresaIdx = headers.indexOf('EMPRESA_RECLAMADA') >= 0 ? headers.indexOf('EMPRESA_RECLAMADA') : headers.indexOf('EMPRESA_NORMALIZADA');
    const empresas = new Set();
    for (let i = 1; i < rows.length; i++) {
      const emp = (empresaIdx >= 0 && rows[i][empresaIdx]) || '';
      if (emp && emp.trim()) {
        empresas.add(emp.trim());
      }
    }
    const res2 = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Reclamações!A1:Z1000',
      valueRenderOption: 'FORMATTED_VALUE'
    }).catch(() => ({ data: { values: [] } }));
    const recRows = res2.data.values || [];
    if (recRows.length > 0) {
      const recHeaders = recRows[0];
      const recEmpIdx = recHeaders.indexOf('Empresa');
      for (let i = 1; i < recRows.length; i++) {
        const emp = (recEmpIdx >= 0 && recRows[i][recEmpIdx]) || '';
        if (emp && emp.trim() && !['TR01', 'TR08'].includes(emp.trim())) {
          empresas.add(emp.trim());
        }
      }
    }
    res.json({ sucesso: true, total: empresas.size, itens: [...empresas].sort() });
  } catch (e) {
    console.error('Erro ao carregar empresas:', e.message);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e), itens: [] });
  }
});

// ===== CLIENTES =====
app.get('/api/clientes/:cnpj', requerPerfil('MASTER','ANALISTA SAC','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    const cnpj=req.params.cnpj.replace(/\D/g,'');
    if(cnpj.length < 8) return res.json({sucesso:true,encontrado:false,cliente:null,historico:[]});
    const historico=await lerAba('BANCO_HISTORICO',2000).catch(()=>[]);
    const userEmp = perfilCanonico(req.user?.perfil||'') === 'MASTER' ? null : (req.user?.empresa||'');
    const casos=historico.filter(h=>{
      if(userEmp && !pertenceEmpresa(userEmp, h.ORIG_EMPRESA||h.EMPRESA_RECLAMADA||'')) return false;
      // Busca pelo campo CNPJ dedicado primeiro
      const hcnpj=(h.ORIG_CNPJ||h.CNPJ||'').replace(/\D/g,'');
      if(hcnpj.length >= 8) return hcnpj === cnpj;
      // Fallback: busca no contato mas exige tamanho mínimo para evitar falsos positivos
      const hcontato=(h.ORIG_CONTATO||'').replace(/\D/g,'');
      return hcontato.length >= 8 && hcontato === cnpj;
    });
    if(casos.length===0) return res.json({sucesso:true,encontrado:false,cliente:null,historico:[]});
    const ultimo=casos[casos.length-1];
    res.json({sucesso:true,encontrado:true,cliente:{contato:ultimo.ORIG_CONTATO,empresa:normalizarEmpresa(ultimo.ORIG_EMPRESA)||ultimo.ORIG_EMPRESA,reincidente:casos.length>1},historico:casos.slice(-5).map(c=>({id:c.ID_HISTORICO,data:normalizarData(c.ORIG_DATA_ABERTURA),descricao:(c.ORIG_DESCRICAO_RECLAMACAO||'').slice(0,100),status:c.ORIG_STATUS,tipo:c.COMP_TIPO_PROBLEMA_VALIDADO})),totalCasos:casos.length});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== RECLAMAÇÕES =====
app.get('/api/reclamacoes', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','SETOR RESPONSÁVEL','ESPECIALISTA','APROVADOR','DIRETOR'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const data=await lerAbaReclamacoes(2000);
    let normalizado=data.map(r=>({
      ...r,
      'Data do Registro':normalizarData(r['Data de Registro']||r['Data do Registro']),
      'Empresa':r['Empresa']||''
    })).filter(r=>!['TR01','TR08'].includes((r['Empresa']||'').trim()));
    // B2: legado sem empresa = global; com empresa = apenas daquela empresa
    normalizado = filtrarPorEmpresaHistorico(normalizado, req, COLUNA_EMPRESA_ABA['Reclamações']);
    res.json({sucesso:true,total:normalizado.length,itens:normalizado});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});

// ===== HISTORICO =====
app.get('/api/historico', middlewareEscopoEmpresa(), requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req, res) => {
  try {
    let data=await lerAba('BANCO_HISTORICO',1000).catch(()=>[]);
    // B2: legado sem empresa = global; com empresa = apenas daquela empresa
    data = filtrarPorEmpresaHistorico(data, req, COLUNA_EMPRESA_ABA.BANCO_HISTORICO);
    res.json({sucesso:true,total:data.length,itens:data});
  }
  catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});

// ===== SETORES / CONHECIMENTO / PROCEDIMENTOS / POLÍTICAS / TIPOS / SLA =====
app.get('/api/setores-unicos', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR SAC','AUDITOR','CONSULTA'), async (req, res) => {
  try {
    const sheets = await getSheets();
    const setores = new Set();
    try {
      const res1 = await sheets.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: 'MANIFESTACOES!A1:Z1000',
        valueRenderOption: 'FORMATTED_VALUE'
      });
      const rows = res1.data.values || [];
      if (rows.length > 0) {
        const headers = rows[0];
        const setorIdx = headers.indexOf('SETOR');
        const setorConfIdx = headers.indexOf('SETOR_CONFIRMADO') >= 0 ? headers.indexOf('SETOR_CONFIRMADO') : headers.indexOf('SETORES_CONFIRMADOS');
        for (let i = 1; i < rows.length; i++) {
          if (setorIdx >= 0 && rows[i][setorIdx]) {
            const s = rows[i][setorIdx].trim();
            if (s) setores.add(s);
          }
          if (setorConfIdx >= 0 && rows[i][setorConfIdx]) {
            const setor = rows[i][setorConfIdx];
            setor.split(',').forEach(s => {
              const trimmed = s.trim();
              if (trimmed) setores.add(trimmed);
            });
          }
        }
      }
    } catch (e) { console.warn('Erro lendo MANIFESTACOES para setores:', e.message); }
    if (setores.size === 0) {
      ['SAC', 'Qualidade', 'Logística', 'Financeiro', 'Comercial'].forEach(s => setores.add(s));
    }
    res.json({ sucesso: true, total: setores.size, itens: [...setores].sort() });
  } catch (e) {
    console.error('Erro ao carregar setores:', e.message);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e), itens: ['SAC'] });
  }
});

app.get('/api/setores', middlewareEscopoEmpresa(), requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','SETOR RESPONSÁVEL','APROVADOR','APROVADOR MASTER','DIRETOR','VISUALIZADOR','AUDITOR','SETOR SAC','SETOR COMERCIAL','SETOR LOGISTICA','SETOR PRODUCAO','SETOR QUALIDADE','SETOR FINANCEIRO','SETOR TI','SETOR MARKETING','SETOR DIRETORIA'), async (req, res) => {
  try {
    // F7: tenta PostgreSQL primeiro (tabela setores)
    if (empresaRepo && typeof empresaRepo.listarSetores === 'function') {
      try {
        const pgSetores = await empresaRepo.listarSetores();
        if (pgSetores && pgSetores.length) {
          const itens = filtrarPorEmpresaConfig(pgSetores.map(s => ({ ...s, _counts: {} })), req, 'EMPRESA');
          return res.json({ sucesso:true, total:itens.length, itens, fonte:'postgresql' });
        }
      } catch (e) { console.warn('[F7] GET /setores PG falhou:', e.message); }
    }
    // Fallback Sheets — GET puro, sem criar/escrever abas.
    const data = await lerAba('CONFIG_SETORES', 500).catch(()=>[]);
    const base = data.filter(s => (s.ATIVO||'').toUpperCase() !== 'EXCLUIDO').map(s => ({ ...s, _counts: {} }));
    // EMPRESA vazia = global (visível a todos); EMPRESA preenchida = só para aquela empresa e MASTER
    const itens = filtrarPorEmpresaConfig(base, req, 'EMPRESA');
    res.json({ sucesso:true, total:itens.length, itens });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] }); }
});

app.get('/api/setores/counts', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const [faqs, regras, procs, pols, pergs] = await Promise.all([
      lerAba('FAQ_SETORES',5000).catch(()=>[]),
      lerAba('REGRAS_SETORES',5000).catch(()=>[]),
      lerAba('PROCEDIMENTOS_SETORES',5000).catch(()=>[]),
      lerAba('POLITICAS_SETORES',5000).catch(()=>[]),
      lerAba('PERGUNTAS_IA_SETORES',2000).catch(()=>[]),
    ]);
    const counts = {};
    [...new Set([...faqs,...regras,...procs,...pols,...pergs].map(r=>r.SETOR).filter(Boolean))].forEach(setor => {
      const n = normalizarTexto(setor);
      counts[setor] = {
        faqs: faqs.filter(r=>normalizarTexto(r.SETOR||'')===n&&(r.ATIVO||'SIM')!=='NÃO').length,
        regras: regras.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA').length,
        procedimentos: procs.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA').length,
        politicas: pols.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA'&&r.STATUS!=='EXPIRADA').length,
        perguntas: pergs.filter(r=>normalizarTexto(r.SETOR||'')===n&&(r.ATIVO||'SIM')!=='NÃO').length,
      };
    });
    res.json({ sucesso:true, counts });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), counts:{} }); }
});
app.get('/api/conhecimento', requerPermissao('cerebro.visualizar'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('CONHECIMENTO_SETORES',['SETOR','DESCRICAO','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS']).catch(()=>{});
    const data=await lerAba('CONHECIMENTO_SETORES',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.get('/api/procedimentos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PROCEDIMENTOS',['ID_PROCEDIMENTO','NOME','SETOR_RESPONSAVEL','DESCRICAO','PASSOS','ATIVO']).catch(()=>{});
    const data=await lerAba('PROCEDIMENTOS',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.get('/api/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('POLITICAS',['ID_POLITICA','POLITICA','SETOR_RESPONSAVEL','DESCRICAO','RESPONSAVEL','ATIVO']).catch(()=>{});
    const data=await lerAba('POLITICAS',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.post('/api/politicas', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('POLITICAS',['ID_POLITICA','POLITICA','SETOR_RESPONSAVEL','DESCRICAO','RESPONSAVEL','ATIVO','DATA_CRIACAO']).catch(()=>{});
    const id = await gerarProximoID('POLITICAS','POL','ID_POLITICA');
    const b = req.body||{};
    const obj = { ID_POLITICA: id, POLITICA: b.POLITICA||b.politica||'', SETOR_RESPONSAVEL: b.SETOR_RESPONSAVEL||b.setor||'', DESCRICAO: b.DESCRICAO||b.descricao||'', RESPONSAVEL: b.RESPONSAVEL||b.responsavel||'', DATA_CRIACAO: new Date().toLocaleDateString('pt-BR'), ATIVO: 'SIM' };
    await appendObjeto('POLITICAS', obj);
    if (conhecimentoRepo) await conhecimentoRepo.criarPolitica({ empresa: b.EMPRESA || b.empresa, setor: obj.SETOR_RESPONSAVEL, titulo: obj.POLITICA, texto: obj.DESCRICAO, responsavel: obj.RESPONSAVEL }).catch(e => console.warn('[F9] criarPolitica PG:', e.message));
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});
app.post('/api/procedimentos', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PROCEDIMENTOS',['ID_PROCEDIMENTO','NOME','SETOR_RESPONSAVEL','DESCRICAO','PASSOS','ATIVO','DATA_CRIACAO']).catch(()=>{});
    const id = await gerarProximoID('PROCEDIMENTOS','PROC','ID_PROCEDIMENTO');
    const b = req.body||{};
    const setor = b.SETOR_RESPONSAVEL||b.setor||'';
    const obj = { ID_PROCEDIMENTO: id, NOME: b.NOME||b.nome||'', SETOR_RESPONSAVEL: setor, DESCRICAO: b.DESCRICAO||b.descricao||'', PASSOS: b.PASSOS||b.passos||'', DATA_CRIACAO: new Date().toLocaleDateString('pt-BR'), ATIVO: 'SIM' };
    await appendObjeto('PROCEDIMENTOS', obj);
    if (conhecimentoRepo) await conhecimentoRepo.criarProcedimento({ empresa: b.EMPRESA || b.empresa, setor, titulo: obj.NOME, texto: (obj.DESCRICAO + ' ' + obj.PASSOS).trim(), tipo: 'GERAL' }).catch(e => console.warn('[F9] criarProcedimento PG:', e.message));
    // Espelha em PROCEDIMENTOS_SETORES para aparecer na aba Setores
    if (setor) {
      await garantirAbaComCabecalhos('PROCEDIMENTOS_SETORES', PROCEDIMENTOS_HEADERS).catch(()=>{});
      const idProc = await gerarProximoID('PROCEDIMENTOS_SETORES','PRC','ID_PROC').catch(()=>id);
      await appendObjeto('PROCEDIMENTOS_SETORES', {
        ID_PROC: idProc, SETOR: setor, EMPRESA: b.EMPRESA||'TODAS',
        NOME: b.NOME||b.nome||'', OBJETIVO: b.DESCRICAO||b.descricao||'',
        QUANDO_USAR: '', PASSOS: b.PASSOS||b.passos||'', RESPONSAVEL: b.RESPONSAVEL||b.responsavel||'',
        SETORES_ENVOLVIDOS: '', RESULTADO_ESPERADO: '', PRAZO: '',
        STATUS: 'A VALIDAR', FONTE: 'Cérebro',
        DATA_ATUALIZACAO: new Date().toLocaleDateString('pt-BR'), USUARIO: req.user?.usuario||'',
      }).catch(()=>{});
    }
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});
app.get('/api/matriz', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    garantirAbaComCabecalhos('MATRIZ_DECISAO', ['ID_MATRIZ','TEMA','SETOR_PRINCIPAL','SETORES_APOIO','SLA_HORAS','PRIORIDADE','GERA_RNC','APROVACAO','FOLLOW_UP','REGRAS']).catch(()=>{});
    const data = await lerAba('MATRIZ_DECISAO', 500);
    res.json({ sucesso: true, itens: data });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e), itens: [] }); }
});
app.patch('/api/matriz/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const id = req.params.id;
    garantirAbaComCabecalhos('MATRIZ_DECISAO', ['ID_MATRIZ','TEMA','SETOR_PRINCIPAL','SETORES_APOIO','SLA_HORAS','PRIORIDADE','GERA_RNC','APROVACAO','FOLLOW_UP','REGRAS']).catch(()=>{});
    const b = req.body||{};
    const dados = {};
    if (b.TEMA!==undefined) dados.TEMA=b.TEMA;
    if (b.SETOR_PRINCIPAL!==undefined) dados.SETOR_PRINCIPAL=b.SETOR_PRINCIPAL;
    if (b.SETORES_APOIO!==undefined) dados.SETORES_APOIO=b.SETORES_APOIO;
    if (b.SLA_HORAS!==undefined) dados.SLA_HORAS=b.SLA_HORAS;
    if (b.PRIORIDADE!==undefined) dados.PRIORIDADE=b.PRIORIDADE;
    if (b.GERA_RNC!==undefined) dados.GERA_RNC=b.GERA_RNC;
    if (b.APROVACAO!==undefined) dados.APROVACAO=b.APROVACAO;
    if (b.FOLLOW_UP!==undefined) dados.FOLLOW_UP=b.FOLLOW_UP;
    if (b.REGRAS!==undefined) dados.REGRAS=b.REGRAS;
    const reg = await atualizarPorID('MATRIZ_DECISAO', id, dados, ['ID_MATRIZ','ID']);
    if (!reg) return res.status(404).json({ sucesso: false, erro: 'Regra não encontrada.' });
    res.json({ sucesso: true, linha: reg.linha });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});
// ===== EXTRAÇÃO DE CAMPOS DE SETOR A PARTIR DE DOCUMENTO =====
app.post('/api/extrair-campos-setor', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ sucesso: false, erro: 'Texto obrigatório.' });
    if (!aiService.isDisponivel()) return res.status(400).json({ sucesso: false, erro: 'Serviço de IA não configurado.' });

    const prompt = `Você é um assistente que extrai informações de documentos internos de empresas para preencher cadastros de setores.

A partir do texto abaixo, extraia e retorne APENAS um JSON com os seguintes campos (deixe vazio se não encontrar):
- DESCRICAO: descrição resumida do setor/documento (1-2 frases)
- RESPONSABILIDADES: lista das responsabilidades do setor (bullet points com \\n)
- REGRAS_OPERACIONAIS: regras e políticas mencionadas (texto corrido ou bullets)
- PROCEDIMENTOS_ORIENTACOES: procedimentos e orientações operacionais
- ALERTAS: alertas ou pontos de atenção importantes
- SLA_HORAS: prazo em horas (apenas número, ex: 72)

Retorne APENAS o JSON, sem explicações.

TEXTO DO DOCUMENTO:
${texto.slice(0, 6000)}`;

    const resultado = await aiService.chamar(prompt, { maxTokens: 1200, contexto: 'extrair-campos-setor' });
    if (!resultado.disponivel) return res.status(503).json({ sucesso: false, erro: resultado.erro || 'IA indisponível' });
    const campos = aiService.extrairJSON(resultado.texto) || {};
    res.json({ sucesso: true, campos });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== PESQUISAS DE SATISFAÇÃO (aba interna PESQUISA_RESPOSTAS) =====
app.get('/api/pesquisas/resumo', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const todosDados = await lerRespostasPesquisa();
    const dados = filtrarPorEmpresaHistorico(todosDados, req, 'EMPRESA');
    const agora = new Date();
    const mesAtual = agora.getMonth();
    const anoAtual = agora.getFullYear();
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA || 6);
    const doMes = dados.filter(r => {
      const d = new Date(r.DATA || '');
      return !isNaN(d) && d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    });
    const viramReclamacao = doMes.filter(r => {
      const notas = [r.ATENDIMENTO, r.PRAZO_ENTREGA, r.QUALIDADE, r.RECOMENDACAO].map(v => parseFloat(String(v||'').replace(',','.'))).filter(n => !isNaN(n));
      return notas.some(n => n <= NOTA_CRITICA);
    }).length;
    res.json({ sucesso: true, totalMes: doMes.length, viramReclamacao, mes: agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }) });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e), totalMes: 0, viramReclamacao: 0 });
  }
});

// ===== ROTAS: RELATÓRIO DE SATISFAÇÃO =====
app.get('/api/pesquisas/relatorio', requerPermissao('pesquisas.visualizar'), async (req, res) => {
  try {
    let { empresa = '', ano, mes } = req.query;
    // Não-MASTER só pode ver a empresa do próprio cadastro
    const perfil = perfilCanonico(req.user?.perfil || '');
    if (perfil !== 'MASTER' && req.user?.empresa) {
      empresa = req.user.empresa;
    }
    const todasRespostas = await lerRespostasPesquisa();
    // Normaliza para campos canônicos (sem duplicar campos uppercase e camelCase)
    const dados = todasRespostas.map(r => ({
      Empresa: r.EMPRESA || '',
      Cliente: r.NOME_CLIENTE || '',
      Data: r.DATA || '',
      Atendimento: r.ATENDIMENTO || '',
      'Prazo de Entrega': r.PRAZO_ENTREGA || '',
      Qualidade: r.QUALIDADE || '',
      Recomendação: r.RECOMENDACAO || '',
      Observação: r.COMENTARIO || '',
      _id: r.ID_RESPOSTA || '',
      _token: r.TOKEN || '',
      _notaBaixa: r.NOTA_BAIXA || '',
      _statusOcp: r.STATUS_OCP || '',
    }));
    // Não retorna early aqui — continua para construir historico com dados manuais mesmo sem respostas

    const COLS_NOTA = ['Atendimento', 'Prazo de Entrega', 'Qualidade', 'Recomendação'];

    function _parseFiltro(row) {
      const raw = row.Data || row.DATA || '';
      const partes = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      const d = partes ? new Date(+partes[3], +partes[2]-1, +partes[1]) : new Date(raw);
      if (isNaN(d)) return null;
      const anoR = d.getFullYear();
      const mesR = d.getMonth() + 1;
      if (ano && Number(ano) !== anoR) return null;
      if (mes && Number(mes) !== mesR) return null;
      if (empresa) {
        const empRow = String(row.Empresa || row.EMPRESA || '').toLowerCase();
        if (!empRow.includes(empresa.toLowerCase())) return null;
      }
      return { d, anoR, mesR };
    }

    function _media(row) {
      const notas = COLS_NOTA.map(c => parseFloat(String(row[c]||'').replace(',','.'))).filter(n => !isNaN(n) && n >= 0);
      if (!notas.length) return null;
      return notas.reduce((a,b)=>a+b,0)/notas.length;
    }

    const filtrados = dados.filter(r => _parseFiltro(r) !== null);
    const medias = filtrados.map(_media).filter(n => n !== null);
    const mediaGeral = medias.length ? medias.reduce((a,b)=>a+b,0)/medias.length : null;

    const mapCrit = { atendimento: 'Atendimento', prazo: 'Prazo de Entrega', qualidade: 'Qualidade', recomendacao: 'Recomendação' };
    const criterios = Object.entries(mapCrit).map(([crit, col]) => {
      const ns = filtrados.map(r => parseFloat(String(r[col]||'').replace(',','.'))).filter(n => !isNaN(n) && n >= 0);
      return { criterio: crit, media: ns.length ? ns.reduce((a,b)=>a+b,0)/ns.length : null, total: ns.length };
    });

    // Histórico mensal (últimos 12 meses)
    const agora = new Date();
    const historicoRows = await lerHistoricoPesquisa();
    const historico = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const anoH = d.getFullYear();
      const mesH = d.getMonth() + 1;
      const mesLabel = d.toLocaleString('pt-BR',{month:'short',year:'2-digit'});
      const grupo = dados.filter(r => {
        const raw = r.Data || r.DATA || '';
        const partes = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
        const dd = partes ? new Date(+partes[3],+partes[2]-1,+partes[1]) : new Date(raw);
        if (isNaN(dd)) return false;
        if (empresa && !String(r.Empresa||r.EMPRESA||'').toLowerCase().includes(empresa.toLowerCase())) return false;
        return dd.getFullYear()===anoH && dd.getMonth()+1===mesH;
      });
      const ms = grupo.map(_media).filter(n=>n!==null);
      const crit = {};
      Object.entries(mapCrit).forEach(([c, col]) => {
        const ns = grupo.map(r=>parseFloat(String(r[col]||'').replace(',','.'))).filter(n=>!isNaN(n)&&n>=0);
        crit[c] = ns.length ? ns.reduce((a,b)=>a+b,0)/ns.length : null;
      });
      const recH = grupo.map(r=>parseFloat(String(r['Recomendação']||'').replace(',','.'))).filter(n=>!isNaN(n)&&n>=0&&n<=10);
      let npsH = null;
      if (recH.length) {
        const pH=recH.filter(n=>n>=9).length, dH=recH.filter(n=>n<=6).length;
        npsH = Math.round((pH-dH)/recH.length*100);
      }
      let entryMedia = ms.length ? ms.reduce((a,b)=>a+b,0)/ms.length : null;
      let entryTotal = ms.length;
      let entryNps = npsH;
      let entryCrit = crit;
      let fromHistorico = false;
      // Se não há respostas individuais, usa média histórica importada
      if (!ms.length) {
        const chaveH = `${anoH}-${String(mesH).padStart(2,'0')}`;
        const hRow = historicoRows.find(r => r.ANO == anoH && Number(r.MES) === mesH && (!empresa || String(r.EMPRESA||'').toLowerCase().includes(empresa.toLowerCase())));
        if (hRow) {
          const _f = v => { const n = parseFloat(String(v||'').replace(',','.')); return isNaN(n) ? null : n; };
          entryMedia = _f(hRow.NOTA_MEDIA);
          entryTotal = Number(hRow.TOTAL_RESPOSTAS) || 0;
          entryNps = _f(hRow.NPS_SCORE);
          entryCrit = { atendimento: _f(hRow.ATENDIMENTO), prazo: _f(hRow.PRAZO_ENTREGA), qualidade: _f(hRow.QUALIDADE), recomendacao: _f(hRow.RECOMENDACAO) };
          fromHistorico = true;
        }
      }
      historico.push({ mes: `${anoH}-${String(mesH).padStart(2,'0')}`, mes_label: mesLabel, media: entryMedia, total: entryTotal, nps_score: entryNps, from_historico: fromHistorico, ...entryCrit });
    }

    // Se não há respostas individuais para o mês/ano selecionado, usa histórico importado para media_geral e criterios
    if (!filtrados.length && ano && mes) {
      const _fh = v => { const n = parseFloat(String(v||'').replace(',','.')); return isNaN(n) ? null : n; };
      const hRowAtual = historicoRows.find(r => r.ANO == ano && Number(r.MES) === Number(mes) && (!empresa || String(r.EMPRESA||'').toLowerCase().includes(empresa.toLowerCase())));
      if (hRowAtual) {
        if (mediaGeral === null) mediaGeral = _fh(hRowAtual.NOTA_MEDIA);
        criterios.forEach(c => {
          if (c.media === null) {
            const colMap = { atendimento: 'ATENDIMENTO', prazo: 'PRAZO_ENTREGA', qualidade: 'QUALIDADE', recomendacao: 'RECOMENDACAO' };
            c.media = _fh(hRowAtual[colMap[c.criterio]]);
            if (c.media !== null) c.from_historico = true;
          }
        });
      }
    }

    // NPS do período filtrado
    let nps = null;
    const recScores = filtrados.map(r=>parseFloat(String(r['Recomendação']||'').replace(',','.'))).filter(n=>!isNaN(n)&&n>=0&&n<=10);
    if (recScores.length) {
      const prom=recScores.filter(n=>n>=9).length, det=recScores.filter(n=>n<=6).length, neut=recScores.length-prom-det;
      nps = {
        score: Math.round((prom-det)/recScores.length*100),
        promotores:prom, detratores:det, neutros:neut, total:recScores.length,
        promotores_pct:Math.round(prom/recScores.length*100),
        detratores_pct:Math.round(det/recScores.length*100),
        neutros_pct:Math.round(neut/recScores.length*100),
      };
    }

    // Textos salvos
    let textos = {};
    try {
      const txtRows = await lerAba('RELATORIO_SAC_TEXTOS', 500).catch(()=>[]);
      const chave = `${empresa}|${ano}|${mes}`;
      const row = txtRows.find(r => r.CHAVE === chave);
      if (row) textos = JSON.parse(row.TEXTOS || '{}');
    } catch(e) {}

    // Metadados do relatório (status, versão)
    let relMeta = null;
    try {
      const relRows = await lerRelatoriosSac();
      const chaveRel = `${empresa}|${ano}|${String(mes).padStart(2,'0')}`;
      const relRow = relRows.filter(r=>r.CHAVE===chaveRel).sort((a,b)=>Number(b.VERSAO||1)-Number(a.VERSAO||1))[0];
      if (relRow) relMeta = { id: relRow.ID_RELATORIO, status: relRow.STATUS, versao: Number(relRow.VERSAO||1), publicado_em: relRow.PUBLICADO_EM||'' };
    } catch(e) {}

    res.json({ sucesso: true, itens: filtrados, media_geral: mediaGeral, criterios, historico, textos, nps, relMeta });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e), itens: [], media_geral: null, criterios: [], historico: [], textos: {} });
  }
});

// Registro manual de resposta de pesquisa (sem token — preenchido pelo atendente)
app.post('/api/pesquisas/resposta-manual', requerPermissao('pesquisas.criar'), async (req, res) => {
  try {
    const { empresa, nome_cliente, atendimento, prazo_entrega, qualidade, recomendacao, comentario, data_referencia } = req.body || {};
    if (!empresa) return res.status(400).json({ sucesso: false, erro: 'Empresa é obrigatória.' });
    const notas = [atendimento, prazo_entrega, qualidade, recomendacao].map(v => v != null && v !== '' ? parseFloat(v) : null).filter(n => n != null && !isNaN(n));
    if (!notas.length) return res.status(400).json({ sucesso: false, erro: 'Informe ao menos uma nota.' });
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA || 6);
    const notaGeral = (notas.reduce((a, b) => a + b, 0) / notas.length).toFixed(1);
    const notaBaixa = notas.some(n => n <= NOTA_CRITICA) ? 'SIM' : 'NAO';
    const dataResp = data_referencia ? new Date(data_referencia).toISOString() : new Date().toISOString();
    const idResp = 'RSP-M-' + Date.now();
    const _HEADERS_RESP = ['ID_RESPOSTA','TOKEN','EMPRESA','NOME_CLIENTE','DATA','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','COMENTARIO','NOTA_MEDIA','NOTA_BAIXA','STATUS_OCP'];
    await garantirAbaComCabecalhos('PESQUISA_RESPOSTAS', _HEADERS_RESP);
    const _respManual = {
      ID_RESPOSTA: idResp, TOKEN: 'MANUAL', EMPRESA: empresa,
      NOME_CLIENTE: nome_cliente || '', DATA: dataResp,
      ATENDIMENTO: atendimento != null && atendimento !== '' ? String(atendimento) : '',
      PRAZO_ENTREGA: prazo_entrega != null && prazo_entrega !== '' ? String(prazo_entrega) : '',
      QUALIDADE: qualidade != null && qualidade !== '' ? String(qualidade) : '',
      RECOMENDACAO: recomendacao != null && recomendacao !== '' ? String(recomendacao) : '',
      COMENTARIO: comentario || '', NOTA_MEDIA: notaGeral, NOTA_BAIXA: notaBaixa, STATUS_OCP: '',
    };
    await appendObjeto('PESQUISA_RESPOSTAS', _respManual);
    if (pesquisaRepo) await pesquisaRepo.criarResposta(_respManual).catch(e => console.warn('[F8] criarResposta PG:', e.message));
    invalidarCacheAba('PESQUISA_RESPOSTAS');
    registrarAuditoria(req.user?.usuario, 'REGISTROU_PESQUISA_MANUAL', idResp, 'PESQUISA_RESPOSTAS', null, { empresa, notaGeral }).catch(() => {});
    res.json({ sucesso: true, id: idResp, nota_media: notaGeral });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Inserir/atualizar média histórica de um mês (dados agregados, sem respostas individuais)
app.post('/api/pesquisas/media-historica', requerPermissao('pesquisas.criar'), async (req, res) => {
  try {
    const { empresa, ano, mes, atendimento, prazo_entrega, qualidade, recomendacao, total_respostas, nps_score } = req.body || {};
    if (!empresa || !ano || !mes) return res.status(400).json({ sucesso: false, erro: 'empresa, ano e mes são obrigatórios.' });
    const _f = v => { if (v == null || v === '') return ''; const n = parseFloat(String(v).replace(',','.')); return isNaN(n) ? '' : String(n); };
    const notas = [atendimento, prazo_entrega, qualidade, recomendacao].map(v => v != null && v !== '' ? parseFloat(v) : null).filter(n => n != null && !isNaN(n));
    const notaMedia = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(2) : '';
    const _HEADERS_H = ['ID_HISTORICO','EMPRESA','ANO','MES','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','NOTA_MEDIA','NPS_SCORE','TOTAL_RESPOSTAS','CRIADO_EM'];
    await garantirAbaComCabecalhos('PESQUISA_HISTORICO', _HEADERS_H);
    invalidarCacheAba('PESQUISA_HISTORICO');
    const rows = await lerAba('PESQUISA_HISTORICO', 500).catch(() => []);
    const idx = rows.findIndex(r => r.EMPRESA === empresa && String(r.ANO) === String(ano) && String(Number(r.MES)) === String(Number(mes)));
    const idH = idx >= 0 ? rows[idx].ID_HISTORICO : 'HIS-' + Date.now();
    const obj = { ID_HISTORICO: idH, EMPRESA: empresa, ANO: String(ano), MES: String(Number(mes)), ATENDIMENTO: _f(atendimento), PRAZO_ENTREGA: _f(prazo_entrega), QUALIDADE: _f(qualidade), RECOMENDACAO: _f(recomendacao), NOTA_MEDIA: notaMedia, NPS_SCORE: _f(nps_score), TOTAL_RESPOSTAS: total_respostas != null ? String(total_respostas) : '', CRIADO_EM: new Date().toISOString() };
    if (idx >= 0) {
      const sheets = await getSheets();
      const spreadsheetId = process.env.SPREADSHEET_ID;
      const vals = _HEADERS_H.map(h => obj[h] ?? '');
      await sheets.spreadsheets.values.update({ spreadsheetId, range: `PESQUISA_HISTORICO!A${idx+2}`, valueInputOption: 'RAW', requestBody: { values: [vals] } });
    } else {
      await appendObjeto('PESQUISA_HISTORICO', obj);
    }
    invalidarCacheAba('PESQUISA_HISTORICO');
    registrarAuditoria(req.user?.usuario, 'REGISTROU_MEDIA_HISTORICA', idH, 'PESQUISA_HISTORICO', null, { empresa, ano, mes, notaMedia }).catch(() => {});
    res.json({ sucesso: true, id: idH, nota_media: notaMedia });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/pesquisas/relatorio-texto', requerPermissao('pesquisas.editar'), async (req, res) => {
  try {
    const { empresa = '', ano, mes, campo, valor } = req.body || {};
    if (!empresa || !ano || !mes || !campo) return res.status(400).json({ sucesso: false, erro: 'empresa, ano, mes e campo são obrigatórios.' });
    const chave = `${empresa}|${ano}|${mes}`;
    const sheets = await getSheets();
    const spreadsheetId = process.env.SPREADSHEET_ID;
    const aba = 'RELATORIO_SAC_TEXTOS';

    await garantirAbaComCabecalhos(aba, ['CHAVE','TEXTOS','ATUALIZADO_EM','ATUALIZADO_POR']);
    invalidarCacheAba(aba);
    const rows = await lerAba(aba, 500);
    const idx = rows.findIndex(r => r.CHAVE === chave);
    let textos = {};
    if (idx >= 0) {
      try { textos = JSON.parse(rows[idx].TEXTOS || '{}'); } catch(e) {}
    }
    textos[campo] = valor;
    const novaLinha = [chave, JSON.stringify(textos), new Date().toISOString(), req.user?.nome || req.user?.usuario || ''];
    if (idx >= 0) {
      // Atualiza linha existente (linha = idx + 2 por causa do cabeçalho)
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `${aba}!A${idx+2}`,
        valueInputOption: 'RAW',
        requestBody: { values: [novaLinha] }
      });
    } else {
      await appendObjeto(aba, { CHAVE: chave, TEXTOS: JSON.stringify(textos), ATUALIZADO_EM: new Date().toISOString(), ATUALIZADO_POR: req.user?.nome || '' });
    }
    invalidarCacheAba(aba);
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

// ===== EXCLUIR RESPOSTA DE PESQUISA (MASTER only) =====
app.delete('/api/pesquisas/respostas/:id', requerPermissao('pesquisas.gerenciar'), async (req, res) => {
  try {
    const { id } = req.params;
    const aba = 'PESQUISA_RESPOSTAS';
    const rows = await lerAba(aba, 5000);
    const idx = rows.findIndex(r => r.ID_RESPOSTA === id);
    if (idx < 0) return res.status(404).json({ sucesso: false, erro: 'Resposta não encontrada.' });

    const sheets = await getSheets();
    // Obtém o sheetId da aba
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
    const sheet = meta.data.sheets?.find(s => s.properties?.title === aba);
    if (!sheet) return res.status(404).json({ sucesso: false, erro: 'Aba não encontrada.' });
    const sheetId = sheet.properties.sheetId;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: process.env.SPREADSHEET_ID,
      requestBody: { requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: idx + 1, endIndex: idx + 2 } } }] }
    });
    invalidarCacheAba(aba);
    registrarAuditoria(req.user.usuario, 'EXCLUIU_PESQUISA', id, aba, null, {}).catch(() => {});
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

// ===== PESQUISA DECISÃO (Transformar em Manifestação / Não requer tratamento) =====
app.post('/api/pesquisas/decisao', requerPermissao('pesquisas.gerenciar'), async (req, res) => {
  try {
    const { respostaId, decisao, justificativa } = req.body || {};
    if (!respostaId || !decisao) return res.status(400).json({ sucesso: false, erro: 'respostaId e decisao são obrigatórios.' });
    if (!['MANIFESTACAO','NAO_REQUER'].includes(decisao)) return res.status(400).json({ sucesso: false, erro: 'decisao deve ser MANIFESTACAO ou NAO_REQUER.' });

    const aba = 'PESQUISA_RESPOSTAS';
    const rows = await lerAba(aba, 5000);
    const idx = rows.findIndex(r => r.ID_RESPOSTA === respostaId);
    if (idx < 0) return res.status(404).json({ sucesso: false, erro: 'Resposta não encontrada.' });
    const resposta = rows[idx];

    const sheets = await getSheets();
    const headers = await obterCabecalhos(aba);

    let manifestacaoId = null;

    if (decisao === 'MANIFESTACAO') {
      // Criar manifestação a partir da pesquisa
      manifestacaoId = await gerarProximoID('MANIFESTACOES', 'MAN', 'ID_MANIFESTACAO');
      const agora = new Date().toISOString();
      const obj = {
        ID_MANIFESTACAO: manifestacaoId,
        DATA_ABERTURA: agora,
        DATA_REGISTRO: agora,
        EMPRESA_RECLAMANTE: resposta.EMPRESA || '',
        CONTATO: resposta.NOME_CLIENTE || '',
        DESCRICAO: `[Originado de pesquisa ${respostaId}] ${resposta.COMENTARIO || 'Nota baixa na pesquisa de satisfação'}`,
        DESCRICAO_MANIFESTACAO: `[Originado de pesquisa ${respostaId}] ${resposta.COMENTARIO || ''}`,
        STATUS: 'RECEBIDA',
        TIPO: 'Reclamação',
        CANAL: 'PESQUISA',
        NOTA_PESQUISA: resposta.NOTA_MEDIA || '',
        USUARIO_CRIACAO: req.user.usuario,
        ORIGEM: 'PESQUISA_SATISFACAO',
        STATUS_TRATATIVA: 'NÃO INICIADA',
      };
      await appendObjeto('MANIFESTACOES', obj);
      invalidarCacheAba('MANIFESTACOES');
    }

    // Atualizar STATUS_OCP / decisão na pesquisa
    const novoStatus = decisao === 'MANIFESTACAO' ? 'TRANSFORMADA_MANIFESTACAO' : 'NAO_REQUER_TRATAMENTO';
    const colIdx = headers.indexOf('STATUS_OCP');
    if (colIdx >= 0) {
      const colLetter = String.fromCharCode(65 + colIdx);
      await sheets.spreadsheets.values.update({
        spreadsheetId: process.env.SPREADSHEET_ID,
        range: `${aba}!${colLetter}${idx + 2}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[novoStatus]] },
      });
    }
    invalidarCacheAba(aba);
    registrarAuditoria(req.user.usuario, `PESQUISA_DECISAO_${decisao}`, respostaId, aba, null, { justificativa, manifestacaoId }).catch(() => {});
    res.json({ sucesso: true, decisao: novoStatus, manifestacaoId });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

// ===== GESTÃO DE RELATÓRIOS (ciclo rascunho → publicado) =====
const REL_HEADERS = ['ID_RELATORIO','CHAVE','EMPRESA','ANO','MES','VERSAO','STATUS','CRIADO_EM','PUBLICADO_EM','CRIADO_POR','INDICADOR','NPS_SCORE','TEXTOS_JSON','LINK_TOKEN','DADOS_JSON'];

app.get('/api/relatorios/lista', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const empresaScope = _mcEmpresaScope(req.user);
    const rows = await lerRelatoriosSac();
    let lista = rows;
    if (empresaScope) lista = lista.filter(r => pertenceEmpresa(empresaScope, r.EMPRESA||''));
    lista = lista.map(r => ({
      id: r.ID_RELATORIO, chave: r.CHAVE, empresa: r.EMPRESA,
      ano: r.ANO, mes: r.MES, versao: Number(r.VERSAO||1),
      status: r.STATUS, criado_em: r.CRIADO_EM, publicado_em: r.PUBLICADO_EM,
      indicador: r.INDICADOR ? Number(r.INDICADOR) : null,
      nps_score: r.NPS_SCORE !== '' && r.NPS_SCORE != null ? Number(r.NPS_SCORE) : null,
    }));
    lista.sort((a,b)=>b.chave<a.chave?-1:1);
    res.json({ sucesso:true, lista });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/gerar', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { empresa, ano, mes, indicador, nps_score } = req.body||{};
    if (!empresa||!ano||!mes) return res.status(400).json({ sucesso:false, erro:'empresa, ano e mes são obrigatórios.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, empresa)) return res.status(403).json({ sucesso:false, erro:'Sem acesso a esta empresa.' });
    const chave = `${empresa}|${ano}|${String(mes).padStart(2,'0')}`;
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS);
    // Verifica se já existe rascunho para esta chave/versão
    const rows = await lerRelatoriosSac();
    const existentes = rows.filter(r=>r.CHAVE===chave);
    const maxVersao = existentes.reduce((m,r)=>Math.max(m,Number(r.VERSAO||1)),0);
    const id = `REL-${Date.now().toString(36).toUpperCase()}`;
    const obj = {
      ID_RELATORIO:id, CHAVE:chave, EMPRESA:empresa, ANO:String(ano), MES:String(mes).padStart(2,'0'),
      VERSAO:String(maxVersao+1), STATUS:'RASCUNHO',
      CRIADO_EM:new Date().toISOString(), PUBLICADO_EM:'',
      CRIADO_POR:req.user?.nome||req.user?.usuario||'',
      INDICADOR:indicador!=null?String(indicador):'', NPS_SCORE:nps_score!=null?String(nps_score):'',
      TEXTOS_JSON:'',
    };
    await appendObjeto('RELATORIOS_SAC', obj);
    if (pesquisaRepo) await pesquisaRepo.criarRelatorio(obj).catch(e => console.warn('[F8] criarRelatorio PG:', e.message));
    invalidarCacheAba('RELATORIOS_SAC');
    res.json({ sucesso:true, id, versao:maxVersao+1 });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/:id/publicar', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { textos, indicador, nps_score } = req.body||{};
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS);
    const rows = await lerRelatoriosSac();
    const idx = rows.findIndex(r=>r.ID_RELATORIO===id);
    if (idx<0) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    const row = rows[idx];
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    const atualizado = {
      STATUS:'PUBLICADO',
      PUBLICADO_EM:new Date().toISOString(),
      INDICADOR:indicador!=null?String(indicador):(row.INDICADOR||''),
      NPS_SCORE:nps_score!=null?String(nps_score):(row.NPS_SCORE||''),
      TEXTOS_JSON:textos?JSON.stringify(textos):(row.TEXTOS_JSON||''),
    };
    await atualizarPorID('RELATORIOS_SAC', id, atualizado, ['ID_RELATORIO']);
    invalidarCacheAba('RELATORIOS_SAC');
    res.json({ sucesso:true });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/:id/nova-versao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS);
    const rows = await lerRelatoriosSac();
    const orig = rows.find(r=>r.ID_RELATORIO===id);
    if (!orig) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (orig.STATUS!=='PUBLICADO') return res.status(400).json({ sucesso:false, erro:'Somente relatórios publicados podem ter nova versão.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, orig.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso.' });
    const mesmaChave = rows.filter(r=>r.CHAVE===orig.CHAVE);
    const maxVersao = mesmaChave.reduce((m,r)=>Math.max(m,Number(r.VERSAO||1)),0);
    const novoId = `REL-${Date.now().toString(36).toUpperCase()}`;
    const novoObj = {
      ID_RELATORIO:novoId, CHAVE:orig.CHAVE, EMPRESA:orig.EMPRESA,
      ANO:orig.ANO, MES:orig.MES, VERSAO:String(maxVersao+1), STATUS:'RASCUNHO',
      CRIADO_EM:new Date().toISOString(), PUBLICADO_EM:'',
      CRIADO_POR:req.user?.nome||req.user?.usuario||'',
      INDICADOR:orig.INDICADOR||'', NPS_SCORE:orig.NPS_SCORE||'',
      TEXTOS_JSON:orig.TEXTOS_JSON||'',
    };
    await appendObjeto('RELATORIOS_SAC', novoObj);
    invalidarCacheAba('RELATORIOS_SAC');
    res.json({ sucesso:true, id:novoId, versao:maxVersao+1 });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// Gerar (ou reutilizar) link compartilhável público para o relatório publicado
app.post('/api/relatorios/:id/link', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { dados } = req.body||{}; // snapshot JSON dos dados do relatório
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS);
    const rows = await lerRelatoriosSac();
    const row = rows.find(r=>r.ID_RELATORIO===id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (row.STATUS!=='PUBLICADO') return res.status(400).json({ sucesso:false, erro:'Somente relatórios publicados podem ser compartilhados.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso.' });
    // Reutiliza token existente ou gera novo
    let token = row.LINK_TOKEN||'';
    if (!token) {
      token = require('crypto').randomBytes(18).toString('base64url');
      const atualizado = { LINK_TOKEN: token };
      if (dados) atualizado.DADOS_JSON = typeof dados==='string' ? dados : JSON.stringify(dados);
      await atualizarPorID('RELATORIOS_SAC', id, atualizado, ['ID_RELATORIO']);
      invalidarCacheAba('RELATORIOS_SAC');
    } else if (dados) {
      // Atualiza snapshot sem alterar token
      await atualizarPorID('RELATORIOS_SAC', id, { DADOS_JSON: typeof dados==='string' ? dados : JSON.stringify(dados) }, ['ID_RELATORIO']);
      invalidarCacheAba('RELATORIOS_SAC');
    }
    const link = `${APP_URL}/relatorio-publico/${token}`;
    await registrarAuditoria('RELATORIO_LINK_GERADO', `Link gerado para ${id} (${row.CHAVE})`, req.user?.nome||'', row.EMPRESA);
    res.json({ sucesso:true, token, link });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// Rota pública: visualizar relatório pelo token (somente leitura, sem login)
app.get('/relatorio-publico/:token', async (req, res) => {
  try {
    const { token } = req.params;
    if (!token || token.length < 10) return res.status(400).send('Token inválido.');
    const rows = await lerRelatoriosSac();
    const row = rows.find(r=>r.LINK_TOKEN===token);
    if (!row || row.STATUS!=='PUBLICADO') return res.status(404).send('Relatório não encontrado ou não publicado.');
    let dados = {};
    try { dados = JSON.parse(row.DADOS_JSON||'{}'); } catch(e) {}
    let textos = {};
    try { textos = JSON.parse(row.TEXTOS_JSON||'{}'); } catch(e) {}
    const empresa = row.EMPRESA||'';
    const ano = row.ANO||'', mes = row.MES||'', versao = row.VERSAO||'1';
    const ind = row.INDICADOR ? parseFloat(row.INDICADOR) : null;
    const npsScore = row.NPS_SCORE !== '' && row.NPS_SCORE != null ? parseInt(row.NPS_SCORE) : null;
    const LOGOS = {'CHIACCHIO':'/assets/logo-chiacchio-embalagens.svg','PLASCHIO':'/assets/logo-plaschio.svg','TUBAHIA':'/assets/logo-tubahia.svg','LOGCHIO':'/assets/logo-chiacchio-embalagens.svg','SOLARCHIO':'/assets/logo-chiacchio-embalagens.svg','PREMOCHIO':'/assets/logo-chiacchio-embalagens.svg'};
    const empKey = Object.keys(LOGOS).find(k=>empresa.toUpperCase().includes(k))||'CHIACCHIO';
    const logo = LOGOS[empKey];
    const MN=['','janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
    const mesNome = MN[parseInt(mes)]||mes;
    const GREEN='#1E6B3A',RED='#C70602',AMB='#B07A12';
    const indColor = ind!=null?(ind>=8.5?GREEN:ind>=7?AMB:RED):'#545252';
    const npsColor = npsScore!=null?(npsScore>=50?GREEN:npsScore>=0?AMB:RED):RED;
    const SEC=[['desempenho','Desempenho geral'],['analise_critica','Análise crítica'],['pontos_fortes','Pontos fortes'],['oportunidades','Oportunidades de melhoria'],['acoes','Ações recomendadas']];
    const f2=(v)=>v!=null?v.toFixed(2).replace('.',','):'—';
    const esc=(v)=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
    let secoes='';
    SEC.forEach(([id,titulo])=>{
      const txt=String(textos[id]||'').trim();
      if(txt) secoes+=`<section><h3>${esc(titulo)}</h3>${txt.split('\n').filter(Boolean).map(p=>`<p>${esc(p)}</p>`).join('')}</section>`;
    });
    const html=`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Relatório de Satisfação · ${esc(empresa)} · ${mesNome.charAt(0).toUpperCase()+mesNome.slice(1)}/${esc(ano)}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Montserrat,system-ui,sans-serif;background:#F4F4F4;color:#1F1F1F;padding:0 0 40px}
.container{max-width:820px;margin:0 auto;padding:24px 16px;display:flex;flex-direction:column;gap:16px}
.card{background:#fff;border-radius:12px;border:1px solid #E4E4E4;padding:20px 22px}
.header{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.header img{max-height:44px}
.kicker{font-size:10px;font-weight:700;letter-spacing:.12em;color:#929090;text-transform:uppercase;margin-bottom:4px}
.h1{font-size:22px;font-weight:800;letter-spacing:-.01em}
.hero{border-radius:12px;padding:22px 24px;display:flex;flex-direction:column;gap:8px}
.hero-v{font-size:52px;font-weight:800;letter-spacing:-.03em;line-height:1;color:#fff}
.badge{display:inline-block;background:#E6EEF8;color:#24508F;font-size:11px;font-weight:700;padding:3px 10px;border-radius:20px}
section h3{font-size:14px;font-weight:700;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid #EFEFEF}
section p{font-size:13px;color:#3A3A3A;line-height:1.65;margin-top:6px}
.nps-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}
.nps-pill{display:flex;flex-direction:column;align-items:center;border-radius:8px;padding:8px 16px;gap:2px;min-width:80px}
.footer{text-align:center;font-size:11px;color:#929090;margin-top:8px}
.print-btn{position:fixed;bottom:24px;right:24px;background:#1F1F1F;color:#fff;border:0;border-radius:10px;padding:12px 22px;font-family:inherit;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.2)}
@media print{.print-btn{display:none}body{background:#fff;padding:0}.card{border:0;border-radius:0;padding:16px 0}}
</style>
</head>
<body>
<div class="container">
  <div class="card header">
    <img src="${esc(logo)}" alt="${esc(empresa)}">
    <div>
      <div class="kicker">Relatório de pesquisa de satisfação de clientes</div>
      <div class="h1">${esc(empresa.toUpperCase())} · ${esc(mesNome.charAt(0).toUpperCase()+mesNome.slice(1))}/${esc(ano)}</div>
      <div style="font-size:12px;color:#929090;margin-top:4px">Versão ${esc(versao)} · Publicado em ${row.PUBLICADO_EM?new Date(row.PUBLICADO_EM).toLocaleDateString('pt-BR'):''} · Somente leitura</div>
    </div>
  </div>
  ${ind!=null?`<div class="hero" style="background:${indColor}">
    <span style="font-size:11px;font-weight:700;letter-spacing:.1em;opacity:.9;color:#fff">INDICADOR DE SATISFAÇÃO DO MÊS</span>
    <span class="hero-v">${f2(ind)}</span>
    <span style="color:#fff;font-size:13px;font-weight:600">${ind>=8.5?'Acima da meta de 8,50':'Abaixo da meta de 8,50'}</span>
  </div>`:''}
  ${npsScore!=null?`<div class="card">
    <div class="kicker">NPS — Indicador complementar</div>
    <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-top:8px">
      <div><span class="badge">Net Promoter Score</span><div style="font-size:42px;font-weight:800;color:${npsColor};margin-top:4px">${npsScore>0?'+':''}${npsScore}</div></div>
      <div class="nps-row">
        ${dados.nps?`<div class="nps-pill" style="background:#E6F2EA"><span style="font-size:11px;color:#1E6B3A;font-weight:600">Promotores</span><b style="font-size:18px;color:#1E6B3A">${dados.nps.promotores_pct||0}%</b><span style="font-size:11px;color:#666464">${dados.nps.promotores||0} resp.</span></div><div class="nps-pill" style="background:#EEEEEE"><span style="font-size:11px;color:#545252;font-weight:600">Neutros</span><b style="font-size:18px;color:#545252">${dados.nps.neutros_pct||0}%</b><span style="font-size:11px;color:#666464">${dados.nps.neutros||0} resp.</span></div><div class="nps-pill" style="background:#FDECEC"><span style="font-size:11px;color:#A80502;font-weight:600">Detratores</span><b style="font-size:18px;color:#A80502">${dados.nps.detratores_pct||0}%</b><span style="font-size:11px;color:#666464">${dados.nps.detratores||0} resp.</span></div>`:''}
      </div>
    </div>
  </div>`:''}
  ${secoes?`<div class="card">${secoes}</div>`:''}
  <div class="footer">Documento gerado automaticamente pelo Assistente SAC · Grupo Chiacchio</div>
</div>
<button class="print-btn" onclick="window.print()">⬇ Baixar PDF</button>
</body>
</html>`;
    res.setHeader('Content-Type','text/html; charset=utf-8');
    res.send(html);
  } catch(e) { res.status(500).send('Erro ao carregar relatório.'); }
});

// ===== ROTA PÚBLICA: PESQUISA DE SATISFAÇÃO =====
const _pesquisaPublicaHTML = (empresa) => {
  const slug = empresa === 'chiacchio' ? 'chiacchio' : empresa === 'plaschio' ? 'plaschio' : (empresa === 'tubahia' || empresa === 'cesbap') ? 'tubahia' : empresa === 'logchio' ? 'logchio' : empresa === 'solarchio' ? 'solarchio' : empresa === 'premochio' ? 'premochio' : 'chiacchio';
  const titulo = slug === 'chiacchio' ? 'Chiacchio Embalagens' : slug === 'plaschio' ? 'Plaschio' : slug === 'tubahia' ? 'Cesbap' : slug === 'logchio' ? 'Logchio' : slug === 'solarchio' ? 'Solarchio' : slug === 'premochio' ? 'Premochio' : 'Chiacchio Embalagens';
  const brandColor = slug === 'tubahia' ? '#2B2070' : '#B9171A';
  const brandSoft = slug === 'tubahia' ? '#D9D6F0' : '#FFE1E0';
  const brandHover = slug === 'tubahia' ? '#1F1760' : '#A80502';
  const logoPath = slug === 'chiacchio' ? '/assets/logo-chiacchio-new.png' : slug === 'plaschio' ? '/assets/logo-plaschio-new.png' : slug === 'tubahia' ? '/assets/logo-tubahia-new.png' : slug === 'logchio' ? '/assets/logo-chiacchio-new.png' : slug === 'solarchio' ? '/assets/logo-chiacchio-new.png' : slug === 'premochio' ? '/assets/logo-chiacchio-new.png' : '/assets/logo-chiacchio-new.png';
  const perguntas = [
    { id:'recomendacao', label:'Em uma escala de 0 a 10, o quanto você nos recomendaria a um amigo ou colega?', tipo:'nps', obrig:true },
    { id:'qualidade', label:'Como você avalia a qualidade dos nossos produtos?', tipo:'escala', obrig:true },
    { id:'prazo', label:'Como você avalia o prazo de entrega?', tipo:'escala', obrig:false },
    { id:'atendimento', label:'Como você avalia o atendimento recebido?', tipo:'escala', obrig:false },
    { id:'motivo', label:'Qual o principal motivo da sua compra?', tipo:'multipla', opcoes:['Qualidade','Preço','Prazo de entrega','Parceria','Indicação','Outro'], obrig:false },
    { id:'comentario', label:'Algum comentário ou sugestão? (opcional)', tipo:'texto', obrig:false },
  ];
  const totalEtapas = perguntas.length + 2; // +boas-vindas +confirmação
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Pesquisa de Satisfação · ${titulo}</title>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{min-height:100vh;font-family:Montserrat,system-ui,sans-serif}
body{background:${brandColor};display:flex;flex-direction:column;align-items:center;justify-content:flex-start;padding:env(safe-area-inset-top,0) 0 env(safe-area-inset-bottom,0)}
.wrap{width:100%;max-width:480px;min-height:100vh;display:flex;flex-direction:column;padding:0 16px 32px}
/* barra de progresso */
.prog-bar{width:100%;height:4px;background:rgba(255,255,255,.3);border-radius:2px;margin:20px 0 0}
.prog-fill{height:4px;background:#fff;border-radius:2px;transition:width .4s ease}
/* etapas */
.etapa{display:none;flex-direction:column;flex:1;animation:fadeUp .3s ease}
.etapa.ativa{display:flex}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
/* boas-vindas */
.bv-logo{margin:32px auto 0;display:block;text-align:center}
.bv-nome{font-size:22px;font-weight:800;color:#fff;text-align:center;margin-top:12px;letter-spacing:-.3px}
.bv-card{background:#fff;border-radius:20px;padding:28px 24px;margin-top:24px;text-align:center}
.bv-card h1{font-size:20px;font-weight:700;color:#1F1F1F;margin-bottom:10px}
.bv-card p{font-size:13.5px;color:#545252;line-height:1.6}
.bv-inputs{margin-top:20px;text-align:left}
.bv-inputs label{font-size:12px;font-weight:600;color:#545252;display:block;margin-bottom:5px;margin-top:12px}
.bv-inputs input{width:100%;border:1.5px solid #E4E4E4;border-radius:10px;padding:11px 13px;font-size:14px;font-family:inherit;color:#1F1F1F;outline:none;transition:border .2s}
.bv-inputs input:focus{border-color:${brandColor}}
/* card de pergunta */
.pq-card{background:#fff;border-radius:20px;padding:28px 24px;margin-top:24px;flex:1}
.pq-num{font-size:11px;font-weight:700;color:${brandColor};letter-spacing:1px;margin-bottom:8px}
.pq-label{font-size:16px;font-weight:700;color:#1F1F1F;line-height:1.4;margin-bottom:20px}
/* NPS 0-10 */
.nps-grid{display:grid;grid-template-columns:repeat(11,1fr);gap:5px}
@media(max-width:380px){.nps-grid{grid-template-columns:repeat(6,1fr)}}
.nps-btn{aspect-ratio:1;border:2px solid #E4E4E4;border-radius:10px;background:#fff;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;color:#1F1F1F;transition:all .12s;display:flex;align-items:center;justify-content:center}
.nps-btn:hover{border-color:${brandColor};color:${brandColor}}
.nps-btn.sel{background:${brandColor};border-color:${brandColor};color:#fff;transform:scale(1.08)}
.nps-labels{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:#929090;font-weight:500}
/* escala 1-10 */
.esc-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}
.esc-btn{aspect-ratio:1;border:2px solid #E4E4E4;border-radius:10px;background:#fff;font-size:18px;font-weight:700;cursor:pointer;font-family:inherit;color:#1F1F1F;transition:all .12s;display:flex;align-items:center;justify-content:center}
.esc-btn:hover{border-color:${brandColor};color:${brandColor}}
.esc-btn.sel{background:${brandColor};border-color:${brandColor};color:#fff;transform:scale(1.08)}
.esc-labels{display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:#929090;font-weight:500}
/* múltipla escolha */
.mult-opts{display:flex;flex-direction:column;gap:8px}
.mult-opt{border:2px solid #E4E4E4;border-radius:10px;padding:12px 14px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit;color:#1F1F1F;background:#fff;text-align:left;transition:all .12s}
.mult-opt:hover{border-color:${brandColor};color:${brandColor}}
.mult-opt.sel{border-color:${brandColor};background:${brandSoft};color:${brandColor}}
/* textarea */
.pq-textarea{width:100%;border:1.5px solid #E4E4E4;border-radius:10px;padding:12px 14px;font-size:14px;font-family:inherit;resize:vertical;min-height:100px;color:#1F1F1F;outline:none;transition:border .2s;line-height:1.5}
.pq-textarea:focus{border-color:${brandColor}}
/* obrigatório aviso */
.aviso-obrig{font-size:12px;color:${brandColor};font-weight:600;display:none;margin-top:8px}
/* botões de navegação */
.nav{display:flex;gap:10px;margin-top:20px}
.btn-prox{flex:1;background:${brandColor};color:#fff;border:none;border-radius:12px;padding:15px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;letter-spacing:.2px;transition:background .15s}
.btn-prox:hover{background:${brandHover}}
.btn-prox:disabled{background:rgba(0,0,0,.25);cursor:not-allowed}
.btn-vol{background:rgba(255,255,255,.25);color:#fff;border:2px solid rgba(255,255,255,.5);border-radius:12px;padding:14px 18px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .15s}
.btn-vol:hover{background:rgba(255,255,255,.35)}
/* confirmação */
.conf-card{background:#fff;border-radius:20px;padding:36px 24px;margin-top:32px;text-align:center}
.conf-icon{font-size:48px;margin-bottom:16px}
.conf-card h2{font-size:20px;font-weight:800;color:#1F1F1F;margin-bottom:10px}
.conf-card p{font-size:14px;color:#545252;line-height:1.6}
/* nota selecionada grande */
.nota-selecionada{text-align:center;margin-top:16px;font-size:64px;font-weight:800;color:${brandColor};min-height:80px;transition:opacity .2s}
</style>
</head>
<body>
<div class="wrap">

  <!-- Barra de progresso -->
  <div class="prog-bar"><div class="prog-fill" id="prog" style="width:0%"></div></div>

  <!-- ETAPA 0: Boas-vindas -->
  <div class="etapa ativa" id="et-0">
    <div class="bv-logo">
      <img src="${logoPath}" alt="${titulo}" style="height:64px;max-width:220px;width:auto;display:block;margin:32px auto 0;object-fit:contain;background:#fff;border-radius:10px;padding:8px 14px;box-sizing:border-box">
    </div>
    <div class="bv-nome">${titulo}</div>
    <div class="bv-card">
      <h1>Pesquisa de Satisfação</h1>
      <p>Sua opinião é fundamental para continuarmos melhorando nossos produtos e atendimento. Leva menos de 2 minutos.</p>
      <div class="bv-inputs">
        <label>Seu nome <span style="color:#929090;font-weight:400">(opcional)</span></label>
        <input type="text" id="pq-nome" placeholder="João Silva" autocomplete="name">
        <label>Sua empresa <span style="color:#929090;font-weight:400">(opcional)</span></label>
        <input type="text" id="pq-empresa-cliente" placeholder="Empresa ABC" autocomplete="organization">
      </div>
    </div>
    <div class="nav"><button class="btn-prox" onclick="irPara(1)">Começar →</button></div>
  </div>

  <!-- ETAPAS DAS PERGUNTAS (geradas pelo JS) -->
  ${perguntas.map((p,i)=>`<div class="etapa" id="et-${i+1}">
    <div class="pq-card">
      <div class="pq-num">PERGUNTA ${i+1} DE ${perguntas.length}</div>
      <div class="pq-label">${p.label}</div>
      ${p.tipo==='nps'?`
        <div class="nps-grid" id="grid-${p.id}">
          ${[0,1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="nps-btn" data-v="${n}" onclick="sel('${p.id}',${n},this)">${n}</button>`).join('')}
        </div>
        <div class="nps-labels"><span>Nada provável</span><span>Muito provável</span></div>
        <div class="nota-selecionada" id="big-${p.id}" style="opacity:0">—</div>
      `:p.tipo==='escala'?`
        <div class="esc-grid" id="grid-${p.id}">
          ${[1,2,3,4,5,6,7,8,9,10].map(n=>`<button type="button" class="esc-btn" data-v="${n}" onclick="sel('${p.id}',${n},this)">${n}</button>`).join('')}
        </div>
        <div class="esc-labels"><span>Muito ruim</span><span>Excelente</span></div>
        <div class="nota-selecionada" id="big-${p.id}" style="opacity:0">—</div>
      `:p.tipo==='multipla'?`
        <div class="mult-opts" id="grid-${p.id}">
          ${p.opcoes.map(o=>`<button type="button" class="mult-opt" data-v="${o}" onclick="selMult('${p.id}',this)">${o}</button>`).join('')}
        </div>
      `:`
        <textarea class="pq-textarea" id="txt-${p.id}" placeholder="Digite aqui…"></textarea>
      `}
      <div class="aviso-obrig" id="aviso-${p.id}">Por favor, responda esta pergunta para continuar.</div>
    </div>
    <div class="nav">
      ${i>0?`<button class="btn-vol" onclick="irPara(${i})">←</button>`:''}
      <button class="btn-prox" id="btn-${i+1}" onclick="avancar(${i+1},${perguntas.length},'${p.id}',${p.obrig},'${p.tipo}')">${i===perguntas.length-1?'Enviar pesquisa ✓':'Próxima →'}</button>
    </div>
  </div>`).join('')}

  <!-- ETAPA FINAL: Confirmação -->
  <div class="etapa" id="et-${perguntas.length+1}">
    <div class="conf-card">
      <div class="conf-icon">✅</div>
      <h2>Obrigado pelo seu feedback!</h2>
      <p>Sua resposta foi registrada com sucesso. Ela nos ajuda a melhorar continuamente os nossos produtos e atendimento.</p>
      <div style="margin-top:20px;padding:14px;background:#F4F4F4;border-radius:10px;font-size:12.5px;color:#666464;line-height:1.5">
        Este formulário é da <strong>${titulo}</strong>. Suas informações são tratadas com sigilo.
      </div>
    </div>
  </div>

</div>
<script>
const _totalEtapas=${totalEtapas};
const _respostas={};
let _etapaAtual=0;

function irPara(n){
  document.querySelector('.etapa.ativa').classList.remove('ativa');
  const nova=document.getElementById('et-'+n);
  if(nova){nova.classList.add('ativa');_etapaAtual=n;}
  const pct=Math.round(n/(_totalEtapas-1)*100);
  document.getElementById('prog').style.width=pct+'%';
  window.scrollTo({top:0,behavior:'smooth'});
}

function sel(id,val,btn){
  const grid=document.getElementById('grid-'+id);
  grid.querySelectorAll('button').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  _respostas[id]=val;
  const big=document.getElementById('big-'+id);
  if(big){big.textContent=val;big.style.opacity='1';}
  const av=document.getElementById('aviso-'+id);
  if(av)av.style.display='none';
}

function selMult(id,btn){
  const grid=document.getElementById('grid-'+id);
  grid.querySelectorAll('button').forEach(b=>b.classList.remove('sel'));
  btn.classList.add('sel');
  _respostas[id]=btn.dataset.v;
  const av=document.getElementById('aviso-'+id);
  if(av)av.style.display='none';
}

function avancar(etapa,total,pid,obrig,tipo){
  if(tipo==='texto'){
    const t=document.getElementById('txt-'+pid);
    _respostas[pid]=t?t.value.trim():'';
  }
  if(obrig&&(_respostas[pid]===undefined||_respostas[pid]==='')&&tipo!=='texto'){
    const av=document.getElementById('aviso-'+pid);
    if(av)av.style.display='block';
    return;
  }
  if(etapa>=total){
    enviar();
  } else {
    irPara(etapa+1);
  }
}

async function enviar(){
  const btn=document.getElementById('btn-'+${perguntas.length});
  if(btn){btn.disabled=true;btn.textContent='Enviando...';}
  const dados={
    empresa:'${titulo}',
    nome:document.getElementById('pq-nome').value||'',
    empresa_cliente:document.getElementById('pq-empresa-cliente').value||'',
    recomendaria_a_empresa:_respostas.recomendacao??'',
    qualidade_do_produto:_respostas.qualidade??'',
    prazo_de_entrega:_respostas.prazo??'',
    atendimento:_respostas.atendimento??'',
    motivo:_respostas.motivo??'',
    comentario:_respostas.comentario??'',
    data:new Date().toISOString()
  };
  try{
    const resp=await fetch('/api/pesquisas/resposta-publica',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(dados)
    });
    if(!resp.ok){
      const j=await resp.json().catch(()=>({}));
      throw new Error(j.erro||'Erro ao registrar resposta ('+resp.status+').');
    }
    irPara(${perguntas.length+1});
  }catch(err){
    if(btn){btn.disabled=false;btn.textContent='Enviar pesquisa ✓';}
    const av=document.createElement('div');
    av.style.cssText='background:#FEE2E2;color:#991B1B;border-radius:10px;padding:12px 14px;font-size:13px;margin-top:12px;font-weight:600';
    av.textContent='Não foi possível registrar sua resposta. Verifique sua conexão e tente novamente.';
    const nav=btn?.closest('.nav');if(nav)nav.after(av);
  }
}
</script>
</body>
</html>`;
};

app.post('/api/pesquisas/resposta-publica', async (req, res) => {
  try {
    const body = req.body || {};
    const aba = 'PESQUISA_RESPOSTAS';
    const _HEADERS_RESP = ['ID_RESPOSTA','TOKEN','EMPRESA','NOME_CLIENTE','DATA','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','COMENTARIO','NOTA_MEDIA','NOTA_BAIXA','STATUS_OCP'];
    await garantirAbaComCabecalhos(aba, _HEADERS_RESP);
    const atendimento = String(body.atendimento || '');
    const prazo = String(body.prazo_de_entrega || '');
    const qualidade = String(body.qualidade_do_produto || '');
    const recomendacao = String(body.recomendaria_a_empresa || '');
    const notas = [atendimento, prazo, qualidade, recomendacao].map(n => parseFloat(n)).filter(n => !isNaN(n) && n > 0);
    const notaMedia = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(1) : '';
    const notaBaixa = notas.length && notas.some(n => n <= Number(process.env.PESQUISA_NOTA_CRITICA||6)) ? 'SIM' : 'NAO';
    await appendObjeto(aba, {
      ID_RESPOSTA: 'RSP-' + Date.now(), TOKEN: '',
      EMPRESA: body.empresa || '', NOME_CLIENTE: body.nome || '',
      DATA: new Date().toISOString(),
      ATENDIMENTO: atendimento, PRAZO_ENTREGA: prazo, QUALIDADE: qualidade, RECOMENDACAO: recomendacao,
      COMENTARIO: body.comentario || '', NOTA_MEDIA: notaMedia, NOTA_BAIXA: notaBaixa, STATUS_OCP: '',
    });
    invalidarCacheAba(aba);
    res.json({ sucesso: true });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

// ============================================================
// MÓDULO: PESQUISA DE SATISFAÇÃO — TOKENS + OCP + QUESTIONÁRIO
// ============================================================

// Helper: gera token único alfanumérico
function _gerarTokenPesquisa() {
  return require('crypto').randomBytes(18).toString('base64url').slice(0,24);
}

// Helper: verifica se token expirou
function _tokenExpirado(row) {
  if (!row.EXPIRA_EM) return false;
  return new Date(row.EXPIRA_EM) < new Date();
}

// Helper: empresa canônica para display
function _empresaDisplay(cod) {
  const m = { CHIACCHIO:'Chiacchio Embalagens', PLASCHIO:'Plaschio', TUBAHIA:'Cesbap', MASTER:'Grupo Chiacchio' };
  return m[empresaCanonica(cod||'')] || cod || '';
}

// Gerar token de pesquisa (individual ou geral/empresa)
app.post('/api/pesquisas/tokens/gerar', requerPermissao('pesquisas.criar'), async (req, res) => {
  try {
    const { empresa, nome_cliente, id_manifestacao, dias_validade = 30 } = req.body || {};
    if (!empresa) return res.status(400).json({ sucesso: false, erro: 'empresa obrigatório.' });
    const _pf = perfilCanonico(req.user?.perfil||'');
    if (_pf !== 'MASTER' && !pertenceEmpresa(req.user?.empresa, empresa)) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    // Verificar reenvio: se já respondeu nos últimos 90 dias não reenvia
    if (nome_cliente && id_manifestacao) {
      const tokens = await lerAba('PESQUISA_TOKENS', 2000).catch(()=>[]);
      const noventa = new Date(); noventa.setDate(noventa.getDate()-90);
      const recent = tokens.find(t => t.ID_MANIFESTACAO === id_manifestacao && t.STATUS === 'RESPONDIDO' && new Date(t.DATA_RESPOSTA||0) > noventa);
      if (recent) return res.status(409).json({ sucesso: false, erro: 'Cliente já respondeu nos últimos 90 dias.', token: recent.TOKEN });
    }
    await garantirAbaComCabecalhos('PESQUISA_TOKENS', ['TOKEN','EMPRESA','NOME_CLIENTE','EMAIL_CLIENTE','ID_MANIFESTACAO','STATUS','CRIADO_EM','EXPIRA_EM','DATA_ABERTURA','DATA_RESPOSTA','CRIADO_POR']);
    const token = _gerarTokenPesquisa();
    const expira = new Date(); expira.setDate(expira.getDate() + Number(dias_validade));
    await appendObjeto('PESQUISA_TOKENS', {
      TOKEN: token, EMPRESA: empresa, NOME_CLIENTE: nome_cliente||'', EMAIL_CLIENTE: req.body.email_cliente||'',
      ID_MANIFESTACAO: id_manifestacao||'', STATUS: 'ENVIADO',
      CRIADO_EM: new Date().toISOString(), EXPIRA_EM: expira.toISOString(),
      DATA_ABERTURA: '', DATA_RESPOSTA: '', CRIADO_POR: req.user?.usuario||'',
    });
    invalidarCacheAba('PESQUISA_TOKENS');
    const link = `${req.protocol}://${req.get('host')}/pesquisa/${token}`;
    res.json({ sucesso: true, token, link, expira: expira.toISOString() });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'gerar-token-pesquisa') }); }
});

// Listar tokens de pesquisa
app.get('/api/pesquisas/tokens', requerPermissao('pesquisas.visualizar'), async (req, res) => {
  try {
    const rows = await lerAba('PESQUISA_TOKENS', 2000).catch(()=>[]);
    const _pf = perfilCanonico(req.user?.perfil||'');
    const scope = _pf === 'MASTER' ? null : (req.user?.empresa||null);
    const host = `${req.protocol}://${req.get('host')}`;
    const itens = rows
      .filter(r => !scope || pertenceEmpresa(scope, r.EMPRESA||''))
      .map(r => ({ ...r, link: `${host}/pesquisa/${r.TOKEN}`, expirado: _tokenExpirado(r) }));
    res.json({ sucesso: true, total: itens.length, itens });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'listar-tokens') }); }
});

// Marcar token como aberto (frontend público chama ao carregar)
app.post('/api/pesquisas/tokens/:token/abrir', async (req, res) => {
  try {
    const rows = await lerAba('PESQUISA_TOKENS', 2000).catch(()=>[]);
    const idx = rows.findIndex(r => r.TOKEN === req.params.token);
    if (idx < 0) return res.status(404).json({ sucesso: false });
    const row = rows[idx];
    if (row.STATUS === 'ENVIADO') {
      await atualizarPorID('PESQUISA_TOKENS', row.TOKEN, { STATUS: 'ABERTO', DATA_ABERTURA: new Date().toISOString() }, ['TOKEN']);
      invalidarCacheAba('PESQUISA_TOKENS');
    }
    res.json({ sucesso: true });
  } catch(e) { res.json({ sucesso: false }); }
});

// Rota pública por token
// Página pública dedicada (fora da ferramenta): servida quando o cliente acessa
// /pesquisa sem token, ou apaga parte da URL. Antes isso redirecionava para "/"
// (tela de login do sistema interno) — agora mostra uma página neutra e segura.
const _pesquisaLandingHTML = () => `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><title>Pesquisa de Satisfação — Grupo Chiacchio</title>
<style>body{margin:0;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#F4F5F7;color:#2A2A2A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{background:#fff;border:1px solid #E4E4E4;border-radius:14px;max-width:460px;width:100%;padding:32px;text-align:center;box-shadow:0 2px 12px rgba(0,0,0,.05)}
h1{font-size:19px;margin:14px 0 6px;color:#B9171A}p{font-size:14px;line-height:1.6;color:#555}
.badge{display:inline-flex;align-items:center;justify-content:center;width:56px;height:56px;border-radius:50%;background:#FDECEC;color:#B9171A;font-size:26px}
.hint{margin-top:18px;font-size:12.5px;color:#8A8A8A;border-top:1px solid #EFEFEF;padding-top:14px}</style></head>
<body><div class="card"><div class="badge">★</div>
<h1>Pesquisa de Satisfação</h1>
<p>Esta é a página de pesquisa de satisfação do <strong>Grupo Chiacchio</strong>.</p>
<p>Para responder, use o <strong>link completo</strong> que você recebeu por e-mail ou WhatsApp. Se o link não estiver funcionando, entre em contato com o nosso SAC.</p>
<div class="hint">Sua opinião é muito importante para nós. Obrigado!</div></div></body></html>`;

app.get(['/pesquisa','/pesquisa/'], (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(_pesquisaLandingHTML());
});

app.get('/pesquisa/:token', async (req, res) => {
  const token = String(req.params.token||'').replace(/[^A-Za-z0-9_\-]/g,'');
  // URL incompleta / token aparado → página pública neutra (nunca a tela de login)
  if (token.length < 6) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(_pesquisaLandingHTML());
  }
  // Tokens curtos como 'chiacchio','plaschio','tubahia' => legado
  if (['chiacchio','plaschio','tubahia','cesbap'].includes(token.toLowerCase())) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(_pesquisaPublicaHTML(token.toLowerCase()));
  }
  // Token longo: busca no Sheets
  try {
    const rows = await lerAba('PESQUISA_TOKENS', 2000).catch(()=>[]);
    const row = rows.find(r => r.TOKEN === token);
    if (!row) return res.status(404).send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Link inválido</h2><p>Este link de pesquisa não existe.</p></body></html>');
    if (_tokenExpirado(row)) return res.status(410).send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Link expirado</h2><p>Este link de pesquisa expirou.</p></body></html>');
    if (row.STATUS === 'RESPONDIDO') return res.send('<html><body style="font-family:sans-serif;text-align:center;padding:40px"><h2>Pesquisa já respondida</h2><p>Sua resposta já foi registrada. Obrigado!</p></body></html>');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(_pesquisaTokenHTML(token, row.EMPRESA||'', row.NOME_CLIENTE||''));
  } catch(e) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(_pesquisaTokenHTML(token, '', ''));
  }
});

// Salvar resposta via token
app.post('/api/pesquisas/resposta-token', async (req, res) => {
  try {
    const { token, ...body } = req.body || {};
    if (!token) return res.status(400).json({ sucesso: false, erro: 'Token obrigatório.' });
    const rows = await lerAba('PESQUISA_TOKENS', 2000).catch(()=>[]);
    const idx = rows.findIndex(r => r.TOKEN === token);
    if (idx < 0) return res.status(404).json({ sucesso: false, erro: 'Token não encontrado.' });
    const row = rows[idx];
    if (_tokenExpirado(row)) return res.status(410).json({ sucesso: false, erro: 'Token expirado.' });
    if (row.STATUS === 'RESPONDIDO') return res.status(409).json({ sucesso: false, erro: 'Pesquisa já respondida.' });
    const aba = 'PESQUISA_RESPOSTAS';
    const _HEADERS_RESP = ['ID_RESPOSTA','TOKEN','EMPRESA','NOME_CLIENTE','DATA','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','COMENTARIO','NOTA_MEDIA','NOTA_BAIXA','STATUS_OCP'];
    await garantirAbaComCabecalhos(aba, _HEADERS_RESP);
    const atendimento = String(body.atendimento || '');
    const prazo = String(body.prazo_entrega || '');
    const qualidade = String(body.qualidade_produto || '');
    const recomendacao = String(body.nps || '');
    const notas = [atendimento, prazo, qualidade, recomendacao].map(n => parseFloat(n)).filter(n => !isNaN(n) && n > 0);
    const notaMedia = notas.length ? (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(1) : '';
    const notaBaixa = notas.length && notas.some(n => n <= Number(process.env.PESQUISA_NOTA_CRITICA||6)) ? 'SIM' : 'NAO';
    await appendObjeto(aba, {
      ID_RESPOSTA: 'RSP-' + Date.now(), TOKEN: token,
      EMPRESA: row.EMPRESA||body.empresa||'', NOME_CLIENTE: body.nome || row.NOME_CLIENTE || '',
      DATA: new Date().toISOString(),
      ATENDIMENTO: atendimento, PRAZO_ENTREGA: prazo, QUALIDADE: qualidade, RECOMENDACAO: recomendacao,
      COMENTARIO: body.comentario || '', NOTA_MEDIA: notaMedia, NOTA_BAIXA: notaBaixa, STATUS_OCP: '',
    });
    invalidarCacheAba(aba);
    await atualizarPorID('PESQUISA_TOKENS', token, { STATUS: 'RESPONDIDO', DATA_RESPOSTA: new Date().toISOString() }, ['TOKEN']);
    invalidarCacheAba('PESQUISA_TOKENS');
    if (notaBaixa === 'SIM') {
      await garantirAbaComCabecalhos('PESQUISA_OCORRENCIAS', ['ID_OCP','TOKEN','EMPRESA','DATA','NPS','STATUS','DECISAO','JUSTIFICATIVA','ID_MANIFESTACAO_GERADA','ANALISTA','DATA_DECISAO']);
      await appendObjeto('PESQUISA_OCORRENCIAS', {
        ID_OCP: 'OCP-' + Date.now(), TOKEN: token, EMPRESA: row.EMPRESA||'',
        DATA: new Date().toISOString(), NPS: notaMedia,
        STATUS: 'PENDENTE', DECISAO: '', JUSTIFICATIVA: '',
        ID_MANIFESTACAO_GERADA: '', ANALISTA: '', DATA_DECISAO: '',
      });
      invalidarCacheAba('PESQUISA_OCORRENCIAS');
    }
    res.json({ sucesso: true, flagrada: notaBaixa === 'SIM' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'resposta-token') }); }
});

// Notificações para ANALISTA SAC — pesquisas nota baixa + manifestações do portal
app.get('/api/notificacoes/analista', requerPerfil('MASTER','ANALISTA SAC','GESTOR SAC'), async (req, res) => {
  try {
    const _pf = perfilCanonico(req.user?.perfil||'');
    const scope = _pf === 'MASTER' ? null : (req.user?.empresa||null);
    const [ocps, mans, respostas] = await Promise.all([
      lerAba('PESQUISA_OCORRENCIAS', 500).catch(()=>[]),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
      lerRespostasPesquisa(),
    ]);
    const ocpsPendentes = ocps.filter(o =>
      String(o.STATUS||'').toUpperCase() === 'PENDENTE' &&
      (!scope || pertenceEmpresa(scope, o.EMPRESA||''))
    );
    const mansPortal = mans.filter(m =>
      m.ORIGEM === 'PORTAL_FUNCIONARIO' &&
      (String(m.STATUS||'').toUpperCase() === 'AGUARDANDO_APROVAÇÃO' || String(m.STATUS||'').toUpperCase() === 'ABERTA' || !m.STATUS) &&
      (!scope || pertenceEmpresa(scope, m.EMPRESA_RECLAMADA||''))
    );
    // Enriquecer OCPs com dados da resposta
    const ocpsEnrich = ocpsPendentes.map(o => {
      const resp = respostas.find(r => r.TOKEN === o.TOKEN) || {};
      return { ...o, NOME_CLIENTE: resp.NOME_CLIENTE||o.NOME_CLIENTE||'', NOTA_MEDIA: resp.NOTA_MEDIA||o.NPS||'' };
    });
    res.json({
      sucesso: true,
      total: ocpsPendentes.length + mansPortal.length,
      ocpsPendentes: ocpsPendentes.length,
      mansPortal: mansPortal.length,
      ocps: ocpsEnrich.slice(0, 20),
      manifestacoes: mansPortal.slice(0, 20).map(m => ({
        id: m.ID_MANIFESTACAO, cliente: m.CLIENTE_NOME||m.NOME_CLIENTE||'', empresa: m.EMPRESA_RECLAMADA||'',
        tipo: m.TIPO_MANIFESTACAO||m.TIPO||'', data: m.DATA_ABERTURA||m.DATA_REGISTRO||'',
        registradoPor: m.REGISTRADO_POR||m.COLABORADOR_RECEBIMENTO||'',
      })),
    });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Listar OCPs (Ocorrências de Pesquisa)
app.get('/api/pesquisas/ocorrencias', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','GESTOR SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PESQUISA_OCORRENCIAS', ['ID_OCP','TOKEN','EMPRESA','DATA','NPS','STATUS','DECISAO','JUSTIFICATIVA','ID_MANIFESTACAO_GERADA','ANALISTA','DATA_DECISAO']);
    const rows = await lerAba('PESQUISA_OCORRENCIAS', 2000);
    const _pf = perfilCanonico(req.user?.perfil||'');
    const scope = _pf === 'MASTER' ? null : (req.user?.empresa||null);
    const itens = rows.filter(r => !scope || pertenceEmpresa(scope, r.EMPRESA||''));
    // Juntar dados da resposta
    const respostas = await lerRespostasPesquisa();
    const enriched = itens.map(ocp => {
      const resp = respostas.find(r => r.TOKEN === ocp.TOKEN);
      return { ...ocp, resposta: resp || null };
    });
    res.json({ sucesso: true, total: enriched.length, itens: enriched });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'listar-ocps') }); }
});

// Registrar decisão em OCP
app.post('/api/pesquisas/ocorrencias/:id/decisao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { decisao, justificativa } = req.body || {};
    if (!['OCP','MANIFESTACAO','NENHUM'].includes(decisao)) return res.status(400).json({ sucesso: false, erro: 'Decisão inválida. Use OCP, MANIFESTACAO ou NENHUM.' });
    const rows = await lerAba('PESQUISA_OCORRENCIAS', 2000);
    const ocp = rows.find(r => r.ID_OCP === req.params.id);
    if (!ocp) return res.status(404).json({ sucesso: false, erro: 'OCP não encontrada.' });
    const _pf = perfilCanonico(req.user?.perfil||'');
    if (_pf !== 'MASTER' && !pertenceEmpresa(req.user?.empresa, ocp.EMPRESA||'')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    await atualizarPorID('PESQUISA_OCORRENCIAS', ocp.ID_OCP, {
      STATUS: 'TRATADA', DECISAO: decisao, JUSTIFICATIVA: justificativa||'',
      ANALISTA: req.user?.usuario||'', DATA_DECISAO: new Date().toISOString(),
    }, ['ID_OCP']);
    invalidarCacheAba('PESQUISA_OCORRENCIAS');
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'decisao-ocp') }); }
});

// Questionário: obter versão publicada e rascunhos
app.get('/api/pesquisas/questionario', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','GESTOR SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PESQUISA_QUESTIONARIO', ['ID_VERSAO','STATUS','CRIADO_EM','PUBLICADO_EM','CRIADO_POR','PERGUNTAS_JSON']);
    const rows = await lerAba('PESQUISA_QUESTIONARIO', 100);
    const publicada = rows.filter(r => r.STATUS === 'PUBLICADA').sort((a,b)=>new Date(b.PUBLICADO_EM||0)-new Date(a.PUBLICADO_EM||0))[0] || null;
    const rascunho = rows.filter(r => r.STATUS === 'RASCUNHO').sort((a,b)=>new Date(b.CRIADO_EM||0)-new Date(a.CRIADO_EM||0))[0] || null;
    const parse = (r) => r ? { ...r, perguntas: (() => { try { return JSON.parse(r.PERGUNTAS_JSON||'[]'); } catch(e) { return []; } })() } : null;
    res.json({ sucesso: true, publicada: parse(publicada), rascunho: parse(rascunho) });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'get-questionario') }); }
});

// Questionário: salvar rascunho ou publicar
app.post('/api/pesquisas/questionario', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { perguntas, acao = 'RASCUNHO' } = req.body || {};
    if (!Array.isArray(perguntas) || perguntas.length === 0) return res.status(400).json({ sucesso: false, erro: 'perguntas obrigatório.' });
    if (!['RASCUNHO','PUBLICADA'].includes(acao)) return res.status(400).json({ sucesso: false, erro: 'acao deve ser RASCUNHO ou PUBLICADA.' });
    await garantirAbaComCabecalhos('PESQUISA_QUESTIONARIO', ['ID_VERSAO','STATUS','CRIADO_EM','PUBLICADO_EM','CRIADO_POR','PERGUNTAS_JSON']);
    const idVersao = 'QV-' + Date.now();
    await appendObjeto('PESQUISA_QUESTIONARIO', {
      ID_VERSAO: idVersao, STATUS: acao,
      CRIADO_EM: new Date().toISOString(),
      PUBLICADO_EM: acao === 'PUBLICADA' ? new Date().toISOString() : '',
      CRIADO_POR: req.user?.usuario||'',
      PERGUNTAS_JSON: JSON.stringify(perguntas),
    });
    invalidarCacheAba('PESQUISA_QUESTIONARIO');
    await registrarAuditoria(req.user?.usuario||'sistema', `QUESTIONARIO_${acao}`, null, 'PESQUISA_QUESTIONARIO', null, { id: idVersao });
    res.json({ sucesso: true, id: idVersao, status: acao });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'save-questionario') }); }
});

// Pesquisa HTML pública por token (página nova com campos estendidos)
function _pesquisaTokenHTML(token, empresa, nomeCliente) {
  const empresaDisplay = _empresaDisplay(empresa);
  const logoMap = { CHIACCHIO:'logo-chiacchio-new.png', PLASCHIO:'logo-plaschio-new.png', TUBAHIA:'logo-tubahia-new.png', LOGCHIO:'logo-chiacchio-new.png', SOLARCHIO:'logo-chiacchio-new.png', PREMOCHIO:'logo-chiacchio-new.png' };
  const cod = empresaCanonica(empresa||'');
  const logo = logoMap[cod] ? `/assets/${logoMap[cod]}` : '/assets/logo-chiacchio-new.png';
  const tkBrandColor = cod === 'TUBAHIA' ? '#2B2070' : '#B9171A';
  const tkBrandHover = cod === 'TUBAHIA' ? '#1F1760' : '#A80502';
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pesquisa de Satisfação${empresaDisplay ? ' — '+empresaDisplay : ''}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F5F5F5;color:#1F1F1F;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px}
.card{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(0,0,0,.09);max-width:560px;width:100%;padding:32px 28px 36px}
.logo-wrap{text-align:center;margin-bottom:20px}
.logo-wrap img{max-height:64px;max-width:220px;padding:8px 14px;background:#fff;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.08)}
.co-name{font-size:13px;font-weight:600;color:#545252;text-align:center;margin-top:6px}
h2{font-size:18px;font-weight:700;margin-bottom:6px}
.sub{font-size:13.5px;color:#545252;margin-bottom:24px;line-height:1.5}
.q-label{font-size:13px;font-weight:700;margin-bottom:8px;line-height:1.4}
.q-block{margin-bottom:24px}
.nps-row{display:flex;gap:4px;flex-wrap:wrap}
.nps-btn{flex:1;min-width:36px;height:44px;border:2px solid #E4E4E4;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;background:#fff;transition:all .15s;font-family:inherit}
.nps-btn.sel-bad{background:${tkBrandColor};color:#fff;border-color:${tkBrandColor}}
.nps-btn.sel-mid{background:#D9A400;color:#fff;border-color:#D9A400}
.nps-btn.sel-ok{background:#1E6B3A;color:#fff;border-color:#1E6B3A}
.nps-labels{display:flex;justify-content:space-between;font-size:10.5px;color:#8A8888;margin-top:4px}
.stars-row{display:flex;gap:6px}
.star{width:40px;height:40px;border:2px solid #E4E4E4;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;background:#fff;transition:all .15s;font-family:inherit}
.star.sel{background:${tkBrandColor};color:#fff;border-color:${tkBrandColor}}
textarea{width:100%;border:1.5px solid #D6D6D6;border-radius:8px;padding:10px 12px;font-size:13.5px;line-height:1.5;resize:vertical;min-height:80px;font-family:inherit;color:#1F1F1F}
.inp{width:100%;border:1.5px solid #D6D6D6;border-radius:8px;padding:10px 12px;font-size:13.5px;font-family:inherit;color:#1F1F1F}
.motivo-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.motivo-btn{border:2px solid #E4E4E4;border-radius:8px;padding:10px 12px;cursor:pointer;background:#fff;font-size:12.5px;font-weight:600;text-align:left;font-family:inherit;transition:all .15s}
.motivo-btn.sel{border-color:${tkBrandColor};background:#FFF8F8;color:${tkBrandColor}}
.btn-enviar{width:100%;background:${tkBrandColor};color:#fff;border:0;border-radius:10px;padding:14px;font-size:15px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:8px}
.btn-enviar:hover{background:${tkBrandHover}}
.prog-bar{width:100%;height:4px;background:#EFEFEF;border-radius:2px;margin-bottom:24px}
.prog-fill{height:100%;background:${tkBrandColor};border-radius:2px;transition:width .3s}
.success-icon{font-size:48px;text-align:center;margin-bottom:12px}
.success-msg{text-align:center}
.err{color:#A80502;font-size:12px;margin-top:4px}
@media(max-width:480px){.card{padding:24px 18px}.motivo-grid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="card" id="card">
  ${logo ? `<div class="logo-wrap"><img src="${logo}" alt="${empresaDisplay}"><div class="co-name">${empresaDisplay}</div></div>` : `<div class="logo-wrap"><div class="co-name" style="font-size:16px;font-weight:700">${empresaDisplay||'Pesquisa de Satisfação'}</div></div>`}
  <h2>Como foi a sua experiência?</h2>
  <p class="sub">Sua opinião é muito importante para nós. Leva menos de 2 minutos.</p>
  <div class="prog-bar"><div class="prog-fill" id="prog" style="width:10%"></div></div>
  <form id="form-pesquisa" onsubmit="enviar(event)">
    <input type="hidden" id="f-token" value="${token}">
    <input type="hidden" id="f-empresa" value="${empresa}">

    <div class="q-block" id="qb-nome">
      <div class="q-label">Seu nome ou empresa <span style="color:#8A8888;font-weight:400">(opcional)</span></div>
      <input class="inp" id="f-nome" placeholder="Ex: João Silva / Empresa ABC" value="${nomeCliente}" oninput="progAtualiza()">
    </div>

    <div class="q-block">
      <div class="q-label">Em uma escala de 0 a 10, qual a probabilidade de você nos recomendar a um amigo ou colega?</div>
      <div class="nps-row" id="nps-row"></div>
      <div class="nps-labels"><span>Muito improvável</span><span>Muito provável</span></div>
      <div class="err" id="err-nps" style="display:none">Selecione uma nota</div>
    </div>

    <div class="q-block">
      <div class="q-label">Qualidade dos produtos (1 a 10)</div>
      <div class="stars-row" id="stars-qual"></div>
      <div class="err" id="err-qual" style="display:none">Selecione uma nota</div>
    </div>

    <div class="q-block">
      <div class="q-label">Prazo de entrega (1 a 10)</div>
      <div class="stars-row" id="stars-prazo"></div>
    </div>

    <div class="q-block">
      <div class="q-label">Atendimento (1 a 10)</div>
      <div class="stars-row" id="stars-atend"></div>
    </div>

    <div class="q-block">
      <div class="q-label">Principal motivo da compra</div>
      <div class="motivo-grid" id="motivo-grid">
        ${['Qualidade','Preço','Prazo de entrega','Parceria','Indicação','Outro'].map(m=>`<button type="button" class="motivo-btn" onclick="selMotivo(this,'${m}')">${m}</button>`).join('')}
      </div>
    </div>

    <div class="q-block">
      <div class="q-label">Comentário <span style="color:#8A8888;font-weight:400">(opcional)</span></div>
      <textarea id="f-comentario" placeholder="Sugestões, elogios ou críticas..." oninput="progAtualiza()"></textarea>
    </div>

    <button class="btn-enviar" type="submit">Enviar pesquisa →</button>
  </form>
</div>
<script>
let npsVal = null, qualVal = null, prazoVal = null, atendVal = null, motivoVal = null;

// Render NPS 0-10
const npsRow = document.getElementById('nps-row');
for (let i=0;i<=10;i++) {
  const b = document.createElement('button'); b.type='button'; b.className='nps-btn'; b.textContent=i;
  b.onclick = () => { npsVal=i; document.querySelectorAll('.nps-btn').forEach(x=>x.className='nps-btn');
    const cls = i<=6?'sel-bad':i<=8?'sel-mid':'sel-ok'; b.className='nps-btn '+cls; progAtualiza(); };
  npsRow.appendChild(b);
}

// Render stars 1-10
function renderStars(id, setter) {
  const el = document.getElementById(id);
  for (let i=1;i<=10;i++) {
    const b = document.createElement('button'); b.type='button'; b.className='star'; b.textContent=i;
    b.onclick = () => { setter(i); el.querySelectorAll('.star').forEach((x,j)=>x.className='star'+(j<i?' sel':'')); progAtualiza(); };
    el.appendChild(b);
  }
}
renderStars('stars-qual', v=>qualVal=v);
renderStars('stars-prazo', v=>prazoVal=v);
renderStars('stars-atend', v=>atendVal=v);

function selMotivo(btn, val) { motivoVal=val; document.querySelectorAll('.motivo-btn').forEach(x=>x.classList.remove('sel')); btn.classList.add('sel'); progAtualiza(); }

function progAtualiza() {
  const pcts = [npsVal!==null, qualVal!==null, prazoVal!==null, atendVal!==null, motivoVal!==null,
    document.getElementById('f-comentario').value.trim().length>0];
  const done = pcts.filter(Boolean).length;
  document.getElementById('prog').style.width = (10 + done*13) + '%';
}

// Mark as opened
fetch('/api/pesquisas/tokens/${token}/abrir', {method:'POST'}).catch(()=>{});

async function enviar(e) {
  e.preventDefault();
  if (npsVal===null) { document.getElementById('err-nps').style.display=''; return; }
  if (qualVal===null) { document.getElementById('err-qual').style.display=''; return; }
  const btn = document.querySelector('.btn-enviar'); btn.disabled=true; btn.textContent='Enviando...';
  try {
    const r = await fetch('/api/pesquisas/resposta-token', { method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: document.getElementById('f-token').value,
        empresa: document.getElementById('f-empresa').value,
        nome: document.getElementById('f-nome').value,
        nps: npsVal, qualidade_produto: qualVal, prazo_entrega: prazoVal, atendimento: atendVal,
        motivo_compra: motivoVal||'', comentario: document.getElementById('f-comentario').value }) });
    const j = await r.json();
    if (j.sucesso) {
      document.getElementById('card').innerHTML = '<div class="success-icon">✓</div><div class="success-msg"><h2>Obrigado!</h2><p class="sub" style="margin-top:8px">Sua resposta foi registrada com sucesso. Valorizamos muito sua opinião.</p></div>';
    } else { btn.disabled=false; btn.textContent='Enviar pesquisa →'; alert(j.erro||'Erro ao enviar.'); }
  } catch(ex) { btn.disabled=false; btn.textContent='Enviar pesquisa →'; alert('Erro de conexão. Tente novamente.'); }
}
</script>
</body>
</html>`;
}

app.get('/api/tipos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('TIPOS_RECLAMACAO',200).catch(()=>[]); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});
app.get('/api/sla', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const data=await lerAba('SLA_ESCALONAMENTO',50).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});
app.get('/api/validacoes', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try { const data=await lerAba('HISTORICO_VALIDACOES',1000).catch(()=>[]); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});


// ===== ROTA: BUSCAR CASO POR FONTE E ID =====
app.get('/api/caso/:fonte/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req, res) => {
  try {
    const fonteRaw = decodeURIComponent(req.params.fonte || '');
    const id = decodeURIComponent(req.params.id || '');
    if (!id) return res.status(400).json({ sucesso: false, erro: 'ID obrigatório.' });

    const mapaFontes = {
      'BANCO_HISTORICO': 'BANCO_HISTORICO',
      'HISTORICO': 'BANCO_HISTORICO',
      'MANIFESTACOES': 'MANIFESTACOES',
      'SAC_ANALISE_DEFINITIVA': 'SAC_ANALISE_DEFINITIVA',
      'ANALISE': 'SAC_ANALISE_DEFINITIVA',
      'RECLAMACOES': 'Reclamações',
      'Reclamacoes': 'Reclamações',
      'Reclamações + devolutiva': 'Reclamações',
      'Reclamações': 'Reclamações',
    };
    const camposId = ['ID_HISTORICO','ID_MANIFESTACAO','ID_ANALISE','ID','id'];
    const fonteNorm = mapaFontes[fonteRaw] || mapaFontes[fonteRaw.toUpperCase()] || fonteRaw;

    let item = null;
    let fonteReal = fonteNorm;

    // Tentar fonte solicitada primeiro
    try {
      const data = await lerAba(fonteNorm, 2000);
      item = data.find(r => camposId.some(c => String(r[c] ?? '').trim() === id.trim()));
    } catch(e) { /* continua */ }

    // Varrer todas as fontes principais se não achou
    if (!item) {
      const fontes = ['BANCO_HISTORICO', 'MANIFESTACOES', 'SAC_ANALISE_DEFINITIVA'];
      for (const aba of fontes) {
        if (aba === fonteNorm) continue;
        try {
          const rows = await lerAba(aba, 2000);
          const found = rows.find(r => camposId.some(c => String(r[c] ?? '').trim() === id.trim()));
          if (found) { item = found; fonteReal = aba; break; }
        } catch(e) { /* continua */ }
      }
    }

    if (!item) return res.status(404).json({ sucesso: false, erro: `Caso "${id}" não encontrado.` });
    // Isolamento de empresa: MASTER vê tudo, demais só veem da própria empresa
    const empItem = item.EMPRESA_RECLAMADA || item.ORIG_EMPRESA || item.EMPRESA || '';
    if (!pertenceEmpresa(req.user?.empresa, empItem)) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para este caso.' });
    }
    res.json({ sucesso: true, caso: { ...item, _fonte_real: fonteReal } });
  } catch(e) {
    console.error('/api/caso erro:', e.message);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

// ===== ROTA: REGISTRAR USO DE CASO SIMILAR COMO REFERÊNCIA =====
app.post('/api/caso-similar/usar-referencia', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { idManifestacao, idCasoSimilar, fonteCaso, pctSimilaridade, tratativa, devolutiva } = req.body;
    if (!idManifestacao || !idCasoSimilar) {
      return res.status(400).json({ sucesso: false, erro: 'idManifestacao e idCasoSimilar são obrigatórios.' });
    }
    const usuario = req.user?.usuario || 'sistema';
    const agora = new Date().toISOString();

    // 1. Atualizar MANIFESTACOES com os campos de referência
    await atualizarPorID('MANIFESTACOES', idManifestacao, {
      CASO_REFERENCIA_PRINCIPAL: idCasoSimilar,
      TRATATIVA_CASO_REFERENCIA: tratativa || '',
      FONTE_TRATATIVA: `CASO_SIMILAR:${fonteCaso || 'BANCO_HISTORICO'}:${idCasoSimilar}:${pctSimilaridade || 0}%`,
      TRATATIVA_SUGERIDA: tratativa || '',
    });

    // 2. Registrar em CASOS_SIMILARES_SAC (cria a aba se não existir)
    try {
      await appendObjeto('CASOS_SIMILARES_SAC', {
        ID_REGISTRO: `CSAC-${Date.now()}`,
        ID_MANIFESTACAO: idManifestacao,
        ID_CASO_SIMILAR: idCasoSimilar,
        FONTE_CASO: fonteCaso || 'BANCO_HISTORICO',
        PCT_SIMILARIDADE: pctSimilaridade || 0,
        FOI_UTILIZADO: 'SIM',
        TRATATIVA_UTILIZADA: tratativa || '',
        USUARIO: usuario,
        DATA_USO: agora,
      });
    } catch(e) {
      // Aba pode não existir ainda — loga mas não falha
      console.warn('CASOS_SIMILARES_SAC não disponível:', e.message);
    }

    // 3. Registrar em LOG_DECISOES_SAC
    try {
      await appendObjeto('LOG_DECISOES_SAC', {
        ID_LOG: `LOG-${Date.now()}`,
        ID_MANIFESTACAO: idManifestacao,
        ACAO: 'USAR_CASO_SIMILAR_COMO_REFERENCIA',
        DETALHE: `Caso ${idCasoSimilar} (${pctSimilaridade}% de compatibilidade) de ${fonteCaso}`,
        USUARIO: usuario,
        DATA_HORA: agora,
      });
    } catch(e) {
      console.warn('LOG_DECISOES_SAC não disponível:', e.message);
    }

    // 4. Auditoria
    await registrarAuditoria(usuario, 'CASO_SIMILAR_REFERENCIA', idManifestacao, 'MANIFESTACOES', null, {
      casoPrincipal: idCasoSimilar,
      fonte: fonteCaso,
      pct: pctSimilaridade,
    });

    res.json({ sucesso: true, mensagem: 'Referência registrada com sucesso.' });
  } catch(e) {
    console.error('/api/caso-similar/usar-referencia erro:', e.message);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
});

app.get('/api/auditoria', requerPerfil('MASTER','GESTOR SAC','AUDITOR'), async (req, res) => {
  try {
    const data = await lerAba('LOG_SISTEMA', 2000);
    const itens = data.map(r => {
      const vals = Object.values(r);
      return {
        DATA_HORA:   r.DATA_HORA   || r['DATA/HORA'] || vals[0] || '',
        USUARIO:     r.USUARIO     || vals[1] || '',
        ACAO:        r.ACAO        || vals[2] || '',
        ID_REGISTRO: r.ID_REGISTRO || r.ID_MANIFESTACAO || vals[3] || '',
        ABA:         r.ABA         || r.ENTIDADE || r.TABELA || vals[4] || '',
        DETALHES:    r.DETALHES    || r.VALOR_NOVO || vals[6] || vals[5] || '',
      };
    }).filter(r => r.DATA_HORA || r.USUARIO || r.ACAO);
    res.json({sucesso:true, total:itens.length, itens});
  }
  catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});

// Histórico de uma manifestação específica — acessível a analistas (não expõe LOG completo)
app.get('/api/manifestacoes/:id/historico', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const { id } = req.params;
    const [logs, manifest] = await Promise.all([
      lerAba('LOG_SISTEMA', 2000).catch(() => []),
      lerAba('MANIFESTACOES', 5000).catch(() => []),
    ]);
    // Garante que a manifestação pertence à empresa do usuário
    const item = manifest.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    const _pfHist = perfilCanonico(req.user.perfil);
    if (_pfHist !== 'MASTER') {
      const empScope = req.user?.empresa_scope || req.user?.empresa || '';
      // Bloqueia se empresa do usuário não está definida ou não corresponde à da manifestação
      if (!empScope || !pertenceEmpresa(empScope, item.EMPRESA_RECLAMADA || '')) {
        return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
      }
    }
    const itens = logs
      .filter(r => (r.ID_REGISTRO || r.ID_MANIFESTACAO || '') === id)
      .map(r => {
        const vals = Object.values(r);
        return {
          DATA_HORA:   r.DATA_HORA   || r['DATA/HORA'] || vals[0] || '',
          USUARIO:     r.USUARIO     || vals[1] || '',
          ACAO:        r.ACAO        || vals[2] || '',
          DETALHES:    r.DETALHES    || r.VALOR_NOVO  || vals[6] || vals[5] || '',
        };
      })
      .filter(r => r.DATA_HORA || r.ACAO);
    res.json({ sucesso: true, id, total: itens.length, itens });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== LEITOR GENÉRICO DE ABAS (Central de Dados) =====
const ABAS_PERMITIDAS = [
  'MANIFESTACOES','BANCO_HISTORICO','RNC','BANCO_RNC','RNC_EVENTOS',
  'CONFIG_SETORES','PRODUTOS','USUARIOS','CLIENTES_REPRESENTANTES',
  'CAUSAS','ASSERTIVIDADE_IA','SUGESTOES_MELHORIA',
  'LOG_ANALISES','LOG_SISTEMA','LOG_DECISOES_SAC',
  'FAQ_SETORES','REGRAS_SETORES','PROCEDIMENTOS_SETORES','POLITICAS_SETORES','PERGUNTAS_IA_SETORES',
  'MATRIZ_DECISAO','TIPOS_RECLAMACAO','REGRAS_ROTEAMENTO',
  'PARAMETROS_LOGISTICA','PARAMETROS_PRODUCAO',
  'ANEXOS','DOCUMENTOS_SETORES','APROVADOR_COMPETENCIAS','CONHECIMENTO_SETORES',
  'Reclamações + devolutiva', 'Reclamações', // P023: fonte oficial para "Reclamações do período"
  'SLA_ESCALONAMENTO','PERGUNTAS_ANALISE','LOG_VISUALIZACOES',
];

app.get('/api/planilha/abas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const { getSheets } = require('./services/sheets');
    const sheets = await getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
    const todas = (meta.data.sheets||[]).map(s=>({ nome: s.properties.title, linhas: s.properties.gridProperties?.rowCount||0, colunas: s.properties.gridProperties?.columnCount||0 }));
    res.json({ sucesso:true, abas: todas });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), abas:[] }); }
});

// Leitura de aba com query param (suporta nomes com acentos/espaços)
app.get('/api/planilha/ler', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const nome = req.query.nome || '';
    if (!nome) return res.status(400).json({sucesso:false, erro:'Parâmetro nome é obrigatório.'});
    if (!ABAS_PERMITIDAS.includes(nome)) return res.status(403).json({sucesso:false, erro:`Aba não permitida: ${nome}`});
    const max = Math.min(parseInt(req.query.max||'2000',10), 5000);
    const data = await lerAba(nome, max);
    res.json({ sucesso:true, aba:nome, total:data.length, itens:data });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] }); }
});

const _ABAS_SENSIVEIS = new Set(['USUARIOS']);
app.get('/api/planilha/:aba', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const aba = req.params.aba.toUpperCase().replace(/[^A-Z0-9_]/g,'');
    if (_ABAS_SENSIVEIS.has(aba) && perfilCanonico(req.user.perfil) !== 'MASTER') {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado a esta aba.' });
    }
    const max = Math.min(parseInt(req.query.max||'2000',10), 5000);
    const data = await lerAba(aba, max);
    res.json({ sucesso:true, aba, total:data.length, itens:data });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] }); }
});

app.get('/api/planilha/:aba/cabecalhos', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const aba = req.params.aba.toUpperCase().replace(/[^A-Z0-9_]/g,'');
    const CABECALHOS_PADRAO = {
      MATRIZ_TRATAMENTO: ['ID_TRATAMENTO','EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','SUBCATEGORIA','CONDICAO','SETOR_RESPONSAVEL','RESPONSAVEL','PRIORIDADE','RISCO','TRATATIVA_OBRIGATORIA','TRATATIVA_RECOMENDADA','TRATATIVA_CONDICIONAL','TRATATIVA_NAO_PERMITIDA','PRAZO_TRATATIVA','NECESSITA_APROVACAO','QUEM_APROVA','NECESSITA_EVIDENCIA','NECESSITA_ANALISE_TECNICA','NECESSITA_RNC','NECESSITA_ESCALONAMENTO','MODELO_DEVOLUTIVA','REGRAS_DEVOLUTIVA','INFORMACOES_PERMITIDAS','INFORMACOES_PROIBIDAS','ATIVO','VERSAO'],
      CONFIG_SETORES: ['ID_SETOR','SETOR','EMPRESA','DESCRICAO','RESPONSAVEL','SLA_HORAS','ATIVO'],
      PRODUTOS: ['ID_PRODUTO','EMPRESA','PRODUTO','DESCRICAO','CATEGORIA','UNIDADE','ATIVO'],
      CAUSAS: ['ID_CAUSA','CATEGORIA','CAUSA','SUBCAUSA','ATIVO'],
      REPRESENTANTES: ['ID_REPRESENTANTE','NOME','EMPRESA','REGIAO','EMAIL','TELEFONE','ATIVO'],
      PESQUISAS_SATISFACAO: ['ID','DATA','EMPRESA','NOTA','COMENTARIO','ORIGEM'],
    };
    let headers = await obterCabecalhos(aba).catch(()=>[]);
    if (!headers.length && CABECALHOS_PADRAO[aba]) {
      await garantirAbaComCabecalhos(aba, CABECALHOS_PADRAO[aba]).catch(()=>{});
      headers = CABECALHOS_PADRAO[aba];
    }
    res.json({ sucesso:true, aba, cabecalhos: headers });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), cabecalhos:[] }); }
});

app.post('/api/planilha/:aba/importar', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const aba = req.params.aba.toUpperCase().replace(/[^A-Z0-9_]/g,'');
    const { itens, cabecalhos, upsert } = req.body;
    if(!Array.isArray(itens)||!itens.length) return res.status(400).json({ sucesso:false, erro:'Nenhum item.' });
    if(cabecalhos && Array.isArray(cabecalhos)) await garantirAbaComCabecalhos(aba, cabecalhos);
    let criados=0, atualizados=0;
    const agora = new Date().toISOString();

    // Para upsert: carrega existentes uma vez só
    const existentes = upsert ? await lerAba(aba, 5000).catch(()=>[]) : [];
    // Detecta campo-chave da aba (primeiro campo que parece ID)
    const campoID = existentes.length ? Object.keys(existentes[0]).find(k => /^ID_/.test(k)) : null;

    for(const item of itens){
      if(aba==='MANIFESTACOES'){
        if(!item.ID_MANIFESTACAO) item.ID_MANIFESTACAO = await gerarProximoID('MANIFESTACOES','MAN','ID_MANIFESTACAO');
        if(!item.DATA_ABERTURA) item.DATA_ABERTURA = agora;
        if(!item.DATA_REGISTRO) item.DATA_REGISTRO = agora;
        if(!item.STATUS) item.STATUS = 'ABERTA';
        if(!item.USUARIO_CRIACAO) item.USUARIO_CRIACAO = req.user.usuario;
        if(!item.ORIGEM) item.ORIGEM = 'IMPORTACAO';
      }

      if(upsert && campoID && item[campoID]) {
        const existe = existentes.find(r => String(r[campoID]||'').trim() === String(item[campoID]).trim());
        if(existe) {
          await atualizarPorID(aba, existe[campoID], item, [campoID]);
          atualizados++;
          continue;
        }
      }
      await appendObjeto(aba, item);
      criados++;
    }
    await registrarAuditoria(req.user.usuario,'IMPORTOU_DADOS_PLANILHA',`${criados}c/${atualizados}a`,aba,null,{aba,total:criados+atualizados,upsert:!!upsert});
    res.json({ sucesso:true, criados, atualizados, aba });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/log-sistema', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    const data = await lerAba('LOG_SISTEMA', 2000).catch(()=>[]);
    const {id, usuario, acao} = req.query;
    let filtrados = data;
    if (id) filtrados = filtrados.filter(l=>String(l.ID_MANIFESTACAO||l.ENTIDADE||'').includes(id));
    if (usuario) filtrados = filtrados.filter(l=>String(l.USUARIO||'').toLowerCase().includes(usuario.toLowerCase()));
    if (acao) filtrados = filtrados.filter(l=>String(l.ACAO||'').toLowerCase().includes(acao.toLowerCase()));
    res.json({sucesso:true,total:filtrados.length,itens:filtrados.slice(0,200)});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

// ===== USUÁRIOS =====
app.get('/api/usuarios', requerPermissao('usuarios.visualizar'), async (req,res)=>{
  try{
    const itens=await carregarUsuarios();
    const _dbg = itens._debug || {};
    res.json({sucesso:true,total:itens.length,itens:itens.map(usuarioPublico),_dbg});
  }
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});
app.post('/api/usuarios', requerPermissao('usuarios.criar'), async (req,res)=>{
  try{
    const b=req.body||{};
    if(!b.usuario||!b.nome||!b.perfil) return res.status(400).json({sucesso:false,erro:'Usuário, nome e perfil são obrigatórios.'});
    const id=await gerarProximoID('USUARIOS','USR','ID_USUARIO');
    const hash=b.senha ? await hashSenha(b.senha) : '';
    const obj={ID_USUARIO:id,USUARIO:b.usuario,EMAIL:b.email||'',NOME:b.nome,PERFIL:perfilCanonico(b.perfil),EMPRESA:b.empresa||'',SETOR:b.setor||'',CODIGO_RCA:b.codigoRCA||'',STATUS:b.status||'ATIVO',SENHA_HASH:hash,DATA_CRIACAO:new Date().toISOString(),ULTIMO_ACESSO:'',PERMISSOES_CUSTOM:Array.isArray(b.permissoes_custom)?JSON.stringify(b.permissoes_custom):''};
    await appendObjeto('USUARIOS',obj);
    await registrarAuditoria(req.user.usuario,'CRIOU_USUARIO',id,'USUARIOS',null,{perfil:obj.PERFIL});
    res.json({sucesso:true,usuario:usuarioPublico(obj)});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/usuarios/:id', requerPermissao('usuarios.editar'), async (req,res)=>{
  try{
    const b=req.body||{};
    // Whitelist de campos permitidos — impede mass assignment
    const dados={};
    if(b.nome!==undefined) dados.NOME=b.nome;
    if(b.email!==undefined) dados.EMAIL=b.email;
    if(b.setor!==undefined) dados.SETOR=b.setor;
    if(b.status!==undefined) dados.STATUS=b.status;
    if(b.codigoRCA!==undefined) dados.CODIGO_RCA=b.codigoRCA;
    if(b.perfil||b.PERFIL) dados.PERFIL=perfilCanonico(b.perfil||b.PERFIL);
    if(b.empresa||b.EMPRESA) { const ec=empresaCanonica(b.empresa||b.EMPRESA); if(ec) dados.EMPRESA=ec; }
    if(b.senha){ dados.SENHA_HASH = await hashSenha(b.senha); }
    if(Array.isArray(b.permissoes_custom)) dados.PERMISSOES_CUSTOM=JSON.stringify(b.permissoes_custom);
    if(Array.isArray(b.permissoes_granted)) dados.PERMISSOES_GRANTED=JSON.stringify(b.permissoes_granted);
    if(Array.isArray(b.permissoes_blocked)) dados.PERMISSOES_BLOCKED=JSON.stringify(b.permissoes_blocked);
    dados.DATA_ULTIMA_ALTERACAO=new Date().toISOString(); dados.ALTERADO_POR=req.user.usuario;
    const resultado=await atualizarPorID('USUARIOS',req.params.id,dados,['ID_USUARIO','USUARIO','EMAIL']);
    if(!resultado) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado. Recarregue a lista e tente novamente.'});
    // Invalida cache de status para mudanças de perfil/status/permissões valerem imediatamente
    _statusCache.delete(req.params.id);
    _statusCache.delete(normalizarTexto(req.params.id));
    invalidarCacheAba('USUARIOS');
    await registrarAuditoria(req.user.usuario,'ATUALIZOU_USUARIO',req.params.id,'USUARIOS',null,{campos:Object.keys(b)});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Soft-delete (MASTER only)
app.delete('/api/usuarios/:id', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    const perfil=perfilCanonico(req.user?.perfil||'');
    if(perfil!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER pode excluir usuários.'});
    const todos=await carregarUsuarios();
    const alvo=todos.find(u=>String(u.ID_USUARIO||u.USUARIO||u.EMAIL)===String(req.params.id)||String(u.USUARIO)===String(req.params.id)||String(u.EMAIL)===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    // Impede auto-exclusão
    if(normalizarTexto(alvo.USUARIO||alvo.EMAIL)===normalizarTexto(req.user.usuario)) return res.status(400).json({sucesso:false,erro:'Você não pode excluir sua própria conta.'});
    // Se o usuário a excluir é MASTER, verificar se há outro MASTER ativo
    if((alvo.PERFIL||alvo.perfil||'').toUpperCase()==='MASTER'){
      const masters=todos.filter(u=>(u.PERFIL||u.perfil||'').toUpperCase()==='MASTER'&&(u.STATUS||u.status||'ATIVO').toUpperCase()==='ATIVO'&&String(u.ID_USUARIO||u.USUARIO)!==String(alvo.ID_USUARIO||alvo.USUARIO));
      if(masters.length===0) return res.status(403).json({sucesso:false,erro:'Não é possível excluir o único MASTER ativo do sistema.'});
    }
    // Atualiza PG (inativa o usuário)
    if (alvo._pgId && usuarioRepo) {
      await usuarioRepo.update(alvo._pgId, { ativo: false }).catch(e => console.warn('[DEL] PG update:', e.message));
    }
    invalidarCachePermissoes(alvo.EMAIL||alvo.USUARIO||alvo.ID_USUARIO);
    _statusCache.delete(normalizarTexto(alvo.USUARIO||alvo.EMAIL||alvo.ID_USUARIO));
    await registrarAuditoria(req.user.usuario,'EXCLUIU_USUARIO',req.params.id,'USUARIOS',null,{nome:alvo.NOME});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Ações de status (MASTER only)
app.post('/api/usuarios/:id/bloquear', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const todos=await carregarUsuarios();
    const alvo=todos.find(u=>String(u.ID_USUARIO||u.USUARIO)===String(req.params.id)||String(u.USUARIO)===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if(normalizarTexto(alvo.USUARIO||alvo.EMAIL)===normalizarTexto(req.user.usuario)) return res.status(400).json({sucesso:false,erro:'Você não pode bloquear sua própria conta.'});
    await atualizarPorID('USUARIOS',req.params.id,{STATUS:'BLOQUEADO',DATA_ULTIMA_ALTERACAO:new Date().toISOString(),ALTERADO_POR:req.user.usuario},['ID_USUARIO','USUARIO','EMAIL']);
    await registrarAuditoria(req.user.usuario,'BLOQUEOU_USUARIO',req.params.id,'USUARIOS',null,{motivo:req.body?.motivo||''});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/desbloquear', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    await atualizarPorID('USUARIOS',req.params.id,{STATUS:'ATIVO',DATA_ULTIMA_ALTERACAO:new Date().toISOString(),ALTERADO_POR:req.user.usuario},['ID_USUARIO','USUARIO','EMAIL']);
    await registrarAuditoria(req.user.usuario,'DESBLOQUEOU_USUARIO',req.params.id,'USUARIOS',null,{});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/desativar', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const todos=await carregarUsuarios();
    const alvo=todos.find(u=>String(u.ID_USUARIO||u.USUARIO)===String(req.params.id)||String(u.USUARIO)===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if(normalizarTexto(alvo.USUARIO||alvo.EMAIL)===normalizarTexto(req.user.usuario)) return res.status(400).json({sucesso:false,erro:'Você não pode desativar sua própria conta.'});
    await atualizarPorID('USUARIOS',req.params.id,{STATUS:'INATIVO',DATA_ULTIMA_ALTERACAO:new Date().toISOString(),ALTERADO_POR:req.user.usuario},['ID_USUARIO','USUARIO','EMAIL']);
    await registrarAuditoria(req.user.usuario,'DESATIVOU_USUARIO',req.params.id,'USUARIOS',null,{});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/ativar', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    await atualizarPorID('USUARIOS',req.params.id,{STATUS:'ATIVO',DATA_ULTIMA_ALTERACAO:new Date().toISOString(),ALTERADO_POR:req.user.usuario},['ID_USUARIO','USUARIO','EMAIL']);
    await registrarAuditoria(req.user.usuario,'ATIVOU_USUARIO',req.params.id,'USUARIOS',null,{});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// ===== PERMISSÕES DO USUÁRIO (MASTER only) =====
app.post('/api/usuarios/:id/permissoes', requerPermissao('usuarios.gerenciar'), async (req, res) => {
  try {
    const { id } = req.params;
    const { permissoes_granted = [], permissoes_blocked = [], justificativa = '' } = req.body;
    if (!Array.isArray(permissoes_granted) || !Array.isArray(permissoes_blocked))
      return res.status(400).json({ sucesso: false, erro: 'Permissões devem ser arrays.' });

    const usuarios = await carregarUsuarios();
    const alvo = usuarios.find(u => String(u.ID_USUARIO||u.USUARIO||u.EMAIL) === String(id) || String(u.USUARIO) === String(id));
    if (!alvo) return res.status(404).json({ sucesso: false, erro: 'Usuário não encontrado.' });

    if (normalizarTexto(req.user.usuario) === normalizarTexto(alvo.USUARIO||alvo.EMAIL||'') && (req.user.perfil||'').toUpperCase() !== 'MASTER') {
      return res.status(403).json({ sucesso: false, erro: 'Você não pode editar suas próprias permissões.' });
    }

    if ((alvo.PERFIL||alvo.perfil||'').toUpperCase() === 'MASTER' && normalizarTexto(req.user.usuario) === normalizarTexto(alvo.USUARIO||alvo.EMAIL))
      return res.status(403).json({ sucesso: false, erro: 'Não é possível alterar as próprias permissões de MASTER.' });

    await atualizarPorID('USUARIOS', id, {
      PERMISSOES_GRANTED: JSON.stringify(permissoes_granted),
      PERMISSOES_BLOCKED: JSON.stringify(permissoes_blocked),
      DATA_ULTIMA_ALTERACAO: new Date().toISOString(),
      ALTERADO_POR: req.user.usuario,
    }, ['ID_USUARIO','USUARIO','EMAIL']);

    // Invalida o cache de status do usuário alvo para as novas permissões valerem imediatamente
    const loginAlvo = alvo.USUARIO || alvo.EMAIL || '';
    _statusCache.delete(loginAlvo);
    _statusCache.delete(normalizarTexto(loginAlvo));
    invalidarCacheAba('USUARIOS');

    try {
      await registrarAuditoria(req.user.usuario, 'PERMISSOES_ALTERADAS', id, 'USUARIOS', null,
        { granted: permissoes_granted, blocked: permissoes_blocked, justificativa });
    } catch(_) {}

    res.json({ sucesso: true, mensagem: 'Permissões atualizadas.' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== APROVADORES =====
app.get('/api/aprovadores', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const [a,c,ac]=await Promise.all([lerAba('APROVADORES',500).catch(()=>[]),lerAba('COMPETENCIAS',500).catch(()=>[]),lerAba('APROVADOR_COMPETENCIAS',2000).catch(()=>[])]);
    res.json({sucesso:true,aprovadores:a,competencias:c,relacionamentos:ac});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.get('/api/aprovadores/:usuario/pendencias', requerPerfil('APROVADOR','APROVADOR MASTER','MASTER'), async (req,res)=>{
  try {
    const perfil = perfilCanonico(req.user?.perfil || '');
    if (perfil !== 'MASTER' && perfil !== 'APROVADOR MASTER' && normalizarTexto(req.params.usuario) !== normalizarTexto(req.user?.usuario || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    const usuario=req.params.usuario;
    const [aprovadores,rel,comp,rncs,mans]=await Promise.all([lerAba('APROVADORES',500).catch(()=>[]),lerAba('APROVADOR_COMPETENCIAS',5000).catch(()=>[]),lerAba('COMPETENCIAS',500).catch(()=>[]),lerAba('BANCO_RNC',5000).catch(()=>[]),lerAba('MANIFESTACOES',5000).catch(()=>[])]);
    const ap=aprovadores.find(x=>normalizarTexto(x.ID_APROVADOR||x.NOME||x.EMAIL)===normalizarTexto(usuario));
    const apId=ap?.ID_APROVADOR||usuario;
    const relAtivos=rel.filter(x=>String(x.ID_APROVADOR||'')===String(apId)&&normalizarTexto(x.STATUS||'ATIVO')!=='inativo');
    const compIds=relAtivos.map(x=>x.ID_COMPETENCIA);
    const compNames=comp.filter(x=>compIds.includes(x.ID_COMPETENCIA)).map(x=>String(x.NOME||'').trim()).filter(Boolean);
    const empresas=relAtivos.map(x=>String(x.EMPRESA||'').trim()).filter(Boolean);
    const n=v=>normalizarTexto(v);
    const isMasterAprov = perfil === 'MASTER' || perfil === 'APROVADOR MASTER';
    const rnc = isMasterAprov
      ? rncs.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase()))
      : rncs.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(compNames.some(c=>n(c)===n(r.COMPETENCIA||r.SETOR))||relAtivos.some(x=>n(x.NOME_COMPETENCIA)===n(r.COMPETENCIA||r.SETOR)))&&(!empresas.length||empresas.some(e=>n(e)===n(r.EMPRESA))));
    const sac=mans.filter(m=>!['ENCERRADA','CONCLUÍDA','CONCLUIDA','CANCELADA','REJEITADA'].includes(String(m.STATUS||'').toUpperCase())&&(m.STATUS==='AGUARDANDO_APROVAÇÃO'||m.STATUS==='AGUARDANDO_DECISÃO'||m.STATUS_FICHA==='AGUARDANDO_APROVACAO'||m.APROVACAO_NECESSARIA==='SIM'));
    const sugestoes=(await lerAba('SUGESTOES_APROVADOR',5000).catch(()=>[])).filter(x=>n(x.ID_APROVADOR)===n(apId));
    res.json({sucesso:true,usuario,aprovador:ap,competencias:compNames,empresas,rnc,sac,sugestoes,totais:{rnc:rnc.length,sac:sac.length,total:rnc.length+sac.length}});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/setor/minhas-pendencias', requerPerfil('SETOR RESPONSÁVEL','MASTER'), async (req,res)=>{
  try{
    const rows=await lerAba('BANCO_RNC',5000); const setor=normalizarTexto(req.user.setor);
    const itens=rows.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(!setor||normalizarTexto(r.SETOR||r.SETOR_ACAO)===setor));
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

// ===== ANEXOS =====
async function salvarAnexo(anexo, contexto = {}) {
  const id = await gerarProximoID('ANEXOS','ANX','ID_ANEXO');
  const resultado = await documentService.salvarArquivoGoogleDrive(anexo);
  await appendObjeto('ANEXOS', {
    ID_ANEXO:id, TIPO_ENTIDADE:contexto.tipoEntidade||'', ID_ENTIDADE:contexto.idEntidade||'',
    NOME_ARQUIVO:anexo.nome||anexo.name||'', MIME_TYPE:anexo.mimeType||anexo.type||'',
    TAMANHO:anexo.tamanho||anexo.size||'', URL_ARQUIVO:resultado.url||'',
    DRIVE_FILE_ID:resultado.fileId||'', DATA_UPLOAD:new Date().toISOString(),
    USUARIO_UPLOAD:contexto.usuario||'sistema', CATEGORIA:anexo.categoria||'EVIDENCIA', DESCRICAO:anexo.descricao||''
  });
  return { id, ...resultado };
}
app.get('/api/anexos', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR SAC','AUDITOR'), async (req,res) => {
  try {
    const data=await lerAba('ANEXOS',5000);
    const perfil = perfilCanonico(req.user?.perfil || '');
    const idEntidade = req.query.idEntidade ? String(req.query.idEntidade) : null;
    if (!idEntidade && perfil !== 'MASTER') {
      return res.status(403).json({ sucesso: false, erro: 'Listagem global de anexos requer perfil MASTER.', itens: [] });
    }
    const itens = idEntidade ? data.filter(x=>String(x.ID_ENTIDADE||'')===idEntidade) : data;
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e,'anexos-get'),itens:[]}); }
});
app.post('/api/anexos', requerPerfil('MASTER','ANALISTA SAC'), async (req,res) => {
  try {
    const {arquivo,tipoEntidade,idEntidade,usuario,categoria}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const item=await salvarAnexo({...arquivo,categoria},{tipoEntidade,idEntidade,usuario});
    res.json({sucesso:true,anexo:item});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== DOCUMENTOS =====
app.post('/api/documentos/extrair', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res) => {
  try {
    const {arquivo,tipoDocumento='FICHA_RECLAMACAO'}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const dados=await documentService.extrairDadosDocumento(arquivo,tipoDocumento);
    res.json({sucesso:true,tipoDocumento,dados,validacaoObrigatoria:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== ANÁLISE IA POR MANIFESTAÇÃO =====
app.get('/api/manifestacoes/:id/analise', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    const m = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || ''))
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    const analise = await executarAnalise({
      ...m,
      empresaReclamante: m.EMPRESA_RECLAMANTE,
      empresaReclamada: m.EMPRESA_RECLAMADA,
      descricao: m.DESCRICAO || m.DESCRICAO_MANIFESTACAO,
    });
    res.json({ sucesso:true, analise });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ===== SUGESTÕES APROVADOR =====
app.get('/api/manifestacoes/:id/sugestoes', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    if (req._empresaScope) {
      const mData = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
      const mCheck = mData.find(r => r.ID_MANIFESTACAO === req.params.id);
      if (!mCheck || !pertenceEmpresa(req._empresaScope, mCheck.EMPRESA_RECLAMADA || ''))
        return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado.' });
    }
    const data=await lerAba('SUGESTOES_APROVADOR',5000);
    res.json({sucesso:true,itens:data.filter(x=>String(x.ID_MANIFESTACAO||'')===String(req.params.id))});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.post('/api/manifestacoes/:id/sugestoes', requerPerfil('MASTER','APROVADOR'), async (req,res) => {
  try {
    const {usuario,tipoSugestao,sugestao,justificativa}=req.body||{};
    if(!usuario||!tipoSugestao||!sugestao) return res.status(400).json({sucesso:false,erro:'Campos obrigatórios faltando.'});
    const _manS = (await lerAba('MANIFESTACOES',5000)).find(r=>r.ID_MANIFESTACAO===req.params.id);
    if(!_manS) return res.status(404).json({sucesso:false,erro:'Manifestação não encontrada.'});
    if(!pertenceEmpresa(req.user?.empresa, _manS.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
    const id=await gerarProximoID('SUGESTOES_APROVADOR','SUG','ID_SUGESTAO');
    await appendObjeto('SUGESTOES_APROVADOR',{ID_SUGESTAO:id,ID_MANIFESTACAO:req.params.id,ID_APROVADOR:usuario,TIPO_SUGESTAO:tipoSugestao,SUGESTAO:sugestao,JUSTIFICATIVA:justificativa||'',DATA_SUGESTAO:new Date().toISOString(),STATUS:'PENDENTE'});
    res.json({sucesso:true,id,status:'PENDENTE'});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== CAUSAS HIERÁRQUICAS =====
app.get('/api/causas', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR SAC','AUDITOR','CONSULTA'), async (req,res)=>{
  try {
    const causas = await lerAba('CAUSAS', 2000).catch(()=>[]);
    res.json({sucesso:true, total:causas.length, itens:causas});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

app.post('/api/causas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const {categoria, tipo, causa, subcausa, setorResponsavel, palavrasChave, ativo} = req.body||{};
    if (!categoria || !causa) return res.status(400).json({sucesso:false,erro:'Categoria e causa são obrigatórios.'});
    const id = await gerarProximoID('CAUSAS','CAU','ID_CAUSA');
    const obj = {
      ID_CAUSA:id, CATEGORIA:categoria, TIPO:tipo||'', CAUSA:causa, SUBCAUSA:subcausa||'',
      SETOR_RESPONSAVEL:setorResponsavel||'', PALAVRAS_CHAVE:palavrasChave||'',
      ATIVO:ativo!==false?'SIM':'NAO', DATA_CRIACAO:new Date().toISOString(),
      CRIADO_POR:req.user.usuario
    };
    const headers = await obterCabecalhos('CAUSAS').catch(()=>[]);
    if (!headers.length) {
      const sheets = await getSheets();
      const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
      const existe = meta.data.sheets?.find(s=>s.properties?.title==='CAUSAS');
      if (!existe) {
        await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,resource:{requests:[{addSheet:{properties:{title:'CAUSAS'}}}]}});
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId:SPREADSHEET_ID, range:'CAUSAS!A1:K1', valueInputOption:'RAW',
        resource:{values:[['ID_CAUSA','CATEGORIA','TIPO','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL','PALAVRAS_CHAVE','ATIVO','DATA_CRIACAO','CRIADO_POR','CONTAGEM_OCORRENCIAS']]}
      });
    }
    await appendObjeto('CAUSAS', obj);
    await registrarAuditoria(req.user.usuario,'CRIOU_CAUSA',id,'CAUSAS',null,{categoria,causa,subcausa});
    res.json({sucesso:true, id, causa:obj});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// Popular CAUSAS a partir do BANCO_HISTORICO (extrai tipos/causas únicos)
app.post('/api/causas/popular-historico', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const hist = await lerAba('BANCO_HISTORICO', 5000);
    const existentes = await lerAba('CAUSAS', 2000).catch(()=>[]);
    const causasExistentes = new Set(existentes.map(c=>(c.CAUSA||'').toLowerCase().trim()));

    const mapa = {}; // "tipo|causa|subcausa" -> contagem
    for (const h of hist) {
      const tipo = (h.COMP_TIPO_PROBLEMA_VALIDADO||h.TIPO_PROBLEMA_VALIDADO||'').trim();
      const causa = (h.COMP_CAUSA_RAIZ||h.COMP_CAUSA_PROVAVEL||h.CAUSA_RAIZ||'').trim();
      const subcausa = (h.COMP_SUBCAUSA||h.SUBCAUSA||'').trim();
      const categoria = (h.COMP_CATEGORIA||h.CATEGORIA||tipo||'').trim();
      const setor = (h.COMP_SETOR_RESPONSAVEL||h.SETOR_RESPONSAVEL||h.SETOR||'').trim();
      if (!causa) continue;
      const key = `${tipo}|${causa}|${subcausa}`;
      if (!mapa[key]) mapa[key] = { tipo, causa, subcausa, categoria, setor, count: 0 };
      mapa[key].count++;
    }

    const novas = Object.values(mapa).filter(m => !causasExistentes.has(m.causa.toLowerCase()));
    if (!novas.length) return res.json({ sucesso: true, inseridas: 0, mensagem: 'Todas as causas já existem.' });

    // Garantir cabeçalho da aba
    garantirAbaComCabecalhos('CAUSAS', ['ID_CAUSA','CATEGORIA','TIPO','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL','PALAVRAS_CHAVE','ATIVO','DATA_CRIACAO','CRIADO_POR','CONTAGEM_OCORRENCIAS']).catch(()=>{});

    let inseridas = 0;
    for (const m of novas) {
      const id = await gerarProximoID('CAUSAS','CAU','ID_CAUSA').catch(()=>'CAU-'+Date.now().toString().slice(-6));
      await appendObjeto('CAUSAS', {
        ID_CAUSA: id, CATEGORIA: m.categoria||m.tipo||'GERAL', TIPO: m.tipo||'',
        CAUSA: m.causa, SUBCAUSA: m.subcausa, SETOR_RESPONSAVEL: m.setor,
        PALAVRAS_CHAVE: '', ATIVO: 'SIM',
        DATA_CRIACAO: new Date().toISOString(),
        CRIADO_POR: 'IMPORTACAO_HISTORICO',
        CONTAGEM_OCORRENCIAS: m.count,
      });
      inseridas++;
    }

    res.json({ sucesso: true, inseridas, total_historico: hist.length, mensagem: `${inseridas} causas extraídas do histórico e inseridas.` });
  } catch(e){ res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.patch('/api/causas/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const b = req.body||{};
    const dados = {};
    if (b.CAUSA!==undefined) dados.CAUSA=b.CAUSA;
    if (b.SUBCAUSA!==undefined) dados.SUBCAUSA=b.SUBCAUSA;
    if (b.DESCRICAO!==undefined) dados.DESCRICAO=b.DESCRICAO;
    if (b.SETOR!==undefined) dados.SETOR=b.SETOR;
    if (b.ATIVO!==undefined) dados.ATIVO=b.ATIVO;
    const r = await atualizarPorID('CAUSAS', req.params.id, dados, ['ID_CAUSA']);
    if (!r) return res.status(404).json({sucesso:false,erro:'Causa não encontrada.'});
    res.json({sucesso:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== ASSERTIVIDADE DA IA =====
app.post('/api/assertividade-ia', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const {idManifestacao, decisaoAceita, causaConfirmada, subcausaConfirmada, setorConfirmado, tratativaAceita, devolutivaAceita, observacao} = req.body||{};
    if (!idManifestacao) return res.status(400).json({sucesso:false,erro:'ID da manifestação é obrigatório.'});
    // Verificar isolamento de empresa
    const mans = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    const mRef = mans.find(m=>m.ID_MANIFESTACAO===idManifestacao);
    if (mRef && !pertenceEmpresa(req.user?.empresa, mRef.EMPRESA_RECLAMADA)) {
      return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
    }
    const id = await gerarProximoID('ASSERTIVIDADE_IA','ASS','ID_ASSERTIVIDADE');
    const obj = {
      ID_ASSERTIVIDADE:id, ID_MANIFESTACAO:idManifestacao,
      DECISAO_ACEITA:decisaoAceita?'SIM':'NAO',
      CAUSA_CONFIRMADA:causaConfirmada||'', SUBCAUSA_CONFIRMADA:subcausaConfirmada||'',
      SETOR_CONFIRMADO:setorConfirmado||'', TRATATIVA_ACEITA:tratativaAceita?'SIM':'NAO',
      DEVOLUTIVA_ACEITA:devolutivaAceita?'SIM':'NAO',
      OBSERVACAO:observacao||'', DATA_AVALIACAO:new Date().toISOString(),
      AVALIADO_POR:req.user?.usuario||'sistema'
    };
    const headers = await obterCabecalhos('ASSERTIVIDADE_IA').catch(()=>[]);
    if (!headers.length) {
      const sheets = await getSheets();
      const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
      const existe = meta.data.sheets?.find(s=>s.properties?.title==='ASSERTIVIDADE_IA');
      if (!existe) {
        await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,resource:{requests:[{addSheet:{properties:{title:'ASSERTIVIDADE_IA'}}}]}});
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId:SPREADSHEET_ID, range:'ASSERTIVIDADE_IA!A1:L1', valueInputOption:'RAW',
        resource:{values:[['ID_ASSERTIVIDADE','ID_MANIFESTACAO','DECISAO_ACEITA','CAUSA_CONFIRMADA','SUBCAUSA_CONFIRMADA','SETOR_CONFIRMADO','TRATATIVA_ACEITA','DEVOLUTIVA_ACEITA','OBSERVACAO','DATA_AVALIACAO','AVALIADO_POR','PONTUACAO']]}
      });
    }
    const pontuacao = [decisaoAceita,causaConfirmada,setorConfirmado,tratativaAceita,devolutivaAceita].filter(Boolean).length * 20;
    obj.PONTUACAO = String(pontuacao);
    await appendObjeto('ASSERTIVIDADE_IA', obj);
    await atualizarPorID('MANIFESTACOES', idManifestacao, {ASSERTIVIDADE_IA:String(pontuacao), DECISAO_ACEITA:decisaoAceita?'SIM':'NAO', CAUSA_CONFIRMADA:causaConfirmada||'', SUBCAUSA_CONFIRMADA:subcausaConfirmada||'', AVALIADO_EM:new Date().toISOString()}, ['ID_MANIFESTACAO']);
    await registrarAuditoria(req.user?.usuario||'sistema','AVALIOU_ASSERTIVIDADE_IA',idManifestacao,'ASSERTIVIDADE_IA',null,{pontuacao,decisaoAceita});
    res.json({sucesso:true, id, pontuacao});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== PAINEL DA MÁQUINA =====
app.get('/api/painel-maquina', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','DIRETOR','AUDITOR','VISUALIZADOR'), async (req,res)=>{
  try {
    const {setor, de, ate} = req.query;
    // Empresa sempre do JWT — MASTER pode filtrar por query, demais fixo no JWT
    const perfil = perfilCanonico(req.user?.perfil||'');
    const empresaFiltro = perfil === 'MASTER' ? (req.query.empresa||null) : (req.user?.empresa||null);
    const [mans, asserts, causas] = await Promise.all([
      lerAba('MANIFESTACOES', 5000),
      lerAba('ASSERTIVIDADE_IA', 5000).catch(()=>[]),
      lerAba('CAUSAS', 2000).catch(()=>[]),
    ]);

    let filtradas = mans;
    if (empresaFiltro) filtradas = filtradas.filter(m=>String(m.EMPRESA_RECLAMADA||'').toLowerCase().includes(empresaFiltro.toLowerCase()));
    if (setor) filtradas = filtradas.filter(m=>String(m.SETOR_RESPONSAVEL||'').toLowerCase().includes(setor.toLowerCase()));
    if (de) filtradas = filtradas.filter(m=>{ const d=new Date(m.DATA_CRIACAO||m.DATA_ABERTURA||0); return d>=new Date(de); });
    if (ate) filtradas = filtradas.filter(m=>{ const d=new Date(m.DATA_CRIACAO||m.DATA_ABERTURA||0); return d<=new Date(ate+'T23:59:59'); });

    const total = filtradas.length;
    const comAnalise = filtradas.filter(m=>m.ANALISE_IA_STATUS||m.DECISAO_FINAL).length;
    const comAssert = asserts.filter(a=>filtradas.some(m=>m.ID_MANIFESTACAO===a.ID_MANIFESTACAO));
    const aceitasTotal = comAssert.filter(a=>a.DECISAO_ACEITA==='SIM').length;
    const assertPercent = comAssert.length ? Math.round(aceitasTotal/comAssert.length*100) : 0;
    const pontuacaoMedia = comAssert.length ? Math.round(comAssert.reduce((s,a)=>s+Number(a.PONTUACAO||0),0)/comAssert.length) : 0;
    const encerradas = filtradas.filter(m=>['ENCERRADA','FINALIZADA','CONCLUÍDA','CONCLUIDA'].includes((m.STATUS||'').toUpperCase()));
    const taxaResolucao = total ? Math.round(encerradas.length/total*100) : 0;

    const setoresCount = {};
    filtradas.forEach(m=>{ const s=m.SETOR_RESPONSAVEL||'Não definido'; setoresCount[s]=(setoresCount[s]||0)+1; });
    const topSetores = Object.entries(setoresCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,n])=>({setor:s,total:n}));

    const causasCount = {};
    filtradas.forEach(m=>{ const c=m.CAUSA_RAIZ||m.CAUSA_CONFIRMADA||'Não classificada'; causasCount[c]=(causasCount[c]||0)+1; });
    const topCausas = Object.entries(causasCount).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>({causa:c,total:n}));

    const slaStatus = {ok:0,alerta:0,vencido:0};
    const agora = Date.now();
    filtradas.filter(m=>!['ENCERRADA','FINALIZADA','CONCLUÍDA','CONCLUIDA'].includes((m.STATUS||'').toUpperCase())).forEach(m=>{
      const criacao = new Date(m.DATA_CRIACAO||m.DATA_ABERTURA||agora).getTime();
      const slaH = Number(m.SLA_HORAS||72);
      const elapsed = (agora-criacao)/3600000;
      if (elapsed>=slaH) slaStatus.vencido++;
      else if (elapsed>=slaH*0.75) slaStatus.alerta++;
      else slaStatus.ok++;
    });

    // Campos operacionais adicionais
    const devolutivasCount = filtradas.filter(m => m.DEVOLUTIVA_ENVIADA && m.DEVOLUTIVA_ENVIADA !== '').length;
    const reincidenciasCount = filtradas.filter(m => (m.REINCIDENCIA||'').toUpperCase() === 'SIM').length;
    const reincidenciasPercent = total ? Math.round(reincidenciasCount / total * 100) : 0;
    const rncsCount = filtradas.filter(m => (m.GEROU_RNC||'').toUpperCase() === 'SIM').length;
    const comTempo = encerradas.filter(m => m.DATA_CONCLUSAO_MANIFESTACAO && (m.DATA_CRIACAO||m.DATA_ABERTURA));
    const tempoMedioH = comTempo.length ? Math.round(comTempo.reduce((s,m) => {
      return s + (new Date(m.DATA_CONCLUSAO_MANIFESTACAO) - new Date(m.DATA_CRIACAO||m.DATA_ABERTURA)) / 3600000;
    }, 0) / comTempo.length) : null;
    const encerradasNoPrazo = encerradas.filter(m => {
      if (!m.DATA_ABERTURA && !m.DATA_CRIACAO) return false;
      if (!m.DATA_CONCLUSAO_MANIFESTACAO) return false;
      const slaH = Number(m.SLA_HORAS || 72);
      const elapsed = (new Date(m.DATA_CONCLUSAO_MANIFESTACAO) - new Date(m.DATA_CRIACAO||m.DATA_ABERTURA)) / 3600000;
      return elapsed <= slaH;
    }).length;
    const dentroSlaPercent = encerradas.length ? Math.round(encerradasNoPrazo / encerradas.length * 100) : 0;

    res.json({
      sucesso:true,
      metricas:{
        totalManifestacoes:total, comAnalise, taxaResolucao, assertPercent, pontuacaoMedia,
        totalAvaliados:comAssert.length, totalAceitos:aceitasTotal,
        encerradas:encerradas.length, emAberto:total-encerradas.length,
        devolutivas:devolutivasCount, reincidencias:reincidenciasCount, reincidenciasPercent,
        rncs:rncsCount, tempoMedioH, dentroSlaPercent,
      },
      sla:slaStatus, topSetores, topCausas,
      totalCausasCadastradas:causas.filter(c=>c.ATIVO!=='NAO').length,
    });
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== SUGESTÕES DE MELHORIA =====
app.get('/api/sugestoes-melhoria', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    const itens = await lerAba('SUGESTOES_MELHORIA', 2000).catch(()=>[]);
    const status = req.query.status;
    const filtrados = status ? itens.filter(s=>(s.STATUS||'').toUpperCase()===status.toUpperCase()) : itens;
    res.json({sucesso:true, total:filtrados.length, itens:filtrados});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

app.post('/api/sugestoes-melhoria', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const {idManifestacao, tipo, titulo, descricao, setor, prioridade} = req.body||{};
    if (!titulo||!descricao) return res.status(400).json({sucesso:false,erro:'Título e descrição são obrigatórios.'});
    // Garante aba antes de qualquer leitura
    const headers = await obterCabecalhos('SUGESTOES_MELHORIA').catch(()=>[]);
    if (!headers.length) {
      const sheets = await getSheets();
      const meta = await sheets.spreadsheets.get({spreadsheetId:SPREADSHEET_ID});
      const existe = meta.data.sheets?.find(s=>s.properties?.title==='SUGESTOES_MELHORIA');
      if (!existe) {
        await sheets.spreadsheets.batchUpdate({spreadsheetId:SPREADSHEET_ID,resource:{requests:[{addSheet:{properties:{title:'SUGESTOES_MELHORIA'}}}]}});
      }
      await sheets.spreadsheets.values.update({
        spreadsheetId:SPREADSHEET_ID, range:'SUGESTOES_MELHORIA!A1:N1', valueInputOption:'RAW',
        resource:{values:[['ID_SUGESTAO_MELHORIA','ID_MANIFESTACAO','TIPO','TITULO','DESCRICAO','SETOR','PRIORIDADE','STATUS','DATA_CRIACAO','CRIADO_POR','DATA_AVALIACAO','AVALIADO_POR','RESULTADO','IMPACTO_ESTIMADO']]}
      });
    }
    const id = await gerarProximoID('SUGESTOES_MELHORIA','SME','ID_SUGESTAO_MELHORIA');
    const obj = {
      ID_SUGESTAO_MELHORIA:id, ID_MANIFESTACAO:idManifestacao||'', TIPO:tipo||'PROCESSO',
      TITULO:titulo, DESCRICAO:descricao, SETOR:setor||'', PRIORIDADE:prioridade||'MEDIA',
      STATUS:'PENDENTE', DATA_CRIACAO:new Date().toISOString(),
      CRIADO_POR:req.user?.usuario||'sistema', DATA_AVALIACAO:'', AVALIADO_POR:'', RESULTADO:''
    };
    await appendObjeto('SUGESTOES_MELHORIA', obj);
    res.json({sucesso:true, id, sugestao:obj});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.patch('/api/sugestoes-melhoria/:id', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const dados = {...req.body, DATA_AVALIACAO:new Date().toISOString(), AVALIADO_POR:req.user.usuario};
    const r = await atualizarPorID('SUGESTOES_MELHORIA', req.params.id, dados, ['ID_SUGESTAO_MELHORIA']);
    if (!r) return res.status(404).json({sucesso:false,erro:'Sugestão não encontrada.'});
    res.json({sucesso:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== CONTEXTO DO CLIENTE =====
app.get('/api/cliente-contexto', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const {cliente} = req.query;
    if (!cliente) return res.status(400).json({sucesso:false,erro:'Cliente é obrigatório.'});
    // Empresa vem sempre do JWT, nunca do query string
    const perfil = perfilCanonico(req.user?.perfil||'');
    const empresaJwt = perfil === 'MASTER' ? '' : (req.user?.empresa||'');
    const norm = v=>String(v||'').toLowerCase().trim();
    const [mans, hist] = await Promise.all([
      lerAba('MANIFESTACOES', 5000),
      lerAba('BANCO_HISTORICO', 5000).catch(()=>[]),
    ]);
    const clienteNorm = norm(cliente);
    const empresaNorm = empresaJwt?norm(empresaJwt):'';
    const casosMan = mans.filter(m=>norm(m.CONTATO||m.EMPRESA_RECLAMANTE||'').includes(clienteNorm)&&(!empresaNorm||norm(m.EMPRESA_RECLAMADA||'').includes(empresaNorm)));
    const casosHist = hist.filter(h=>norm(h.ORIG_CONTATO||h.EMPRESA_RECLAMANTE||'').includes(clienteNorm)&&(!empresaNorm||norm(h.ORIG_EMPRESA||h.EMPRESA_RECLAMADA||'').includes(empresaNorm)));
    const todosCasos = [...casosMan.map(m=>({id:m.ID_MANIFESTACAO,fonte:'MANIFESTACOES',data:m.DATA_CRIACAO||m.DATA_ABERTURA,status:m.STATUS,tipo:m.TIPO||'',produto:m.PRODUTO||'',causa:m.CAUSA_RAIZ||m.CAUSA_CONFIRMADA||'',descricao:(m.DESCRICAO_RECLAMACAO||m.DESCRICAO||'').slice(0,200)})),...casosHist.map(h=>({id:h.ID_HISTORICO||h.ID_MANIFESTACAO,fonte:'BANCO_HISTORICO',data:h.ORIG_DATA_ABERTURA||h.DATA_ABERTURA,status:h.STATUS_FINAL||h.STATUS||'',tipo:h.COMP_TIPO_PROBLEMA_VALIDADO||h.TIPO||'',produto:h.ORIG_PRODUTO||h.PRODUTO||'',causa:h.COMP_CAUSA_PROVAVEL||h.CAUSA_RAIZ||'',descricao:(h.ORIG_DESCRICAO_RECLAMACAO||h.DESCRICAO||'').slice(0,200)}))];
    todosCasos.sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));
    const produtos = [...new Set(todosCasos.map(c=>c.produto).filter(Boolean))];
    const causasFreq = {};
    todosCasos.forEach(c=>{if(c.causa)causasFreq[c.causa]=(causasFreq[c.causa]||0)+1;});
    res.json({sucesso:true,cliente,empresa:empresaJwt||'',totalCasos:todosCasos.length,casos:todosCasos.slice(0,20),produtos,causasRecorrentes:Object.entries(causasFreq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>({causa:c,ocorrencias:n}))});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ===== RESET SENHA VIA GET (sem preflight CORS) =====
// Rota _reset removida por segurança (credenciais em query param, rota pública)

// ===== BOOTSTRAP — criar primeiro usuário MASTER =====
app.post('/api/bootstrap', async (req, res) => bootstrapHandler(req, res));
async function bootstrapHandler(req, res) {
  try {
    const { usuario, nome, senha, bootstrapKey } = req.body || {};
    const keyOk = bootstrapKey && bootstrapKey === (process.env.BOOTSTRAP_KEY || '');
    if (!keyOk) {
      const existentes = await lerAba('USUARIOS', 10).catch(() => []);
      if (existentes.length > 0) {
        return res.status(403).json({ sucesso: false, erro: 'Já existem usuários cadastrados. Use BOOTSTRAP_KEY para forçar criação.' });
      }
    }
    if (!usuario || !nome || !senha) return res.status(400).json({ sucesso: false, erro: 'usuario, nome e senha são obrigatórios.' });
    if (senha.length < 6) return res.status(400).json({ sucesso: false, erro: 'Senha deve ter ao menos 6 caracteres.' });
    const sheets = await getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
    const existe = meta.data.sheets?.find(s => s.properties?.title === 'USUARIOS');
    if (!existe) {
      await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: [{ addSheet: { properties: { title: 'USUARIOS' } } }] } });
    }
    const headers = await obterCabecalhos('USUARIOS').catch(() => []);
    const cols = ['ID_USUARIO','USUARIO','EMAIL','NOME','PERFIL','EMPRESA','SETOR','CODIGO_RCA','STATUS','SENHA_HASH','DATA_CRIACAO','ULTIMO_ACESSO'];
    if (!headers.length) {
      await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `USUARIOS!A1:L1`, valueInputOption: 'RAW', resource: { values: [cols] } });
    }
    const hash = await hashSenha(senha);
    // Se keyOk e usuário já existe, apenas atualiza a senha
    if (keyOk) {
      const todos = await lerAba('USUARIOS', 100).catch(() => []);
      const existente = todos.find(u => normalizarTexto(u.USUARIO || '') === normalizarTexto(usuario));
      if (existente) {
        await atualizarPorID('USUARIOS', existente.ID_USUARIO || existente.USUARIO, { SENHA_HASH: hash, STATUS: 'ATIVO' }, ['ID_USUARIO', 'USUARIO']);
        return res.json({ sucesso: true, mensagem: `Senha do usuário "${usuario}" redefinida com sucesso. Agora você pode logar normalmente.`, acao: 'senha_atualizada' });
      }
    }
    const obj = { ID_USUARIO: 'USR-0001', USUARIO: usuario, EMAIL: '', NOME: nome, PERFIL: 'MASTER', EMPRESA: 'Grupo Chiacchio', SETOR: 'SAC', CODIGO_RCA: '', STATUS: 'ATIVO', SENHA_HASH: hash, DATA_CRIACAO: new Date().toISOString(), ULTIMO_ACESSO: '' };
    await appendObjeto('USUARIOS', obj);
    res.json({ sucesso: true, mensagem: `Usuário MASTER "${usuario}" criado com sucesso. Agora você pode logar normalmente.`, id: 'USR-0001' });
  } catch (e) {
    console.error('Bootstrap erro:', e);
    res.status(500).json({ sucesso: false, erro: erroSeguro(e) });
  }
}


// ===== MÓDULO COMPLETO DE APROVAÇÃO =====

const APROVADORES_HEADERS = ['ID_APROVADOR','NOME','EMAIL','USUARIO','CARGO','EMPRESA','SETOR','STATUS','DATA_CRIACAO','OBSERVACOES'];
const COMPETENCIAS_HEADERS = ['ID_COMPETENCIA','NOME','DESCRICAO','TIPO','STATUS','DATA_CRIACAO'];
const APROV_COMP_HEADERS = ['ID','ID_APROVADOR','NOME_APROVADOR','ID_COMPETENCIA','NOME_COMPETENCIA','EMPRESA','STATUS','DATA_ATRIBUICAO'];
const REGRAS_APROV_HEADERS = ['ID_REGRA','NOME','TIPO_ENTIDADE','DESCRICAO_CONDICAO','COMPETENCIA_NECESSARIA','PRIORIDADE','STATUS','DATA_CRIACAO','USUARIO_CRIACAO'];
const FILA_APROV_HEADERS = ['ID_FILA','ID_ENTIDADE','TIPO_ENTIDADE','DESCRICAO','EMPRESA','SETOR','COMPETENCIA','STATUS','ID_APROVADOR','NOME_APROVADOR','DATA_ENVIO','DATA_DECISAO','OBSERVACOES','CRIADO_POR','ID_REGRA'];
const HIST_APROV_HEADERS = ['ID_HISTORICO','ID_FILA','ID_ENTIDADE','TIPO_ENTIDADE','DECISAO','OBSERVACOES','APROVADOR','DATA_DECISAO','DETALHES','EMPRESA_SCOPE'];

// Listar aprovadores + competências + relacionamentos (MASTER)
app.get('/api/aprovadores-admin', requerPerfil('MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('APROVADORES', APROVADORES_HEADERS).catch(()=>{});
    garantirAbaComCabecalhos('COMPETENCIAS', COMPETENCIAS_HEADERS).catch(()=>{});
    garantirAbaComCabecalhos('APROVADOR_COMPETENCIAS', APROV_COMP_HEADERS).catch(()=>{});
    const [ap,comp,rel] = await Promise.all([
      lerAba('APROVADORES',500).catch(()=>[]),
      lerAba('COMPETENCIAS',500).catch(()=>[]),
      lerAba('APROVADOR_COMPETENCIAS',2000).catch(()=>[]),
    ]);
    res.json({sucesso:true,aprovadores:ap,competencias:comp,relacionamentos:rel});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Criar aprovador (MASTER)
app.post('/api/aprovadores-admin', requerPerfil('MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('APROVADORES', APROVADORES_HEADERS).catch(()=>{});
    const {nome,email,usuario,cargo,empresa,setor,observacoes} = req.body||{};
    if(!nome) return res.status(400).json({sucesso:false,erro:'Nome é obrigatório.'});
    const id = await gerarProximoID('APROVADORES','APV','ID_APROVADOR');
    const obj = {ID_APROVADOR:id,NOME:nome,EMAIL:email||'',USUARIO:usuario||'',CARGO:cargo||'',EMPRESA:empresa||'',SETOR:setor||'',STATUS:'ATIVO',DATA_CRIACAO:new Date().toISOString(),OBSERVACOES:observacoes||''};
    await appendObjeto('APROVADORES',obj);
    await registrarAuditoria(req.user.usuario,'APROVADOR_CRIADO',id,'APROVADORES','',JSON.stringify({nome,empresa,setor}));
    res.json({sucesso:true,aprovador:obj});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Atualizar aprovador (MASTER)
app.put('/api/aprovadores-admin/:id', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const campos = ['NOME','EMAIL','USUARIO','CARGO','EMPRESA','SETOR','STATUS','OBSERVACOES'];
    const dados = {};
    for(const c of campos) { if(req.body[c]!==undefined) dados[c]=req.body[c]; }
    const r = await atualizarPorID('APROVADORES',req.params.id,dados,['ID_APROVADOR']);
    if(!r) return res.status(404).json({sucesso:false,erro:'Aprovador não encontrado.'});
    await registrarAuditoria(req.user.usuario,'APROVADOR_ATUALIZADO',req.params.id,'APROVADORES','',JSON.stringify(dados));
    res.json({sucesso:true});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Listar competências
app.get('/api/competencias-lista', requerPerfil('MASTER','APROVADOR','ANALISTA SAC'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('COMPETENCIAS', COMPETENCIAS_HEADERS).catch(()=>{});
    const comp = await lerAba('COMPETENCIAS',500).catch(()=>[]);
    res.json({sucesso:true,competencias:comp.filter(c=>c.STATUS!=='INATIVO')});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Criar competência (MASTER)
app.post('/api/competencias-lista', requerPerfil('MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('COMPETENCIAS', COMPETENCIAS_HEADERS).catch(()=>{});
    const {nome,descricao,tipo} = req.body||{};
    if(!nome) return res.status(400).json({sucesso:false,erro:'Nome é obrigatório.'});
    const id = await gerarProximoID('COMPETENCIAS','CMP','ID_COMPETENCIA');
    const obj = {ID_COMPETENCIA:id,NOME:nome,DESCRICAO:descricao||'',TIPO:tipo||'AMBOS',STATUS:'ATIVO',DATA_CRIACAO:new Date().toISOString()};
    await appendObjeto('COMPETENCIAS',obj);
    res.json({sucesso:true,competencia:obj});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Atribuir competência a aprovador (MASTER)
app.post('/api/aprovador-competencias', requerPerfil('MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('APROVADOR_COMPETENCIAS', APROV_COMP_HEADERS).catch(()=>{});
    const {idAprovador,nomeAprovador,idCompetencia,nomeCompetencia,empresa} = req.body||{};
    if(!idAprovador||!idCompetencia) return res.status(400).json({sucesso:false,erro:'ID Aprovador e ID Competência são obrigatórios.'});
    const id = await gerarProximoID('APROVADOR_COMPETENCIAS','AC','ID');
    const obj = {ID:id,ID_APROVADOR:idAprovador,NOME_APROVADOR:nomeAprovador||'',ID_COMPETENCIA:idCompetencia,NOME_COMPETENCIA:nomeCompetencia||'',EMPRESA:empresa||'',STATUS:'ATIVO',DATA_ATRIBUICAO:new Date().toISOString()};
    await appendObjeto('APROVADOR_COMPETENCIAS',obj);
    res.json({sucesso:true,relacionamento:obj});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Remover atribuição de competência (MASTER)
app.delete('/api/aprovador-competencias/:id', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const r = await atualizarPorID('APROVADOR_COMPETENCIAS',req.params.id,{STATUS:'INATIVO'},['ID']);
    if(!r) return res.status(404).json({sucesso:false,erro:'Relacionamento não encontrado.'});
    res.json({sucesso:true});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Listar regras de aprovação
app.get('/api/regras-aprovacao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('REGRAS_APROVACAO', REGRAS_APROV_HEADERS).catch(()=>{});
    const regras = await lerAba('REGRAS_APROVACAO',500).catch(()=>[]);
    res.json({sucesso:true,regras});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Criar regra de aprovação (MASTER)
app.post('/api/regras-aprovacao', requerPerfil('MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('REGRAS_APROVACAO', REGRAS_APROV_HEADERS).catch(()=>{});
    const {nome,tipoEntidade,descricaoCondicao,competenciaNecessaria,prioridade} = req.body||{};
    if(!nome||!tipoEntidade||!competenciaNecessaria) return res.status(400).json({sucesso:false,erro:'Nome, tipo de entidade e competência são obrigatórios.'});
    const id = await gerarProximoID('REGRAS_APROVACAO','RGR','ID_REGRA');
    const obj = {ID_REGRA:id,NOME:nome,TIPO_ENTIDADE:tipoEntidade,DESCRICAO_CONDICAO:descricaoCondicao||'',COMPETENCIA_NECESSARIA:competenciaNecessaria,PRIORIDADE:prioridade||'NORMAL',STATUS:'ATIVO',DATA_CRIACAO:new Date().toISOString(),USUARIO_CRIACAO:req.user.usuario};
    await appendObjeto('REGRAS_APROVACAO',obj);
    res.json({sucesso:true,regra:obj});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Atualizar regra (MASTER)
app.put('/api/regras-aprovacao/:id', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const campos = ['NOME','DESCRICAO_CONDICAO','COMPETENCIA_NECESSARIA','PRIORIDADE','STATUS'];
    const dados = {};
    for(const c of campos) { if(req.body[c]!==undefined) dados[c]=req.body[c]; }
    const r = await atualizarPorID('REGRAS_APROVACAO',req.params.id,dados,['ID_REGRA']);
    if(!r) return res.status(404).json({sucesso:false,erro:'Regra não encontrada.'});
    res.json({sucesso:true});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Listar fila de aprovação (filtrada por perfil e empresa)
app.get('/api/fila-aprovacao', middlewareEscopoEmpresa(), requerPermissao('aprovacoes.visualizar'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('FILA_APROVACAO', FILA_APROV_HEADERS).catch(()=>{});
    const u = req.user;
    const fila = await lerAba('FILA_APROVACAO',2000).catch(()=>[]);
    // B2: filtrar por empresa primeiro
    const filaEmpresa = filtrarPorEmpresa(fila, req, COLUNA_EMPRESA_ABA.FILA_APROVACAO);
    let itens = filaEmpresa;
    const n = v => normalizarTexto(v);
    if(perfilCanonico(u.perfil) === 'ANALISTA SAC') {
      itens = filaEmpresa.filter(x => n(x.CRIADO_POR||'') === n(u.usuario));
    } else if(perfilCanonico(u.perfil) === 'APROVADOR') {
      itens = filaEmpresa.filter(x => n(x.ID_APROVADOR||'') === n(u.usuario) || n(x.NOME_APROVADOR||'') === n(u.nome||u.usuario) || n(x.ID_APROVADOR||'') === n(u.id||''));
    }
    const pendentes = itens.filter(x=>x.STATUS==='PENDENTE').length;
    res.json({sucesso:true,total:itens.length,pendentes,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Enviar item para aprovação (ANALISTA SAC, MASTER)
app.post('/api/fila-aprovacao', requerPermissao('aprovacoes.aprovar'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('FILA_APROVACAO', FILA_APROV_HEADERS).catch(()=>{});
    const {idEntidade,tipoEntidade,descricao,empresa,setor,competencia,idAprovador,nomeAprovador,idRegra} = req.body||{};
    if(!idEntidade||!tipoEntidade) return res.status(400).json({sucesso:false,erro:'ID e tipo da entidade são obrigatórios.'});
    const fila = await lerAba('FILA_APROVACAO',2000).catch(()=>[]);
    const jaExiste = fila.find(x => String(x.ID_ENTIDADE||'') === String(idEntidade) && x.STATUS === 'PENDENTE');
    if(jaExiste) return res.status(409).json({sucesso:false,erro:'Já existe uma aprovação pendente para este item.'});
    const id = await gerarProximoID('FILA_APROVACAO','FAP','ID_FILA');
    const obj = {ID_FILA:id,ID_ENTIDADE:idEntidade,TIPO_ENTIDADE:tipoEntidade,DESCRICAO:descricao||'',EMPRESA:empresa||'',SETOR:setor||'',COMPETENCIA:competencia||'',STATUS:'PENDENTE',ID_APROVADOR:idAprovador||'',NOME_APROVADOR:nomeAprovador||'',DATA_ENVIO:new Date().toISOString(),DATA_DECISAO:'',OBSERVACOES:'',CRIADO_POR:req.user.usuario,ID_REGRA:idRegra||''};
    await appendObjeto('FILA_APROVACAO',obj);
    if(tipoEntidade==='SAC') {
      await atualizarPorID('MANIFESTACOES',idEntidade,{STATUS:'AGUARDANDO_APROVAÇÃO',APROVACAO_NECESSARIA:'SIM'},['ID_MANIFESTACAO']).catch(()=>{});
    } else if(tipoEntidade==='RNC') {
      await atualizarPorID('BANCO_RNC',idEntidade,{STATUS:'AGUARDANDO_APROVAÇÃO'},['ID_RNC']).catch(()=>{});
    }
    await registrarAuditoria(req.user.usuario,'ENVIADO_PARA_APROVACAO',idEntidade,'FILA_APROVACAO','',JSON.stringify({tipoEntidade,competencia,nomeAprovador}));
    res.json({sucesso:true,fila:obj});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Decidir sobre item na fila (APROVADOR, MASTER)
app.post('/api/fila-aprovacao/:id/decidir', requerPerfil('APROVADOR','APROVADOR MASTER','MASTER'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('HISTORICO_APROVACAO', HIST_APROV_HEADERS).catch(()=>{});
    const {decisao, observacoes} = req.body||{};
    const decisoesValidas = ['APROVADO','REJEITADO','DEVOLVIDO','SOLICITANDO_INFORMACOES'];
    if(!decisoesValidas.includes(decisao)) return res.status(400).json({sucesso:false,erro:'Decisão inválida. Use: APROVADO, REJEITADO, DEVOLVIDO ou SOLICITANDO_INFORMACOES'});
    if(decisao!=='APROVADO' && !(observacoes||'').trim()) return res.status(400).json({sucesso:false,erro:'Observações obrigatórias para esta decisão.'});
    const fila = await lerAba('FILA_APROVACAO',2000).catch(()=>[]);
    const item = fila.find(x => String(x.ID_FILA||'') === String(req.params.id));
    if(!item) return res.status(404).json({sucesso:false,erro:'Item não encontrado na fila.'});
    if(item.STATUS !== 'PENDENTE') return res.status(409).json({sucesso:false,erro:'Este item não está mais pendente.'});
    // Bloquear autoaprovação para todos os perfis (incluindo MASTER)
    const n = v => normalizarTexto(v);
    if(n(item.CRIADO_POR||'') === n(req.user.usuario)) {
      return res.status(403).json({sucesso:false,erro:'Autoaprovação não permitida. Você não pode aprovar um item que você mesmo enviou para aprovação.'});
    }
    // Verificar isolamento de empresa para APROVADOR (MASTER e APROVADOR MASTER têm acesso global)
    const _pfDecide = perfilCanonico(req.user.perfil);
    if(_pfDecide !== 'MASTER' && _pfDecide !== 'APROVADOR MASTER' && item.EMPRESA && !pertenceEmpresa(req.user?.empresa, item.EMPRESA)) {
      return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para este item de aprovação.'});
    }
    const now = new Date().toISOString();
    await atualizarPorID('FILA_APROVACAO',req.params.id,{STATUS:decisao,NOME_APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO:now,OBSERVACOES:observacoes||''},['ID_FILA']);
    const histId = await gerarProximoID('HISTORICO_APROVACAO','HAP','ID_HISTORICO');
    await appendObjeto('HISTORICO_APROVACAO',{ID_HISTORICO:histId,ID_FILA:req.params.id,ID_ENTIDADE:item.ID_ENTIDADE,TIPO_ENTIDADE:item.TIPO_ENTIDADE,DECISAO:decisao,OBSERVACOES:observacoes||'',APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO:now,DETALHES:JSON.stringify({empresa:item.EMPRESA,setor:item.SETOR,competencia:item.COMPETENCIA}),EMPRESA_SCOPE:empresaCanonica(item.EMPRESA||'')}).catch(()=>{});
    const novoStatus = decisao==='APROVADO'?'APROVADA':decisao==='REJEITADO'?'REJEITADA':decisao==='DEVOLVIDO'?'EM_ANÁLISE':'AGUARDANDO_APROVAÇÃO';
    if(item.TIPO_ENTIDADE==='SAC') {
      await atualizarPorID('MANIFESTACOES',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now,OBSERVACOES_APROVADOR:observacoes||''},['ID_MANIFESTACAO']).catch(()=>{});
    } else if(item.TIPO_ENTIDADE==='RNC') {
      await atualizarPorID('BANCO_RNC',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now},['ID_RNC']).catch(()=>{});
    }
    await registrarAuditoria(req.user.usuario,`APROVACAO_${decisao}`,item.ID_ENTIDADE,'FILA_APROVACAO',item.STATUS,JSON.stringify({decisao,observacoes}));
    res.json({sucesso:true,decisao,entidade:item.ID_ENTIDADE,novoStatus});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Histórico de aprovações
app.get('/api/historico-aprovacao', requerPerfil('MASTER','APROVADOR'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const hist = await lerAba('HISTORICO_APROVACAO',2000).catch(()=>[]);
    let itens = hist;
    const perfil = perfilCanonico(req.user.perfil);
    if(perfil !== 'MASTER') {
      // Filtra pelo aprovador E pela empresa (extraída de DETALHES ou campo EMPRESA_SCOPE)
      const userEmpCod = empresaCanonica(req.user.empresa || '');
      itens = hist.filter(x => {
        // Filtro por empresa: DETALHES contém {empresa:...}; sem empresa → registro legado, visível
        let detEmpresa = x.EMPRESA_SCOPE || '';
        if (!detEmpresa && x.DETALHES) {
          try { detEmpresa = (JSON.parse(x.DETALHES) || {}).empresa || ''; } catch(_) {}
        }
        if (detEmpresa) {
          const recCod = empresaCanonica(detEmpresa);
          if (recCod && recCod !== userEmpCod) return false;
        } else {
          // Registro sem empresa definida (legado pré-EMPRESA_SCOPE): visível apenas ao MASTER
          return false;
        }
        // Filtro adicional por aprovador para perfil APROVADOR (não APROVADOR MASTER)
        if(perfil === 'APROVADOR') {
          return normalizarTexto(x.APROVADOR||'') === normalizarTexto(req.user.nome||req.user.usuario);
        }
        return true;
      });
    }
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// ===== PORTAL FUNCIONÁRIO — ROTA PÚBLICA (SEM AUTENTICAÇÃO) =====
// Rate limiting em memória para a rota pública
const _publicRateMap = new Map();
function publicRateLimit(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const window = 60 * 1000; // 1 min
  const max = 5; // max 5 requests per minute per IP
  const entry = _publicRateMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > window) { entry.count = 0; entry.start = now; }
  entry.count++;
  _publicRateMap.set(ip, entry);
  if (entry.count > max) return res.status(429).json({ sucesso: false, erro: 'Muitas requisições. Aguarde um momento.' });
  next();
}

// Limpeza periódica do rate limit map
setInterval(() => { const cutoff = Date.now() - 2 * 60 * 1000; _publicRateMap.forEach((v, k) => { if (v.start < cutoff) _publicRateMap.delete(k); }); }, 5 * 60 * 1000).unref();

const ALLOWED_FILE_TYPES = [
  'image/jpeg','image/png','image/gif','image/webp',
  'audio/mpeg','audio/wav','audio/mp4','audio/aac','audio/ogg','audio/webm',
  'video/mp4','video/quicktime','video/webm','video/x-msvideo',
  'application/pdf','application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];
const MAX_FILE_SIZE_MB = 10;

const FICHAS_BIBLIOTECA_HEADERS = [
  'ID_FICHA','ID_MANIFESTACAO','PROTOCOLO','DATA_REGISTRO','ANO','MES',
  'EMPRESA','SETOR_RECEBIMENTO','COLABORADOR_RECEBIMENTO','NOME_CLIENTE',
  'TIPO_MANIFESTACAO','MOTIVO','STATUS','PDF_DRIVE_ID','PDF_DRIVE_URL',
  'PDF_NOME','TOTAL_EVIDENCIAS','CREATED_AT','VERSAO',
];
const EVIDENCIAS_HEADERS = [
  'ID_EVIDENCIA','ID_MANIFESTACAO','NOME','TIPO_MIME','TAMANHO',
  'DRIVE_ID','DRIVE_URL','DATA_UPLOAD','DESCRICAO','ORDEM',
];

app.post('/api/public/reclamacoes', publicRateLimit, async (req, res) => {
  try {
    const b = req.body || {};

    // Campos obrigatórios (ficha oficial)
    const colaboradorRecebimento = String(b.colaboradorRecebimento || '').trim().slice(0, 200);
    const setorRecebimento = String(b.setorRecebimento || '').trim().slice(0, 100);
    const empresa = String(b.empresa || '').trim().slice(0, 200);
    const nomeCliente = String(b.nomeCliente || '').trim().slice(0, 200);
    const descricaoOriginal = String(b.descricaoOriginal || b.descricao || '').trim().slice(0, 4000);
    const tipoManifestacao = String(b.tipoManifestacao || 'Reclamação').trim().slice(0, 50);

    if (!colaboradorRecebimento) return res.status(400).json({ sucesso: false, erro: 'Informe o nome do colaborador.' });
    if (!setorRecebimento) return res.status(400).json({ sucesso: false, erro: 'Informe o setor.' });
    if (!empresa) return res.status(400).json({ sucesso: false, erro: 'Selecione a empresa.' });
    if (!nomeCliente) return res.status(400).json({ sucesso: false, erro: 'Informe o nome do cliente.' });
    if (!descricaoOriginal || descricaoOriginal.length < 10) return res.status(400).json({ sucesso: false, erro: 'Descreva a manifestação (mínimo 10 caracteres).' });

    // Campos opcionais
    const telefone = String(b.telefone || b.telefoneCliente || '').replace(/[^0-9() +\-]/g,'').slice(0, 30);
    const email = String(b.email || b.emailCliente || '').trim().slice(0, 200);
    const canalRecebimento = String(b.canalRecebimento || b.canal || '').trim().slice(0, 50);
    const canalOutro = String(b.canalOutro || '').trim().slice(0, 100);
    const motivoManifestacao = String(b.motivoManifestacao || b.motivo || '').trim().slice(0, 500);
    const produto = String(b.produto || '').trim().slice(0, 200);
    const lote = String(b.lote || '').trim().slice(0, 100);
    const quantidadeAfetada = String(b.quantidadeAfetada || b.quantidade || '').trim().slice(0, 50);
    const observacoes = String(b.observacoes || b.solicitacaoCliente || '').trim().slice(0, 1000);
    const pedido = String(b.pedido || '').trim().slice(0, 100);
    const notaFiscal = String(b.notaFiscal || '').trim().slice(0, 100);

    // Validar evidências
    const evidencias = Array.isArray(b.evidencias) ? b.evidencias.slice(0, 8) : [];
    for (const ev of evidencias) {
      if (!ev.nome || !ev.tipo || !ev.dados) continue;
      if (!ALLOWED_FILE_TYPES.includes(ev.tipo)) return res.status(400).json({ sucesso: false, erro: `Tipo não permitido: ${ev.tipo}` });
      const sizeMB = (ev.dados.length * 3 / 4) / (1024 * 1024);
      if (sizeMB > MAX_FILE_SIZE_MB) return res.status(400).json({ sucesso: false, erro: `Arquivo muito grande: ${ev.nome} (máx ${MAX_FILE_SIZE_MB}MB)` });
    }

    const agora = new Date().toISOString();
    const id = await gerarProximoID('MANIFESTACOES', 'MAN', 'ID_MANIFESTACAO');
    const canalFinal = canalRecebimento === 'Outro' && canalOutro ? `Outro: ${canalOutro}` : (canalRecebimento || 'Não informado');
    const dtReg = new Date(agora);
    const anoReg = dtReg.getFullYear().toString();
    const mesReg = String(dtReg.getMonth() + 1).padStart(2, '0');
    const dataRegistroFmt = dtReg.toLocaleDateString('pt-BR') + ' ' + dtReg.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});

    // 1. Salvar manifestação no Sheets
    const objeto = {
      ID_MANIFESTACAO: id,
      DATA_ABERTURA: agora,
      DATA_REGISTRO: agora,
      EMPRESA_RECLAMADA: empresa,
      EMPRESA_RECLAMANTE: empresa,
      CLIENTE_NOME: nomeCliente,
      NOME_CLIENTE: nomeCliente,
      TELEFONE: telefone,
      EMAIL: email,
      DESCRICAO: descricaoOriginal,
      DESCRICAO_ORIGINAL: descricaoOriginal,
      DESCRICAO_RECLAMACAO: descricaoOriginal,
      DESCRICAO_MANIFESTACAO: descricaoOriginal,
      PRODUTO: produto,
      LOTE: lote,
      PEDIDO: pedido,
      NFE: notaFiscal,
      QUANTIDADE: quantidadeAfetada,
      CANAL: canalFinal,
      MOTIVO: motivoManifestacao,
      OBSERVACOES: observacoes,
      STATUS: 'AGUARDANDO_APROVAÇÃO',
      APROVACAO_NECESSARIA: 'SIM',
      TIPO: tipoManifestacao,
      TIPO_MANIFESTACAO: tipoManifestacao,
      ORIGEM: 'PORTAL_FUNCIONARIO',
      ORIGEM_REGISTRO: 'PORTAL_FUNCIONARIO',
      REGISTRADO_POR: colaboradorRecebimento,
      COLABORADOR_RECEBIMENTO: colaboradorRecebimento,
      SETOR_RECEBIMENTO: setorRecebimento,
      USUARIO_CRIACAO: `portal:${colaboradorRecebimento}`,
      STATUS_TRATATIVA: 'NÃO INICIADA',
    };
    await appendObjeto('MANIFESTACOES', objeto);

    // 2. Upload evidências para o Drive (não bloqueia se falhar)
    const evidenciasMetadata = [];
    for (let i = 0; i < evidencias.length; i++) {
      const ev = evidencias[i];
      if (!ev.nome || !ev.tipo || !ev.dados) continue;
      try {
        const driveFile = await uploadArquivoDrive(`EV_${id}_${i+1}_${ev.nome}`, ev.tipo, ev.dados);
        const evId = await gerarProximoID('EVIDENCIAS', 'EVI', 'ID_EVIDENCIA').catch(() => `EVI-${Date.now()}-${i}`);
        const evMeta = { ID_EVIDENCIA: evId, ID_MANIFESTACAO: id, NOME: ev.nome, TIPO_MIME: ev.tipo, TAMANHO: ev.tamanho || 0, DRIVE_ID: driveFile.id || '', DRIVE_URL: driveFile.webViewLink || driveFile.webContentLink || '', DATA_UPLOAD: agora, DESCRICAO: ev.descricao || '', ORDEM: i + 1 };
        await garantirAbaComCabecalhos('EVIDENCIAS', EVIDENCIAS_HEADERS);
        await appendObjeto('EVIDENCIAS', evMeta);
        evidenciasMetadata.push(evMeta);
      } catch (evErr) {
        console.warn(`[PUBLIC] Evidência ${i+1} falhou no upload:`, evErr.message);
      }
    }

    // 3. Gerar PDF da ficha
    let pdfBuffer = null;
    let pdfBase64 = null;
    if (gerarFichaPDF) {
      try {
        const dadosPDF = { protocolo: id, dataRegistroFmt, setorRecebimento, colaboradorRecebimento, nomeCliente, empresa, telefone, email, canalRecebimento: canalFinal, tipoManifestacao, motivoManifestacao, descricaoOriginal, produto, lote, quantidadeAfetada, observacoes, totalEvidencias: evidenciasMetadata.length };
        pdfBuffer = await gerarFichaPDF(dadosPDF);
        pdfBase64 = pdfBuffer.toString('base64');
      } catch (pdfErr) {
        console.warn('[PUBLIC] PDF geração falhou:', pdfErr.message);
      }
    }

    // 4. Upload PDF para o Drive
    let pdfDriveId = '';
    let pdfDriveUrl = '';
    const pdfNome = `FICHA_${id}.pdf`;
    if (pdfBuffer) {
      try {
        const pdfDrive = await uploadArquivoDrive(pdfNome, 'application/pdf', pdfBuffer);
        pdfDriveId = pdfDrive.id || '';
        pdfDriveUrl = pdfDrive.webViewLink || pdfDrive.webContentLink || '';
      } catch (pdfUpErr) {
        console.warn('[PUBLIC] PDF upload Drive falhou:', pdfUpErr.message);
      }
    }

    // 5. Indexar na FICHAS_BIBLIOTECA
    try {
      await garantirAbaComCabecalhos('FICHAS_BIBLIOTECA', FICHAS_BIBLIOTECA_HEADERS);
      const fichaId = `FIC-${id}`;
      await appendObjeto('FICHAS_BIBLIOTECA', {
        ID_FICHA: fichaId, ID_MANIFESTACAO: id, PROTOCOLO: id,
        DATA_REGISTRO: agora, ANO: anoReg, MES: mesReg,
        EMPRESA: empresa, SETOR_RECEBIMENTO: setorRecebimento,
        COLABORADOR_RECEBIMENTO: colaboradorRecebimento, NOME_CLIENTE: nomeCliente,
        TIPO_MANIFESTACAO: tipoManifestacao, MOTIVO: motivoManifestacao,
        STATUS: 'NOVA', PDF_DRIVE_ID: pdfDriveId, PDF_DRIVE_URL: pdfDriveUrl,
        PDF_NOME: pdfNome, TOTAL_EVIDENCIAS: evidenciasMetadata.length,
        CREATED_AT: agora, VERSAO: '1',
      });
    } catch (bibErr) {
      console.warn('[PUBLIC] FICHAS_BIBLIOTECA indexação falhou:', bibErr.message);
    }

    // 6. Atualizar MANIFESTACOES com referências do PDF/Drive
    if (pdfDriveId) {
      atualizarPorID('MANIFESTACOES', id, { PDF_DRIVE_ID: pdfDriveId, PDF_DRIVE_URL: pdfDriveUrl, PDF_NOME: pdfNome }, ['ID_MANIFESTACAO']).catch(() => {});
    }

    registrarAuditoria(`portal:${colaboradorRecebimento}`, 'CRIOU_MANIFESTAÇÃO_PORTAL', id, 'MANIFESTACOES', null, { empresa, nomeCliente, canal: canalFinal, tipo: tipoManifestacao }).catch(() => {});

    // 7. Inserir na FILA_APROVACAO para que MASTER/APROVADOR vejam imediatamente
    // IMPORTANTE: deve ser awaited antes de res.json() — em serverless o processo termina após enviar a resposta
    try {
      await garantirAbaComCabecalhos('FILA_APROVACAO', FILA_APROV_HEADERS).catch(()=>{});
      const filaId = await gerarProximoID('FILA_APROVACAO','FAP','ID_FILA');
      await appendObjeto('FILA_APROVACAO', {
        ID_FILA: filaId, ID_ENTIDADE: id, TIPO_ENTIDADE: 'SAC',
        DESCRICAO: `[Portal] ${tipoManifestacao} - ${nomeCliente} (${empresa})`,
        EMPRESA: empresaCanonica(empresa)||empresa, SETOR: setorRecebimento,
        COMPETENCIA: '', STATUS: 'PENDENTE',
        ID_APROVADOR: '', NOME_APROVADOR: '',
        DATA_ENVIO: agora, DATA_DECISAO: '', OBSERVACOES: '',
        CRIADO_POR: `portal:${colaboradorRecebimento}`, ID_REGRA: '',
      });
    } catch (filaErr) {
      console.warn('[PUBLIC] FILA_APROVACAO insert falhou:', filaErr.message);
    }

    const resposta = { sucesso: true, protocolo: id, dataHora: agora };
    if (pdfBase64) resposta.pdfBase64 = pdfBase64;
    res.json(resposta);
  } catch (e) {
    console.error('[PUBLIC] POST /api/public/reclamacoes:', e.message);
    res.status(500).json({ sucesso: false, erro: 'Não foi possível registrar. Tente novamente.' });
  }
});

// Empresas para o portal público (somente lista de nomes, sem dados internos)
app.get('/api/public/empresas', publicRateLimit, async (req, res) => {
  try {
    const data = await lerAba('EMPRESAS', 500).catch(() => []);
    const nomes = [...new Set(data.map(e => (e.NOME || e.EMPRESA || e.nome || '').trim()).filter(Boolean))].sort();
    res.json({ sucesso: true, empresas: nomes });
  } catch (e) {
    res.status(500).json({ sucesso: false, empresas: [] });
  }
});

// ===== BIBLIOTECA DE FICHAS =====
// Fonte unificada do Arquivo de Fichas: MANIFESTACOES (criadas no sistema), FICHAS_BIBLIOTECA
// (índice do portal + fichas importadas) e BANCO_HISTORICO (anteriores à ferramenta).
// Listagem, indicadores, árvore e detalhe leem do MESMO conjunto — antes, os indicadores liam campos
// inexistentes (TRATATIVA/ACAO_CORRETIVA em MANIFESTACOES; evidências fixas em false) e ficavam zerados.
const FICHAS_BIB_IMPORT_HEADERS = [
  'ID_FICHA','ID_MANIFESTACAO','PROTOCOLO','DATA_REGISTRO','ANO','MES','EMPRESA','SETOR_RECEBIMENTO',
  'COLABORADOR_RECEBIMENTO','NOME_CLIENTE','CNPJ','TIPO_MANIFESTACAO','MOTIVO','STATUS','ORIGEM','ARQUIVO_NOME',
  'PDF_DRIVE_ID','PDF_DRIVE_URL','PDF_NOME','TOTAL_EVIDENCIAS','VERSAO','CREATED_AT','DATA_CRIACAO','CRIADO_POR',
  'DATA_IMPORTACAO','IMPORTADO_POR',
];

function _bibData(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  let y, m, d;
  if (typeof raw === 'number') {
    const dt = new Date(Math.round((raw - 25569) * 86400000));
    if (isNaN(dt)) return null;
    y = dt.getUTCFullYear(); m = dt.getUTCMonth() + 1; d = dt.getUTCDate();
  } else {
    const s = String(raw).trim();
    let mt;
    if ((mt = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
    else if ((mt = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; if (y < 100) y += 2000; }
    else { const dt = new Date(s); if (isNaN(dt)) return null; y = dt.getFullYear(); m = dt.getMonth() + 1; d = dt.getDate(); }
  }
  if (!y || m < 1 || m > 12 || d < 1 || d > 31 || y < 1990 || y > 2100) return null;
  const mm = String(m).padStart(2, '0'), dd = String(d).padStart(2, '0');
  return { ano: String(y), mes: mm, dia: dd, iso: `${y}-${mm}-${dd}` };
}

function _bibStatus(raw) {
  const s = normalizarTexto(raw);
  if (/conclu|finaliz|encerr|resolv|importad/.test(s)) return 'CONCLUIDA';
  if (/tratativa|analise|andamento|setor|aprova|devolutiva|aguard|decisao|encaminh|andamento/.test(s)) return 'EM_ANDAMENTO';
  return 'ABERTA';
}
// Mapeia STATUS_FICHA para categoria do arquivo de fichas
function _bibCategoria(statusFicha, statusRaw) {
  const sf = normalizarTexto(statusFicha || '');
  if (/conclu|finaliz|encerr|resolv|fechad|aguardando devolutiva/.test(sf)) return 'CONCLUIDA';
  if (/aberta/.test(sf) && !statusRaw) return 'ABERTA';
  if (sf) return 'EM_ANDAMENTO'; // qualquer status_ficha intermediário
  return _bibStatus(statusRaw);
}

function _bibEmpresa(raw) {
  const r = String(raw || '').trim();
  return normalizarEmpresa(r) || r || 'Não informada';
}

function _bibDigitos(v) { return String(v || '').replace(/\D/g, ''); }

async function carregarFichasBiblioteca(req) {
  const [mans, hist, fb, evs, anx] = await Promise.all([
    lerAba('MANIFESTACOES', 5000).catch(() => []),
    lerAba('BANCO_HISTORICO', 5000).catch(() => []),
    lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []),
    lerAba('EVIDENCIAS', 5000).catch(() => []),
    lerAba('ANEXOS', 5000).catch(() => []),
  ]);
  const evMap = {};
  evs.forEach(e => { const k = String(e.ID_MANIFESTACAO || '').trim(); if (k) evMap[k] = (evMap[k] || 0) + 1; });
  const anxMap = {};
  anx.forEach(a => {
    const t = normalizarTexto(a.TIPO_ENTIDADE), c = normalizarTexto(a.CATEGORIA);
    if (t === 'setor' || t === 'rnc') return;
    if (c && c !== 'evidencia') return;
    const k = String(a.ID_ENTIDADE || '').trim(); if (k) anxMap[k] = (anxMap[k] || 0) + 1;
  });
  const fbPorMan = {};
  fb.forEach(f => { if (f.ID_MANIFESTACAO) fbPorMan[String(f.ID_MANIFESTACAO).trim()] = f; });

  const out = [];
  const vistos = new Set();
  const nEv = (id, extra) => Math.max((evMap[id] || 0) + (anxMap[id] || 0), parseInt(extra || 0) || 0);

  // 1) Criadas no sistema (ou importadas via documento — ORIGEM=DOCUMENTO)
  mans.forEach(m => {
    if (isTeste(m)) return;
    const id = String(m.ID_MANIFESTACAO || '').trim(); if (!id) return;
    vistos.add(id);
    const idx = fbPorMan[id] || {};
    const dt = _bibData(m.DATA_REGISTRO || m.DATA_ABERTURA || idx.DATA_REGISTRO);
    const status = _bibStatus(m.STATUS);
    const stT = normalizarTexto(m.STATUS_TRATATIVA);
    const comTrat = ['concluida', 'concluido', 'aceita', 'editada'].includes(stT) || !!String(m.DATA_CONCLUSAO_TRATATIVA || '').trim() || status === 'CONCLUIDA';
    const doc = normalizarTexto(m.ORIGEM) === 'documento' || !!m.ARQUIVO_ORIGEM;
    out.push({
      ID_FICHA: idx.ID_FICHA || `FIC-${id}`, ID_MANIFESTACAO: id, PROTOCOLO: id,
      DATA_REGISTRO: dt ? dt.iso : '', ANO: dt ? dt.ano : 'S/A', MES: dt ? dt.mes : '00', DIA: dt ? dt.dia : '',
      EMPRESA: _bibEmpresa(m.EMPRESA_RECLAMADA || m.EMPRESA_RECLAMANTE || idx.EMPRESA),
      NOME_CLIENTE: m.NOME_CLIENTE || m.CLIENTE_NOME || m.CONTATO || idx.NOME_CLIENTE || '',
      CNPJ_CPF: m.CNPJ || m.CNPJ_CPF || m.CNPJ_CLIENTE || '',
      TIPO_MANIFESTACAO: m.TIPO_MANIFESTACAO || m.TIPO || idx.TIPO_MANIFESTACAO || 'Reclamação',
      MOTIVO: m.MOTIVO || idx.MOTIVO || '',
      COLABORADOR_RECEBIMENTO: m.COLABORADOR_RECEBIMENTO || m.REGISTRADO_POR || m.USUARIO_CRIACAO || '',
      ORIGEM: doc ? 'IMPORTADA' : 'SISTEMA', STATUS: doc ? 'CONCLUIDA' : _bibCategoria(m.STATUS_FICHA, m.STATUS), COM_TRATATIVA: doc ? true : comTrat,
      STATUS_FICHA: m.STATUS_FICHA || '',
      STATUS_RAW: m.STATUS || '',
      SETOR: m.SETOR_CONFIRMADO || m.SETOR_SUGERIDO || '',
      RESPONSAVEL: m.RESPONSAVEL || m.USUARIO_CRIACAO || m.COLABORADOR_RECEBIMENTO || '',
      DATA_CONCLUSAO: m.DATA_CONCLUSAO_MANIFESTACAO || m.DATA_CONCLUSAO_TRATATIVA || '',
      SLA_HORAS: m.SLA_HORAS || 72,
      DATA_ABERTURA_ISO: m.DATA_ABERTURA || m.DATA_REGISTRO || '',
      ARQUIVADO: String(m.ARQUIVADO || '').toUpperCase() === 'SIM' ? 'SIM' : '',
      ARQUIVADO_POR: m.ARQUIVADO_POR || '',
      ARQUIVADO_EM: m.ARQUIVADO_EM || '',
      MOTIVO_ARQUIVAMENTO: m.MOTIVO_ARQUIVAMENTO || '',
      TOTAL_EVIDENCIAS: nEv(id, idx.TOTAL_EVIDENCIAS),
      ARQUIVO_NOME: m.ARQUIVO_ORIGEM || '',
      PDF_DRIVE_URL: m.PDF_DRIVE_URL || idx.PDF_DRIVE_URL || '', PDF_NOME: m.PDF_NOME || idx.PDF_NOME || '',
      _DESC: m.DESCRICAO_ORIGINAL || m.DESCRICAO || m.DESCRICAO_RECLAMACAO || m.DESCRICAO_MANIFESTACAO || '',
      _TRAT: m.TRATATIVA_REALIZADA || '',
      _CONCLUSAO: m.DATA_CONCLUSAO_TRATATIVA || '',
    });
  });

  // 2) Fichas históricas importadas pelo Arquivo (sem manifestação associada)
  fb.forEach(f => {
    const mid = String(f.ID_MANIFESTACAO || '').trim();
    if (mid) return; // já coberta por MANIFESTACOES (ou manifestação removida)
    const pid = String(f.PROTOCOLO || f.ID_FICHA || '').trim();
    if (!pid || vistos.has('F:' + pid)) return;
    vistos.add('F:' + pid);
    const dt = _bibData(f.DATA_REGISTRO) || (f.ANO && f.MES ? { ano: String(f.ANO), mes: String(f.MES).padStart(2, '0'), dia: '', iso: '' } : null);
    out.push({
      ID_FICHA: f.ID_FICHA || pid, ID_MANIFESTACAO: '', PROTOCOLO: pid,
      DATA_REGISTRO: dt ? dt.iso : '', ANO: dt ? dt.ano : 'S/A', MES: dt ? dt.mes : '00', DIA: dt ? dt.dia : '',
      EMPRESA: _bibEmpresa(f.EMPRESA), NOME_CLIENTE: f.NOME_CLIENTE || '', CNPJ_CPF: f.CNPJ || '',
      TIPO_MANIFESTACAO: f.TIPO_MANIFESTACAO || 'Reclamação', MOTIVO: f.MOTIVO || '',
      COLABORADOR_RECEBIMENTO: f.COLABORADOR_RECEBIMENTO || '',
      ORIGEM: 'IMPORTADA', STATUS: 'CONCLUIDA', COM_TRATATIVA: true,
      STATUS_FICHA: 'CONCLUIDA', STATUS_RAW: 'CONCLUIDA',
      SETOR: f.SETOR_RECEBIMENTO || '', RESPONSAVEL: f.COLABORADOR_RECEBIMENTO || '',
      DATA_CONCLUSAO: f.DATA_REGISTRO || '', SLA_HORAS: 0, DATA_ABERTURA_ISO: f.DATA_REGISTRO || '',
      ARQUIVADO: String(f.ARQUIVADO || '').toUpperCase() === 'SIM' ? 'SIM' : '',
      ARQUIVADO_POR: f.ARQUIVADO_POR || '', ARQUIVADO_EM: f.ARQUIVADO_EM || '', MOTIVO_ARQUIVAMENTO: f.MOTIVO_ARQUIVAMENTO || '',
      TOTAL_EVIDENCIAS: nEv(String(f.ID_FICHA || '').trim(), f.TOTAL_EVIDENCIAS),
      ARQUIVO_NOME: f.ARQUIVO_NOME || '', PDF_DRIVE_URL: f.PDF_DRIVE_URL || '', PDF_NOME: f.PDF_NOME || f.ARQUIVO_NOME || '',
      IMPORTADO_POR: f.IMPORTADO_POR || f.CRIADO_POR || '', IMPORTADO_EM: f.DATA_IMPORTACAO || f.DATA_CRIACAO || f.CREATED_AT || '',
      _DESC: '', _TRAT: '', _CONCLUSAO: '',
    });
  });

  // 3) Históricas (BANCO_HISTORICO)
  hist.forEach(h => {
    const id = String(h.ID_HISTORICO || h.ID || '').trim();
    if (!id || vistos.has(id)) return;
    vistos.add(id);
    const dt = _bibData(h.ORIG_DATA_ABERTURA || h.DATA_ABERTURA || h['Data de Registro']);
    const trat = String(h.COMP_TRATATIVA_ADOTADA || h.COMP_ACAO_CORRETIVA || h.TRATATIVA_REALIZADA || '').trim();
    const ev = h.ORIG_EVIDENCIA || h.EVIDENCIA_URL ? 1 : 0;
    out.push({
      ID_FICHA: id, ID_MANIFESTACAO: '', PROTOCOLO: id,
      DATA_REGISTRO: dt ? dt.iso : '', ANO: dt ? dt.ano : 'S/A', MES: dt ? dt.mes : '00', DIA: dt ? dt.dia : '',
      EMPRESA: _bibEmpresa(h.ORIG_EMPRESA), NOME_CLIENTE: h.ORIG_CONTATO || '', CNPJ_CPF: h.ORIG_CNPJ || h.CNPJ || '',
      TIPO_MANIFESTACAO: h.TIPO_MANIFESTACAO || 'Reclamação',
      MOTIVO: h.COMP_TIPO_PROBLEMA_VALIDADO || String(h.ORIG_DESCRICAO_RECLAMACAO || '').slice(0, 80),
      COLABORADOR_RECEBIMENTO: h.ORIG_ATENDENTE || '',
      ORIGEM: 'IMPORTADA', STATUS: 'CONCLUIDA', COM_TRATATIVA: true,
      TOTAL_EVIDENCIAS: Math.max(ev, nEv(id)),
      ARQUIVO_NOME: '', PDF_DRIVE_URL: '', PDF_NOME: '',
      _DESC: h.ORIG_DESCRICAO_RECLAMACAO || '', _TRAT: trat, _CONCLUSAO: '',
    });
  });

  // Escopo por empresa do usuário (não-MASTER)
  const escopo = filtrarPorEmpresaConfig(out, req, 'EMPRESA');

  // Reincidência: mesmo CNPJ (ou, sem CNPJ, mesmo nome de cliente) com 2+ reclamações em janela de 12 meses
  const chave = f => { const d = _bibDigitos(f.CNPJ_CPF); return d.length >= 8 ? 'c:' + d : (f.NOME_CLIENTE ? 'n:' + normalizarTexto(f.NOME_CLIENTE) : ''); };
  const mIdx = f => (f.ANO === 'S/A' ? null : parseInt(f.ANO) * 12 + parseInt(f.MES));
  const grupos = {};
  escopo.forEach(f => {
    f._K = chave(f); f._I = mIdx(f);
    if (f._K && f._I !== null && normalizarTexto(f.TIPO_MANIFESTACAO).startsWith('reclama')) (grupos[f._K] = grupos[f._K] || []).push(f);
  });
  escopo.forEach(f => {
    f.REINCIDENTE = false; f.REINCIDENTE_N = 0; f.REINCIDENTE_IDS = [];
    if (!f._K || f._I === null || !normalizarTexto(f.TIPO_MANIFESTACAO).startsWith('reclama')) return;
    const par = (grupos[f._K] || []).filter(x => Math.abs(x._I - f._I) <= 11);
    if (par.length >= 2) { f.REINCIDENTE = true; f.REINCIDENTE_N = par.length; f.REINCIDENTE_IDS = par.map(x => x.PROTOCOLO); }
  });
  return escopo;
}

function _bibFiltrar(fichas, qs, { ignorar = [] } = {}) {
  const { ano, mes, empresa, tipo, origem, status, q, extra,
          setor, responsavel, sla_status, arquivado,
          data_abertura_ini, data_abertura_fim, data_conclusao_ini, data_conclusao_fim } = qs;
  let r = fichas;
  const ig = k => ignorar.includes(k);
  const n = v => normalizarTexto(v || '');

  if (ano && !ig('ano')) r = r.filter(f => f.ANO === String(ano));
  if (mes && !ig('mes')) r = r.filter(f => f.MES === String(mes).padStart(2, '0'));
  if (empresa && !ig('empresa')) r = r.filter(f => n(f.EMPRESA).includes(n(empresa)));
  if (tipo && !ig('tipo')) r = r.filter(f => n(f.TIPO_MANIFESTACAO).includes(n(tipo)));
  if (origem && !ig('origem')) r = r.filter(f => f.ORIGEM === String(origem).toUpperCase());

  // status com suporte a EM_ANDAMENTO (alias de EM_TRATATIVA legado)
  if (status && !ig('status')) {
    const sv = String(status).toUpperCase();
    r = r.filter(f => f.STATUS === sv || (sv === 'EM_ANDAMENTO' && f.STATUS === 'EM_TRATATIVA') || (sv === 'EM_TRATATIVA' && f.STATUS === 'EM_ANDAMENTO'));
  }

  // arquivado: 'SIM' = só arquivadas, 'NAO' ou '' = só ativas (padrão)
  if (!ig('arquivado')) {
    const arq = String(arquivado || '').toUpperCase();
    if (arq === 'SIM') r = r.filter(f => f.ARQUIVADO === 'SIM');
    else r = r.filter(f => f.ARQUIVADO !== 'SIM');
  }

  if (setor && !ig('setor')) r = r.filter(f => n(f.SETOR).includes(n(setor)));
  if (responsavel && !ig('responsavel')) r = r.filter(f => n(f.RESPONSAVEL).includes(n(responsavel)));

  // SLA: 'VENCIDO' ou 'OK'
  if (sla_status && !ig('sla_status')) {
    const agora = Date.now();
    r = r.filter(f => {
      if (!f.DATA_ABERTURA_ISO || !f.SLA_HORAS || f.STATUS === 'CONCLUIDA') return sla_status !== 'VENCIDO';
      const prazo = new Date(f.DATA_ABERTURA_ISO).getTime() + Number(f.SLA_HORAS) * 3600000;
      return sla_status === 'VENCIDO' ? prazo < agora : prazo >= agora;
    });
  }

  // Filtros de período de abertura
  if (data_abertura_ini && !ig('data_abertura_ini')) r = r.filter(f => (f.DATA_ABERTURA_ISO || '') >= data_abertura_ini);
  if (data_abertura_fim && !ig('data_abertura_fim')) r = r.filter(f => (f.DATA_ABERTURA_ISO || '') <= data_abertura_fim + 'T23:59:59');

  // Filtros de período de conclusão
  if (data_conclusao_ini && !ig('data_conclusao_ini')) r = r.filter(f => (f.DATA_CONCLUSAO || '') >= data_conclusao_ini);
  if (data_conclusao_fim && !ig('data_conclusao_fim')) r = r.filter(f => (f.DATA_CONCLUSAO || '') <= data_conclusao_fim + 'T23:59:59');

  if (q && !ig('q')) {
    const nq = n(q), dq = _bibDigitos(q);
    r = r.filter(f =>
      n([f.PROTOCOLO, f.NOME_CLIENTE, f.CNPJ_CPF, f.MOTIVO, f.COLABORADOR_RECEBIMENTO, f.EMPRESA, f.SETOR, f.RESPONSAVEL].join(' ')).includes(nq) ||
      (dq.length >= 4 && _bibDigitos(f.CNPJ_CPF).includes(dq)));
  }
  if (extra === 'evidencia' && !ig('extra')) r = r.filter(f => f.TOTAL_EVIDENCIAS > 0);
  if (extra === 'tratativa' && !ig('extra')) r = r.filter(f => f.COM_TRATATIVA);
  if (extra === 'reincidente' && !ig('extra')) r = r.filter(f => f.REINCIDENTE);
  if (extra === 'sla_vencido' && !ig('extra')) {
    const agora = Date.now();
    r = r.filter(f => {
      if (!f.DATA_ABERTURA_ISO || !f.SLA_HORAS || f.STATUS === 'CONCLUIDA') return false;
      return new Date(f.DATA_ABERTURA_ISO).getTime() + Number(f.SLA_HORAS) * 3600000 < agora;
    });
  }
  return r;
}

// Listar fichas com filtros e paginação
app.get('/api/biblioteca/fichas', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','APROVADOR','SETOR RESPONSÁVEL','ESPECIALISTA','RCA / REPRESENTANTE','DIRETOR','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    const { page = '1', limit = '50' } = req.query;
    const qs = { ...req.query };
    // compat com parâmetros antigos
    if (!qs.extra) qs.extra = req.query.com_evidencia ? 'evidencia' : req.query.com_tratativa ? 'tratativa' : req.query.reincidente ? 'reincidente' : '';
    const todas = await carregarFichasBiblioteca(req);
    const filtered = _bibFiltrar(todas, qs);
    filtered.sort((a, b) => (b.DATA_REGISTRO || '').localeCompare(a.DATA_REGISTRO || '') || String(b.PROTOCOLO).localeCompare(String(a.PROTOCOLO)));
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const total = filtered.length;
    const items = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    const safe = items.map(({ _DESC, _TRAT, _CONCLUSAO, _K, _I, PDF_DRIVE_ID, ...rest }) => rest);
    res.json({ sucesso: true, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), fichas: safe });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Indicadores, por empresa, evolução por mês e árvore (respeitam os filtros ativos)
app.get('/api/biblioteca/stats', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','APROVADOR','SETOR RESPONSÁVEL','ESPECIALISTA','RCA / REPRESENTANTE','DIRETOR','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    const qs = { ...req.query };
    const todas = await carregarFichasBiblioteca(req);
    const agora = new Date();
    const anoAtual = String(agora.getFullYear()), mesAtual = String(agora.getMonth() + 1).padStart(2, '0');

    // Base dos KPIs: todos os filtros, exceto o "extra" (clicar num card não zera os outros cards)
    const base = _bibFiltrar(todas, qs, { ignorar: ['extra'] });
    const distinct = l => new Set(l.map(f => (f._K || f.PROTOCOLO))).size;
    const reincL = base.filter(f => f.REINCIDENTE);

    // Por empresa: respeita os filtros menos empresa (para o card de cada empresa continuar visível)
    const baseEmp = _bibFiltrar(todas, qs, { ignorar: ['extra', 'empresa'] });
    const porEmpresaDetalhe = {};
    baseEmp.forEach(f => {
      const e = f.EMPRESA;
      const d = porEmpresaDetalhe[e] = porEmpresaDetalhe[e] || { total: 0, comTratativa: 0, comEvidencia: 0, historicas: 0, reincidentes: 0, _k: new Set() };
      d.total++;
      if (f.COM_TRATATIVA) d.comTratativa++;
      if (f.TOTAL_EVIDENCIAS > 0) d.comEvidencia++;
      if (f.ORIGEM === 'IMPORTADA') d.historicas++;
      if (f.REINCIDENTE) d._k.add(f._K || f.PROTOCOLO);
    });
    Object.values(porEmpresaDetalhe).forEach(d => { d.reincidentes = d._k.size; delete d._k; });

    // Evolução: últimos 12 meses (a partir do mês atual), ignorando ano/mês para manter o gráfico navegável
    const baseMes = _bibFiltrar(todas, qs, { ignorar: ['extra', 'ano', 'mes'] });
    const porMesMap = {};
    baseMes.forEach(f => {
      if (f.ANO === 'S/A') return;
      const key = `${f.ANO}-${f.MES}`;
      const m = porMesMap[key] = porMesMap[key] || { ano: f.ANO, mes: f.MES, fichas: 0, sistema: 0, historica: 0 };
      m.fichas++; if (f.ORIGEM === 'IMPORTADA') m.historica++; else m.sistema++;
    });
    const porMes = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
      const a = String(d.getFullYear()), m = String(d.getMonth() + 1).padStart(2, '0');
      porMes.push(porMesMap[`${a}-${m}`] || { ano: a, mes: m, fichas: 0, sistema: 0, historica: 0 });
    }

    // Árvore empresa > ano > mês (somente escopo do usuário)
    const arvore = {};
    todas.forEach(f => {
      const e = arvore[f.EMPRESA] = arvore[f.EMPRESA] || { total: 0, anos: {} };
      e.total++;
      const a = e.anos[f.ANO] = e.anos[f.ANO] || { total: 0, meses: {} };
      a.total++; a.meses[f.MES] = (a.meses[f.MES] || 0) + 1;
    });
    const porEmpresa = {}; Object.keys(arvore).forEach(e => { porEmpresa[e] = arvore[e].total; });
    const anos = [...new Set(todas.map(f => f.ANO).filter(a => a !== 'S/A'))].sort().reverse();
    const setores = [...new Set(todas.map(f => f.SETOR).filter(Boolean))].sort();

    // KPIs de status operacional (sobre fichas ativas = não arquivadas)
    const ativas = base.filter(f => f.ARQUIVADO !== 'SIM');
    const abertas = ativas.filter(f => f.STATUS === 'ABERTA').length;
    const emAndamento = ativas.filter(f => f.STATUS === 'EM_ANDAMENTO' || f.STATUS === 'EM_TRATATIVA').length;
    const concluidas = ativas.filter(f => f.STATUS === 'CONCLUIDA').length;
    const arquivadas = base.filter(f => f.ARQUIVADO === 'SIM').length;
    const agoraMs = agora.getTime();
    const slaVencido = ativas.filter(f => {
      if (!f.DATA_ABERTURA_ISO || !f.SLA_HORAS || f.STATUS === 'CONCLUIDA') return false;
      return new Date(f.DATA_ABERTURA_ISO).getTime() + Number(f.SLA_HORAS) * 3600000 < agoraMs;
    }).length;

    res.json({
      sucesso: true,
      totalFichas: base.length,
      totalAtivas: ativas.length,
      abertas, emAndamento, concluidas, arquivadas, slaVencido,
      fichasDoMes: base.filter(f => f.ANO === anoAtual && f.MES === mesAtual).length,
      fichasDoAno: base.filter(f => f.ANO === anoAtual).length,
      comEvidencias: base.filter(f => f.TOTAL_EVIDENCIAS > 0).length,
      comTratativa: base.filter(f => f.COM_TRATATIVA).length,
      reincidentes: distinct(reincL),
      reincidentesFichas: reincL.length,
      historicas: base.filter(f => f.ORIGEM === 'IMPORTADA').length,
      sistema: base.filter(f => f.ORIGEM === 'SISTEMA').length,
      porEmpresa, porEmpresaDetalhe, porMes, arvore, anos, setores,
    });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Detalhe de uma ficha (valida escopo de empresa por ID: fora do escopo => 403)
app.get('/api/biblioteca/fichas/:id', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','APROVADOR','SETOR RESPONSÁVEL','ESPECIALISTA','RCA / REPRESENTANTE','DIRETOR','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const todas = await carregarFichasBiblioteca(req);
    let ficha = todas.find(f => f.PROTOCOLO === id || f.ID_MANIFESTACAO === id || f.ID_FICHA === id);
    if (!ficha) {
      // existe mas fora do escopo do usuário?
      const total = await (async () => { const r0 = { ...req, _empresaScope: null }; return carregarFichasBiblioteca(r0); })();
      if (total.some(f => f.PROTOCOLO === id || f.ID_MANIFESTACAO === id || f.ID_FICHA === id)) return res.status(403).json({ sucesso: false, erro: 'Sem permissão para esta ficha.' });
      return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    }
    const [evs, anx] = await Promise.all([lerAba('EVIDENCIAS', 5000).catch(() => []), lerAba('ANEXOS', 5000).catch(() => [])]);
    const ids = new Set([ficha.ID_MANIFESTACAO, ficha.PROTOCOLO, ficha.ID_FICHA].filter(Boolean));
    const evidencias = [
      ...evs.filter(e => ids.has(String(e.ID_MANIFESTACAO || '').trim())).map(e => ({ NOME: e.NOME, TIPO_MIME: e.TIPO_MIME, TAMANHO: e.TAMANHO, DRIVE_URL: e.DRIVE_URL, DATA_UPLOAD: e.DATA_UPLOAD, USUARIO: ficha.COLABORADOR_RECEBIMENTO || '' })),
      ...anx.filter(a => ids.has(String(a.ID_ENTIDADE || '').trim()) && !['setor', 'rnc'].includes(normalizarTexto(a.TIPO_ENTIDADE)) && (!a.CATEGORIA || normalizarTexto(a.CATEGORIA) === 'evidencia'))
        .map(a => ({ NOME: a.NOME_ARQUIVO, TIPO_MIME: a.MIME_TYPE, TAMANHO: a.TAMANHO, DRIVE_URL: a.URL_ARQUIVO, DATA_UPLOAD: a.DATA_UPLOAD, USUARIO: a.USUARIO_UPLOAD || '' })),
    ];
    const historico = [];
    if (ficha.ORIGEM === 'IMPORTADA') {
      if (ficha.IMPORTADO_EM) historico.push({ em: ficha.IMPORTADO_EM, texto: `Ficha histórica importada${ficha.ARQUIVO_NOME ? ' (' + ficha.ARQUIVO_NOME + ')' : ''}${ficha.IMPORTADO_POR ? ' por ' + ficha.IMPORTADO_POR : ''}` });
      historico.push({ em: ficha.DATA_REGISTRO, texto: 'Data da reclamação original' });
    } else {
      historico.push({ em: ficha.DATA_REGISTRO, texto: `Manifestação registrada${ficha.COLABORADOR_RECEBIMENTO ? ' por ' + ficha.COLABORADOR_RECEBIMENTO : ''}` });
      if (ficha._CONCLUSAO) historico.push({ em: ficha._CONCLUSAO, texto: 'Tratativa concluída' });
    }
    registrarAuditoria(req.user.usuario, 'VISUALIZOU_FICHA_BIBLIOTECA', ficha.ID_MANIFESTACAO || ficha.PROTOCOLO, 'FICHAS_BIBLIOTECA', null, {}).catch(() => {});
    const { _DESC, _TRAT, _CONCLUSAO, _K, _I, ...pub } = ficha;
    res.json({ sucesso: true, ficha: { ...pub, DESCRICAO: _DESC, TRATATIVA: _TRAT }, evidencias, historico });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Anexar arquivo a uma ficha existente
app.post('/api/biblioteca/fichas/:id/evidencias', middlewareEscopoEmpresa(), requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC','GESTOR SAC','APROVADOR'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const todas = await carregarFichasBiblioteca(req);
    const ficha = todas.find(f => f.PROTOCOLO === id || f.ID_MANIFESTACAO === id || f.ID_FICHA === id);
    if (!ficha) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });

    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) return res.status(400).json({ sucesso: false, erro: 'Envie o arquivo via multipart/form-data.' });
    const Busboy = (() => { try { return require('busboy'); } catch { return null; } })();
    if (!Busboy) return res.status(503).json({ sucesso: false, erro: 'Módulo de upload não disponível.' });

    const MAX_MB = 20;
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
    let nomeArquivo = ''; let mimeType = ''; const chunks = []; let truncado = false;

    await new Promise((resolve, reject) => {
      bb.on('file', (name, stream, info) => {
        nomeArquivo = info.filename || 'arquivo'; mimeType = info.mimeType || 'application/octet-stream';
        stream.on('data', c => chunks.push(c));
        stream.on('limit', () => { truncado = true; });
        stream.on('error', reject);
      });
      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (truncado) return res.status(400).json({ sucesso: false, erro: `Arquivo acima de ${MAX_MB} MB.` });
    if (chunks.length === 0) return res.status(400).json({ sucesso: false, erro: 'Arquivo não recebido.' });
    const buffer = Buffer.concat(chunks);

    const up = await uploadArquivoDrive(nomeArquivo, mimeType, buffer);
    const driveUrl = up.webViewLink || up.webContentLink || '';
    const idEntidade = ficha.ID_MANIFESTACAO || ficha.PROTOCOLO || ficha.ID_FICHA;
    const agora = new Date().toISOString();
    await garantirAbaComCabecalhos('ANEXOS', ['NOME_ARQUIVO','MIME_TYPE','TAMANHO','URL_ARQUIVO','DATA_UPLOAD','USUARIO_UPLOAD','ID_ENTIDADE','TIPO_ENTIDADE','CATEGORIA']).catch(() => {});
    await appendLinha('ANEXOS', [nomeArquivo, mimeType, String(buffer.length), driveUrl, agora, req.user.usuario, idEntidade, 'ficha', 'evidencia']).catch(() => {});
    registrarAuditoria(req.user.usuario, 'ANEXOU_ARQUIVO_FICHA', idEntidade, 'FICHAS_BIBLIOTECA', null, { nome: nomeArquivo }).catch(() => {});
    res.json({ sucesso: true, evidencia: { NOME: nomeArquivo, TIPO_MIME: mimeType, TAMANHO: String(buffer.length), DRIVE_URL: driveUrl, DATA_UPLOAD: agora, USUARIO: req.user.usuario } });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Download direto do PDF de uma manifestação
app.get('/api/manifestacoes/:id/pdf', middlewareEscopoEmpresa(), requerPerfil('MASTER','ANALISTA SAC','GESTOR SAC','APROVADOR','SETOR RESPONSÁVEL','CONSULTA','AUDITOR','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    if (!gerarFichaPDF) return res.status(503).json({ sucesso: false, erro: 'Serviço de PDF não disponível.' });
    const mans = await lerAba('MANIFESTACOES', 5000).catch(() => []);
    const man = mans.find(m => m.ID_MANIFESTACAO === req.params.id);
    if (!man) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    if (filtrarPorEmpresaConfig([{ EMPRESA: man.EMPRESA_RECLAMADA || man.EMPRESA_RECLAMANTE || '' }], req, 'EMPRESA').length === 0) {
      return res.status(403).json({ sucesso: false, erro: 'Sem permissão para esta ficha.' });
    }
    const evs = await lerAba('EVIDENCIAS', 2000).catch(() => []);
    const evidencias = evs.filter(e => e.ID_MANIFESTACAO === man.ID_MANIFESTACAO);
    const dtReg = new Date(man.DATA_REGISTRO || man.DATA_ABERTURA || Date.now());
    const dataRegistroFmt = dtReg.toLocaleDateString('pt-BR') + ' ' + dtReg.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const dadosPDF = {
      protocolo: man.ID_MANIFESTACAO, dataRegistroFmt,
      setorRecebimento: man.SETOR_RECEBIMENTO || man.SETOR_REGISTRANTE || '',
      colaboradorRecebimento: man.COLABORADOR_RECEBIMENTO || man.REGISTRADO_POR || '',
      nomeCliente: man.NOME_CLIENTE || man.CLIENTE_NOME || man.CONTATO || '',
      empresa: man.EMPRESA_RECLAMADA || man.EMPRESA_RECLAMANTE || '',
      telefone: man.TELEFONE || '', email: man.EMAIL || '',
      canalRecebimento: man.CANAL || '', tipoManifestacao: man.TIPO || man.TIPO_MANIFESTACAO || 'Reclamação',
      motivoManifestacao: man.MOTIVO || '', descricaoOriginal: man.DESCRICAO_ORIGINAL || man.DESCRICAO || man.DESCRICAO_RECLAMACAO || '',
      produto: man.PRODUTO || '', lote: man.LOTE || '', quantidadeAfetada: man.QUANTIDADE || '',
      observacoes: man.OBSERVACOES || '', totalEvidencias: evidencias.length,
      procedente: man.PROCEDENTE || '', procedenteJustificativa: man.PROCEDENTE_JUSTIFICATIVA || '',
      statusFicha: man.STATUS_FICHA || '', caminhoTratativa: man.CAMINHO_TRATATIVA || '',
      dataEncaminhamento: man.DATA_ENCAMINHAMENTO || '', prazoRetornoSAC: man.PRAZO_RETORNO_SAC || '',
      tratativaSACInterna: man.TRATATIVA_SAC_INTERNA || '',
      respSetorOQue: man.RESP_SETOR_O_QUE || '', respSetorCausa: man.RESP_SETOR_CAUSA || '',
      respSetorResolucao: man.RESP_SETOR_RESOLUCAO || '', respSetorAcaoPrev: man.RESP_SETOR_ACAO_PREV || '',
      respSetorResponsavel: man.RESP_SETOR_RESPONSAVEL || '', respSetorPrazo: man.RESP_SETOR_PRAZO || '',
      aprovDecisao: man.APROV_SETOR_DECISAO || '', aprovMotivo: man.APROV_SETOR_MOTIVO || '',
      aprovOrientacao: man.APROV_SETOR_ORIENTACAO || '',
      validDataRetorno: man.VALID_SAC_DATA_RETORNO || '', validClienteInformado: man.VALID_SAC_CLIENTE_INFORMADO || '',
      validResolvida: man.VALID_SAC_RESOLVIDA || '', observacoesFinais: man.OBSERVACOES_FINAIS || '',
    };
    const pdfBuffer = await gerarFichaPDF(dadosPDF);
    const pdfNome = `Ficha_${man.ID_MANIFESTACAO}.pdf`;
    registrarAuditoria(req.user?.usuario, 'BAIXOU_PDF_FICHA', man.ID_MANIFESTACAO, 'MANIFESTACOES', null, {}).catch(() => {});
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${pdfNome}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    res.send(pdfBuffer);
  } catch(e) { console.error('[PDF-DOWNLOAD] erro:', e.message, e.stack); res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Regenerar PDF de uma ficha (MASTER/ADMINISTRADOR/SAC)
app.post('/api/biblioteca/fichas/:id/regenerar-pdf', requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC'), async (req, res) => {
  try {
    if (!gerarFichaPDF) return res.status(503).json({ sucesso: false, erro: 'Serviço de PDF não disponível.' });
    const fichas = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    const ficha = fichas.find(f => f.ID_FICHA === req.params.id || f.ID_MANIFESTACAO === req.params.id || f.PROTOCOLO === req.params.id);
    if (!ficha) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    const mans = await lerAba('MANIFESTACOES', 5000).catch(() => []);
    const man = mans.find(m => m.ID_MANIFESTACAO === ficha.ID_MANIFESTACAO);
    if (!man) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    const evs = await lerAba('EVIDENCIAS', 2000).catch(() => []);
    const evidencias = evs.filter(e => e.ID_MANIFESTACAO === ficha.ID_MANIFESTACAO);
    const dtReg = new Date(man.DATA_REGISTRO || man.DATA_ABERTURA || Date.now());
    const dataRegistroFmt = dtReg.toLocaleDateString('pt-BR') + ' ' + dtReg.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const dadosPDF = {
      protocolo: man.ID_MANIFESTACAO, dataRegistroFmt,
      setorRecebimento: man.SETOR_RECEBIMENTO || man.SETOR_REGISTRANTE || '',
      colaboradorRecebimento: man.COLABORADOR_RECEBIMENTO || man.REGISTRADO_POR || '',
      nomeCliente: man.NOME_CLIENTE || man.CLIENTE_NOME || '',
      empresa: man.EMPRESA_RECLAMADA || man.EMPRESA_RECLAMANTE || '',
      telefone: man.TELEFONE || '', email: man.EMAIL || '',
      canalRecebimento: man.CANAL || '', tipoManifestacao: man.TIPO || man.TIPO_MANIFESTACAO || 'Reclamação',
      motivoManifestacao: man.MOTIVO || '', descricaoOriginal: man.DESCRICAO_ORIGINAL || man.DESCRICAO || '',
      produto: man.PRODUTO || '', lote: man.LOTE || '', quantidadeAfetada: man.QUANTIDADE || '',
      observacoes: man.OBSERVACOES || '', totalEvidencias: evidencias.length,
    };
    const pdfBuffer = await gerarFichaPDF(dadosPDF);
    const versaoAtual = parseInt(ficha.VERSAO || '1');
    const novaVersao = versaoAtual + 1;
    const pdfNome = `FICHA_${man.ID_MANIFESTACAO}_v${novaVersao}.pdf`;
    let pdfDriveId = ''; let pdfDriveUrl = '';
    try {
      const pdfDrive = await uploadArquivoDrive(pdfNome, 'application/pdf', pdfBuffer);
      pdfDriveId = pdfDrive.id || ''; pdfDriveUrl = pdfDrive.webViewLink || '';
    } catch(upErr) { console.warn('[BIBLIOTECA] PDF upload falhou:', upErr.message); }
    await atualizarPorID('FICHAS_BIBLIOTECA', ficha.ID_FICHA, { PDF_DRIVE_ID: pdfDriveId, PDF_DRIVE_URL: pdfDriveUrl, PDF_NOME: pdfNome, VERSAO: novaVersao.toString() }, ['ID_FICHA']).catch(() => {});
    registrarAuditoria(req.user.usuario, 'REGENEROU_PDF_BIBLIOTECA', ficha.ID_MANIFESTACAO, 'FICHAS_BIBLIOTECA', null, { versao: novaVersao }).catch(() => {});
    const pdfBase64 = pdfBuffer.toString('base64');
    res.json({ sucesso: true, pdfBase64, pdfNome, versao: novaVersao, pdfDriveUrl });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ═══ IMPORTAR FICHA HISTÓRICA (PDF/DOCX) ═══════════════════════════
// Cada arquivo vira uma ficha ORIGEM=IMPORTADA / STATUS=CONCLUIDA, protocolo HIST-AAAA-NNN, arquivada pela
// data da reclamação informada (não pela data da importação). O original é preservado no Drive sem alteração.
app.post('/api/biblioteca/importar-ficha', middlewareEscopoEmpresa(), requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC'), async (req, res) => {
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      return res.status(400).json({ sucesso: false, erro: 'Envie um arquivo via multipart/form-data.' });
    }
    const Busboy = (() => { try { return require('busboy'); } catch { return null; } })();
    if (!Busboy) return res.status(503).json({ sucesso: false, erro: 'Módulo de upload não disponível neste ambiente.' });

    const MAX_MB = 20;
    const bb = Busboy({ headers: req.headers, limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 } });
    let nomeArquivo = ''; let mimeType = ''; const chunks = []; let truncado = false;
    const campos = {};

    await new Promise((resolve, reject) => {
      bb.on('field', (name, val) => { campos[name] = String(val || '').trim(); });
      bb.on('file', (name, stream, info) => {
        nomeArquivo = info.filename; mimeType = info.mimeType;
        stream.on('data', c => chunks.push(c));
        stream.on('limit', () => { truncado = true; });
        stream.on('error', reject);
      });
      bb.on('finish', resolve);
      bb.on('error', reject);
      req.pipe(bb);
    });

    if (truncado) return res.status(400).json({ sucesso: false, erro: `Arquivo acima de ${MAX_MB} MB.` });
    if (chunks.length === 0) return res.status(400).json({ sucesso: false, erro: 'Arquivo não recebido.' });
    if (!/\.(pdf|docx)$/i.test(nomeArquivo || '')) return res.status(400).json({ sucesso: false, erro: 'Somente arquivos PDF ou DOCX.' });
    const buffer = Buffer.concat(chunks);

    // Campos obrigatórios informados/conferidos pelo usuário
    const empresa = campos.empresa ? _bibEmpresa(campos.empresa) : '';
    if (!empresa || empresa === 'Não informada') return res.status(400).json({ sucesso: false, erro: 'Informe a empresa.' });
    const dt = _bibData(campos.data_reclamacao);
    if (!dt) return res.status(400).json({ sucesso: false, erro: 'Informe a data da reclamação.' });
    if (dt.iso > new Date().toISOString().slice(0, 10)) return res.status(400).json({ sucesso: false, erro: 'A data da reclamação não pode ser futura.' });
    if (req._empresaScope && empresaCanonica(req._empresaScope) !== empresaCanonica(empresa)) {
      return res.status(403).json({ sucesso: false, erro: 'Sem permissão para importar fichas desta empresa.' });
    }
    const tiposOk = ['Reclamação', 'Sugestão', 'Solicitação', 'Elogio'];
    const tipo = tiposOk.includes(campos.tipo) ? campos.tipo : 'Reclamação';

    // Extração opcional por IA (cliente/CNPJ/motivo); empresa, data e tipo vêm sempre do usuário
    let textoExtraido = '';
    if (/\.pdf$/i.test(nomeArquivo)) {
      textoExtraido = buffer.toString('latin1').replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').substring(0, 4000);
    } else {
      textoExtraido = buffer.toString('utf8', 0, 8000).replace(/[^\x20-\x7E\n\r\tÀ-ɏ]/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').substring(0, 4000);
    }
    let dadosExtraidos = {};
    try {
      if (aiService.isDisponivel()) {
        const resultado = await aiService.chamar(
          `Extraia dados desta ficha de reclamação e retorne APENAS JSON válido com os campos: nome_cliente, cnpj, motivo, colaborador. Se não encontrar um campo, use null. Texto da ficha:\n\n${textoExtraido}`,
          { maxTokens: 512, contexto: 'importar-ficha' }
        );
        if (resultado.disponivel) dadosExtraidos = aiService.extrairJSON(resultado.texto) || {};
      }
    } catch (aiErr) { console.warn('[BIBLIOTECA] extração IA falhou:', aiErr.message); }

    // Preserva o original, sem alteração
    let driveId = '', driveUrl = '';
    try {
      const up = await uploadArquivoDrive(nomeArquivo, mimeType || (/\.pdf$/i.test(nomeArquivo) ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), buffer);
      driveId = up.id || ''; driveUrl = up.webViewLink || up.webContentLink || '';
    } catch (upErr) {
      console.warn('[BIBLIOTECA] upload do original falhou (Drive indisponível), importando sem link:', upErr.message);
    }

    // Protocolo HIST-AAAA-NNN
    await garantirAbaComCabecalhos('FICHAS_BIBLIOTECA', FICHAS_BIB_IMPORT_HEADERS);
    const existentes = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    const prefixo = `HIST-${dt.ano}-`;
    let seq = 0;
    existentes.forEach(f => { const p = String(f.PROTOCOLO || ''); if (p.startsWith(prefixo)) seq = Math.max(seq, parseInt(p.slice(prefixo.length)) || 0); });
    const protocolo = prefixo + String(seq + 1).padStart(3, '0');

    const idFicha = 'FH-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 4).toUpperCase();
    const agora = new Date().toISOString();
    const usuario = req.user.usuario || '';
    const obj = {
      ID_FICHA: idFicha, ID_MANIFESTACAO: '', PROTOCOLO: protocolo,
      DATA_REGISTRO: dt.iso, ANO: dt.ano, MES: dt.mes,
      EMPRESA: empresa, SETOR_RECEBIMENTO: '',
      COLABORADOR_RECEBIMENTO: dadosExtraidos.colaborador || '',
      NOME_CLIENTE: dadosExtraidos.nome_cliente || '', CNPJ: dadosExtraidos.cnpj || '',
      TIPO_MANIFESTACAO: tipo, MOTIVO: dadosExtraidos.motivo || '',
      STATUS: 'CONCLUIDA', ORIGEM: 'IMPORTADA', ARQUIVO_NOME: nomeArquivo,
      PDF_DRIVE_ID: driveId, PDF_DRIVE_URL: driveUrl, PDF_NOME: nomeArquivo,
      TOTAL_EVIDENCIAS: 0, VERSAO: '1', CREATED_AT: agora, DATA_CRIACAO: agora, CRIADO_POR: usuario,
      DATA_IMPORTACAO: agora, IMPORTADO_POR: usuario,
    };
    await appendObjeto('FICHAS_BIBLIOTECA', obj);
    registrarAuditoria(usuario, 'IMPORTOU_FICHA_HISTORICA', idFicha, 'FICHAS_BIBLIOTECA', null, { arquivo: nomeArquivo, protocolo, empresa, dataReclamacao: dt.iso }).catch(() => {});
    res.json({ sucesso: true, idFicha, protocolo, dados: dadosExtraidos });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== EDITAR FICHA HISTÓRICA =====
// Arquivar uma ficha
app.post('/api/biblioteca/fichas/:id/arquivar', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { motivo } = req.body || {};
    if (!motivo?.trim()) return res.status(400).json({ sucesso: false, erro: 'Motivo do arquivamento é obrigatório.' });
    const todas = await carregarFichasBiblioteca(req);
    const ficha = todas.find(f => f.PROTOCOLO === id || f.ID_MANIFESTACAO === id || f.ID_FICHA === id);
    if (!ficha) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    if (ficha.ARQUIVADO === 'SIM') return res.status(409).json({ sucesso: false, erro: 'Ficha já está arquivada.' });
    // Bloquear arquivamento de fichas abertas ou em andamento sem permissão de MASTER/APROVADOR MASTER
    const perfil = perfilCanonico(req.user?.perfil || '');
    if (['ABERTA','EM_ANDAMENTO','EM_TRATATIVA'].includes(ficha.STATUS) && !['MASTER','APROVADOR MASTER'].includes(perfil)) {
      return res.status(403).json({ sucesso: false, erro: 'Fichas abertas ou em andamento só podem ser arquivadas por MASTER ou APROVADOR MASTER.' });
    }
    const agora = new Date().toISOString();
    const dados = { ARQUIVADO: 'SIM', ARQUIVADO_POR: req.user?.usuario || '', ARQUIVADO_EM: agora, MOTIVO_ARQUIVAMENTO: motivo.trim() };
    if (ficha.ID_MANIFESTACAO) {
      await garantirAbaComCabecalhos('MANIFESTACOES', ['ID_MANIFESTACAO','ARQUIVADO','ARQUIVADO_POR','ARQUIVADO_EM','MOTIVO_ARQUIVAMENTO']).catch(() => {});
      await atualizarPorID('MANIFESTACOES', ficha.ID_MANIFESTACAO, dados, ['ID_MANIFESTACAO']);
      invalidarCacheAba('MANIFESTACOES');
    } else if (ficha.ID_FICHA) {
      await garantirAbaComCabecalhos('FICHAS_BIBLIOTECA', ['ID_FICHA','ARQUIVADO','ARQUIVADO_POR','ARQUIVADO_EM','MOTIVO_ARQUIVAMENTO']).catch(() => {});
      await atualizarPorID('FICHAS_BIBLIOTECA', ficha.ID_FICHA, dados, ['ID_FICHA']);
      invalidarCacheAba('FICHAS_BIBLIOTECA');
    }
    await registrarAuditoria(req.user?.usuario || 'sistema', 'ARQUIVOU_FICHA', id, 'FICHAS_BIBLIOTECA', ficha.STATUS, { motivo: motivo.trim() });
    res.json({ sucesso: true, mensagem: 'Ficha arquivada com sucesso.', id, arquivadoEm: agora });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// Desarquivar uma ficha
app.post('/api/biblioteca/fichas/:id/desarquivar', middlewareEscopoEmpresa(), requerPerfil('MASTER','APROVADOR MASTER','GESTOR SAC','ANALISTA SAC'), async (req, res) => {
  try {
    const id = String(req.params.id || '').trim();
    const { motivo } = req.body || {};
    const todas = await carregarFichasBiblioteca(req);
    const ficha = todas.find(f => f.PROTOCOLO === id || f.ID_MANIFESTACAO === id || f.ID_FICHA === id);
    if (!ficha) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    if (ficha.ARQUIVADO !== 'SIM') return res.status(409).json({ sucesso: false, erro: 'Ficha não está arquivada.' });
    const agora = new Date().toISOString();
    const dados = { ARQUIVADO: '', ARQUIVADO_POR: '', ARQUIVADO_EM: '', MOTIVO_ARQUIVAMENTO: '' };
    if (ficha.ID_MANIFESTACAO) {
      await atualizarPorID('MANIFESTACOES', ficha.ID_MANIFESTACAO, dados, ['ID_MANIFESTACAO']);
      invalidarCacheAba('MANIFESTACOES');
    } else if (ficha.ID_FICHA) {
      await atualizarPorID('FICHAS_BIBLIOTECA', ficha.ID_FICHA, dados, ['ID_FICHA']);
      invalidarCacheAba('FICHAS_BIBLIOTECA');
    }
    await registrarAuditoria(req.user?.usuario || 'sistema', 'DESARQUIVOU_FICHA', id, 'FICHAS_BIBLIOTECA', 'ARQUIVADA', { motivo: motivo || '' });
    res.json({ sucesso: true, mensagem: 'Ficha desarquivada com sucesso.', id });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.patch('/api/biblioteca/fichas/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    const campos = ['EMPRESA','SETOR_RECEBIMENTO','COLABORADOR_RECEBIMENTO','NOME_CLIENTE','CNPJ',
                    'TIPO_MANIFESTACAO','MOTIVO','STATUS','DATA_REGISTRO','ANO','MES','ARQUIVO_NOME'];
    const dados = {};
    campos.forEach(c => { if (b[c] !== undefined) dados[c] = b[c]; });
    if (!Object.keys(dados).length) return res.status(400).json({ sucesso: false, erro: 'Nenhum campo para atualizar.' });
    await garantirAbaComCabecalhos('FICHAS_BIBLIOTECA', FICHAS_BIB_IMPORT_HEADERS);
    const r = await atualizarPorID('FICHAS_BIBLIOTECA', id, dados, ['ID_FICHA']);
    if (!r) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    await registrarAuditoria(req.user.usuario, 'EDITOU_FICHA_HISTORICA', id, 'FICHAS_BIBLIOTECA', null, dados);
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== SINCRONIZAR BASE DE CONHECIMENTO A PARTIR DAS FICHAS =====
app.post('/api/biblioteca/sincronizar-base', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const fichas = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    if (!fichas.length) return res.json({ sucesso: true, setores: 0, matriz: 0, cerebro: 0, msg: 'Nenhuma ficha encontrada.' });

    // --- 1. SETORES: extrai setores únicos das fichas ---
    await garantirAbaComCabecalhos('CONFIG_SETORES', ['ID_SETOR','SETOR','EMPRESA','DESCRICAO','RESPONSAVEL','SLA_HORAS','ATIVO']);
    const setoresExistentes = await lerAba('CONFIG_SETORES', 2000).catch(() => []);
    const setoresNormSet = new Set(setoresExistentes.map(s => normalizarTexto(s.SETOR || '')));
    let setoresCriados = 0;
    const setoresNovos = new Set();
    for (const f of fichas) {
      const s = (f.SETOR_RECEBIMENTO || '').trim();
      if (!s || s.length < 2) continue;
      const n = normalizarTexto(s);
      if (!setoresNormSet.has(n) && !setoresNovos.has(n)) {
        setoresNovos.add(n);
        const id = await gerarProximoID('CONFIG_SETORES', 'SET', 'ID_SETOR');
        await appendObjeto('CONFIG_SETORES', { ID_SETOR: id, SETOR: s, EMPRESA: '', DESCRICAO: '', RESPONSAVEL: '', SLA_HORAS: '72', ATIVO: 'SIM' });
        setoresCriados++;
      }
    }

    // --- 2. MATRIZ DE TRATAMENTO: tipo+motivo únicos ---
    await garantirAbaComCabecalhos('MATRIZ_TRATAMENTO', ['ID_REGRA','TIPO_MANIFESTACAO','EMPRESA','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL','SLA_HORAS','PRIORIDADE','TRATATIVA_PADRAO','DEVOLUTIVA_PADRAO','REQUER_APROVACAO','ATIVO','DATA_CRIACAO','CRIADO_POR']);
    const matrizExistente = await lerAba('MATRIZ_TRATAMENTO', 5000).catch(() => []);
    const matrizNormSet = new Set(matrizExistente.map(m => normalizarTexto((m.TIPO_MANIFESTACAO||'')+'|'+(m.CAUSA||''))));
    let matrizCriados = 0;
    const matrizNovos = new Set();
    for (const f of fichas) {
      const tipo = (f.TIPO_MANIFESTACAO || 'Reclamação').trim();
      const causa = (f.MOTIVO || '').trim();
      if (!causa || causa.length < 3) continue;
      const chave = normalizarTexto(tipo + '|' + causa);
      if (!matrizNormSet.has(chave) && !matrizNovos.has(chave)) {
        matrizNovos.add(chave);
        const id = await gerarProximoID('MATRIZ_TRATAMENTO', 'MTR', 'ID_REGRA');
        await appendObjeto('MATRIZ_TRATAMENTO', {
          ID_REGRA: id, TIPO_MANIFESTACAO: tipo, EMPRESA: f.EMPRESA || '',
          CAUSA: causa, SUBCAUSA: '', SETOR_RESPONSAVEL: f.SETOR_RECEBIMENTO || '',
          SLA_HORAS: '72', PRIORIDADE: 'NORMAL', TRATATIVA_PADRAO: '',
          DEVOLUTIVA_PADRAO: '', REQUER_APROVACAO: 'NAO', ATIVO: 'SIM',
          DATA_CRIACAO: new Date().toISOString(), CRIADO_POR: req.user.usuario
        });
        matrizCriados++;
      }
    }

    // --- 3. CÉREBRO (MATRIZ_CONHECIMENTO): uma entrada por motivo único relevante ---
    await garantirAbaComCabecalhos('MATRIZ_CONHECIMENTO', ['ID','NOME','DESCRICAO','TIPO','CATEGORIA','CONTEUDO','STATUS','VERSAO','CRIADO_POR','CRIADO_EM','ATUALIZADO_EM']);
    const cerebroExistente = await lerAba('MATRIZ_CONHECIMENTO', 5000).catch(() => []);
    const cerebroNormSet = new Set(cerebroExistente.map(c => normalizarTexto(c.NOME || '')));
    let cerebroCriados = 0;
    const cerebroNovos = new Set();
    for (const f of fichas) {
      const motivo = (f.MOTIVO || '').trim();
      if (!motivo || motivo.length < 5) continue;
      const nome = `Tratativa: ${motivo}`;
      const n = normalizarTexto(nome);
      if (!cerebroNormSet.has(n) && !cerebroNovos.has(n)) {
        cerebroNovos.add(n);
        const id = 'MC-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2,4).toUpperCase();
        const agora = new Date().toISOString();
        await appendObjeto('MATRIZ_CONHECIMENTO', {
          ID: id, NOME: nome,
          DESCRICAO: `Extraído automaticamente das fichas históricas. Motivo: ${motivo}. Tipo: ${f.TIPO_MANIFESTACAO || 'Reclamação'}. Empresa: ${f.EMPRESA || ''}.`,
          TIPO: 'PROCEDIMENTO', CATEGORIA: f.TIPO_MANIFESTACAO || 'Reclamação',
          CONTEUDO: `Motivo registrado nas fichas: ${motivo}. Preencha com a tratativa padrão para este tipo de ocorrência.`,
          STATUS: 'rascunho', VERSAO: '1', CRIADO_POR: req.user.usuario, CRIADO_EM: agora, ATUALIZADO_EM: agora
        });
        cerebroCriados++;
      }
    }

    await registrarAuditoria(req.user.usuario, 'SINCRONIZOU_BASE_CONHECIMENTO', null, 'FICHAS_BIBLIOTECA', null,
      { fichas: fichas.length, setores: setoresCriados, matriz: matrizCriados, cerebro: cerebroCriados });

    res.json({ sucesso: true, fichas: fichas.length, setores: setoresCriados, matriz: matrizCriados, cerebro: cerebroCriados });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== MATRIZ DE CONHECIMENTO =====

const MC_PERFIS_EDITOR = new Set(['MASTER','ADMINISTRADOR','ANALISTA SAC','GESTOR SAC']);
const MC_PERFIS_APROVADOR = new Set(['MASTER','ADMINISTRADOR']);
const MC_PERFIS_PUBLICADOR = new Set(['MASTER','ADMINISTRADOR']);

function podeMC(perfil, acao) {
  const p = (perfil || '').toUpperCase();
  if (acao === 'visualizar') return true;
  if (acao === 'criar' || acao === 'editar') return MC_PERFIS_EDITOR.has(p);
  if (acao === 'aprovar') return MC_PERFIS_APROVADOR.has(p);
  if (acao === 'publicar' || acao === 'arquivar') return MC_PERFIS_PUBLICADOR.has(p);
  if (acao === 'historico') return MC_PERFIS_EDITOR.has(p);
  return false;
}

// Helper: retorna empresa de escopo para MC (MASTER = null = acesso global)
function _mcEmpresaScope(user) {
  const p = perfilCanonico(user?.perfil || '');
  return p === 'MASTER' ? null : (user?.empresa || null);
}

// Listar matrizes
app.get('/api/matriz-conhecimento', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'visualizar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    const empresaScope = _mcEmpresaScope(req.user);
    const filtros = {
      empresa: empresaScope || req.query.empresa,
      setor: req.query.setor, tipo: req.query.tipo,
      categoria: req.query.categoria, subcategoria: req.query.subcategoria,
      status: req.query.status, q: req.query.q,
    };
    const page = Math.max(1, parseInt(req.query.page || '1'));
    const perPage = Math.min(50, parseInt(req.query.perPage || '20'));
    const lista = await mcService.listarMatrizes(filtros);
    const total = lista.length;
    const itens = lista.slice((page - 1) * perPage, page * perPage);
    res.json({ sucesso: true, itens, total, page, perPage, totalPages: Math.ceil(total / perPage) });
  } catch (e) { console.error(e); res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-listar') }); }
});

// Obter matriz por ID
app.get('/api/matriz-conhecimento/:id', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'visualizar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    const matriz = await mcService.obterMatriz(req.params.id);
    if (!matriz) return res.status(404).json({ sucesso: false, erro: 'Matriz não encontrada.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, matriz.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta matriz.' });
    }
    const [itens, evidencias, excecoes] = await Promise.all([
      mcService.listarItens(matriz.ID),
      mcService.listarEvidencias(matriz.ID),
      mcService.listarExcecoes(matriz.ID),
    ]);
    res.json({ sucesso: true, matriz, itens, evidencias, excecoes });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-obter') }); }
});

// Criar matriz
app.post('/api/matriz-conhecimento', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'criar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!req.body?.nome) return res.status(400).json({ sucesso: false, erro: 'Campo "nome" obrigatório.' });
    const empresaScope = _mcEmpresaScope(req.user);
    const body = empresaScope ? { ...req.body, empresa: empresaScope } : req.body;
    const obj = await mcService.criarMatriz(body, req.user.usuario);
    await registrarAuditoria(req.user.usuario, 'CRIAR_MATRIZ_CONHECIMENTO', null, 'MATRIZ_CONHECIMENTO', null, { id: obj.ID, nome: obj.NOME });
    res.json({ sucesso: true, id: obj.ID, codigo: obj.CODIGO });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-criar') }); }
});

// Atualizar matriz
app.put('/api/matriz-conhecimento/:id', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    const matriz = await mcService.obterMatriz(req.params.id);
    if (!matriz) return res.status(404).json({ sucesso: false, erro: 'Matriz não encontrada.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, matriz.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta matriz.' });
    }
    await mcService.atualizarMatriz(req.params.id, req.body, req.user.usuario);
    await registrarAuditoria(req.user.usuario, 'EDITAR_MATRIZ_CONHECIMENTO', null, 'MATRIZ_CONHECIMENTO', null, { id: req.params.id });
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-atualizar') }); }
});

// Mudar status (aprovar, publicar, arquivar, suspender)
app.post('/api/matriz-conhecimento/:id/status', async (req, res) => {
  try {
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ sucesso: false, erro: 'status obrigatório.' });
    const acao = status === 'APROVADA' ? 'aprovar' : status === 'PUBLICADA' ? 'publicar' : 'arquivar';
    if (!podeMC(req.user?.perfil, acao)) return res.status(403).json({ sucesso: false, erro: 'Sem permissão para esta ação.' });
    const matriz = await mcService.obterMatriz(req.params.id);
    if (!matriz) return res.status(404).json({ sucesso: false, erro: 'Matriz não encontrada.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, matriz.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta matriz.' });
    }
    await mcService.mudarStatusMatriz(req.params.id, status, req.user.usuario);
    await registrarAuditoria(req.user.usuario, `MATRIZ_CONHECIMENTO_${status}`, null, 'MATRIZ_CONHECIMENTO', null, { id: req.params.id, status });
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-status') }); }
});

async function _mcVerificarEmpresa(req, res, matrizId) {
  const empresaScope = _mcEmpresaScope(req.user);
  if (!empresaScope) return true;
  const matriz = await mcService.obterMatriz(matrizId);
  if (!matriz) { res.status(404).json({ sucesso: false, erro: 'Matriz não encontrada.' }); return false; }
  if (!pertenceEmpresa(empresaScope, matriz.EMPRESA || '')) {
    res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta matriz.' });
    return false;
  }
  return true;
}

// ITENS — adicionar
app.post('/api/matriz-conhecimento/:id/itens', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    const item = await mcService.adicionarItem(req.params.id, req.body, req.user.usuario);
    res.json({ sucesso: true, id: item.ID });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-item-add') }); }
});

// ITENS — remover
app.delete('/api/matriz-conhecimento/:id/itens/:itemId', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    await mcService.removerItem(req.params.itemId, req.user.usuario);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-item-del') }); }
});

// EVIDÊNCIAS — adicionar
app.post('/api/matriz-conhecimento/:id/evidencias', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    const ev = await mcService.adicionarEvidencia(req.params.id, req.body);
    res.json({ sucesso: true, id: ev.ID });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-ev-add') }); }
});

// EVIDÊNCIAS — remover
app.delete('/api/matriz-conhecimento/:id/evidencias/:evId', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    await mcService.removerEvidencia(req.params.evId);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-ev-del') }); }
});

// EXCEÇÕES — adicionar
app.post('/api/matriz-conhecimento/:id/excecoes', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    const ex = await mcService.adicionarExcecao(req.params.id, req.body);
    res.json({ sucesso: true, id: ex.ID });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-ex-add') }); }
});

// EXCEÇÕES — remover
app.delete('/api/matriz-conhecimento/:id/excecoes/:exId', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'editar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    if (!await _mcVerificarEmpresa(req, res, req.params.id)) return;
    await atualizarPorID('MC_EXCECOES', req.params.exId, { ATIVO: 'NÃO' }, ['ID']);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'mc-ex-del') }); }
});

// RESOLVER — endpoint de teste/consulta
app.post('/api/matriz-conhecimento/resolver', async (req, res) => {
  try {
    if (!podeMC(req.user?.perfil, 'visualizar')) return res.status(403).json({ sucesso: false, erro: 'Sem permissão.' });
    const resultado = await mcService.resolverConhecimento(req.body || {});
    res.json({ sucesso: true, resultado });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ===== IA: EXTRAIR CAMPOS DO SETOR =====
app.post('/api/ia/extrair-setor', requerPerfil('MASTER','ANALISTA SAC','ADMINISTRADOR'), async (req, res) => {
  try {
    const { texto, setor } = req.body || {};
    if (!texto || texto.trim().length < 20) return res.status(400).json({ sucesso: false, erro: 'Texto muito curto.' });
    if (!aiService.isDisponivel()) return res.status(400).json({ sucesso: false, erro: 'Serviço de IA não configurado.' });
    const prompt = `Você é um assistente que extrai informações estruturadas sobre setores de SAC a partir de documentos.

Setor: ${setor || '(não informado)'}

Texto fornecido:
"""
${texto.slice(0, 8000)}
"""

Extraia as seguintes informações do texto acima e retorne SOMENTE um JSON válido com estas chaves (omita as que não encontrar no texto):
- DESCRICAO: descrição geral do setor (1-3 frases)
- RESPONSABILIDADES: o que este setor faz e analisa (texto livre)
- REGRAS_OPERACIONAIS: regras, políticas e critérios do setor (texto livre)
- PROCEDIMENTOS_ORIENTACOES: procedimentos e orientações operacionais (texto livre)
- ALERTAS: alertas, atenções e exceções importantes (texto livre)
- SLA_HORAS: prazo em horas (número inteiro, somente se explícito)

Retorne apenas o JSON, sem markdown, sem explicação.`;
    const resultado = await aiService.chamar(prompt, { maxTokens: 1024, contexto: 'extrair-setor' });
    if (!resultado.disponivel) return res.status(503).json({ sucesso: false, erro: resultado.erro || 'IA indisponível' });
    const campos = aiService.extrairJSON(resultado.texto) || {};
    res.json({ sucesso: true, campos });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

// ╔══════════════════════════════════════════════════════════════════════════╗
// ║  SISTEMA DE PERMISSÕES — SOLICITAÇÕES, PERFIS, MÓDULOS, COMPETÊNCIAS    ║
// ╚══════════════════════════════════════════════════════════════════════════╝

const { NIVEIS, MODULOS_SISTEMA, PERFIS_VALIDOS, COMPETENCIAS_VALIDAS,
        normalizarPerfil, resolverNivelModulo, temCompetencia } = permissoesService;

// Cabeçalhos das novas abas
const SOLICITACOES_HEADERS = [
  'ID_SOLICITACAO','NOME','EMAIL','EMPRESA','SETOR','CARGO','TELEFONE','JUSTIFICATIVA',
  'STATUS','DATA_CRIACAO','DATA_DECISAO','DECIDIDO_POR','MOTIVO_REJEICAO',
];
const PERMISSOES_HEADERS = [
  'ID_PERMISSAO','USUARIO_ID','USUARIO_EMAIL','EMPRESA','PERFIL',
  'MODULO','NIVEL','COMPETENCIAS','STATUS',
  'CRIADO_EM','CRIADO_POR','ATUALIZADO_EM','ATUALIZADO_POR',
];
const AUDITORIA_ACESSO_HEADERS = [
  'ID_AUDITORIA','DATA_HORA','USUARIO_AFETADO','ACAO','MODULO','EMPRESA',
  'PERMISSAO_ANTERIOR','PERMISSAO_NOVA','EXECUTADO_POR',
];

// Garante estrutura das abas ao inicializar
async function garantirAbasPermissoes() {
  await Promise.all([
    garantirAbaComCabecalhos('SOLICITACOES_ACESSO', SOLICITACOES_HEADERS),
    garantirAbaComCabecalhos('PERMISSOES_USUARIO', PERMISSOES_HEADERS),
    garantirAbaComCabecalhos('AUDITORIA_ACESSO', AUDITORIA_ACESSO_HEADERS),
  ]).catch(e => console.warn('[PERM] Falha ao garantir abas de permissão:', e.message));
}
garantirAbasPermissoes();

// ── E-mail via Gmail API (mesma conta de serviço) ────────────────────────────
async function enviarEmailAcesso({ para, nome, login, senha, perfil, empresa }) {
  try {
    const gmailUser = process.env.GMAIL_REMETENTE || process.env.GMAIL_USER;
    if (!gmailUser) { console.warn('[EMAIL] GMAIL_REMETENTE não configurado — e-mail não enviado.'); return false; }
    const auth = await getAuth();
    const { google } = require('googleapis');
    const gmail = google.gmail({ version: 'v1', auth });
    const assunto = 'Acesso aprovado — Assistente SAC Grupo Chiacchio';
    const corpo = `Olá, ${nome}!\n\nSeu acesso ao Assistente SAC foi aprovado.\n\nDados de acesso:\n  Usuário: ${login}\n  Senha:   ${senha}\n  Perfil:  ${perfil}\n  Empresa: ${empresa}\n\nAcesse: ${process.env.APP_URL || 'https://assistente-sac-gpchiacchio.vercel.app'}\n\nPor segurança, altere sua senha no primeiro acesso.\n\nEquipe SAC — Grupo Chiacchio`;
    const raw = Buffer.from(
      `To: ${para}\r\nSubject: ${assunto}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${corpo}`
    ).toString('base64url');
    await gmail.users.messages.send({ userId: gmailUser, requestBody: { raw } });
    console.log(`[EMAIL] Enviado para ${para}`);
    return true;
  } catch(e) {
    console.warn('[EMAIL] Falha ao enviar e-mail:', e.message);
    return false;
  }
}

// ── Auditoria de acesso ───────────────────────────────────────────────────────
async function registrarAuditoriaAcesso(usuarioAfetado, acao, modulo, empresa, anterior, novo, executadoPor) {
  try {
    const id = `AUD-${Date.now().toString(36).toUpperCase()}`;
    const linha = [
      id, new Date().toISOString(), usuarioAfetado, acao, modulo||'', empresa||'',
      typeof anterior==='object'?JSON.stringify(anterior):(anterior||''),
      typeof novo==='object'?JSON.stringify(novo):(novo||''),
      executadoPor||'sistema',
    ];
    await appendLinha('AUDITORIA_ACESSO', linha);
  } catch(e) { console.error('[AUDITORIA_ACESSO]', e.message); }
}

// ── Cache de permissões individuais (TTL 5 min) ───────────────────────────────
const _permCache = new Map();
async function carregarPermissoesUsuario(emailOuId) {
  const k = String(emailOuId||'').toLowerCase();
  const cached = _permCache.get(k);
  if (cached && Date.now() < cached.exp) return cached.data;
  const rows = await lerAba('PERMISSOES_USUARIO', 2000).catch(() => []);
  const userRows = rows.filter(r =>
    String(r.USUARIO_ID||'').toLowerCase()===k || String(r.USUARIO_EMAIL||'').toLowerCase()===k
  );
  const modulos = {};
  const competencias = [];
  for (const r of userRows) {
    if (r.MODULO) {
      const raw = String(r.MODULO).trim();
      if (raw.startsWith('{')) {
        try { for (const [m, n] of Object.entries(JSON.parse(raw))) modulos[m] = Number(n) || 0; } catch(e) {}
      } else if (r.NIVEL !== undefined) {
        modulos[raw] = Number(r.NIVEL) || 0;
      }
    }
    if (r.COMPETENCIAS) r.COMPETENCIAS.split(',').map(c=>c.trim()).filter(Boolean).forEach(c=>competencias.push(c));
  }
  const data = { modulos, competencias: [...new Set(competencias)] };
  _permCache.set(k, { data, exp: Date.now()+5*60*1000 });
  return data;
}
function invalidarCachePermissoes(emailOuId) {
  _permCache.delete(String(emailOuId||'').toLowerCase());
}

// ── Middleware: verifica nível mínimo em módulo ───────────────────────────────
function requerModulo(modulo, nivelMinimo = NIVEIS.CONSULTA) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({sucesso:false,erro:'Não autenticado.'});
      const perfil = normalizarPerfil(user.perfil);
      if (perfil === 'MASTER') return next();
      const uid = user.id||user.ID_USUARIO||user.email||user.EMAIL||user.usuario||user.USUARIO||'';
      const perms = await carregarPermissoesUsuario(uid);
      const nivel = resolverNivelModulo(user.perfil, modulo, perms.modulos);
      if (nivel < nivelMinimo) {
        return res.status(403).json({sucesso:false,erro:`Sem permissão para ${modulo}. Nível requerido: ${nivelMinimo}, seu nível: ${nivel}.`});
      }
      req._nivelModulo = nivel;
      req._permissoes = perms;
      next();
    } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
  };
}

// ── Middleware: verifica competência de aprovação ─────────────────────────────
function requerCompetencia(competencia) {
  return async (req, res, next) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({sucesso:false,erro:'Não autenticado.'});
      if (normalizarPerfil(user.perfil) === 'MASTER') return next();
      const uid = user.id||user.ID_USUARIO||user.email||user.EMAIL||user.usuario||user.USUARIO||'';
      const perms = await carregarPermissoesUsuario(uid);
      if (!temCompetencia(perms.competencias, competencia)) {
        return res.status(403).json({sucesso:false,erro:`Sem competência para ${competencia}.`});
      }
      next();
    } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
  };
}

// ── Validação de email ────────────────────────────────────────────────────────
function emailValido(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'')); }

// ═════════════════════════════════════════════════════════════════════════════
// 1. SOLICITAÇÃO DE ACESSO (público — rate-limited)
// ═════════════════════════════════════════════════════════════════════════════

// Rate limit simples para solicitações (em memória)
const _solicitacaoRate = new Map();
function rateLimitSolicitacao(ip) {
  const now = Date.now();
  const entry = _solicitacaoRate.get(ip) || { count:0, reset: now+60000 };
  if (now > entry.reset) { entry.count=0; entry.reset=now+60000; }
  entry.count++;
  _solicitacaoRate.set(ip, entry);
  return entry.count <= 5;
}

app.post('/api/public/solicitar-acesso', async (req, res) => {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]||req.socket?.remoteAddress||'';
  if (!rateLimitSolicitacao(ip)) return res.status(429).json({sucesso:false,erro:'Muitas solicitações. Aguarde um minuto.'});
  try {
    const { nome, email, empresa, setor, cargo, telefone, justificativa } = req.body||{};
    // Validações
    if (!nome?.trim()) return res.status(400).json({sucesso:false,erro:'Nome obrigatório.'});
    if (!email?.trim() || !emailValido(email)) return res.status(400).json({sucesso:false,erro:'E-mail inválido.'});
    if (!empresa?.trim()) return res.status(400).json({sucesso:false,erro:'Empresa obrigatória.'});
    if (!setor?.trim()) return res.status(400).json({sucesso:false,erro:'Setor obrigatório.'});
    if (!cargo?.trim()) return res.status(400).json({sucesso:false,erro:'Cargo obrigatório.'});
    if (!justificativa?.trim()) return res.status(400).json({sucesso:false,erro:'Justificativa obrigatória.'});

    // Valida empresa canônica (aceita MASTER para "todas as empresas")
    const empCod = empresaCanonica(empresa);
    if (!empCod) {
      return res.status(400).json({sucesso:false,erro:'Empresa inválida. Use: CHIACCHIO EMBALAGENS, PLASCHIO, CESBAP ou TODAS AS EMPRESAS.'});
    }

    // Verifica duplicidade de e-mail em usuários ativos
    const usuarios = await carregarUsuarios();
    const emailNorm = String(email).toLowerCase().trim();
    const statusBloqueantes = ['ativo', 'bloqueado'];
    const jaUsuario = usuarios.find(u => {
      if (String(u.EMAIL||'').toLowerCase().trim() !== emailNorm) return false;
      const st = normalizarTexto(u.STATUS||'ATIVO');
      return statusBloqueantes.includes(st);
    });
    if (jaUsuario) return res.status(409).json({sucesso:false,erro:'E-mail já possui conta ativa no sistema.'});

    // Verifica solicitação PENDENTE duplicada (PG é a fonte primária)
    if (solicitacaoRepo) {
      const jaExiste = await solicitacaoRepo.findPendenteByEmail(emailNorm).catch(() => null);
      if (jaExiste) return res.status(409).json({sucesso:false,erro:'Já existe uma solicitação pendente para este e-mail.'});
    }

    const id = `SOL-${Date.now().toString(36).toUpperCase()}`;

    // Grava no PG (fonte primária)
    if (!solicitacaoRepo) return res.status(503).json({sucesso:false,erro:'Banco de dados não disponível.'});
    await solicitacaoRepo.create({
      idSolicitacao: id,
      nome: nome.trim(),
      email: emailNorm,
      empresa: empCod,
      setor: setor.trim(),
      cargo: cargo.trim(),
      telefone: (telefone||'').trim(),
      justificativa: justificativa.trim(),
      status: 'PENDENTE',
    });
    await registrarAuditoriaAcesso(emailNorm, 'SOLICITACAO_CRIADA', '', empCod, '', 'PENDENTE', 'sistema');
    res.json({sucesso:true, id, mensagem:'Solicitação enviada. Aguarde aprovação do MASTER.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PAINEL DO MASTER — SOLICITAÇÕES
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/solicitacoes', requerPerfil('MASTER'), async (req, res) => {
  try {
    if (!solicitacaoRepo) return res.status(503).json({sucesso:false,erro:'Banco de dados não disponível.'});
    const stFil = (req.query.status || '').toUpperCase() || undefined;
    const empFil = req.query.empresa ? empresaCanonica(req.query.empresa) : undefined;
    const rows = await solicitacaoRepo.findAll({ status: stFil, empresa: empFil });
    const itens = rows.map(r => ({
      ID_SOLICITACAO: r.idSolicitacao,
      NOME: r.nome, EMAIL: r.email, EMPRESA: r.empresa,
      SETOR: r.setor, CARGO: r.cargo, TELEFONE: r.telefone||'',
      JUSTIFICATIVA: r.justificativa||'', STATUS: r.status,
      DATA_CRIACAO: r.criadaEm?.toISOString?.() || '',
      DATA_DECISAO: r.dataDecisao?.toISOString?.() || '',
      DECIDIDO_POR: r.decididoPor||'', MOTIVO_REJEICAO: r.motivoRejeicao||'',
    }));
    res.json({sucesso:true, total:itens.length, itens});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/admin/solicitacoes/:id', requerPerfil('MASTER'), async (req, res) => {
  try {
    if (!solicitacaoRepo) return res.status(503).json({sucesso:false,erro:'Banco de dados não disponível.'});
    const r = await solicitacaoRepo.findById(req.params.id);
    if (!r) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    const item = {
      ID_SOLICITACAO: r.idSolicitacao, NOME: r.nome, EMAIL: r.email, EMPRESA: r.empresa,
      SETOR: r.setor, CARGO: r.cargo, TELEFONE: r.telefone||'',
      JUSTIFICATIVA: r.justificativa||'', STATUS: r.status,
      DATA_CRIACAO: r.criadaEm?.toISOString?.() || '',
      DATA_DECISAO: r.dataDecisao?.toISOString?.() || '',
      DECIDIDO_POR: r.decididoPor||'', MOTIVO_REJEICAO: r.motivoRejeicao||'',
    };
    res.json({sucesso:true, item});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/admin/solicitacoes/:id/rejeitar', requerPerfil('MASTER'), async (req, res) => {
  try {
    if (!solicitacaoRepo) return res.status(503).json({sucesso:false,erro:'Banco de dados não disponível.'});
    const { motivo } = req.body||{};
    if (!motivo?.trim()) return res.status(400).json({sucesso:false,erro:'Motivo da rejeição obrigatório.'});
    const decididoPor = req.user.usuario||req.user.email||'MASTER';
    const sol = await solicitacaoRepo.findById(req.params.id);
    if (!sol) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    if (String(sol.status||'').toUpperCase() !== 'PENDENTE') return res.status(400).json({sucesso:false,erro:`Solicitação já ${sol.status}.`});
    await solicitacaoRepo.update(req.params.id, {
      status: 'REJEITADA', dataDecisao: new Date(), decididoPor, motivoRejeicao: motivo.trim(),
    });
    await registrarAuditoriaAcesso(sol.email||'', 'SOLICITACAO_REJEITADA', '', sol.empresa||'', 'PENDENTE', 'REJEITADA', decididoPor);
    res.json({sucesso:true, mensagem:'Solicitação rejeitada.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// Aprovação: cria o usuário com STATUS=ATIVO e define permissões
app.post('/api/admin/solicitacoes/:id/aprovar', requerPerfil('MASTER'), async (req, res) => {
  try {
    if (!solicitacaoRepo || !usuarioRepo) return res.status(503).json({sucesso:false,erro:'Banco de dados não disponível.'});
    const { perfil, empresa, setor, modulosNiveis, competencias, senha } = req.body||{};

    // Valida campos obrigatórios
    if (!perfil) return res.status(400).json({sucesso:false,erro:'Perfil obrigatório.'});
    const perfilNorm = normalizarPerfil(perfil);
    if (!PERFIS_VALIDOS.includes(perfilNorm)) return res.status(400).json({sucesso:false,erro:`Perfil inválido. Use: ${PERFIS_VALIDOS.join(', ')}.`});
    if (!empresa) return res.status(400).json({sucesso:false,erro:'Empresa obrigatória.'});
    const empCod = empresaCanonica(empresa);
    if (!empCod) return res.status(400).json({sucesso:false,erro:'Empresa inválida.'});

    // Lê do PG (fonte primária)
    const solRow = await solicitacaoRepo.findById(req.params.id);
    if (!solRow) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    if (String(solRow.status||'').toUpperCase() !== 'PENDENTE') return res.status(400).json({sucesso:false,erro:`Solicitação já ${solRow.status}.`});
    const sol = { email: solRow.email||'', nome: solRow.nome||'', empresa: solRow.empresa||'' };

    // Gera usuário (login = parte antes do @ do email)
    const login = sol.email.split('@')[0].replace(/[^a-z0-9.]/gi,'.');
    const senhaFinal = senha?.trim() || crypto.randomBytes(8).toString('hex');
    const senhaHash = 'sha256:'+crypto.createHash('sha256').update(senhaFinal).digest('hex');

    // Busca empresa e perfil do PG para criar usuário via ORM
    const prisma = require('../database/connection');
    const empresaObj = await prisma.empresa.findFirst({ where: { nome: { contains: empCod, mode: 'insensitive' } } }) ||
                       await prisma.empresa.findFirst();
    const perfilObj = await prisma.perfil.findFirst({ where: { codigo: perfilNorm } }) ||
                      await prisma.perfil.findFirst();
    if (!empresaObj || !perfilObj) return res.status(500).json({sucesso:false,erro:'Empresa ou perfil não encontrado no banco.'});

    const modulosConfig = modulosNiveis || {};
    const competenciasStr = Array.isArray(competencias) ? competencias.join(',') : (competencias||'');

    const novoUsuario = await usuarioRepo.create({
      empresaId: empresaObj.id,
      perfilId: perfilObj.id,
      nome: sol.nome,
      email: sol.email,
      senhaHash,
      ativo: true,
    });

    // Marca solicitação como APROVADA no PG
    await solicitacaoRepo.update(req.params.id, {
      status: 'APROVADA', dataDecisao: new Date(),
      decididoPor: req.user.usuario||'MASTER', motivoRejeicao: '',
    });

    await registrarAuditoriaAcesso(sol.email, 'USUARIO_CRIADO_POR_APROVACAO', '', empCod, '', JSON.stringify({perfil:perfilNorm,empresa:empCod,modulos:modulosConfig}), req.user.usuario||'MASTER');
    invalidarCachePermissoes(sol.email);
    res.json({sucesso:true, idUsuario: novoUsuario.id, login, mensagem:'Usuário criado e ativo.', senhaGerada: !senha?.trim() ? senhaFinal : undefined});
    // Envia e-mail com credenciais (fire-and-forget)
    enviarEmailAcesso({ para: sol.email, nome: sol.nome, login, senha: senhaFinal, perfil: perfilNorm, empresa: empCod }).catch(()=>{});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. ADMINISTRAÇÃO DE USUÁRIOS (MASTER)
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/admin/usuarios', requerPerfil('MASTER'), async (req, res) => {
  try {
    let usuarios = await carregarUsuarios();
    // Filtra sem expor senha
    let lista = usuarios.map(u => ({
      id: u.ID_USUARIO,
      usuario: u.USUARIO||u.EMAIL,
      nome: u.NOME||u.USUARIO,
      email: u.EMAIL||'',
      empresa: u.EMPRESA||'',
      setor: u.SETOR||'',
      cargo: u.CARGO||'',
      perfil: u.PERFIL||'',
      status: u.STATUS||'ATIVO',
      dataCriacao: u.DATA_CRIACAO||'',
      dataAprovacao: u.DATA_APROVACAO||'',
      aprovadoPor: u.APROVADO_POR||'',
      ultimoAcesso: u.ULTIMO_ACESSO||'',
    }));
    if (req.query.empresa) lista=lista.filter(u=>empresaCanonica(u.empresa)===empresaCanonica(req.query.empresa));
    if (req.query.perfil) lista=lista.filter(u=>normalizarPerfil(u.perfil)===normalizarPerfil(req.query.perfil));
    if (req.query.status) lista=lista.filter(u=>(u.status||'').toUpperCase()===req.query.status.toUpperCase());
    if (req.query.setor) lista=lista.filter(u=>normalizarTexto(u.setor||'')===normalizarTexto(req.query.setor));
    res.json({sucesso:true, total:lista.length, itens:lista});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/admin/usuarios/:id', requerPerfil('MASTER'), async (req, res) => {
  try {
    const usuarios = await carregarUsuarios();
    const u = usuarios.find(u2=>u2.ID_USUARIO===req.params.id||u2.USUARIO===req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    const perms = await carregarPermissoesUsuario(u.EMAIL||u.USUARIO||u.ID_USUARIO);
    res.json({sucesso:true, usuario:{
      id:u.ID_USUARIO, usuario:u.USUARIO, nome:u.NOME, email:u.EMAIL||'',
      empresa:u.EMPRESA||'', setor:u.SETOR||'', cargo:u.CARGO||'',
      perfil:u.PERFIL||'', status:u.STATUS||'ATIVO',
      dataCriacao:u.DATA_CRIACAO||'', aprovadoPor:u.APROVADO_POR||'',
      ultimoAcesso:u.ULTIMO_ACESSO||'',
    }, permissoes:perms});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.patch('/api/admin/usuarios/:id/permissoes', requerPerfil('MASTER'), async (req, res) => {
  try {
    const { perfil, empresa, setor, email, modulosNiveis, competencias } = req.body||{};
    const usuarios = await carregarUsuarios();
    const u = usuarios.find(u2=>u2.ID_USUARIO===req.params.id||u2.USUARIO===req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});

    const anterior = { perfil:u.PERFIL, empresa:u.EMPRESA };
    const updates = { DATA_ULTIMA_ALTERACAO:new Date().toISOString(), ALTERADO_POR:req.user.usuario||'MASTER' };
    if (perfil) {
      const pNorm = normalizarPerfil(perfil);
      if (!PERFIS_VALIDOS.includes(pNorm)) return res.status(400).json({sucesso:false,erro:`Perfil inválido.`});
      updates.PERFIL = pNorm;
    }
    if (empresa) {
      const eCod = empresaCanonica(empresa);
      if (!eCod) return res.status(400).json({sucesso:false,erro:'Empresa inválida.'});
      updates.EMPRESA = eCod;
    }
    if (setor) updates.SETOR = setor;
    if (email) updates.EMAIL = email;
    // Fonte enforced: ao salvar níveis de módulo, grava também as chaves granulares
    // em PERMISSOES_GRANTED para que o acesso valha nas rotas e na UI.
    if (modulosNiveis !== undefined) {
      updates.PERMISSOES_GRANTED = JSON.stringify(permissoesGranularDeModulos(modulosNiveis || {}));
    }

    // Atualiza PG diretamente se o usuário tem _pgId
    if (u._pgId && usuarioRepo) {
      const prisma = require('../database/connection');
      const pgUpdate = {};
      if (updates.PERFIL) {
        const perfilObj = await prisma.perfil.findFirst({ where: { codigo: updates.PERFIL } });
        if (perfilObj) pgUpdate.perfilId = perfilObj.id;
      }
      if (updates.EMPRESA) {
        const empObj = await prisma.empresa.findFirst({ where: { nome: { contains: updates.EMPRESA, mode: 'insensitive' } } });
        if (empObj) pgUpdate.empresaId = empObj.id;
      }
      if (updates.SETOR) pgUpdate.setor = updates.SETOR;
      if (Object.keys(pgUpdate).length > 0) {
        await usuarioRepo.update(u._pgId, pgUpdate).catch(e => console.warn('[PERM] PG update falhou:', e.message));
      }
    }

    invalidarCachePermissoes(u.EMAIL||u.USUARIO||u.ID_USUARIO);
    _statusCache.delete(normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO));
    _statusCache.delete(u.USUARIO||u.EMAIL||u.ID_USUARIO);
    await registrarAuditoriaAcesso(u.EMAIL||u.USUARIO, 'PERMISSOES_ALTERADAS', JSON.stringify(modulosNiveis||{}), empresa||u.EMPRESA, JSON.stringify(anterior), JSON.stringify(updates), req.user.usuario||'MASTER');
    res.json({sucesso:true, mensagem:'Permissões atualizadas.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/admin/usuarios/:id/ativar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const usuarios = await carregarUsuarios();
    const u = usuarios.find(u2=>u2.ID_USUARIO===req.params.id||u2.USUARIO===req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if (u._pgId && usuarioRepo) await usuarioRepo.update(u._pgId, { ativo: true }).catch(()=>{});
    invalidarCachePermissoes(u.EMAIL||u.USUARIO||u.ID_USUARIO);
    _statusCache.delete(normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO));
    await registrarAuditoriaAcesso(u.EMAIL||u.USUARIO, 'USUARIO_ATIVADO', '', u.EMPRESA, u.STATUS||'INATIVO', 'ATIVO', req.user.usuario||'MASTER');
    res.json({sucesso:true, mensagem:'Usuário ativado.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/admin/usuarios/:id/desativar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const usuarios = await carregarUsuarios();
    const u = usuarios.find(u2=>u2.ID_USUARIO===req.params.id||u2.USUARIO===req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if (normalizarPerfil(u.PERFIL)==='MASTER' && u.ID_USUARIO===req.user.id) return res.status(400).json({sucesso:false,erro:'Não pode desativar a si mesmo.'});
    if (u._pgId && usuarioRepo) await usuarioRepo.update(u._pgId, { ativo: false }).catch(()=>{});
    invalidarCachePermissoes(u.EMAIL||u.USUARIO||u.ID_USUARIO);
    _statusCache.delete(normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO));
    await registrarAuditoriaAcesso(u.EMAIL||u.USUARIO, 'USUARIO_DESATIVADO', '', u.EMPRESA, u.STATUS||'ATIVO', 'INATIVO', req.user.usuario||'MASTER');
    res.json({sucesso:true, mensagem:'Usuário desativado. Acesso revogado imediatamente.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/admin/auditoria-acesso', requerPerfil('MASTER','AUDITOR'), async (req, res) => {
  try {
    let rows = await lerAba('AUDITORIA_ACESSO', 2000).catch(()=>[]);
    if (req.query.usuario) rows=rows.filter(r=>String(r.USUARIO_AFETADO||'').toLowerCase().includes(req.query.usuario.toLowerCase()));
    if (req.query.acao) rows=rows.filter(r=>r.ACAO===req.query.acao.toUpperCase());
    res.json({sucesso:true, total:rows.length, itens:rows.reverse()});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ── Permissões do usuário logado (para frontend) ──────────────────────────────
app.get('/api/auth/permissoes', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({sucesso:false,erro:'Não autenticado.'});
    const uid = req.user.id||req.user.ID_USUARIO||req.user.email||req.user.EMAIL||req.user.usuario||req.user.USUARIO||'';
    const perms = await carregarPermissoesUsuario(uid);
    const perfil = normalizarPerfil(req.user.perfil);

    const niveis = {};
    const { MODULOS_SISTEMA: MODS, resolverNivelModulo: rnm } = permissoesService;
    for (const m of MODS) {
      niveis[m] = rnm(req.user.perfil, m, perms.modulos);
    }
    const cerebroPerms = permissoesService.CEREBRO_PERMISSOES_PADRAO[perfil] || permissoesService.CEREBRO_PERMISSOES_PADRAO['CONSULTA'];
    res.json({sucesso:true, perfil, empresa:req.user.empresa, modulos:niveis, competencias:perms.competencias, cerebro:cerebroPerms});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ── Configurações globais para o frontend (perfis, módulos, níveis) ───────────
app.get('/api/admin/config-permissoes', requerPerfil('MASTER'), (req, res) => {
  res.json({
    sucesso:true,
    perfis: permissoesService.PERFIS_VALIDOS,
    modulos: permissoesService.MODULOS_SISTEMA,
    niveis: permissoesService.NIVEIS,
    competencias: permissoesService.COMPETENCIAS_VALIDAS,
  });
});

// ===== ALIMENTAÇÃO DA FERRAMENTA — STATUS DAS FONTES =====
app.get('/api/alimentacao/status', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const abas = [
      'BANCO_HISTORICO','MANIFESTACOES','CAUSAS','CONFIG_SETORES',
      'PRODUTOS','BANCO_RNC','FICHAS_BIBLIOTECA','MATRIZ_TRATAMENTO',
      'REPRESENTANTES','PESQUISAS_SATISFACAO','POLITICAS','PROCEDIMENTOS'
    ];
    const resultados = await Promise.allSettled(abas.map(aba=>lerAba(aba,5000).then(r=>({aba,ok:true,total:r.length})).catch(()=>({aba,ok:true,total:0}))));
    const fontes = {};
    for(const r of resultados){
      if(r.status==='fulfilled') fontes[r.value.aba]={ok:r.value.ok,total:r.value.total};
    }
    res.json({sucesso:true,fontes});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),fontes:{}}); }
});

app.get('/api/alimentacao/historico', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const logs = await lerAba('LOG_SISTEMA',3000).catch(()=>[]);
    const importacoes = logs
      .filter(l=>l.ACAO==='IMPORTOU_DADOS_PLANILHA'||l.ACAO==='IMPORTOU_DADOS')
      .slice(-100)
      .reverse();
    res.json({sucesso:true,total:importacoes.length,itens:importacoes});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

// POST /api/alimentacao/upload-docx — parse Word form → manifestação object
app.post('/api/alimentacao/upload-docx', requerPerfil('MASTER','ANALISTA SAC'), (req,res)=>{
  const Busboy = (() => { try { return require('busboy'); } catch { return null; } })();
  const AdmZip = (() => { try { return require('adm-zip'); } catch { return null; } })();
  if (!Busboy || !AdmZip) return res.status(500).json({sucesso:false,erro:'Dependências não disponíveis.'});
  const bb = Busboy({ headers: req.headers });
  const chunks = [];
  let filename = '';
  bb.on('file', (_field, file, info) => {
    filename = info.filename || '';
    file.on('data', d => chunks.push(d));
  });
  bb.on('finish', () => {
    try {
      const buf = Buffer.concat(chunks);
      const zip = new AdmZip(buf);
      const entry = zip.getEntry('word/document.xml');
      if (!entry) return res.status(400).json({sucesso:false,erro:'Arquivo inválido: não é um .docx válido.'});
      const xml = zip.readAsText(entry);
      // Extract all text grouped by paragraph/table-cell
      const nsR = /w:r[^a-zA-Z][^>]*>|<w:r>/g;
      const textRe = /<w:t[^>]*>([^<]*)<\/w:t>/g;
      const parRe = /<w:p[ >][\s\S]*?<\/w:p>/g;
      const tcRe = /<w:tc[ >][\s\S]*?<\/w:tc>/g;
      const trRe = /<w:tr[ >][\s\S]*?<\/w:tr>/g;
      const tblRe = /<w:tbl[ >][\s\S]*?<\/w:tbl>/g;

      function extractText(xmlFrag) {
        let t='', m; const re=/<w:t[^>]*>([^<]*)<\/w:t>/g;
        while((m=re.exec(xmlFrag))!==null) t+=m[1];
        return t.trim();
      }

      // Parse tables into [{label, value}] pairs
      const tables = [];
      let tm; const tblRe2=/<w:tbl[ >][\s\S]*?<\/w:tbl>/g;
      while((tm=tblRe2.exec(xml))!==null){
        const rows=[];
        let rm; const trRe2=/<w:tr[ >][\s\S]*?<\/w:tr>/g;
        while((rm=trRe2.exec(tm[0]))!==null){
          const cells=[];
          let cm; const tcRe2=/<w:tc[ >][\s\S]*?<\/w:tc>/g;
          while((cm=tcRe2.exec(rm[0]))!==null) cells.push(extractText(cm[0]));
          if(cells.length) rows.push(cells);
        }
        tables.push(rows);
      }

      // Helper: find value in tables by label keyword
      function findVal(keyword) {
        for(const t of tables) for(const row of t){
          for(let i=0;i<row.length-1;i++){
            if(row[i].toLowerCase().includes(keyword.toLowerCase()) && row[i+1]) return row[i+1].trim();
          }
          if(row.length===1 && row[0].toLowerCase().includes(keyword.toLowerCase())){
            // next row may be value
            const ti=tables.indexOf(t), ri=t.indexOf(row);
            if(t[ri+1]&&t[ri+1][0]) return t[ri+1][0].trim();
          }
        }
        return '';
      }

      // Map Word form fields → MANIFESTACOES columns
      const dataReg = findVal('Data do Registro');
      const nRecl   = findVal('Nº Reclamação');
      const atendente = findVal('Atendente');
      const nomeCliente = findVal('Nome do Cliente');
      const empresa = findVal('Empresa / Razão Social') || findVal('Empresa');
      const cnpj = findVal('CNPJ');
      const tel  = findVal('Telefone');
      const email = findVal('E-mail');
      const tipo = findVal('Tipo de Manifestação');
      const motivo = findVal('Motivo da Manifestação');
      const descricao = findVal('Descrição Detalhada');
      const produto = findVal('Produto');
      const lote = findVal('Lote');
      const nfe = findVal('NFe');
      const causaId = findVal('Causa Identificada');
      const acaoCorr = findVal('Ação Corretiva');
      const acaoPrev = findVal('Ação Preventiva');
      const dataConc = findVal('Data da Conclusão') || findVal('Data de Conclusão');
      const responsavel = findVal('Responsável pela Tratativa') || findVal('Responsável');
      const dataRet = findVal('Data de Retorno');
      const resolvida = findVal('Manifestação Resolvida');
      const clienteInfo = findVal('Cliente Informado');
      const obsFinais = findVal('Observações Finais') || findVal('Observações');

      // Detect tipo from checkbox pattern [x] / (x)
      let tipoLimpo = 'Reclamação';
      if(/\[x\]\s*Reclamação|\(x\)\s*Reclamação/i.test(tipo)) tipoLimpo='Reclamação';
      else if(/\[x\]\s*Dúvida|\(x\)\s*Dúvida/i.test(tipo)) tipoLimpo='Dúvida';
      else if(/\[x\]\s*Sugestão|\(x\)\s*Sugestão/i.test(tipo)) tipoLimpo='Sugestão';
      else if(/\[x\]\s*Elogio|\(x\)\s*Elogio/i.test(tipo)) tipoLimpo='Elogio';

      const objeto = {
        DATA_REGISTRO: dataReg,
        EMPRESA_RECLAMANTE: empresa,
        CNPJ: cnpj,
        CONTATO: nomeCliente,
        TELEFONE: tel,
        EMAIL: email,
        PRODUTO: produto,
        LOTE: lote,
        NFE: nfe,
        TIPO: tipoLimpo,
        DESCRICAO: descricao || motivo,
        DESCRICAO_MANIFESTACAO: descricao || motivo,
        STATUS: acaoCorr ? 'CONCLUIDA' : 'RECEBIDA',
        STATUS_TRATATIVA: acaoCorr ? 'CONCLUIDA' : 'NÃO INICIADA',
        CANAL: atendente ? 'FICHA' : '',
        USUARIO_CRIACAO: atendente,
        ORIGEM: 'DOCUMENTO',
        ARQUIVO_ORIGEM: filename,
        TRATATIVA_REALIZADA: acaoCorr,
        DATA_CONCLUSAO_TRATATIVA: dataConc,
        DEVOLUTIVA_FINAL: obsFinais,
        DATA_DEVOLUTIVA: dataRet,
      };
      // Remove empty keys
      Object.keys(objeto).forEach(k=>{ if(!objeto[k]) delete objeto[k]; });

      res.json({sucesso:true,objeto,arquivo:filename,tabelas:tables.length});
    } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e,'processar-arquivo')}); }
  });
  req.pipe(bb);
});

app.post('/api/matriz-tratamento', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const b = req.body||{};
    if(!b.TIPO_MANIFESTACAO&&!b.CAUSA) return res.status(400).json({sucesso:false,erro:'Tipo de manifestação ou causa são obrigatórios.'});
    const id = await gerarProximoID('MATRIZ_TRATAMENTO','MTR','ID_REGRA');
    const obj = {
      ID_REGRA:id,
      TIPO_MANIFESTACAO:b.TIPO_MANIFESTACAO||'',
      EMPRESA:b.EMPRESA||'',
      CAUSA:b.CAUSA||'',
      SUBCAUSA:b.SUBCAUSA||'',
      SETOR_RESPONSAVEL:b.SETOR_RESPONSAVEL||'',
      SLA_HORAS:b.SLA_HORAS||'',
      PRIORIDADE:b.PRIORIDADE||'NORMAL',
      TRATATIVA_PADRAO:b.TRATATIVA_PADRAO||'',
      DEVOLUTIVA_PADRAO:b.DEVOLUTIVA_PADRAO||'',
      REQUER_APROVACAO:b.REQUER_APROVACAO||'NAO',
      ATIVO:b.ATIVO!==false?'SIM':'NAO',
      DATA_CRIACAO:new Date().toISOString(),
      CRIADO_POR:req.user.usuario
    };
    await appendObjeto('MATRIZ_TRATAMENTO',obj).catch(e => console.warn('[matriz] Sheets falhou (seguindo p/ PG):', e.message));
    if (conhecimentoRepo && typeof conhecimentoRepo.upsertMatriz === 'function') await conhecimentoRepo.upsertMatriz({
      empresa: obj.EMPRESA, tipo: obj.TIPO_MANIFESTACAO, categoria: obj.CAUSA, subcategoria: obj.SUBCAUSA, setor: obj.SETOR_RESPONSAVEL,
      dados: {
        idOriginal: id, prioridade: obj.PRIORIDADE || null,
        prazoTratativa: obj.SLA_HORAS ? (parseInt(obj.SLA_HORAS, 10) || null) : null,
        tratativaObrigatoria: obj.TRATATIVA_PADRAO || null,
        modeloDevolutiva: obj.DEVOLUTIVA_PADRAO || null,
        necessitaAprovacao: String(obj.REQUER_APROVACAO).toUpperCase() === 'SIM',
        ativo: obj.ATIVO !== 'NAO',
      },
    }).catch(e => console.warn('[F10] upsertMatriz PG:', e.message));
    await registrarAuditoria(req.user.usuario,'CRIOU_REGRA_MATRIZ',id,'MATRIZ_TRATAMENTO',null,{causa:obj.CAUSA});
    res.json({sucesso:true,regra:obj});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.patch('/api/matriz-tratamento/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const b = req.body||{};
    const dados = {};
    if (b.TIPO_MANIFESTACAO!==undefined) dados.TIPO_MANIFESTACAO=b.TIPO_MANIFESTACAO;
    if (b.CAUSA!==undefined) dados.CAUSA=b.CAUSA;
    if (b.SUBCAUSA!==undefined) dados.SUBCAUSA=b.SUBCAUSA;
    if (b.SETOR_RESPONSAVEL!==undefined) dados.SETOR_RESPONSAVEL=b.SETOR_RESPONSAVEL;
    if (b.SLA_HORAS!==undefined) dados.SLA_HORAS=b.SLA_HORAS;
    if (b.PRIORIDADE!==undefined) dados.PRIORIDADE=b.PRIORIDADE;
    if (b.TRATATIVA_PADRAO!==undefined) dados.TRATATIVA_PADRAO=b.TRATATIVA_PADRAO;
    if (b.DEVOLUTIVA_PADRAO!==undefined) dados.DEVOLUTIVA_PADRAO=b.DEVOLUTIVA_PADRAO;
    if (b.ATIVO!==undefined) dados.ATIVO=b.ATIVO;
    const r = await atualizarPorID('MATRIZ_TRATAMENTO', req.params.id, dados, ['ID_REGRA']);
    if (!r) return res.status(404).json({sucesso:false,erro:'Regra não encontrada.'});
    res.json({sucesso:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ─────────────────────────────────────────────────────────────────────────────
// QUESTIONÁRIOS POR EMPRESA (/api/questionarios/:empresa)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/questionarios/:empresa', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','GESTOR SAC'), async (req, res) => {
  try {
    const emp = (req.params.empresa || '').toUpperCase();
    await garantirAbaComCabecalhos('PESQUISA_QUESTIONARIO', ['ID_VERSAO','STATUS','EMPRESA','CRIADO_EM','PUBLICADO_EM','CRIADO_POR','PERGUNTAS_JSON']);
    const rows = await lerAba('PESQUISA_QUESTIONARIO', 200);
    const filtered = rows.filter(r => !r.EMPRESA || r.EMPRESA.toUpperCase() === emp || emp === 'TODAS');
    const publicada = filtered.filter(r => r.STATUS === 'PUBLICADA').sort((a,b)=>new Date(b.PUBLICADO_EM||0)-new Date(a.PUBLICADO_EM||0))[0] || null;
    const rascunho = filtered.filter(r => r.STATUS === 'RASCUNHO').sort((a,b)=>new Date(b.CRIADO_EM||0)-new Date(a.CRIADO_EM||0))[0] || null;
    const parse = r => r ? { ...r, perguntas: (() => { try { return JSON.parse(r.PERGUNTAS_JSON||'[]'); } catch(e) { return []; } })() } : null;
    res.json({ sucesso: true, empresa: emp, publicada: parse(publicada), rascunho: parse(rascunho) });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'get-questionario-empresa') }); }
});

app.post('/api/questionarios/:empresa', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const emp = (req.params.empresa || '').toUpperCase();
    const { perguntas, textos, acao = 'RASCUNHO' } = req.body || {};
    if (!Array.isArray(perguntas) || perguntas.length === 0) return res.status(400).json({ sucesso: false, erro: 'perguntas obrigatório.' });
    if (!['RASCUNHO','PUBLICADA'].includes(acao)) return res.status(400).json({ sucesso: false, erro: 'acao deve ser RASCUNHO ou PUBLICADA.' });
    await garantirAbaComCabecalhos('PESQUISA_QUESTIONARIO', ['ID_VERSAO','STATUS','EMPRESA','CRIADO_EM','PUBLICADO_EM','CRIADO_POR','PERGUNTAS_JSON','TEXTOS_JSON']);
    const idVersao = 'QV-' + emp.slice(0,3) + '-' + Date.now();
    await appendObjeto('PESQUISA_QUESTIONARIO', {
      ID_VERSAO: idVersao, STATUS: acao, EMPRESA: emp,
      CRIADO_EM: new Date().toISOString(),
      PUBLICADO_EM: acao === 'PUBLICADA' ? new Date().toISOString() : '',
      CRIADO_POR: req.user?.usuario || '',
      PERGUNTAS_JSON: JSON.stringify(perguntas),
      TEXTOS_JSON: JSON.stringify(textos || {}),
    });
    invalidarCacheAba('PESQUISA_QUESTIONARIO');
    await registrarAuditoria(req.user?.usuario||'sistema', `QUESTIONARIO_${acao}_${emp}`, null, 'PESQUISA_QUESTIONARIO', null, { id: idVersao, empresa: emp });
    res.json({ sucesso: true, id: idVersao, status: acao, empresa: emp });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'save-questionario-empresa') }); }
});

app.post('/api/questionarios/:empresa/publicar', requerPerfil('MASTER','APROVADOR'), async (req, res) => {
  try {
    const emp = (req.params.empresa || '').toUpperCase();
    const { id } = req.body || {};
    const rows = await lerAba('PESQUISA_QUESTIONARIO', 200).catch(()=>[]);
    const item = id ? rows.find(r => r.ID_VERSAO === id) : rows.filter(r => (!r.EMPRESA || r.EMPRESA.toUpperCase() === emp) && r.STATUS === 'RASCUNHO').sort((a,b)=>new Date(b.CRIADO_EM||0)-new Date(a.CRIADO_EM||0))[0];
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Rascunho não encontrado.' });
    await atualizarPorID('PESQUISA_QUESTIONARIO', item.ID_VERSAO, { STATUS: 'PUBLICADA', PUBLICADO_EM: new Date().toISOString(), CRIADO_POR: req.user?.usuario||'' }, ['ID_VERSAO']);
    invalidarCacheAba('PESQUISA_QUESTIONARIO');
    await registrarAuditoria(req.user?.usuario||'sistema', `QUESTIONARIO_PUBLICADO_${emp}`, null, 'PESQUISA_QUESTIONARIO', 'RASCUNHO', { id: item.ID_VERSAO });
    res.json({ sucesso: true, id: item.ID_VERSAO, empresa: emp });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'publicar-questionario') }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// OCORRÊNCIAS DE PESQUISA — create / update
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/pesquisas/ocorrencias', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { token, empresa, nps, setor, descricao } = req.body || {};
    if (!token) return res.status(400).json({ sucesso: false, erro: 'token obrigatório.' });
    await garantirAbaComCabecalhos('PESQUISA_OCORRENCIAS', ['ID_OCP','TOKEN','EMPRESA','DATA','NPS','SETOR','STATUS','DECISAO','JUSTIFICATIVA','ID_MANIFESTACAO_GERADA','ANALISTA','DATA_DECISAO','DESCRICAO']);
    const idOcp = 'OCP-' + Date.now();
    await appendObjeto('PESQUISA_OCORRENCIAS', {
      ID_OCP: idOcp, TOKEN: token, EMPRESA: empresa || '', DATA: new Date().toISOString(),
      NPS: nps != null ? String(nps) : '', SETOR: setor || '', STATUS: 'PENDENTE',
      DECISAO: '', JUSTIFICATIVA: '', ID_MANIFESTACAO_GERADA: '', DESCRICAO: descricao || '',
      ANALISTA: req.user?.usuario || '', DATA_DECISAO: '',
    });
    invalidarCacheAba('PESQUISA_OCORRENCIAS');
    res.json({ sucesso: true, id: idOcp });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'create-ocp') }); }
});

app.patch('/api/pesquisas/ocorrencias/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { status, decisao, justificativa, idManifestacao } = req.body || {};
    const rows = await lerAba('PESQUISA_OCORRENCIAS', 2000);
    const ocp = rows.find(r => r.ID_OCP === req.params.id);
    if (!ocp) return res.status(404).json({ sucesso: false, erro: 'OCP não encontrada.' });
    const upd = {};
    if (status) upd.STATUS = status;
    if (decisao) upd.DECISAO = decisao;
    if (justificativa) upd.JUSTIFICATIVA = justificativa;
    if (idManifestacao) upd.ID_MANIFESTACAO_GERADA = idManifestacao;
    upd.ANALISTA = req.user?.usuario || ocp.ANALISTA || '';
    upd.DATA_DECISAO = new Date().toISOString();
    await atualizarPorID('PESQUISA_OCORRENCIAS', req.params.id, upd, ['ID_OCP']);
    invalidarCacheAba('PESQUISA_OCORRENCIAS');
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'patch-ocp') }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PESQUISA PÚBLICA POR TOKEN (sem auth)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/pesquisa/:token', publicRateLimit, async (req, res) => {
  try {
    const token = req.params.token;
    const tokens = await lerAba('PESQUISA_TOKENS', 5000).catch(()=>[]);
    const tk = tokens.find(t => t.TOKEN === token);
    if (!tk) return res.status(404).json({ sucesso: false, erro: 'Pesquisa não encontrada ou expirada.' });
    if (tk.RESPONDIDO_EM) return res.status(410).json({ sucesso: false, erro: 'Esta pesquisa já foi respondida.', jaRespondida: true });
    const validade = tk.VALIDADE_EM ? new Date(tk.VALIDADE_EM) : null;
    if (validade && validade < new Date()) return res.status(410).json({ sucesso: false, erro: 'Esta pesquisa expirou.', expirada: true });
    // Buscar questionário publicado da empresa
    const qRows = await lerAba('PESQUISA_QUESTIONARIO', 200).catch(()=>[]);
    const emp = (tk.EMPRESA || '').toUpperCase();
    const publicada = qRows.filter(r => r.STATUS === 'PUBLICADA' && (!r.EMPRESA || r.EMPRESA.toUpperCase() === emp)).sort((a,b)=>new Date(b.PUBLICADO_EM||0)-new Date(a.PUBLICADO_EM||0))[0];
    let perguntas = [];
    if (publicada) { try { perguntas = JSON.parse(publicada.PERGUNTAS_JSON||'[]'); } catch(e) {} }
    res.json({ sucesso: true, token, empresa: tk.EMPRESA, nomeCliente: tk.NOME_CLIENTE || '', perguntas, versaoId: publicada?.ID_VERSAO || '' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'get-pesquisa-token') }); }
});

app.post('/api/pesquisas/resposta/:token', publicRateLimit, async (req, res) => {
  try {
    const token = req.params.token;
    const tokens = await lerAba('PESQUISA_TOKENS', 5000).catch(()=>[]);
    const tk = tokens.find(t => t.TOKEN === token);
    if (!tk) return res.status(404).json({ sucesso: false, erro: 'Pesquisa não encontrada.' });
    if (tk.RESPONDIDO_EM) return res.status(410).json({ sucesso: false, erro: 'Já respondida.', jaRespondida: true });
    const { respostas, comentario, versaoId } = req.body || {};
    const _HEADERS_RESP = ['ID_RESPOSTA','TOKEN','EMPRESA','NOME_CLIENTE','DATA','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','COMENTARIO','NOTA_MEDIA','NOTA_BAIXA','STATUS_OCP'];
    await garantirAbaComCabecalhos('PESQUISA_RESPOSTAS', _HEADERS_RESP);
    const idResp = 'RSP-' + Date.now();
    // Mapear array de respostas para colunas canônicas por palavra-chave
    const _notaMap = {};
    (Array.isArray(respostas) ? respostas : []).forEach(r => {
      const p = String(r.pergunta || r.label || r.titulo || '').toLowerCase();
      const n = typeof r.nota === 'number' ? r.nota : parseFloat(r.nota);
      if (isNaN(n)) return;
      if (/atend/.test(p)) _notaMap.ATENDIMENTO = n;
      else if (/prazo|entrega/.test(p)) _notaMap.PRAZO_ENTREGA = n;
      else if (/qualidade|produto/.test(p)) _notaMap.QUALIDADE = n;
      else if (/recomend|nps|indica/.test(p)) _notaMap.RECOMENDACAO = n;
    });
    const _notaVals = Object.values(_notaMap).filter(n => n > 0);
    const notaGeral = _notaVals.length ? (_notaVals.reduce((a,b)=>a+b,0)/_notaVals.length).toFixed(1) : '';
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA||6);
    const notaBaixa = _notaVals.length && _notaVals.some(n => n <= NOTA_CRITICA) ? 'SIM' : 'NAO';
    const _respObj = {
      ID_RESPOSTA: idResp, TOKEN: token, EMPRESA: tk.EMPRESA || '',
      NOME_CLIENTE: tk.NOME_CLIENTE || '', DATA: new Date().toISOString(),
      ATENDIMENTO: _notaMap.ATENDIMENTO != null ? String(_notaMap.ATENDIMENTO) : '',
      PRAZO_ENTREGA: _notaMap.PRAZO_ENTREGA != null ? String(_notaMap.PRAZO_ENTREGA) : '',
      QUALIDADE: _notaMap.QUALIDADE != null ? String(_notaMap.QUALIDADE) : '',
      RECOMENDACAO: _notaMap.RECOMENDACAO != null ? String(_notaMap.RECOMENDACAO) : '',
      COMENTARIO: comentario || '', NOTA_MEDIA: notaGeral, NOTA_BAIXA: notaBaixa, STATUS_OCP: '',
    };
    await appendObjeto('PESQUISA_RESPOSTAS', _respObj);
    if (pesquisaRepo) await pesquisaRepo.criarResposta(_respObj).catch(e => console.warn('[F8] criarResposta PG:', e.message));
    // Marcar token como respondido
    await atualizarPorID('PESQUISA_TOKENS', token, { RESPONDIDO_EM: new Date().toISOString() }, ['TOKEN']).catch(()=>{});
    invalidarCacheAba('PESQUISA_RESPOSTAS');
    invalidarCacheAba('PESQUISA_TOKENS');
    // Se nota baixa, criar OCP automática
    if (notaBaixa === 'SIM') {
      await appendObjeto('PESQUISA_OCORRENCIAS', {
        ID_OCP: 'OCP-' + Date.now(), TOKEN: token, EMPRESA: tk.EMPRESA||'',
        DATA: new Date().toISOString(), NPS: notaGeral, STATUS: 'PENDENTE',
        DECISAO: '', JUSTIFICATIVA: '', ID_MANIFESTACAO_GERADA: '', ANALISTA: '', DATA_DECISAO: '',
      }).catch(()=>{});
      invalidarCacheAba('PESQUISA_OCORRENCIAS');
    }
    res.json({ sucesso: true, id: idResp, notaGeral, notaBaixa: notaBaixa === 'SIM' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'save-resposta') }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTAÇÃO DE DADOS (/api/importacao/*)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/importacao/iniciar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const { fonte, descricao, registros } = req.body || {};
    if (!fonte) return res.status(400).json({ sucesso: false, erro: 'fonte obrigatória.' });
    await garantirAbaComCabecalhos('IMPORTACAO_HISTORICO', ['ID_IMP','FONTE','DESCRICAO','STATUS','REGISTROS_TOTAL','REGISTROS_OK','REGISTROS_ERR','USUARIO','DATA_INICIO','DATA_FIM','PODE_DESFAZER','DESFAZENDO_EM','ERROS_JSON']);
    const idImp = 'IMP-' + Date.now();
    await appendObjeto('IMPORTACAO_HISTORICO', {
      ID_IMP: idImp, FONTE: fonte, DESCRICAO: descricao || '', STATUS: 'PROCESSANDO',
      REGISTROS_TOTAL: Array.isArray(registros) ? registros.length : 0,
      REGISTROS_OK: 0, REGISTROS_ERR: 0,
      USUARIO: req.user?.usuario || '', DATA_INICIO: new Date().toISOString(), DATA_FIM: '',
      PODE_DESFAZER: 'SIM', DESFAZENDO_EM: '', ERROS_JSON: '[]',
    });
    invalidarCacheAba('IMPORTACAO_HISTORICO');
    res.json({ sucesso: true, id: idImp, status: 'PROCESSANDO' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'importacao-iniciar') }); }
});

app.get('/api/importacao/historico', requerPerfil('MASTER'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('IMPORTACAO_HISTORICO', ['ID_IMP','FONTE','DESCRICAO','STATUS','REGISTROS_TOTAL','REGISTROS_OK','REGISTROS_ERR','USUARIO','DATA_INICIO','DATA_FIM','PODE_DESFAZER','DESFAZENDO_EM','ERROS_JSON']);
    const rows = await lerAba('IMPORTACAO_HISTORICO', 500);
    res.json({ sucesso: true, total: rows.length, itens: rows.sort((a,b)=>new Date(b.DATA_INICIO||0)-new Date(a.DATA_INICIO||0)) });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'importacao-historico') }); }
});

app.post('/api/importacao/:id/desfazer', requerPerfil('MASTER'), async (req, res) => {
  try {
    const rows = await lerAba('IMPORTACAO_HISTORICO', 500).catch(()=>[]);
    const imp = rows.find(r => r.ID_IMP === req.params.id);
    if (!imp) return res.status(404).json({ sucesso: false, erro: 'Importação não encontrada.' });
    if (imp.STATUS !== 'CONCLUIDA' && imp.STATUS !== 'PROCESSANDO') return res.status(400).json({ sucesso: false, erro: 'Esta importação não pode ser desfeita.' });
    // Verificar janela de 24h
    const inicio = new Date(imp.DATA_INICIO || 0);
    const agora = new Date();
    if ((agora - inicio) > 24*60*60*1000) return res.status(400).json({ sucesso: false, erro: 'Prazo de 24 horas para desfazer expirou.' });
    await atualizarPorID('IMPORTACAO_HISTORICO', req.params.id, {
      STATUS: 'DESFEITA', DESFAZENDO_EM: agora.toISOString(),
    }, ['ID_IMP']);
    invalidarCacheAba('IMPORTACAO_HISTORICO');
    await registrarAuditoria(req.user?.usuario||'sistema', 'DESFEZ_IMPORTACAO', req.params.id, 'IMPORTACAO_HISTORICO', imp.STATUS, {});
    res.json({ sucesso: true });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'importacao-desfazer') }); }
});

app.get('/api/importacao/pendencias', requerPerfil('MASTER'), async (req, res) => {
  try {
    // Verificar pendências de dados: tokens sem resposta, manifestações sem causa, etc.
    const [tokens, respostas, manifestacoes] = await Promise.all([
      lerAba('PESQUISA_TOKENS', 5000).catch(()=>[]),
      lerRespostasPesquisa(),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
    ]);
    const tksRespondidos = new Set(respostas.map(r => r.TOKEN));
    const pendTokens = tokens.filter(t => !t.RESPONDIDO_EM && !tksRespondidos.has(t.TOKEN)).length;
    const semCausa = manifestacoes.filter(m => !m.CAUSA && ['EM_TRATAMENTO','ENCERRADA'].includes(String(m.STATUS||'').toUpperCase())).length;
    res.json({
      sucesso: true,
      pendencias: [
        { tipo: 'pesquisa_tokens_sem_resposta', label: 'Pesquisas enviadas sem resposta', total: pendTokens },
        { tipo: 'manifestacoes_sem_causa', label: 'Manifestações encerradas sem causa registrada', total: semCausa },
      ],
      totalPendencias: pendTokens + semCausa,
    });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'importacao-pendencias') }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// FICHAS (/api/fichas) — aliases para rotas de biblioteca existentes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/fichas', (req, res, next) => { req.url = '/api/biblioteca/fichas'; next('route'); });

app.post('/api/fichas/importar', (req, res, next) => { req.url = '/api/biblioteca/importar-ficha'; next('route'); });

// ─────────────────────────────────────────────────────────────────────────────
// RNC — ações adicionais (enviar, aprovar, devolver, encerrar)
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/rnc/:id/enviar', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const rnc = (await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if (!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if (!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const { analise, causas, acoes } = req.body || {};
    const agora = new Date().toISOString();
    await atualizarPorID('BANCO_RNC', req.params.id, {
      STATUS: 'RCA_ENVIADA', DATA_ENVIO_RCA: agora, ANALISE_RCA: analise||'',
      CAUSA: causas||rnc.CAUSA||'', ACAO_CORRETIVA: acoes||'',
      ANALISTA_RCA: req.user?.usuario||'', ULTIMA_ALTERACAO_DATA: agora,
    }, ['ID_RNC','ID']);
    const idEvt = await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvt,ID_RNC:req.params.id,TIPO_EVENTO:'RCA_ENVIADA',USUARIO:req.user?.usuario||'',DATA_EVENTO:agora,DETALHES:'Análise de causa raiz enviada para aprovação'});
    await registrarAuditoria(req.user?.usuario||'sistema','ENVIOU_RCA',req.params.id,'BANCO_RNC',rnc.STATUS,{});
    res.json({sucesso:true,id:req.params.id,status:'RCA_ENVIADA'});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-enviar')});}
});

app.post('/api/rnc/:id/aprovar', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try {
    const rnc = (await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if (!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if (!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const { observacoes } = req.body || {};
    const agora = new Date().toISOString();
    await atualizarPorID('BANCO_RNC', req.params.id, {
      STATUS: 'APROVADA', APROVADOR_DECISAO: req.user?.usuario||'', DATA_DECISAO: agora, OBSERVACOES_APROVACAO: observacoes||'',
    }, ['ID_RNC','ID']);
    const idEvt = await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvt,ID_RNC:req.params.id,TIPO_EVENTO:'APROVADA',USUARIO:req.user?.usuario||'',DATA_EVENTO:agora,DETALHES:observacoes||'Análise aprovada'});
    await registrarAuditoria(req.user?.usuario||'sistema','APROVOU_RCA',req.params.id,'BANCO_RNC',rnc.STATUS,{});
    res.json({sucesso:true,id:req.params.id,status:'APROVADA'});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-aprovar')});}
});

app.post('/api/rnc/:id/devolver', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try {
    const rnc = (await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if (!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if (!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const { motivo } = req.body || {};
    if (!motivo||!String(motivo).trim()) return res.status(400).json({sucesso:false,erro:'Motivo da devolução é obrigatório.'});
    const agora = new Date().toISOString();
    await atualizarPorID('BANCO_RNC', req.params.id, {
      STATUS: 'DEVOLVIDA', APROVADOR_DECISAO: req.user?.usuario||'', DATA_DECISAO: agora, OBSERVACOES_APROVACAO: motivo,
    }, ['ID_RNC','ID']);
    const idEvt = await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvt,ID_RNC:req.params.id,TIPO_EVENTO:'DEVOLVIDA',USUARIO:req.user?.usuario||'',DATA_EVENTO:agora,DETALHES:motivo});
    await registrarAuditoria(req.user?.usuario||'sistema','DEVOLVEU_RCA',req.params.id,'BANCO_RNC',rnc.STATUS,{motivo});
    res.json({sucesso:true,id:req.params.id,status:'DEVOLVIDA'});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-devolver')});}
});

app.post('/api/rnc/:id/encerrar', requerPerfil('APROVADOR','MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const rnc = (await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if (!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if (!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const { verificacaoEficacia, resultado, observacoes } = req.body || {};
    const agora = new Date().toISOString();
    await atualizarPorID('BANCO_RNC', req.params.id, {
      STATUS: 'ENCERRADA', DATA_ENCERRAMENTO: agora, RESPONSAVEL_EFICACIA: req.user?.usuario||'',
      DATA_EFICACIA: agora, RESULTADO_EFICACIA: resultado||verificacaoEficacia||'', OBSERVACOES_APROVACAO: observacoes||'',
    }, ['ID_RNC','ID']);
    const idEvt = await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvt,ID_RNC:req.params.id,TIPO_EVENTO:'ENCERRADA',USUARIO:req.user?.usuario||'',DATA_EVENTO:agora,DETALHES:observacoes||'RNC encerrada com verificação de eficácia'});
    await registrarAuditoria(req.user?.usuario||'sistema','ENCERROU_RNC',req.params.id,'BANCO_RNC',rnc.STATUS,{});
    res.json({sucesso:true,id:req.params.id,status:'ENCERRADA'});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-encerrar')});}
});

app.patch('/api/rnc/:id', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const rnc = (await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if (!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if (!pertenceEmpresa(req.user?.empresa, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const b = req.body || {};
    const campos = ['STATUS','CAUSA','NAO_CONFORMIDADE','SETOR','RESPONSAVEL','PRIORIDADE','PRAZO',
      'ACAO_CONTENCAO','ACAO_CORRETIVA','RESPONSAVEL_ACAO','PRAZO_ACAO','ANALISE_CAUSA_RAIZ',
      'PORQUE1','PORQUE2','PORQUE3','PORQUE4','PORQUE5','CAUSA_RAIZ','ANALISE_RCA'];
    const dados = {};
    for(const c of campos){if(b[c]!==undefined)dados[c]=b[c];}
    dados.ULTIMA_ALTERACAO_POR = req.user?.usuario||'';
    dados.ULTIMA_ALTERACAO_DATA = new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,dados,['ID_RNC','ID']);
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'rnc-patch')});}
});

// ═════════════════════════════════════════════════════════════════════════════
// CENTRAL DE ALIMENTAÇÃO INTELIGENTE
// ═════════════════════════════════════════════════════════════════════════════

// Mapa de destinos possíveis por tipo identificado
const DESTINOS_ALIMENTACAO = {
  'MANIFESTACAO':    { label:'Banco de Casos', aba:'MANIFESTACOES',      modulos:['banco-manifestacoes','similares'] },
  'HISTORICO':       { label:'Banco de Casos', aba:'BANCO_HISTORICO',    modulos:['banco-manifestacoes','similares'] },
  'PROCEDIMENTO':    { label:'Procedimentos',  aba:'PROCEDIMENTOS',      modulos:['cerebro','setor-responsavel'] },
  'POLITICA':        { label:'Políticas',      aba:'POLITICAS',          modulos:['cerebro'] },
  'CAUSA':           { label:'Causas/Subcausas',aba:'CAUSAS',            modulos:['nova-manifestacao','matriz','relatorios'] },
  'MATRIZ':          { label:'Matriz de Tratamento', aba:'MATRIZ_TRATAMENTO', modulos:['cerebro','analise-ia'] },
  'CONHECIMENTO':    { label:'Cérebro',        aba:'BASE_CONHECIMENTO',  modulos:['cerebro','analise-ia'] },
  'SETOR':           { label:'Setores',        aba:'CONFIG_SETORES',     modulos:['nova-manifestacao','sla','encaminhamento'] },
  'CLIENTE':         { label:'Clientes',       aba:'CLIENTES',           modulos:['nova-manifestacao','pesquisa','reincidencia'] },
  'PRODUTO':         { label:'Produtos',       aba:'PRODUTOS',           modulos:['nova-manifestacao'] },
  'REPRESENTANTE':   { label:'Representantes', aba:'REPRESENTANTES',     modulos:['representantes','nova-manifestacao'] },
  'RNC':             { label:'RNC',            aba:'BANCO_RNC',          modulos:['banco-rnc'] },
  'PESQUISA':        { label:'Pesquisa de Satisfação', aba:'PESQUISA_RESPOSTAS', modulos:['relatorio-satisfacao'] },
  'DESCONHECIDO':    { label:'Pendência',      aba:null,                 modulos:[] },
};

// Etapa 1 → Etapa 3: analisar conteúdo com IA e sugerir destinos
app.post('/api/alimentacao/analisar', requerPerfil('MASTER','GESTOR SAC'), async (req,res)=>{
  try {
    const { nome, conteudo, tipo_arquivo } = req.body || {};
    if (!conteudo) return res.status(400).json({sucesso:false,erro:'Conteúdo não fornecido.'});

    const aiSvc = (() => { try { return require('./services/aiService'); } catch { return null; } })();
    if (!aiSvc) return res.status(500).json({sucesso:false,erro:'Serviço de IA não disponível.'});

    const prompt = `Você é um classificador de dados para um sistema SAC empresarial.
Analise o conteúdo abaixo (arquivo: "${nome||'sem nome'}", tipo: "${tipo_arquivo||'texto'}") e identifique:
1. Quais TIPOS de informação estão presentes (pode haver mais de um).
2. Para cada tipo, qual o DESTINO correto no sistema.
3. Quantos registros aproximados de cada tipo.
4. Confiança de 0-100%.
5. Se há duplicatas, inconsistências ou conflitos potenciais.

TIPOS POSSÍVEIS: MANIFESTACAO, HISTORICO, PROCEDIMENTO, POLITICA, CAUSA, MATRIZ, CONHECIMENTO, SETOR, CLIENTE, PRODUTO, REPRESENTANTE, RNC, PESQUISA, DESCONHECIDO.

6. EXTRAIA os registros reais de cada tipo (uma linha/objeto por registro), com os campos que você conseguir identificar.

Responda SOMENTE em JSON válido, no formato:
{
  "resumo": "frase curta do que foi encontrado",
  "itens": [
    {
      "tipo": "TIPO",
      "descricao": "o que foi identificado",
      "quantidade_estimada": N,
      "confianca": 0-100,
      "destino_label": "nome amigável do destino",
      "campos_identificados": ["campo1","campo2"],
      "registros": [ { "CAMPO": "valor", "...": "..." } ],
      "alertas": ["alerta opcional"]
    }
  ],
  "pendencias": ["item não classificado com certeza"],
  "conflitos_potenciais": ["conflito detectado"]
}
Em "registros", devolva os dados efetivos extraídos do conteúdo (não invente). Para MANIFESTACAO use campos como EMPRESA_RECLAMANTE, EMPRESA_RECLAMADA, CONTATO, PRODUTO, DESCRICAO, TIPO, DATA_ABERTURA quando houver.

CONTEÚDO:
${String(conteudo).slice(0,8000)}`;

    let resultado;
    try {
      const resposta = await aiSvc.chamarIA(prompt, {max_tokens:1500,temperature:0.2});
      const texto = resposta?.content?.[0]?.text || resposta?.choices?.[0]?.message?.content || String(resposta||'{}');
      const jsonMatch = texto.match(/\{[\s\S]*\}/);
      resultado = jsonMatch ? JSON.parse(jsonMatch[0]) : {resumo:'Não foi possível classificar.',itens:[],pendencias:[],conflitos_potenciais:[]};
    } catch(parseErr) {
      resultado = {resumo:'Análise parcial.',itens:[{tipo:'DESCONHECIDO',descricao:'Conteúdo não classificado automaticamente',quantidade_estimada:1,confianca:0,destino_label:'Pendência',campos_identificados:[],alertas:['Revisar manualmente']}],pendencias:[nome||'arquivo'],conflitos_potenciais:[]};
    }

    // Enriquecer cada item com info de destino
    const itensEnriquecidos = (resultado.itens||[]).map(item=>{
      const dest = DESTINOS_ALIMENTACAO[item.tipo] || DESTINOS_ALIMENTACAO['DESCONHECIDO'];
      return { ...item, registros: Array.isArray(item.registros) ? item.registros : [], aba_destino: dest.aba, modulos_afetados: dest.modulos, destino_label: item.destino_label || dest.label };
    });

    res.json({sucesso:true, nome, resumo:resultado.resumo, itens:itensEnriquecidos, pendencias:resultado.pendencias||[], conflitos_potenciais:resultado.conflitos_potenciais||[]});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e,'alimentacao-analisar')}); }
});

// Etapa 7: confirmar e distribuir
app.post('/api/alimentacao/confirmar', requerPerfil('MASTER','GESTOR SAC'), async (req,res)=>{
  try {
    const { lote_nome, itens_confirmados, usuario } = req.body || {};
    if (!Array.isArray(itens_confirmados) || !itens_confirmados.length)
      return res.status(400).json({sucesso:false,erro:'Nenhum item confirmado.'});

    const agora = new Date().toISOString();
    const loteId = `IMP-${Date.now().toString(36).toUpperCase()}`;
    const resultados = [];
    const erros = [];

    for (const item of itens_confirmados) {
      const { tipo, registros, aba_destino } = item;
      if (!aba_destino || !Array.isArray(registros) || !registros.length) {
        erros.push({tipo, motivo:'Sem registros ou destino inválido.'});
        continue;
      }
      let publicados = 0;
      for (const reg of registros) {
        try {
          const obj = { ...reg, LOTE_IMPORTACAO: loteId, DATA_IMPORTACAO: agora, IMPORTADO_POR: usuario||req.user?.usuario||'sistema', ORIGEM_ARQUIVO: lote_nome||'' };
          // Defaults para a manifestação importada aparecer nas listagens e respeitar o isolamento por empresa
          if (aba_destino === 'MANIFESTACOES') {
            if (!obj.ID_MANIFESTACAO) obj.ID_MANIFESTACAO = await gerarProximoID('MANIFESTACOES','MAN','ID_MANIFESTACAO');
            if (!obj.DATA_ABERTURA) obj.DATA_ABERTURA = agora;
            if (!obj.DATA_REGISTRO) obj.DATA_REGISTRO = agora;
            if (!obj.STATUS) obj.STATUS = 'ABERTA';
            if (!obj.ORIGEM) obj.ORIGEM = 'ALIMENTACAO';
            if (!obj.USUARIO_CRIACAO) obj.USUARIO_CRIACAO = usuario||req.user?.usuario||'sistema';
            if (!obj.EMPRESA_RECLAMADA && (item.empresa||reg.EMPRESA_RECLAMADA||reg.EMPRESA)) obj.EMPRESA_RECLAMADA = item.empresa||reg.EMPRESA_RECLAMADA||reg.EMPRESA;
          }
          await appendObjeto(aba_destino, obj);
          publicados++;
        } catch(regErr) {
          erros.push({tipo, motivo:regErr.message, registro: JSON.stringify(reg).slice(0,100)});
        }
      }
      resultados.push({tipo, aba_destino, publicados, total:registros.length});
    }

    // Log de auditoria
    await registrarAuditoria(req.user?.usuario||'sistema','ALIMENTACAO_CONFIRMADA',loteId,'CENTRAL_ALIMENTACAO','',{resultados,erros_count:erros.length}).catch(()=>{});

    // Registrar no histórico de alimentação
    await appendObjeto('LOG_SISTEMA', {
      DATA_HORA: agora, USUARIO: req.user?.usuario||'sistema',
      ACAO: 'IMPORTOU_DADOS', ID_MANIFESTACAO: loteId,
      ENTIDADE: `ALIMENTACAO:${itens_confirmados.map(i=>i.tipo).join(',')}`,
      VALOR_ANTERIOR: '', VALOR_NOVO: JSON.stringify({loteId,resultados,arquivo:lote_nome})
    }).catch(()=>{});

    const totalPublicados = resultados.reduce((s,r)=>s+r.publicados,0);
    res.json({sucesso:true, lote_id:loteId, resultados, erros: erros.slice(0,20), total_publicados:totalPublicados, total_erros:erros.length });
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e,'alimentacao-confirmar')}); }
});

// GET pendências de alimentação
app.get('/api/alimentacao/pendencias', requerPerfil('MASTER','GESTOR SAC'), async (req,res)=>{
  try {
    const logs = await lerAba('LOG_SISTEMA',5000).catch(()=>[]);
    const pendencias = logs.filter(l=>(l.ACAO||'').startsWith('ALIMENTACAO_PENDENTE')).slice(-50).reverse();
    res.json({sucesso:true,total:pendencias.length,itens:pendencias});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});

// ═════════════════════════════════════════════════════════════════════════════
// CATCH ALL
// ═════════════════════════════════════════════════════════════════════════════
app.use((req, res) => {
  res.status(404).json({ sucesso:false, erro:`Rota não encontrada: ${req.method} ${req.path}` });
});
app.use((err, req, res, next) => {
  console.error(err);
  const msg = err?.status === 403 || err?.message?.includes('CORS') ? 'Origem não autorizada.' : 'Erro interno do servidor.';
  res.status(err?.status || 500).json({ sucesso:false, erro: msg });
});

// P021: garantir cabeçalhos do LOG_SISTEMA na inicialização
const LOG_SISTEMA_HEADERS = ['DATA_HORA','USUARIO','ACAO','ID_MANIFESTACAO','ENTIDADE','VALOR_ANTERIOR','VALOR_NOVO'];
garantirAbaComCabecalhos('LOG_SISTEMA', LOG_SISTEMA_HEADERS).catch(e => console.error('Aviso: não foi possível garantir cabeçalhos LOG_SISTEMA:', e.message));

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`SAC Chiacchio API v5.6.0 rodando na porta ${PORT}`));
}

module.exports = app;
// Expõe appendLinha apenas em ambiente de teste (SHEETS_MOCK_PATH definido),
// para que testes de unidade do retry possam exercitar a função real sem subir o servidor.
if (process.env.SHEETS_MOCK_PATH) {
  app._appendLinhaForTest = appendLinha;
  app._senhaValidaForTest = senhaValida;
}
