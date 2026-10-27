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
const portalEndereco = require('../server-services/portalEndereco')({ appUrl: APP_URL, publicUrl: process.env.PORTAL_PUBLIC_URL || '' });
const cerebroService = require('../server-services/cerebroServices');
const mcService = require('../server-services/matrizConhecimentoService');
const documentService = require('../server-services/documentService');
const aiService = require('../server-services/aiService');
const { tratativaEngine, devolutivaEngine, assertividade: assertividadeService } = cerebroService;
const permissoesService = require('../server-services/permissoesService');
const dashboardExecutiva = require('../server-services/dashboardExecutiva');
const fichaUnica = require('../server-services/fichaUnica');
const circaEngine = require('../server-services/circaEngine');
const circaWorkflow = require('../server-services/circaWorkflow');

// Injeção de mock Sheets para testes — nunca ativo em produção (env var não existe em prod)
const _sheetsMock = process.env.SHEETS_MOCK_PATH ? (() => { try { return require(process.env.SHEETS_MOCK_PATH); } catch(e) { console.warn('[MOCK] falhou ao carregar:', e.message); return null; } })() : null;
// Flag de leitura PG: padrão false = leituras sempre do Sheets
// PG ativo por padrão. Desativar com PG_LEITURA_ATIVA=false nas variáveis do Vercel se necessário.
const PG_LEITURA_ATIVA = String(process.env.PG_LEITURA_ATIVA || 'true').toLowerCase() === 'true';

// Repositórios PostgreSQL — carregados mas desativados enquanto PG_LEITURA_ATIVA=false
// Isso garante que todos os dados sejam lidos/gravados exclusivamente no Sheets,
// eliminando bugs de dessincronização entre os dois storages.
async function _seedPerfisSeNecessario() {
  try {
    const prisma = require('../database/connection');
    const PERFIS_SEED = [
      { codigo: 'MASTER',              nome: 'Master' },
      { codigo: 'GESTOR SAC',          nome: 'Gestor SAC' },
      { codigo: 'ANALISTA SAC',        nome: 'Analista SAC' },
      { codigo: 'ATENDENTE SAC',       nome: 'Atendente SAC' },
      { codigo: 'APROVADOR',           nome: 'Aprovador' },
      { codigo: 'APROVADOR MASTER',    nome: 'Aprovador Master' },
      { codigo: 'SETOR RESPONSÁVEL',   nome: 'Setor Responsável' },
      { codigo: 'ESPECIALISTA',        nome: 'Especialista' },
      { codigo: 'RCA / REPRESENTANTE', nome: 'RCA / Representante' },
      { codigo: 'DIRETOR',             nome: 'Diretor' },
      { codigo: 'VISUALIZADOR',        nome: 'Visualizador' },
      { codigo: 'AUDITOR',             nome: 'Auditor' },
    ];
    for (const p of PERFIS_SEED) {
      await prisma.perfil.upsert({
        where: { codigo: p.codigo },
        update: {},
        create: { codigo: p.codigo, nome: p.nome },
      });
    }
    console.info('[PG] Perfis verificados/criados.');

    // Sincroniza perfis dos usuários PG a partir do Sheets (migração única e idempotente)
    // Se o usuário PG tem perfil genérico (ex: USUARIO_DE_SETOR), mas o Sheets diz MASTER,
    // atualiza o perfilId no PG para refletir o perfil real.
    try {
      const sheetRows = await lerAba('USUARIOS', 500).catch(() => []);
      if (!sheetRows.length) return;
      const pgUsers = await prisma.usuario.findMany({ include: { perfil: true } });
      for (const pgU of pgUsers) {
        const sheetU = sheetRows.find(r => {
          const e = (r.EMAIL||'').toLowerCase().trim();
          return e && e === (pgU.email||'').toLowerCase().trim();
        });
        if (!sheetU?.PERFIL) continue;
        const sheetPerfil = perfilCanonico(sheetU.PERFIL);
        const pgPerfil = perfilCanonico(pgU.perfil?.codigo || '');
        if (sheetPerfil === pgPerfil) continue;
        // Perfil diverge: atualiza PG com o perfil do Sheets
        const novoPerfil = await prisma.perfil.findFirst({ where: { codigo: sheetPerfil } });
        if (!novoPerfil) continue;
        await prisma.usuario.update({ where: { id: pgU.id }, data: { perfilId: novoPerfil.id } });
        console.info(`[PG] Sincronizado perfil de ${pgU.email}: ${pgPerfil} → ${sheetPerfil}`);
      }
    } catch(e2) {
      console.warn('[PG] sync perfis Sheets→PG:', e2.message);
    }
  } catch(e) {
    console.warn('[PG] _seedPerfisSeNecessario:', e.message);
  }
}

let usuarioRepo = null, manifestacaoRepo = null, rncRepo = null, empresaRepo = null, conhecimentoRepo = null, pesquisaRepo = null, solicitacaoRepo = null;
if (PG_LEITURA_ATIVA && process.env.DATABASE_URL && process.env.NODE_ENV !== 'test') {
  try {
    usuarioRepo = require('../database/repositories/usuarioRepository');
    manifestacaoRepo = require('../database/repositories/manifestacaoRepository');
    rncRepo = require('../database/repositories/rncRepository');
    empresaRepo = require('../database/repositories/empresaRepository');
    conhecimentoRepo = require('../database/repositories/conhecimentoRepository');
    pesquisaRepo = require('../database/repositories/pesquisaRepository');
    solicitacaoRepo = require('../database/repositories/solicitacaoRepository');
    console.info('[PG] Repositórios carregados — leituras via PostgreSQL ativas.');
    // Garante que os registros básicos de Perfil existam no banco
    _seedPerfisSeNecessario().catch(e => console.warn('[PG] seed perfis falhou:', e.message));
  } catch (e) {
    console.warn('[PG] Repositórios não disponíveis, usando Sheets:', e.message);
  }
} else {
  console.info('[PG] PG_LEITURA_ATIVA=false — todas as operações via Google Sheets.');
}

// F8: leituras de pesquisa/relatório — Postgres primeiro, Sheets como fallback
async function lerRespostasPesquisa() {
  const [pgData, sheetsData] = await Promise.all([
    pesquisaRepo ? pesquisaRepo.listarRespostas({}).catch(e => { console.warn('[F8] respostas PG falhou:', e.message); return []; }) : Promise.resolve([]),
    Promise.race([
      lerAba('PESQUISA_RESPOSTAS').then(rows => rows.filter(r => r.STATUS_REGISTRO !== 'RESERVADA')),
      new Promise((_, rej) => setTimeout(() => rej(new Error('sheets timeout')), 12000)),
    ]).catch(() => []),
  ]);
  // Merge: Sheets é fonte de verdade (dados importados manualmente aparecem); PG complementa
  if (!sheetsData.length) return pgData;
  if (!pgData.length) return sheetsData;
  const merged = [...pgData];
  const byId = new Map(merged.map((r, i) => [r.ID_RESPOSTA || r.id, i]).filter(([id]) => id));
  for (const row of sheetsData) {
    if (row.ID_RESPOSTA && byId.has(row.ID_RESPOSTA)) {
      const i = byId.get(row.ID_RESPOSTA);
      merged[i] = { ...merged[i], ...row }; // Sheets preserva versão e respostas completas.
    } else { if (row.ID_RESPOSTA) byId.set(row.ID_RESPOSTA, merged.length); merged.push(row); }
  }
  return merged;
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
// Para mais de uma empresa retorna uma lista de ids; undefined é escopo global
// e -1 significa que nenhum escopo informado corresponde a uma empresa válida.
async function resolverEmpresaIdScope(valor) {
  if (!empresaRepo || !valor) return undefined;
  const codigos = empresasCanonicas(valor);
  // Empresa que resolve para MASTER = acesso global → sem filtro de empresa no PG
  if (codigos.includes('MASTER')) return undefined;
  if (!codigos.length) return -1;
  try {
    const todas = await empresaRepo.findAll().catch(() => []);
    const ids = [];
    for (const codigo of codigos) {
      const byCod = await empresaRepo.findByCodigo(String(codigo)).catch(() => null);
      const e = byCod || todas.find(x => empresaCanonica(x.codigo || x.nome || '') === codigo);
      if (e?.id) ids.push(e.id);
    }
    const unicos = [...new Set(ids)];
    if (!unicos.length) return -1;
    return unicos.length === 1 ? unicos[0] : unicos;
  } catch { return -1; }
}

const app = express();
// RNC permanece preservado para reativação futura, mas está fora da operação
// até que o setor responsável forneça as regras oficiais.
const RNC_ENABLED = String(process.env.RNC_ENABLED || 'false').toLowerCase() === 'true';
function rncFeatureGuard(req, res, next) {
  if (RNC_ENABLED) return next();
  return res.status(503).json({ sucesso: false, codigo: 'RNC_DESATIVADO', erro: 'O módulo RNC está temporariamente indisponível.' });
}
const ALLOWED_ORIGINS = [
  'https://assistente-sac-gpchiacchio.vercel.app',
  new URL(portalEndereco.root).origin,
  'https://assistente-sac-gpchiacchio-grudfk40c-luiza4.vercel.app',
];
const _ORIGIN_RE = /^https:\/\/assistente-sac-gpchiacchio[a-z0-9-]*\.vercel\.app$/;
const corsOptions = { origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin) || _ORIGIN_RE.test(origin)) cb(null, true);
  else cb(null, false);
}, credentials: true };
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
// Preserve the exact request bytes for signed Meta webhook callbacks.  Normal
// JSON APIs continue to receive the parsed body as before.
app.use(express.json({
  limit: '25mb',
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); },
}));
// Bloqueia toda a superfície operacional RNC sem apagar rotas, dados ou código.
app.use(['/api/rnc', '/api/rnc-metricas'], rncFeatureGuard);

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
  let creds;
  try { creds = JSON.parse(raw); } catch (_) { throw new Error('GOOGLE_CREDENTIALS inválida: JSON malformado.'); }
  if (!creds || typeof creds !== 'object') throw new Error('GOOGLE_CREDENTIALS inválida: objeto ausente.');
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
try { ({ gerarFichaPDF } = require('../server-services/pdfFicha')); } catch(e) { console.warn('[PDF] pdfFicha não disponível:', e.message); }
let gerarPdfRelatorioSatisfacao;
try { ({ gerarPdfRelatorioSatisfacao } = require('../server-services/pdfRelatorioSatisfacao')); } catch(e) { console.warn('[PDF] pdfRelatorioSatisfacao não disponível:', e.message); }

// Google Drive upload (usa mesma service account com scope drive.file)
async function uploadArquivoDrive(nome, mimeType, bufferOuBase64, opcoes = {}) {
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
  if (opcoes.publico !== false) {
    try {
      await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
    } catch (permErr) {
      console.warn('[DRIVE] Não foi possível tornar o arquivo público:', permErr.message);
    }
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

// O cadastro administrativo permite uma ou mais empresas por pessoa.  A
// planilha legada armazena esse escopo em uma única coluna, separado por
// vírgula.  Centralizar a leitura aqui evita que "Chiacchio, Plaschio" seja
// interpretado como uma empresa inexistente e bloqueie a sessão.
function empresasCanonicas(valor) {
  let itens = valor;
  if (typeof itens === 'string') {
    const texto = itens.trim();
    if (texto.startsWith('[')) {
      try { itens = JSON.parse(texto); } catch (_) { itens = texto; }
    }
  }
  if (!Array.isArray(itens)) itens = String(itens || '').split(/[,;|]/);
  return [...new Set(itens.map(empresaCanonica).filter(Boolean))];
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
  let pgMapped = [];
  let _pgErro = null, _pgCount = 0, _sheetsCount = 0, _sheetsErro = null;
  if (usuarioRepo) {
    try {
      const pgUsers = await usuarioRepo.findAll({ ativo: undefined });
      _pgCount = pgUsers ? pgUsers.length : 0;
      if (pgUsers && pgUsers.length > 0) {
        pgMapped = pgUsers.map(u => ({
          ID_USUARIO: u.idOriginal || `USR-PG-${u.id}`,
          USUARIO: u.login || u.email,
          EMAIL: u.email || '',
          NOME: u.nome || u.login,
          PERFIL: u.perfil?.codigo || u.perfil?.nome || 'ANALISTA SAC',
          EMPRESA: u.empresa?.nome || '',
          SETOR: u.setor?.nome || '',
          STATUS: u.ativo === false ? 'INATIVO' : 'ATIVO',
          SENHA_HASH: u.senhaHash || '',
          CODIGO_RCA: u.codigoRca || '',
          ULTIMO_ACESSO: u.ultimoAcesso?.toISOString?.() || '',
          _pgId: u.id,
        }));
      }
    } catch (e) { _pgErro = e.message; console.warn('[F4] carregarUsuarios PG falhou:', e.message); }
  }
  // Lê Sheets sempre para capturar usuários criados via aprovação que ainda não foram gravados no PG
  let rows=[];
  try{ rows=await lerAba('USUARIOS',1000); _sheetsCount = rows.length; }catch(e){ _sheetsErro = e.message; console.warn('USUARIOS não disponível:',e.message); }
  const raw=process.env.USUARIOS_JSON||'{}';
  let envUsers=[];
  try{
    const parsed=JSON.parse(raw);
    envUsers=Object.entries(parsed).map(([usuario,val])=>typeof val==='string'
      ? {ID_USUARIO:usuario,USUARIO:usuario,SENHA:val,NOME:usuario,PERFIL:'ANALISTA SAC',STATUS:'ATIVO'}
      : {ID_USUARIO:usuario,USUARIO:usuario,...val});
  }catch(e){}
  const pgEmails = new Set(pgMapped.map(u => (u.EMAIL||'').toLowerCase()).filter(Boolean));
  const pgIds = new Set(pgMapped.map(u => u.ID_USUARIO).filter(Boolean));
  // Mapa email → dados do Sheets para preservar USUARIO (login) e PRIMEIRO_ACESSO no PG
  const sheetsByEmail = {};
  rows.forEach(r => {
    const e = (r.EMAIL||'').toLowerCase();
    if (e) sheetsByEmail[e] = r;
  });
  // Sobrepõe dados do Sheets nos usuários PG (login, status, permissões customizadas)
  pgMapped = pgMapped.map(u => {
    const e = (u.EMAIL||'').toLowerCase();
    const sh = sheetsByEmail[e];
    if (!sh) return u;
    const overrides = {};
    // Preserva login (username) do Sheets caso PG só tenha o email como USUARIO
    if (sh.USUARIO && sh.USUARIO !== e) overrides.USUARIO = sh.USUARIO;
    // O status administrativo persistido no Sheets deve prevalecer sobre o
    // ativo/inativo legado do PostgreSQL, inclusive para exclusão lógica.
    const statusSheets = String(sh.STATUS || '').trim().toUpperCase();
    if (['ATIVO','PRIMEIRO_ACESSO','INATIVO','BLOQUEADO','EXCLUIDO','EXCLUÍDO'].includes(statusSheets)) {
      overrides.STATUS = statusSheets === 'EXCLUÍDO' ? 'EXCLUIDO' : statusSheets;
    }
    // Permissões customizadas e competências vêm do Sheets (definidas na aprovação)
    if (sh.PERMISSOES_CUSTOM && !u.PERMISSOES_CUSTOM) overrides.PERMISSOES_CUSTOM = sh.PERMISSOES_CUSTOM;
    if (sh.PERMISSOES_GRANTED && !u.PERMISSOES_GRANTED) overrides.PERMISSOES_GRANTED = sh.PERMISSOES_GRANTED;
    if (sh.COMPETENCIAS && !u.COMPETENCIAS) overrides.COMPETENCIAS = sh.COMPETENCIAS;
    // Senha do Sheets como fallback se PG não tiver
    if (sh.SENHA_HASH && !u.SENHA_HASH) overrides.SENHA_HASH = sh.SENHA_HASH;
    // Escopo de empresa/setor vem do Sheets (MASTER atualiza via modal de usuários)
    if (sh.EMPRESA) overrides.EMPRESA = sh.EMPRESA;
    if (sh.SETOR) overrides.SETOR = sh.SETOR;
    return Object.keys(overrides).length ? { ...u, ...overrides } : u;
  });
  // Sheets complementa o PG: usuários que existem só no Sheets (ex: aprovados recentemente) aparecem normalmente
  // Deduplica registros antigos do Sheets priorizando o cadastro mais recente
  // e não excluído. Isso permite recriar um login após sua exclusão lógica.
  const sheetsByLogin = new Map();
  rows.forEach(r => {
    const emailOrUser = String(r.EMAIL || r.USUARIO || '').trim().toLowerCase();
    const id = r.ID_USUARIO;
    if (!emailOrUser || pgIds.has(id) || pgEmails.has(emailOrUser)) return;
    const anterior = sheetsByLogin.get(emailOrUser);
    const status = String(r.STATUS || '').toUpperCase();
    const statusAnterior = String(anterior?.STATUS || '').toUpperCase();
    const ativo = !['EXCLUIDO','EXCLUÍDO'].includes(status);
    const ativoAnterior = !['EXCLUIDO','EXCLUÍDO'].includes(statusAnterior);
    const dataAtual = String(r.DATA_CRIACAO || r.DATA_ULTIMA_ALTERACAO || '');
    const dataAnterior = String(anterior?.DATA_CRIACAO || anterior?.DATA_ULTIMA_ALTERACAO || '');
    if (!anterior || (ativo && !ativoAnterior) || (ativo === ativoAnterior && dataAtual >= dataAnterior)) sheetsByLogin.set(emailOrUser, r);
  });
  const sheetsOnly = [...sheetsByLogin.values()];
  const pgMerged = pgMapped; // PG é a fonte única — perfil/empresa vêm do PG
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'false').toLowerCase()==='true';
  // Dedup envUsers contra PG
  const allKnownEmails = new Set(pgMerged.map(u => (u.EMAIL||'').toLowerCase()).filter(Boolean));
  const allKnownIds = new Set(pgMerged.map(u => u.ID_USUARIO).filter(Boolean));
  const envUsersFiltered = envUsers.filter(u => {
    const eml = (u.EMAIL||u.USUARIO||'').toLowerCase();
    return !allKnownIds.has(u.ID_USUARIO) && !allKnownEmails.has(eml);
  });
  const result = [...pgMerged, ...sheetsOnly, ...envUsersFiltered, ...(demoEnabled?DEMO_USUARIOS:[])];
  result._debug = { temPGRepo: !!usuarioRepo, pgCount: _pgCount, pgErro: _pgErro, sheetsCount: _sheetsCount, sheetsErro: _sheetsErro, envCount: envUsersFiltered.length, envCountRaw: envUsers.length, total: result.length };
  return result;
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
const perfilProfissional = require('./perfil-profissional');
const PERFIL_PROF_HEADERS = ['ID_USUARIO','DADOS_JSON','STATUS','VERSAO','CRIADO_EM','ATUALIZADO_EM','VALIDACAO_ADMIN'];
async function obterPerfilProfissional(idUsuario) {
  const rows = await lerAba('PERFIS_PROFISSIONAIS', 5000).catch(e => {
    if (/not found|não encontrad|Unable to parse range|does not exist/i.test(String(e.message))) return [];
    throw e;
  });
  return rows.find(r => String(r.ID_USUARIO) === String(idUsuario)) || null;
}

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
  'ANALISTA SAC':       ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','cerebro.adicionar_regras','cerebro.adicionar_politicas','cerebro.editar_faq','pesquisas.visualizar','pesquisas.criar','dashboard.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','aprovacoes.devolver'],
  'APROVADOR':          ['manifestacoes.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','pesquisas.visualizar'],
  'APROVADOR MASTER':   ['manifestacoes.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','pesquisas.visualizar','dashboard.visualizar'],
  'ATENDENTE SAC':      ['manifestacoes.visualizar','manifestacoes.abrir','cerebro.visualizar','dashboard.visualizar'],
  'SETOR RESPONSÁVEL':  ['manifestacoes.visualizar','manifestacoes.editar'],
  'ESPECIALISTA':       ['cerebro.visualizar','dashboard.visualizar'],
  'RCA / REPRESENTANTE':['manifestacoes.visualizar','manifestacoes.abrir','rca.visualizar','rca.criar'],
  'DIRETOR':            ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar','dashboard.gerenciar','rca.visualizar'],
  'VISUALIZADOR':       ['manifestacoes.visualizar','dashboard.visualizar','pesquisas.visualizar'],
  'AUDITOR':            ['manifestacoes.visualizar','manifestacoes.gerenciar','dashboard.visualizar','pesquisas.visualizar'],
  // Perfis setoriais — representam colaboradores de setores internos com acesso restrito ao SAC
  'SETOR SAC':          ['manifestacoes.visualizar','manifestacoes.abrir','manifestacoes.editar','manifestacoes.gerenciar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','pesquisas.visualizar','pesquisas.criar','dashboard.visualizar','aprovacoes.visualizar'],
  'SETOR COMERCIAL':    ['manifestacoes.visualizar','manifestacoes.editar','rca.visualizar','rca.criar','dashboard.visualizar'],
  'SETOR LOGISTICA':    ['manifestacoes.visualizar','manifestacoes.editar','cerebro.visualizar','dashboard.visualizar'],
  'SETOR PRODUCAO':     ['manifestacoes.visualizar','manifestacoes.editar','cerebro.visualizar','dashboard.visualizar'],
  'SETOR QUALIDADE':    ['manifestacoes.visualizar','manifestacoes.editar','manifestacoes.aprovar','cerebro.visualizar','cerebro.adicionar_conteudo','cerebro.editar_conteudo','cerebro.adicionar_regras','cerebro.adicionar_politicas','dashboard.visualizar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar'],
  'SETOR FINANCEIRO':   ['manifestacoes.visualizar','manifestacoes.editar','dashboard.visualizar','pesquisas.visualizar'],
  'SETOR TI':           ['manifestacoes.visualizar','cerebro.visualizar','cerebro.gerenciar','dashboard.visualizar','configuracoes.visualizar','configuracoes.editar'],
  'SETOR MARKETING':    ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar'],
  'SETOR DIRETORIA':    ['manifestacoes.visualizar','pesquisas.visualizar','dashboard.visualizar','dashboard.gerenciar','aprovacoes.visualizar','aprovacoes.aprovar','aprovacoes.rejeitar','rca.visualizar','gestao.diretoria.visualizar'],
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
  const empresasUsuario = empresasCanonicas(userEmpresa);
  if (!empresasUsuario.length) return false; // empresa vazia = sem acesso (não é MASTER)
  if (empresasUsuario.includes('MASTER')) return true; // MASTER vê tudo
  const empresasRegistro = empresasCanonicas(registroEmpresa);
  if (!empresasRegistro.length) return false; // empresa desconhecida = invisível para não-MASTER
  return empresasRegistro.some(codigo => empresasUsuario.includes(codigo));
}

// Usa req._empresaScope (definido apenas para não-MASTER pelo middlewareEscopoEmpresa).
// Para perfis globais (MASTER, APROVADOR MASTER) _empresaScope é undefined → sem restrição.
function escopoPermite(req, empresaRegistro) {
  if (!req._empresaScope) return true;
  return pertenceEmpresa(req._empresaScope, empresaRegistro);
}

function middlewareEscopoEmpresa() {
  return (req, res, next) => {
    if (!req.user) return next();
    const perfil = perfilCanonico(req.user.perfil);
    // Perfis com acesso global (sem filtro de empresa)
    if (perfil === 'MASTER' || perfil === 'APROVADOR MASTER') return next();
    const empresa = req.user.empresa || '';
    // Empresa vazia: bloqueia acesso — usuário sem empresa não pode acessar dados isolados por empresa
    if (!empresasCanonicas(empresa).length) return res.status(403).json({ sucesso: false, erro: 'Empresa não definida no perfil. Contacte o administrador.' });
    req._empresaScope = empresa;
    next();
  };
}

// Filtra itens de atendimento pelo escopo de empresa do usuário.
// campoEmpresa: coluna exata do campo de empresa nesta aba (use COLUNA_EMPRESA_ABA).
// Sem empresa no item → invisível para não-MASTER (dado sem dono).
function filtrarPorEmpresa(itens, req, campoEmpresa) {
  if (!req._empresaScope) return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return false;
    return pertenceEmpresa(req._empresaScope, val);
  });
}

// Filtra dados históricos/operacionais legados onde empresa pode estar vazia.
// Sem empresa → dado anterior ao isolamento B2 → visível para todos (global).
// Com empresa preenchida → apenas daquela empresa e MASTER.
function filtrarPorEmpresaHistorico(itens, req, campoEmpresa) {
  if (!req._empresaScope) return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return true; // legado sem empresa = compartilhado
    return pertenceEmpresa(req._empresaScope, val);
  });
}

// Filtra itens de configuração/conhecimento.
// Sem empresa no item → global (visível para todos). Com empresa → apenas daquela empresa e MASTER.
function filtrarPorEmpresaConfig(itens, req, campoEmpresa = 'EMPRESA') {
  if (!req._empresaScope) return itens;
  return itens.filter(item => {
    const val = item[campoEmpresa] || '';
    if (!val) return true; // sem empresa = global
    return pertenceEmpresa(req._empresaScope, val);
  });
}

function middlewareEscopoSetor() {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ sucesso: false, erro: 'Sessão inválida.' });
    if (perfilCanonico(req.user.perfil) === 'MASTER') return next();
    if (!req._empresaScope) return res.status(403).json({ sucesso: false, erro: 'Token sem empresa definida.' });
    const empresasUsuario = empresasCanonicas(req._empresaScope);
    if (empresasUsuario.includes('MASTER')) return next();
    const nome = decodeURIComponent(req.params.setor || '');
    try {
      const rows = await lerAba('CONFIG_SETORES', 500).catch(() => []);
      const setorRow = rows.find(r => normalizarTexto(r.SETOR || r.NOME_SETOR || '') === normalizarTexto(nome));
      if (!setorRow || !(setorRow.EMPRESA || '').trim()) return next(); // setor global ou não encontrado
      if (!pertenceEmpresa(req._empresaScope, setorRow.EMPRESA)) {
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
  // Quando existem registros históricos com o mesmo login (por exemplo, um
  // cadastro excluído e outro recriado), a linha mais recente do Sheets é a
  // credencial administrativa vigente. Isso evita autenticar com o hash antigo
  // que ainda possa existir no PostgreSQL.
  try {
    const sheetRows = await lerAba('USUARIOS', 1000);
    const candidatos = sheetRows.map((row, index) => ({ row, index })).filter(({ row }) => {
      const rowLogin = normalizarTexto(row.USUARIO || row.LOGIN || '');
      const rowEmail = normalizarTexto(row.EMAIL || '');
      const status = normalizarTexto(row.STATUS || 'ATIVO');
      return (rowLogin === alvo || rowEmail === alvo || normalizarTexto(rowEmail.split('@')[0]) === alvo) && !['excluido','inativo','bloqueado'].includes(status) && (row.SENHA_HASH || row.SENHA);
    }).sort((a,b) => b.index - a.index);
    if (candidatos[0]) return candidatos[0].row;
  } catch (_) { /* PG segue como fonte de fallback quando Sheets está indisponível. */ }
  // F4: tenta PostgreSQL primeiro por login ou email
  if (usuarioRepo) {
    try {
      let pgU = await usuarioRepo.findByLogin(login).catch(() => null);
      if (!pgU) pgU = await usuarioRepo.findByEmail(login).catch(() => null);
      const pgPerfil = pgU?.perfil?.codigo || pgU?.perfil?.nome || null;
      if (pgU && normalizarTexto(pgU.status || 'ATIVO') !== 'inativo' && pgPerfil) {
        // A aprovação administrativa grava primeiro no Sheets e pode espelhar
        // no PostgreSQL. Reconcile a linha mais recente do Sheets antes de
        // validar a senha, evitando que um usuário PG legado invalide a senha
        // temporária recém-gerada ou o estado PRIMEIRO_ACESSO.
        let sheetOverride = null;
        try {
          const sheetRows = await lerAba('USUARIOS', 1000);
          const email = String(pgU.email || '').trim().toLowerCase();
          const loginNorm = normalizarTexto(pgU.login || pgU.email || login);
          const idNorm = String(pgU.idOriginal || '').trim().toLowerCase();
          sheetOverride = sheetRows
            .map((row, index) => ({ row, index }))
            .filter(({ row }) => {
              const rowEmail = String(row.EMAIL || '').trim().toLowerCase();
              const rowLogin = normalizarTexto(row.USUARIO || row.LOGIN || '');
              const rowId = String(row.ID_USUARIO || row.ID || '').trim().toLowerCase();
              return (email && rowEmail === email) || (loginNorm && rowLogin === loginNorm) || (idNorm && rowId === idNorm);
            })
            .sort((a, b) => b.index - a.index)[0]?.row || null;
        } catch (_) { /* PostgreSQL continua sendo fallback quando Sheets está indisponível. */ }
        return {
          ID_USUARIO: pgU.idOriginal || `USR-PG-${pgU.id}`,
          USUARIO: sheetOverride?.USUARIO || pgU.login || pgU.email,
          EMAIL: pgU.email || '',
          NOME: pgU.nome || pgU.login,
          PERFIL: pgPerfil,
          EMPRESA: pgU.empresa?.nome || '',
          SETOR: pgU.setor?.nome || '',
          STATUS: pgU.ativo === false ? 'INATIVO' : (sheetOverride?.STATUS || 'ATIVO'),
          SENHA_HASH: sheetOverride?.SENHA_HASH || pgU.senhaHash || '',
          SENHA: sheetOverride?.SENHA_HASH || pgU.senhaHash || '',
          CODIGO_RCA: pgU.codigoRca || '',
          _pgId: pgU.id,
        };
      }
    } catch (e) { console.warn('[F4] carregarUsuarioPorLogin PG falhou:', e.message); }
  }
  // Fallback Sheets + PG mesclado
  const usuarios=await carregarUsuarios();
  const ativo = u => !['inativo','bloqueado','excluido'].includes(normalizarTexto(u.STATUS||'ATIVO'));
  // Quando há múltiplas linhas para o mesmo login (duplicatas na planilha),
  // prioriza: ATIVO com SENHA_HASH > ATIVO sem hash > PRIMEIRO_ACESSO com hash > outros ativos
  const _prioridadeUsuario = u => {
    const st = normalizarTexto(u.STATUS||'ATIVO');
    const temHash = !!(u.SENHA_HASH||'').startsWith('$2');
    if (st === 'ativo' && temHash) return 0;
    if (st === 'ativo') return 1;
    if ((st === 'primeiro_acesso' || st === 'primeiroacesso') && temHash) return 2;
    return 3;
  };
  const _melhorUsuario = (lista) => lista.sort((a,b) => _prioridadeUsuario(a) - _prioridadeUsuario(b))[0];
  // 1) Busca por USUARIO exato
  let u = _melhorUsuario(usuarios.filter(u=>normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO)===alvo && ativo(u)));
  // 2) Se não encontrado, tenta pelo prefixo do email (login sem @dominio)
  if (!u) u = _melhorUsuario(usuarios.filter(u => normalizarTexto((u.EMAIL||'').split('@')[0])===alvo && ativo(u)));
  // 3) Busca direta no PG por prefixo de email (quando Sheets não mesclou USUARIO)
  if (!u && usuarioRepo) {
    try {
      const prisma = require('../database/connection');
      const pgU = await prisma.usuario.findFirst({
        where: { email: { startsWith: alvo + '@', mode: 'insensitive' } },
        include: { perfil: true, empresa: true },
      });
      if (pgU && pgU.ativo !== false) {
        u = { ID_USUARIO: pgU.idOriginal||`USR-PG-${pgU.id}`, USUARIO: alvo, EMAIL: pgU.email,
              NOME: pgU.nome, PERFIL: pgU.perfil?.codigo||'ANALISTA SAC', EMPRESA: pgU.empresa?.nome||'',
              SETOR: pgU.setor?.nome||'', STATUS: pgU.ativo===false?'INATIVO':'ATIVO',
              SENHA_HASH: pgU.senhaHash||'', CODIGO_RCA: pgU.codigoRca||'', _pgId: pgU.id };
      }
    } catch(e) { console.warn('[login] PG email-prefix lookup:', e.message); }
  }
  return u || null;
}

async function registrarAcessoUsuario(usuario){
  // F4: atualiza PostgreSQL se disponível
  try {
    if (usuarioRepo && usuario._pgId && typeof usuarioRepo.registrarAcesso === 'function') {
      usuarioRepo.registrarAcesso(usuario._pgId).catch(() => {});
    }
  } catch(e) { console.warn('[F4] registrarAcesso PG:', e.message); }
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
        // Jitter evita que várias renderizações concorrentes repitam juntas.
        const atraso = espera + Math.floor(Math.random() * Math.max(100, espera * 0.25));
        await new Promise(r => setTimeout(r, atraso));
        espera = Math.min(8000, espera * 2);
        continue;
      }
      throw e;
    }
  }
}

// Cache em memória para leituras do Sheets (60 s TTL) — evita quota exceeded
const _lerAbaCache = new Map();
const _lerAbaInFlight = new Map();
const LER_ABA_TTL_MS = 60_000;
// MANIFESTACOES e USUARIOS são fontes operacionais oficiais. Não mantemos
// cache dessas abas: uma alteração de status, exclusão lógica ou permissão
// precisa ser percebida na próxima consulta, inclusive em outra instância
// serverless, e jamais pode ser mascarada por uma cópia antiga.
const TTL_POR_ABA = { MANIFESTACOES: 0, USUARIOS: 0, PERMISSOES_USUARIO: 0 };

async function lerAba(nomeAba, maxRows) {
  if (_sheetsMock?.lerAba) return _sheetsMock.lerAba(nomeAba, maxRows);
  const cacheKey = `${nomeAba}|${maxRows||''}`;
  const cached = _lerAbaCache.get(cacheKey);
  const ttl = Object.prototype.hasOwnProperty.call(TTL_POR_ABA, nomeAba) ? TTL_POR_ABA[nomeAba] : LER_ABA_TTL_MS;
  if (cached && (Date.now() - cached.ts) < ttl) return cached.data;
  // Deduplica renders/rotas concorrentes que solicitam exatamente a mesma aba.
  // Todas aguardam a mesma leitura e apenas uma chamada chega ao Sheets.
  if (_lerAbaInFlight.has(cacheKey)) return _lerAbaInFlight.get(cacheKey);
  const leitura = (async () => {
  try {
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
  } catch (e) {
    // Em 429/503, uma leitura pública pode continuar usando o último snapshot
    // consistente em memória. Escritas nunca usam este fallback.
    if (cached?.data) {
      console.warn(`[Sheets] ${nomeAba} indisponível (${e.message}); usando snapshot anterior.`);
      return cached.data;
    }
    throw e;
  }
  })();
  _lerAbaInFlight.set(cacheKey, leitura);
  try { return await leitura; }
  finally { if (_lerAbaInFlight.get(cacheKey) === leitura) _lerAbaInFlight.delete(cacheKey); }
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
  const indices = nomeAba === 'USUARIOS'
    ? Array.from({length: Math.max(0, rows.length - 1)}, (_, n) => rows.length - 1 - n)
    : Array.from({length: Math.max(0, rows.length - 1)}, (_, n) => n + 1);
  for (const i of indices) {
    if (idxCandidatos.some(idx => String(rows[i][idx] || '').trim() === idNorm)) { rowIndex=i+1; break; }
  }
  if (rowIndex < 0) return null;
  // Adiciona colunas novas ao cabeçalho se necessário (ex: PERMISSOES_GRANTED ao migrar)
  const novasColunas = Object.keys(dados).filter(k => !headers.includes(k));
  if (novasColunas.length) {
    novasColunas.forEach(k => headers.push(k));
    await sheets.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${nomeAba}!1:1`,
      valueInputOption: 'RAW',
      requestBody: { values: [headers] },
    });
  }
  const valores = [...rows[rowIndex-1]];
  while (valores.length < headers.length) valores.push('');
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

// O ID técnico continua compatível com registros antigos. O protocolo exibido
// ao cliente é imutável e segue a regra de negócio da ficha única.
async function gerarProtocoloFicha(empresa, canal, agora = new Date()) {
  const data = fichaUnica.dataProtocolo(agora);
  const prefixo = fichaUnica.prefixoEmpresa(empresa);
  const codigo = fichaUnica.codigoCanal(canal);
  const base = `${prefixo}-${data}-${codigo}-`;
  const existentes = await lerAba('MANIFESTACOES', 5000).catch(() => []);
  const maior = existentes.reduce((atual, item) => {
    const valor = String(item.PROTOCOLO || '');
    if (!valor.startsWith(base)) return atual;
    const n = Number(valor.slice(base.length));
    return Number.isFinite(n) ? Math.max(atual, n) : atual;
  }, 0);
  return fichaUnica.montarProtocolo({ empresa, canal, data: agora, sequencial: maior + 1 });
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

// Histórico próprio da ficha: é conciso, consultável na Central e não expõe o
// log administrativo completo a quem só pode acompanhar a manifestação.
async function registrarHistoricoManifestacao({ id, protocolo = '', acao, descricao = '', usuario = 'sistema', etapa = '' }) {
  try {
    await garantirAbaComCabecalhos('HISTORICO_MANIFESTACOES', [
      'ID_HISTORICO','ID_MANIFESTACAO','PROTOCOLO','DATA_HORA','USUARIO','ACAO','DESCRICAO','ETAPA'
    ]);
    await appendObjeto('HISTORICO_MANIFESTACOES', {
      ID_HISTORICO:`HMF-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ID_MANIFESTACAO:id, PROTOCOLO:protocolo, DATA_HORA:new Date().toISOString(),
      USUARIO:usuario, ACAO:acao, DESCRICAO:descricao, ETAPA:String(etapa || ''),
    });
  } catch (e) { console.warn('[HISTORICO_MANIFESTACOES]', e.message); }
}

// Filtra itens de teste (prefixo TESTE-GOLIVE) das métricas
function isTeste(item) {
  const campos = ['ID_MANIFESTACAO','ID_RNC','TITULO','NAO_CONFORMIDADE','Motivo da Reclamação','Descrição do Problema'];
  return campos.some(c => String(item[c] || '').toUpperCase().startsWith('TESTE-GOLIVE'));
}

// A existência operacional de uma manifestação é definida exclusivamente pela
// aba MANIFESTACOES. Banco estruturado, históricos e índices podem enriquecer
// a consulta, mas nunca podem ressuscitar um registro ausente ou excluído.
const MANIFESTACOES_SHEETS_SAO_FONTE_OFICIAL = true;
function manifestacaoExcluida(item = {}) {
  return Boolean(item.DELETED_AT || item.DATA_EXCLUSAO) ||
    ['EXCLUIDO', 'EXCLUÍDO', 'DELETADO'].includes(normalizarTexto(item.STATUS_REGISTRO || item.STATUS || ''));
}
function filtrarManifestacoesOperacionais(itens = []) {
  return itens.filter(item => !manifestacaoExcluida(item));
}
async function lerManifestacoesOperacionais(max = 5000) {
  return filtrarManifestacoesOperacionais(await lerAba('MANIFESTACOES', max));
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
    postgresql: 'não verificado',
    sheets: 'não verificado',
  };
  if (manifestacaoRepo) {
    try {
      const count = await manifestacaoRepo.findAll({ limit: 1 }).catch(() => null);
      saude.postgresql = count === null ? 'offline' : count.length === 0 ? 'online_vazio' : 'online_com_dados';
    } catch (e) { saude.postgresql = 'offline'; }
  } else { saude.postgresql = 'repositório_não_carregado'; }
  try {
    const rows = await lerAba('MANIFESTACOES', 2).catch(() => null);
    saude.sheets = rows !== null ? 'acessível' : 'inacessível';
  } catch (e) { saude.sheets = 'erro'; }
  res.json(saude);
});

app.get('/', (req, res) => {
  // O projeto interno mantém sua página de acesso; o portal tem publicação própria.
  res.sendFile(require('path').join(__dirname, '../public/index.html'));
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
  // O cadastro administrativo (Sheets) é a fonte autoritativa do status.
  // Antes o PostgreSQL era consultado primeiro, fazendo usuários excluídos ou
  // inativados na administração continuarem com sessão válida quando o PG
  // ainda os marcava como ativos.
  try {
    const rows = await lerAba('USUARIOS', 1000);
    const alvo = normalizarTexto(login);
    const u = rows.slice().reverse().find(r => {
      const usuario = normalizarTexto(r.USUARIO || r.LOGIN || '');
      const email = normalizarTexto(r.EMAIL || '');
      return usuario === alvo || email === alvo || normalizarTexto(email.split('@')[0]) === alvo;
    });
    if (u) {
      let permissoes_granted = null, permissoes_blocked = null;
      try { if (u.PERMISSOES_GRANTED) permissoes_granted = JSON.parse(u.PERMISSOES_GRANTED); } catch(_) {}
      try { if (u.PERMISSOES_BLOCKED) permissoes_blocked = JSON.parse(u.PERMISSOES_BLOCKED); } catch(_) {}
      // A mesma leitura usada para validar a sessão também reidrata o escopo.
      // Assim, quando o MASTER define a empresa de um usuário, uma sessão já
      // aberta deixa de receber 403 sem depender de logout/login manual.
      const entry = {
        status: String(u.STATUS || 'ATIVO').toUpperCase(), ts: agora,
        permissoes_granted, permissoes_blocked,
        empresa: String(u.EMPRESA || '').trim(), setor: String(u.SETOR || '').trim(),
      };
      _statusCache.set(login, entry);
      return entry;
    }
    // Usuários criados somente no PostgreSQL continuam válidos quando não há
    // espelho administrativo na planilha.
  } catch(e) {
    console.error('[verificarStatusUsuario] Erro ao ler planilha:', e.message || e);
  }
  if (usuarioRepo) {
    try {
      const pgU = await usuarioRepo.findByLogin(login).catch(() => null);
      if (pgU) {
        const entry = {
          status: pgU.ativo === false ? 'INATIVO' : 'ATIVO', ts: agora,
          permissoes_granted: null, permissoes_blocked: null,
          empresa: pgU.empresa?.nome || '', setor: pgU.setor?.nome || '',
        };
        _statusCache.set(login, entry);
        return entry;
      }
    } catch (e) { /* fallback abaixo */ }
  }
  try {
    // Se não encontrado no Sheets/PG mas encontrado antes (cache expirado),
    // mantém o estado conhecido; sem qualquer fonte, nega por segurança.
    const status = cached ? cached.status : 'INATIVO';
    const permissoes_granted = cached?.permissoes_granted ?? null;
    const permissoes_blocked = cached?.permissoes_blocked ?? null;
    const entry = {
      status, ts: agora, permissoes_granted, permissoes_blocked,
      empresa: cached?.empresa || '', setor: cached?.setor || '',
    };
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
    // JWT já foi validado — se Sheets está indisponível e não há cache, não derruba a sessão
    return { status: 'ATIVO', ts: agora, permissoes_granted: null, permissoes_blocked: null, empresa: '', setor: '' };
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
    '/public/pesquisas-ativas',
    '/public/whatsapp',
    '/public/whatsapp/webhook',
    '/pesquisas/resposta-portal',
    '/pesquisas/resposta-publica',
    '/pesquisas/resposta-token',
    '/pesquisa',
  ]);
  const formularioPublico = req.method === 'GET' && /^\/public\/pesquisas(?:\/[A-Za-z0-9_-]+)?$/.test(req.path);
  const consultaProtocoloPublico = (req.method === 'POST' && req.path === '/public/protocolo/consultar') || req.method === 'GET' && /^\/public\/protocolo\/[^/]+\/?$/.test(req.path);
  if(publicPaths.has(req.path) || (req.method === 'POST' && /^\/pesquisas\/resposta\/[A-Za-z0-9_-]+$/.test(req.path)) || formularioPublico || (req.method === 'GET' && /^\/public\/pesquisa-convite\/[A-Za-z0-9_-]+$/.test(req.path)) || consultaProtocoloPublico || req.path.startsWith('/pesquisa/')) return next();
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida ou expirada.'});
  // Item10: verificar se usuário ainda está ativo (detecta desativação pós-login)
  const infoAtual = await verificarStatusUsuario(payload.usuario);
  if (['INATIVO','BLOQUEADO','EXCLUIDO'].includes(String(infoAtual.status || '').toUpperCase())) {
    _statusCache.delete(payload.usuario); // forçar re-verificação na próxima vez
    return res.status(401).json({sucesso:false,erro:'Acesso revogado. Sessão encerrada.'});
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
    // Só substitui quando o registro administrativo possui valor.  Isto
    // mantém compatibilidade com sessões antigas e, ao mesmo tempo, torna a
    // atribuição de empresa efetiva imediatamente.
    empresa: infoAtual.empresa || payload.empresa || '',
    setor: infoAtual.setor || payload.setor || '',
  };
  // Tokens emitidos após a implantação conhecem o estado do perfil. O servidor
  // impede acesso direto à API operacional enquanto o onboarding é obrigatório.
  const masterSemOnboarding = perfilCanonico(payload.perfil) === 'MASTER';
  if (!masterSemOnboarding && payload.perfilProfissionalCompleto === false && ![
    '/auth/me','/auth/refresh','/auth/completar-primeiro-acesso','/meu-perfil'
  ].includes(req.path)) return res.status(428).json({sucesso:false,erro:'Conclua o Meu Perfil para acessar a ferramenta.',codigo:'PERFIL_PENDENTE'});
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

// Retorna apenas endereços públicos; a sessão é exigida pelo middleware acima.
app.get('/api/portal/endereco', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sucesso: true, url: portalEndereco.root, separado: portalEndereco.separado });
});

// ===== AUTH =====
const pesquisaFormularios = require('../server-services/pesquisaFormulariosService')({
  surveyUrl: portalEndereco.survey,
  empresas: () => PORTAL_EMPRESAS, canon: empresaCanonica, role: u => perfilCanonico(u?.perfil||''),
  read: lerAba, append: appendObjeto, ensure: garantirAbaComCabecalhos, update: atualizarPorID,
  invalidate: invalidarCacheAba, audit: registrarAuditoria, responses: lerRespostasPesquisa,
  limite: () => Number(process.env.PESQUISA_NOTA_CRITICA || 6),
  sync: async row => { if (pesquisaRepo) await pesquisaRepo.criarResposta(row).catch(e => console.warn('[PESQUISAS] espelho PG:', e.message)); },
});
require('../server-routes/pesquisas')(app, pesquisaFormularios, {
  requerPermissao, role: u => perfilCanonico(u?.perfil||''), can: usuarioTemPermissao,
  rate: publicRateLimit, read: lerAba, ensure: garantirAbaComCabecalhos, append: appendObjeto,
  invalidate: invalidarCacheAba, appUrl: APP_URL, surveyUrl: portalEndereco.survey,
});

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
    if(statusNorm==='excluido') return res.status(403).json({sucesso:false,erro:'Usuário excluído. Contate o administrador.'});
    const senhaOk = await senhaValida(senha, registro.SENHA_HASH || registro.SENHA);
    if(!senhaOk) return res.status(401).json({sucesso:false,erro:'Usuário ou senha inválidos.'});
    const profissional=await obterPerfilProfissional(pub.id);
    const profissionalCompleto=profissional?.STATUS==='CONCLUIDO';
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
      perfilProfissionalCompleto: profissionalCompleto,
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
      // Fire-and-forget: não bloqueia o login por operações secundárias no Sheets
      registrarAcessoUsuario(registro).catch(e=>console.warn('[LOGIN] registrarAcesso falhou:',e.message));
      registrarAuditoria(pub.usuario,'LOGIN',null,'AUTH',null,{perfil:pub.perfil}).catch(()=>{});
    }
    res.json({ sucesso:true, token:assinarToken(payload), usuario:pub.usuario, usuarioInfo:{...pub, primeiro_acesso: primeroAcesso || undefined, perfilProfissionalCompleto: profissionalCompleto}, modo:isDemo?'DEMO':'PRODUCAO' });
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
        perfilProfissionalCompleto: (await obterPerfilProfissional(pub.id))?.STATUS==='CONCLUIDO',
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
    const { nome, cargo, setor, telefone, senha, confirmacao,
      apelido, ramal, bio, sla_horas, substituto,
      representantes, notif_canais, notif_freq, notif_prio,
      hor_inicio, hor_fim, prazo_resp, cobertura,
      tipos_manifestacao, escopo_obs } = req.body || {};
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
      APELIDO: apelido?.trim() || '',
      CARGO: cargo?.trim() || usuario.CARGO || '',
      SETOR: setor?.trim() || usuario.SETOR || '',
      TELEFONE: telefone?.trim() || '',
      RAMAL: ramal?.trim() || '',
      BIO: bio?.trim() || '',
      SLA_HORAS: sla_horas || 48,
      SUBSTITUTO: substituto?.trim() || '',
      REPRESENTANTES: representantes ? JSON.stringify(representantes) : '',
      NOTIF_CANAIS: notif_canais ? JSON.stringify(notif_canais) : '',
      NOTIF_FREQ: notif_freq || 'imediato',
      NOTIF_PRIO: notif_prio || 'todas',
      HOR_INICIO: hor_inicio || '08:00',
      HOR_FIM: hor_fim || '18:00',
      PRAZO_RESP: prazo_resp || 24,
      COBERTURA: cobertura?.trim() || '',
      TIPOS_MANIFESTACAO: tipos_manifestacao ? JSON.stringify(tipos_manifestacao) : '',
      ESCOPO_OBS: escopo_obs?.trim() || '',
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
      perfilProfissionalCompleto: (await obterPerfilProfissional(pub.id))?.STATUS==='CONCLUIDO',
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

// Perfil profissional vinculado à identidade autenticada. Dados oficiais nunca
// são aceitos do formulário, e a conclusão não altera perfil/permissões.
app.get('/api/meu-perfil', async (req,res) => {
  try {
    const registro=await carregarUsuarioPorLogin(req.user.usuario);
    if(!registro) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    const usuario=usuarioPublico(registro);
    const row=await obterPerfilProfissional(usuario.id);
    res.json({sucesso:true,perfil:perfilProfissional.registroParaPerfil(row,usuario),completo:row?.STATUS==='CONCLUIDO'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});
app.patch('/api/meu-perfil', async (req,res) => {
  try {
    const registro=await carregarUsuarioPorLogin(req.user.usuario);
    if(!registro) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    const master=perfilCanonico(req.user.perfil)==='MASTER';
    const oficial={};
    // Cargo pode ser declarado/atualizado pelo próprio usuário. Os demais
    // campos oficiais só podem ser alterados pelo MASTER.
    if (req.body?.cargoOficial !== undefined) oficial.CARGO=String(req.body.cargoOficial||'').trim().slice(0,200);
    if (master) {
      if (req.body?.nomeOficial !== undefined) oficial.NOME=String(req.body.nomeOficial||'').trim().slice(0,200);
      if (req.body?.empresa !== undefined) oficial.EMPRESA=String(req.body.empresa||'').trim().slice(0,500);
      if (req.body?.setor !== undefined) oficial.SETOR=String(req.body.setor||'').trim().slice(0,500);
      if (req.body?.email !== undefined) oficial.EMAIL=String(req.body.email||'').trim().slice(0,250);
    }
    if (Object.keys(oficial).length) {
      await atualizarPorID('USUARIOS', registro.ID_USUARIO||registro.USUARIO, oficial, ['ID_USUARIO','USUARIO','EMAIL']);
      Object.assign(registro, oficial);
    }
    const usuario=usuarioPublico(registro);
    const dados=perfilProfissional.declaracoes(req.body||{});
    const concluir=req.body?.concluir===true;
    await garantirAbaComCabecalhos('PERFIS_PROFISSIONAIS',PERFIL_PROF_HEADERS);
    const antigo=await obterPerfilProfissional(usuario.id);
    if((concluir || antigo?.STATUS==='CONCLUIDO') && !perfilProfissional.valido(dados)) return res.status(400).json({sucesso:false,erro:'Informe sua função e ao menos uma responsabilidade para concluir.'});
    const agora=new Date().toISOString();
    const obj={ID_USUARIO:usuario.id,DADOS_JSON:JSON.stringify(dados),STATUS:concluir||antigo?.STATUS==='CONCLUIDO'?'CONCLUIDO':'RASCUNHO',VERSAO:Number(antigo?.VERSAO||0)+1,CRIADO_EM:antigo?.CRIADO_EM||agora,ATUALIZADO_EM:agora,VALIDACAO_ADMIN:antigo?.VALIDACAO_ADMIN||'PENDENTE'};
    if(antigo) await atualizarPorID('PERFIS_PROFISSIONAIS',usuario.id,obj,['ID_USUARIO']);
    else await appendObjeto('PERFIS_PROFISSIONAIS',obj);
    await registrarAuditoria(usuario.usuario,antigo?'ATUALIZOU_PERFIL_PROFISSIONAL':'CRIOU_PERFIL_PROFISSIONAL',usuario.id,'PERFIS_PROFISSIONAIS',null,{versao:obj.VERSAO,status:obj.STATUS});
    const token=assinarToken({...req.user,nome:usuario.nome,email:usuario.email,empresa:usuario.empresa,setor:usuario.setor,cargo:usuario.cargo,perfilProfissionalCompleto:obj.STATUS==='CONCLUIDO',iat:Date.now(),exp:Date.now()+SESSION_TTL_MS});
    res.json({sucesso:true,perfil:perfilProfissional.registroParaPerfil(obj,usuario),completo:obj.STATUS==='CONCLUIDO',token});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/perfis/especialistas', requerPerfil(...P_LEITURA,'APROVADOR MASTER'), async(req,res) => {
  try {
    if(perfilCanonico(req.user.perfil)!=='MASTER' && !req.user.empresa) return res.status(403).json({sucesso:false,erro:'Empresa não autorizada.'});
    const usuarios=await carregarUsuarios();
    const rows=await lerAba('PERFIS_PROFISSIONAIS',5000).catch(()=>[]);
    const ids=new Map(usuarios.map(u=>[String(usuarioPublico(u).id),u]));
    const perfis=rows.filter(r=>ids.has(String(r.ID_USUARIO))).map(r=>{
      const u=usuarioPublico(ids.get(String(r.ID_USUARIO)));
      return {...perfilProfissional.registroParaPerfil(r,u),ativo:String(u.status||'ATIVO').toUpperCase()==='ATIVO'};
    });
    const contexto={...req.query,empresa:perfilCanonico(req.user.perfil)==='MASTER'?req.query.empresa||'':req.user.empresa};
    res.json({sucesso:true,itens:perfilProfissional.especialistas(perfis,contexto,10)});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// A Central de Cadastros consulta a identidade existente. O perfil profissional
// é um complemento do mesmo usuário, não um segundo registro de pessoa.
app.get('/api/perfis/colaboradores', requerPerfil(...P_LEITURA,'APROVADOR MASTER'), async(req,res) => {
  try {
    if (perfilCanonico(req.user.perfil)!=='MASTER' && !req.user.empresa) return res.status(403).json({sucesso:false,erro:'Empresa não autorizada.'});
    const usuarios=await carregarUsuarios();
    const rows=await lerAba('PERFIS_PROFISSIONAIS',5000).catch(()=>[]);
    const byId=new Map(rows.map(r=>[String(r.ID_USUARIO),r]));
    const itens=usuarios.map(usuarioPublico).filter(u=>perfilCanonico(req.user.perfil)==='MASTER'||pertenceEmpresa(req.user.empresa,u.empresa)).map(u=>{
      const p=perfilProfissional.registroParaPerfil(byId.get(String(u.id)),u);
      return {idUsuario:p.idUsuario,nome:p.nomeOficial,empresa:p.empresa,setor:p.setor,cargo:p.cargoOficial,perfilAcesso:p.perfilAcesso,descricaoFuncao:p.descricaoFuncao,processos:p.processos,especialidades:p.especialidades,status:p.status,ativo:String(u.status||'ATIVO').toUpperCase()==='ATIVO',atualizadoEm:p.atualizadoEm};
    });
    res.json({sucesso:true,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
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
    const atualizado = await atualizarPorID('USUARIOS', registro.EMAIL || registro.USUARIO, {SENHA: hash, SENHA_HASH: hash}, ['USUARIO','EMAIL']);
    if (!atualizado) return res.status(500).json({sucesso:false, erro:'Não foi possível localizar o cadastro para atualizar a senha.'});
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
    // Sugestão consultiva baseada em competências declaradas; não altera
    // atribuições oficiais nem considera autodeclaração prova de causa-raiz.
    try {
      const usuarios=await carregarUsuarios();
      const rows=await lerAba('PERFIS_PROFISSIONAIS',5000).catch(()=>[]);
      const byId=new Map(usuarios.map(u=>[String(usuarioPublico(u).id),usuarioPublico(u)]));
      const perfis=rows.filter(r=>byId.has(String(r.ID_USUARIO))).map(r=>{
        const u=byId.get(String(r.ID_USUARIO));
        return {...perfilProfissional.registroParaPerfil(r,u),ativo:String(u.status||'ATIVO').toUpperCase()==='ATIVO'};
      });
      const empresa=perfilCanonico(req.user.perfil)==='MASTER'?empresaReclamada:req.user.empresa;
      analise.especialistasSugeridos=perfilProfissional.especialistas(perfis,{empresa,produto,tipo,descricao},5);
      const operador=perfis.find(p=>String(p.idUsuario)===String(req.user.sub));
      analise.contextoOperador={perfilOficial:req.user.perfil,setorOficial:req.user.setor||'',funcaoDeclarada:operador?.descricaoFuncao||''};
    } catch(e) { console.warn('[PERFIL] Sugestões indisponíveis:',e.message); analise.especialistasSugeridos=[]; }
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

app.get('/api/representantes/minhas-manifestacoes', requerPerfil('RCA / REPRESENTANTE'), middlewareEscopoEmpresa(), async (req,res)=>{
  try{
    const rows=await lerManifestacoesOperacionais(5000);
    const key=normalizarTexto(req.user.codigoRCA||req.user.usuario);
    const itens=rows.filter(x=>normalizarTexto(x.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(x.CODIGO_RCA||'')===key);
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.post('/api/representantes/manifestacoes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const b=req.body||{};
    if(!b.clienteId||!b.descricao) return res.status(400).json({sucesso:false,erro:'Cliente e descrição são obrigatórios.'});
    const _pfxRca = empresaCanonica(b.empresaReclamada||req.user.empresa||'');
    const _idPfxRca = _pfxRca === 'PLASCHIO' ? 'PLAS' : _pfxRca === 'TUBAHIA' ? 'TUB' : 'CHI';
    const id=await gerarProximoID('MANIFESTACOES',_idPfxRca,'ID_MANIFESTACAO');
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
    // F6: tenta PostgreSQL primeiro
    if (!MANIFESTACOES_SHEETS_SAO_FONTE_OFICIAL && manifestacaoRepo) {
      try {
        const filtros = {};
        // B2: empresa vem do usuário autenticado, não do frontend
        const _isMasterMf = req.user && ['MASTER','APROVADOR MASTER'].includes(perfilCanonico(req.user.perfil));
        if (_isMasterMf && req.query.empresaId) filtros.empresaId = req.query.empresaId;
        else if (!_isMasterMf && req.user?.empresa) filtros.empresaId = await resolverEmpresaIdScope(req.user.empresa);
        if (req.query.status) filtros.status = req.query.status;
        filtros.take = Math.min(Number(req.query.limite) || 2000, 5000); // antes limitava a 100 (dashboard subestimava)
        const pgData = await manifestacaoRepo.findAll(filtros);
        if (pgData && pgData.length > 0) {
          let itens = pgData.map(m => ({
            ID_MANIFESTACAO: m.protocolo || m.idOriginal || String(m.id),
            DATA_ABERTURA: m.criadaEm?.toISOString?.() || '',
            EMPRESA_RECLAMANTE: m.contato || m.empresaNome || '',
            EMPRESA_RECLAMADA: m.empresa?.nome || m.empresaNome || '',
            DESCRICAO: m.descricao || '',
            STATUS: m.status || '',
            TIPO: m.tipo || '',
            PRODUTO: m.produto || '',
            PRIORIDADE: m.prioridade || '',
            SETOR_SUGERIDO: m.setor?.nome || '',
            USUARIO_CRIACAO: m.criador?.login || m.criador?.email || '',
            _pgId: m.id,
          }));
          if (req.user && perfilCanonico(req.user.perfil) === 'RCA / REPRESENTANTE') {
            const uNorm = normalizarTexto(req.user.usuario);
            itens = itens.filter(r => normalizarTexto(r.USUARIO_CRIACAO) === uNorm);
          }
          return res.json({ sucesso: true, total: itens.length, itens, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F6] GET /manifestacoes PG falhou:', e.message); }
    }
    // Fallback Sheets
    let sheetsErro = null;
    let data = await lerManifestacoesOperacionais(5000).catch(e => { sheetsErro = e?.message; return []; });
    if (sheetsErro) console.warn('[GET /manifestacoes] Sheets falhou:', sheetsErro);
    if (req.user && perfilCanonico(req.user.perfil)==='RCA / REPRESENTANTE') {
      const rca=normalizarTexto(req.user.codigoRCA||req.user.usuario);
      data=data.filter(r=>normalizarTexto(r.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(r.CODIGO_RCA||'')===rca||normalizarTexto(r.RCA||'')===rca);
    }
    // B2: legado sem empresa = global; com empresa = apenas daquela empresa
    data = filtrarPorEmpresaHistorico(data, req, COLUNA_EMPRESA_ABA.MANIFESTACOES);
    if (req.query.status) data = data.filter(item => normalizarTexto(item.STATUS) === normalizarTexto(req.query.status));
    res.json({ sucesso: true, total: data.length, itens: data, fonte: 'sheets', ...(sheetsErro && {aviso: 'Sheets: ' + sheetsErro}) });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e), dados: [] }); }
});

// Rota específica deve preceder /api/manifestacoes/:id para não ser tratada como um identificador.
app.get('/api/manifestacoes-excluidas', requerPerfil('MASTER'), async (req, res) => {
  try {
    const itens = (await lerAba('MANIFESTACOES', 5000)).filter(manifestacaoExcluida);
    res.json({ sucesso:true, total:itens.length, itens });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] }); }
});

app.get('/api/manifestacoes/:id', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    // F6: tenta PostgreSQL primeiro
    if (!MANIFESTACOES_SHEETS_SAO_FONTE_OFICIAL && manifestacaoRepo) {
      try {
        let pg = await manifestacaoRepo.findByProtocolo(req.params.id).catch(() => null);
        if (!pg) pg = await manifestacaoRepo.findByIdOriginal(req.params.id).catch(() => null);
        if (!pg && !isNaN(req.params.id)) pg = await manifestacaoRepo.findById(req.params.id).catch(() => null);
        if (pg) {
          // B2: verificar escopo de empresa no PG path
          if (req._empresaScope) {
            const empPg = pg.empresa?.nome || pg.empresaNome || '';
            if (!pertenceEmpresa(req._empresaScope, empPg || '')) {
              return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para esta manifestação.' });
            }
          }
          const item = {
            ID_MANIFESTACAO: pg.protocolo || pg.idOriginal || String(pg.id),
            DATA_ABERTURA: pg.criadaEm?.toISOString?.() || '',
            EMPRESA_RECLAMANTE: pg.contato || pg.empresaNome || '',
            EMPRESA_RECLAMADA: pg.empresa?.nome || pg.empresaNome || '',
            DESCRICAO: pg.descricao || '',
            STATUS: pg.status || '',
            TIPO: pg.tipo || '',
            PRODUTO: pg.produto || '',
            PRIORIDADE: pg.prioridade || '',
            SETOR_SUGERIDO: pg.setor?.nome || '',
            SETOR_CONFIRMADO: pg.setor?.nome || '',
            RESPONSAVEL: pg.responsavel?.nome || '',
            TRATATIVA_REALIZADA: (pg.tratativas || []).slice(-1)[0]?.textoFinal || '',
            DEVOLUTIVA_FINAL: (pg.devolutivas || []).slice(-1)[0]?.textoFinal || '',
            DEVOLUTIVA_ENVIADA: (pg.devolutivas || []).slice(-1)[0]?.textoFinal || '',
            USUARIO_CRIACAO: pg.criador?.login || pg.criador?.email || '',
            historico: pg.historico || [],
            tratativas: pg.tratativas || [],
            devolutivas: pg.devolutivas || [],
            _pgId: pg.id,
          };
          return res.json({ sucesso: true, manifestacao: item, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F6] GET /manifestacoes/:id PG falhou:', e.message); }
    }
    // Fallback Sheets
    const data = await lerManifestacoesOperacionais(5000).catch(()=>[]);
    const idReq = String(req.params.id || '').trim();
    const item = data.find(r => [r.ID_MANIFESTACAO, r.PROTOCOLO, r.ID, r.ID_ORIGINAL]
      .some(v => String(v || '').trim() === idReq));
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
    const { empresaReclamada, contato, produto, lote, nfe, tipo, canal, cnpj, telefone, email, quantidade, quantidadeDevolvida, quantidadeTotal, houveDevolucao, valor, valorTotalPedido, prejuizoEstimado, usuario, anexos = [], origemDocumento = '', arquivoOrigem = '', rascunho = false } = req.body;
    // Rascunhos podem ser salvos antes de todos os dados do cliente estarem
    // disponíveis. O bloqueio de campos obrigatórios deve acontecer apenas na
    // conclusão da manifestação, não no botão Continuar entre etapas.
    const empresaReclamante = String(req.body?.empresaReclamante || '').trim() || (rascunho ? 'Cliente não informado' : '');
    const descricao = String(req.body?.descricao || '').trim() || (rascunho ? 'Rascunho em preenchimento.' : '');
    if (!empresaReclamante || !descricao) return res.status(400).json({ sucesso:false, erro:'Empresa reclamante e descrição são obrigatórios.' });
    const empNorm = normalizarEmpresa(empresaReclamada);
    // Não bloqueia na criação de colunas — a aba já existe em produção
    // RNC_SINALIZADO: campo novo para indicar que o caso merece revisão de RNC (B6)
    garantirAbaComCabecalhos('MANIFESTACOES',['ID_MANIFESTACAO','PROTOCOLO','DATA_ABERTURA','DATA_REGISTRO','EMPRESA_RECLAMANTE','CONTATO','PRODUTO','LOTE','NFE','DESCRICAO','DESCRICAO_MANIFESTACAO','STATUS','TIPO','TIPO_SUGERIDO','SETOR_SUGERIDO','SETORES_SUGERIDOS','PROCEDIMENTO_SUGERIDO','SLA_HORAS','PRIORIDADE','RNC_SUGERIDO','RNC_SINALIZADO','EMPRESA_RECLAMADA','CANAL','CNPJ','TELEFONE','EMAIL','QUANTIDADE','VALOR','TRATATIVA_SUGERIDA','TRATATIVA_APLICAVEL','TRATATIVA_REALIZADA','STATUS_TRATATIVA','DEVOLUTIVA_SUGERIDA','DEVOLUTIVA_FINAL','DEVOLUTIVA_ENVIADA','ORIGEM_DOCUMENTO','ARQUIVO_ORIGEM','USUARIO_CRIACAO','ORIGEM','TIPO_CONFIRMADO','SETORES_CONFIRMADOS','ID_PROCEDIMENTO_APLICADO','GERA_RNC','DATA_INICIO_TRATATIVA','DATA_CONCLUSAO_TRATATIVA','DATA_DEVOLUTIVA','DATA_CONCLUSAO_MANIFESTACAO','STATUS_FICHA','PROCEDENTE','PROCEDENTE_JUSTIFICATIVA','CAMINHO_TRATATIVA','DATA_ENCAMINHAMENTO','PRAZO_RETORNO_SAC','TRATATIVA_SAC_INTERNA','SETOR_ACIONADO','ESCOPO_ACIONAMENTO','RESP_SETOR_O_QUE','RESP_SETOR_CAUSA','RESP_SETOR_RESOLUCAO','RESP_SETOR_ACAO_PREV','RESP_SETOR_RESPONSAVEL','RESP_SETOR_PRAZO','DATA_RESPOSTA_SETOR','APROV_SETOR_DECISAO','APROV_SETOR_MOTIVO','APROV_SETOR_ORIENTACAO','VALID_SAC_DATA_RETORNO','VALID_SAC_CLIENTE_INFORMADO','VALID_SAC_RESOLVIDA','VALIDACAO_RESULTADO','OBSERVACOES_FINAIS','DATA_VALIDACAO_SAC','RAZAO_SOCIAL','NOME_FANTASIA','CODIGO_CLIENTE','PEDIDO','DATA_PEDIDO','DATA_ENTREGA','VENDEDOR','DATA_RECEBIMENTO','ATENDENTE','CATEGORIA','MOTIVO','GRAVIDADE','UNIDADE_MEDIDA','QUANTIDADE_TOTAL','QUANTIDADE_AFETADA','QUANTIDADE_DEVOLVIDA','QUANTIDADE_PERDIDA','VALOR_UNITARIO','VALOR_TOTAL','PREJUIZO_ESTIMADO','PREJUIZO_CONFIRMADO','ANEXOS','EVIDENCIAS','ORIGEM','ETAPA_ATUAL','MENSAGEM_ETAPA','RESPONSAVEL','PRAZO_TRATATIVA','INVESTIGACAO_O_QUE','INVESTIGACAO_VERIFICACOES','INVESTIGACAO_EVIDENCIAS','INVESTIGACAO_NOTAS','SUBCAUSA','CAUSA_RAIZ_CONFIRMADA','REINCIDENCIA','ACOES_CORRETIVAS','DATA_SOLUCAO','RESPONSAVEL_EXECUCAO','RESUMO_RESOLUCAO','DEVOLUTIVA_CANAL','DEVOLUTIVA_DESTINATARIO','APRENDIZADO_CASO','APRENDIZADO_MATRIZ']).catch(()=>{});
    const _pfxEmp = empresaCanonica(empresaReclamada||'');
    const _pfx = _pfxEmp === 'PLASCHIO' ? 'PLAS' : _pfxEmp === 'TUBAHIA' ? 'TUB' : 'CHI';
    const id = await gerarProximoID('MANIFESTACOES', _pfx, 'ID_MANIFESTACAO');
    const agora = new Date().toISOString();
    const protocolo = rascunho ? '' : await gerarProtocoloFicha(empresaReclamada, canal, agora);
    const tipoFinal = tipo || 'Reclamação';
    const objeto = {
      ID_MANIFESTACAO:id, PROTOCOLO:protocolo, DATA_ABERTURA:agora, DATA_REGISTRO:agora, EMPRESA_RECLAMANTE:empresaReclamante,
      CONTATO:contato||'', PRODUTO:produto||'', LOTE:lote||'', NFE:nfe||'', DESCRICAO:descricao,
      DESCRICAO_MANIFESTACAO:descricao, STATUS:rascunho?'RASCUNHO':'EM ANÁLISE', TIPO:tipoFinal, TIPO_SUGERIDO:'',
      SETOR_SUGERIDO:'', SETORES_SUGERIDOS:'', PROCEDIMENTO_SUGERIDO:'', SLA_HORAS:'', PRIORIDADE:'',
      RNC_SUGERIDO:'NÃO', EMPRESA_RECLAMADA:empNorm||empresaReclamada||'', CANAL:canal||'',
      CNPJ:cnpj||'', TELEFONE:telefone||'', EMAIL:email||'', QUANTIDADE:quantidade||'',
      QUANTIDADE_DEVOLVIDA:String(houveDevolucao||'NÃO').toUpperCase()==='SIM' ? (quantidadeDevolvida||'') : '', QUANTIDADE_TOTAL:quantidadeTotal||'',
      HOUVE_DEVOLUCAO:String(houveDevolucao||'NÃO').toUpperCase()==='SIM' ? 'SIM' : 'NÃO', VALOR:valor||'',
      VALOR_TOTAL_PEDIDO:valorTotalPedido||'', PREJUIZO_ESTIMADO:prejuizoEstimado||'',
      TRATATIVA_SUGERIDA:'', TRATATIVA_APLICAVEL:'', TRATATIVA_REALIZADA:'', STATUS_TRATATIVA:'NÃO INICIADA',
      DEVOLUTIVA_SUGERIDA:'', DEVOLUTIVA_FINAL:'', DEVOLUTIVA_ENVIADA:'',
      ORIGEM_DOCUMENTO:origemDocumento||'', ARQUIVO_ORIGEM:arquivoOrigem||'',
      USUARIO_CRIACAO:usuario||req.user?.usuario||'sistema', ORIGEM:req.body.origem||'SAC',
      STATUS_FICHA:rascunho?'RASCUNHO':(req.body.statusFicha || (String(req.body.origem||'').toUpperCase().includes('PORTAL') ? 'AGUARDANDO_TRIAGEM_SAC' : 'ABERTA')),
      ETAPA_ATUAL:rascunho?'1':'2', MENSAGEM_ETAPA:rascunho?'Rascunho em preenchimento.':'Aguardando triagem SAC.',
      RAZAO_SOCIAL:req.body.razaoSocial||'', NOME_FANTASIA:req.body.nomeFantasia||'', CODIGO_CLIENTE:req.body.codigoCliente||'',
      PEDIDO:req.body.pedido||'', DATA_PEDIDO:req.body.dataPedido||'', DATA_ENTREGA:req.body.dataEntrega||'', VENDEDOR:req.body.vendedor||'',
      DATA_RECEBIMENTO:req.body.dataRecebimento||agora, ATENDENTE:req.body.atendente||req.user?.nome||req.user?.usuario||'',
      CATEGORIA:req.body.categoria||'', MOTIVO:req.body.motivo||'', GRAVIDADE:req.body.gravidade||'',
      UNIDADE_MEDIDA:req.body.unidadeMedida||fichaUnica.unidadeEmpresa(empresaReclamada), QUANTIDADE_AFETADA:req.body.quantidadeAfetada||quantidade||'',
      QUANTIDADE_PERDIDA:req.body.quantidadePerdida||'', VALOR_UNITARIO:req.body.valorUnitario||valor||'',
      VALOR_TOTAL:req.body.valorTotal||valorTotalPedido||'', PREJUIZO_CONFIRMADO:req.body.prejuizoConfirmado||'',
      ANEXOS:Array.isArray(anexos)?JSON.stringify(anexos):(anexos||''), EVIDENCIAS:req.body.evidencias||'',
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
    // Mantém o cadastro comercial mínimo do cliente para formar histórico sem
    // copiar dados que não pertencem à manifestação. A falha deste cadastro
    // nunca bloqueia o registro operacional já criado.
    if (!rascunho && (cnpj || contato || email)) {
      try {
        const clienteHeaders = CADASTRO_CONFIG.clientes.headers;
        await garantirAbaComCabecalhos('CLIENTES_CADASTRO', clienteHeaders);
        const clientes = await lerAba('CLIENTES_CADASTRO', 10000);
        const cnpjNorm = String(cnpj || '').replace(/\D/g, '');
        const contatoNorm = normalizarTexto(contato || email || '');
        const existente = clientes.find(c => {
          const cCnpj = String(c.CNPJ_CPF || '').replace(/\D/g, '');
          const cContato = normalizarTexto(`${c.RAZAO_SOCIAL || ''} ${c.NOME_FANTASIA || ''} ${c.CONTATOS_JSON || ''}`);
          return (cnpjNorm && cCnpj && cCnpj === cnpjNorm) || (!cnpjNorm && contatoNorm && cContato.includes(contatoNorm));
        });
        if (!existente) {
          await appendObjeto('CLIENTES_CADASTRO', {
            ID_CLIENTE: await gerarProximoID('CLIENTES_CADASTRO', 'CLI', 'ID_CLIENTE'),
            CODIGO_INTERNO: cnpjNorm ? `CNPJ-${cnpjNorm}` : `MAN-${id}`,
            RAZAO_SOCIAL: req.body.razaoSocial || contato || email || 'Cliente da manifestação',
            NOME_FANTASIA: req.body.nomeFantasia || '',
            CNPJ_CPF: cnpj || '',
            SEGMENTO: tipoFinal || '',
            CONTATOS_JSON: JSON.stringify({ telefone: telefone || '', email: email || '', origem: id }),
            COMPRADORES_JSON: '', ENDERECO_JSON: '',
            VINCULOS_JSON: JSON.stringify({ empresa: empresaReclamante || empresaReclamada || '', manifestacoes: [id] }),
            ATIVO: 'SIM', DATA_CRIACAO: agora, DATA_ATUALIZACAO: agora,
            USUARIO_ATUALIZACAO: usuario || req.user?.usuario || 'sistema'
          });
        }
      } catch (e) { console.warn('[CLIENTES_CADASTRO] criação automática ignorada:', e.message); }
    }
    // B3: dual-write para PostgreSQL — rastreia sucesso/falha (não-bloqueante)
    if (manifestacaoRepo) {
      manifestacaoRepo.upsertFromSheets({
        ID_MANIFESTACAO: id,
        EMPRESA_RECLAMANTE: empresaReclamante,
        EMPRESA_RECLAMADA: empresaReclamada || '',
        DESCRICAO: descricao,
        STATUS: 'EM ANÁLISE',
        TIPO: tipoFinal,
        PRODUTO: objeto.PRODUTO,
        DATA_ABERTURA: agora,
      }).then(() => {
        console.info('[PG] dual-write manifestação OK:', id);
      }).catch(e => {
        console.error('[PG] dual-write manifestação FALHOU:', id, e.message);
        // Registrar falha de dual-write no audit trail (não bloqueia resposta)
        registrarAuditoria('sistema', 'DUALWRITE_PG_FALHOU', id, 'MANIFESTACOES', null, { erro:erroSeguro(e) }).catch(() => {});
      });
    }
    registrarAuditoria(usuario||'sistema','CRIOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,{empresaReclamante,tipo:tipoFinal}).catch(()=>{});
    registrarHistoricoManifestacao({
      id, protocolo, usuario:usuario||req.user?.usuario||'sistema', etapa:rascunho ? 1 : 2,
      acao:rascunho ? 'SALVOU_RASCUNHO' : 'REGISTROU_MANIFESTACAO',
      descricao:rascunho ? 'Rascunho salvo sem protocolo definitivo.' : 'Manifestação recebida e encaminhada para triagem SAC.'
    });
    // Executar análise de IA — rascunho pula análise (evita timeout Vercel de 60s)
    const decisaoCompleta = req.body.decisaoCompleta;
    let analise = null;
    try {
      // Se o frontend já fez a análise (wizard etapa 4), usa ela diretamente
      const analisePrevia = req.body.analiseIA ? (() => { try { return JSON.parse(req.body.analiseIA); } catch { return null; } })() : null;
      if (analisePrevia && analisePrevia.tipoDetectado) {
        analise = analisePrevia;
      } else if (!rascunho) {
        // Só executa análise de IA no registro definitivo, não em rascunhos
        analise = await executarAnalise({ ...objeto, empresaReclamante, empresaReclamada, descricao, tipo:tipoFinal });
      }
      if (analise && !rascunho) {
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
    res.json({ sucesso:true, id, protocolo, analise, rascunho:!!rascunho, mensagem:rascunho?'Rascunho salvo.':'Manifestação registrada e analisada com sucesso.' });
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
    if (!escopoPermite(req, item.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado para esta manifestação.' });
    }
    const agora = new Date().toISOString();
    let dados = {};
    if (acao === 'salvar_dados') {
      // Lista explícita: não permitir que o navegador sobrescreva protocolo,
      // situação de aprovação ou autoria ao editar a primeira etapa.
      const campos = ['RAZAO_SOCIAL','NOME_FANTASIA','CNPJ','CODIGO_CLIENTE','EMPRESA_RECLAMANTE','CONTATO','TELEFONE','EMAIL','PEDIDO','NFE','DATA_PEDIDO','DATA_ENTREGA','VENDEDOR','ORIGEM','CANAL','DATA_RECEBIMENTO','ATENDENTE','TIPO','CATEGORIA','MOTIVO','DESCRICAO','DESCRICAO_MANIFESTACAO','PRODUTO','LOTE','QUANTIDADE','UNIDADE_MEDIDA','QUANTIDADE_TOTAL','QUANTIDADE_AFETADA','QUANTIDADE_DEVOLVIDA','QUANTIDADE_PERDIDA','VALOR_UNITARIO','VALOR_TOTAL','PREJUIZO_ESTIMADO','PREJUIZO_CONFIRMADO','PRIORIDADE','ANEXOS','EVIDENCIAS'];
      for (const campo of campos) if (Object.prototype.hasOwnProperty.call(req.body, campo)) dados[campo] = req.body[campo];
      if (dados.QUANTIDADE_TOTAL && dados.VALOR_UNITARIO && !dados.VALOR_TOTAL) {
        const total = Number(String(dados.QUANTIDADE_TOTAL).replace(',','.')) * Number(String(dados.VALOR_UNITARIO).replace(',','.'));
        if (Number.isFinite(total)) dados.VALOR_TOTAL = total.toFixed(2);
      }
      dados.DATA_ULTIMA_EDICAO = agora;
    } else if (acao === 'triagem') {
      const setor = req.body.setor || req.body.SETOR_CONFIRMADO || '';
      const assumirSAC = req.body.assumirSAC === true || req.body.caminho === 'SAC';
      dados = {
        CATEGORIA:req.body.categoria ?? item.CATEGORIA ?? '', MOTIVO:req.body.motivo ?? item.MOTIVO ?? '',
        PRIORIDADE:req.body.prioridade ?? item.PRIORIDADE ?? '', GRAVIDADE:req.body.gravidade ?? item.GRAVIDADE ?? '',
        SETOR_CONFIRMADO:setor || item.SETOR_CONFIRMADO || '', RESPONSAVEL_SETOR:req.body.responsavel || item.RESPONSAVEL_SETOR || '',
        PRAZO_TRATATIVA:req.body.prazo || item.PRAZO_TRATATIVA || '', NECESSITA_RNC:req.body.necessitaRNC || '',
        NECESSITA_RCA:req.body.necessitaRCA || '', OBS_ENCAMINHAMENTO:req.body.observacoes || '',
        DATA_TRIAGEM:agora, TRIADO_POR:req.user?.usuario || ''
      };
      if (assumirSAC) Object.assign(dados, { STATUS:'EM TRATAMENTO', STATUS_FICHA:'TRATATIVA_SAC', RESPONSAVEL_SAC:req.user?.nome||req.user?.usuario||'', DATA_ASSUMIDO_SAC:agora });
      else if (setor) Object.assign(dados, { STATUS:'AGUARDANDO_SETOR', STATUS_FICHA:'AGUARDANDO_SETOR', DATA_ENCAMINHAMENTO:agora });
      else return res.status(400).json({ sucesso:false, erro:'Informe o setor responsável ou assuma a tratativa pelo SAC.' });
    } else if (acao === 'salvar_investigacao') {
      const campos = ['INVESTIGACAO_O_QUE','INVESTIGACAO_VERIFICACOES','INVESTIGACAO_EVIDENCIAS','PROCEDENTE','PROCEDENTE_JUSTIFICATIVA','CAUSA_PROVAVEL','CAUSA_RAIZ_CONFIRMADA','EVIDENCIAS_CAUSA','REINCIDENCIA','TRATATIVA_REALIZADA','MEDIDAS_EXECUTADAS','DATA_SOLUCAO','RESPONSAVEL_EXECUCAO','PREJUIZO_CONFIRMADO','ACOES_CORRETIVAS','GERA_RNC','GERA_RCA','ANEXOS'];
      for (const campo of campos) if (Object.prototype.hasOwnProperty.call(req.body, campo)) dados[campo] = req.body[campo];
      dados.STATUS = 'EM TRATAMENTO'; dados.STATUS_FICHA = 'EM_TRATAMENTO'; dados.DATA_ULTIMA_TRATATIVA = agora;
    } else if (acao === 'enviar_validacao') {
      if (!(req.body.TRATATIVA_REALIZADA || item.TRATATIVA_REALIZADA)) return res.status(400).json({ sucesso:false, erro:'Registre a tratativa antes de enviar para validação.' });
      dados = { STATUS:'AGUARDANDO_VALIDACAO_SAC', STATUS_FICHA:'AGUARDANDO_VALIDACAO_SAC', DATA_ENVIO_VALIDACAO:agora, ENVIADO_VALIDACAO_POR:req.user?.usuario||'' };
    } else if (acao === 'salvar_devolutiva') {
      dados = { DEVOLUTIVA_FINAL:req.body.texto || '', CANAL_RETORNO:req.body.canal || item.CANAL_RETORNO || item.CANAL || '', STATUS:'AGUARDANDO_DEVOLUTIVA', STATUS_FICHA:'AGUARDANDO_DEVOLUTIVA', DATA_DEVOLUTIVA_RASCUNHO:agora };
    } else if (acao === 'resposta_setor') {
      dados = {
        RESP_SETOR_O_QUE: req.body.respSetorOQue || '',
        RESP_SETOR_CAUSA: req.body.respSetorCausa || '',
        RESP_SETOR_RESOLUCAO: req.body.respSetorResolucao || '',
        RESP_SETOR_ACAO_PREV: req.body.respSetorAcaoPrev || '',
        RESP_SETOR_RESPONSAVEL: req.body.respSetorResponsavel || '',
        RESP_SETOR_PRAZO: req.body.respSetorPrazo || '',
        DATA_RESPOSTA_SETOR: agora,
        STATUS_FICHA: 'AGUARDANDO_VALIDACAO_SAC',
        STATUS: 'AGUARDANDO_VALIDACAO_SAC',
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
      const setorConf = req.body.SETOR_CONFIRMADO || item.SETOR_SUGERIDO || '';
      const tipoConf  = req.body.TIPO_CONFIRMADO  || item.TIPO_SUGERIDO  || '';
      dados = {
        STATUS: 'AGUARDANDO_APROVAÇÃO',
        STATUS_FICHA: 'AGUARDANDO_APROVACAO',
        TRATATIVA_SAC_INTERNA: req.body.tratativaSACInterna || req.body.obs || item.TRATATIVA_SAC_INTERNA || '',
        SETOR_CONFIRMADO: setorConf,
        TIPO_CONFIRMADO: tipoConf,
        DATA_ENCAMINHAMENTO: agora,
        ENCAMINHADO_POR: req.user?.usuario || '',
      };
      // Inserir na FILA_APROVACAO para aprovadores verem
      try {
        garantirAbaComCabecalhos('FILA_APROVACAO', FILA_APROV_HEADERS).catch(()=>{});
        const filaExist = await lerAba('FILA_APROVACAO',2000).catch(()=>[]);
        const jaPendente = filaExist.find(x => String(x.ID_ENTIDADE||'') === String(id) && x.STATUS === 'PENDENTE');
        if (!jaPendente) {
          // Busca aprovador pelo setor nas tabelas
          const [aprovadores, rel] = await Promise.all([
            lerAba('APROVADORES',500).catch(()=>[]),
            lerAba('APROVADOR_COMPETENCIAS',2000).catch(()=>[]),
          ]);
          const setorN = normalizarTexto(setorConf);
          const relSetor = rel.find(r => normalizarTexto(r.SETOR||r.COMPETENCIA||'') === setorN && normalizarTexto(r.STATUS||'ATIVO') !== 'inativo');
          const aprov = relSetor ? aprovadores.find(a => String(a.ID_APROVADOR||a.USUARIO||'') === String(relSetor.ID_APROVADOR||'')) : null;
          const filaId = await gerarProximoID('FILA_APROVACAO','FAP','ID_FILA');
          await appendObjeto('FILA_APROVACAO', {
            ID_FILA: filaId, ID_ENTIDADE: id, TIPO_ENTIDADE: 'SAC',
            DESCRICAO: item.DESCRICAO || item.DESCRICAO_MANIFESTACAO || '',
            EMPRESA: item.EMPRESA_RECLAMADA || '',
            SETOR: setorConf, COMPETENCIA: setorConf,
            STATUS: 'PENDENTE',
            ID_APROVADOR: aprov?.ID_APROVADOR || aprov?.USUARIO || '',
            NOME_APROVADOR: aprov?.NOME || aprov?.ID_APROVADOR || '',
            DATA_ENVIO: agora, DATA_DECISAO: '',
            OBSERVACOES: req.body.obs || '',
            CRIADO_POR: req.user?.usuario || '',
            ID_REGRA: '',
          });
        }
      } catch(eF) { console.error('[FILA_APROVACAO insert]', eF.message); }
    } else if (acao === 'encaminhar_setor') {
      const setorDest = req.body.SETOR_CONFIRMADO || req.body.setor || '';
      if (!setorDest) return res.status(400).json({ sucesso:false, erro:'Setor de destino obrigatório.' });
      dados = {
        STATUS: 'AGUARDANDO_SETOR',
        STATUS_FICHA: 'AGUARDANDO_SETOR',
        SETOR_CONFIRMADO: setorDest,
        SETOR_DESTINADO: setorDest,
        RESPONSAVEL_SETOR: req.body.RESPONSAVEL_SETOR || '',
        SLA_HORAS: req.body.SLA_HORAS || '',
        SLA_UNIDADE: req.body.SLA_UNIDADE || 'dias',
        OBS_ENCAMINHAMENTO: req.body.obs || '',
        DATA_ENCAMINHAMENTO: agora,
        ENCAMINHADO_POR: req.user?.usuario || '',
      };
    } else if (acao === 'assumir_sac') {
      dados = {
        STATUS: 'EM_ANDAMENTO',
        STATUS_FICHA: 'TRATATIVA_SAC',
        RESPONSAVEL_SAC: req.user?.nome || req.user?.usuario || '',
        OBS_SAC: req.body.obs || '',
        DATA_ASSUMIDO_SAC: agora,
        ASSUMIDO_POR: req.user?.usuario || '',
      };
    } else if (acao === 'devolver_cliente') {
      dados = {
        STATUS: 'EM_ANDAMENTO',
        STATUS_FICHA: 'AGUARDANDO_DEVOLUTIVA',
        MOTIVO_DEVOLUCAO: req.body.MOTIVO_DEVOLUCAO || '',
        CANAL_RETORNO: req.body.CANAL_RETORNO || '',
        PRAZO_RESPOSTA: req.body.PRAZO_RESPOSTA || '',
        DATA_DEVOLUCAO: agora,
        DEVOLVIDO_POR: req.user?.usuario || '',
      };
    } else if (acao === 'rejeitar') {
      const motivo = req.body.MOTIVO_REJEICAO || '';
      if (!motivo) return res.status(400).json({ sucesso:false, erro:'Motivo de rejeição obrigatório.' });
      dados = {
        STATUS: 'ENCERRADA',
        STATUS_FICHA: 'FECHADA',
        RESULTADO_FINAL: 'Rejeitada',
        MOTIVO_REJEICAO: motivo,
        DATA_CONCLUSAO_MANIFESTACAO: agora,
        ENCERRADO_POR: req.user?.usuario || '',
      };
    } else {
      return res.status(400).json({ sucesso:false, erro:'Ação não reconhecida.' });
    }
    const estado = { ...item, ...dados };
    dados.ETAPA_ATUAL = String(fichaUnica.etapaAtual(estado));
    dados.MENSAGEM_ETAPA = fichaUnica.mensagemContextual(estado);
    await atualizarPorID('MANIFESTACOES', id, dados, ['ID_MANIFESTACAO']);
    invalidarCacheAba('MANIFESTACOES');
    registrarAuditoria(req.user?.usuario||'sistema', `FICHA_${String(acao).toUpperCase()}`, id, 'MANIFESTACOES', null, dados).catch(()=>{});
    registrarHistoricoManifestacao({
      id, protocolo:item.PROTOCOLO||'', usuario:req.user?.usuario||'sistema', etapa:dados.ETAPA_ATUAL,
      acao:String(acao).toUpperCase(), descricao:dados.MENSAGEM_ETAPA
    });
    res.json({ sucesso:true, etapaAtual:dados.ETAPA_ATUAL, mensagemEtapa:dados.MENSAGEM_ETAPA });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});


// ============================================================
// CARD DE APROVAÇÃO SAC
// GET  /api/manifestacoes/:id/aprovacao — retorna dados filtrados por perfil
// POST /api/manifestacoes/:id/aprovacao — grava decisão e muda status
// ============================================================

const STATUS_FICHA_LEGIVEL = {
  ABERTA: 'Aberta', EM_ANDAMENTO: 'Em andamento', AGUARDANDO_APROVACAO: 'Aguardando aprovação',
  AGUARDANDO_SETOR: 'Aguardando setor', AGUARDANDO_VALIDACAO_SAC: 'Aguardando validação SAC',
  AGUARDANDO_TRATATIVA: 'Aguardando tratativa',
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
    if (!escopoPermite(req, item.EMPRESA_RECLAMADA)) {
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
    if (!escopoPermite(req, item.EMPRESA_RECLAMADA)) {
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


app.patch('/api/manifestacoes/:id', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const { id } = req.params;
    // B2/Item18: verificar pertencimento de empresa antes de gravar
    const todas = await lerAba('MANIFESTACOES', 5000);
    const itemExistente = todas.find(r => r.ID_MANIFESTACAO === id);
    if (!itemExistente) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, itemExistente.EMPRESA_RECLAMADA)) {
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

app.delete('/api/manifestacoes/:id', requerPerfil('MASTER'), async (req, res) => {
  try {
    const { id } = req.params;
    const todas = await lerAba('MANIFESTACOES', 5000);
    const item = todas.find(r => [r.ID_MANIFESTACAO, r.PROTOCOLO, r.ID].some(v => String(v || '').trim() === String(id).trim()));
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    if (manifestacaoExcluida(item)) return res.status(409).json({ sucesso:false, erro:'A manifestação já está excluída.' });
    const motivo = String(req.body?.motivo || '').trim();
    const protocoloConfirmacao = String(req.body?.protocoloConfirmacao || '').trim();
    const protocolo = String(item.PROTOCOLO || item.ID_MANIFESTACAO || id).trim();
    if (!motivo) return res.status(400).json({ sucesso:false, erro:'Informe o motivo obrigatório da exclusão.' });
    if (!protocoloConfirmacao || protocoloConfirmacao !== protocolo) return res.status(400).json({ sucesso:false, erro:'Confirme o protocolo exato para excluir a manifestação.' });
    const agora = new Date().toISOString();
    await atualizarPorID('MANIFESTACOES', item.ID_MANIFESTACAO || item.PROTOCOLO || id, {
      STATUS_REGISTRO:'EXCLUIDO', STATUS:'EXCLUIDO', STATUS_ANTES_EXCLUSAO:item.STATUS || item.STATUS_FICHA || '',
      DATA_EXCLUSAO:agora, DELETED_AT:agora, EXCLUIDO_POR:req.user?.usuario || 'MASTER', MOTIVO_EXCLUSAO:motivo,
      DATA_ULTIMA_EDICAO:agora, ATUALIZADO_POR:req.user?.usuario || 'MASTER',
    }, ['ID_MANIFESTACAO','PROTOCOLO','ID']);
    // Mantém a linha no Sheets e apenas marca o registro como excluído.
    if (manifestacaoRepo) {
      try {
        const pg = (await manifestacaoRepo.findByProtocolo(id).catch(() => null))
                || (await manifestacaoRepo.findByIdOriginal(id).catch(() => null));
        if (pg && typeof manifestacaoRepo.update === 'function') await manifestacaoRepo.update(pg.id, { status:'EXCLUIDA' });
      } catch (e) { console.warn('[PG] deletar manifestacao falhou:', e.message); }
    }
    // A exclusão remove também qualquer leitura já mantida no processo atual.
    // Isso evita que a Central continue exibindo a ficha até o próximo TTL.
    invalidarCacheAba('MANIFESTACOES');
    await registrarHistoricoManifestacao({ id:item.ID_MANIFESTACAO || id, protocolo, usuario:req.user?.usuario || 'MASTER', acao:'MANIFESTAÇÃO_EXCLUÍDA', descricao:motivo, etapa:item.ETAPA_ATUAL || '' });
    await registrarAuditoria(req.user?.usuario || 'sistema', 'EXCLUIU_MANIFESTAÇÃO', item.ID_MANIFESTACAO || id, 'MANIFESTACOES', item, { ...item, STATUS:'EXCLUIDO', MOTIVO_EXCLUSAO:motivo });
    res.json({ sucesso: true, id:item.ID_MANIFESTACAO || id, protocolo, status:'EXCLUIDO' });
  } catch (e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/manifestacoes/:id/restaurar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const rows = await lerAba('MANIFESTACOES', 5000);
    const item = rows.find(r => [r.ID_MANIFESTACAO,r.PROTOCOLO,r.ID].some(v => String(v || '').trim() === String(req.params.id || '').trim()));
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!manifestacaoExcluida(item)) return res.status(409).json({ sucesso:false, erro:'A manifestação não está excluída.' });
    const agora = new Date().toISOString();
    await atualizarPorID('MANIFESTACOES', item.ID_MANIFESTACAO || item.PROTOCOLO || req.params.id, {
      STATUS:item.STATUS_ANTES_EXCLUSAO || 'AGUARDANDO_TRIAGEM_SAC', STATUS_REGISTRO:'', DATA_EXCLUSAO:'', DELETED_AT:'',
      EXCLUIDO_POR:'', MOTIVO_EXCLUSAO:'', DATA_ULTIMA_EDICAO:agora, ATUALIZADO_POR:req.user?.usuario || 'MASTER',
    }, ['ID_MANIFESTACAO','PROTOCOLO','ID']);
    await registrarHistoricoManifestacao({ id:item.ID_MANIFESTACAO || req.params.id, protocolo:item.PROTOCOLO || '', usuario:req.user?.usuario || 'MASTER', acao:'MANIFESTAÇÃO_RESTAURADA', descricao:'Registro restaurado pelo MASTER.', etapa:item.ETAPA_ATUAL || '' });
    await registrarAuditoria(req.user?.usuario || 'MASTER', 'RESTAURou_MANIFESTAÇÃO'.toUpperCase(), item.ID_MANIFESTACAO || req.params.id, 'MANIFESTACOES', item, { STATUS:item.STATUS_ANTES_EXCLUSAO || 'AGUARDANDO_TRIAGEM_SAC' });
    invalidarCacheAba('MANIFESTACOES');
    res.json({ sucesso:true, id:item.ID_MANIFESTACAO || req.params.id, status:item.STATUS_ANTES_EXCLUSAO || 'AGUARDANDO_TRIAGEM_SAC' });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
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
    if (!escopoPermite(req, item.EMPRESA_RECLAMADA)) {
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

const _gerarTratativaRL = new Map(); // user:id → timestamp
app.post('/api/manifestacoes/:id/tratativa/gerar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','SETOR RESPONSÁVEL','ESPECIALISTA'), async (req,res)=>{
  try {
    const id = req.params.id;
    const rlKey = `${req.user?.usuario}:${id}`;
    const agora = Date.now();
    const ultimo = _gerarTratativaRL.get(rlKey) || 0;
    if (agora - ultimo < 30000) return res.status(429).json({ sucesso:false, erro:'Aguarde 30 segundos antes de gerar novamente.' });
    _gerarTratativaRL.set(rlKey, agora);
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if(!escopoPermite(req, m.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
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
    if(!escopoPermite(req, m.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
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
    if(!escopoPermite(req, _manV.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
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
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
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

// ===== TELA TRATATIVA — endpoints agregados =====

// GET completo para tela de tratativa (manifestação + tratativa + histórico + devolutivas)
app.get('/api/manifestacoes/:id/tratativa-completa', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const [histRows, devRows, encRows, impactoRows, execRows, tratasRows] = await Promise.all([
      lerAba('HISTORICO_MANIFESTACOES',2000).catch(()=>[]),
      lerAba('DEVOLUTIVAS',2000).catch(()=>[]),
      lerAba('ENCAMINHAMENTOS',2000).catch(()=>[]),
      lerAba('IMPACTO_FINANCEIRO',1000).catch(()=>[]),
      lerAba('EXECUCAO_TRATATIVA',2000).catch(()=>[]),
      lerAba('TRATATIVAS_SETORIAIS',3000).catch(()=>[]),
    ]);
    const historico = histRows.filter(h=>h.ID_MANIFESTACAO===id);
    const devolutivas = devRows.filter(d=>d.ID_MANIFESTACAO===id);
    const encaminhamentos = encRows.filter(e=>e.ID_MANIFESTACAO===id);
    const impactoFin = impactoRows.find(i=>i.ID_MANIFESTACAO===id)||null;
    const execucoes = execRows.filter(e=>e.ID_MANIFESTACAO===id);
    const tratasSetoriais = tratasRows.filter(t=>t.ID_MANIFESTACAO===id);
    res.json({ sucesso:true, manifestacao:m, historico, devolutivas, encaminhamentos, impactoFinanceiro:impactoFin, execucoes, tratasSetoriais });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST encaminhamento para setor
app.post('/api/manifestacoes/:id/encaminhamentos', requerPermissao('manifestacoes.encaminhar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const { setor, responsavel, prazo, instrucoes, checklistItens } = req.body||{};
    if (!setor) return res.status(400).json({ sucesso:false, erro:'Setor é obrigatório.' });
    const agora = new Date().toISOString();
    const novoId = `ENC-${id}-${Date.now()}`;
    const objeto = {
      ID_ENCAMINHAMENTO: novoId,
      ID_MANIFESTACAO: id,
      SETOR: setor,
      RESPONSAVEL: responsavel||'',
      PRAZO: prazo||'',
      INSTRUCOES: instrucoes||'',
      CHECKLIST: Array.isArray(checklistItens)?checklistItens.join('|'):(checklistItens||''),
      STATUS: 'AGUARDANDO',
      DATA_ENCAMINHAMENTO: agora,
      USUARIO: req.user?.usuario||'sistema',
    };
    await appendObjeto('ENCAMINHAMENTOS', objeto).catch(async ()=>{
      // Aba pode não existir; registramos no histórico da manifestação
    });
    // Atualiza status da manifestação para ENCAMINHADA
    const stAtual = m.STATUS||'';
    if (!['ENCERRADA','REJEITADA'].includes(stAtual)) {
      await atualizarPorID('MANIFESTACOES', id, { STATUS:'EM TRATAMENTO', SETOR_CONFIRMADO:setor, RESPONSAVEL:responsavel||m.RESPONSAVEL||'' });
    }
    await registrarAuditoria(req.user?.usuario||'sistema','ENCAMINHOU_SETOR',id,'MANIFESTACOES',null,{ setor,responsavel,prazo });
    res.json({ sucesso:true, id:novoId, encaminhamento:objeto });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// PUT impacto financeiro
app.put('/api/manifestacoes/:id/impacto-financeiro', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const { valorEstimado, categoriaEstimada, valorConfirmado, categoriaConfirmada, observacoes } = req.body||{};
    const agora = new Date().toISOString();
    const objeto = {
      ID_MANIFESTACAO: id,
      VALOR_ESTIMADO: valorEstimado||'',
      CATEGORIA_ESTIMADA: categoriaEstimada||'',
      VALOR_CONFIRMADO: valorConfirmado||'',
      CATEGORIA_CONFIRMADA: categoriaConfirmada||'',
      OBSERVACOES: observacoes||'',
      DATA_ATUALIZACAO: agora,
      USUARIO: req.user?.usuario||'sistema',
    };
    // Salva/atualiza na aba IMPACTO_FINANCEIRO
    const existentes = await lerAba('IMPACTO_FINANCEIRO',1000).catch(()=>[]);
    const existente = existentes.find(r=>r.ID_MANIFESTACAO===id);
    if (existente) {
      await atualizarPorID('IMPACTO_FINANCEIRO', id, objeto, ['ID_MANIFESTACAO']).catch(async ()=>{
        await appendObjeto('IMPACTO_FINANCEIRO', objeto).catch(()=>{});
      });
    } else {
      await appendObjeto('IMPACTO_FINANCEIRO', objeto).catch(()=>{});
    }
    // Salva resumo na manifestação principal também
    await atualizarPorID('MANIFESTACOES', id, {
      IMPACTO_ESTIMADO: valorEstimado||'',
      IMPACTO_CONFIRMADO: valorConfirmado||'',
    });
    await registrarAuditoria(req.user?.usuario||'sistema','REGISTROU_IMPACTO',id,'MANIFESTACOES',null,objeto);
    res.json({ sucesso:true, impacto:objeto });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST execução de tratativa (registrar progresso, evidências, impedimentos)
app.post('/api/manifestacoes/:id/execucao', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const { acao, descricao, evidencias, impedimento, status } = req.body||{};
    if (!acao) return res.status(400).json({ sucesso:false, erro:'Ação é obrigatória.' });
    const agora = new Date().toISOString();
    const novoId = `EXE-${id}-${Date.now()}`;
    const objeto = {
      ID_EXECUCAO: novoId,
      ID_MANIFESTACAO: id,
      ACAO: acao,
      DESCRICAO: descricao||'',
      EVIDENCIAS: Array.isArray(evidencias)?evidencias.join('|'):(evidencias||''),
      IMPEDIMENTO: impedimento||'',
      STATUS: status||'EM ANDAMENTO',
      DATA_REGISTRO: agora,
      USUARIO: req.user?.usuario||'sistema',
    };
    await appendObjeto('EXECUCAO_TRATATIVA', objeto).catch(()=>{});
    await registrarAuditoria(req.user?.usuario||'sistema','REGISTROU_EXECUCAO',id,'MANIFESTACOES',null,{ acao,status });
    res.json({ sucesso:true, id:novoId, execucao:objeto });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST validação SAC (aprovar/rejeitar/solicitar complemento)
app.post('/api/manifestacoes/:id/validacao-sac', requerPermissao('aprovacoes.aprovar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const { decisao, observacoes } = req.body||{};
    const DECISOES_VALIDAS = ['APROVADA','REJEITADA','SOLICITAR_COMPLEMENTO'];
    if (!DECISOES_VALIDAS.includes(decisao)) {
      return res.status(400).json({ sucesso:false, erro:`Decisão inválida. Use: ${DECISOES_VALIDAS.join(', ')}` });
    }
    const novoStatus = decisao==='APROVADA' ? 'AGUARDANDO_DEVOLUTIVA' : (decisao==='REJEITADA' ? 'EM ANÁLISE' : 'EM TRATAMENTO');
    await atualizarPorID('MANIFESTACOES', id, {
      STATUS: novoStatus,
      VALIDACAO_SAC: decisao,
      VALIDACAO_SAC_OBS: observacoes||'',
      VALIDACAO_SAC_DATA: new Date().toISOString(),
      VALIDACAO_SAC_USUARIO: req.user?.usuario||'sistema',
    });
    await registrarAuditoria(req.user?.usuario||'sistema','VALIDACAO_SAC',id,'MANIFESTACOES',m.STATUS,novoStatus);
    res.json({ sucesso:true, id, decisao, novoStatus });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST aprovar devolutiva e marcar para envio
app.post('/api/manifestacoes/:id/devolutiva/aprovar', requerPermissao('aprovacoes.aprovar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const { textoAprovado } = req.body||{};
    if (!textoAprovado) return res.status(400).json({ sucesso:false, erro:'Texto aprovado é obrigatório.' });
    await atualizarPorID('MANIFESTACOES', id, {
      DEVOLUTIVA_FINAL: textoAprovado,
      STATUS_DEVOLUTIVA: 'APROVADA',
      STATUS: 'AGUARDANDO_DEVOLUTIVA',
      DEVOLUTIVA_APROVADA_POR: req.user?.usuario||'sistema',
      DEVOLUTIVA_APROVADA_EM: new Date().toISOString(),
    });
    await registrarAuditoria(req.user?.usuario||'sistema','APROVOU_DEVOLUTIVA',id,'MANIFESTACOES',null,{ textoAprovado });
    res.json({ sucesso:true, id });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST registrar envio da devolutiva ao cliente e encerrar
app.post('/api/manifestacoes/:id/devolutiva/enviar', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    }
    const textoFinal = (req.body||{}).texto || m.DEVOLUTIVA_FINAL || '';
    if (!textoFinal) return res.status(400).json({ sucesso:false, erro:'Texto da devolutiva não encontrado. Aprove antes de enviar.' });
    const agora = new Date().toISOString();
    await atualizarPorID('MANIFESTACOES', id, {
      STATUS: 'ENCERRADA',
      DEVOLUTIVA_ENVIADA: textoFinal,
      DATA_ENCERRAMENTO: agora,
      ENCERRADA_POR: req.user?.usuario||'sistema',
      STATUS_DEVOLUTIVA: 'ENVIADA',
    });
    const devRows = await lerAba('DEVOLUTIVAS', 5000).catch(()=>[]);
    const devAtual = devRows.filter(d => d.ID_MANIFESTACAO === id).sort((a,b)=>String(b.GERADA_EM||'').localeCompare(String(a.GERADA_EM||'')))[0];
    if (devAtual) await atualizarPorID('DEVOLUTIVAS', devAtual.ID_DEVOLUTIVA, {
      STATUS:'ENVIADA', VERSAO_FINAL:textoFinal, CANAL_ENVIO:req.body?.canal||devAtual.CANAL_ENVIO||'MANUAL',
      ENVIADA_EM:agora, ENVIADA_POR:req.user?.usuario||'sistema',
    }, ['ID_DEVOLUTIVA']).catch(e=>console.warn('[DEVOLUTIVA] histórico não atualizado:', e.message));
    await registrarAuditoria(req.user?.usuario||'sistema','ENVIOU_DEVOLUTIVA',id,'MANIFESTACOES',null,{ enviadoPor: req.user?.usuario });
    res.json({ sucesso:true, id, encerradaEm: agora });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// GET tratativas por setor de uma manifestação
app.get('/api/manifestacoes/:id/tratativas-setoriais', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const rows = await lerAba('TRATATIVAS_SETORIAIS', 3000).catch(()=>[]);
    const tratativas = rows.filter(r => r.ID_MANIFESTACAO === id);
    res.json({ sucesso:true, tratativas });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST registrar tratativa setorial (setor preenche execução)
app.post('/api/manifestacoes/:id/tratativas-setoriais', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES', 5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const { setor, acao, resultado, responsavel, dataExecucao, status } = req.body||{};
    if (!setor || !acao) return res.status(400).json({ sucesso:false, erro:'setor e acao são obrigatórios.' });
    const idTrat = `TRAT-${id}-${Date.now()}`;
    const agora = new Date().toISOString();
    const objeto = {
      ID_TRATATIVA: idTrat, ID_MANIFESTACAO: id,
      SETOR: setor, ACAO: acao, RESULTADO: resultado||'',
      RESPONSAVEL: responsavel || req.user?.usuario || '',
      DATA_EXECUCAO: dataExecucao || agora,
      STATUS: status || 'EM_ANDAMENTO',
      CRIADO_EM: agora, CRIADO_POR: req.user?.usuario||'sistema',
      EMPRESA: m.EMPRESA_RECLAMADA||''
    };
    await appendObjeto('TRATATIVAS_SETORIAIS', objeto).catch(async ()=>{
      const rows2 = await lerAba('TRATATIVAS_SETORIAIS',3000).catch(()=>[]);
      rows2.push(objeto);
    });
    await registrarAuditoria(req.user?.usuario||'sistema','TRATATIVA_SETORIAL',id,'TRATATIVAS_SETORIAIS',null,{ setor, acao });
    res.json({ sucesso:true, id:idTrat, tratativa:objeto });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// PUT atualizar tratativa setorial
app.put('/api/manifestacoes/:id/tratativas-setoriais/:idTrat', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const { id, idTrat } = req.params;
    const rows = await lerAba('TRATATIVAS_SETORIAIS', 3000).catch(()=>[]);
    const trat = rows.find(r=>r.ID_TRATATIVA===idTrat && r.ID_MANIFESTACAO===id);
    if (!trat) return res.status(404).json({ sucesso:false, erro:'Tratativa não encontrada.' });
    const updates = req.body||{};
    await atualizarPorID('TRATATIVAS_SETORIAIS', idTrat, { ...updates, ATUALIZADO_EM: new Date().toISOString(), ATUALIZADO_POR: req.user?.usuario||'sistema' });
    await registrarAuditoria(req.user?.usuario||'sistema','ATUALIZOU_TRATATIVA_SETORIAL',id,'TRATATIVAS_SETORIAIS',null,updates);
    res.json({ sucesso:true, id:idTrat });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// POST finalizar manifestação (com validação de critérios bloqueantes)
app.post('/api/manifestacoes/:id/finalizar', requerPermissao('aprovacoes.aprovar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES', 5000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (!escopoPermite(req, m.EMPRESA_RECLAMADA)) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    // Critérios bloqueantes
    const bloqueios = [];
    if (!m.PROCEDENTE) bloqueios.push('Procedência não definida.');
    if (!m.DEVOLUTIVA_ENVIADA && m.STATUS_DEVOLUTIVA !== 'ENVIADA') bloqueios.push('Devolutiva ao cliente não enviada.');
    if (m.STATUS === 'ENCERRADA') bloqueios.push('Manifestação já está encerrada.');
    // Verificar tratativas setoriais pendentes
    const tratsRows = await lerAba('TRATATIVAS_SETORIAIS', 3000).catch(()=>[]);
    const tratsPendentes = tratsRows.filter(r => r.ID_MANIFESTACAO===id && r.STATUS==='EM_ANDAMENTO');
    if (tratsPendentes.length > 0) bloqueios.push(`${tratsPendentes.length} tratativa(s) setorial(is) ainda em andamento.`);
    const acionamentos = await lerAba('ACIONAMENTOS_INTERNOS', 5000).catch(()=>[]);
    const abertosCriticos = acionamentos.filter(r => r.ID_MANIFESTACAO===id && ['ESCALONAMENTO','ENCAMINHAMENTO_TRATATIVA'].includes(String(r.TIPO||'').toUpperCase()) && !['CONCLUIDO','CANCELADO'].includes(String(r.STATUS||'').toUpperCase()));
    if (abertosCriticos.length > 0 && !req.body?.dispensaAcionamentosJustificada) bloqueios.push(`${abertosCriticos.length} acionamento(s) crítico(s) ainda pendente(s).`);
    if (bloqueios.length > 0) return res.status(422).json({ sucesso:false, bloqueios, erro:'Critérios bloqueantes não atendidos.' });
    const agora = new Date().toISOString();
    const { observacaoFinal, satisfacaoCliente } = req.body||{};
    await atualizarPorID('MANIFESTACOES', id, {
      STATUS: 'ENCERRADA',
      DATA_ENCERRAMENTO: agora,
      ENCERRADA_POR: req.user?.usuario||'sistema',
      OBSERVACAO_FINAL: observacaoFinal||'',
      SATISFACAO_CLIENTE: satisfacaoCliente||'',
    });
    // Consolida o conhecimento no backend sem exigir novo preenchimento na tela.
    await garantirAbaComCabecalhos('CONSOLIDACAO_CONHECIMENTO', ['ID_CONSOLIDACAO','ID_MANIFESTACAO','EMPRESA','CAUSA','SUBCAUSA','TRATATIVAS','DEVOLUTIVAS','RESULTADO','CIRCA_VERSAO','CIRCA_RESULTADO','CRIADO_EM','CRIADO_POR']).catch(()=>{});
    const consolRows = await lerAba('CONSOLIDACAO_CONHECIMENTO', 5000).catch(()=>[]);
    if (!consolRows.some(r => r.ID_MANIFESTACAO === id && r.RESULTADO === (m.PROCEDENTE || ''))) {
      const [devs, trats] = await Promise.all([
        lerAba('DEVOLUTIVAS', 5000).catch(()=>[]),
        lerAba('TRATATIVAS_SETORIAIS', 5000).catch(()=>[]),
      ]);
      await appendObjeto('CONSOLIDACAO_CONHECIMENTO', {
        ID_CONSOLIDACAO: `CON-${id}-${Date.now()}`, ID_MANIFESTACAO: id,
        EMPRESA: m.EMPRESA_RECLAMADA || '', CAUSA: m.CAUSA_RAIZ || m.CAUSA_CONFIRMADA || '',
        SUBCAUSA: m.SUBCAUSA || m.SUBCAUSA_CONFIRMADA || '',
        TRATATIVAS: JSON.stringify(trats.filter(t=>t.ID_MANIFESTACAO===id)),
        DEVOLUTIVAS: JSON.stringify(devs.filter(d=>d.ID_MANIFESTACAO===id)),
        RESULTADO: m.PROCEDENTE || '',
        CIRCA_VERSAO: '1.0',
        CIRCA_RESULTADO: JSON.stringify(circaEngine.analisar({
          manifestacao: { ...m, STATUS: 'ENCERRADA' },
          tratativa: trats.filter(t=>t.ID_MANIFESTACAO===id).slice(-1)[0],
          devolutiva: devs.filter(d=>d.ID_MANIFESTACAO===id).slice(-1)[0],
        })),
        CRIADO_EM: agora, CRIADO_POR: req.user?.usuario || 'sistema',
      }).catch(e => console.warn('[CONSOLIDACAO] falha não bloqueante:', e.message));
    }
    await registrarAuditoria(req.user?.usuario||'sistema','FINALIZOU_MANIFESTACAO',id,'MANIFESTACOES',m.STATUS,'ENCERRADA');
    res.json({ sucesso:true, id, encerradaEm: agora });
  } catch(e){ res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/devolutivas/:idDev/decisao', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), async (req,res)=>{
  try {
    const { decisao, textoAprovado, motivo } = req.body;
    if (!['APROVADA','EDITADA','REJEITADA'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
    const _devRows = await lerAba('DEVOLUTIVAS', 2000).catch(()=>[]);
    const devExist = _devRows.find(r => r.ID_DEVOLUTIVA === req.params.idDev);
    if (devExist && !escopoPermite(req, devExist.EMPRESA||devExist.EMPRESA_RECLAMADA||'')) {
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

// ===== CENTRAL DE CADASTROS (clientes, produtos, vendedores, RCAs e gerentes) =====
// Os cadastros comerciais ficam separados dos registros operacionais. Assim, uma
// alteração/inativação nunca remove manifestações históricas nem seus vínculos.
const CADASTRO_CONFIG = {
  clientes: {
    aba: 'CLIENTES_CADASTRO', prefixo: 'CLI', id: 'ID_CLIENTE',
    headers: ['ID_CLIENTE','CODIGO_INTERNO','RAZAO_SOCIAL','NOME_FANTASIA','CNPJ_CPF','SEGMENTO','CONTATOS_JSON','COMPRADORES_JSON','ENDERECO_JSON','VINCULOS_JSON','ATIVO','DATA_CRIACAO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'],
    key: r => String(r.CNPJ_CPF || r.CODIGO_INTERNO || '').replace(/\\D/g,'').toUpperCase()
  },
  produtos: {
    aba: 'PRODUTOS', prefixo: 'PRD', id: 'ID_PRODUTO',
    headers: ['ID_PRODUTO','EMPRESA','SKU','PRODUTO','DESCRICAO','CATEGORIA','UNIDADE','QUANTIDADE_EMBALAGEM','PESO','INFORMACOES_TECNICAS','ATIVO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'],
    key: r => `${normalizarTexto(r.EMPRESA || '')}|${normalizarTexto(r.SKU || r.PRODUTO || '')}`
  },
  vendedores: {
    aba: 'VENDEDORES', prefixo: 'VND', id: 'ID_VENDEDOR',
    headers: ['ID_VENDEDOR','CODIGO','NOME','TELEFONE','WHATSAPP','EMAIL','EMPRESAS_JSON','GERENTES_JSON','CARTEIRA_CLIENTES_JSON','ATIVO','DATA_CRIACAO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'],
    key: r => String(r.CODIGO || r.EMAIL || '').trim().toUpperCase()
  },
  rcas: {
    aba: 'RCAS_CADASTRO', prefixo: 'RCA', id: 'ID_RCA',
    headers: ['ID_RCA','CODIGO_RCA','NOME_RAZAO_SOCIAL','CPF_CNPJ','TELEFONE','WHATSAPP','EMAIL','EMPRESAS_JSON','GERENTES_JSON','REGIAO_ATUACAO','CLIENTES_VINCULADOS_JSON','ATIVO','DATA_CRIACAO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'],
    key: r => String(r.CODIGO_RCA || r.CPF_CNPJ || '').trim().toUpperCase()
  },
  gerentes: {
    aba: 'GERENTES', prefixo: 'GER', id: 'ID_GERENTE',
    headers: ['ID_GERENTE','CODIGO','NOME','CARGO','TELEFONE','EMAIL','EMPRESAS_JSON','VENDEDORES_SUPERVISIONADOS_JSON','RCAS_SUPERVISIONADOS_JSON','ATIVO','DATA_CRIACAO','DATA_ATUALIZACAO','USUARIO_ATUALIZACAO'],
    key: r => String(r.CODIGO || r.EMAIL || r.NOME || '').trim().toUpperCase()
  }
};
const CADASTRO_LEITURA = ['MASTER','GESTOR SAC','ANALISTA SAC','ATENDENTE SAC','APROVADOR','APROVADOR MASTER','SETOR RESPONSÁVEL','DIRETOR','AUDITOR','CONSULTA'];
const CADASTRO_EDICAO = ['MASTER','GESTOR SAC','ANALISTA SAC'];
function cadastroConfig(tipo){ return CADASTRO_CONFIG[String(tipo||'').toLowerCase()] || null; }
function cadastroSemDuplicidade(rows, cfg, body, ignoreId='') {
  const candidato = cfg.key(body);
  if (!candidato) return null;
  return rows.find(r => String(r[cfg.id]||'') !== String(ignoreId||'') && cfg.key(r) === candidato && String(r.ATIVO||'SIM').toUpperCase() !== 'EXCLUIDO');
}
function cadastroEscopo(rows, req) {
  if (!req._empresaScope) return rows;
  return rows.filter(r => {
    const raw = r.EMPRESA || r.EMPRESAS || r.EMPRESAS_JSON || '';
    if (!raw) return false;
    return pertenceEmpresa(req._empresaScope, raw);
  });
}
app.get('/api/cadastros/:tipo', middlewareEscopoEmpresa(), requerPerfil(...CADASTRO_LEITURA), async (req,res)=>{
  try {
    const cfg=cadastroConfig(req.params.tipo); if(!cfg) return res.status(404).json({sucesso:false,erro:'Tipo de cadastro inválido.'});
    await garantirAbaComCabecalhos(cfg.aba,cfg.headers);
    let itens=await lerAba(cfg.aba,10000);
    // RCAs antigos continuam visíveis sem copiar seus registros para uma nova base.
    if(req.params.tipo==='rcas' && !itens.length) itens=await lerAba('REPRESENTANTES',5000).catch(()=>[]);
    if(['rcas','vendedores','gerentes'].includes(req.params.tipo)) {
      const usuarios=(await carregarUsuarios()).map(usuarioPublico);
      const perfis=await lerAba('PERFIS_PROFISSIONAIS',5000).catch(()=>[]);
      const completos=new Set(perfis.filter(p=>p.STATUS==='CONCLUIDO').map(p=>String(p.ID_USUARIO)));
      const tipo=req.params.tipo;
      for(const u of usuarios) {
        if(!completos.has(String(u.id)) || String(u.status||'ATIVO').toUpperCase()!=='ATIVO') continue;
        const cargo=normalizarTexto(u.cargo||'');
        const corresponde=tipo==='rcas' ? u.perfil==='RCA / REPRESENTANTE' : tipo==='vendedores' ? cargo.includes('vendedor') : cargo.includes('gerente') || u.perfil==='GESTOR SAC';
        if(!corresponde) continue;
        const code=tipo==='rcas'?u.codigoRCA||u.id:u.id;
        if(itens.some(r=>String(r.USUARIO_ID||'')===String(u.id) || (tipo==='rcas'&&u.codigoRCA&&String(r.CODIGO_RCA||'')===String(u.codigoRCA)) || (u.email&&String(r.EMAIL||'').toLowerCase()===u.email.toLowerCase()))) continue;
        const comum={USUARIO_ID:u.id,ORIGEM_PERFIL:'SIM',EMPRESA:u.empresa,EMPRESAS_JSON:JSON.stringify([u.empresa]),EMAIL:u.email,TELEFONE:u.telefone,ATIVO:'SIM'};
        itens.push(tipo==='rcas'?{...comum,ID_RCA:`USR:${u.id}`,CODIGO_RCA:code,NOME_RAZAO_SOCIAL:u.nome}:tipo==='vendedores'?{...comum,ID_VENDEDOR:`USR:${u.id}`,CODIGO:code,NOME:u.nome}:{...comum,ID_GERENTE:`USR:${u.id}`,CODIGO:code,NOME:u.nome,CARGO:u.cargo});
      }
    }
    itens=cadastroEscopo(itens,req).filter(r=>String(r.ATIVO||'SIM').toUpperCase()!=='EXCLUIDO');
    const q=String(req.query.q||'').trim().toLowerCase();
    if(q) itens=itens.filter(r=>Object.values(r).some(v=>String(v??'').toLowerCase().includes(q)));
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.post('/api/cadastros/:tipo', requerPerfil(...CADASTRO_EDICAO), async(req,res)=>{
  try {
    const cfg=cadastroConfig(req.params.tipo); if(!cfg) return res.status(404).json({sucesso:false,erro:'Tipo de cadastro inválido.'});
    await garantirAbaComCabecalhos(cfg.aba,cfg.headers);
    const body={...(req.body||{})};
    if(!body.NOME && body.nome) body.NOME=body.nome;
    if(!body.ATIVO) body.ATIVO='SIM';
    const rows=await lerAba(cfg.aba,10000); const dup=cadastroSemDuplicidade(rows,cfg,body);
    if(dup) return res.status(409).json({sucesso:false,erro:'Cadastro duplicado.',existente:dup[cfg.id]});
    const now=new Date().toISOString(); const obj={...body,[cfg.id]:await gerarProximoID(cfg.aba,cfg.prefixo,cfg.id),DATA_CRIACAO:now,DATA_ATUALIZACAO:now,USUARIO_ATUALIZACAO:req.user?.usuario||'sistema'};
    await appendObjeto(cfg.aba,obj); await registrarAuditoria(req.user.usuario,'CRIOU_CADASTRO',obj[cfg.id],cfg.aba,null,obj);
    res.status(201).json({sucesso:true,item:obj});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});
app.patch('/api/cadastros/:tipo/:id', requerPerfil(...CADASTRO_EDICAO), async(req,res)=>{
  try {
    const cfg=cadastroConfig(req.params.tipo); if(!cfg) return res.status(404).json({sucesso:false,erro:'Tipo de cadastro inválido.'});
    await garantirAbaComCabecalhos(cfg.aba,cfg.headers); const rows=await lerAba(cfg.aba,10000); const atual=rows.find(r=>String(r[cfg.id])===String(req.params.id));
    if(!atual) return res.status(404).json({sucesso:false,erro:'Cadastro não encontrado.'});
    const body={...(req.body||{})}; const combinado={...atual,...body}; const dup=cadastroSemDuplicidade(rows,cfg,combinado,req.params.id);
    if(dup) return res.status(409).json({sucesso:false,erro:'Cadastro duplicado.',existente:dup[cfg.id]});
    const dados={...body,DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user?.usuario||'sistema'};
    await atualizarPorID(cfg.aba,req.params.id,dados,[cfg.id,'ID']); const item=await buscarPorID(cfg.aba,req.params.id,[cfg.id,'ID']);
    await registrarAuditoria(req.user.usuario,'ATUALIZOU_CADASTRO',req.params.id,cfg.aba,null,dados); res.json({sucesso:true,item});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});
app.post('/api/cadastros/:tipo/importar', requerPerfil(...CADASTRO_EDICAO), async(req,res)=>{
  try {
    const cfg=cadastroConfig(req.params.tipo); if(!cfg) return res.status(404).json({sucesso:false,erro:'Tipo de cadastro inválido.'});
    const itens=Array.isArray(req.body?.itens)?req.body.itens:[]; if(!itens.length) return res.status(400).json({sucesso:false,erro:'Nenhum registro enviado.'});
    await garantirAbaComCabecalhos(cfg.aba,cfg.headers); let rows=await lerAba(cfg.aba,10000); let criados=0,atualizados=0,duplicados=0;
    for(const raw of itens){ const body={...(raw||{})}; if(!body.ATIVO) body.ATIVO='SIM'; const found=cadastroSemDuplicidade(rows,cfg,body); if(found){ await atualizarPorID(cfg.aba,found[cfg.id],{...body,DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario},[cfg.id,'ID']); atualizados++; } else { const obj={...body,[cfg.id]:await gerarProximoID(cfg.aba,cfg.prefixo,cfg.id),DATA_CRIACAO:new Date().toISOString(),DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario}; await appendObjeto(cfg.aba,obj); rows.push(obj); criados++; } }
    await registrarAuditoria(req.user.usuario,'IMPORTOU_CADASTRO',`${criados}c/${atualizados}a`,cfg.aba,null,{total:itens.length}); res.json({sucesso:true,criados,atualizados,duplicados,total:criados+atualizados});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
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

// Scan completo do Cérebro: retorna todas as abas em paralelo (1 request em vez de N×5)
app.get('/api/cerebro/scan', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR','APROVADOR MASTER'), async(req,res)=>{
  try{
    const [regras,procedimentos,politicas,faq,documentos,causas] = await Promise.all([
      lerAba('REGRAS_SETORES',2000).catch(()=>[]),
      lerAba('PROCEDIMENTOS_SETORES',2000).catch(()=>[]),
      lerAba('POLITICAS_SETORES',2000).catch(()=>[]),
      lerAba('FAQ_SETORES',2000).catch(()=>[]),
      lerAba('DOCUMENTOS_SETORES',2000).catch(()=>[]),
      lerAba('CAUSAS',2000).catch(()=>[]),
    ]);
    res.json({sucesso:true,regras,procedimentos,politicas,faq,documentos,causas});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
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
app.post('/api/setores/:setor/faq', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','APROVADOR MASTER'), async(req,res)=>{
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
app.post('/api/setores/:setor/regras', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
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
    if (!escopoPermite(req, itemMan.EMPRESA_RECLAMADA)) {
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
app.get('/api/dashboard/executiva', middlewareEscopoEmpresa(), requerPermissao('dashboard.visualizar'), async (req, res) => {
  try {
    const { empresa='', setor='', inicio='', fim='' } = req.query;
    const [manifestacoes, respostas, logsIA] = await Promise.all([
      lerAba('MANIFESTACOES', 5000).catch(()=>[]), lerAba('PESQUISA_RESPOSTAS', 5000).catch(()=>[]), lerAba('LOG_SISTEMA', 5000).catch(()=>[])
    ]);
    const scoped = filtrarPorEmpresaHistorico(manifestacoes, req, COLUNA_EMPRESA_ABA.MANIFESTACOES)
      .filter(m=>!isTeste(m)).filter(m=>!empresa || pertenceEmpresa(empresa,m.EMPRESA_RECLAMADA||''))
      .filter(m=>!setor || normalizarTexto(m.SETOR_CONFIRMADO||m.SETOR_DESTINADO||m.SETOR_RESPONSAVEL||m.SETOR_SUGERIDO||'').includes(normalizarTexto(setor)));
    const inicioData=inicio?new Date(`${inicio}T00:00:00`):null, fimData=fim?new Date(`${fim}T23:59:59`):null;
    const pesquisas = respostas.filter(r=>!empresa || pertenceEmpresa(empresa,r.EMPRESA||''))
      .filter(r=>{ const valor=r.DATA||r.DATA_RESPOSTA||r.DATA_CRIACAO||r.CREATED_AT; if(!valor) return !inicioData&&!fimData; const d=new Date(valor); return !Number.isNaN(d.getTime()) && (!inicioData||d>=inicioData) && (!fimData||d<=fimData); });
    const dados=dashboardExecutiva.calcular({manifestacoes:scoped,respostas:pesquisas,logsIA,inicio:inicioData,fim:fimData});
    res.json({sucesso:true,filtros:{empresa,setor,inicio,fim},fonte:{manifestacoes:'MANIFESTACOES',satisfacao:'PESQUISA_RESPOSTAS',ia:'LOG_SISTEMA'},dados});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});
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
    // F6: tenta PostgreSQL primeiro
    if (rncRepo) {
      try {
        const filtros = {};
        // B2: empresa vem do usuário autenticado, não do frontend
        const _isMasterRnc = req.user && perfilCanonico(req.user.perfil) === 'MASTER';
        if (_isMasterRnc && req.query.empresaId) filtros.empresaId = req.query.empresaId;
        else if (!_isMasterRnc && req.user?.empresa) filtros.empresaId = await resolverEmpresaIdScope(req.user.empresa);
        if (req.query.status) filtros.status = req.query.status;
        const pgData = await rncRepo.findAll(filtros);
        if (pgData && pgData.length > 0) {
          const itens = pgData.map(r => ({
            ID_RNC: r.numero || r.idOriginal || String(r.id),
            DATA_ABERTURA: r.dataAbertura?.toISOString?.() || '',
            EMPRESA: r.empresa?.nome || '',
            SETOR: r.setor || '',
            STATUS: r.status || '',
            NAO_CONFORMIDADE: r.descricao || '',
            CAUSA: r.causa || '',
            RESPONSAVEL: r.responsavel || '',
            PRIORIDADE: r.prioridade || '',
            _pgId: r.id,
          }));
          return res.json({ sucesso: true, total: itens.length, itens, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F6] GET /rnc PG falhou:', e.message); }
    }
    // Fallback Sheets — B2: legado sem empresa = global
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
    // F6: dual-write RNC para PostgreSQL (não-bloqueante)
    if (rncRepo && empresaRepo) {
      empresaRepo.findAll().then(emps => {
        const nomeEmpresa = body.EMPRESA || body.empresa || '';
        const emp = emps.find(e => e.nome === nomeEmpresa || e.id === nomeEmpresa) || emps[0];
        if (!emp) return;
        return rncRepo.create({
          protocolo: id,
          idOriginal: id,
          empresaId: emp.id,
          origemTipo: 'AUDITORIA_INTERNA',
          descricao: body.NAO_CONFORMIDADE || body.naoConformidade || competencia || '',
          responsavel: body.RESPONSAVEL || body.responsavel || '',
          prioridade: body.PRIORIDADE || body.prioridade || 'MEDIA',
          status: 'AGUARDANDO_APROVACAO',
        });
      }).catch(e => console.warn('[F6] dual-write RNC PG falhou:', e.message));
    }
    await registrarAuditoria(usuarioCriador,'CRIOU_RNC',id,'BANCO_RNC',null,{competencia});
    res.json({sucesso:true,id,competencia,status:'AGUARDANDO_APROVACAO'});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/rnc/:id', requerPerfil('APROVADOR','MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if(!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
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
    if(!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
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
    if(rnc && !escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const data=await lerAba('RNC_EVENTOS',5000);res.json({sucesso:true,itens:data.filter(x=>x.ID_RNC===req.params.id)});}
  catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.patch('/api/rnc/:id/execucao', requerPerfil('SETOR RESPONSÁVEL','MASTER','ANALISTA SAC'), async(req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    if(!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta RNC.'});
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
    // F7: tenta PostgreSQL primeiro
    if (conhecimentoRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
        if (req.query.setorId) filtros.setorId = req.query.setorId;
        const pgData = await conhecimentoRepo.findProcedimentos(filtros);
        if (pgData && pgData.length > 0) {
          const itens = pgData.map(p => ({
            ID_PROCEDIMENTO: String(p.id), NOME: p.titulo || '',
            DESCRICAO: p.texto || '', PASSOS: '', ATIVO: p.status === 'ATIVO' ? 'SIM' : 'NÃO',
          }));
          return res.json({ sucesso: true, total: itens.length, itens, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F7] GET /procedimentos PG falhou:', e.message); }
    }
    await garantirAbaComCabecalhos('PROCEDIMENTOS',['ID_PROCEDIMENTO','NOME','SETOR_RESPONSAVEL','DESCRICAO','PASSOS','ATIVO']).catch(()=>{});
    const data=await lerAba('PROCEDIMENTOS',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]}); }
});
app.get('/api/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    // F7: tenta PostgreSQL primeiro
    if (conhecimentoRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
        if (req.query.setorId) filtros.setorId = req.query.setorId;
        const pgData = await conhecimentoRepo.findPoliticas(filtros);
        if (pgData && pgData.length > 0) {
          const itens = pgData.map(p => ({
            ID_POLITICA: String(p.id), POLITICA: p.titulo || '',
            DESCRICAO: p.texto || '', ATIVO: p.status === 'ATIVA' ? 'SIM' : 'NÃO',
          }));
          return res.json({ sucesso: true, total: itens.length, itens, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F7] GET /politicas PG falhou:', e.message); }
    }
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
    // F12: tenta PostgreSQL primeiro
    if (conhecimentoRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
        if (req.query.tipo) filtros.tipo = req.query.tipo;
        const pgData = await conhecimentoRepo.findMatriz(filtros);
        if (pgData && pgData.length > 0) {
          return res.json({ sucesso: true, itens: pgData, fonte: 'postgresql' });
        }
      } catch (e) { console.warn('[F12] GET /matriz PG falhou:', e.message); }
    }
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
    // Invalida cache para garantir dados frescos no relatório
    invalidarCacheAba('PESQUISA_RESPOSTAS');
    invalidarCacheAba('PESQUISA_HISTORICO');
    const todasRespostas = await lerRespostasPesquisa();
    const ocorrenciasPesquisa = await lerAba('PESQUISA_OCORRENCIAS', 5000).catch(() => []);
    const manifestacoesPesquisa = await lerAba('MANIFESTACOES', 5000).catch(() => []);
    // Normaliza para campos canônicos (sem duplicar campos uppercase e camelCase)
    const dados = todasRespostas.map(r => {
      const ocp = ocorrenciasPesquisa.find(o => (o.TOKEN && o.TOKEN === r.TOKEN) || (o.ID_RESPOSTA && o.ID_RESPOSTA === r.ID_RESPOSTA));
      const man = manifestacoesPesquisa.find(m => String(m.DESCRICAO || m.DESCRICAO_MANIFESTACAO || '').includes(r.ID_RESPOSTA || '__sem_id__'));
      return ({
      Empresa: r.EMPRESA || '',
      Cliente: r.NOME_CLIENTE || '',
      Data: r.DATA || '',
      Atendimento: r.ATENDIMENTO == null ? '' : String(r.ATENDIMENTO),
      'Prazo de Entrega': r.PRAZO_ENTREGA == null ? '' : String(r.PRAZO_ENTREGA),
      Qualidade: r.QUALIDADE == null ? '' : String(r.QUALIDADE),
      Recomendação: r.RECOMENDACAO == null ? '' : String(r.RECOMENDACAO),
      Observação: r.COMENTARIO || '',
      _id: r.ID_RESPOSTA || '',
      _token: r.TOKEN || '',
      _notaBaixa: r.NOTA_BAIXA || '',
      _statusOcp: r.STATUS_OCP || '',
      _formularioId: r.FORMULARIO_ID || '',
      _versaoId: r.VERSAO_ID || '',
      _versao: r.VERSAO || '',
      _analista: r.ANALISTA_RESPONSAVEL || '',
      _statusAnalise: r.STATUS_ANALISE || '',
      _observacoesInternas: r.OBSERVACOES_INTERNAS || '',
      _assumidoEm: r.DATA_ASSUNCAO || '',
      _ocpId: ocp?.ID_OCP || '',
      _manifestacaoId: ocp?.ID_MANIFESTACAO_GERADA || man?.ID_MANIFESTACAO || '',
      _decisao: ocp?.DECISAO || (r.STATUS_OCP === 'NAO_REQUER_TRATAMENTO' ? 'NAO_REQUER' : ''),
      });
    });
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
        if (!pertenceEmpresa(empresa, row.Empresa || row.EMPRESA || '')) return null;
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
    let mediaGeral = medias.length ? medias.reduce((a,b)=>a+b,0)/medias.length : null;

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
        if (empresa && !pertenceEmpresa(empresa, r.Empresa || r.EMPRESA || '')) return false;
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
        const hRow = historicoRows.find(r => r.ANO == anoH && Number(r.MES) === mesH && (!empresa || pertenceEmpresa(empresa, r.EMPRESA || '')));
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
      const hRowAtual = historicoRows.find(r => r.ANO == ano && Number(r.MES) === Number(mes) && (!empresa || pertenceEmpresa(empresa, r.EMPRESA || '')));
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
      if (relRow) relMeta = { id: relRow.ID_RELATORIO, status: relRow.STATUS, versao: Number(relRow.VERSAO||1), publicado_em: relRow.PUBLICADO_EM||'', atualizado_em:relRow.ATUALIZADO_EM||relRow.CRIADO_EM||'', atualizado_por:relRow.ATUALIZADO_POR||relRow.CRIADO_POR||'' };
    } catch(e) {}

    const NOTA_CRITICA_V = Number(process.env.PESQUISA_NOTA_CRITICA || 6);
    const notas_baixas_stats = {
      total: filtrados.filter(r => {
        const ns = COLS_NOTA.map(c => parseFloat(String(r[c]||'').replace(',','.'))).filter(n=>!isNaN(n)&&n>=0);
        return ns.length && ns.some(n => n <= NOTA_CRITICA_V);
      }).length,
      ocorrencias_geradas: filtrados.filter(r => r._statusOcp && r._statusOcp !== '').length,
      manifestacoes_formais: filtrados.filter(r => r._statusOcp === 'TRANSFORMADA_MANIFESTACAO').length,
      tratativas_encerradas: filtrados.filter(r => r._statusOcp === 'NAO_REQUER_TRATAMENTO').length,
    };
    res.json({ sucesso: true, itens: filtrados, media_geral: mediaGeral, criterios, historico, textos, nps, relMeta, notas_baixas_stats });
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
    await garantirAbaComCabecalhos('PESQUISA_HISTORICO', _HEADERS_H).catch(()=>{});
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

    await garantirAbaComCabecalhos(aba, ['CHAVE','TEXTOS','ATUALIZADO_EM','ATUALIZADO_POR']).catch(()=>{});
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

// ===== ANÁLISE SAC DA RESPOSTA =====
app.patch('/api/pesquisas/respostas/:id/analise', requerPermissao('pesquisas.criar'), async (req, res) => {
  try {
    const { assumir = false, observacoesInternas } = req.body || {};
    await garantirAbaComCabecalhos('PESQUISA_RESPOSTAS', ['ID_RESPOSTA','ANALISTA_RESPONSAVEL','STATUS_ANALISE','OBSERVACOES_INTERNAS','DATA_ASSUNCAO','DATA_ATUALIZACAO_ANALISE']);
    const rows = await lerRespostasPesquisa();
    const resposta = rows.find(r => r.ID_RESPOSTA === req.params.id);
    if (!resposta) return res.status(404).json({ sucesso: false, erro: 'Resposta não encontrada.' });
    const perfilAtual = perfilCanonico(req.user?.perfil || '');
    if (perfilAtual !== 'MASTER' && !pertenceEmpresa(req.user?.empresa || '', resposta.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para a empresa desta pesquisa.' });
    }
    const agora = new Date().toISOString();
    const alteracoes = {
      STATUS_ANALISE: assumir || resposta.ANALISTA_RESPONSAVEL ? 'EM_ANALISE' : (resposta.STATUS_ANALISE || 'PENDENTE'),
      DATA_ATUALIZACAO_ANALISE: agora,
    };
    if (assumir) {
      alteracoes.ANALISTA_RESPONSAVEL = req.user?.usuario || '';
      alteracoes.DATA_ASSUNCAO = resposta.DATA_ASSUNCAO || agora;
    }
    if (observacoesInternas != null) alteracoes.OBSERVACOES_INTERNAS = String(observacoesInternas).trim().slice(0, 4000);
    await atualizarPorID('PESQUISA_RESPOSTAS', req.params.id, alteracoes, ['ID_RESPOSTA']);
    invalidarCacheAba('PESQUISA_RESPOSTAS');
    await registrarAuditoria(req.user?.usuario || 'sistema', assumir ? 'ASSUMIU_ANALISE_PESQUISA' : 'ATUALIZOU_ANALISE_PESQUISA', req.params.id, 'PESQUISA_RESPOSTAS', null, alteracoes);
    res.json({ sucesso: true, analista: alteracoes.ANALISTA_RESPONSAVEL || resposta.ANALISTA_RESPONSAVEL || '', status: alteracoes.STATUS_ANALISE });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'analise-pesquisa') }); }
});

// ===== PESQUISA DECISÃO (Transformar em Manifestação / Não requer tratamento) =====
app.post('/api/pesquisas/decisao', requerPermissao('pesquisas.criar'), async (req, res) => {
  try {
    const { respostaId, decisao, justificativa } = req.body || {};
    if (!respostaId || !decisao) return res.status(400).json({ sucesso: false, erro: 'respostaId e decisao são obrigatórios.' });
    if (!['MANIFESTACAO','NAO_REQUER'].includes(decisao)) return res.status(400).json({ sucesso: false, erro: 'decisao deve ser MANIFESTACAO ou NAO_REQUER.' });

    const aba = 'PESQUISA_RESPOSTAS';
    const rows = await lerAba(aba, 5000);
    const idx = rows.findIndex(r => r.ID_RESPOSTA === respostaId);
    if (idx < 0) return res.status(404).json({ sucesso: false, erro: 'Resposta não encontrada.' });
    const resposta = rows[idx];
    const perfilAtual = perfilCanonico(req.user?.perfil || '');
    if (perfilAtual !== 'MASTER' && !pertenceEmpresa(req.user?.empresa || '', resposta.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para a empresa desta pesquisa.' });
    }

    if (resposta.STATUS_OCP === 'NAO_REQUER_TRATAMENTO' && decisao === 'NAO_REQUER') {
      return res.json({ sucesso: true, decisao: resposta.STATUS_OCP, existente: true });
    }
    if (resposta.STATUS_OCP === 'TRANSFORMADA_MANIFESTACAO' && decisao === 'MANIFESTACAO') {
      const manifests = await lerAba('MANIFESTACOES', 5000).catch(() => []);
      const existente = manifests.find(m => String(m.DESCRICAO || m.DESCRICAO_MANIFESTACAO || '').includes(respostaId));
      return res.json({ sucesso: true, decisao: resposta.STATUS_OCP, manifestacaoId: existente?.ID_MANIFESTACAO || null, existente: true });
    }

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
      // dual-write para PostgreSQL (não-bloqueante), igual ao POST /api/manifestacoes
      if (manifestacaoRepo) {
        manifestacaoRepo.upsertFromSheets({
          ID_MANIFESTACAO: manifestacaoId,
          EMPRESA_RECLAMANTE: obj.EMPRESA_RECLAMANTE,
          EMPRESA_RECLAMADA: resposta.EMPRESA_RECLAMADA || '',
          DESCRICAO: obj.DESCRICAO,
          STATUS: obj.STATUS,
          TIPO: obj.TIPO,
          PRODUTO: '',
          DATA_ABERTURA: agora,
        }).then(() => {
          console.info('[PG] dual-write pesquisa→manifestação OK:', manifestacaoId);
        }).catch(e => {
          console.error('[PG] dual-write pesquisa→manifestação FALHOU:', manifestacaoId, e.message);
        });
      }
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
const REL_HEADERS = ['ID_RELATORIO','CHAVE','EMPRESA','ANO','MES','VERSAO','STATUS','CRIADO_EM','ATUALIZADO_EM','PUBLICADO_EM','CRIADO_POR','ATUALIZADO_POR','INDICADOR','NPS_SCORE','TEXTOS_JSON','LINK_TOKEN','DADOS_JSON','MODELO_VERSAO','REVISAO_DE'];

app.get('/api/relatorios/lista', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','APROVADOR MASTER','DIRETOR','SETOR DIRETORIA','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    const empresaScope = _mcEmpresaScope(req.user);
    const rows = await lerRelatoriosSac();
    let lista = rows;
    if (empresaScope) lista = lista.filter(r => pertenceEmpresa(empresaScope, r.EMPRESA||''));
    lista = lista.map(r => ({
      id: r.ID_RELATORIO, chave: r.CHAVE, empresa: r.EMPRESA,
      ano: r.ANO, mes: r.MES, versao: Number(r.VERSAO||1),
      status: r.STATUS, criado_em: r.CRIADO_EM, atualizado_em:r.ATUALIZADO_EM||r.CRIADO_EM, atualizado_por:r.ATUALIZADO_POR||r.CRIADO_POR||'', publicado_em: r.PUBLICADO_EM,
      indicador: r.INDICADOR ? Number(r.INDICADOR) : null,
      nps_score: r.NPS_SCORE !== '' && r.NPS_SCORE != null ? Number(r.NPS_SCORE) : null,
    }));
    lista.sort((a,b)=>b.chave<a.chave?-1:1);
    res.json({ sucesso:true, lista });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/gerar', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { empresa, ano, mes, indicador, nps_score, dados, textos } = req.body||{};
    if (!empresa||!ano||!mes) return res.status(400).json({ sucesso:false, erro:'empresa, ano e mes são obrigatórios.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, empresa)) return res.status(403).json({ sucesso:false, erro:'Sem acesso a esta empresa.' });
    const chave = `${empresa}|${ano}|${String(mes).padStart(2,'0')}`;
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS).catch(()=>{});
    // Salvar rascunho é idempotente: o mesmo período não cria uma versão a
    // cada clique. Uma versão publicada só recebe alteração via nova revisão.
    const rows = await lerRelatoriosSac();
    const existentes = rows.filter(r=>r.CHAVE===chave);
    const rascunho = existentes.filter(r => r.STATUS === 'RASCUNHO' || r.STATUS === 'EM_REVISAO')
      .sort((a,b)=>Number(b.VERSAO||1)-Number(a.VERSAO||1))[0];
    const agora = new Date().toISOString();
    const serializar = valor => valor == null ? '' : (typeof valor === 'string' ? valor : JSON.stringify(valor));
    if (rascunho) {
      await atualizarPorID('RELATORIOS_SAC', rascunho.ID_RELATORIO, {
        INDICADOR:indicador!=null?String(indicador):(rascunho.INDICADOR||''),
        NPS_SCORE:nps_score!=null?String(nps_score):(rascunho.NPS_SCORE||''),
        DADOS_JSON:dados!=null?serializar(dados):(rascunho.DADOS_JSON||''),
        TEXTOS_JSON:textos!=null?serializar(textos):(rascunho.TEXTOS_JSON||''),
        ATUALIZADO_EM:agora, ATUALIZADO_POR:req.user?.nome||req.user?.usuario||''
      }, ['ID_RELATORIO']);
      invalidarCacheAba('RELATORIOS_SAC');
      return res.json({ sucesso:true, id:rascunho.ID_RELATORIO, versao:Number(rascunho.VERSAO||1), atualizado:true });
    }
    const maxVersao = existentes.reduce((m,r)=>Math.max(m,Number(r.VERSAO||1)),0);
    const id = `REL-${Date.now().toString(36).toUpperCase()}`;
    const obj = {
      ID_RELATORIO:id, CHAVE:chave, EMPRESA:empresa, ANO:String(ano), MES:String(mes).padStart(2,'0'),
      VERSAO:String(maxVersao+1), STATUS:'RASCUNHO',
      CRIADO_EM:agora, ATUALIZADO_EM:agora, PUBLICADO_EM:'',
      CRIADO_POR:req.user?.nome||req.user?.usuario||'',
      ATUALIZADO_POR:req.user?.nome||req.user?.usuario||'',
      INDICADOR:indicador!=null?String(indicador):'', NPS_SCORE:nps_score!=null?String(nps_score):'',
      TEXTOS_JSON:textos!=null?serializar(textos):'', DADOS_JSON:dados!=null?serializar(dados):'', MODELO_VERSAO:'1', REVISAO_DE:'',
    };
    await appendObjeto('RELATORIOS_SAC', obj);
    if (pesquisaRepo) await pesquisaRepo.criarRelatorio(obj).catch(e => console.warn('[F8] criarRelatorio PG:', e.message));
    invalidarCacheAba('RELATORIOS_SAC');
    res.json({ sucesso:true, id, versao:maxVersao+1 });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/:id/submeter-revisao', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const row = (await lerRelatoriosSac()).find(r => r.ID_RELATORIO === req.params.id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (row.STATUS !== 'RASCUNHO') return res.status(409).json({ sucesso:false, erro:'Somente rascunhos podem ser submetidos para revisão.' });
    if (_mcEmpresaScope(req.user) && !pertenceEmpresa(_mcEmpresaScope(req.user), row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    await atualizarPorID('RELATORIOS_SAC', row.ID_RELATORIO, { STATUS:'EM_REVISAO', ATUALIZADO_EM:new Date().toISOString(), ATUALIZADO_POR:req.user?.nome||req.user?.usuario||'' }, ['ID_RELATORIO']);
    registrarAuditoria(req.user?.usuario||'sistema','SUBMETEU_RELATORIO_REVISAO',row.ID_RELATORIO,'RELATORIOS_SAC','RASCUNHO','EM_REVISAO').catch(()=>{});
    res.json({ sucesso:true, status:'EM_REVISAO' });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/:id/publicar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','APROVADOR MASTER'), async (req, res) => {
  try {
    const { id } = req.params;
    const { textos, indicador, nps_score } = req.body||{};
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS).catch(()=>{});
    const rows = await lerRelatoriosSac();
    const idx = rows.findIndex(r=>r.ID_RELATORIO===id);
    if (idx<0) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    const row = rows[idx];
    if (!['RASCUNHO','EM_REVISAO'].includes(row.STATUS)) return res.status(409).json({ sucesso:false, erro:'Crie uma revisão antes de publicar novamente.' });
    const empresaScope = _mcEmpresaScope(req.user);
    if (empresaScope && !pertenceEmpresa(empresaScope, row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    const atualizado = {
      STATUS:'PUBLICADO',
      ATUALIZADO_EM:new Date().toISOString(), ATUALIZADO_POR:req.user?.nome||req.user?.usuario||'',
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
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS).catch(()=>{});
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
      CRIADO_EM:new Date().toISOString(), ATUALIZADO_EM:new Date().toISOString(), PUBLICADO_EM:'',
      CRIADO_POR:req.user?.nome||req.user?.usuario||'',
      ATUALIZADO_POR:req.user?.nome||req.user?.usuario||'',
      INDICADOR:orig.INDICADOR||'', NPS_SCORE:orig.NPS_SCORE||'',
      TEXTOS_JSON:orig.TEXTOS_JSON||'', DADOS_JSON:orig.DADOS_JSON||'', MODELO_VERSAO:orig.MODELO_VERSAO||'1', REVISAO_DE:orig.ID_RELATORIO,
    };
    await appendObjeto('RELATORIOS_SAC', novoObj);
    invalidarCacheAba('RELATORIOS_SAC');
    res.json({ sucesso:true, id:novoId, versao:maxVersao+1 });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/relatorios/:id/pdf', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','APROVADOR MASTER','DIRETOR','SETOR DIRETORIA','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    if (!gerarPdfRelatorioSatisfacao) return res.status(503).json({ sucesso:false, erro:'Serviço de PDF indisponível.' });
    const row = (await lerRelatoriosSac()).find(r => r.ID_RELATORIO === req.params.id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (_mcEmpresaScope(req.user) && !pertenceEmpresa(_mcEmpresaScope(req.user), row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    const perfil = perfilCanonico(req.user?.perfil||'');
    if (['DIRETOR','SETOR DIRETORIA','VISUALIZADOR','AUDITOR'].includes(perfil) && row.STATUS !== 'PUBLICADO') return res.status(403).json({ sucesso:false, erro:'Apenas versões publicadas estão disponíveis para consulta.' });
    let dados = {}, textos = {};
    try { dados = JSON.parse(row.DADOS_JSON||'{}'); } catch(_) {}
    try { textos = JSON.parse(row.TEXTOS_JSON||'{}'); } catch(_) {}
    const periodo = new Date(Number(row.ANO), Number(row.MES)-1, 1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const pdf = await gerarPdfRelatorioSatisfacao({ empresa:row.EMPRESA, periodo, versao:row.VERSAO, status:row.STATUS, indicador:row.INDICADOR, nps:row.NPS_SCORE, meta:dados.meta, criterios:dados.criterios||[], textos });
    const nome = `Relatorio_Satisfacao_${String(row.EMPRESA||'Grupo').replace(/[^a-z0-9]+/gi,'_')}_${row.ANO}-${String(row.MES).padStart(2,'0')}.pdf`;
    res.setHeader('Content-Type','application/pdf'); res.setHeader('Content-Disposition',`attachment; filename="${nome}"`); res.send(pdf);
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// Gerar (ou reutilizar) link compartilhável público para o relatório publicado
app.post('/api/relatorios/:id/link', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { id } = req.params;
    const { dados } = req.body||{}; // snapshot JSON dos dados do relatório
    await garantirAbaComCabecalhos('RELATORIOS_SAC', REL_HEADERS).catch(()=>{});
    const rows = await lerRelatoriosSac();
    const row = rows.find(r=>r.ID_RELATORIO===id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
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

// ===== ENVIO E HISTÓRICO DE RELATÓRIOS =====
// O relatório só pode ser enviado depois de publicado. Os destinatários são
// conferidos contra usuários cadastrados; nenhum endereço é inventado pela API.
const REL_ENVIO_HEADERS = ['ID_ENVIO','ID_RELATORIO','EMPRESA','ANO','MES','VERSAO','DESTINATARIOS','MENSAGEM','LINK','POSSUI_PDF','STATUS','CRIADO_EM','CRIADO_POR','ERRO'];

app.get('/api/relatorios/:id/envios', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','APROVADOR MASTER','DIRETOR','SETOR DIRETORIA','VISUALIZADOR','AUDITOR'), async (req, res) => {
  try {
    const row = (await lerRelatoriosSac()).find(r => r.ID_RELATORIO === req.params.id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (_mcEmpresaScope(req.user) && !pertenceEmpresa(_mcEmpresaScope(req.user), row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    const perfilConsulta = perfilCanonico(req.user?.perfil||'');
    if (['DIRETOR','SETOR DIRETORIA','VISUALIZADOR','AUDITOR'].includes(perfilConsulta) && row.STATUS !== 'PUBLICADO') return res.status(403).json({ sucesso:false, erro:'Apenas versões publicadas estão disponíveis para consulta.' });
    const rows = await lerAba('RELATORIO_ENVIOS', 1000).catch(() => []);
    const envios = rows.filter(r => r.ID_RELATORIO === row.ID_RELATORIO).map(r => ({
      id:r.ID_ENVIO, destinatarios: (() => { try { return JSON.parse(r.DESTINATARIOS||'[]'); } catch (_) { return []; } })(),
      mensagem:r.MENSAGEM||'', link:r.LINK||'', possui_pdf:String(r.POSSUI_PDF||'').toUpperCase()==='SIM',
      status:r.STATUS||'', criado_em:r.CRIADO_EM||'', criado_por:r.CRIADO_POR||'', erro:r.ERRO||'', versao:Number(r.VERSAO||row.VERSAO||1)
    }));
    res.json({ sucesso:true, envios });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/:id/enviar', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','APROVADOR MASTER'), async (req, res) => {
  try {
    const { destinatarios = [], mensagem = '', anexar_pdf = false } = req.body || {};
    const row = (await lerRelatoriosSac()).find(r => r.ID_RELATORIO === req.params.id);
    if (!row) return res.status(404).json({ sucesso:false, erro:'Relatório não encontrado.' });
    if (row.STATUS !== 'PUBLICADO') return res.status(409).json({ sucesso:false, erro:'Publique o relatório antes de enviá-lo.' });
    if (_mcEmpresaScope(req.user) && !pertenceEmpresa(_mcEmpresaScope(req.user), row.EMPRESA||'')) return res.status(403).json({ sucesso:false, erro:'Sem acesso a este relatório.' });
    const emails = [...new Set((Array.isArray(destinatarios) ? destinatarios : []).map(v => String(v||'').trim().toLowerCase()).filter(v => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)))];
    if (!emails.length) return res.status(400).json({ sucesso:false, erro:'Selecione ao menos um destinatário com e-mail cadastrado.' });
    const usuarios = await lerAba('USUARIOS', 5000).catch(() => []);
    const cadastrados = new Set(usuarios.map(u => String(u.EMAIL||'').trim().toLowerCase()).filter(Boolean));
    const invalidos = emails.filter(e => !cadastrados.has(e));
    if (invalidos.length) return res.status(400).json({ sucesso:false, erro:'Destinatário não cadastrado: '+invalidos.join(', ') });

    await garantirAbaComCabecalhos('RELATORIO_ENVIOS', REL_ENVIO_HEADERS).catch(() => {});
    const token = row.LINK_TOKEN || require('crypto').randomBytes(18).toString('base64url');
    if (!row.LINK_TOKEN) { await atualizarPorID('RELATORIOS_SAC', row.ID_RELATORIO, { LINK_TOKEN:token }, ['ID_RELATORIO']); invalidarCacheAba('RELATORIOS_SAC'); }
    const link = `${APP_URL}/relatorio-publico/${token}`;
    const id = `ENV-${Date.now().toString(36).toUpperCase()}`;
    const base = { ID_ENVIO:id, ID_RELATORIO:row.ID_RELATORIO, EMPRESA:row.EMPRESA||'', ANO:row.ANO||'', MES:row.MES||'', VERSAO:row.VERSAO||'1', DESTINATARIOS:JSON.stringify(emails), MENSAGEM:String(mensagem||''), LINK:link, POSSUI_PDF:anexar_pdf?'SIM':'NAO', STATUS:'PENDENTE_CONFIGURACAO', CRIADO_EM:new Date().toISOString(), CRIADO_POR:req.user?.nome||req.user?.usuario||'', ERRO:'' };

    if (!_resend) {
      base.ERRO = 'Serviço de e-mail não configurado (RESEND_API_KEY).';
      await appendObjeto('RELATORIO_ENVIOS', base);
      registrarAuditoria(req.user?.usuario||'sistema','RELATORIO_ENVIO_PREPARADO',row.ID_RELATORIO,'RELATORIO_ENVIOS',null,{id,destinatarios:emails}).catch(()=>{});
      return res.status(503).json({ sucesso:false, preparado:true, status:base.STATUS, id, link, erro:base.ERRO });
    }

    const periodo = new Date(Number(row.ANO), Number(row.MES)-1, 1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
    const payload = { from:EMAIL_FROM, to:emails, subject:`Relatório de satisfação — ${row.EMPRESA} — ${periodo}`, html:`<p>${String(mensagem||'Segue o relatório de satisfação para consulta.').replace(/[<>]/g,'')}</p><p><a href="${link}">Abrir relatório</a></p>` };
    if (anexar_pdf && gerarPdfRelatorioSatisfacao) {
      let dados = {}, textos = {}; try { dados=JSON.parse(row.DADOS_JSON||'{}'); } catch (_) {} try { textos=JSON.parse(row.TEXTOS_JSON||'{}'); } catch (_) {}
      const pdf = await gerarPdfRelatorioSatisfacao({ empresa:row.EMPRESA, periodo, versao:row.VERSAO, status:row.STATUS, indicador:row.INDICADOR, nps:row.NPS_SCORE, meta:dados.meta, criterios:dados.criterios||[], textos });
      payload.attachments = [{ filename:`Relatorio_Satisfacao_${String(row.EMPRESA||'Grupo').replace(/[^a-z0-9]+/gi,'_')}_${row.ANO}-${String(row.MES).padStart(2,'0')}.pdf`, content:pdf.toString('base64') }];
    }
    try {
      await _resend.emails.send(payload);
      base.STATUS='ENVIADO';
      await appendObjeto('RELATORIO_ENVIOS', base);
      registrarAuditoria(req.user?.usuario||'sistema','RELATORIO_ENVIADO',row.ID_RELATORIO,'RELATORIO_ENVIOS',null,{id,destinatarios:emails}).catch(()=>{});
      res.json({ sucesso:true, id, status:base.STATUS, link });
    } catch (e) {
      base.STATUS='ERRO'; base.ERRO=erroSeguro(e);
      await appendObjeto('RELATORIO_ENVIOS', base);
      res.status(502).json({ sucesso:false, id, status:base.STATUS, erro:'O serviço de e-mail recusou o envio.' });
    }
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// ===== METAS POR EMPRESA =====
const METAS_HEADERS = ['EMPRESA','META','ATUALIZADO_EM','ATUALIZADO_POR'];

app.get('/api/relatorios/metas', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','APROVADOR MASTER'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('RELATORIOS_METAS', METAS_HEADERS);
    const rows = await lerAba('RELATORIOS_METAS');
    const metas = {};
    for (const r of rows) { if (r.EMPRESA) metas[r.EMPRESA] = parseFloat(r.META)||8.5; }
    res.json({ sucesso:true, metas });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/relatorios/metas', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { empresa, meta } = req.body||{};
    if (!empresa) return res.status(400).json({ sucesso:false, erro:'empresa obrigatória.' });
    const v = parseFloat(meta);
    if (isNaN(v)||v<0||v>10) return res.status(400).json({ sucesso:false, erro:'meta deve ser entre 0 e 10.' });
    await garantirAbaComCabecalhos('RELATORIOS_METAS', METAS_HEADERS);
    const rows = await lerAba('RELATORIOS_METAS');
    const existente = rows.find(r=>r.EMPRESA===empresa);
    const dados = { EMPRESA:empresa, META:String(v), ATUALIZADO_EM:new Date().toISOString(), ATUALIZADO_POR:req.user.usuario };
    if (existente) {
      await atualizarPorID('RELATORIOS_METAS', empresa, dados, ['EMPRESA']);
    } else {
      await appendLinha('RELATORIOS_METAS', dados);
    }
    invalidarCacheAba('RELATORIOS_METAS');
    res.json({ sucesso:true });
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
    const itens = rows
      .filter(r => !scope || pertenceEmpresa(scope, r.EMPRESA||''))
      .map(r => ({ ...r, link: portalEndereco.invite(r.TOKEN), expirado: _tokenExpirado(r) }));
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
<style>@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap');body{margin:0;font-family:Montserrat,system-ui,sans-serif;background:#F4F5F7;color:#2A2A2A;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
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
    const fonteMontserrat = '<head><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet"></head>';
    if (!row) return res.status(404).send(`<html>${fonteMontserrat}<body style="font-family:Montserrat,system-ui,sans-serif;text-align:center;padding:40px"><h2>Link inválido</h2><p>Este link de pesquisa não existe.</p></body></html>`);
    if (_tokenExpirado(row)) return res.status(410).send(`<html>${fonteMontserrat}<body style="font-family:Montserrat,system-ui,sans-serif;text-align:center;padding:40px"><h2>Link expirado</h2><p>Este link de pesquisa expirou.</p></body></html>`);
    if (row.STATUS === 'RESPONDIDO') return res.send(`<html>${fonteMontserrat}<body style="font-family:Montserrat,system-ui,sans-serif;text-align:center;padding:40px"><h2>Pesquisa já respondida</h2><p>Sua resposta já foi registrada. Obrigado!</p></body></html>`);
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
    res.json({ sucesso: true, flagrada: notaBaixa === 'SIM' });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'resposta-token') }); }
});

// Notificações para ANALISTA SAC — pesquisas nota baixa + manifestações do portal
app.get('/api/notificacoes/analista', requerPerfil('MASTER','ANALISTA SAC','GESTOR SAC'), async (req, res) => {
  try {
    const _pf = perfilCanonico(req.user?.perfil||'');
    const scope = _pf === 'MASTER' ? null : (req.user?.empresa||null);
    const [ocps, mans, respostas, leituras] = await Promise.all([
      lerAba('PESQUISA_OCORRENCIAS', 500).catch(()=>[]),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
      lerRespostasPesquisa(),
      lerAba('PESQUISA_NOTIFICACOES_LIDAS', 5000).catch(()=>[]),
    ]);
    const ocpsPendentes = ocps.filter(o =>
      String(o.STATUS||'').toUpperCase() === 'PENDENTE' &&
      (!scope || pertenceEmpresa(scope, o.EMPRESA||''))
    );
    const pesquisasPendentes = respostas.filter(r =>
      String(r.NOTA_BAIXA||'').toUpperCase() === 'SIM' &&
      !['TRANSFORMADA_MANIFESTACAO','NAO_REQUER_TRATAMENTO'].includes(String(r.STATUS_OCP||'').toUpperCase()) &&
      !ocps.some(o => (o.ID_RESPOSTA && o.ID_RESPOSTA === r.ID_RESPOSTA) || (o.TOKEN && r.TOKEN && o.TOKEN === r.TOKEN)) &&
      (!scope || pertenceEmpresa(scope, r.EMPRESA||''))
    );
    const mansPortal = mans.filter(m =>
      m.ORIGEM === 'PORTAL_FUNCIONARIO' &&
      (String(m.STATUS||'').toUpperCase() === 'AGUARDANDO_APROVAÇÃO' || String(m.STATUS||'').toUpperCase() === 'ABERTA' || !m.STATUS) &&
      (!scope || pertenceEmpresa(scope, m.EMPRESA_RECLAMADA||''))
    );
    // O alerta de análise nasce da resposta crítica. OCP só existe após decisão humana.
    const ocpsEnrich = ocpsPendentes.map(o => {
      const resp = respostas.find(r => (o.ID_RESPOSTA && r.ID_RESPOSTA === o.ID_RESPOSTA) || (o.TOKEN && r.TOKEN === o.TOKEN)) || {};
      return { ...o, NOME_CLIENTE: resp.NOME_CLIENTE||o.NOME_CLIENTE||'', NOTA_MEDIA: resp.NOTA_MEDIA||o.NPS||'' };
    });
    const lidas = new Set(leituras.filter(l => l.USUARIO === (req.user?.usuario||'')).map(l => l.ID_EVENTO));
    const notificacoes = [
      ...pesquisasPendentes.map(r => ({
        id: 'PESQ-' + (r.ID_RESPOSTA || r.TOKEN || ''), tipo: 'NOTA_CRITICA',
        titulo: 'Pesquisa com nota igual ou inferior a 6', origem: r.ID_RESPOSTA || '',
        empresa: r.EMPRESA || '', data: r.DATA || '', acao: 'COMENTARIOS', lida: lidas.has('PESQ-' + (r.ID_RESPOSTA || r.TOKEN || '')),
      })),
      ...ocpsPendentes.map(o => {
        const prazo = o.PRAZO ? new Date(o.PRAZO) : null;
        const vencida = prazo && !isNaN(prazo) && prazo < new Date();
        const proxima = prazo && !isNaN(prazo) && prazo >= new Date() && prazo.getTime() - Date.now() <= 7*86400000;
        const tipo = vencida ? 'OCP_VENCIDA' : proxima ? 'OCP_PROXIMA_PRAZO' : 'OCP_ATRIBUIDA';
        const id = tipo + '-' + (o.ID_OCP || '');
        return { id, tipo, titulo: vencida ? 'Ocorrência vencida' : proxima ? 'Ocorrência próxima do vencimento' : 'Ocorrência aguardando tratamento', origem:o.ID_OCP||'', empresa:o.EMPRESA||'', data:o.DATA||'', acao:'OCORRENCIAS', lida:lidas.has(id) };
      }),
      ...mansPortal.map(m => {
        const id = 'MAN-' + (m.ID_MANIFESTACAO || '');
        return { id, tipo:'MANIFESTACAO', titulo:'Manifestação recebida pelo Portal', origem:m.ID_MANIFESTACAO||'', empresa:m.EMPRESA_RECLAMADA||'', data:m.DATA_ABERTURA||m.DATA_REGISTRO||'', acao:'MANIFESTACOES', lida:lidas.has(id) };
      }),
    ].filter(n => n.origem).sort((a,b) => new Date(b.data||0) - new Date(a.data||0));
    res.json({
      sucesso: true,
      total: pesquisasPendentes.length + ocpsPendentes.length + mansPortal.length,
      naoLidas: notificacoes.filter(n => !n.lida).length,
      notificacoes,
      pesquisasBaixas: pesquisasPendentes.length,
      ocpsPendentes: ocpsPendentes.length,
      mansPortal: mansPortal.length,
      pesquisas: pesquisasPendentes.slice(0, 20),
      ocps: ocpsEnrich.slice(0, 20),
      manifestacoes: mansPortal.slice(0, 20).map(m => ({
        id: m.ID_MANIFESTACAO, cliente: m.CLIENTE_NOME||m.NOME_CLIENTE||'', empresa: m.EMPRESA_RECLAMADA||'',
        tipo: m.TIPO_MANIFESTACAO||m.TIPO||'', data: m.DATA_ABERTURA||m.DATA_REGISTRO||'',
        registradoPor: m.REGISTRADO_POR||m.COLABORADOR_RECEBIMENTO||'',
      })),
    });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e) }); }
});

app.post('/api/notificacoes/analista/:id/lida', requerPerfil('MASTER','ANALISTA SAC','GESTOR SAC'), async (req, res) => {
  try {
    const idEvento = String(req.params.id || '').trim().slice(0, 200);
    if (!idEvento) return res.status(400).json({ sucesso:false, erro:'Notificação inválida.' });
    await garantirAbaComCabecalhos('PESQUISA_NOTIFICACOES_LIDAS', ['ID_LEITURA','ID_EVENTO','USUARIO','DATA_LEITURA']);
    const rows = await lerAba('PESQUISA_NOTIFICACOES_LIDAS', 5000).catch(()=>[]);
    const existente = rows.find(r => r.ID_EVENTO === idEvento && r.USUARIO === (req.user?.usuario||''));
    if (!existente) {
      await appendObjeto('PESQUISA_NOTIFICACOES_LIDAS', { ID_LEITURA:'LID-'+Date.now(), ID_EVENTO:idEvento, USUARIO:req.user?.usuario||'', DATA_LEITURA:new Date().toISOString() });
      invalidarCacheAba('PESQUISA_NOTIFICACOES_LIDAS');
    }
    res.json({ sucesso:true, existente:!!existente });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'ler-notificacao') }); }
});

// Listar OCPs (Ocorrências de Pesquisa)
app.get('/api/pesquisas/ocorrencias', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','GESTOR SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PESQUISA_OCORRENCIAS', ['ID_OCP','ID_RESPOSTA','TOKEN','EMPRESA','DATA','NPS','SETOR','RESPONSAVEL','PRAZO','STATUS','DECISAO','JUSTIFICATIVA','ID_MANIFESTACAO_GERADA','ANALISTA','DATA_DECISAO','DESCRICAO','RESULTADO','ENCERRADO_EM','HISTORICO_JSON']);
    const rows = await lerAba('PESQUISA_OCORRENCIAS', 2000);
    const _pf = perfilCanonico(req.user?.perfil||'');
    const scope = _pf === 'MASTER' ? null : (req.user?.empresa||null);
    const itens = rows.filter(r => !scope || pertenceEmpresa(scope, r.EMPRESA||''));
    // Juntar dados da resposta
    const respostas = await lerRespostasPesquisa();
    const enriched = itens.map(ocp => {
      const resp = respostas.find(r => (ocp.ID_RESPOSTA && r.ID_RESPOSTA === ocp.ID_RESPOSTA) || (ocp.TOKEN && r.TOKEN === ocp.TOKEN));
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
body{font-family:Montserrat,system-ui,sans-serif;background:#F5F5F5;color:#1F1F1F;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px 16px 48px}
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
    // F12: tenta PostgreSQL primeiro
    if (conhecimentoRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
        if (req.query.tipo) filtros.tipo = req.query.tipo;
        const sla = await conhecimentoRepo.findSla(filtros);
        if (sla) return res.json({ sucesso: true, total: 1, itens: [sla], fonte: 'postgresql' });
      } catch (e) { console.warn('[F12] GET /sla PG falhou:', e.message); }
    }
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
    if (!escopoPermite(req, empItem)) {
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
    const { q, acao, periodo, usuario, modulo, empresa, pagina, limite } = req.query;
    const data = await lerAba('LOG_SISTEMA', 3000);
    let itens = data.map(r => {
      const vals = Object.values(r);
      const dataHora = r.DATA_HORA || r['DATA/HORA'] || vals[0] || '';
      const dtParts = dataHora.split('T');
      const datePart = dtParts[0] || '';
      const timePart = (dtParts[1] || '').replace(/\.\d+Z?$/, '');
      return {
        DATA_HORA:      dataHora,
        DATA:           datePart ? new Date(datePart + 'T00:00:00').toLocaleDateString('pt-BR') : dataHora.slice(0,10),
        HORA:           timePart.slice(0,5),
        USUARIO:        r.USUARIO     || vals[1] || '',
        ACAO:           r.ACAO        || vals[2] || '',
        ID_REGISTRO:    r.ID_REGISTRO || r.ID_MANIFESTACAO || vals[3] || '',
        ABA:            r.ABA         || r.ENTIDADE || r.TABELA || vals[4] || '',
        VALOR_ANTERIOR: r.VALOR_ANTERIOR || vals[5] || '',
        DETALHES:       r.DETALHES    || r.VALOR_NOVO || vals[6] || vals[5] || '',
      };
    }).filter(r => r.DATA_HORA || r.USUARIO || r.ACAO).reverse();

    // filtro período
    if (periodo && periodo !== 'todos') {
      const diasMap = { hoje: 0, '7': 7, '30': 30, '90': 90 };
      const dias = diasMap[periodo] ?? parseInt(periodo, 10);
      const corte = new Date();
      if (periodo === 'hoje') corte.setHours(0,0,0,0);
      else corte.setDate(corte.getDate() - dias);
      itens = itens.filter(r => { try { return new Date(r.DATA_HORA) >= corte; } catch { return true; } });
    }
    if (acao) itens = itens.filter(r => r.ACAO && r.ACAO.toLowerCase().includes(acao.toLowerCase()));
    if (usuario) itens = itens.filter(r => r.USUARIO && r.USUARIO.toLowerCase().includes(usuario.toLowerCase()));
    if (modulo) itens = itens.filter(r => r.ABA && r.ABA.toLowerCase().includes(modulo.toLowerCase()));
    if (empresa) itens = itens.filter(r => String(r.DETALHES||'').toLowerCase().includes(empresa.toLowerCase()));
    if (q) {
      const ql = q.toLowerCase();
      itens = itens.filter(r => [r.USUARIO,r.ACAO,r.ID_REGISTRO,r.ABA,r.DETALHES].some(v => v && String(v).toLowerCase().includes(ql)));
    }

    const total = itens.length;
    const lim = Math.min(parseInt(limite,10)||200, 500);
    const pag = Math.max(parseInt(pagina,10)||1, 1);
    const inicio = (pag - 1) * lim;
    const paginas = Math.ceil(total / lim);
    res.json({ sucesso:true, total, paginas, pagina:pag, itens: itens.slice(inicio, inicio + lim) });
  }
  catch (e) { res.status(500).json({sucesso:false,erro:erroSeguro(e),dados:[]}); }
});

// Histórico de uma manifestação específica — acessível a analistas (não expõe LOG completo)
app.get('/api/manifestacoes/:id/historico', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req, res) => {
  try {
    const { id } = req.params;
    const [logs, manifest, historicoFicha] = await Promise.all([
      lerAba('LOG_SISTEMA', 2000).catch(() => []),
      lerAba('MANIFESTACOES', 5000).catch(() => []),
      lerAba('HISTORICO_MANIFESTACOES', 3000).catch(() => []),
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
      .filter(r => r.DATA_HORA || r.ACAO)
      .concat(historicoFicha.filter(r => r.ID_MANIFESTACAO === id).map(r => ({
        DATA_HORA:r.DATA_HORA || '', USUARIO:r.USUARIO || '', ACAO:r.ACAO || '', DETALHES:r.DESCRICAO || '', ETAPA:r.ETAPA || ''
      })))
      .sort((a,b) => String(a.DATA_HORA).localeCompare(String(b.DATA_HORA)));
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
    const { getSheets } = require('../server-services/sheets');
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
    const perfil = perfilCanonico(b.perfil);
    const empresas = empresasCanonicas(b.empresa);
    if (perfil !== 'MASTER' && !empresas.length) return res.status(400).json({sucesso:false,erro:'Selecione ao menos uma empresa para liberar o acesso do usuário.'});
    const id=await gerarProximoID('USUARIOS','USR','ID_USUARIO');
    const hash=b.senha ? await hashSenha(b.senha) : '';
    const statusSolicitado = String(b.status || 'ATIVO').toUpperCase();
    // Empresa atribuída é a liberação operacional. Não há uma segunda etapa
    // de aprovação para transformar PRIMEIRO_ACESSO em conta utilizável.
    const status = empresas.length && ['PRIMEIRO_ACESSO','PENDENTE_APROVACAO'].includes(statusSolicitado) ? 'ATIVO' : statusSolicitado;
    const obj={ID_USUARIO:id,USUARIO:b.usuario,EMAIL:b.email||'',NOME:b.nome,CARGO:b.cargo||'',PERFIL:perfil,EMPRESA:b.empresa||'',SETOR:b.setor||'',CODIGO_RCA:b.codigoRCA||'',STATUS:status,SENHA_HASH:hash,DATA_CRIACAO:new Date().toISOString(),ULTIMO_ACESSO:'',PERMISSOES_CUSTOM:Array.isArray(b.permissoes_custom)?JSON.stringify(b.permissoes_custom):'',PERMISSOES_GRANTED:Array.isArray(b.permissoes_granted)?JSON.stringify(b.permissoes_granted):'',PERMISSOES_BLOCKED:Array.isArray(b.permissoes_blocked)?JSON.stringify(b.permissoes_blocked):''};
    await appendObjeto('USUARIOS',obj);
    await registrarAuditoria(req.user.usuario,'CRIOU_USUARIO',id,'USUARIOS',null,{perfil:obj.PERFIL});
    res.json({sucesso:true,usuario:usuarioPublico(obj)});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.patch('/api/usuarios/:id', requerPermissao('usuarios.editar'), async (req,res)=>{
  try{
    const b=req.body||{};
    // O token é indexado pelo login, enquanto a tela costuma enviar o ID.
    // Guardamos as chaves do cadastro para invalidar a sessão certa após uma
    // mudança de empresa, perfil, status ou permissões.
    const precisaInvalidarSessao = ['empresa','EMPRESA','setor','status','perfil','PERFIL','permissoes_granted','permissoes_blocked','senha']
      .some(campo => b[campo] !== undefined);
    const alvoCache = precisaInvalidarSessao
      ? encontrarUsuarioPorIdentificador(await carregarUsuarios(), req.params.id)
      : null;
    // Whitelist de campos permitidos — impede mass assignment
    const dados={};
    if(b.nome!==undefined) dados.NOME=b.nome;
    if(b.email!==undefined) dados.EMAIL=b.email;
    if(b.cargo!==undefined||b.CARGO!==undefined) dados.CARGO=String(b.cargo??b.CARGO??'').trim();
    if(b.setor!==undefined) dados.SETOR=b.setor;
    if(b.status!==undefined) dados.STATUS=String(b.status).toUpperCase();
    if(b.codigoRCA!==undefined) dados.CODIGO_RCA=b.codigoRCA;
    if(b.perfil||b.PERFIL) dados.PERFIL=perfilCanonico(b.perfil||b.PERFIL);
    if(b.empresa!==undefined||b.EMPRESA!==undefined) {
      // Preserva os nomes originais (display names) para que o escopo do usuário
      // seja recarregado corretamente no frontend (checkboxes) sem precisar reverter canonização
      dados.EMPRESA = String(b.empresa||b.EMPRESA||'').trim();
      const empresas = empresasCanonicas(dados.EMPRESA);
      const perfilAlvo = perfilCanonico(b.perfil || b.PERFIL || '');
      if (dados.EMPRESA && !empresas.length) return res.status(400).json({sucesso:false,erro:'Empresa inválida. Selecione uma empresa cadastrada.'});
      // Ao definir empresa para uma conta em primeiro acesso, ela pode operar
      // imediatamente. O preenchimento de perfil continua sendo uma ação do
      // próprio usuário, não uma aprovação administrativa adicional.
      if (empresas.length && ['PRIMEIRO_ACESSO','PENDENTE_APROVACAO'].includes(String(dados.STATUS || '').toUpperCase())) dados.STATUS='ATIVO';
      if (empresas.length && !dados.STATUS && perfilAlvo !== 'MASTER') {
        const atual = await carregarUsuarios();
        const usuarioAtual = encontrarUsuarioPorIdentificador(atual, req.params.id);
        if (['PRIMEIRO_ACESSO','PENDENTE_APROVACAO'].includes(String(usuarioAtual?.STATUS || '').toUpperCase())) dados.STATUS='ATIVO';
      }
    }
    if(b.senha){ dados.SENHA_HASH = await hashSenha(b.senha); }
    if(Array.isArray(b.permissoes_custom)) dados.PERMISSOES_CUSTOM=JSON.stringify(b.permissoes_custom);
    if(Array.isArray(b.permissoes_granted)) dados.PERMISSOES_GRANTED=JSON.stringify(b.permissoes_granted);
    if(Array.isArray(b.permissoes_blocked)) dados.PERMISSOES_BLOCKED=JSON.stringify(b.permissoes_blocked);
    dados.DATA_ULTIMA_ALTERACAO=new Date().toISOString(); dados.ALTERADO_POR=req.user.usuario;
    // Retry com backoff em caso de 429 do Google Sheets
    let resultado=null;
    for(let tentativa=0;tentativa<3;tentativa++){
      try{
        resultado=await atualizarPorID('USUARIOS',req.params.id,dados,['ID_USUARIO','USUARIO','EMAIL']);
        break;
      }catch(err){
        const st=err?.response?.status||err?.code;
        if(st===429&&tentativa<2){ await new Promise(r=>setTimeout(r,(tentativa+1)*2000)); continue; }
        throw err;
      }
    }
    const pgAlvo = usuarioRepo ? (await carregarUsuarios()).find(u => String(u.ID_USUARIO||u.USUARIO||u.EMAIL) === String(req.params.id) || String(u.USUARIO||'') === String(req.params.id) || String(u.EMAIL||'') === String(req.params.id)) : null;
    if(!resultado && !(pgAlvo && pgAlvo._pgId)) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado. Recarregue a lista e tente novamente.'});
    // Usuários provisionados apenas no PostgreSQL precisam de uma linha de
    // espelho na aba administrativa. Sem isso, empresa/setor/perfil/cargo
    // eram aceitos pela API, mas desapareciam no próximo carregamento.
    if (!resultado && pgAlvo?._pgId) {
      await garantirAbaComCabecalhos('USUARIOS', ['ID_USUARIO','USUARIO','EMAIL','NOME','CARGO','PERFIL','EMPRESA','SETOR','STATUS','SENHA_HASH','DATA_CRIACAO','ULTIMO_ACESSO','PERMISSOES_GRANTED','PERMISSOES_BLOCKED','DATA_ULTIMA_ALTERACAO','ALTERADO_POR']);
      await appendObjeto('USUARIOS', {
        ID_USUARIO: pgAlvo.ID_USUARIO || req.params.id,
        USUARIO: pgAlvo.USUARIO || pgAlvo.EMAIL || '',
        EMAIL: b.email !== undefined ? String(b.email).toLowerCase() : (pgAlvo.EMAIL || ''),
        NOME: b.nome !== undefined ? b.nome : (pgAlvo.NOME || ''),
        CARGO: b.cargo !== undefined ? b.cargo : (pgAlvo.CARGO || ''),
        PERFIL: b.perfil !== undefined ? perfilCanonico(b.perfil) : (pgAlvo.PERFIL || ''),
        EMPRESA: b.empresa !== undefined ? String(b.empresa).trim() : (pgAlvo.EMPRESA || ''),
        SETOR: b.setor !== undefined ? String(b.setor).trim() : (pgAlvo.SETOR || ''),
        STATUS: b.status !== undefined ? String(b.status).toUpperCase() : (pgAlvo.STATUS || 'ATIVO'),
        SENHA_HASH: dados.SENHA_HASH || pgAlvo.SENHA_HASH || '',
        DATA_CRIACAO: pgAlvo.DATA_CRIACAO || new Date().toISOString(),
        ULTIMO_ACESSO: pgAlvo.ULTIMO_ACESSO || '',
        PERMISSOES_GRANTED: Array.isArray(b.permissoes_granted) ? JSON.stringify(b.permissoes_granted) : (pgAlvo.PERMISSOES_GRANTED || ''),
        PERMISSOES_BLOCKED: Array.isArray(b.permissoes_blocked) ? JSON.stringify(b.permissoes_blocked) : (pgAlvo.PERMISSOES_BLOCKED || ''),
        DATA_ULTIMA_ALTERACAO: dados.DATA_ULTIMA_ALTERACAO,
        ALTERADO_POR: req.user.usuario,
      });
      resultado = { espelhoCriado: true };
    }
    // Usuários vindos do PostgreSQL não possuem necessariamente uma linha
    // correspondente na planilha. Persista também a edição básica na fonte
    // estruturada para que ela não desapareça no próximo carregamento.
    if (usuarioRepo) {
      const alvo = pgAlvo;
      if (alvo?._pgId) {
        const pgDados = {};
        if (b.nome !== undefined) pgDados.nome = b.nome;
        if (b.email !== undefined) pgDados.email = String(b.email).toLowerCase();
        if (b.senha) pgDados.senhaHash = dados.SENHA_HASH;
        if (b.status !== undefined) pgDados.ativo = !['INATIVO','BLOQUEADO','EXCLUIDO','EXCLUÍDO'].includes(String(b.status).toUpperCase());
        if (Object.keys(pgDados).length) await usuarioRepo.update(alvo._pgId, pgDados).catch(e => console.warn('[PATCH usuario PG]', e.message));
      }
    }
    // Invalida cache de status para mudanças de perfil/status/permissões valerem imediatamente
    [req.params.id, alvoCache?.ID_USUARIO, alvoCache?.USUARIO, alvoCache?.EMAIL]
      .filter(Boolean).forEach(chave => {
        _statusCache.delete(chave);
        _statusCache.delete(normalizarTexto(chave));
      });
    invalidarCacheAba('USUARIOS');
    await registrarAuditoria(req.user.usuario,'ATUALIZOU_USUARIO',req.params.id,'USUARIOS',null,{campos:Object.keys(b)});
    res.json({sucesso:true});
  }catch(e){
    console.error('[PATCH /api/usuarios/:id]', e?.message, e?.response?.status);
    const st = e?.response?.status || e?.code;
    const msg = st === 429
      ? 'Google Sheets sobrecarregado. Aguarde alguns segundos e tente novamente.'
      : st === 403
      ? 'Sem permissão para gravar na planilha. Verifique as credenciais.'
      : erroSeguro(e);
    res.status(500).json({sucesso:false,erro:msg});
  }
});

function encontrarUsuarioPorIdentificador(usuarios, id) {
  const alvo = String(id || '').trim().toLowerCase();
  return usuarios.find(u => [u.ID_USUARIO, u.USUARIO, u.EMAIL, u.id, u.usuario, u.email]
    .some(v => String(v || '').trim().toLowerCase() === alvo));
}

async function persistirDadosUsuario(alvo, dados, req, { permitirSomentePg = false } = {}) {
  const chave = alvo.ID_USUARIO || alvo.USUARIO || alvo.EMAIL;
  let sheetAtualizado = null;
  let sheetErro = null;
  try {
    sheetAtualizado = await atualizarPorID('USUARIOS', chave, dados, ['ID_USUARIO','USUARIO','EMAIL']);
  } catch (e) {
    sheetErro = e;
    if (!alvo._pgId || !permitirSomentePg) throw e;
  }
  // Usuário originado no PostgreSQL pode não ter linha administrativa ainda.
  // Cria o espelho para que status, escopo e permissões não desapareçam no
  // próximo carregamento e para que a revogação seja reconhecida pelo auth.
  if (!sheetAtualizado && alvo._pgId && !permitirSomentePg) {
    await garantirAbaComCabecalhos('USUARIOS', [
      'ID_USUARIO','USUARIO','EMAIL','NOME','CARGO','PERFIL','EMPRESA','SETOR','STATUS',
      'SENHA_HASH','DATA_CRIACAO','ULTIMO_ACESSO','PERMISSOES_GRANTED','PERMISSOES_BLOCKED',
      'COMPETENCIAS','DATA_ULTIMA_ALTERACAO','ALTERADO_POR','DATA_EXCLUSAO','EXCLUIDO_POR','MOTIVO_EXCLUSAO'
    ]);
    await appendObjeto('USUARIOS', {
      ID_USUARIO: alvo.ID_USUARIO || `USR-PG-${alvo._pgId}`,
      USUARIO: alvo.USUARIO || alvo.EMAIL || '', EMAIL: alvo.EMAIL || '', NOME: alvo.NOME || alvo.USUARIO || '',
      CARGO: alvo.CARGO || '', PERFIL: alvo.PERFIL || '', EMPRESA: alvo.EMPRESA || '', SETOR: alvo.SETOR || '',
      STATUS: alvo.STATUS || 'ATIVO', SENHA_HASH: alvo.SENHA_HASH || '', DATA_CRIACAO: alvo.DATA_CRIACAO || '',
      ULTIMO_ACESSO: alvo.ULTIMO_ACESSO || '', ...dados,
    });
    sheetAtualizado = { espelhoCriado: true };
  }
  if (!sheetAtualizado && !alvo._pgId && !permitirSomentePg) {
    const err = sheetErro || new Error('Não foi possível persistir o usuário na fonte oficial.');
    err.code = err.code || 503;
    throw err;
  }
  if (alvo._pgId && usuarioRepo) {
    const pgDados = {};
    if (dados.NOME !== undefined) pgDados.nome = dados.NOME;
    if (dados.EMAIL !== undefined) pgDados.email = String(dados.EMAIL).toLowerCase();
    if (dados.SENHA_HASH !== undefined) pgDados.senhaHash = dados.SENHA_HASH;
    if (dados.STATUS !== undefined) pgDados.ativo = !['INATIVO','BLOQUEADO','EXCLUIDO','EXCLUÍDO'].includes(String(dados.STATUS).toUpperCase());
    if (Object.keys(pgDados).length) await usuarioRepo.update(alvo._pgId, pgDados);
  }
  invalidarCacheAba('USUARIOS');
  invalidarCachePermissoes(alvo.EMAIL || alvo.USUARIO || alvo.ID_USUARIO);
  [alvo.USUARIO, alvo.EMAIL, alvo.ID_USUARIO].filter(Boolean).forEach(chaveAtual => {
    _statusCache.delete(chaveAtual);
    _statusCache.delete(normalizarTexto(chaveAtual));
  });
  return sheetAtualizado;
}

async function persistirStatusUsuario(alvo, status, req, extras = {}) {
  const chave = alvo.ID_USUARIO || alvo.USUARIO || alvo.EMAIL;
  await persistirDadosUsuario(alvo, {
    STATUS: status,
    DATA_ULTIMA_ALTERACAO: new Date().toISOString(),
    ALTERADO_POR: req.user.usuario,
    ...extras,
  }, req);
}

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
    const alvoRefs = new Set([String(alvo.ID_USUARIO||''), String(alvo.USUARIO||''), String(alvo.EMAIL||'')].map(v=>v.trim().toLowerCase()).filter(Boolean));
    const [filaPendente, manifestacoesPendentes] = await Promise.all([
      lerAba('FILA_APROVACAO', 5000).catch(()=>[]),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
    ]);
    const temResponsabilidade = filaPendente.some(item => ['PENDENTE','AGUARDANDO'].includes(String(item.STATUS||'').toUpperCase()) && alvoRefs.has(String(item.ID_APROVADOR||item.RESPONSAVEL||'').trim().toLowerCase()))
      || manifestacoesPendentes.some(item => !['ENCERRADA','ARQUIVADA','CANCELADA'].includes(String(item.STATUS||'').toUpperCase()) && alvoRefs.has(String(item.RESPONSAVEL||item.USUARIO_RESPONSAVEL||item.USUARIO_TRATATIVA||'').trim().toLowerCase()));
    if (temResponsabilidade && String(req.body?.redistribuir || '').toUpperCase() !== 'SIM') {
      return res.status(409).json({sucesso:false,erro:'Usuário possui responsabilidades pendentes. Redistribua os itens antes da exclusão lógica.'});
    }
    const motivo = String(req.body?.motivo || '').trim();
    if (!motivo) return res.status(400).json({sucesso:false,erro:'Informe o motivo da exclusão lógica.'});
    const agoraExclusao = new Date().toISOString();
    await persistirStatusUsuario(alvo, 'EXCLUIDO', req, {
      STATUS:'EXCLUIDO', DATA_ULTIMA_ALTERACAO:agoraExclusao, DATA_EXCLUSAO:agoraExclusao,
      EXCLUIDO_POR:req.user.usuario||'MASTER', MOTIVO_EXCLUSAO:motivo, ALTERADO_POR:req.user.usuario||'MASTER'
    });
    // Um usuário pode ter uma linha administrativa e outra linha legada com
    // o mesmo login/e-mail. Atualiza todas as cópias para que a listagem não
    // reconstitua um registro ATIVO depois da exclusão lógica.
    const refsAlvo = new Set([alvo.ID_USUARIO, alvo.USUARIO, alvo.EMAIL]
      .map(v => String(v || '').trim().toLowerCase()).filter(Boolean));
    const linhasUsuarios = await lerAba('USUARIOS', 5000).catch(() => []);
    for (const linha of linhasUsuarios) {
      const refsLinha = [linha.ID_USUARIO, linha.USUARIO, linha.EMAIL]
        .map(v => String(v || '').trim().toLowerCase()).filter(Boolean);
      if (!refsLinha.some(v => refsAlvo.has(v))) continue;
      const chaveLinha = linha.ID_USUARIO || linha.USUARIO || linha.EMAIL;
      if (!chaveLinha || String(chaveLinha) === String(alvo.ID_USUARIO || alvo.USUARIO || alvo.EMAIL)) continue;
      await atualizarPorID('USUARIOS', chaveLinha, {
        STATUS:'EXCLUIDO', DATA_ULTIMA_ALTERACAO:agoraExclusao, DATA_EXCLUSAO:agoraExclusao,
        EXCLUIDO_POR:req.user.usuario||'MASTER', MOTIVO_EXCLUSAO:motivo, ALTERADO_POR:req.user.usuario||'MASTER'
      }, ['ID_USUARIO','USUARIO','EMAIL']);
    }
    await registrarAuditoria(req.user.usuario,'EXCLUIU_USUARIO',req.params.id,'USUARIOS',null,{nome:alvo.NOME,motivo});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Ações de status (MASTER only)
app.post('/api/usuarios/:id/bloquear', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const todos=await carregarUsuarios();
    const alvo=todos.find(u=>String(u.ID_USUARIO||u.USUARIO||u.EMAIL)===String(req.params.id)||String(u.USUARIO||'')===String(req.params.id)||String(u.EMAIL||'')===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if(normalizarTexto(alvo.USUARIO||alvo.EMAIL)===normalizarTexto(req.user.usuario)) return res.status(400).json({sucesso:false,erro:'Você não pode bloquear sua própria conta.'});
    await persistirStatusUsuario(alvo, 'BLOQUEADO', req);
    await registrarAuditoria(req.user.usuario,'BLOQUEOU_USUARIO',req.params.id,'USUARIOS',null,{motivo:req.body?.motivo||''});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/desbloquear', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const alvo=(await carregarUsuarios()).find(u=>String(u.ID_USUARIO||u.USUARIO||u.EMAIL)===String(req.params.id)||String(u.USUARIO||'')===String(req.params.id)||String(u.EMAIL||'')===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    await persistirStatusUsuario(alvo, 'ATIVO', req);
    await registrarAuditoria(req.user.usuario,'DESBLOQUEOU_USUARIO',req.params.id,'USUARIOS',null,{});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/desativar', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const todos=await carregarUsuarios();
    const alvo=todos.find(u=>String(u.ID_USUARIO||u.USUARIO||u.EMAIL)===String(req.params.id)||String(u.USUARIO||'')===String(req.params.id)||String(u.EMAIL||'')===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if(normalizarTexto(alvo.USUARIO||alvo.EMAIL)===normalizarTexto(req.user.usuario)) return res.status(400).json({sucesso:false,erro:'Você não pode desativar sua própria conta.'});
    await persistirStatusUsuario(alvo, 'INATIVO', req);
    await registrarAuditoria(req.user.usuario,'DESATIVOU_USUARIO',req.params.id,'USUARIOS',null,{});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});
app.post('/api/usuarios/:id/ativar', requerPermissao('usuarios.gerenciar'), async (req,res)=>{
  try{
    if(perfilCanonico(req.user?.perfil||'')!=='MASTER') return res.status(403).json({sucesso:false,erro:'Apenas MASTER.'});
    const alvo=(await carregarUsuarios()).find(u=>String(u.ID_USUARIO||u.USUARIO||u.EMAIL)===String(req.params.id)||String(u.USUARIO||'')===String(req.params.id)||String(u.EMAIL||'')===String(req.params.id));
    if(!alvo) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    await persistirStatusUsuario(alvo, 'ATIVO', req);
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

    const agora = new Date().toISOString();
    const permUpdate = await atualizarPorID('USUARIOS', id, {
      PERMISSOES_GRANTED: JSON.stringify(permissoes_granted),
      PERMISSOES_BLOCKED: JSON.stringify(permissoes_blocked),
      DATA_ULTIMA_ALTERACAO: agora,
      ALTERADO_POR: req.user.usuario,
    }, ['ID_USUARIO','USUARIO','EMAIL']);
    // Usuários provisionados apenas no PostgreSQL ainda precisam de uma linha
    // de preferências na aba USUARIOS para que as permissões granulares sejam
    // carregadas no próximo request.
    if (!permUpdate) {
      await garantirAbaComCabecalhos('USUARIOS', ['ID_USUARIO','USUARIO','EMAIL','NOME','PERFIL','EMPRESA','SETOR','STATUS','PERMISSOES_GRANTED','PERMISSOES_BLOCKED']).catch(()=>{});
      await appendObjeto('USUARIOS', {
        ID_USUARIO: alvo.ID_USUARIO || id,
        USUARIO: alvo.USUARIO || '', EMAIL: alvo.EMAIL || '', NOME: alvo.NOME || '',
        PERFIL: alvo.PERFIL || '', EMPRESA: alvo.EMPRESA || '', SETOR: alvo.SETOR || '', STATUS: alvo.STATUS || 'ATIVO',
        PERMISSOES_GRANTED: JSON.stringify(permissoes_granted), PERMISSOES_BLOCKED: JSON.stringify(permissoes_blocked),
        DATA_ULTIMA_ALTERACAO: agora, ALTERADO_POR: req.user.usuario,
      });
    }

    // Sincroniza PERMISSOES_USUARIO (enforcement real das permissões)
    try {
      const idAlvo = alvo.ID_USUARIO || alvo.USUARIO || alvo.EMAIL || id;
      const emailAlvo = alvo.EMAIL || '';
      const perfilAlvo = perfilCanonico(alvo.PERFIL || alvo.perfil || '');
      const empresaAlvo = alvo.EMPRESA || '';
      const MODULO = 'GERAL';
      const NIVEL = 4;
      const COMPETENCIAS = JSON.stringify(permissoes_granted);
      const STATUS = 'ATIVO';
      const rowsExist = await lerAba('PERMISSOES_USUARIO', 2000).catch(() => []);
      const existente = rowsExist.find(r =>
        String(r.USUARIO_ID||'').toLowerCase() === String(idAlvo||'').toLowerCase() ||
        String(r.USUARIO_EMAIL||'').toLowerCase() === String(emailAlvo||'').toLowerCase()
      );
      const chPerm = existente?.ID_PERMISSAO || existente?.USUARIO_ID || idAlvo;
      if (existente && (existente.ID_PERMISSAO || existente.USUARIO_ID)) {
        await atualizarPorID('PERMISSOES_USUARIO', chPerm, { MODULO, COMPETENCIAS, ATUALIZADO_EM: agora, ATUALIZADO_POR: req.user.usuario }, ['ID_PERMISSAO','USUARIO_ID']);
      } else {
        await appendObjeto('PERMISSOES_USUARIO', {
          ID_PERMISSAO: `PERM-${Date.now()}`, USUARIO_ID: idAlvo, USUARIO_EMAIL: emailAlvo,
          EMPRESA: empresaAlvo, PERFIL: perfilAlvo, MODULO, NIVEL, COMPETENCIAS, STATUS,
          CRIADO_EM: agora, CRIADO_POR: req.user.usuario, ATUALIZADO_EM: agora, ATUALIZADO_POR: req.user.usuario,
        });
      }
      invalidarCacheAba('PERMISSOES_USUARIO');
    } catch(permErr) { console.warn('[permissoes-post] PERMISSOES_USUARIO sync falhou:', permErr.message); }

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
    // SAC: inclui manifestações aguardando aprovação + itens da FILA_APROVACAO pendentes
    const fila = await lerAba('FILA_APROVACAO', 2000).catch(()=>[]);
    const filaPendente = isMasterAprov
      ? fila.filter(f=>f.STATUS==='PENDENTE'&&f.TIPO_ENTIDADE==='SAC')
      : fila.filter(f=>f.STATUS==='PENDENTE'&&f.TIPO_ENTIDADE==='SAC'&&(n(f.ID_APROVADOR)===n(apId)||n(f.NOME_APROVADOR)===n(usuario)));
    const _sacBase=m=>!['ENCERRADA','CONCLUÍDA','CONCLUIDA','CANCELADA','REJEITADA'].includes(String(m.STATUS||'').toUpperCase())&&(m.STATUS==='AGUARDANDO_APROVAÇÃO'||m.STATUS==='AGUARDANDO_DECISÃO'||m.STATUS_FICHA==='AGUARDANDO_APROVACAO'||m.APROVACAO_NECESSARIA==='SIM');
    const sacDireto=mans.filter(m=>{
      if(!_sacBase(m)) return false;
      if(isMasterAprov) return true;
      // APROVADOR normal: filtra pela empresa e/ou competência vinculada
      const empOk=!empresas.length||empresas.some(e=>n(e)===n(m.EMPRESA_RECLAMADA||m.EMPRESA||''));
      const compOk=!compNames.length||compNames.some(c=>n(c)===n(m.COMPETENCIA||m.SETOR||m.TIPO||''));
      return empOk&&compOk;
    });
    // Merge sem duplicatas (por ID_MANIFESTACAO)
    const sacIds = new Set(sacDireto.map(m=>m.ID_MANIFESTACAO));
    const sacDeFila = filaPendente.filter(f=>!sacIds.has(f.ID_ENTIDADE)).map(f=>{
      const man=mans.find(m=>m.ID_MANIFESTACAO===f.ID_ENTIDADE)||{};
      return {...man, ID_MANIFESTACAO:f.ID_ENTIDADE, _filaId:f.ID_FILA, STATUS:'AGUARDANDO_APROVACAO', STATUS_FICHA:'AGUARDANDO_APROVACAO', EMPRESA_RECLAMADA: f.EMPRESA||man.EMPRESA_RECLAMADA||'', DESCRICAO: f.DESCRICAO||man.DESCRICAO||''};
    });
    const sac=[...sacDireto,...sacDeFila];
    const sugestoes=(await lerAba('SUGESTOES_APROVADOR',5000).catch(()=>[])).filter(x=>n(x.ID_APROVADOR)===n(apId));
    res.json({sucesso:true,usuario,aprovador:ap,competencias:compNames,empresas,rnc,sac,sugestoes,totais:{rnc:rnc.length,sac:sac.length,total:rnc.length+sac.length}});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.get('/api/setor/minhas-pendencias', requerPerfil('SETOR RESPONSÁVEL','MASTER'), async (req,res)=>{
  try{
    const setor=normalizarTexto(req.user.setor||'');
    const [rncs, mans] = await Promise.all([
      lerAba('BANCO_RNC',5000).catch(()=>[]),
      lerAba('MANIFESTACOES',5000).catch(()=>[]),
    ]);
    const rncsF = rncs.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(!setor||normalizarTexto(r.SETOR||r.SETOR_ACAO)===setor)).map(r=>({...r,_tipo:'RNC'}));
    const STATUSES_SETOR = ['AGUARDANDO_SETOR','AGUARDANDO SETOR','AGUARDANDO_VALIDACAO_SAC'];
    const mansF = mans.filter(m=>{
      const st = (m.STATUS||'').toUpperCase().replace(/\s+/g,'_');
      if (!STATUSES_SETOR.includes(st) && !STATUSES_SETOR.includes((m.STATUS||'').toUpperCase())) return false;
      if (!setor) return true;
      const setorM = normalizarTexto(m.SETOR_DESTINADO||m.SETOR_CONFIRMADO||m.SETOR_SUGERIDO||'');
      return setorM === setor;
    }).map(m=>({...m,_tipo:'MANIFESTACAO'}));
    const itens=[...rncsF,...mansF];
    res.json({sucesso:true,total:itens.length,itens,totalRnc:rncsF.length,totalManifestacoes:mansF.length});
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

// Evidências da manifestação: a ficha completa usa o mesmo vínculo para
// anexos enviados pelo portal e arquivos adicionados internamente.
app.get('/api/manifestacoes/:id/evidencias', middlewareEscopoEmpresa(), requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR SAC','ATENDENTE SAC','AUDITOR'), async (req,res) => {
  try {
    const id = String(req.params.id || '').trim();
    const mans = await lerAba('MANIFESTACOES', 5000).catch(() => []);
    const man = mans.find(m => String(m.ID_MANIFESTACAO || '').trim() === id || String(m.PROTOCOLO || '').trim() === id);
    if (!man) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.', itens:[] });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, man.EMPRESA_RECLAMADA || man.EMPRESA_RECLAMANTE || '')) {
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.', itens:[] });
    }
    const [evs, anexos] = await Promise.all([
      lerAba('EVIDENCIAS', 5000).catch(() => []),
      lerAba('ANEXOS', 5000).catch(() => []),
    ]);
    const ids = new Set([id, man.ID_MANIFESTACAO, man.PROTOCOLO].filter(Boolean).map(String));
    const itens = [
      ...evs.filter(e => ids.has(String(e.ID_MANIFESTACAO || '').trim())).map(e => ({ nome:e.NOME || e.NOME_ARQUIVO, mimeType:e.TIPO_MIME || e.MIME_TYPE, tamanho:e.TAMANHO, url:e.DRIVE_URL || e.URL_ARQUIVO, data:e.DATA_UPLOAD, origem:'evidencia' })),
      ...anexos.filter(a => ids.has(String(a.ID_ENTIDADE || '').trim())).map(a => ({ nome:a.NOME_ARQUIVO || a.NOME, mimeType:a.MIME_TYPE || a.TIPO_MIME, tamanho:a.TAMANHO, url:a.URL_ARQUIVO || a.DRIVE_URL, data:a.DATA_UPLOAD, origem:'anexo' })),
    ];
    res.json({ sucesso:true, itens });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'manifestacao-evidencias'), itens:[] }); }
});
app.post('/api/anexos', requerPerfil('MASTER','ANALISTA SAC'), async (req,res) => {
  try {
    const {arquivo,tipoEntidade,idEntidade,usuario,categoria}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const item=await salvarAnexo({...arquivo,categoria},{tipoEntidade,idEntidade,usuario});
    res.json({sucesso:true,anexo:item});
  } catch(e){
    const status = e?.code === 'ERR_VALIDACAO_ARQUIVO' ? 400 : e?.code === 'ERR_INTEGRACAO_CONFIG' ? 503 : 500;
    res.status(status).json({sucesso:false,erro:erroSeguro(e)});
  }
});

// ===== DOCUMENTOS =====
app.post('/api/documentos/extrair', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res) => {
  try {
    const {arquivo,tipoDocumento='FICHA_RECLAMACAO'}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const dados=await documentService.extrairDadosDocumento(arquivo,tipoDocumento);
    res.json({sucesso:true,tipoDocumento,dados,validacaoObrigatoria:true});
  } catch(e){
    const status = e?.code === 'ERR_VALIDACAO_ARQUIVO' ? 400 : e?.code === 'ERR_INTEGRACAO_CONFIG' ? 503 : e?.code === 'ERR_JSON_EXTRACAO' ? 422 : 500;
    res.status(status).json({sucesso:false,erro:erroSeguro(e)});
  }
});

// ===== CIRCA DETERMINÍSTICO =====
// Organiza captura, investigação, resolução, conhecimento e aprimoramento
// usando apenas dados persistidos. A IA continua sendo apoio opcional.
app.get('/api/manifestacoes/:id/circa', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const idReq = String(req.params.id || '').trim();
    const [manifestacoes, tratativas, devolutivas, matriz, causas] = await Promise.all([
      lerAba('MANIFESTACOES', 5000).catch(() => []),
      lerAba('TRATATIVAS_SETORIAIS', 5000).catch(() => []),
      lerAba('DEVOLUTIVAS', 5000).catch(() => []),
      lerAba('MATRIZ_TRATAMENTO', 5000).catch(() => []),
      lerAba('CAUSAS_SUBCAUSAS', 5000).catch(() => []),
    ]);
    const m = manifestacoes.find(r => [r.ID_MANIFESTACAO, r.PROTOCOLO, r.ID, r.ID_ORIGINAL]
      .some(v => String(v || '').trim() === idReq));
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || ''))
      return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const similares = await cerebroService.buscarCasosSimilares(m, 8, req.user?.EMPRESA || null).catch(() => []);
    const resultado = circaEngine.analisar({
      manifestacao: m,
      similares,
      tratamentos: matriz.filter(r => !m.EMPRESA_RECLAMADA || pertenceEmpresa(String(m.EMPRESA_RECLAMADA), r.EMPRESA || r.EMPRESA_RECLAMADA || '')),
      causas: causas.filter(r => !m.EMPRESA_RECLAMADA || pertenceEmpresa(String(m.EMPRESA_RECLAMADA), r.EMPRESA || r.EMPRESA_RECLAMADA || '')),
      tratativa: tratativas.filter(r => r.ID_MANIFESTACAO === (m.ID_MANIFESTACAO || idReq)).slice(-1)[0],
      devolutiva: devolutivas.filter(r => r.ID_MANIFESTACAO === (m.ID_MANIFESTACAO || idReq)).slice(-1)[0],
    });
    res.json({ sucesso:true, circa:resultado });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'circa') }); }
});

// Atualiza os dados operacionais da ficha CIRCA sem criar uma segunda manifestação.
app.patch('/api/manifestacoes/:id/circa-dados', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const idReq=String(req.params.id||'').trim();
    const rows=await lerAba('MANIFESTACOES',5000).catch(()=>[]);
    const m=rows.find(r=>[r.ID_MANIFESTACAO,r.PROTOCOLO,r.ID,r.ID_ORIGINAL].some(v=>String(v||'').trim()===idReq));
    if(!m) return res.status(404).json({sucesso:false,erro:'Manifestação não encontrada.'});
    if(req._empresaScope && !pertenceEmpresa(req._empresaScope,m.EMPRESA_RECLAMADA||'')) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
    const requestedStage=Number(req.body?.ETAPA_ATUAL||0);
    const currentStage=circaWorkflow.stageForStatus(m.STATUS||m.STATUS_FICHA||'RASCUNHO');
    if(requestedStage && (!Number.isInteger(requestedStage)||requestedStage<1||requestedStage>7)) return res.status(400).json({sucesso:false,erro:'Etapa CIRCA inválida.'});
    if(requestedStage && requestedStage>currentStage+1 && String(req.user?.PERFIL||req.user?.perfil||'').toUpperCase()!=='MASTER') return res.status(409).json({sucesso:false,erro:'A etapa solicitada depende da conclusão das etapas anteriores.',etapaAtual:currentStage});
    const allowed=['STATUS','STATUS_FICHA','EMPRESA_RECLAMADA','EMPRESA_RECLAMANTE','CONTATO','CNPJ','TELEFONE','EMAIL','PRODUTO','LOTE','NFE','DESCRICAO','DESCRICAO_MANIFESTACAO','TIPO','CANAL','ORIGEM','PRIORIDADE','CATEGORIA','MOTIVO','GRAVIDADE','ETAPA_ATUAL','MENSAGEM_ETAPA','CAMINHO_TRATATIVA','COMPLEMENTO_PEDIDO','CANAL_RETORNO','PRAZO_RETORNO_SAC','TRATATIVA_SAC_INTERNA','SETOR_ACIONADO','ESCOPO_ACIONAMENTO','INVESTIGACAO_O_QUE','INVESTIGACAO_VERIFICACOES','INVESTIGACAO_EVIDENCIAS','INVESTIGACAO_NOTAS','SUBCAUSA','CAUSA_RAIZ_CONFIRMADA','ACOES_CORRETIVAS','DATA_SOLUCAO','RESPONSAVEL_EXECUCAO','VALIDACAO_RESULTADO','PROCEDENTE','PROCEDENTE_JUSTIFICATIVA','VALID_SAC_DATA_RETORNO','VALID_SAC_CLIENTE_INFORMADO','VALID_SAC_RESOLVIDA','RESUMO_RESOLUCAO','DEVOLUTIVA_CANAL','DEVOLUTIVA_DESTINATARIO','DEVOLUTIVA_FINAL','DEVOLUTIVA_ENVIADA','APRENDIZADO_CASO','APRENDIZADO_MATRIZ','OBSERVACOES_FINAIS','STATUS_TRATATIVA','ANEXOS','EVIDENCIAS'];
    const patch={}; for(const key of allowed) if(Object.prototype.hasOwnProperty.call(req.body||{},key)) patch[key]=req.body[key] ?? '';
    if (req.body?.finalizar) {
      patch.PROTOCOLO = m.PROTOCOLO || await gerarProtocoloFicha(m.EMPRESA_RECLAMADA || '', m.CANAL || 'MANUAL', new Date().toISOString());
      patch.STATUS = 'AGUARDANDO_TRIAGEM_SAC'; patch.STATUS_FICHA = 'ABERTA'; patch.ETAPA_ATUAL = '2';
      patch.MENSAGEM_ETAPA = 'Aguardando triagem SAC.';
    }
    patch.DATA_ULTIMA_EDICAO=new Date().toISOString(); patch.ATUALIZADO_POR=req.user?.usuario||'sistema';
    await atualizarPorID('MANIFESTACOES',m.ID_MANIFESTACAO||idReq,patch,['ID_MANIFESTACAO','PROTOCOLO','ID']);
    await registrarHistoricoManifestacao({id:m.ID_MANIFESTACAO||idReq,protocolo:m.PROTOCOLO||'',usuario:req.user?.usuario||'sistema',etapa:patch.ETAPA_ATUAL||m.ETAPA_ATUAL||'',acao:'ATUALIZOU_CARD_CIRCA',descricao:'Dados operacionais atualizados no novo card.'});
    res.json({sucesso:true,id:m.ID_MANIFESTACAO||idReq,atualizadoEm:patch.DATA_ULTIMA_EDICAO});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e,'dados circa')});}
});

// ===== FLUXO OPERACIONAL CIRCA =====
// Os registros abaixo reutilizam a manifestação e as abas operacionais legadas.
// Nenhum acionamento cria uma segunda ficha.
const ACIONAMENTOS_HEADERS = ['ID_ACIONAMENTO','ID_MANIFESTACAO','PROTOCOLO','TIPO','EMPRESA','SETOR_SOLICITANTE','SETOR_DESTINO','RESPONSAVEL','ASSUNTO','MOTIVO','TAREFA','PERGUNTAS','PRAZO','PRIORIDADE','EVIDENCIAS','OBSERVACOES','RESPOSTA','STATUS','CRIADO_EM','CRIADO_POR','ATUALIZADO_EM','ATUALIZADO_POR','IDEMPOTENCY_KEY'];
const ACIONAMENTO_STATUSES = ['CRIADO','ENVIADO','PENDENTE_DE_ATRIBUICAO','AGUARDANDO_CIENCIA','EM_ANDAMENTO','AGUARDANDO_INFORMACAO','RESPONDIDO','EM_REVISAO','CONCLUIDO','CANCELADO'];
const ACIONAMENTO_TYPES = ['NOTIFICACAO','SOLICITACAO_INFORMACAO','SOLICITACAO_APOIO','ENCAMINHAMENTO_TRATATIVA','ESCALONAMENTO'];
const NOTIFICACOES_INTERNAS_HEADERS = ['ID_NOTIFICACAO','ID_MANIFESTACAO','ID_ACIONAMENTO','DESTINATARIO','CANAL','TIPO','TITULO','MENSAGEM','STATUS','CRIADO_EM','CRIADO_POR'];

function empresasDoCadastro(row = {}) {
  try { const parsed = JSON.parse(row.EMPRESAS_JSON || '[]'); if (Array.isArray(parsed)) return parsed; } catch (_) {}
  return [row.EMPRESA || ''].filter(Boolean);
}
async function gestorCompetente({ setor, empresa }) {
  const gerentes = await lerAba('GERENTES', 2000).catch(() => []);
  const empresaNorm = empresaCanonica(empresa || '');
  return gerentes.find(g => {
    if (String(g.ATIVO || 'SIM').toUpperCase() !== 'SIM') return false;
    const empresas = empresasDoCadastro(g).map(empresaCanonica);
    return !empresas.length || empresas.includes(empresaNorm) || empresas.includes('MASTER');
  }) || null;
}
async function registrarNotificacaoInterna({ manifestacaoId, acionamentoId, destinatario, tipo, titulo, mensagem, usuario }) {
  if (!destinatario) return null;
  await garantirAbaComCabecalhos('NOTIFICACOES_INTERNAS', NOTIFICACOES_INTERNAS_HEADERS);
  const item = { ID_NOTIFICACAO:`NTF-${Date.now()}-${Math.random().toString(36).slice(2,7)}`, ID_MANIFESTACAO:manifestacaoId, ID_ACIONAMENTO:acionamentoId, DESTINATARIO:destinatario, CANAL:'INTERNO', TIPO:tipo, TITULO:titulo, MENSAGEM:mensagem, STATUS:'PENDENTE', CRIADO_EM:new Date().toISOString(), CRIADO_POR:usuario || 'sistema' };
  await appendObjeto('NOTIFICACOES_INTERNAS', item);
  return item;
}

async function circaManifestacao(id) {
  const rows = await lerAba('MANIFESTACOES', 5000).catch(() => []);
  return rows.find(row => [row.ID_MANIFESTACAO, row.PROTOCOLO, row.ID, row.ID_ORIGINAL].some(v => String(v || '').trim() === String(id || '').trim()));
}

app.get('/api/manifestacoes/:id/acionamentos', requerPermissao('manifestacoes.visualizar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const m = await circaManifestacao(req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || '')) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const rows = await lerAba('ACIONAMENTOS_INTERNOS', 5000).catch(() => []);
    const id = m.ID_MANIFESTACAO || req.params.id;
    res.json({ sucesso:true, itens:rows.filter(row => String(row.ID_MANIFESTACAO) === String(id)), statuses:ACIONAMENTO_STATUSES, tipos:ACIONAMENTO_TYPES });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'acionamentos') }); }
});

app.post('/api/manifestacoes/:id/acionamentos', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const m = await circaManifestacao(req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || '')) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const body = req.body || {};
    const tipo = String(body.tipo || '').toUpperCase();
    if (!ACIONAMENTO_TYPES.includes(tipo)) return res.status(400).json({ sucesso:false, erro:'Tipo de acionamento inválido.' });
    if (!body.setorDestino && tipo !== 'NOTIFICACAO') return res.status(400).json({ sucesso:false, erro:'Setor destinatário é obrigatório.' });
    if (tipo !== 'NOTIFICACAO' && !body.tarefa && !body.motivo) return res.status(400).json({ sucesso:false, erro:'Informe o que precisa ser feito ou o motivo.' });
    // Escalonamento só existe quando há gestor cadastrado para a empresa. Nunca
    // inventamos um destinatário nem fingimos que a notificação foi entregue.
    const gestor = tipo === 'ESCALONAMENTO'
      ? await gestorCompetente({ setor:body.setorDestino, empresa:m.EMPRESA_RECLAMADA })
      : null;
    if (tipo === 'ESCALONAMENTO' && !gestor) {
      return res.status(422).json({ sucesso:false, codigo:'GESTOR_NAO_CADASTRADO', erro:'Não há gestor ativo cadastrado para esta empresa. Regularize o cadastro antes de escalar.' });
    }
    if (body.responsavel) {
      const usuarios = await lerAba('USUARIOS', 5000).catch(() => []);
      const alvo = usuarios.find(u => String(u.USUARIO || u.EMAIL || u.LOGIN || '').toLowerCase() === String(body.responsavel).toLowerCase());
      if (!alvo || String(alvo.STATUS || 'ATIVO').toUpperCase() !== 'ATIVO') return res.status(400).json({ sucesso:false, erro:'Responsável inexistente ou inativo.' });
    }
    await garantirAbaComCabecalhos('ACIONAMENTOS_INTERNOS', ACIONAMENTOS_HEADERS);
    const existing = body.idempotencyKey ? (await lerAba('ACIONAMENTOS_INTERNOS', 5000).catch(() => [])).find(r => String(r.IDEMPOTENCY_KEY || '') === String(body.idempotencyKey)) : null;
    if (existing) return res.status(200).json({ sucesso:true, duplicado:true, item:existing });
    const agora = new Date().toISOString();
    const item = {
      ID_ACIONAMENTO: await gerarProximoID('ACIONAMENTOS_INTERNOS','ACI','ID_ACIONAMENTO'),
      ID_MANIFESTACAO: m.ID_MANIFESTACAO || req.params.id, PROTOCOLO:m.PROTOCOLO || '', TIPO:tipo,
      EMPRESA:m.EMPRESA_RECLAMADA || body.empresa || '', SETOR_SOLICITANTE:body.setorSolicitante || req.user?.setor || 'SAC',
      SETOR_DESTINO:body.setorDestino || '', RESPONSAVEL:body.responsavel || gestor?.USUARIO || gestor?.EMAIL || gestor?.NOME || '', ASSUNTO:body.assunto || '', MOTIVO:body.motivo || '',
      TAREFA:body.tarefa || '', PERGUNTAS:Array.isArray(body.perguntas) ? JSON.stringify(body.perguntas) : (body.perguntas || ''),
      PRAZO:tipo === 'NOTIFICACAO' ? '' : (body.prazo || ''), PRIORIDADE:body.prioridade || 'NORMAL',
      EVIDENCIAS:Array.isArray(body.evidencias) ? JSON.stringify(body.evidencias) : (body.evidencias || ''), OBSERVACOES:body.observacoes || '',
      STATUS:tipo === 'NOTIFICACAO' ? 'ENVIADO' : (body.responsavel ? 'ENVIADO' : 'PENDENTE_DE_ATRIBUICAO'),
      CRIADO_EM:agora, CRIADO_POR:req.user?.usuario || 'sistema', ATUALIZADO_EM:agora, ATUALIZADO_POR:req.user?.usuario || 'sistema', IDEMPOTENCY_KEY:body.idempotencyKey || '',
    };
    await appendObjeto('ACIONAMENTOS_INTERNOS', item);
    await registrarHistoricoManifestacao({ id:item.ID_MANIFESTACAO, protocolo:item.PROTOCOLO, acao:'ACIONAMENTO_CRIADO', descricao:`${tipo} para ${item.SETOR_DESTINO || 'destinatário informado'}`, usuario:req.user?.usuario || 'sistema', etapa:'CONDUCAO' });
    await registrarAuditoria(req.user?.usuario || 'sistema', 'CRIOU_ACIONAMENTO', item.ID_MANIFESTACAO, 'ACIONAMENTOS_INTERNOS', null, item);
    const destinatario = item.RESPONSAVEL || item.SETOR_DESTINO;
    const notificacao = await registrarNotificacaoInterna({ manifestacaoId:item.ID_MANIFESTACAO, acionamentoId:item.ID_ACIONAMENTO, destinatario, tipo, titulo:`${tipo.replace(/_/g,' ')} — ${item.PROTOCOLO || item.ID_MANIFESTACAO}`, mensagem:item.MOTIVO || item.TAREFA, usuario:req.user?.usuario });
    res.status(201).json({ sucesso:true, item, notificacao });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'acionamentos') }); }
});

app.patch('/api/manifestacoes/:id/acionamentos/:acionamentoId', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const m = await circaManifestacao(req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || '')) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const rows = await lerAba('ACIONAMENTOS_INTERNOS', 5000).catch(() => []);
    const item = rows.find(r => String(r.ID_ACIONAMENTO) === String(req.params.acionamentoId) && String(r.ID_MANIFESTACAO) === String(m.ID_MANIFESTACAO || req.params.id));
    if (!item) return res.status(404).json({ sucesso:false, erro:'Acionamento não encontrado.' });
    const next = String(req.body?.status || '').toUpperCase();
    if (!ACIONAMENTO_STATUSES.includes(next)) return res.status(400).json({ sucesso:false, erro:'Status de acionamento inválido.' });
    const agora = new Date().toISOString();
    await atualizarPorID('ACIONAMENTOS_INTERNOS', item.ID_ACIONAMENTO, { STATUS:next, ATUALIZADO_EM:agora, ATUALIZADO_POR:req.user?.usuario || 'sistema', RESPOSTA:req.body?.resposta || item.RESPOSTA || '', EVIDENCIAS:req.body?.evidencias || item.EVIDENCIAS || '' }, ['ID_ACIONAMENTO']);
    await registrarHistoricoManifestacao({ id:item.ID_MANIFESTACAO, protocolo:item.PROTOCOLO, acao:'ACIONAMENTO_ATUALIZADO', descricao:`${item.ID_ACIONAMENTO}: ${next}`, usuario:req.user?.usuario || 'sistema', etapa:'CONDUCAO' });
    res.json({ sucesso:true, item:{ ...item, STATUS:next, ATUALIZADO_EM:agora } });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'acionamentos') }); }
});

app.post('/api/manifestacoes/:id/transicao-circa', requerPermissao('manifestacoes.editar'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const m = await circaManifestacao(req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, m.EMPRESA_RECLAMADA || '')) return res.status(403).json({ sucesso:false, erro:'Acesso não autorizado.' });
    const to = circaWorkflow.normalizeStatus(req.body?.status);
    const from = circaWorkflow.normalizeStatus(m.STATUS || m.STATUS_FICHA);
    if (!circaWorkflow.canTransition(from, to)) return res.status(409).json({ sucesso:false, erro:`Transição não permitida: ${from} → ${to}.`, status:from });
    const etapa = circaWorkflow.stageForStatus(to);
    const agora = new Date().toISOString();
    await atualizarPorID('MANIFESTACOES', m.ID_MANIFESTACAO || req.params.id, { STATUS:to, ETAPA_ATUAL:String(etapa), DATA_ULTIMA_EDICAO:agora }, ['ID_MANIFESTACAO','PROTOCOLO','ID']);
    await registrarHistoricoManifestacao({ id:m.ID_MANIFESTACAO || req.params.id, protocolo:m.PROTOCOLO || '', acao:'TRANSICAO_CIRCA', descricao:`${from} → ${to}`, usuario:req.user?.usuario || 'sistema', etapa:circaWorkflow.STAGES[etapa - 1]?.id || '' });
    res.json({ sucesso:true, status:to, etapaAtual:etapa });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'transicao circa') }); }
});

// ===== ANÁLISE IA POR MANIFESTAÇÃO =====
app.get('/api/manifestacoes/:id/analise', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), middlewareEscopoEmpresa(), async (req,res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    // A listagem pode expor o protocolo como identificador (principalmente
    // quando a fonte é PostgreSQL), enquanto a planilha legada mantém o
    // identificador interno em ID_MANIFESTACAO. Aceite ambos os contratos.
    const idReq = String(req.params.id || '').trim();
    const m = data.find(r => [r.ID_MANIFESTACAO, r.PROTOCOLO, r.ID, r.ID_ORIGINAL]
      .some(v => String(v || '').trim() === idReq));
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
    if(!escopoPermite(req, _manS.EMPRESA_RECLAMADA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para esta manifestação.'});
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

// ===== CICLO DE APRENDIZADO OPERACIONAL (CÉREBRO) =====
// Catálogos persistidos no Sheets e reutilizados pela ficha, tratativas e devolutivas.
const CEREBRO_CAUSAS_HEADERS = ['ID_CAUSA','CATEGORIA','TIPO','CAUSA','SUBCAUSA','DESCRICAO','SINONIMOS','SETOR_RESPONSAVEL','PALAVRAS_CHAVE','ATIVO','VERSAO','DATA_CRIACAO','CRIADO_POR','ATUALIZADO_EM'];
const CEREBRO_TRAT_HEADERS = ['ID_TRATAMENTO','EMPRESA','CATEGORIA','CAUSA_ID','CAUSA','SUBCAUSA','SETOR_RESPONSAVEL','PROCEDIMENTO','CONDICOES','EVIDENCIAS','AUTORIZACOES','CRITERIOS_CONCLUSAO','STATUS','VERSAO','CRIADO_EM','CRIADO_POR','ATUALIZADO_EM'];
const CEREBRO_APR_HEADERS = ['ID_APRIMORAMENTO','TIPO','REGISTRO_ID','ID_MANIFESTACAO','DESCRICAO','JUSTIFICATIVA','STATUS','VERSAO_NOVA','CRIADO_EM','CRIADO_POR','APROVADO_EM','APROVADO_POR'];
const CEREBRO_MODELO_HEADERS = ['ID_MODELO','TITULO','EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','TIPO_DEVOLUTIVA','SITUACAO','ASSUNTO','TEXTO_PADRAO','VARIAVEIS','RESTRICOES','VERSAO','STATUS','CRIADO_EM','CRIADO_POR','APROVADO_EM','APROVADO_POR'];

function _cNorm(v) { return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(); }
function _cCsv(v) { return Array.isArray(v) ? v.join('; ') : String(v || ''); }
function _cScopeRows(req, rows) {
  const scope = req._empresaScope;
  if (!scope) return rows;
  return rows.filter(r => !r.EMPRESA || pertenceEmpresa(scope, r.EMPRESA));
}
function _cCanWrite(req) { return ['MASTER','GESTOR SAC','ANALISTA SAC'].includes(perfilCanonico(req.user?.perfil || '')); }

app.get('/api/cerebro/matriz-operacional', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','AUDITOR','CONSULTA'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const q = _cNorm(req.query.q), aba = String(req.query.aba || 'causas');
    const [causas, tratamentos, aprimoramentos] = await Promise.all([
      lerAba('CAUSAS', 5000).catch(()=>[]), lerAba('MATRIZ_TRATAMENTO', 5000).catch(()=>[]), lerAba('APRIMORAMENTOS_CEREBRO', 5000).catch(()=>[]),
    ]);
    const filtra = rows => _cScopeRows(req, rows).filter(r => !q || _cNorm(Object.values(r).join(' ')).includes(q));
    const rows = aba === 'tratamentos' ? filtra(tratamentos) : aba === 'aprimoramentos' ? filtra(aprimoramentos) : filtra(causas);
    const page = Math.max(1, Number(req.query.page || 1)), limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
    res.json({ sucesso:true, aba, itens:rows.slice((page-1)*limit,page*limit), total:rows.length, page, limit, causas:filtra(causas).length, tratamentos:filtra(tratamentos).length, aprimoramentos:filtra(aprimoramentos).length });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e), itens:[] }); }
});

app.get('/api/cerebro/causas/consultar', requerPermissao('base-conhecimento.visualizar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const q=_cNorm(req.query.q), rows=_cScopeRows(req, await lerAba('CAUSAS',5000).catch(()=>[])).filter(r=>String(r.ATIVO||'SIM').toUpperCase()!=='NAO');
    const itens=rows.filter(r=>!q||_cNorm([r.CAUSA,r.SUBCAUSA,r.CATEGORIA,r.SINONIMOS,r.PALAVRAS_CHAVE].join(' ')).includes(q)).slice(0,100);
    res.json({sucesso:true,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.post('/api/cerebro/causas', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const b=req.body||{}, causa=String(b.causa||b.CAUSA||'').trim();
    if (!causa) return res.status(400).json({sucesso:false,erro:'Causa é obrigatória.'});
    await garantirAbaComCabecalhos('CAUSAS', CEREBRO_CAUSAS_HEADERS).catch(()=>{});
    const rows=await lerAba('CAUSAS',5000).catch(()=>[]), chave=_cNorm(causa);
    const equivalentes=rows.filter(r => _cNorm(r.CAUSA)===chave || _cNorm(r.SINONIMOS).split(/[;,|]/).map(_cNorm).includes(chave));
    if (equivalentes.length && b.confirmarDuplicidade !== true) return res.status(409).json({sucesso:false,duplicidade:true,equivalentes:equivalentes.slice(0,10),erro:'Já existe uma causa equivalente. Consulte o registro antes de criar outra.'});
    const id=await gerarProximoID('CAUSAS','CAU','ID_CAUSA'); const agora=new Date().toISOString();
    const obj={ID_CAUSA:id,CATEGORIA:b.categoria||b.CATEGORIA||'',TIPO:b.tipo||b.TIPO||'',CAUSA:causa,SUBCAUSA:b.subcausa||b.SUBCAUSA||'',DESCRICAO:b.descricao||b.DESCRICAO||'',SINONIMOS:_cCsv(b.sinonimos||b.SINONIMOS),SETOR_RESPONSAVEL:b.setorResponsavel||b.SETOR_RESPONSAVEL||'',PALAVRAS_CHAVE:_cCsv(b.palavrasChave||b.PALAVRAS_CHAVE),ATIVO:'SIM',VERSAO:'1',DATA_CRIACAO:agora,CRIADO_POR:req.user.usuario,ATUALIZADO_EM:agora};
    await appendObjeto('CAUSAS',obj); await registrarAuditoria(req.user.usuario,'CRIOU_CAUSA_CEREBRO',id,'CAUSAS',null,obj);
    res.status(201).json({sucesso:true,item:obj});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/cerebro/tratamentos', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const b=req.body||{}; if(!b.procedimento && !b.PROCEDIMENTO) return res.status(400).json({sucesso:false,erro:'Procedimento é obrigatório.'});
    await garantirAbaComCabecalhos('MATRIZ_TRATAMENTO', CEREBRO_TRAT_HEADERS).catch(()=>{});
    const id=await gerarProximoID('MATRIZ_TRATAMENTO','TRAT','ID_TRATAMENTO'), agora=new Date().toISOString();
    const obj={ID_TRATAMENTO:id,EMPRESA:b.empresa||b.EMPRESA||'',CATEGORIA:b.categoria||b.CATEGORIA||'',CAUSA_ID:b.causaId||b.CAUSA_ID||'',CAUSA:b.causa||b.CAUSA||'',SUBCAUSA:b.subcausa||b.SUBCAUSA||'',SETOR_RESPONSAVEL:b.setorResponsavel||b.SETOR_RESPONSAVEL||'',PROCEDIMENTO:b.procedimento||b.PROCEDIMENTO,CONDICOES:b.condicoes||b.CONDICOES||'',EVIDENCIAS:_cCsv(b.evidencias||b.EVIDENCIAS),AUTORIZACOES:_cCsv(b.autorizacoes||b.AUTORIZACOES),CRITERIOS_CONCLUSAO:b.criteriosConclusao||b.CRITERIOS_CONCLUSAO||'',STATUS:'RASCUNHO',VERSAO:'1',CRIADO_EM:agora,CRIADO_POR:req.user.usuario,ATUALIZADO_EM:agora};
    await appendObjeto('MATRIZ_TRATAMENTO',obj); await registrarAuditoria(req.user.usuario,'CRIOU_TRATAMENTO_CEREBRO',id,'MATRIZ_TRATAMENTO',null,obj); res.status(201).json({sucesso:true,item:obj});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/cerebro/aprimoramentos', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
  try { const b=req.body||{}; if(!b.descricao) return res.status(400).json({sucesso:false,erro:'Descrição é obrigatória.'}); await garantirAbaComCabecalhos('APRIMORAMENTOS_CEREBRO',CEREBRO_APR_HEADERS).catch(()=>{}); const id=await gerarProximoID('APRIMORAMENTOS_CEREBRO','APR','ID_APRIMORAMENTO'); const obj={ID_APRIMORAMENTO:id,TIPO:b.tipo||'TRATAMENTO',REGISTRO_ID:b.registroId||'',ID_MANIFESTACAO:b.idManifestacao||'',DESCRICAO:b.descricao,JUSTIFICATIVA:b.justificativa||'',STATUS:'EM_REVISAO',VERSAO_NOVA:'',CRIADO_EM:new Date().toISOString(),CRIADO_POR:req.user.usuario,APROVADO_EM:'',APROVADO_POR:''}; await appendObjeto('APRIMORAMENTOS_CEREBRO',obj); res.status(201).json({sucesso:true,item:obj}); } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/cerebro/devolutivas', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','AUDITOR','CONSULTA'), middlewareEscopoEmpresa(), async (req,res)=>{
  try { const q=_cNorm(req.query.q), aba=String(req.query.aba||'modelos'); await garantirAbaComCabecalhos('MODELOS_DEVOLUTIVA',CEREBRO_MODELO_HEADERS).catch(()=>{}); const [modelos, historico]=await Promise.all([lerAba('MODELOS_DEVOLUTIVA',5000).catch(()=>[]),lerAba('DEVOLUTIVAS',5000).catch(()=>[])]); const base=aba==='historico'?historico:aba==='revisao'?modelos.filter(r=>_cNorm(r.STATUS)==='em revisao'):modelos.filter(r=>_cNorm(r.STATUS)==='aprovada'||_cNorm(r.STATUS)==='publicada'||!r.STATUS); const itens=_cScopeRows(req,base).filter(r=>!q||_cNorm(Object.values(r).join(' ')).includes(q)); res.json({sucesso:true,aba,itens,total:itens.length,modelos:_cScopeRows(req,modelos),historico:_cScopeRows(req,historico)}); } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e),itens:[]});}
});

app.post('/api/cerebro/devolutivas/modelos', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
  try { const b=req.body||{}; if(!b.titulo||!b.textoPadrao) return res.status(400).json({sucesso:false,erro:'Título e texto padrão são obrigatórios.'}); await garantirAbaComCabecalhos('MODELOS_DEVOLUTIVA',CEREBRO_MODELO_HEADERS).catch(()=>{}); const id=await gerarProximoID('MODELOS_DEVOLUTIVA','MOD','ID_MODELO'); const obj={ID_MODELO:id,TITULO:b.titulo,EMPRESA:b.empresa||'',TIPO_MANIFESTACAO:b.tipoManifestacao||'',CATEGORIA:b.categoria||'',TIPO_DEVOLUTIVA:b.tipoDevolutiva||'CONCLUSAO',SITUACAO:b.situacao||'',ASSUNTO:b.assunto||'',TEXTO_PADRAO:b.textoPadrao,VARIAVEIS:_cCsv(b.variaveis),RESTRICOES:_cCsv(b.restricoes),VERSAO:'1',STATUS:'EM_REVISAO',CRIADO_EM:new Date().toISOString(),CRIADO_POR:req.user.usuario,APROVADO_EM:'',APROVADO_POR:''}; await appendObjeto('MODELOS_DEVOLUTIVA',obj); res.status(201).json({sucesso:true,item:obj}); } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

app.post('/api/cerebro/devolutivas/modelos/:id/status', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
  try { const status=String(req.body?.status||''); if(!['EM_REVISAO','APROVADA','ARQUIVADA'].includes(status)) return res.status(400).json({sucesso:false,erro:'Status inválido.'}); const rows=await lerAba('MODELOS_DEVOLUTIVA',5000); const item=rows.find(r=>r.ID_MODELO===req.params.id); if(!item) return res.status(404).json({sucesso:false,erro:'Modelo não encontrado.'}); if(!escopoPermite(req,item.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'}); const upd={STATUS:status,APROVADO_EM:status==='APROVADA'?new Date().toISOString():'',APROVADO_POR:status==='APROVADA'?req.user.usuario:'',VERSAO:status==='APROVADA'?String(Number(item.VERSAO||1)+1):item.VERSAO}; await atualizarPorID('MODELOS_DEVOLUTIVA',req.params.id,upd,['ID_MODELO']); res.json({sucesso:true,item:{...item,...upd}}); } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// ===== ASSERTIVIDADE DA IA =====
app.post('/api/assertividade-ia', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const {idManifestacao, decisaoAceita, causaConfirmada, subcausaConfirmada, setorConfirmado, tratativaAceita, devolutivaAceita, observacao} = req.body||{};
    if (!idManifestacao) return res.status(400).json({sucesso:false,erro:'ID da manifestação é obrigatório.'});
    // Verificar isolamento de empresa
    const mans = await lerAba('MANIFESTACOES', 5000).catch(()=>[]);
    const mRef = mans.find(m=>m.ID_MANIFESTACAO===idManifestacao);
    if (mRef && !escopoPermite(req, mRef.EMPRESA_RECLAMADA)) {
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
    const {setor, de, ate, responsavel, tipo} = req.query;
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
    if (responsavel) filtradas = filtradas.filter(m=>String(m.RESPONSAVEL||m.RESPONSAVEL_SETOR||m.RESPONSAVEL_ANALISTA||'').toLowerCase().includes(String(responsavel).toLowerCase()));
    if (tipo) filtradas = filtradas.filter(m=>String(m.TIPO_MANIFESTACAO||m.TIPO||'').toLowerCase().includes(String(tipo).toLowerCase()));

    const total = filtradas.length;
    const analisadas = new Set(filtradas.filter(m=>m.ANALISE_IA_STATUS||m.ANALISE_IA||m.CEREBRO_ANALISE||m.STATUS_CEREBRO||m.DECISAO_FINAL).map(m=>m.ID_MANIFESTACAO));
    const comAnalise = analisadas.size;
    const comAssert = asserts.filter(a=>filtradas.some(m=>m.ID_MANIFESTACAO===a.ID_MANIFESTACAO));
    const aceitasTotal = comAssert.filter(a=>a.DECISAO_ACEITA==='SIM').length;
    const assertPercent = comAssert.length ? Math.round(aceitasTotal/comAssert.length*100) : 0;
    // Assertividade exige validação humana registrada e pontuação documentada.
    // O critério operacional adotado é pontuação >= 80/100; aceitação isolada permanece métrica separada.
    const assertividadeValidada = comAssert.length ? Math.round(comAssert.filter(a=>Number(a.PONTUACAO)>=80).length/comAssert.length*100) : null;
    const pontuacaoMedia = comAssert.length ? Math.round(comAssert.reduce((s,a)=>s+Number(a.PONTUACAO||0),0)/comAssert.length) : 0;
    const validacoes = comAssert.slice(0, 100).map(a => {
      const manifestacao = filtradas.find(m => m.ID_MANIFESTACAO === a.ID_MANIFESTACAO) || {};
      const pontuacao = Number(a.PONTUACAO);
      return {
        protocolo: manifestacao.PROTOCOLO || manifestacao.ID_MANIFESTACAO || '—',
        empresa: manifestacao.EMPRESA_RECLAMADA || '—',
        data: a.AVALIADO_EM || a.DATA_AVALIACAO || '—',
        pontuacao: Number.isFinite(pontuacao) ? pontuacao : null,
        decisao: a.DECISAO_ACEITA === 'SIM' ? 'Aceita' : a.DECISAO_ACEITA === 'NAO' ? 'Rejeitada' : 'Sem decisão',
        avaliador: a.AVALIADO_POR || a.USUARIO || '—',
        resultado: Number.isFinite(pontuacao) && pontuacao >= 80 ? 'Validada' : 'Revisar',
      };
    });
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
      const slaH = Number(m.SLA_HORAS);
      if (!Number.isFinite(slaH) || slaH <= 0) return;
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
      const slaH = Number(m.SLA_HORAS);
      if (!Number.isFinite(slaH) || slaH <= 0) return false;
      const elapsed = (new Date(m.DATA_CONCLUSAO_MANIFESTACAO) - new Date(m.DATA_CRIACAO||m.DATA_ABERTURA)) / 3600000;
      return elapsed <= slaH;
    }).length;
    const dentroSlaPercent = encerradas.length ? Math.round(encerradasNoPrazo / encerradas.length * 100) : 0;
    const resolucaoDireta = encerradas.filter(m=>!String(m.SETOR_RESPONSAVEL||m.SETOR_CONFIRMADO||'').trim()).length;
    const exigiuSetor = filtradas.filter(m=>String(m.SETOR_RESPONSAVEL||m.SETOR_CONFIRMADO||'').trim()).length;
    const retrabalho = filtradas.filter(m=>/DEVOLVID|COMPLEMENT|RETRABALH/i.test(String(m.STATUS_TRATATIVA||m.HISTORICO_STATUS||m.OBSERVACOES||''))).length;
    const devolutivasNoPrazo = filtradas.filter(m=>m.DEVOLUTIVA_ENVIADA && m.DATA_DEVOLUTIVA && m.PRAZO_DEVOLUTIVA && new Date(m.DATA_DEVOLUTIVA)<=new Date(m.PRAZO_DEVOLUTIVA)).length;

    res.json({
      sucesso:true,
      metricas:{
        totalManifestacoes:total, comAnalise, analisesRealizadas:comAnalise, taxaUtilizacao:total?Math.round(comAnalise/total*100):null, taxaResolucao, assertPercent, assertividadeValidada, pontuacaoMedia,
        totalAvaliados:comAssert.length, totalAceitos:aceitasTotal,
        recomendacoesGeradas: comAssert.length ? comAssert.length : null,
        recomendacoesAceitas: comAssert.length ? aceitasTotal : null,
        recomendacoesEditadas: null,
        recomendacoesRejeitadas: comAssert.length ? comAssert.filter(a=>a.DECISAO_ACEITA!=='SIM').length : null,
        avaliacoesPendentes: Math.max(0, comAnalise-comAssert.length),
        encerradas:encerradas.length, emAberto:total-encerradas.length,
        devolutivas:devolutivasCount, reincidencias:reincidenciasCount, reincidenciasPercent,
        rncs:rncsCount, tempoMedioH, dentroSlaPercent,
        resolucaoDireta, exigiuSetor, retrabalho,
        tempoEsperaSetor:null, resolucaoPrimeiroCiclo:null, devolutivasNoPrazo,
      },
      sla:slaStatus, topSetores, topCausas,
      totalCausasCadastradas:causas.filter(c=>c.ATIVO!=='NAO').length,
      comparativo:{linhas:[]},
      validacoes,
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
    const [ap,comp,rel,usuarios] = await Promise.all([
      lerAba('APROVADORES',500).catch(()=>[]),
      lerAba('COMPETENCIAS',500).catch(()=>[]),
      lerAba('APROVADOR_COMPETENCIAS',2000).catch(()=>[]),
      lerAba('USUARIOS',500).catch(()=>[]),
    ]);
    // Inclui usuários com perfil APROVADOR / APROVADOR MASTER que não estejam na tabela APROVADORES
    const emailsJaCadastrados = new Set(ap.map(a => normalizarTexto(a.EMAIL||a.USUARIO||'')));
    const apFromUsuarios = usuarios.filter(u => {
      const p = perfilCanonico(u.PERFIL||u.perfil||'');
      return (p === 'APROVADOR' || p === 'APROVADOR MASTER') &&
        normalizarTexto(u.STATUS||'ATIVO') !== 'inativo' &&
        !emailsJaCadastrados.has(normalizarTexto(u.EMAIL||u.USUARIO||''));
    }).map(u => ({
      ID_APROVADOR: u.ID_USUARIO||u.USUARIO||u.EMAIL,
      NOME: u.NOME||u.USUARIO||u.EMAIL,
      EMAIL: u.EMAIL||'',
      USUARIO: u.USUARIO||'',
      CARGO: perfilCanonico(u.PERFIL||u.perfil||''),
      EMPRESA: u.EMPRESA||'',
      SETOR: u.SETOR||'',
      STATUS: 'ATIVO',
      _fromUsuarios: true,
    }));
    res.json({sucesso:true,aprovadores:[...ap,...apFromUsuarios],competencias:comp,relacionamentos:rel});
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
    const itensPendentes = itens.filter(x=>x.STATUS==='PENDENTE');
    res.json({sucesso:true,total:itensPendentes.length,pendentes,itens:itensPendentes});
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

// Decidir sobre item na fila (APROVADOR, ANALISTA SAC, MASTER)
app.post('/api/fila-aprovacao/:id/decidir', requerPermissao('aprovacoes.aprovar'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('HISTORICO_APROVACAO', HIST_APROV_HEADERS).catch(()=>{});
    const {decisao, observacoes} = req.body||{};
    const decisoesValidas = ['APROVADO','APROVADO_COM_RESSALVA','REJEITADO','DEVOLVIDO','SOLICITANDO_INFORMACOES'];
    if(!decisoesValidas.includes(decisao)) return res.status(400).json({sucesso:false,erro:'Decisão inválida.'});
    if(decisao!=='APROVADO'&&decisao!=='APROVADO_COM_RESSALVA' && !(observacoes||'').trim()) return res.status(400).json({sucesso:false,erro:'Observações obrigatórias para esta decisão.'});
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
    const novoStatus = (decisao==='APROVADO'||decisao==='APROVADO_COM_RESSALVA')?'APROVADA':decisao==='REJEITADO'?'REJEITADA':decisao==='DEVOLVIDO'?'EM_ANÁLISE':'AGUARDANDO_APROVAÇÃO';
    if(item.TIPO_ENTIDADE==='SAC') {
      await atualizarPorID('MANIFESTACOES',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now,OBSERVACOES_APROVADOR:observacoes||''},['ID_MANIFESTACAO']).catch(()=>{});
    } else if(item.TIPO_ENTIDADE==='RNC') {
      await atualizarPorID('BANCO_RNC',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now},['ID_RNC']).catch(()=>{});
    }
    await registrarAuditoria(req.user.usuario,`APROVACAO_${decisao}`,item.ID_ENTIDADE,'FILA_APROVACAO',item.STATUS,JSON.stringify({decisao,observacoes}));
    res.json({sucesso:true,decisao,entidade:item.ID_ENTIDADE,novoStatus});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Decisão SAC direta em manifestação (ANALISTA SAC, GESTOR SAC, MASTER)
app.post('/api/manifestacoes/:id/decisao-sac', requerPermissao('aprovacoes.aprovar'), middlewareEscopoEmpresa(), async (req,res)=>{
  try {
    const {decisao, observacoes} = req.body||{};
    const decisoesValidas = ['APROVADO','REJEITADO','DEVOLVIDO'];
    if(!decisoesValidas.includes(decisao)) return res.status(400).json({sucesso:false,erro:'Decisão inválida. Use APROVADO, REJEITADO ou DEVOLVIDO.'});
    if(decisao!=='APROVADO' && !(observacoes||'').trim()) return res.status(400).json({sucesso:false,erro:'Observações obrigatórias para rejeitar ou devolver.'});
    const now = new Date().toISOString();
    const novoStatus = decisao==='APROVADO'?'APROVADA_SAC':decisao==='REJEITADO'?'REJEITADA_SAC':'DEVOLVIDA_AJUSTE';
    await atualizarPorID('MANIFESTACOES',req.params.id,{STATUS:novoStatus,SAC_APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO_SAC:now,OBS_SAC:observacoes||''},['ID_MANIFESTACAO']).catch(()=>{});
    const histId = await gerarProximoID('HISTORICO_APROVACAO','HAP','ID_HISTORICO');
    await appendObjeto('HISTORICO_APROVACAO',{ID_HISTORICO:histId,ID_FILA:'SAC-'+req.params.id,ID_ENTIDADE:req.params.id,TIPO_ENTIDADE:'SAC',DECISAO:decisao,OBSERVACOES:observacoes||'',APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO:now,DETALHES:JSON.stringify({fonte:'decisao_sac',perfil:req.user.perfil})}).catch(()=>{});
    await registrarAuditoria(req.user.usuario,`SAC_${decisao}`,req.params.id,'MANIFESTACOES','',JSON.stringify({decisao,observacoes}));
    res.json({sucesso:true,decisao,entidade:req.params.id,novoStatus});
  } catch(e){res.status(500).json({sucesso:false,erro:erroSeguro(e)});}
});

// Histórico de aprovações
app.get('/api/historico-aprovacao', requerPerfil('MASTER','APROVADOR','ANALISTA SAC','GESTOR SAC'), middlewareEscopoEmpresa(), async (req,res)=>{
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
const PORTAL_EMPRESAS = [
  { slug: 'chiacchio', codigo: 'CHIACCHIO', prefixo: 'CHI', nome: 'Chiacchio Embalagens', cor: '#C70602', logo: '/assets/logo-chiacchio-new.png' },
  { slug: 'plaschio', codigo: 'PLASCHIO', prefixo: 'PLAS', nome: 'Plaschio', cor: '#1A6632', logo: '/assets/logo-plaschio-new.png' },
  { slug: 'tubahia', codigo: 'TUBAHIA', prefixo: 'TUB', nome: 'Cesbap / Tubahia', cor: '#24508F', logo: '/assets/logo-tubahia-new.png' },
];

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
    const viaCliente = b.origem === 'PORTAL_PUBLICO';
    const empresaPortal = PORTAL_EMPRESAS.find(e => e.codigo === empresaCanonica(b.empresa) || normalizarTexto(e.nome) === normalizarTexto(b.empresa));
    if (viaCliente && !empresaPortal) return res.status(400).json({ sucesso: false, erro: 'Selecione uma empresa do grupo.' });
    if (viaCliente) {
      const config = await lerAba('CONFIG_PORTAL', 200);
      if (config.some(c => c.TIPO === 'FORM_MANIFESTACAO_ATIVO' && c.ATIVO === 'NAO')) {
        return res.status(403).json({ sucesso: false, erro: 'O formulário de manifestações está temporariamente indisponível.' });
      }
    }

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
    if (viaCliente && !motivoManifestacao) return res.status(400).json({ sucesso: false, erro: 'Informe o motivo da reclamação.' });
    const produto = String(b.produto || '').trim().slice(0, 200);
    const lote = String(b.lote || '').trim().slice(0, 100);
    const quantidadeAfetada = String(b.quantidadeAfetada || b.quantidade || '').trim().slice(0, 50);
    const observacoes = String(b.observacoes || b.solicitacaoCliente || '').trim().slice(0, 1000);
    const pedido = String(b.pedido || '').trim().slice(0, 100);
    const notaFiscal = String(b.notaFiscal || '').trim().slice(0, 100);

    // Validar evidências
    if (viaCliente && b.evidencias !== undefined && (!Array.isArray(b.evidencias) || b.evidencias.length > 8)) {
      return res.status(400).json({ sucesso: false, erro: 'Envie até 8 evidências.' });
    }
    const evidencias = Array.isArray(b.evidencias) ? b.evidencias.slice(0, 8) : [];
    let bytesEvidencias = 0;
    for (const ev of evidencias) {
      if (!ev || typeof ev.nome !== 'string' || typeof ev.tipo !== 'string' || typeof ev.dados !== 'string' || !ev.nome || !ev.dados) {
        return res.status(400).json({ sucesso: false, erro: 'Evidência inválida. Selecione o arquivo novamente.' });
      }
      if (!ALLOWED_FILE_TYPES.includes(ev.tipo)) return res.status(400).json({ sucesso: false, erro: `Tipo não permitido: ${ev.tipo}` });
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(ev.dados)) {
        return res.status(400).json({ sucesso: false, erro: 'Arquivo inválido. Selecione o arquivo novamente.' });
      }
      bytesEvidencias += Buffer.byteLength(ev.dados, 'base64');
      const sizeMB = (ev.dados.length * 3 / 4) / (1024 * 1024);
      if (sizeMB > MAX_FILE_SIZE_MB) return res.status(400).json({ sucesso: false, erro: `Arquivo muito grande: ${ev.nome} (máx ${MAX_FILE_SIZE_MB}MB)` });
    }
    if (viaCliente && bytesEvidencias > 3 * 1024 * 1024) {
      return res.status(400).json({ sucesso: false, erro: 'Os anexos devem somar no máximo 3 MB.' });
    }

    const agora = new Date().toISOString();
    // The portal sends one key per form submission. Persisting it lets a retry
    // after a network timeout return the original protocol instead of creating
    // a second manifestation.
    const idempotencyKey = String(
      b.idempotencyKey || req.headers['idempotency-key'] || '',
    ).trim().slice(0, 120);
    if (idempotencyKey) {
      const previous = (await lerAba('MANIFESTACOES', 5000).catch(() => []))
        .find(row => String(row.IDEMPOTENCY_KEY || '').trim() === idempotencyKey);
      if (previous) {
        return res.json({
          sucesso: true,
          id: previous.ID_MANIFESTACAO || '',
          protocolo: previous.PROTOCOLO || '',
          dataHora: previous.DATA_ABERTURA || previous.DATA_REGISTRO || '',
          idempotente: true,
          fichaId: `FIC-${previous.ID_MANIFESTACAO || ''}`,
        });
      }
    }

    // O mesmo identificador liga o protocolo externo à fila e à ficha internas.
    // A parte aleatória evita que consultas públicas sejam enumeráveis.
    // O identificador técnico é separado do protocolo apresentado ao cliente.
    // Antes o portal usava o mesmo valor aleatório para os dois, o que quebrava
    // a rastreabilidade e deixava a manifestação sem protocolo oficial.
    const id = await gerarProximoID('MANIFESTACOES', empresaPortal?.prefixo || 'MAN', 'ID_MANIFESTACAO');
    const canalFinal = canalRecebimento === 'Outro' && canalOutro ? `Outro: ${canalOutro}` : (canalRecebimento || 'Não informado');
    const dtReg = new Date(agora);
    const anoReg = dtReg.getFullYear().toString();
    const mesReg = String(dtReg.getMonth() + 1).padStart(2, '0');
    const dataRegistroFmt = dtReg.toLocaleDateString('pt-BR') + ' ' + dtReg.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});
    const protocolo = await gerarProtocoloFicha(empresa, canalFinal, dtReg);

    // 1. Salvar manifestação no Sheets
    const objeto = {
      ID_MANIFESTACAO: id,
      PROTOCOLO: protocolo,
      DATA_ABERTURA: agora,
      DATA_REGISTRO: agora,
      EMPRESA_RECLAMADA: empresa,
      EMPRESA_RECLAMANTE: empresa,
      CLIENTE_NOME: nomeCliente,
      NOME_CLIENTE: nomeCliente,
      TELEFONE: telefone,
      EMAIL: email,
      ...(viaCliente ? {
        TIPO_CLIENTE: ['direto', 'indireto'].includes(b.tipoCliente) ? b.tipoCliente : '',
        CNPJ: String(b.cnpj || '').trim().slice(0, 30),
        CPF: String(b.cpf || '').trim().slice(0, 20),
        RAZAO_SOCIAL: String(b.razaoSocial || '').trim().slice(0, 200),
        RCA: String(b.rca || '').trim().slice(0, 200),
        ONDE_COMPROU: String(b.ondeComprou || '').trim().slice(0, 200),
      } : {}),
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
      ORIGEM: viaCliente ? 'PORTAL_PUBLICO' : 'PORTAL_FUNCIONARIO',
      ORIGEM_REGISTRO: viaCliente ? 'PORTAL_PUBLICO' : 'PORTAL_FUNCIONARIO',
      REGISTRADO_POR: colaboradorRecebimento,
      COLABORADOR_RECEBIMENTO: colaboradorRecebimento,
      SETOR_RECEBIMENTO: setorRecebimento,
      USUARIO_CRIACAO: `portal:${colaboradorRecebimento}`,
      STATUS_TRATATIVA: 'NÃO INICIADA',
      IDEMPOTENCY_KEY: idempotencyKey,
      CIRCA_ANALISE_STATUS: 'PENDENTE',
    };
    await garantirAbaComCabecalhos('MANIFESTACOES', Object.keys(objeto));
    await appendObjeto('MANIFESTACOES', objeto);

    // 2. Upload evidências para o Drive (não bloqueia se falhar)
    const evidenciasMetadata = [];
    for (let i = 0; i < evidencias.length; i++) {
      const ev = evidencias[i];
      if (!ev.nome || !ev.tipo || !ev.dados) continue;
      try {
        const driveFile = await uploadArquivoDrive(`EV_${id}_${i+1}_${ev.nome}`, ev.tipo, ev.dados, { publico: !viaCliente });
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
        const dadosPDF = { protocolo, dataRegistroFmt, setorRecebimento, colaboradorRecebimento, nomeCliente, empresa, telefone, email, canalRecebimento: canalFinal, tipoManifestacao, motivoManifestacao, descricaoOriginal, produto, lote, quantidadeAfetada, observacoes, totalEvidencias: evidenciasMetadata.length };
        pdfBuffer = await gerarFichaPDF(dadosPDF);
        pdfBase64 = pdfBuffer.toString('base64');
      } catch (pdfErr) {
        console.warn('[PUBLIC] PDF geração falhou:', pdfErr.message);
      }
    }

    // 4. Upload PDF para o Drive
    let pdfDriveId = '';
    let pdfDriveUrl = '';
    const pdfNome = `FICHA_${protocolo}.pdf`;
    if (pdfBuffer) {
      try {
        const pdfDrive = await uploadArquivoDrive(pdfNome, 'application/pdf', pdfBuffer, { publico: !viaCliente });
        pdfDriveId = pdfDrive.id || '';
        pdfDriveUrl = pdfDrive.webViewLink || pdfDrive.webContentLink || '';
      } catch (pdfUpErr) {
        console.warn('[PUBLIC] PDF upload Drive falhou:', pdfUpErr.message);
      }
    }

    // 5. Indexar na FICHAS_BIBLIOTECA.  The manifestation is already
    // durable, but the portal must not report a complete success while its
    // official ficha index is unavailable.
    let fichaIndexada = false;
    try {
      await garantirAbaComCabecalhos('FICHAS_BIBLIOTECA', FICHAS_BIBLIOTECA_HEADERS);
      const fichaId = `FIC-${id}`;
      await appendObjeto('FICHAS_BIBLIOTECA', {
        ID_FICHA: fichaId, ID_MANIFESTACAO: id, PROTOCOLO: protocolo,
        DATA_REGISTRO: agora, ANO: anoReg, MES: mesReg,
        EMPRESA: empresa, SETOR_RECEBIMENTO: setorRecebimento,
        COLABORADOR_RECEBIMENTO: colaboradorRecebimento, NOME_CLIENTE: nomeCliente,
        TIPO_MANIFESTACAO: tipoManifestacao, MOTIVO: motivoManifestacao,
        STATUS: 'NOVA', PDF_DRIVE_ID: pdfDriveId, PDF_DRIVE_URL: pdfDriveUrl,
        PDF_NOME: pdfNome, TOTAL_EVIDENCIAS: evidenciasMetadata.length,
        CREATED_AT: agora, VERSAO: '1',
      });
      fichaIndexada = true;
    } catch (bibErr) {
      console.warn('[PUBLIC] FICHAS_BIBLIOTECA indexação falhou:', bibErr.message);
    }

    if (!fichaIndexada) {
      return res.status(503).json({
        sucesso: false,
        persistido: true,
        id,
        protocolo,
        erro: 'A manifestação foi recebida, mas a ficha oficial ainda não pôde ser indexada. Tente novamente sem reenviar os dados.',
      });
    }

    // 6. Atualizar MANIFESTACOES com referências do PDF/Drive
    if (pdfDriveId) {
      atualizarPorID('MANIFESTACOES', id, { PDF_DRIVE_ID: pdfDriveId, PDF_DRIVE_URL: pdfDriveUrl, PDF_NOME: pdfNome }, ['ID_MANIFESTACAO']).catch(() => {});
    }

    registrarAuditoria(`portal:${colaboradorRecebimento}`, 'CRIOU_MANIFESTAÇÃO_PORTAL', id, 'MANIFESTACOES', null, { empresa, nomeCliente, canal: canalFinal, tipo: tipoManifestacao }).catch(() => {});

    // 7. Inserir na FILA_APROVACAO para que MASTER/APROVADOR vejam imediatamente
    // IMPORTANTE: deve ser awaited antes de res.json() — em serverless o processo termina após enviar a resposta
    let filaCriada = false;
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
      filaCriada = true;
    } catch (filaErr) {
      console.warn('[PUBLIC] FILA_APROVACAO insert falhou:', filaErr.message);
    }

    if (!filaCriada) {
      return res.status(503).json({
        sucesso: false,
        persistido: true,
        fichaId: `FIC-${id}`,
        id,
        protocolo,
        erro: 'A manifestação foi recebida, mas ainda não entrou na fila do SAC. Tente novamente sem reenviar os dados.',
      });
    }

    // 8. Pré-análise operacional.  Itens determinísticos e recomendações são
    // persistidos para o SAC; nenhuma decisão, aprovação, envio ou RNC é
    // executado automaticamente.
    let analisePortal = null;
    try {
      analisePortal = await executarAnalise({
        ...objeto,
        ID_MANIFESTACAO: id,
        protocolo,
        empresaReclamante: empresa,
        empresaReclamada: empresa,
        descricao: descricaoOriginal,
        tipo: tipoManifestacao,
      });
      await atualizarPorID('MANIFESTACOES', id, {
        TIPO_SUGERIDO: analisePortal.tipoDetectado || '',
        SETOR_SUGERIDO: Array.isArray(analisePortal.setores) ? (analisePortal.setores[0] || '') : '',
        SETORES_SUGERIDOS: Array.isArray(analisePortal.setores) ? analisePortal.setores.join(', ') : '',
        PROCEDIMENTO_SUGERIDO: analisePortal.procedimentoSugerido?.nome || '',
        SLA_HORAS: Number(analisePortal.slaHoras) || 72,
        PRIORIDADE: analisePortal.prioridade || '',
        RNC_SUGERIDO: 'NÃO',
        RNC_SINALIZADO: analisePortal.rncSinalizado ? 'REVISAR' : '',
        TRATATIVA_SUGERIDA: analisePortal.tratativaSugerida?.sugestao || '',
        DEVOLUTIVA_SUGERIDA: analisePortal.devolutivaSugerida || '',
        CIRCA_ANALISE_STATUS: 'CONCLUIDA',
        CIRCA_ANALISE_EM: new Date().toISOString(),
        CIRCA_ANALISE_ERROS: Array.isArray(analisePortal.erros) ? analisePortal.erros.join('; ') : '',
      }, ['ID_MANIFESTACAO']);
    } catch (analysisErr) {
      console.warn('[PUBLIC] pré-análise não concluída:', analysisErr.message);
      await atualizarPorID('MANIFESTACOES', id, {
        CIRCA_ANALISE_STATUS: 'PENDENTE',
        CIRCA_ANALISE_ERROS: String(analysisErr.message || 'Falha na pré-análise').slice(0, 500),
      }, ['ID_MANIFESTACAO']).catch(() => {});
    }

    const resposta = { sucesso: true, id, protocolo, fichaId: `FIC-${id}`, dataHora: agora, analiseDisponivel: !!analisePortal };
    if (evidenciasMetadata.length < evidencias.length) {
      resposta.aviso = 'Sua manifestação foi registrada, mas alguns anexos não puderam ser salvos. Entre em contato com o SAC informando este protocolo para encaminhá-los. Não é necessário registrar novamente.';
    }
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
      PRODUTO: m.PRODUTO || m.PRODUTO_NOME || idx.PRODUTO || m.SKU || '',
      TIPO_MANIFESTACAO: m.TIPO_MANIFESTACAO || m.TIPO || idx.TIPO_MANIFESTACAO || 'Reclamação',
      MOTIVO: m.MOTIVO || idx.MOTIVO || '',
      COLABORADOR_RECEBIMENTO: m.COLABORADOR_RECEBIMENTO || m.REGISTRADO_POR || m.USUARIO_CRIACAO || '',
      ORIGEM: doc ? 'IMPORTADA' : 'SISTEMA', STATUS: doc && !(m.STATUS_FICHA || m.STATUS) ? 'ARQUIVADA' : _bibCategoria(m.STATUS_FICHA, m.STATUS), COM_TRATATIVA: doc ? !!comTrat : comTrat,
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
      PRODUTO: f.PRODUTO || f.PRODUTO_NOME || f.SKU || '',
      TIPO_MANIFESTACAO: f.TIPO_MANIFESTACAO || 'Reclamação', MOTIVO: f.MOTIVO || '',
      COLABORADOR_RECEBIMENTO: f.COLABORADOR_RECEBIMENTO || '',
      ORIGEM: 'IMPORTADA', STATUS: f.STATUS || f.STATUS_FICHA || 'ARQUIVADA', COM_TRATATIVA: !!(f.TRATATIVA_REALIZADA || f.TRATATIVA || f.DATA_CONCLUSAO),
      STATUS_FICHA: f.STATUS_FICHA || f.STATUS || '', STATUS_RAW: f.STATUS || f.STATUS_FICHA || '',
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
      PRODUTO: h.ORIG_PRODUTO || h.PRODUTO || h.SKU || '',
      MOTIVO: h.COMP_TIPO_PROBLEMA_VALIDADO || String(h.ORIG_DESCRICAO_RECLAMACAO || '').slice(0, 80),
      COLABORADOR_RECEBIMENTO: h.ORIG_ATENDENTE || '',
      ORIGEM: 'IMPORTADA', STATUS: h.STATUS_FINAL || h.STATUS || 'ARQUIVADA', COM_TRATATIVA: !!trat,
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
      n([f.PROTOCOLO, f.NOME_CLIENTE, f.CNPJ_CPF, f.MOTIVO, f.PRODUTO, f.SKU, f.COLABORADOR_RECEBIMENTO, f.EMPRESA, f.SETOR, f.RESPONSAVEL].join(' ')).includes(nq) ||
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
    if (req._empresaScope && !pertenceEmpresa(req._empresaScope, empresa)) {
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
  } catch (e) {
    const status = e?.code === 'ERR_DUPLICATE_KNOWLEDGE' ? 409 : 500;
    res.status(status).json({ sucesso: false, erro: erroSeguro(e,'mc-item-add') });
  }
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
        // Formato novo: MODULO guarda um JSON { DASHBOARD: 2, MANIFESTACOES: 1, ... }
        try { for (const [m, n] of Object.entries(JSON.parse(raw))) modulos[m] = Number(n) || 0; } catch(e) {}
      } else if (r.NIVEL !== undefined) {
        // Formato legado: uma linha por módulo, nível em NIVEL
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
    if (!nome?.trim()) return res.status(400).json({sucesso:false,erro:'Nome obrigatório.'});
    if (!email?.trim() || !emailValido(email)) return res.status(400).json({sucesso:false,erro:'E-mail inválido.'});
    if (!empresa?.trim()) return res.status(400).json({sucesso:false,erro:'Empresa obrigatória.'});
    if (!setor?.trim()) return res.status(400).json({sucesso:false,erro:'Setor obrigatório.'});
    if (!cargo?.trim()) return res.status(400).json({sucesso:false,erro:'Cargo obrigatório.'});
    if (!justificativa?.trim()) return res.status(400).json({sucesso:false,erro:'Justificativa obrigatória.'});

    const empCod = empresaCanonica(empresa);
    if (!empCod) {
      return res.status(400).json({sucesso:false,erro:'Empresa inválida. Use: CHIACCHIO EMBALAGENS, PLASCHIO, CESBAP ou TODAS AS EMPRESAS.'});
    }

    const emailNorm = String(email).toLowerCase().trim();

    // Verifica duplicidade de e-mail em usuários ativos
    const usuarios = await carregarUsuarios();
    const statusBloqueantes = ['ativo', 'bloqueado'];
    const jaUsuario = usuarios.find(u => {
      if (String(u.EMAIL||'').toLowerCase().trim() !== emailNorm) return false;
      const st = normalizarTexto(u.STATUS||'ATIVO');
      return statusBloqueantes.includes(st);
    });
    if (jaUsuario) return res.status(409).json({sucesso:false,erro:'E-mail já possui conta ativa no sistema.'});

    // Verifica solicitação PENDENTE duplicada (Sheets + PG)
    const solRows = await lerAba('SOLICITACOES_ACESSO', 1000).catch(() => []);
    const jaExisteSheets = solRows.find(r => String(r.EMAIL||'').toLowerCase().trim() === emailNorm && String(r.STATUS||'').toUpperCase() === 'PENDENTE');
    if (jaExisteSheets) return res.status(409).json({sucesso:false,erro:'Já existe uma solicitação pendente para este e-mail.'});
    if (solicitacaoRepo) {
      const jaExistePg = await solicitacaoRepo.findPendenteByEmail(emailNorm).catch(() => null);
      if (jaExistePg) return res.status(409).json({sucesso:false,erro:'Já existe uma solicitação pendente para este e-mail.'});
    }

    const id = `SOL-${Date.now().toString(36).toUpperCase()}`;
    await appendObjeto('SOLICITACOES_ACESSO', {
      ID_SOLICITACAO: id,
      NOME: nome.trim(),
      EMAIL: emailNorm,
      EMPRESA: empCod,
      SETOR: setor.trim(),
      CARGO: cargo.trim(),
      TELEFONE: (telefone||'').trim(),
      JUSTIFICATIVA: justificativa.trim(),
      STATUS: 'PENDENTE',
      DATA_CRIACAO: new Date().toISOString(),
      DATA_DECISAO: '',
      DECIDIDO_POR: '',
      MOTIVO_REJEICAO: '',
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
    const stFil = (req.query.status || '').toUpperCase() || undefined;
    const empFil = req.query.empresa ? empresaCanonica(req.query.empresa) : undefined;

    // Lê do Sheets
    const sheetRows = await lerAba('SOLICITACOES_ACESSO', 1000).catch(() => []);
    const sheetItens = sheetRows.filter(r => r.ID_SOLICITACAO);
    const idsSheets = new Set(sheetItens.map(r => r.ID_SOLICITACAO));

    // Lê do PG se disponível (garante que solicitações antigas apareçam)
    let pgItens = [];
    if (solicitacaoRepo) {
      const pgRows = await solicitacaoRepo.findAll({}).catch(() => []);
      pgItens = pgRows
        .filter(r => !idsSheets.has(r.idSolicitacao))
        .map(r => ({
          ID_SOLICITACAO: r.idSolicitacao,
          NOME: r.nome, EMAIL: r.email, EMPRESA: r.empresa,
          SETOR: r.setor, CARGO: r.cargo, TELEFONE: r.telefone||'',
          JUSTIFICATIVA: r.justificativa||'', STATUS: r.status,
          DATA_CRIACAO: r.criadaEm?.toISOString?.() || '',
          DATA_DECISAO: r.dataDecisao?.toISOString?.() || '',
          DECIDIDO_POR: r.decididoPor||'', MOTIVO_REJEICAO: r.motivoRejeicao||'',
          _fromPg: true,
        }));
    }

    let itens = [...sheetItens, ...pgItens];
    if (stFil) itens = itens.filter(r => String(r.STATUS||'').toUpperCase() === stFil);
    if (empFil) itens = itens.filter(r => empresaCanonica(r.EMPRESA||'') === empFil);
    itens.sort((a, b) => (b.DATA_CRIACAO||'').localeCompare(a.DATA_CRIACAO||''));
    res.json({sucesso:true, total:itens.length, itens});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.get('/api/admin/solicitacoes/:id', requerPerfil('MASTER'), async (req, res) => {
  try {
    const rows = await lerAba('SOLICITACOES_ACESSO', 1000).catch(() => []);
    let item = rows.find(r => r.ID_SOLICITACAO === req.params.id);
    if (!item && solicitacaoRepo) {
      const r = await solicitacaoRepo.findById(req.params.id).catch(() => null);
      if (r) item = {
        ID_SOLICITACAO: r.idSolicitacao, NOME: r.nome, EMAIL: r.email, EMPRESA: r.empresa,
        SETOR: r.setor, CARGO: r.cargo, TELEFONE: r.telefone||'', JUSTIFICATIVA: r.justificativa||'',
        STATUS: r.status, DATA_CRIACAO: r.criadaEm?.toISOString?.() || '',
        DATA_DECISAO: r.dataDecisao?.toISOString?.() || '', DECIDIDO_POR: r.decididoPor||'',
        MOTIVO_REJEICAO: r.motivoRejeicao||'', _fromPg: true,
      };
    }
    if (!item) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    res.json({sucesso:true, item});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/admin/solicitacoes/:id/rejeitar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const { motivo } = req.body||{};
    if (!motivo?.trim()) return res.status(400).json({sucesso:false,erro:'Motivo da rejeição obrigatório.'});
    const decididoPor = req.user.usuario||req.user.email||'MASTER';
    const rows = await lerAba('SOLICITACOES_ACESSO', 1000).catch(() => []);
    let sol = rows.find(r => r.ID_SOLICITACAO === req.params.id);
    let solFromPg = false;
    if (!sol && solicitacaoRepo) {
      const r = await solicitacaoRepo.findById(req.params.id).catch(() => null);
      if (r) { sol = { ID_SOLICITACAO: r.idSolicitacao, EMAIL: r.email, EMPRESA: r.empresa, STATUS: r.status }; solFromPg = true; }
    }
    if (!sol) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    if (String(sol.STATUS||'').toUpperCase() !== 'PENDENTE') return res.status(400).json({sucesso:false,erro:`Solicitação já ${sol.STATUS}.`});
    if (solFromPg && solicitacaoRepo) {
      await solicitacaoRepo.update(req.params.id, { status: 'REJEITADA', dataDecisao: new Date(), decididoPor, motivoRejeicao: motivo.trim() }).catch(()=>{});
    } else {
      await atualizarPorID('SOLICITACOES_ACESSO', req.params.id, {
        STATUS: 'REJEITADA', DATA_DECISAO: new Date().toISOString(), DECIDIDO_POR: decididoPor, MOTIVO_REJEICAO: motivo.trim(),
      }, ['ID_SOLICITACAO']);
    }
    await registrarAuditoriaAcesso(sol.EMAIL||'', 'SOLICITACAO_REJEITADA', '', sol.EMPRESA||'', 'PENDENTE', 'REJEITADA', decididoPor);
    res.json({sucesso:true, mensagem:'Solicitação rejeitada.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// Aprovação: cria o usuário com STATUS=ATIVO e define permissões
app.post('/api/admin/solicitacoes/:id/aprovar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const { perfil, empresa, setor, modulosNiveis, competencias, senha } = req.body||{};

    if (!perfil) return res.status(400).json({sucesso:false,erro:'Perfil obrigatório.'});
    const perfilNorm = normalizarPerfil(perfil);
    if (!PERFIS_VALIDOS.includes(perfilNorm)) return res.status(400).json({sucesso:false,erro:`Perfil inválido. Use: ${PERFIS_VALIDOS.join(', ')}.`});
    if (!empresa) return res.status(400).json({sucesso:false,erro:'Empresa obrigatória.'});
    const empCod = empresaCanonica(empresa);
    if (!empCod) return res.status(400).json({sucesso:false,erro:'Empresa inválida.'});

    // Lê a solicitação do Sheets (com fallback para PG)
    const rows = await lerAba('SOLICITACOES_ACESSO', 1000).catch(() => []);
    let solRow = rows.find(r => r.ID_SOLICITACAO === req.params.id);
    let solRowFromPg = false;
    if (!solRow && solicitacaoRepo) {
      const r = await solicitacaoRepo.findById(req.params.id).catch(() => null);
      if (r) { solRow = { ID_SOLICITACAO: r.idSolicitacao, NOME: r.nome, EMAIL: r.email, EMPRESA: r.empresa, SETOR: r.setor, STATUS: r.status }; solRowFromPg = true; }
    }
    if (!solRow) return res.status(404).json({sucesso:false,erro:'Solicitação não encontrada.'});
    if (String(solRow.STATUS||'').toUpperCase() !== 'PENDENTE') return res.status(400).json({sucesso:false,erro:`Solicitação já ${solRow.STATUS}.`});

    const emailNorm = String(solRow.EMAIL||'').toLowerCase().trim();
    const nomeSol = solRow.NOME||'';

    // Gera usuário (login = parte antes do @ do email)
    const login = emailNorm.split('@')[0].replace(/[^a-z0-9.]/gi,'.');
    const senhaFinal = senha?.trim() || crypto.randomBytes(8).toString('hex');
    const senhaHash = await hashSenha(senhaFinal);

    const modulosConfig = modulosNiveis || {};
    const competenciasStr = Array.isArray(competencias) ? competencias.join(',') : (competencias||'');
    const idUsuario = await gerarProximoID('USUARIOS','USR','ID_USUARIO');

    // Cria usuário no Sheets
    await appendObjeto('USUARIOS', {
      ID_USUARIO: idUsuario,
      USUARIO: login,
      EMAIL: emailNorm,
      NOME: nomeSol,
      PERFIL: perfilNorm,
      EMPRESA: empCod,
      SETOR: setor||solRow.SETOR||'',
      CODIGO_RCA: '',
      STATUS: 'PRIMEIRO_ACESSO',
      SENHA_HASH: senhaHash,
      DATA_CRIACAO: new Date().toISOString(),
      ULTIMO_ACESSO: '',
      PERMISSOES_CUSTOM: Object.keys(modulosConfig).length ? JSON.stringify(modulosConfig) : '',
      COMPETENCIAS: competenciasStr,
    });

    // Cria usuário no PostgreSQL (fonte primária de leitura)
    if (usuarioRepo) {
      try {
        const prisma = require('../database/connection');
        // Mapeia perfilNorm (ex: ANALISTA_SAC) para o codigo no PG (ex: SAC)
        const PERFIL_TO_PG = { 'MASTER':'MASTER','GESTOR_SAC':'SAC','ANALISTA_SAC':'SAC','APROVADOR':'SAC','REPRESENTANTE':'REPRESENTANTE','CONSULTA':'USUARIO_DE_SETOR','AUDITOR':'USUARIO_DE_SETOR' };
        const pgCodigo = PERFIL_TO_PG[perfilNorm] || 'SAC';
        const [pgPerfil, pgEmpresaDirect] = await Promise.all([
          prisma.perfil.findFirst({ where: { codigo: pgCodigo } }),
          prisma.empresa.findFirst({ where: { codigo: empCod } }),
        ]);
        // MASTER/Todas as empresas não tem registro próprio — usa a primeira empresa disponível
        const pgEmpresa = pgEmpresaDirect || (empCod === 'MASTER' ? await prisma.empresa.findFirst() : null);
        if (pgPerfil && pgEmpresa) {
          await usuarioRepo.create({
            idOriginal: idUsuario,
            nome: nomeSol,
            email: emailNorm,
            senhaHash,
            ativo: true,
            perfilId: pgPerfil.id,
            empresaId: pgEmpresa.id,
          }).catch(e => console.warn('[aprovacao] PG create usuario falhou:', e.message));
        }
      } catch(e) { console.warn('[aprovacao] PG lookup falhou:', e.message); }
    }

    // Grava permissões de módulo na aba PERMISSOES_USUARIO (fonte lida por carregarPermissoesUsuario)
    if (Object.keys(modulosConfig).length || competenciasStr) {
      const idPerm = await gerarProximoID('PERMISSOES_USUARIO','PRM','ID_PERMISSAO').catch(()=>null);
      await appendObjeto('PERMISSOES_USUARIO', {
        ID_PERMISSAO: idPerm || `PRM-${Date.now()}`,
        USUARIO_ID: idUsuario,
        USUARIO_EMAIL: emailNorm,
        EMPRESA: empCod,
        PERFIL: perfilNorm,
        MODULO: Object.keys(modulosConfig).length ? JSON.stringify(modulosConfig) : '',
        NIVEL: '',
        COMPETENCIAS: competenciasStr,
        STATUS: 'ATIVO',
        CRIADO_EM: new Date().toISOString(),
        CRIADO_POR: req.user.usuario||'MASTER',
        ATUALIZADO_EM: new Date().toISOString(),
        ATUALIZADO_POR: req.user.usuario||'MASTER',
      }).catch(e => console.warn('[aprovacao] gravar PERMISSOES_USUARIO falhou:', e.message));
      invalidarCachePermissoes(emailNorm);
      invalidarCachePermissoes(idUsuario);
    }

    // Marca solicitação como APROVADA
    if (solRowFromPg && solicitacaoRepo) {
      await solicitacaoRepo.update(req.params.id, { status: 'APROVADA', dataDecisao: new Date(), decididoPor: req.user.usuario||'MASTER' }).catch(()=>{});
    } else {
      await atualizarPorID('SOLICITACOES_ACESSO', req.params.id, {
        STATUS: 'APROVADA', DATA_DECISAO: new Date().toISOString(),
        DECIDIDO_POR: req.user.usuario||'MASTER', MOTIVO_REJEICAO: '',
      }, ['ID_SOLICITACAO']);
    }

    await registrarAuditoriaAcesso(emailNorm, 'USUARIO_CRIADO_POR_APROVACAO', '', empCod, '', JSON.stringify({perfil:perfilNorm,empresa:empCod,modulos:modulosConfig}), req.user.usuario||'MASTER');
    invalidarCachePermissoes(emailNorm);
    invalidarCacheAba('USUARIOS');
    res.json({sucesso:true, idUsuario, login, mensagem:'Usuário criado e ativo.', senhaGerada: !senha?.trim() ? senhaFinal : undefined});
    // Envia e-mail com credenciais (fire-and-forget)
    enviarEmailAcesso({ para: emailNorm, nome: nomeSol, login, senha: senhaFinal, perfil: perfilNorm, empresa: empCod }).catch(()=>{});
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
    const u = encontrarUsuarioPorIdentificador(usuarios, req.params.id);
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
    const u = encontrarUsuarioPorIdentificador(usuarios, req.params.id);
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
    if (modulosNiveis !== undefined) {
      updates.PERMISSOES_GRANTED = JSON.stringify(permissoesGranularDeModulos(modulosNiveis || {}));
    }
    if (competencias !== undefined) {
      updates.COMPETENCIAS = Array.isArray(competencias) ? competencias.join(',') : (competencias||'');
    }

    // Persiste alterações na fonte administrativa e, quando necessário, cria
    // o espelho de usuários que vieram apenas do PostgreSQL.
    await persistirDadosUsuario(u, updates, req);

    // Atualiza também a aba PERMISSOES_USUARIO (fonte lida por carregarPermissoesUsuario)
    if (modulosNiveis !== undefined || competencias !== undefined) {
      const emailAlvo = u.EMAIL || u.USUARIO || u.ID_USUARIO;
      const idAlvo = u.ID_USUARIO || u.USUARIO || u.EMAIL;
      const competenciasStr = Array.isArray(competencias) ? competencias.join(',') : (competencias !== undefined ? (competencias||'') : (u.COMPETENCIAS||''));
      const modulosObj = modulosNiveis !== undefined ? (modulosNiveis || {}) : {};
      // Remove registros anteriores deste usuário e insere novo
      const rowsExist = await lerAba('PERMISSOES_USUARIO', 2000).catch(()=>[]);
      const existente = rowsExist.find(r =>
        String(r.USUARIO_ID||'').toLowerCase() === String(idAlvo||'').toLowerCase() ||
        String(r.USUARIO_EMAIL||'').toLowerCase() === String(emailAlvo||'').toLowerCase()
      );
      if (existente && (existente.ID_PERMISSAO || existente.USUARIO_ID)) {
        // Atualiza linha existente
        const chPerm = existente.ID_PERMISSAO || existente.USUARIO_ID;
        await atualizarPorID('PERMISSOES_USUARIO', chPerm, {
          MODULO: Object.keys(modulosObj).length ? JSON.stringify(modulosObj) : '',
          COMPETENCIAS: competenciasStr,
          ATUALIZADO_EM: new Date().toISOString(),
          ATUALIZADO_POR: req.user.usuario||'MASTER',
        }, ['ID_PERMISSAO','USUARIO_ID']).catch(e => console.warn('[PERM] PERMISSOES_USUARIO update falhou:', e.message));
      } else {
        // Cria nova linha
        const idPerm = await gerarProximoID('PERMISSOES_USUARIO','PRM','ID_PERMISSAO').catch(()=>null);
        await appendObjeto('PERMISSOES_USUARIO', {
          ID_PERMISSAO: idPerm || `PRM-${Date.now()}`,
          USUARIO_ID: idAlvo,
          USUARIO_EMAIL: emailAlvo,
          EMPRESA: empresa || u.EMPRESA || '',
          PERFIL: perfil ? normalizarPerfil(perfil) : (u.PERFIL||''),
          MODULO: Object.keys(modulosObj).length ? JSON.stringify(modulosObj) : '',
          NIVEL: '',
          COMPETENCIAS: competenciasStr,
          STATUS: 'ATIVO',
          CRIADO_EM: new Date().toISOString(),
          CRIADO_POR: req.user.usuario||'MASTER',
          ATUALIZADO_EM: new Date().toISOString(),
          ATUALIZADO_POR: req.user.usuario||'MASTER',
        }).catch(e => console.warn('[PERM] PERMISSOES_USUARIO append falhou:', e.message));
      }
      invalidarCacheAba('PERMISSOES_USUARIO');
    }

    invalidarCacheAba('USUARIOS');
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
    const u = encontrarUsuarioPorIdentificador(usuarios, req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    await persistirStatusUsuario(u, 'ATIVO', req);
    await registrarAuditoriaAcesso(u.EMAIL||u.USUARIO, 'USUARIO_ATIVADO', '', u.EMPRESA, u.STATUS||'INATIVO', 'ATIVO', req.user.usuario||'MASTER');
    res.json({sucesso:true, mensagem:'Usuário ativado.'});
  } catch(e) { res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

app.post('/api/admin/usuarios/:id/desativar', requerPerfil('MASTER'), async (req, res) => {
  try {
    const usuarios = await carregarUsuarios();
    const u = encontrarUsuarioPorIdentificador(usuarios, req.params.id);
    if (!u) return res.status(404).json({sucesso:false,erro:'Usuário não encontrado.'});
    if (normalizarPerfil(u.PERFIL)==='MASTER' && u.ID_USUARIO===req.user.id) return res.status(400).json({sucesso:false,erro:'Não pode desativar a si mesmo.'});
    await persistirStatusUsuario(u, 'INATIVO', req);
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
    const { respostaId, token, empresa, nps, setor, descricao, responsavel, prazo } = req.body || {};
    if (!respostaId && !token) return res.status(400).json({ sucesso: false, erro: 'respostaId ou token obrigatório.' });
    const respostas = await lerRespostasPesquisa();
    const resposta = respostas.find(r => (respostaId && r.ID_RESPOSTA === respostaId) || (token && r.TOKEN === token));
    if (!resposta) return res.status(404).json({ sucesso: false, erro: 'Resposta de pesquisa não encontrada.' });
    const empresaResposta = resposta.EMPRESA || empresa || '';
    const perfilAtual = perfilCanonico(req.user?.perfil || '');
    if (perfilAtual !== 'MASTER' && !pertenceEmpresa(req.user?.empresa || '', empresaResposta)) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para a empresa desta pesquisa.' });
    }
    await garantirAbaComCabecalhos('PESQUISA_OCORRENCIAS', ['ID_OCP','ID_RESPOSTA','TOKEN','EMPRESA','DATA','NPS','SETOR','RESPONSAVEL','PRAZO','STATUS','DECISAO','JUSTIFICATIVA','ID_MANIFESTACAO_GERADA','ANALISTA','DATA_DECISAO','DESCRICAO','RESULTADO','ENCERRADO_EM','HISTORICO_JSON']);
    const existentes = await lerAba('PESQUISA_OCORRENCIAS', 5000).catch(() => []);
    const existente = existentes.find(o => ((respostaId && o.ID_RESPOSTA === respostaId) || (token && o.TOKEN === token)) && !['CANCELADA','EXCLUIDA'].includes(String(o.STATUS||'').toUpperCase()));
    if (existente) return res.json({ sucesso: true, id: existente.ID_OCP, existente: true });
    const idOcp = 'OCP-' + Date.now();
    await appendObjeto('PESQUISA_OCORRENCIAS', {
      ID_OCP: idOcp, ID_RESPOSTA: resposta.ID_RESPOSTA || respostaId || '', TOKEN: resposta.TOKEN || token || '', EMPRESA: empresaResposta, DATA: new Date().toISOString(),
      NPS: nps != null ? String(nps) : String(resposta.NOTA_MEDIA || ''), SETOR: setor || '', RESPONSAVEL: responsavel || '', PRAZO: prazo || '', STATUS: 'PENDENTE',
      DECISAO: '', JUSTIFICATIVA: '', ID_MANIFESTACAO_GERADA: '', DESCRICAO: descricao || '',
      ANALISTA: req.user?.usuario || '', DATA_DECISAO: '', RESULTADO: '', ENCERRADO_EM: '',
      HISTORICO_JSON: JSON.stringify([{ data:new Date().toISOString(), usuario:req.user?.usuario||'', acao:'OCP_CRIADA' }]),
    });
    invalidarCacheAba('PESQUISA_OCORRENCIAS');
    res.json({ sucesso: true, id: idOcp });
  } catch(e) { res.status(500).json({ sucesso: false, erro: erroSeguro(e,'create-ocp') }); }
});

app.patch('/api/pesquisas/ocorrencias/:id', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req, res) => {
  try {
    const { status, decisao, justificativa, idManifestacao, setor, responsavel, prazo, resultado, descricao } = req.body || {};
    const rows = await lerAba('PESQUISA_OCORRENCIAS', 2000);
    const ocp = rows.find(r => r.ID_OCP === req.params.id);
    if (!ocp) return res.status(404).json({ sucesso: false, erro: 'OCP não encontrada.' });
    const perfilAtual = perfilCanonico(req.user?.perfil || '');
    if (perfilAtual !== 'MASTER' && !pertenceEmpresa(req.user?.empresa || '', ocp.EMPRESA || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Acesso não autorizado para a empresa desta ocorrência.' });
    }
    const upd = {};
    if (status) upd.STATUS = status;
    if (decisao) upd.DECISAO = decisao;
    if (justificativa) upd.JUSTIFICATIVA = justificativa;
    if (idManifestacao) upd.ID_MANIFESTACAO_GERADA = idManifestacao;
    if (setor != null) upd.SETOR = setor;
    if (responsavel != null) upd.RESPONSAVEL = responsavel;
    if (prazo != null) upd.PRAZO = prazo;
    if (resultado != null) upd.RESULTADO = resultado;
    if (descricao != null) upd.DESCRICAO = descricao;
    upd.ANALISTA = req.user?.usuario || ocp.ANALISTA || '';
    upd.DATA_DECISAO = new Date().toISOString();
    if (['CONCLUIDA','ENCERRADA'].includes(String(status||'').toUpperCase())) upd.ENCERRADO_EM = new Date().toISOString();
    let historico = [];
    try { historico = JSON.parse(ocp.HISTORICO_JSON || '[]'); } catch(e) {}
    historico.push({ data:new Date().toISOString(), usuario:req.user?.usuario||'', acao:'OCP_ATUALIZADA', status:status||ocp.STATUS||'', decisao:decisao||'' });
    upd.HISTORICO_JSON = JSON.stringify(historico);
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
    if (!Array.isArray(registros) || !registros.length) return res.status(400).json({ sucesso: false, erro: 'envie ao menos um registro.' });
    const fonteNormalizada = String(fonte).toUpperCase();
    const alvo = fonteNormalizada === 'MANIFESTACOES' ? 'MANIFESTACOES' : fonteNormalizada === 'PESQUISA_RESPOSTAS' ? 'PESQUISA_RESPOSTAS' : null;
    if (!alvo) return res.status(400).json({ sucesso: false, erro: 'fonte não autorizada para importação.' });
    await garantirAbaComCabecalhos('IMPORTACAO_HISTORICO', ['ID_IMP','FONTE','DESCRICAO','STATUS','REGISTROS_TOTAL','REGISTROS_OK','REGISTROS_ERR','USUARIO','DATA_INICIO','DATA_FIM','PODE_DESFAZER','DESFAZENDO_EM','ERROS_JSON']);
    const idImp = 'IMP-' + Date.now();
    const existentes = await lerAba(alvo, 5000).catch(()=>[]);
    const chave = alvo === 'MANIFESTACOES' ? r => r.ID_MANIFESTACAO || r.PROTOCOLO : r => r.ID_RESPOSTA || r.TOKEN;
    const idsExistentes = new Set(existentes.map(chave).filter(Boolean).map(String));
    const erros = [], duplicados = [];
    const validos = registros.filter((registro, index) => {
      const id = chave(registro);
      if (!id) { erros.push({linha:index+2,erro:'identificador obrigatório'}); return false; }
      if (idsExistentes.has(String(id))) { duplicados.push({linha:index+2,id:String(id)}); return false; }
      if (alvo === 'MANIFESTACOES' && !String(registro.EMPRESA_RECLAMADA||'').trim()) { erros.push({linha:index+2,erro:'EMPRESA_RECLAMADA obrigatória'}); return false; }
      idsExistentes.add(String(id)); return true;
    });
    for (const registro of validos) await appendObjeto(alvo, registro);
    const agora = new Date().toISOString();
    await appendObjeto('IMPORTACAO_HISTORICO', {
      ID_IMP: idImp, FONTE: fonteNormalizada, DESCRICAO: descricao || '', STATUS: erros.length || duplicados.length ? 'CONCLUIDA_COM_ALERTAS' : 'CONCLUIDA',
      REGISTROS_TOTAL: registros.length, REGISTROS_OK: validos.length, REGISTROS_ERR: erros.length,
      USUARIO: req.user?.usuario || '', DATA_INICIO: agora, DATA_FIM: new Date().toISOString(),
      PODE_DESFAZER: 'NAO', DESFAZENDO_EM: '', ERROS_JSON: JSON.stringify({erros,duplicados}),
    });
    invalidarCacheAba('IMPORTACAO_HISTORICO'); invalidarCacheAba(alvo);
    res.json({ sucesso: true, id: idImp, status: 'CONCLUIDA', registrosOk: validos.length, registrosDuplicados: duplicados.length, registrosErr: erros.length, erros, duplicados });
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
    if (!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
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
    if (!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
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
    if (!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
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
    if (!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
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
    if (!escopoPermite(req, rnc.EMPRESA)) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado.'});
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

    const aiSvc = (() => { try { return require('../server-services/aiService'); } catch { return null; } })();
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
// PORTAL DO CLIENTE — rotas públicas e de configuração
// ═════════════════════════════════════════════════════════════════════════════
app.get('/portal', (req, res) => {
  res.sendFile(require('path').join(__dirname, '../public/portal.html'));
});

app.get('/api/public/pesquisas-ativas', publicRateLimit, async (req, res) => {
  try {
    const config = await lerAba('CONFIG_PORTAL', 200);
    const empresas = PORTAL_EMPRESAS
      .filter(e => !config.some(c => c.TIPO === `PESQUISA_ATIVA_${e.slug.toUpperCase()}` && c.ATIVO === 'NAO'))
      .map(({ slug, nome, cor, logo }) => ({ slug, nome, cor, logo }));
    res.json({ sucesso: true, empresas });
  } catch(e) { res.status(503).json({ sucesso: false, erro: 'Não foi possível carregar as pesquisas. Tente novamente.' }); }
});

app.post('/api/pesquisas/resposta-portal', async (req, res) => {
  try {
    const body = req.body || {};
    const empresa = String(body.empresa || '').trim().slice(0, 100);
    if (!empresa) return res.status(400).json({ sucesso: false, erro: 'Empresa obrigatória.' });
    const empresaPortal = PORTAL_EMPRESAS.find(e => e.codigo === empresaCanonica(empresa) || normalizarTexto(e.nome) === normalizarTexto(empresa));
    if (!empresaPortal) return res.status(400).json({ sucesso: false, erro: 'Selecione uma empresa do grupo.' });
    const config = await lerAba('CONFIG_PORTAL', 200);
    if (config.some(c => c.TIPO === `PESQUISA_ATIVA_${empresaPortal.slug.toUpperCase()}` && c.ATIVO === 'NAO')) {
      return res.status(403).json({ sucesso: false, erro: 'A pesquisa desta empresa está temporariamente indisponível.' });
    }
    const atendimento = String(body.atendimento ?? '');
    const prazo = String(body.prazo_de_entrega ?? '');
    const qualidade = String(body.qualidade_do_produto ?? '');
    const recomendacao = String(body.recomendaria_a_empresa ?? '');
    if ([atendimento, prazo, qualidade, recomendacao].some(n => n !== '' && (!Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 10))) {
      return res.status(400).json({ sucesso: false, erro: 'Informe avaliações entre 0 e 10.' });
    }
    const notas = [atendimento, prazo, qualidade, recomendacao].map(n => parseFloat(n)).filter(n => !isNaN(n) && n >= 0);
    if (!notas.length) return res.status(400).json({ sucesso: false, erro: 'Informe ao menos uma avaliação.' });
    const notaMedia = (notas.reduce((a,b)=>a+b,0)/notas.length).toFixed(1);
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA||6);
    const notaBaixa = notas.some(n => n <= NOTA_CRITICA) ? 'SIM' : 'NAO';
    const aba = 'PESQUISA_RESPOSTAS';
    const headers = ['ID_RESPOSTA','TOKEN','EMPRESA','NOME_CLIENTE','DATA','ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO','COMENTARIO','NOTA_MEDIA','NOTA_BAIXA','STATUS_OCP','ORIGEM'];
    await garantirAbaComCabecalhos(aba, headers);
    const idResp = 'RSP-' + Date.now();
    const obj = { ID_RESPOSTA: idResp, TOKEN: '', EMPRESA: empresa, NOME_CLIENTE: String(body.nome||'').trim().slice(0,200), DATA: new Date().toISOString(), ATENDIMENTO: atendimento, PRAZO_ENTREGA: prazo, QUALIDADE: qualidade, RECOMENDACAO: recomendacao, COMENTARIO: String(body.comentario||'').trim().slice(0,1000), NOTA_MEDIA: notaMedia, NOTA_BAIXA: notaBaixa, STATUS_OCP: '', ORIGEM: 'PORTAL_PUBLICO' };
    await appendObjeto(aba, obj);
    invalidarCacheAba(aba);
    res.json({ sucesso: true, id: idResp });
  } catch(e) { res.status(500).json({ sucesso: false, erro: 'Não foi possível registrar. Tente novamente.' }); }
});

const consultarProtocoloPortal = require('../server-services/portalConsulta')(lerAba);
async function responderConsultaPortal(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    res.json(await consultarProtocoloPortal(req.params.protocolo || req.body.protocolo, req.method === 'POST' ? req.body.identificador : undefined));
  } catch (e) {
    res.status(e.status || 500).json({ sucesso: false, erro: e.status ? e.message : 'Erro ao consultar protocolo.' });
  }
}
app.get('/api/public/protocolo/:protocolo', publicRateLimit, responderConsultaPortal);
app.post('/api/public/protocolo/consultar', publicRateLimit, responderConsultaPortal);

app.get('/api/public/whatsapp', publicRateLimit, async (req, res) => {
  try {
    const rows = await lerAba('CONFIG_PORTAL', 100).catch(()=>[]);
    const wa = rows.find(r => r.TIPO === 'WHATSAPP' && r.ATIVO === 'SIM');
    if (!wa || !wa.VALOR) return res.json({ sucesso:true, ativo:false });
    const webhookConfigurado = Boolean(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET);
    const apiConfigurada = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    res.json({ sucesso:true, ativo:true, numero:wa.VALOR, mensagem: wa.MENSAGEM||'Olá, preciso de ajuda.',
      integracaoTecnicaAtiva: webhookConfigurado && apiConfigurada,
      statusTecnico: webhookConfigurado && apiConfigurada ? 'CONFIGURADO' : 'LINK_MANUAL' });
  } catch(e) { res.json({ sucesso:true, ativo:false }); }
});

// Webhook oficial da WhatsApp Business Platform. A rota apenas recebe e
// persiste eventos; nenhuma mensagem vira manifestação sem decisão explícita
// do SAC. Tokens e segredos permanecem exclusivamente nas variáveis do host.
const WHATSAPP_EVENT_HEADERS = [
  'EVENT_ID','MESSAGE_ID','PHONE_NUMBER_ID','FROM_NUMBER','PROFILE_NAME',
  'MESSAGE_TYPE','MESSAGE_TEXT','RECEIVED_AT','STATUS','EMPRESA','ID_MANIFESTACAO',
  'RAW_JSON','CREATED_AT',
];

function whatsappSignatureValida(req) {
  const secret = String(process.env.WHATSAPP_APP_SECRET || '');
  const header = String(req.headers['x-hub-signature-256'] || '');
  if (!secret || !header.startsWith('sha256=')) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(req.rawBody || Buffer.from(JSON.stringify(req.body || {}))).digest('hex')}`;
  const a = Buffer.from(header); const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

app.get('/api/public/whatsapp/webhook', (req, res) => {
  const verifyToken = String(process.env.WHATSAPP_VERIFY_TOKEN || '');
  if (!verifyToken || String(req.query['hub.verify_token'] || '') !== verifyToken) {
    return res.status(403).send('forbidden');
  }
  if (String(req.query['hub.mode'] || '') !== 'subscribe' || !req.query['hub.challenge']) {
    return res.status(400).send('invalid webhook verification');
  }
  return res.status(200).send(String(req.query['hub.challenge']));
});

app.post('/api/public/whatsapp/webhook', async (req, res) => {
  if (!whatsappSignatureValida(req)) return res.status(401).json({ sucesso:false, erro:'Assinatura do webhook inválida.' });
  try {
    const payload = req.body || {};
    const eventos = [];
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const value = change?.value || {};
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          const text = message.text?.body || message.button?.text || message.interactive?.button_reply?.title || '';
          eventos.push({
            EVENT_ID: message.id || `${entry.id || 'entry'}:${message.timestamp || Date.now()}`,
            MESSAGE_ID: message.id || '',
            PHONE_NUMBER_ID: value.metadata?.phone_number_id || '',
            FROM_NUMBER: message.from || '',
            PROFILE_NAME: value.contacts?.[0]?.profile?.name || '',
            MESSAGE_TYPE: message.type || '',
            MESSAGE_TEXT: String(text).slice(0, 4000),
            RECEIVED_AT: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
            STATUS: 'RECEBIDA', EMPRESA: '', ID_MANIFESTACAO: '',
            RAW_JSON: JSON.stringify(message).slice(0, 12000), CREATED_AT: new Date().toISOString(),
          });
        }
      }
    }
    await garantirAbaComCabecalhos('WHATSAPP_EVENTOS', WHATSAPP_EVENT_HEADERS);
    const existentes = await lerAba('WHATSAPP_EVENTOS', 5000).catch(() => []);
    let gravados = 0; let duplicados = 0;
    for (const evento of eventos) {
      if (existentes.some(row => String(row.EVENT_ID || '') === evento.EVENT_ID || (evento.MESSAGE_ID && String(row.MESSAGE_ID || '') === evento.MESSAGE_ID))) {
        duplicados++; continue;
      }
      await appendObjeto('WHATSAPP_EVENTOS', evento);
      existentes.push(evento); gravados++;
    }
    res.status(200).json({ sucesso:true, recebidos:eventos.length, gravados, duplicados });
  } catch (e) {
    console.error('[WHATSAPP] webhook:', e.message);
    res.status(500).json({ sucesso:false, erro:'Não foi possível registrar o evento.' });
  }
});

app.get('/api/config/whatsapp', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const rows = await lerAba('CONFIG_PORTAL', 100).catch(()=>[]);
    const wa = rows.find(r => r.TIPO === 'WHATSAPP') || {};
    res.json({ sucesso:true, numero: wa.VALOR||'', mensagem: wa.MENSAGEM||'', ativo: wa.ATIVO==='SIM' });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/config/whatsapp/status', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const rows = await lerAba('CONFIG_PORTAL', 100).catch(() => []);
    const wa = rows.find(r => r.TIPO === 'WHATSAPP') || {};
    const eventos = await lerAba('WHATSAPP_EVENTOS', 5000).catch(() => []);
    const last = eventos.slice(-1)[0] || null;
    const webhook = Boolean(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET);
    const api = Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
    res.json({ sucesso:true, canal:'WHATSAPP', empresa:wa.EMPRESA||'', numeroConfigurado:Boolean(wa.VALOR),
      linkAtivo:wa.ATIVO === 'SIM', webhookConfigurado:webhook, apiConfigurada:api,
      statusTecnico:webhook && api ? 'CONFIGURADO' : (wa.VALOR ? 'LINK_MANUAL' : 'NÃO_CONFIGURADO'),
      ultimoEvento:last ? { id:last.EVENT_ID, recebidoEm:last.RECEIVED_AT, status:last.STATUS, erro:last.ERRO||'' } : null });
  } catch (e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e,'whatsapp-status') }); }
});

app.post('/api/config/whatsapp', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const { numero, mensagem, ativo } = req.body || {};
    const numeroLimpo = String(numero||'').replace(/[^0-9]/g,'');
    if (!numeroLimpo || numeroLimpo.length < 10) return res.status(400).json({ sucesso:false, erro:'Número inválido.' });
    await garantirAbaComCabecalhos('CONFIG_PORTAL', ['TIPO','VALOR','MENSAGEM','ATIVO','UPDATED_AT','UPDATED_BY']);
    const rows = await lerAba('CONFIG_PORTAL', 100).catch(()=>[]);
    const existing = rows.find(r => r.TIPO === 'WHATSAPP');
    const obj = { TIPO:'WHATSAPP', VALOR:numeroLimpo, MENSAGEM:String(mensagem||'Olá, preciso de ajuda.').slice(0,500), ATIVO: ativo?'SIM':'NAO', UPDATED_AT:new Date().toISOString(), UPDATED_BY: req.user?.usuario||'' };
    if (existing) { await atualizarPorID('CONFIG_PORTAL','WHATSAPP',obj,['TIPO']).catch(()=>appendObjeto('CONFIG_PORTAL',obj)); } else { await appendObjeto('CONFIG_PORTAL',obj); }
    invalidarCacheAba('CONFIG_PORTAL');
    await registrarAuditoria(req.user?.usuario||'sistema','PORTAL_ADMIN_CONFIG','WHATSAPP','CONFIG_PORTAL',existing?.VALOR||'',{ativo:obj.ATIVO,valor:'[protegido]' });
    res.json({ sucesso:true });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

// Configurações operacionais compartilhadas pela Central de Configurações.
// Somente chaves com suporte explícito são aceitas; valores ficam persistidos
// na base oficial e cada alteração gera trilha de auditoria.
const CONFIGURACOES_EDITAVEIS = new Set(['canais','prazos']);
app.get('/api/configuracoes', requerPerfil('MASTER','GESTOR SAC'), async (req,res)=>{
  try {
    await garantirAbaComCabecalhos('CONFIGURACOES',['CHAVE','VALOR_JSON','ATUALIZADO_EM','ATUALIZADO_POR']);
    const rows=await lerAba('CONFIGURACOES',200);
    const valores={};
    rows.forEach(r=>{ if(!r.CHAVE) return; try{ valores[r.CHAVE]=JSON.parse(r.VALOR_JSON||'null'); }catch(_){ valores[r.CHAVE]=null; } });
    res.json({sucesso:true,valores});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e),valores:{}}); }
});
app.put('/api/configuracoes', requerPerfil('MASTER','GESTOR SAC'), async (req,res)=>{
  try {
    const chave=String(req.body?.chave||'').trim();
    if(!CONFIGURACOES_EDITAVEIS.has(chave)) return res.status(400).json({sucesso:false,erro:'Configuração não editável por este serviço.'});
    if(req.body?.valor===undefined) return res.status(400).json({sucesso:false,erro:'Valor obrigatório.'});
    const valor=JSON.stringify(req.body.valor);
    if(valor.length>10000) return res.status(400).json({sucesso:false,erro:'Valor excede o limite permitido.'});
    await garantirAbaComCabecalhos('CONFIGURACOES',['CHAVE','VALOR_JSON','ATUALIZADO_EM','ATUALIZADO_POR']);
    const rows=await lerAba('CONFIGURACOES',200); const antigo=rows.find(r=>r.CHAVE===chave);
    const obj={CHAVE:chave,VALOR_JSON:valor,ATUALIZADO_EM:new Date().toISOString(),ATUALIZADO_POR:req.user?.usuario||''};
    if(antigo) await atualizarPorID('CONFIGURACOES',chave,obj,['CHAVE']); else await appendObjeto('CONFIGURACOES',obj);
    invalidarCacheAba('CONFIGURACOES');
    await registrarAuditoria(req.user?.usuario||'sistema','CONFIGURACAO_ALTERADA',chave,'CONFIGURACOES',antigo?.VALOR_JSON||'',valor);
    res.json({sucesso:true,chave,valor:req.body.valor});
  } catch(e){ res.status(500).json({sucesso:false,erro:erroSeguro(e)}); }
});

// ═════════════════════════════════════════════════════════════════════════════
// PORTAL ADMIN — rotas administrativas do Portal do Cliente
// ═════════════════════════════════════════════════════════════════════════════

app.get('/api/portal-admin/visao-geral', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const [respostas, mans, cfgRows] = await Promise.all([
      lerAba('PESQUISA_RESPOSTAS', 5000).catch(()=>[]),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
      lerAba('CONFIG_PORTAL', 100).catch(()=>[]),
    ]);
    const limite30 = new Date(Date.now() - 30*24*60*60*1000).toISOString();
    const respostasPortal = respostas.filter(r => r.ORIGEM === 'PORTAL_PUBLICO' && (r.DATA||'') >= limite30).length;
    const manifestacoesPortal = mans.filter(m => (m.ORIGEM === 'PORTAL_PUBLICO' || m.ORIGEM === 'PORTAL_FUNCIONARIO') && (m.DATA_ABERTURA||'') >= limite30).length;
    const cfg = tipo => cfgRows.find(r => r.TIPO === tipo);
    const ativo = tipo => cfg(tipo)?.ATIVO !== 'NAO';
    const atualizado = tipo => cfg(tipo)?.UPDATED_AT || '';
    const wa = cfgRows.find(r => r.TIPO === 'WHATSAPP' && r.ATIVO === 'SIM');
    const empresasAtivas = PORTAL_EMPRESAS.filter(e => ativo(`PESQUISA_ATIVA_${e.slug.toUpperCase()}`)).length;
    const statusPortal = portalEndereco.root ? 'Configurado' : 'Indisponível';
    const servicos = [
      { id:'manifestacoes', nome:'Registro de manifestações', empresa:'Todas', situacao:ativo('FORM_MANIFESTACAO_ATIVO') ? 'Publicado' : 'Desativado', atualizadoEm:atualizado('FORM_MANIFESTACAO_ATIVO'), destino:'manifestacoes' },
      { id:'protocolos', nome:'Consulta de protocolos', empresa:'Todas', situacao:portalEndereco.root ? 'Configurado' : 'Indisponível', atualizadoEm:'', destino:'links' },
      ...PORTAL_EMPRESAS.map(e => ({ id:`pesquisa-${e.slug}`, nome:`Pesquisa — ${e.nome}`, empresa:e.nome, situacao:ativo(`PESQUISA_ATIVA_${e.slug.toUpperCase()}`) ? 'Publicado' : 'Desativado', atualizadoEm:atualizado(`PESQUISA_ATIVA_${e.slug.toUpperCase()}`), destino:'pesquisas' })),
      { id:'whatsapp', nome:'Canal WhatsApp', empresa:'Todas', situacao:wa ? 'Ativo' : 'Inativo', atualizadoEm:wa?.UPDATED_AT || '', destino:'canais' },
    ];
    res.json({ sucesso:true, statusPublicacao:statusPortal, statusDetalhe:portalEndereco.root ? 'Endereço público configurado' : 'Endereço público indisponível', enderecoPublico:portalEndereco.root, portalSeparado:portalEndereco.separado, empresasAtivas, respostasPortal, manifestacoesPortal, whatsappAtivo:!!wa, servicos });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/portal-admin/config', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const rows = await lerAba('CONFIG_PORTAL', 200).catch(()=>[]);
    res.json({ sucesso:true, config: rows });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.post('/api/portal-admin/config', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const { tipo, valor, ativo, mensagem } = req.body || {};
    if (!tipo) return res.status(400).json({ sucesso:false, erro:'tipo obrigatório.' });
    await garantirAbaComCabecalhos('CONFIG_PORTAL', ['TIPO','VALOR','MENSAGEM','ATIVO','UPDATED_AT','UPDATED_BY']);
    const rows = await lerAba('CONFIG_PORTAL', 200).catch(()=>[]);
    const existing = rows.find(r => r.TIPO === tipo);
    const obj = { TIPO:tipo, VALOR:valor||'', MENSAGEM:mensagem||'', ATIVO:ativo||'SIM', UPDATED_AT:new Date().toISOString(), UPDATED_BY:req.user?.usuario||'' };
    if (existing) { await atualizarPorID('CONFIG_PORTAL', tipo, obj, ['TIPO']).catch(()=>appendObjeto('CONFIG_PORTAL', obj)); } else { await appendObjeto('CONFIG_PORTAL', obj); }
    invalidarCacheAba('CONFIG_PORTAL');
    registrarAuditoria(req.user?.usuario||'sistema', 'PORTAL_ADMIN_CONFIG', tipo, 'CONFIG_PORTAL', null, { tipo, ativo, valor }).catch(()=>{});
    res.json({ sucesso:true });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
});

app.get('/api/portal-admin/historico', requerPerfil('MASTER','GESTOR SAC'), async (req, res) => {
  try {
    const rows = await lerAba('LOG_SISTEMA', 2000).catch(()=>[]);
    const hist = rows
      .filter(r => String(r.ACAO||'').includes('PORTAL_ADMIN'))
      .slice(-100).reverse()
      .map(r => ({ dataHora:r.DATA_HORA, usuario:r.USUARIO, acao:r.ACAO, entidade:r.ENTIDADE, valorAnterior:r.VALOR_ANTERIOR, valorNovo:r.VALOR_NOVO }));
    res.json({ sucesso:true, historico:hist });
  } catch(e) { res.status(500).json({ sucesso:false, erro:erroSeguro(e) }); }
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
