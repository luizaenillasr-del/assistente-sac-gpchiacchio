const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Readable } = require('stream');
const { google } = require('googleapis');
const cerebroService = require('./services/cerebroServices');
const documentService = require('./services/documentService');
const { tratativaEngine, devolutivaEngine, assertividade: assertividadeService } = cerebroService;

// Repositórios PostgreSQL (F4/F7) — falha silenciosa, fallback para Sheets
let usuarioRepo, manifestacaoRepo, rncRepo, empresaRepo, conhecimentoRepo;
try {
  usuarioRepo = require('../database/repositories/usuarioRepository');
  manifestacaoRepo = require('../database/repositories/manifestacaoRepository');
  rncRepo = require('../database/repositories/rncRepository');
  empresaRepo = require('../database/repositories/empresaRepository');
  conhecimentoRepo = require('../database/repositories/conhecimentoRepository');
} catch (e) {
  console.warn('[F4] Repositórios PG não disponíveis:', e.message);
}

const app = express();
const ALLOWED_ORIGINS = [
  'https://assistente-sac-gpchiacchio.vercel.app',
  'https://assistente-sac-gpchiacchio-grudfk40c-luiza4.vercel.app',
];
const corsOptions = { origin: (origin, cb) => { if (!origin || ALLOWED_ORIGINS.includes(origin)) cb(null, true); else cb(new Error('CORS: origem não permitida')); }, credentials: true };
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '25mb' }));

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
  return res.data; // { id, name, webViewLink, webContentLink }
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  console.error('FATAL: SESSION_SECRET não definida ou com menos de 32 caracteres. Defina SESSION_SECRET nas variáveis de ambiente.');
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function normalizarTexto(v){
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
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
function senhaValida(informada, armazenada){
  if(armazenada === undefined || armazenada === null) return false;
  const s=String(armazenada);
  if(s.startsWith('sha256:')) return 'sha256:'+crypto.createHash('sha256').update(String(informada||'')).digest('hex')===s;
  return String(informada||'')===s;
}

const DEMO_USUARIOS = [
  {ID_USUARIO:'USR-DEMO-001',USUARIO:'luiza',EMAIL:'',NOME:'Luiza',PERFIL:'MASTER',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:b5d54c39e66671c9731b9f471e585d8262cd4f54daa9d7d033747a98ea9a9ef0',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-002',USUARIO:'joao.aprovador',EMAIL:'',NOME:'João Silva',PERFIL:'APROVADOR',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:6dac17e7e0b3cb2daab875c67f0d7aca8cc55c76bbda66a98bf0998adce94c24',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-003',USUARIO:'ana.sac',EMAIL:'',NOME:'Ana Lima',PERFIL:'ANALISTA SAC',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:9da73d36e056bc7f73238b4d8ee869a0991788cf56e909d585a6071e45d45f0a',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-004',USUARIO:'carlos.rca',EMAIL:'',NOME:'Carlos Silva',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'Chiacchio',SETOR:'Comercial',STATUS:'ATIVO',SENHA:'sha256:63b64c1e65ce5ca36cb6a6f2378519135ae7165cc9720ece1fa2783b71853ece',CODIGO_RCA:'RCA-023'},
  {ID_USUARIO:'USR-DEMO-005',USUARIO:'maria.qualidade',EMAIL:'',NOME:'Maria Santos',PERFIL:'SETOR RESPONSÁVEL',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'sha256:9e5c100eb752ffcd3836498f695fb63ba122a41223f770d7921713d7ed7700e4',CODIGO_RCA:''}
];

async function carregarUsuarios(){
  // F4: tenta PostgreSQL primeiro
  if (usuarioRepo) {
    try {
      const pgUsers = await usuarioRepo.findAll({ ativo: true });
      if (pgUsers && pgUsers.length > 0) {
        const mapped = pgUsers.map(u => ({
          ID_USUARIO: u.idOriginal || `USR-PG-${u.id}`,
          USUARIO: u.login || u.email,
          EMAIL: u.email || '',
          NOME: u.nome || u.login,
          PERFIL: u.perfil?.codigo || u.perfil?.nome || 'ANALISTA SAC',
          EMPRESA: u.empresa?.nome || '',
          SETOR: u.setor?.nome || '',
          STATUS: u.status || 'ATIVO',
          SENHA: u.senhaHash || '',
          CODIGO_RCA: u.codigoRca || '',
          ULTIMO_ACESSO: u.ultimoAcesso?.toISOString?.() || '',
          _pgId: u.id,
        }));
        const demoEnabled = String(process.env.DEMO_LOGIN_ENABLED || 'false').toLowerCase() === 'true';
        return [...mapped, ...(demoEnabled ? DEMO_USUARIOS : [])];
      }
    } catch (e) { console.warn('[F4] carregarUsuarios PG falhou, usando Sheets:', e.message); }
  }
  // Fallback Sheets
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
    'master':'MASTER','administrador':'MASTER','admin':'MASTER',
    'analista sac':'ANALISTA SAC','analista':'ANALISTA SAC',
    'setor responsavel':'SETOR RESPONSÁVEL','setor responsável':'SETOR RESPONSÁVEL',
    'aprovador':'APROVADOR','rca':'RCA / REPRESENTANTE','representante':'RCA / REPRESENTANTE','representante comercial':'RCA / REPRESENTANTE'
  };
  return map[x]||String(v||'').toUpperCase();
}

function usuarioPublico(u){
  return {
    id:u.ID_USUARIO||u.ID||u.USUARIO||u.EMAIL,
    usuario:u.USUARIO||u.EMAIL||u.ID_USUARIO,
    nome:u.NOME||u.NOME_COMPLETO||u.USUARIO||u.EMAIL,
    email:u.EMAIL||'',
    perfil:perfilCanonico(u.PERFIL||u.PERFIL_USUARIO),
    empresa:u.EMPRESA||'', setor:u.SETOR||'', codigoRCA:u.CODIGO_RCA||u.RCA||'', status:u.STATUS||'ATIVO',
    ultimoAcesso:u.ULTIMO_ACESSO||'', dataCriacao:u.DATA_CRIACAO||''
  };
}

function requerPerfil(...perfis){
  return (req,res,next)=>{
    const permitido=perfis.map(perfilCanonico).includes(perfilCanonico(req.user?.perfil));
    if(!permitido) return res.status(403).json({sucesso:false,erro:'Acesso não autorizado para este perfil.'});
    next();
  };
}

async function carregarUsuarioPorLogin(login){
  const alvo=normalizarTexto(login);
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'false').toLowerCase()==='true';
  if(demoEnabled){
    const demo=DEMO_USUARIOS.find(u=>normalizarTexto(u.USUARIO)===alvo);
    if(demo) return demo;
  }
  // F4: tenta PostgreSQL primeiro por login ou email
  if (usuarioRepo) {
    try {
      let pgU = await usuarioRepo.findByLogin(login).catch(() => null);
      if (!pgU) pgU = await usuarioRepo.findByEmail(login).catch(() => null);
      if (pgU && normalizarTexto(pgU.status || 'ATIVO') !== 'inativo') {
        return {
          ID_USUARIO: pgU.idOriginal || `USR-PG-${pgU.id}`,
          USUARIO: pgU.login || pgU.email,
          EMAIL: pgU.email || '',
          NOME: pgU.nome || pgU.login,
          PERFIL: pgU.perfil?.codigo || pgU.perfil?.nome || 'ANALISTA SAC',
          EMPRESA: pgU.empresa?.nome || '',
          SETOR: pgU.setor?.nome || '',
          STATUS: pgU.status || 'ATIVO',
          SENHA: pgU.senhaHash || '',
          CODIGO_RCA: pgU.codigoRca || '',
          _pgId: pgU.id,
        };
      }
    } catch (e) { console.warn('[F4] carregarUsuarioPorLogin PG falhou:', e.message); }
  }
  // Fallback Sheets
  const usuarios=await carregarUsuarios();
  return usuarios.find(u=>normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO)===alvo && normalizarTexto(u.STATUS||'ATIVO')!=='inativo') || null;
}

async function registrarAcessoUsuario(usuario){
  // F4: atualiza PostgreSQL se disponível
  if (usuarioRepo && usuario._pgId) {
    usuarioRepo.registrarAcesso(usuario._pgId).catch(() => {});
  }
  try{
    await atualizarPorID('USUARIOS',usuario.ID_USUARIO||usuario.USUARIO||usuario.EMAIL,{ULTIMO_ACESSO:new Date().toISOString()},['ID_USUARIO','USUARIO','EMAIL']);
  }catch(e){}
}

async function getSheets() {
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function lerAba(nomeAba, maxRows) {
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:AZ${maxRows}` : nomeAba;
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
    return obj;
  });
}

async function appendLinha(nomeAba, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID, range: nomeAba,
    valueInputOption: 'RAW', resource: { values: [linha] },
  });
}

async function updateLinha(nomeAba, rowIndex, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID, range: `${nomeAba}!A${rowIndex}`,
    valueInputOption: 'RAW', resource: { values: [linha] },
  });
}

async function obterCabecalhos(nomeAba) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID, range: `${nomeAba}!1:1`, valueRenderOption: 'FORMATTED_VALUE',
  });
  return res.data.values?.[0] || [];
}

async function appendObjeto(nomeAba, objeto) {
  const headers = await obterCabecalhos(nomeAba);
  if (!headers.length) throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  const linha = headers.map(h => objeto[h] !== undefined ? objeto[h] : '');
  await appendLinha(nomeAba, linha);
  return { headers, linha };
}

async function atualizarPorID(nomeAba, id, dados, camposID = ['ID_MANIFESTACAO','ID_RNC','ID_APROVADOR','ID_SUGESTAO','ID_ANEXO','ID_EVENTO']) {
  const sheets = await getSheets();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: nomeAba, valueRenderOption: 'FORMATTED_VALUE' });
  const rows = res.data.values || [];
  if (rows.length < 2) return null;
  const headers = rows[0];
  let idCol = camposID.find(c => headers.includes(c));
  if (!idCol) return null;
  const idIdx = headers.indexOf(idCol);
  let rowIndex = -1;
  for (let i=1;i<rows.length;i++) {
    if (String(rows[i][idIdx] || '').trim() === String(id).trim()) { rowIndex=i+1; break; }
  }
  if (rowIndex < 0) return null;
  const valores = [...rows[rowIndex-1]];
  headers.forEach((h,i)=>{ if(Object.prototype.hasOwnProperty.call(dados,h)) valores[i]=dados[h]; });
  await updateLinha(nomeAba,rowIndex,valores);
  return { rowIndex, headers, valores };
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

    const geraRNC = texto.includes('reincidência') || texto.includes('terceira') || texto.includes('repetiu') || prioridade === 'Alta';

    return { tipoDetectado, tipoID, tipoConfianca, setores, regraAplicada, slaHoras, prioridade, procedimentoSugerido, perguntasNecessarias, geraRNC };
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
  const analise = await cerebroService.analisarManifestacao({
    ...manifestacao,
    empresaReclamante: manifestacao.empresaReclamante || manifestacao.EMPRESA_RECLAMANTE,
    descricao: manifestacao.descricao || manifestacao.DESCRICAO,
  }, regras);
  return { ...analise, tipoID: regras.tipoID, tempoAnaliseSegundos: Math.round((Date.now() - inicio) / 1000) };
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

app.get('/api/health', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '5.6.0', sistema: 'Assistente SAC Chiacchio', ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '5.6.0', sistema: 'Assistente SAC Chiacchio' });
});

// ===== MIDDLEWARE AUTH =====
app.use('/api', async (req,res,next)=>{
  const publicPaths = new Set([
    '/health',
    '/',
    '/auth/login',
    '/auth/forgot-password',
    '/bootstrap',
    '/_importar',
    '/_reset',
  ]);
  if(publicPaths.has(req.path)) return next();
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida ou expirada.'});
  req.user=payload;
  next();
});

// ===== RATE LIMITING para login =====
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
    if(normalizarTexto(pub.status)==='inativo') return res.status(403).json({sucesso:false,erro:'Usuário inativo.'});
    const senhaOk = senhaValida(senha, registro.SENHA_HASH || registro.SENHA);
    if(!senhaOk) return res.status(401).json({sucesso:false,erro:'Usuário ou senha inválidos.'});
    const agora=Date.now();
    const payload={
      sub:pub.id, usuario:pub.usuario, nome:pub.nome, email:pub.email, perfil:pub.perfil,
      empresa:pub.empresa, setor:pub.setor, codigoRCA:pub.codigoRCA, iat:agora, exp:agora+SESSION_TTL_MS
    };
    const isDemo = String(registro.ID_USUARIO||'').startsWith('USR-DEMO-');
    if (!isDemo) {
      await registrarAcessoUsuario(registro);
      await registrarAuditoria(pub.usuario,'LOGIN',null,'AUTH',null,{perfil:pub.perfil});
    }
    res.json({ sucesso:true, token:assinarToken(payload), usuario:pub.usuario, usuarioInfo:pub, modo:isDemo?'DEMO':'PRODUCAO' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.get('/api/auth/me', async (req,res)=>{
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida.'});
  res.json({sucesso:true,usuario:payload});
});

app.post('/api/auth/forgot-password', async (req,res)=>{
  const login=req.body?.usuario||req.body?.email||'';
  if(!login) return res.status(400).json({sucesso:false,erro:'Informe usuário ou e-mail.'});
  await registrarAuditoria(login,'SOLICITOU_RECUPERACAO_SENHA',null,'AUTH',null,{});
  res.json({sucesso:true,mensagem:'Solicitação registrada. O administrador deverá redefinir a senha.'});
});

// ===== ANÁLISE IA =====
app.post('/api/analise', async (req, res) => {
  try {
    const { descricao, tipo, empresaReclamada, empresaReclamante, produto, lote } = req.body;
    if (!descricao) return res.status(400).json({ sucesso: false, erro: 'Descrição é obrigatória.' });
    const analise = await executarAnalise({ descricao, tipo, empresaReclamada, empresaReclamante, produto, lote });
    res.json({ sucesso: true, analise });
  } catch (e) {
    console.error(e);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.post('/api/analise/similares', async (req, res) => {
  try {
    const similares = await cerebroService.buscarCasosSimilares(req.body || {}, Number(req.body?.limite || 8));
    res.json({ sucesso:true, total:similares.length, itens:similares });
  } catch(e) {
    res.status(500).json({ sucesso:false, erro:e.message, itens:[] });
  }
});

// ===== PORTAL RCA =====
app.get('/api/representantes/meus-clientes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const rows=await lerAba('CLIENTES_REPRESENTANTES',5000).catch(()=>[]);
    const key=normalizarTexto(req.user.codigoRCA||req.user.usuario);
    const itens=rows.filter(x=>normalizarTexto(x.ID_REPRESENTANTE||x.CODIGO_RCA||x.RCA)===key);
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.get('/api/representantes/minhas-manifestacoes', requerPerfil('RCA / REPRESENTANTE'), async (req,res)=>{
  try{
    const rows=await lerAba('MANIFESTACOES',5000);
    const key=normalizarTexto(req.user.codigoRCA||req.user.usuario);
    const itens=rows.filter(x=>normalizarTexto(x.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(x.CODIGO_RCA||'')===key);
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
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
  }catch(e){console.error(e);res.status(500).json({sucesso:false,erro:e.message});}
});

// ===== MANIFESTAÇÕES =====
app.get('/api/manifestacoes', async (req, res) => {
  try {
    // F6: tenta PostgreSQL primeiro
    if (manifestacaoRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
        if (req.query.status) filtros.status = req.query.status;
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
    let data = await lerAba('MANIFESTACOES', 2000).catch(()=>[]);
    if (req.user && perfilCanonico(req.user.perfil)==='RCA / REPRESENTANTE') {
      const rca=normalizarTexto(req.user.codigoRCA||req.user.usuario);
      data=data.filter(r=>normalizarTexto(r.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(r.CODIGO_RCA||'')===rca||normalizarTexto(r.RCA||'')===rca);
    }
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message, dados: [] }); }
});

app.get('/api/manifestacoes/:id', async (req, res) => {
  try {
    // F6: tenta PostgreSQL primeiro
    if (manifestacaoRepo) {
      try {
        let pg = await manifestacaoRepo.findByProtocolo(req.params.id).catch(() => null);
        if (!pg) pg = await manifestacaoRepo.findByIdOriginal(req.params.id).catch(() => null);
        if (!pg && !isNaN(req.params.id)) pg = await manifestacaoRepo.findById(req.params.id).catch(() => null);
        if (pg) {
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
    const data = await lerAba('MANIFESTACOES', 2000).catch(()=>[]);
    const item = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Manifestação não encontrada.' });
    res.json({ sucesso: true, manifestacao: item });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

app.post('/api/manifestacoes', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { empresaReclamada, empresaReclamante, contato, produto, lote, nfe, descricao, tipo, canal, cnpj, telefone, email, quantidade, valor, usuario, anexos = [], origemDocumento = '', arquivoOrigem = '' } = req.body;
    if (!empresaReclamante || !descricao) return res.status(400).json({ sucesso:false, erro:'Empresa reclamante e descrição são obrigatórios.' });
    const empNorm = normalizarEmpresa(empresaReclamada);
    // Não bloqueia na criação de colunas — a aba já existe em produção
    garantirAbaComCabecalhos('MANIFESTACOES',['ID_MANIFESTACAO','DATA_ABERTURA','DATA_REGISTRO','EMPRESA_RECLAMANTE','CONTATO','PRODUTO','LOTE','NFE','DESCRICAO','DESCRICAO_MANIFESTACAO','STATUS','TIPO','TIPO_SUGERIDO','SETOR_SUGERIDO','SETORES_SUGERIDOS','PROCEDIMENTO_SUGERIDO','SLA_HORAS','PRIORIDADE','RNC_SUGERIDO','EMPRESA_RECLAMADA','CANAL','CNPJ','TELEFONE','EMAIL','QUANTIDADE','VALOR','TRATATIVA_SUGERIDA','TRATATIVA_APLICAVEL','TRATATIVA_REALIZADA','STATUS_TRATATIVA','DEVOLUTIVA_SUGERIDA','DEVOLUTIVA_FINAL','DEVOLUTIVA_ENVIADA','ORIGEM_DOCUMENTO','ARQUIVO_ORIGEM','USUARIO_CRIACAO','ORIGEM','TIPO_CONFIRMADO','SETORES_CONFIRMADOS','ID_PROCEDIMENTO_APLICADO','GERA_RNC','DATA_INICIO_TRATATIVA','DATA_CONCLUSAO_TRATATIVA','DATA_DEVOLUTIVA','DATA_CONCLUSAO_MANIFESTACAO']).catch(()=>{});
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
    };
    await appendObjeto('MANIFESTACOES', objeto);
    // F6: dual-write para PostgreSQL (não-bloqueante)
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
      }).catch(e => console.warn('[F6] dual-write PG falhou:', e.message));
    }
    registrarAuditoria(usuario||'sistema','CRIOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,{empresaReclamante,tipo:tipoFinal}).catch(()=>{});
    // Responde ao cliente imediatamente após salvar (antes da IA)
    // A análise IA roda em background e atualiza a manifestação
    res.json({ sucesso:true, id, analise:null, mensagem:'Manifestação registrada com sucesso! A análise IA será processada em segundos.' });
    // IA + updates rodando em background (não bloqueiam a resposta)
    const decisaoCompleta = req.body.decisaoCompleta;
    setImmediate(async () => {
      try {
        const analise = await executarAnalise({ ...objeto, empresaReclamante, empresaReclamada, descricao, tipo:tipoFinal });
        if (analise) {
          await atualizarPorID('MANIFESTACOES', id, {
            TIPO_SUGERIDO:analise.tipoDetectado||analise.tipoSugerido||'',
            SETOR_SUGERIDO:Array.isArray(analise.setores)?analise.setores[0]||'':analise.setoresSugeridos?.[0]||'',
            SETORES_SUGERIDOS:Array.isArray(analise.setores)?analise.setores.join(', '):(analise.setoresSugeridos||[]).join(', '),
            PROCEDIMENTO_SUGERIDO:analise.procedimentoSugerido?.nome||'',
            SLA_HORAS:analise.slaHoras||'', PRIORIDADE:analise.prioridade||'',
            RNC_SUGERIDO:analise.geraRNC?'SIM':'NÃO', TRATATIVA_SUGERIDA:analise.tratativaSugerida?.sugestao||'',
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
      } catch (e) { console.error('Falha na análise automática background:', e.message); }
    });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.patch('/api/manifestacoes/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { id } = req.params;
    const STATUS_VALIDOS = ['EM ANÁLISE','AGUARDANDO_DECISÃO','EM TRATAMENTO','AGUARDANDO_DEVOLUTIVA','ENCERRADA','REJEITADA','APROVADA'];
    const dados = {};
    const { status, tratativa, devolutiva, setor, responsavel, observacoes } = req.body || {};
    if (status) {
      if (!STATUS_VALIDOS.includes(status)) return res.status(400).json({ sucesso:false, erro:`Status inválido: ${status}` });
      dados.STATUS = status;
      if (status === 'ENCERRADA') { dados.DATA_ENCERRAMENTO = new Date().toISOString(); dados.ENCERRADA_POR = req.user?.usuario||'sistema'; }
    }
    if (tratativa !== undefined) dados.TRATATIVA_REALIZADA = tratativa;
    if (devolutiva !== undefined) { dados.DEVOLUTIVA_FINAL = devolutiva; dados.DEVOLUTIVA_ENVIADA = devolutiva; }
    if (setor !== undefined) dados.SETOR_CONFIRMADO = setor;
    if (responsavel !== undefined) dados.RESPONSAVEL = responsavel;
    if (!Object.keys(dados).length) return res.status(400).json({ sucesso:false, erro:'Nenhum campo para atualizar.' });
    await atualizarPorID('MANIFESTACOES', id, dados);
    await registrarAuditoria(req.user?.usuario||'sistema','ATUALIZOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,dados);
    res.json({ sucesso:true, id, atualizado: dados });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/manifestacoes/:id/decisao', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { id } = req.params;
    const { tipoConfirmado, setoresConfirmados, procedimentoUsado, prioridade, slaHoras, geraRNC, observacoes, usuario, decisaoStatus, tratativaAplicavel, tratativaRealizada, dataInicioTratativa, dependeOutroSetor, setoresDependentes, dataAcionamentoSetor, prazoSetorSolicitado, dataRetornoSetor, statusTratativa, dataConclusaoTratativa, devolutivaFinal, devolutivaEnviada } = req.body;
    if (!usuario) return res.status(400).json({ sucesso:false, erro:'Usuário é obrigatório.' });
    const data = await lerAba('MANIFESTACOES',2000);
    const item = data.find(r => r.ID_MANIFESTACAO === id);
    if (!item) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
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
  } catch(e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message }); }
});


// ============================================================
// TRATATIVAS ESTRUTURADAS
// ============================================================

app.get('/api/manifestacoes/:id/tratativa', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try {
    const t = await tratativaEngine.buscarTratativaPorManifestacao(req.params.id);
    if (!t) return res.status(404).json({ sucesso:false, erro:'Nenhuma tratativa encontrada.' });
    res.json({ sucesso:true, tratativa:t });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/manifestacoes/:id/tratativa/gerar', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',2000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    const analise = await executarAnalise({ ...m, empresaReclamante: m.EMPRESA_RECLAMANTE, empresaReclamada: m.EMPRESA_RECLAMADA, descricao: m.DESCRICAO });
    const tratativa = analise.tratativaEstruturada;
    if (tratativa) await tratativaEngine.salvarTratativa(id, tratativa, req.user?.usuario||'sistema').catch(()=>{});
    res.json({ sucesso:true, tratativa, analise });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/manifestacoes/:id/tratativa/decisao', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const { decisao, observacoes, textoEditado } = req.body;
    if (!['ACEITA','EDITADA','REJEITADA'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
    const data = await lerAba('MANIFESTACOES',2000);
    const m = data.find(r=>r.ID_MANIFESTACAO===req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
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
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ============================================================
// DEVOLUTIVAS ESTRUTURADAS
// ============================================================

app.get('/api/manifestacoes/:id/devolutivas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try {
    const devs = await devolutivaEngine.buscarDevolutivasPorManifestacao(req.params.id);
    res.json({ sucesso:true, total:devs.length, itens:devs });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/manifestacoes/:id/devolutiva/gerar', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const id = req.params.id;
    const data = await lerAba('MANIFESTACOES',2000);
    const m = data.find(r=>r.ID_MANIFESTACAO===id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    const tipo = req.body.tipo || 'RECEBIMENTO';
    const extra = req.body || {};
    const dev = await devolutivaEngine.gerarDevolutiva({
      idManifestacao: id,
      tipo,
      empresa: m.EMPRESA_RECLAMADA||'',
      tipoManifestacao: m.TIPO||'',
      setor: m.SETOR_SUGERIDO||'SAC',
      protocolo: id,
      prazo: (m.SLA_HORAS||72)+' horas úteis',
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
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/devolutivas/:idDev/decisao', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const { decisao, textoAprovado, motivo } = req.body;
    if (!['APROVADA','EDITADA','REJEITADA'].includes(decisao)) return res.status(400).json({ sucesso:false, erro:'Decisão inválida.' });
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
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ============================================================
// ASSERTIVIDADE E MÉTRICAS
// ============================================================

app.get('/api/assertividade/metricas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const filtros = {
      empresa: req.query.empresa,
      tipoManifestacao: req.query.tipo,
      categoria: req.query.categoria,
      setor: req.query.setor,
      dias: req.query.dias ? Number(req.query.dias) : 30,
    };
    const metricas = await assertividadeService.calcularMetricas(filtros);
    res.json({ sucesso:true, ...metricas });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.get('/api/assertividade/sugestoes', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const result = await assertividadeService.gerarSugestoes();
    res.json({ sucesso:true, ...result });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/assertividade/resultado', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const r = await assertividadeService.registrarResultado({ ...req.body, usuario: req.user?.usuario });
    res.json({ sucesso:true, id:r.id });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ============================================================
// MATRIZ DE TRATAMENTO
// ============================================================

app.get('/api/matriz-tratamento', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const { matrizTratamento } = cerebroService;
    const regras = await matrizTratamento.carregarMatriz();
    res.json({ sucesso:true, total:regras.length, itens:regras });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

app.post('/api/matriz-tratamento/consultar', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try {
    const { matrizTratamento } = cerebroService;
    const resultado = await matrizTratamento.obterRegras(req.body||{});
    res.json({ sucesso:true, regra:resultado });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
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
async function garantirAbaComCabecalhos(nomeAba, headers){
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
  return [...(await obterCabecalhos(nomeAba))];
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

app.post('/api/setores', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
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
    await registrarAuditoria(req.user.usuario, 'CRIOU_SETOR', id, 'CONFIG_SETORES', null, obj);
    res.status(201).json({ sucesso: true, setor: obj });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

app.patch('/api/setores/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try {
    const id = req.params.id;
    const campos = ['SETOR','DESCRICAO','RESPONSAVEL','EMPRESA','SLA_HORAS','ATIVO'];
    const dados = {};
    campos.forEach(c => { if (req.body[c] !== undefined) dados[c] = req.body[c]; });
    await atualizarPorID('CONFIG_SETORES', id, dados, ['ID_SETOR']);
    const atualizado = await buscarPorID('CONFIG_SETORES', id, ['ID_SETOR']);
    await registrarAuditoria(req.user.usuario, 'ATUALIZOU_SETOR', id, 'CONFIG_SETORES', null, dados);
    res.json({ sucesso: true, setor: atualizado });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
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
  } catch(e) { res.status(500).json({sucesso:false, erro:e.message}); }
});

// ===== PRODUTOS =====
app.get('/api/produtos', async(req,res)=>{
  try {
    await garantirAbaComCabecalhos('PRODUTOS',['ID_PRODUTO','EMPRESA','PRODUTO','DESCRICAO','CATEGORIA','UNIDADE','ATIVO']);
    const rows = await lerAba('PRODUTOS', 2000);
    const empresa = req.query.empresa;
    const itens = empresa ? rows.filter(r => normalizarTexto(r.EMPRESA||'') === normalizarTexto(empresa)) : rows;
    res.json({ sucesso: true, total: itens.length, itens });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message, itens: [] }); }
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
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

app.get('/api/setores/:setor/operacional', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','DESCRICAO','RESPONSAVEL','SUBSTITUTO','EMAIL_RESPONSAVEL','SLA_HORAS','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS','ATIVO',...SETOR_OPERACIONAL_FIELDS]);
    await garantirAbaComCabecalhos('FAQ_SETORES',FAQ_HEADERS);
    const rows=await lerAba('CONFIG_SETORES',500); const setor=rows.find(r=>normalizarTexto(r.SETOR)===normalizarTexto(nome))||{SETOR:nome,ATIVO:'SIM'};
    const faq=(await lerAba('FAQ_SETORES',1000)).filter(r=>normalizarTexto(r.SETOR)===normalizarTexto(nome)&&normalizarTexto(r.ATIVO||'SIM')!=='nao');
    res.json({sucesso:true,setor,faq});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/operacional', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
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
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.post('/api/setores/:setor/faq', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// FAQ GET list
app.get('/api/setores/:setor/faq', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const itens=await crudSetorGet('FAQ_SETORES',FAQ_HEADERS,nome);
    res.json({sucesso:true,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

// REGRAS
app.get('/api/setores/:setor/regras', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('REGRAS_SETORES',REGRAS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});
app.post('/api/setores/:setor/regras', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('REGRAS_SETORES',REGRAS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,CONDICAO:req.body.CONDICAO||'',PALAVRAS_GATILHO:req.body.PALAVRAS_GATILHO||'',ACAO:req.body.ACAO||'',PRIORIDADE:req.body.PRIORIDADE||'Média',NECESSITA_APROVACAO:req.body.NECESSITA_APROVACAO||'NÃO',QUEM_APROVA:req.body.QUEM_APROVA||'',AUTOMATICA:req.body.AUTOMATICA||'NÃO',EXCECOES:req.body.EXCECOES||'',SLA:req.body.SLA||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'RGR','ID_REGRA',req.user.usuario);res.json({sucesso:true,id:obj.ID_REGRA});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/regras/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('REGRAS_SETORES',req.params.id,req.body,'ID_REGRA',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Regra não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// PROCEDIMENTOS
app.get('/api/setores/:setor/procedimentos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});
app.post('/api/setores/:setor/procedimentos', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,OBJETIVO:req.body.OBJETIVO||'',QUANDO_USAR:req.body.QUANDO_USAR||'',PASSOS:req.body.PASSOS||'',RESPONSAVEL:req.body.RESPONSAVEL||'',SETORES_ENVOLVIDOS:req.body.SETORES_ENVOLVIDOS||'',RESULTADO_ESPERADO:req.body.RESULTADO_ESPERADO||'',PRAZO:req.body.PRAZO||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'PRC','ID_PROC',req.user.usuario);res.json({sucesso:true,id:obj.ID_PROC});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/procedimentos/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('PROCEDIMENTOS_SETORES',req.params.id,req.body,'ID_PROC',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Procedimento não encontrado.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// POLÍTICAS
app.get('/api/setores/:setor/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('POLITICAS_SETORES',POLITICAS_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});
app.post('/api/setores/:setor/politicas', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.NOME)return res.status(400).json({sucesso:false,erro:'NOME obrigatório.'});const obj=await crudSetorPost('POLITICAS_SETORES',POLITICAS_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',NOME:req.body.NOME,OBJETIVO:req.body.OBJETIVO||'',REGRA_OFICIAL:req.body.REGRA_OFICIAL||'',LIMITES:req.body.LIMITES||'',CONDICOES:req.body.CONDICOES||'',EXCECOES:req.body.EXCECOES||'',QUEM_APROVA:req.body.QUEM_APROVA||'',PRAZO:req.body.PRAZO||'',VIGENCIA:req.body.VIGENCIA||'',STATUS:req.body.STATUS||'A VALIDAR',FONTE:req.body.FONTE||''},'POL','ID_POL',req.user.usuario);res.json({sucesso:true,id:obj.ID_POL});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/politicas/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('POLITICAS_SETORES',req.params.id,req.body,'ID_POL',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Política não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// PERGUNTAS DA IA
app.get('/api/setores/:setor/perguntas-ia', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome);res.json({sucesso:true,itens:itens.sort((a,b)=>parseInt(a.ORDEM||99)-parseInt(b.ORDEM||99))});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});
app.post('/api/setores/:setor/perguntas-ia', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);if(!req.body?.PERGUNTA)return res.status(400).json({sucesso:false,erro:'PERGUNTA obrigatória.'});const obj=await crudSetorPost('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome,{EMPRESA:req.body.EMPRESA||'TODAS',PERGUNTA:req.body.PERGUNTA,OBRIGATORIA:req.body.OBRIGATORIA||'SIM',MOTIVO:req.body.MOTIVO||'',CAMPO_DESTINO:req.body.CAMPO_DESTINO||'',TIPO_RESPOSTA:req.body.TIPO_RESPOSTA||'texto',ORDEM:req.body.ORDEM||99,ATIVO:req.body.ATIVO||'SIM'},'PRG','ID_PERG',req.user.usuario);res.json({sucesso:true,id:obj.ID_PERG});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/perguntas-ia/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('PERGUNTAS_IA_SETORES',req.params.id,req.body,'ID_PERG',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Pergunta não encontrada.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// DOCUMENTOS DO SETOR (metadados — upload usa /api/anexos)
app.get('/api/setores/:setor/documentos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{const nome=decodeURIComponent(req.params.setor);const itens=await crudSetorGet('DOCUMENTOS_SETORES',DOCS_SETOR_HEADERS,nome);res.json({sucesso:true,itens});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
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
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/setores/:setor/documentos/:id', requerPerfil('MASTER','ANALISTA SAC'), async(req,res)=>{
  try{const reg=await crudSetorPatch('DOCUMENTOS_SETORES',req.params.id,req.body,'ID_DOC',req.user.usuario);if(!reg)return res.status(404).json({sucesso:false,erro:'Documento não encontrado.'});res.json({sucesso:true});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// CONHECIMENTO COMPLETO — rota para o cérebro da IA
app.get('/api/setores/:setor/conhecimento-completo', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{
  try{
    const nome=decodeURIComponent(req.params.setor);
    const empresa=req.query.empresa||null;
    const filtroEmpresa=r=>!empresa||r.EMPRESA==='TODAS'||r.EMPRESA===empresa;
    const [config,faqs,regras,procs,pols,pergs,docs]=await Promise.all([
      lerAba('CONFIG_SETORES',500).then(rows=>rows.find(r=>normalizarTexto(r.SETOR||'')===normalizarTexto(nome))||{}),
      crudSetorGet('FAQ_SETORES',FAQ_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>(r.ATIVO||'SIM')!=='NÃO')),
      crudSetorGet('REGRAS_SETORES',REGRAS_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS!=='OBSOLETA')),
      crudSetorGet('PROCEDIMENTOS_SETORES',PROCEDIMENTOS_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS!=='OBSOLETA')),
      crudSetorGet('POLITICAS_SETORES',POLITICAS_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.STATUS==='VALIDADA')),
      crudSetorGet('PERGUNTAS_IA_SETORES',PERGUNTAS_IA_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>(r.ATIVO||'SIM')!=='NÃO').sort((a,b)=>parseInt(a.ORDEM||99)-parseInt(b.ORDEM||99))),
      crudSetorGet('DOCUMENTOS_SETORES',DOCS_SETOR_HEADERS,nome).then(rows=>rows.filter(filtroEmpresa).filter(r=>r.FONTE_CONHECIMENTO==='SIM'&&r.STATUS==='VALIDADA')),
    ]);
    res.json({sucesso:true,setor:nome,empresa:empresa||'TODAS',config,faqs,regras,procedimentos:procs,politicas:pols,perguntas_ia:pergs,documentos_fonte:docs});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

function ativoAgora(r){const hoje=new Date();const ini=r.VIGENCIA_INICIO?new Date(r.VIGENCIA_INICIO):null;const fim=r.VIGENCIA_FIM?new Date(r.VIGENCIA_FIM):null;return normalizarTexto(r.ATIVO||'sim')!=='nao'&&(!ini||hoje>=ini)&&(!fim||hoje<=fim);}
function adicionarDiasCalendario(data,qtd,tipo){if(!data||qtd===null||qtd===undefined||isNaN(Number(qtd)))return null;let d=new Date(String(data)+'T00:00:00');let n=0;while(n<Number(qtd)){d.setDate(d.getDate()+1);if(normalizarTexto(tipo).includes('util')){const w=d.getDay();if(w===0||w===6)continue;}n++;}return d.toISOString().slice(0,10);}
function diffDias(a,b){if(!a||!b)return null;return Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);}
function acharLogistica(rows,b){const cidade=normalizarTexto(b.cidade),uf=normalizarTexto(b.uf),reg=normalizarTexto(b.regiao);const ativos=rows.filter(ativoAgora);const score=r=>(normalizarTexto(r.CIDADE)===cidade&&normalizarTexto(r.UF)===uf?100:0)+(normalizarTexto(r.UF)===uf?20:0)+(reg&&normalizarTexto(r.REGIAO)===reg?10:0);return ativos.sort((a,c)=>score(c)-score(a))[0]||null;}
function acharProducao(rows,b){const t=normalizarTexto(b.tipoProduto),f=normalizarTexto(b.familiaProduto),p=normalizarTexto(b.processo);const ativos=rows.filter(ativoAgora);const score=r=>(t&&normalizarTexto(r.TIPO_PRODUTO)===t?50:0)+(f&&normalizarTexto(r.FAMILIA_PRODUTO)===f?30:0)+(p&&normalizarTexto(r.PROCESSO)===p?20:0);return ativos.sort((a,c)=>score(c)-score(a))[0]||null;}
app.get('/api/calculadora/parametros', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async(req,res)=>{try{const [l,p]=await Promise.all([lerAba('PARAMETROS_LOGISTICA',2000).catch(()=>[]),lerAba('PARAMETROS_PRODUCAO',2000).catch(()=>[])]);res.json({sucesso:true,logistica:l,producao:p});}catch(e){res.status(500).json({sucesso:false,erro:e.message});}});
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
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.post('/api/calculadora/parametros/logistica', requerPerfil('MASTER'), async(req,res)=>{try{garantirAbaComCabecalhos('PARAMETROS_LOGISTICA',LOG_HEADERS).catch(()=>{});const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_LOGISTICA','LOG','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_LOGISTICA',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:e.message});}});
app.post('/api/calculadora/parametros/producao', requerPerfil('MASTER'), async(req,res)=>{try{garantirAbaComCabecalhos('PARAMETROS_PRODUCAO',PROD_HEADERS).catch(()=>{});const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_PRODUCAO','PROD','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_PRODUCAO',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:e.message});}});

// ===== DASHBOARD =====
app.get('/api/dashboard', async (req, res) => {
  try {
    const [mans, recs] = await Promise.all([lerAba('MANIFESTACOES', 2000).catch(()=>[]), lerAba('Reclamações + devolutiva', 2000).catch(()=>[])]);
    const emAndamento = mans.filter(m => !['FINALIZADA','ENCERRADA','CONCLUÍDA'].some(s => (m.STATUS||'').toUpperCase().includes(s))).length;
    const rncsAbertas = mans.filter(m => m.ID_RNC && m.ID_RNC !== '').length;
    const recComSLA = recs.filter(r => r['Dentro do prazo? '] || r['Dentro do prazo?']);
    const dentroPrazo = recComSLA.filter(r => { const v=(r['Dentro do prazo? ']||r['Dentro do prazo?']||'').toUpperCase().trim(); return v==='SIM'||v==='S'; }).length;
    const slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo/recComSLA.length*100) : null;
    const porEmpresa = {};
    recs.forEach(r => {
      const emp = (r['Empresa']||'').trim();
      if(!emp) return;
      if(!porEmpresa[emp]) porEmpresa[emp]={total:0,finaliz:0,sla:0,foraSLA:0};
      porEmpresa[emp].total++;
      const st=(r['Status']||r['Situação Final']||'').toUpperCase();
      if(st.includes('FINALIZ')||st.includes('CONCLUÍD'))porEmpresa[emp].finaliz++;
      const slaV=(r['Dentro do prazo? ']||r['Dentro do prazo?']||'').toUpperCase().trim();
      if(slaV==='SIM')porEmpresa[emp].sla++; else if(slaV==='NÃO'||slaV==='NAO')porEmpresa[emp].foraSLA++;
    });
    const motivos = {};
    recs.forEach(r=>{const m=(r['Motivo da Reclamação']||'').trim();if(m&&m!=='Não identificado')motivos[m]=(motivos[m]||0)+1;});
    const statusCount = {};
    mans.forEach(m=>{const s=m.STATUS||'EM ANÁLISE';statusCount[s]=(statusCount[s]||0)+1;});
    const semanas = [];
    const agora = new Date();
    for(let i=11;i>=0;i--){const d=new Date(agora);d.setDate(d.getDate()-i*7);semanas.push({label:d.toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}).replace('.',''),count:0});}
    recs.forEach(r=>{
      let dc; const dv=r['Data do Registro'];
      if(typeof dv==='number')dc=new Date((dv-25569)*86400*1000); else dc=new Date(dv);
      if(!dc||isNaN(dc))return;
      const diff=Math.floor((agora-dc)/86400000); const idx=11-Math.floor(diff/7);
      if(idx>=0&&idx<12)semanas[idx].count++;
    });
    res.json({sucesso:true,dados:{kpis:{emAndamento,totalManifestacoes:mans.length,totalReclamacoes:recs.length,rncsAbertas,slaPercent:slaPercent!==null?slaPercent:'Sem dados',foraPrazo:recComSLA.length-dentroPrazo},statusCount,porEmpresa,motivos:Object.entries(motivos).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,c])=>({motivo:m,count:c})),semanas}});
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message, dados:{} }); }
});

// ===== RNC =====
app.get('/api/rnc', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    // F6: tenta PostgreSQL primeiro
    if (rncRepo) {
      try {
        const filtros = {};
        if (req.query.empresaId) filtros.empresaId = req.query.empresaId;
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
    // Fallback Sheets
    const data=await lerAba('BANCO_RNC',5000).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
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
        const emp = emps[0];
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/rnc/:id', requerPerfil('APROVADOR','MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    const eventos=await lerAba('RNC_EVENTOS',5000).catch(()=>[]);
    const anexos=await lerAba('ANEXOS',5000).catch(()=>[]);
    res.json({sucesso:true,rnc,eventos:eventos.filter(x=>x.ID_RNC===req.params.id),anexos:anexos.filter(x=>x.ID_ENTIDADE===req.params.id)});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.post('/api/rnc/:id/decisao', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try{
    const {decisao,observacoes}=req.body||{};
    if(!decisao) return res.status(400).json({sucesso:false,erro:'Decisão é obrigatória.'});
    const rnc=(await lerAba('BANCO_RNC',5000).catch(()=>[])).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    const d=String(decisao).toUpperCase();
    if(d!=='APROVAR'&&(!observacoes||!String(observacoes).trim())) return res.status(400).json({sucesso:false,erro:'Justificativa é obrigatória.'});
    const status=d==='APROVAR'?'APROVADA':(d==='REJEITAR'?'REJEITADA':'DEVOLVIDA'); const agora=new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,{STATUS:status,APROVADOR_DECISAO:req.user.usuario,DATA_DECISAO:agora,OBSERVACOES_APROVACAO:observacoes||''},['ID_RNC','ID']);
    await registrarAuditoria(req.user.usuario,'DECISAO_RNC',req.params.id,'BANCO_RNC',rnc.STATUS,{status});
    res.json({sucesso:true,id:req.params.id,status});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.post('/api/rnc/:id/visualizacao', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try{
    const agora=new Date().toISOString(); const idEvento=await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
    await appendObjeto('RNC_EVENTOS',{ID_EVENTO:idEvento,ID_RNC:req.params.id,TIPO_EVENTO:'VISUALIZOU',USUARIO:req.user.usuario,DATA_EVENTO:agora,DETALHES:'RNC visualizada'});
    res.json({sucesso:true,idEvento});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/rnc/:id/eventos', async(req,res)=>{
  try{const data=await lerAba('RNC_EVENTOS',5000);res.json({sucesso:true,itens:data.filter(x=>x.ID_RNC===req.params.id)});}
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.patch('/api/rnc/:id/execucao', requerPerfil('SETOR RESPONSÁVEL','MASTER','ANALISTA SAC'), async(req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    const b=req.body||{}; const dados={};
    const campos=['CAUSA','ACAO_CONTENCAO','ACAO_CORRETIVA','RESPONSAVEL_ACAO','PRAZO_ACAO','STATUS_ACAO','RESPONSAVEL_EFICACIA','DATA_EFICACIA','RESULTADO_EFICACIA'];
    for(const c of campos){if(b[c]!==undefined)dados[c]=b[c];}
    dados.ULTIMA_ALTERACAO_POR=req.user.usuario; dados.ULTIMA_ALTERACAO_DATA=new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,dados,['ID_RNC','ID']);
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/rnc-metricas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try{
    const data=await lerAba('BANCO_RNC',5000); const now=Date.now();
    const pend=data.filter(x=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(x.STATUS||'').toUpperCase()));
    const aprov=data.filter(x=>String(x.STATUS||'').toUpperCase()==='APROVADA');
    const overdue=pend.filter(x=>x.PRAZO&&!isNaN(Date.parse(x.PRAZO))&&Date.parse(x.PRAZO)<now);
    res.json({sucesso:true,total:data.length,pendentes:pend.length,aprovadas:aprov.length,atrasadas:overdue.length,percentualDentroPrazo:data.length?Math.round((data.length-overdue.length)/data.length*100):0});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// ===== EMPRESAS =====
app.get('/api/empresas', async (req, res) => {
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
    const empresaIdx = headers.indexOf('EMPRESA_NORMALIZADA');
    const empresas = new Set();
    for (let i = 1; i < rows.length; i++) {
      const emp = (empresaIdx >= 0 && rows[i][empresaIdx]) || '';
      if (emp && emp.trim()) {
        empresas.add(emp.trim());
      }
    }
    const res2 = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: 'Reclamações + devolutiva!A1:Z1000',
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
    res.status(500).json({ sucesso: false, erro: e.message, itens: [] });
  }
});

// ===== CLIENTES =====
app.get('/api/clientes/:cnpj', requerPerfil('MASTER','ANALISTA SAC','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    const cnpj=req.params.cnpj.replace(/\D/g,'');
    if(cnpj.length < 8) return res.json({sucesso:true,encontrado:false,cliente:null,historico:[]});
    const historico=await lerAba('BANCO_HISTORICO',2000).catch(()=>[]);
    const casos=historico.filter(h=>{
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
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== RECLAMAÇÕES =====
app.get('/api/reclamacoes', async (req, res) => {
  try {
    const data=await lerAba('Reclamações + devolutiva',2000).catch(()=>[]);
    const normalizado=data.map(r=>({
      ...r,
      'Data do Registro':normalizarData(r['Data do Registro']),
      'Empresa':r['Empresa']||''
    })).filter(r=>r['Empresa'] && r['Empresa'].trim() && !['TR01','TR08'].includes(r['Empresa'].trim()));
    res.json({sucesso:true,total:normalizado.length,itens:normalizado});
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== HISTORICO =====
app.get('/api/historico', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req, res) => {
  try { const data=await lerAba('BANCO_HISTORICO',1000).catch(()=>[]); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== SETORES / CONHECIMENTO / PROCEDIMENTOS / POLÍTICAS / TIPOS / SLA =====
app.get('/api/setores-unicos', async (req, res) => {
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
    res.status(500).json({ sucesso: false, erro: e.message, itens: ['SAC'] });
  }
});

app.get('/api/setores', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    // GET puro — sem criar/escrever abas. Se não existe, retorna vazio e frontend usa fallback.
    const data = await lerAba('CONFIG_SETORES', 500).catch(()=>[]);
    const itens = data.map(s => ({ ...s, _counts: {} }));
    res.json({ sucesso:true, total:itens.length, itens });
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message, itens:[] }); }
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
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message, counts:{} }); }
});
app.get('/api/conhecimento', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('CONHECIMENTO_SETORES',['SETOR','DESCRICAO','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS']).catch(()=>{});
    const data=await lerAba('CONHECIMENTO_SETORES',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
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
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
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
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});
app.post('/api/politicas', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('POLITICAS',['ID_POLITICA','POLITICA','SETOR_RESPONSAVEL','DESCRICAO','RESPONSAVEL','ATIVO','DATA_CRIACAO']).catch(()=>{});
    const id = await gerarProximoID('POLITICAS','POL','ID_POLITICA');
    const obj = { ID_POLITICA: id, ...req.body, DATA_CRIACAO: new Date().toLocaleDateString('pt-BR'), ATIVO: 'SIM' };
    await appendObjeto('POLITICAS', obj);
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});
app.post('/api/procedimentos', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    await garantirAbaComCabecalhos('PROCEDIMENTOS',['ID_PROCEDIMENTO','NOME','SETOR_RESPONSAVEL','DESCRICAO','PASSOS','ATIVO','DATA_CRIACAO']).catch(()=>{});
    const id = await gerarProximoID('PROCEDIMENTOS','PROC','ID_PROCEDIMENTO');
    const obj = { ID_PROCEDIMENTO: id, NOME: req.body.POLITICA || req.body.NOME || '', ...req.body, DATA_CRIACAO: new Date().toLocaleDateString('pt-BR'), ATIVO: 'SIM' };
    await appendObjeto('PROCEDIMENTOS', obj);
    res.json({ sucesso: true, id });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
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
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message, itens: [] }); }
});
app.patch('/api/matriz/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const id = req.params.id;
    garantirAbaComCabecalhos('MATRIZ_DECISAO', ['ID_MATRIZ','TEMA','SETOR_PRINCIPAL','SETORES_APOIO','SLA_HORAS','PRIORIDADE','GERA_RNC','APROVACAO','FOLLOW_UP','REGRAS']).catch(()=>{});
    const reg = await atualizarPorID('MATRIZ_DECISAO', id, req.body, ['ID_MATRIZ','ID']);
    if (!reg) return res.status(404).json({ sucesso: false, erro: 'Regra não encontrada.' });
    res.json({ sucesso: true, linha: reg.linha });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});
// ===== EXTRAÇÃO DE CAMPOS DE SETOR A PARTIR DE DOCUMENTO =====
app.post('/api/extrair-campos-setor', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const { texto } = req.body;
    if (!texto) return res.status(400).json({ sucesso: false, erro: 'Texto obrigatório.' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(400).json({ sucesso: false, erro: 'ANTHROPIC_API_KEY não configurada.' });

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

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    const data = await resp.json();
    const raw = data.content?.[0]?.text || '{}';
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const campos = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    res.json({ sucesso: true, campos });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// ===== PESQUISAS DE SATISFAÇÃO (planilha externa, somente leitura) =====
app.get('/api/pesquisas/resumo', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const pesquisaId = process.env.PESQUISA_SPREADSHEET_ID || '1h0NroiziE1z52mKIFQFYTltKqcG20mScPfIgGuk1gV4';
    const pesquisaAba = process.env.PESQUISA_ABA || 'Respostas ao formulário 1';
    const sheets = await getSheets();
    const result = await sheets.spreadsheets.values.get({
      spreadsheetId: pesquisaId,
      range: pesquisaAba,
      valueRenderOption: 'FORMATTED_VALUE',
    });
    const rows = result.data.values || [];
    if (rows.length < 2) return res.json({ sucesso: true, totalMes: 0, viramReclamacao: 0 });
    const headers = rows[0];
    const dados = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
      return obj;
    });

    // Detecta coluna de data (primeira coluna com "data" ou "timestamp" no nome)
    const colunaData = headers.find(h => /data|timestamp|carimbo|hora/i.test(h)) || headers[0];
    const agora = new Date();
    const mesAtual = agora.getMonth();
    const anoAtual = agora.getFullYear();

    const doMes = dados.filter(r => {
      const raw = r[colunaData];
      if (!raw) return false;
      // Suporta DD/MM/YYYY HH:MM:SS ou ISO
      const partes = raw.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
      let d;
      if (partes) { d = new Date(+partes[3], +partes[2] - 1, +partes[1]); }
      else { d = new Date(raw); }
      return !isNaN(d) && d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    });

    // Conta viram reclamação: qualquer coluna numérica com nota <= 3
    const colunasNota = headers.filter(h => !/data|timestamp|carimbo|hora|nome|email|cpf|cnpj|observ|coment/i.test(h) && h !== colunaData);
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA || 6);
    const viramReclamacao = doMes.filter(r =>
      colunasNota.some(col => {
        const v = Number(String(r[col]).replace(',', '.'));
        return !isNaN(v) && v > 0 && v <= NOTA_CRITICA;
      })
    ).length;

    res.json({ sucesso: true, totalMes: doMes.length, viramReclamacao, mes: agora.toLocaleString('pt-BR', { month: 'long', year: 'numeric' }) });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message, totalMes: 0, viramReclamacao: 0 });
  }
});

app.get('/api/tipos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('TIPOS_RECLAMACAO',200).catch(()=>[]); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
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
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/validacoes', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try { const data=await lerAba('HISTORICO_VALIDACOES',1000).catch(()=>[]); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});


// ===== ROTA: BUSCAR CASO POR FONTE E ID =====
app.get('/api/caso/:fonte/:id', async (req, res) => {
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
      'RECLAMACOES': 'Reclamações + devolutiva',
      'Reclamacoes': 'Reclamações + devolutiva',
      'Reclamações + devolutiva': 'Reclamações + devolutiva',
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
    res.json({ sucesso: true, caso: { ...item, _fonte_real: fonteReal } });
  } catch(e) {
    console.error('/api/caso erro:', e.message);
    res.status(500).json({ sucesso: false, erro: e.message });
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
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.get('/api/auditoria', requerPerfil('MASTER'), async (req, res) => {
  try { const data=await lerAba('LOG_SISTEMA',1000); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
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
];

app.get('/api/planilha/abas', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const { getSheets } = require('./services/sheets');
    const sheets = await getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
    const todas = (meta.data.sheets||[]).map(s=>({ nome: s.properties.title, linhas: s.properties.gridProperties?.rowCount||0, colunas: s.properties.gridProperties?.columnCount||0 }));
    res.json({ sucesso:true, abas: todas });
  } catch(e) { res.status(500).json({ sucesso:false, erro:e.message, abas:[] }); }
});

// Leitura de aba com query param (suporta nomes com acentos/espaços)
app.get('/api/planilha/ler', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const nome = req.query.nome || '';
    if (!nome) return res.status(400).json({sucesso:false, erro:'Parâmetro nome é obrigatório.'});
    const max = Math.min(parseInt(req.query.max||'2000',10), 5000);
    const data = await lerAba(nome, max);
    res.json({ sucesso:true, aba:nome, total:data.length, itens:data });
  } catch(e) { res.status(500).json({ sucesso:false, erro:e.message, itens:[] }); }
});

app.get('/api/planilha/:aba', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const aba = req.params.aba.toUpperCase().replace(/[^A-Z0-9_]/g,'');
    const max = Math.min(parseInt(req.query.max||'2000',10), 5000);
    const data = await lerAba(aba, max);
    res.json({ sucesso:true, aba, total:data.length, itens:data });
  } catch(e) { res.status(500).json({ sucesso:false, erro:e.message, itens:[] }); }
});

app.post('/api/planilha/:aba/importar', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const aba = req.params.aba.toUpperCase().replace(/[^A-Z0-9_]/g,'');
    const { itens, cabecalhos } = req.body;
    if(!Array.isArray(itens)||!itens.length) return res.status(400).json({ sucesso:false, erro:'Nenhum item.' });
    if(cabecalhos && Array.isArray(cabecalhos)) await garantirAbaComCabecalhos(aba, cabecalhos);
    let criados=0;
    for(const item of itens){ await appendObjeto(aba, item); criados++; }
    await registrarAuditoria(req.user.usuario,'IMPORTOU_DADOS_PLANILHA',`${criados} linhas`,aba,null,{aba,total:criados});
    res.json({ sucesso:true, criados, aba });
  } catch(e) { res.status(500).json({ sucesso:false, erro:e.message }); }
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
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});

// ===== USUÁRIOS =====
app.get('/api/usuarios', requerPerfil('MASTER'), async (req,res)=>{
  try{ const itens=await carregarUsuarios(); res.json({sucesso:true,total:itens.length,itens:itens.map(usuarioPublico)}); }
  catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});
app.post('/api/usuarios', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const b=req.body||{};
    if(!b.usuario||!b.nome||!b.perfil) return res.status(400).json({sucesso:false,erro:'Usuário, nome e perfil são obrigatórios.'});
    const id=await gerarProximoID('USUARIOS','USR','ID_USUARIO');
    const hash=b.senha?'sha256:'+crypto.createHash('sha256').update(String(b.senha)).digest('hex'):'';
    const obj={ID_USUARIO:id,USUARIO:b.usuario,EMAIL:b.email||'',NOME:b.nome,PERFIL:perfilCanonico(b.perfil),EMPRESA:b.empresa||'',SETOR:b.setor||'',CODIGO_RCA:b.codigoRCA||'',STATUS:b.status||'ATIVO',SENHA_HASH:hash,DATA_CRIACAO:new Date().toISOString(),ULTIMO_ACESSO:''};
    await appendObjeto('USUARIOS',obj);
    await registrarAuditoria(req.user.usuario,'CRIOU_USUARIO',id,'USUARIOS',null,{perfil:obj.PERFIL});
    res.json({sucesso:true,usuario:usuarioPublico(obj)});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.patch('/api/usuarios/:id', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const b=req.body||{}; const dados={...b};
    if(dados.perfil){dados.PERFIL=perfilCanonico(dados.perfil);delete dados.perfil;}
    if(dados.senha){dados.SENHA_HASH='sha256:'+crypto.createHash('sha256').update(String(dados.senha)).digest('hex');delete dados.senha;}
    await atualizarPorID('USUARIOS',req.params.id,dados,['ID_USUARIO','USUARIO','EMAIL']);
    await registrarAuditoria(req.user.usuario,'ATUALIZOU_USUARIO',req.params.id,'USUARIOS',null,{campos:Object.keys(b)});
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// ===== APROVADORES =====
app.get('/api/aprovadores', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const [a,c,ac]=await Promise.all([lerAba('APROVADORES',500).catch(()=>[]),lerAba('COMPETENCIAS',500).catch(()=>[]),lerAba('APROVADOR_COMPETENCIAS',2000).catch(()=>[])]);
    res.json({sucesso:true,aprovadores:a,competencias:c,relacionamentos:ac});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});
app.get('/api/aprovadores/:usuario/pendencias', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try {
    const usuario=req.params.usuario;
    const [aprovadores,rel,comp,rncs,mans]=await Promise.all([lerAba('APROVADORES',500).catch(()=>[]),lerAba('APROVADOR_COMPETENCIAS',5000).catch(()=>[]),lerAba('COMPETENCIAS',500).catch(()=>[]),lerAba('BANCO_RNC',5000).catch(()=>[]),lerAba('MANIFESTACOES',5000).catch(()=>[])]);
    const ap=aprovadores.find(x=>normalizarTexto(x.ID_APROVADOR||x.NOME||x.EMAIL)===normalizarTexto(usuario));
    const apId=ap?.ID_APROVADOR||usuario;
    const relAtivos=rel.filter(x=>String(x.ID_APROVADOR||'')===String(apId)&&normalizarTexto(x.STATUS||'ATIVO')!=='inativo');
    const compIds=relAtivos.map(x=>x.ID_COMPETENCIA);
    const compNames=comp.filter(x=>compIds.includes(x.ID_COMPETENCIA)).map(x=>String(x.NOME||'').trim()).filter(Boolean);
    const empresas=relAtivos.map(x=>String(x.EMPRESA||'').trim()).filter(Boolean);
    const n=v=>normalizarTexto(v);
    const rnc=rncs.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(compNames.some(c=>n(c)===n(r.COMPETENCIA||r.SETOR))||relAtivos.some(x=>n(x.NOME_COMPETENCIA)===n(r.COMPETENCIA||r.SETOR)))&&(!empresas.length||empresas.some(e=>n(e)===n(r.EMPRESA))));
    const sac=mans.filter(m=>!['ENCERRADA','CONCLUÍDA','CONCLUIDA','CANCELADA','REJEITADA'].includes(String(m.STATUS||'').toUpperCase())&&(m.STATUS==='AGUARDANDO_APROVAÇÃO'||m.STATUS==='AGUARDANDO_DECISÃO'||m.APROVACAO_NECESSARIA==='SIM'));
    const sugestoes=(await lerAba('SUGESTOES_APROVADOR',5000).catch(()=>[])).filter(x=>n(x.ID_APROVADOR)===n(apId));
    res.json({sucesso:true,usuario,aprovador:ap,competencias:compNames,empresas,rnc,sac,sugestoes,totais:{rnc:rnc.length,sac:sac.length,total:rnc.length+sac.length}});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/setor/minhas-pendencias', requerPerfil('SETOR RESPONSÁVEL','MASTER'), async (req,res)=>{
  try{
    const rows=await lerAba('BANCO_RNC',5000); const setor=normalizarTexto(req.user.setor);
    const itens=rows.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(!setor||normalizarTexto(r.SETOR||r.SETOR_ACAO)===setor));
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
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
app.get('/api/anexos', async (req,res) => {
  try {
    const data=await lerAba('ANEXOS',5000);
    const itens=req.query.idEntidade?data.filter(x=>String(x.ID_ENTIDADE||'')===String(req.query.idEntidade)):data;
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});
app.post('/api/anexos', async (req,res) => {
  try {
    const {arquivo,tipoEntidade,idEntidade,usuario,categoria}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const item=await salvarAnexo({...arquivo,categoria},{tipoEntidade,idEntidade,usuario});
    res.json({sucesso:true,anexo:item});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== DOCUMENTOS =====
app.post('/api/documentos/extrair', async (req,res) => {
  try {
    const {arquivo,tipoDocumento='FICHA_RECLAMACAO'}=req.body||{};
    if(!arquivo?.dataBase64) return res.status(400).json({sucesso:false,erro:'Arquivo não informado.'});
    const dados=await documentService.extrairDadosDocumento(arquivo,tipoDocumento);
    res.json({sucesso:true,tipoDocumento,dados,validacaoObrigatoria:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== ANÁLISE IA POR MANIFESTAÇÃO =====
app.get('/api/manifestacoes/:id/analise', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), async (req,res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 2000).catch(()=>[]);
    const m = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!m) return res.status(404).json({ sucesso:false, erro:'Manifestação não encontrada.' });
    const analise = await executarAnalise({
      ...m,
      empresaReclamante: m.EMPRESA_RECLAMANTE,
      empresaReclamada: m.EMPRESA_RECLAMADA,
      descricao: m.DESCRICAO || m.DESCRICAO_MANIFESTACAO,
    });
    res.json({ sucesso:true, analise });
  } catch(e){ res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ===== SUGESTÕES APROVADOR =====
app.get('/api/manifestacoes/:id/sugestoes', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res) => {
  try { const data=await lerAba('SUGESTOES_APROVADOR',5000); res.json({sucesso:true,itens:data.filter(x=>String(x.ID_MANIFESTACAO||'')===String(req.params.id))}); }
  catch(e){ res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});
app.post('/api/manifestacoes/:id/sugestoes', requerPerfil('MASTER','APROVADOR'), async (req,res) => {
  try {
    const {usuario,tipoSugestao,sugestao,justificativa}=req.body||{};
    if(!usuario||!tipoSugestao||!sugestao) return res.status(400).json({sucesso:false,erro:'Campos obrigatórios faltando.'});
    const id=await gerarProximoID('SUGESTOES_APROVADOR','SUG','ID_SUGESTAO');
    await appendObjeto('SUGESTOES_APROVADOR',{ID_SUGESTAO:id,ID_MANIFESTACAO:req.params.id,ID_APROVADOR:usuario,TIPO_SUGESTAO:tipoSugestao,SUGESTAO:sugestao,JUSTIFICATIVA:justificativa||'',DATA_SUGESTAO:new Date().toISOString(),STATUS:'PENDENTE'});
    res.json({sucesso:true,id,status:'PENDENTE'});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== CAUSAS HIERÁRQUICAS =====
app.get('/api/causas', async (req,res)=>{
  try {
    const causas = await lerAba('CAUSAS', 2000).catch(()=>[]);
    res.json({sucesso:true, total:causas.length, itens:causas});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
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
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
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
  } catch(e){ res.status(500).json({ sucesso: false, erro: e.message }); }
});

app.patch('/api/causas/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const dados = req.body||{};
    const r = await atualizarPorID('CAUSAS', req.params.id, dados, ['ID_CAUSA']);
    if (!r) return res.status(404).json({sucesso:false,erro:'Causa não encontrada.'});
    res.json({sucesso:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== ASSERTIVIDADE DA IA =====
app.post('/api/assertividade-ia', async (req,res)=>{
  try {
    const {idManifestacao, decisaoAceita, causaConfirmada, subcausaConfirmada, setorConfirmado, tratativaAceita, devolutivaAceita, observacao} = req.body||{};
    if (!idManifestacao) return res.status(400).json({sucesso:false,erro:'ID da manifestação é obrigatório.'});
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
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== PAINEL DA MÁQUINA =====
app.get('/api/painel-maquina', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    const {empresa, setor, de, ate} = req.query;
    const [mans, asserts, causas] = await Promise.all([
      lerAba('MANIFESTACOES', 5000),
      lerAba('ASSERTIVIDADE_IA', 5000).catch(()=>[]),
      lerAba('CAUSAS', 2000).catch(()=>[]),
    ]);

    let filtradas = mans;
    if (empresa) filtradas = filtradas.filter(m=>String(m.EMPRESA_RECLAMADA||'').toLowerCase().includes(empresa.toLowerCase()));
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

    res.json({
      sucesso:true,
      metricas:{
        totalManifestacoes:total, comAnalise, taxaResolucao, assertPercent, pontuacaoMedia,
        totalAvaliados:comAssert.length, totalAceitos:aceitasTotal,
        encerradas:encerradas.length, emAberto:total-encerradas.length,
      },
      sla:slaStatus, topSetores, topCausas,
      totalCausasCadastradas:causas.filter(c=>c.ATIVO!=='NAO').length,
    });
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== SUGESTÕES DE MELHORIA =====
app.get('/api/sugestoes-melhoria', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    const itens = await lerAba('SUGESTOES_MELHORIA', 2000).catch(()=>[]);
    const status = req.query.status;
    const filtrados = status ? itens.filter(s=>(s.STATUS||'').toUpperCase()===status.toUpperCase()) : itens;
    res.json({sucesso:true, total:filtrados.length, itens:filtrados});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});

app.post('/api/sugestoes-melhoria', async (req,res)=>{
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
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

app.patch('/api/sugestoes-melhoria/:id', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const dados = {...req.body, DATA_AVALIACAO:new Date().toISOString(), AVALIADO_POR:req.user.usuario};
    const r = await atualizarPorID('SUGESTOES_MELHORIA', req.params.id, dados, ['ID_SUGESTAO_MELHORIA']);
    if (!r) return res.status(404).json({sucesso:false,erro:'Sugestão não encontrada.'});
    res.json({sucesso:true});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== CONTEXTO DO CLIENTE =====
app.get('/api/cliente-contexto', async (req,res)=>{
  try {
    const {cliente, empresa} = req.query;
    if (!cliente) return res.status(400).json({sucesso:false,erro:'Cliente é obrigatório.'});
    const norm = v=>String(v||'').toLowerCase().trim();
    const [mans, hist] = await Promise.all([
      lerAba('MANIFESTACOES', 5000),
      lerAba('BANCO_HISTORICO', 5000).catch(()=>[]),
    ]);
    const clienteNorm = norm(cliente);
    const empresaNorm = empresa?norm(empresa):'';
    const casosMan = mans.filter(m=>norm(m.CONTATO||m.EMPRESA_RECLAMANTE||'').includes(clienteNorm)&&(!empresaNorm||norm(m.EMPRESA_RECLAMADA||'').includes(empresaNorm)));
    const casosHist = hist.filter(h=>norm(h.ORIG_CONTATO||h.EMPRESA_RECLAMANTE||'').includes(clienteNorm)&&(!empresaNorm||norm(h.ORIG_EMPRESA||h.EMPRESA_RECLAMADA||'').includes(empresaNorm)));
    const todosCasos = [...casosMan.map(m=>({id:m.ID_MANIFESTACAO,fonte:'MANIFESTACOES',data:m.DATA_CRIACAO||m.DATA_ABERTURA,status:m.STATUS,tipo:m.TIPO||'',produto:m.PRODUTO||'',causa:m.CAUSA_RAIZ||m.CAUSA_CONFIRMADA||'',descricao:(m.DESCRICAO_RECLAMACAO||m.DESCRICAO||'').slice(0,200)})),...casosHist.map(h=>({id:h.ID_HISTORICO||h.ID_MANIFESTACAO,fonte:'BANCO_HISTORICO',data:h.ORIG_DATA_ABERTURA||h.DATA_ABERTURA,status:h.STATUS_FINAL||h.STATUS||'',tipo:h.COMP_TIPO_PROBLEMA_VALIDADO||h.TIPO||'',produto:h.ORIG_PRODUTO||h.PRODUTO||'',causa:h.COMP_CAUSA_PROVAVEL||h.CAUSA_RAIZ||'',descricao:(h.ORIG_DESCRICAO_RECLAMACAO||h.DESCRICAO||'').slice(0,200)}))];
    todosCasos.sort((a,b)=>new Date(b.data||0)-new Date(a.data||0));
    const produtos = [...new Set(todosCasos.map(c=>c.produto).filter(Boolean))];
    const causasFreq = {};
    todosCasos.forEach(c=>{if(c.causa)causasFreq[c.causa]=(causasFreq[c.causa]||0)+1;});
    res.json({sucesso:true,cliente,empresa:empresa||'',totalCasos:todosCasos.length,casos:todosCasos.slice(0,20),produtos,causasRecorrentes:Object.entries(causasFreq).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([c,n])=>({causa:c,ocorrencias:n}))});
  } catch(e){ res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== RESET SENHA VIA GET (sem preflight CORS) =====
app.get('/api/_reset', async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  try {
    const { usuario, senha, key } = req.query;
    if (!key || key !== (process.env.BOOTSTRAP_KEY || '')) {
      return res.status(403).json({ sucesso: false, erro: 'Chave inválida.' });
    }
    if (!usuario || !senha || senha.length < 6) {
      return res.status(400).json({ sucesso: false, erro: 'usuario e senha (mín. 6 chars) obrigatórios.' });
    }
    const hash = 'sha256:' + crypto.createHash('sha256').update(String(senha)).digest('hex');
    const todos = await lerAba('USUARIOS', 100).catch(() => []);
    const existente = todos.find(u => normalizarTexto(u.USUARIO || '') === normalizarTexto(usuario));
    if (existente) {
      await atualizarPorID('USUARIOS', existente.ID_USUARIO || existente.USUARIO, { SENHA_HASH: hash, STATUS: 'ATIVO' }, ['ID_USUARIO', 'USUARIO']);
      return res.json({ sucesso: true, mensagem: `Senha de "${usuario}" redefinida. Acesse o sistema e faça login.` });
    }
    // Cria usuário novo
    const obj = { ID_USUARIO: 'USR-0001', USUARIO: usuario, EMAIL: '', NOME: usuario, PERFIL: 'MASTER', EMPRESA: 'Grupo Chiacchio', SETOR: 'SAC', CODIGO_RCA: '', STATUS: 'ATIVO', SENHA_HASH: hash, DATA_CRIACAO: new Date().toISOString(), ULTIMO_ACESSO: '' };
    await appendObjeto('USUARIOS', obj);
    return res.json({ sucesso: true, mensagem: `Usuário "${usuario}" criado. Acesse o sistema e faça login.` });
  } catch (e) {
    return res.status(500).json({ sucesso: false, erro: e.message });
  }
});

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
    const hash = 'sha256:' + crypto.createHash('sha256').update(String(senha)).digest('hex');
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
    res.json({ sucesso: true, mensagem: `Usuário MASTER "${usuario}" criado com sucesso. Agora você pode logar normalmente.`, id: 'USR-001' });
  } catch (e) {
    console.error('Bootstrap erro:', e);
    res.status(500).json({ sucesso: false, erro: e.message });
  }
}

// ===== IMPORTADOR TEMPORÁRIO (F3) — remover após uso =====
app.get('/api/_importar', async (req, res) => {
  const secret = process.env.SESSION_SECRET || '';
  if (!secret || req.query.secret !== secret) {
    return res.status(403).json({ erro: 'Acesso negado.' });
  }
  const etapa = req.query.etapa || 'status';

  if (etapa === 'status') {
    return res.json({ ok: true, mensagem: 'Importador disponível.', etapas: ['debug','empresas','clientes','manifestacoes','rnc'] });
  }

  if (etapa === 'debug') {
    try {
      const { google: goog } = require('googleapis');
      const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      const auth = new goog.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
      const client = await auth.getClient();
      const sheets = goog.sheets({ version: 'v4', auth: client });
      const meta = await sheets.spreadsheets.get({ spreadsheetId: process.env.SPREADSHEET_ID });
      const abas = meta.data.sheets.map(s => s.properties.title);
      // Tenta ler primeiras 3 linhas de MANIFESTACOES
      let amostra = null, erroAmostra = null;
      try {
        const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'MANIFESTACOES!A1:E3' });
        amostra = r.data.values;
      } catch(e2) { erroAmostra = e2.message; }
      // Tenta ler USUARIOS
      let usuarios = null;
      try {
        const ru = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: 'USUARIOS!A1:C5' });
        usuarios = ru.data.values;
      } catch(e3) { usuarios = `erro: ${e3.message}`; }
      return res.json({ ok: true, spreadsheetId: process.env.SPREADSHEET_ID, titulo: meta.data.properties.title, totalAbas: abas.length, amostra, erroAmostra, usuarios });
    } catch(e) {
      return res.status(500).json({ ok: false, erro: e.message });
    }
  }

  try {
    const { google: goog } = require('googleapis');
    const prismaDb = require('../database/connection');

    async function getSheetsClient() {
      const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
      const auth = new goog.auth.GoogleAuth({ credentials: creds, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
      const client = await auth.getClient();
      return goog.sheets({ version: 'v4', auth: client });
    }
    async function lerAba(sheets, nome, max = 5000) {
      const r = await sheets.spreadsheets.values.get({ spreadsheetId: process.env.SPREADSHEET_ID, range: `${nome}!A1:AZ${max}` });
      const rows = r.data.values || [];
      if (rows.length < 2) return [];
      const headers = rows[0];
      return rows.slice(1).map(row => { const o = {}; headers.forEach((h, i) => { if (h) o[String(h).trim()] = row[i] || ''; }); return o; });
    }

    const sheets = await getSheetsClient();
    const log = [];

    // Empresas: extraídas de MANIFESTACOES.EMPRESA_NORMALIZADA
    if (etapa === 'empresas') {
      const rows = await lerAba(sheets, 'MANIFESTACOES').catch(() => []);
      const nomes = [...new Set(rows.map(r => (r['EMPRESA_NORMALIZADA'] || r['EMPRESA_RECLAMADA'] || '').trim()).filter(Boolean))];
      let ok = 0;
      for (const nome of nomes) {
        const codigo = nome.toUpperCase().replace(/\s+/g, '_').substring(0, 50);
        await prismaDb.empresa.upsert({ where: { codigo }, update: { nome }, create: { codigo, nome } }).catch(() => {});
        ok++;
      }
      log.push(`Empresas: ${ok} processadas`);
    }

    // Clientes: extraídos de MANIFESTACOES.EMPRESA_RECLAMANTE
    if (etapa === 'clientes') {
      const rows = await lerAba(sheets, 'MANIFESTACOES').catch(() => []);
      const empresas = await prismaDb.empresa.findMany();
      const empDefault = empresas[0];
      if (!empDefault) { log.push('Clientes: nenhuma empresa encontrada, rode etapa=empresas primeiro'); }
      else {
        const nomes = [...new Set(rows.map(r => (r['EMPRESA_RECLAMANTE'] || r['CONTATO'] || '').trim()).filter(Boolean))];
        let ok = 0, erros = 0;
        for (const nome of nomes) {
          const nomeTrunc = nome.substring(0, 200);
          const exist = await prismaDb.cliente.findFirst({ where: { nome: nomeTrunc, empresaId: empDefault.id } });
          if (!exist) await prismaDb.cliente.create({ data: { nome: nomeTrunc, empresaId: empDefault.id } }).catch(() => { erros++; });
          ok++;
        }
        log.push(`Clientes: ${ok} processados, ${erros} erros`);
      }
    }

    // Manifestações: aba MANIFESTACOES
    if (etapa === 'manifestacoes') {
      const rows = await lerAba(sheets, 'MANIFESTACOES').catch(() => []);
      const empresas = await prismaDb.empresa.findMany();
      let ok = 0, ignorados = 0, erros = 0;
      for (const r of rows) {
        const idOriginal = (r['ID_MANIFESTACAO'] || '').trim();
        if (!idOriginal) { erros++; continue; }
        const exist = await prismaDb.manifestacao.findFirst({ where: { idOriginal } });
        if (exist) { ignorados++; continue; }
        const nomeEmp = (r['EMPRESA_NORMALIZADA'] || r['EMPRESA_RECLAMADA'] || '').trim().toUpperCase();
        const emp = empresas.find(e => e.nome.toUpperCase().includes(nomeEmp) || e.codigo === nomeEmp.replace(/\s+/g,'_')) || empresas[0];
        const statusRaw = (r['STATUS'] || '').toLowerCase();
        const status = statusRaw.includes('conclu') || statusRaw.includes('finaliz') ? 'CONCLUIDA' : statusRaw.includes('análise') || statusRaw.includes('andamento') ? 'EM_ANDAMENTO' : 'ABERTA';
        const criadaEm = r['DATA_ABERTURA'] || r['DATA_CRIACAO'] ? new Date(r['DATA_ABERTURA'] || r['DATA_CRIACAO']) : new Date();
        await prismaDb.manifestacao.create({ data: {
          protocolo: idOriginal, idOriginal,
          empresaId: emp ? emp.id : empresas[0].id,
          empresaNome: r['EMPRESA_NORMALIZADA'] || r['EMPRESA_RECLAMADA'] || (emp ? emp.nome : ''),
          contato: (r['EMPRESA_RECLAMANTE'] || r['CONTATO'] || '').substring(0, 200),
          descricao: r['DESCRICAO_RECLAMACAO'] || '',
          tipo: 'RECLAMACAO',
          produtoNome: r['PRODUTO'] || null,
          prioridade: r['PRIORIDADE'] || 'Media',
          status,
          criadaEm: isNaN(criadaEm) ? new Date() : criadaEm,
        }}).catch(() => { erros++; });
        ok++;
      }
      log.push(`Manifestações: ${ok} novas, ${ignorados} já existiam, ${erros} erros`);
    }

    // RNC: aba BANCO_RNC
    if (etapa === 'rnc') {
      const rows = await lerAba(sheets, 'BANCO_RNC').catch(() => []);
      const empresas = await prismaDb.empresa.findMany();
      let ok = 0, ignorados = 0, erros = 0;
      for (const r of rows) {
        const idOriginal = (r['ID_RNC'] || '').trim();
        if (!idOriginal) { erros++; continue; }
        const exist = await prismaDb.rnc.findFirst({ where: { idOriginal } });
        if (exist) { ignorados++; continue; }
        const nomeEmp = (r['EMPRESA_RECLAMADA'] || '').trim().toUpperCase();
        const emp = empresas.find(e => e.nome.toUpperCase().includes(nomeEmp) || e.codigo === nomeEmp.replace(/\s+/g,'_')) || empresas[0];
        const dataAbertura = r['DATA_ABERTURA'] ? new Date(r['DATA_ABERTURA']) : new Date();
        await prismaDb.rnc.create({ data: {
          idOriginal,
          protocolo: idOriginal,
          empresaId: emp ? emp.id : empresas[0].id,
          origemTipo: r['TIPO'] || 'COMERCIAL_RECLAMACAO',
          descricao: r['DESCRICAO'] || r['OCORRENCIA'] || r['CAUSA'] || '',
          setor: r['SETOR'] || null,
          responsavel: r['RESPONSAVEL'] || null,
          dataAbertura: isNaN(dataAbertura) ? new Date() : dataAbertura,
          status: r['STATUS'] || 'ABERTA',
        }}).catch(() => { erros++; });
        ok++;
      }
      log.push(`RNC: ${ok} novas, ${ignorados} já existiam, ${erros} erros`);
    }

    res.json({ ok: true, log });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

// ===== MÓDULO COMPLETO DE APROVAÇÃO =====

const APROVADORES_HEADERS = ['ID_APROVADOR','NOME','EMAIL','USUARIO','CARGO','EMPRESA','SETOR','STATUS','DATA_CRIACAO','OBSERVACOES'];
const COMPETENCIAS_HEADERS = ['ID_COMPETENCIA','NOME','DESCRICAO','TIPO','STATUS','DATA_CRIACAO'];
const APROV_COMP_HEADERS = ['ID','ID_APROVADOR','NOME_APROVADOR','ID_COMPETENCIA','NOME_COMPETENCIA','EMPRESA','STATUS','DATA_ATRIBUICAO'];
const REGRAS_APROV_HEADERS = ['ID_REGRA','NOME','TIPO_ENTIDADE','DESCRICAO_CONDICAO','COMPETENCIA_NECESSARIA','PRIORIDADE','STATUS','DATA_CRIACAO','USUARIO_CRIACAO'];
const FILA_APROV_HEADERS = ['ID_FILA','ID_ENTIDADE','TIPO_ENTIDADE','DESCRICAO','EMPRESA','SETOR','COMPETENCIA','STATUS','ID_APROVADOR','NOME_APROVADOR','DATA_ENVIO','DATA_DECISAO','OBSERVACOES','CRIADO_POR','ID_REGRA'];
const HIST_APROV_HEADERS = ['ID_HISTORICO','ID_FILA','ID_ENTIDADE','TIPO_ENTIDADE','DECISAO','OBSERVACOES','APROVADOR','DATA_DECISAO','DETALHES'];

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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Listar competências
app.get('/api/competencias-lista', requerPerfil('MASTER','APROVADOR','ANALISTA SAC'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('COMPETENCIAS', COMPETENCIAS_HEADERS).catch(()=>{});
    const comp = await lerAba('COMPETENCIAS',500).catch(()=>[]);
    res.json({sucesso:true,competencias:comp.filter(c=>c.STATUS!=='INATIVO')});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Remover atribuição de competência (MASTER)
app.delete('/api/aprovador-competencias/:id', requerPerfil('MASTER'), async (req,res)=>{
  try {
    const r = await atualizarPorID('APROVADOR_COMPETENCIAS',req.params.id,{STATUS:'INATIVO'},['ID']);
    if(!r) return res.status(404).json({sucesso:false,erro:'Relacionamento não encontrado.'});
    res.json({sucesso:true});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Listar regras de aprovação
app.get('/api/regras-aprovacao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('REGRAS_APROVACAO', REGRAS_APROV_HEADERS).catch(()=>{});
    const regras = await lerAba('REGRAS_APROVACAO',500).catch(()=>[]);
    res.json({sucesso:true,regras});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Listar fila de aprovação (filtrada por perfil)
app.get('/api/fila-aprovacao', requerPerfil('MASTER','ANALISTA SAC','APROVADOR'), async (req,res)=>{
  try {
    garantirAbaComCabecalhos('FILA_APROVACAO', FILA_APROV_HEADERS).catch(()=>{});
    const u = req.user;
    const fila = await lerAba('FILA_APROVACAO',2000).catch(()=>[]);
    let itens = fila;
    const n = v => normalizarTexto(v);
    if(perfilCanonico(u.perfil) === 'ANALISTA SAC') {
      itens = fila.filter(x => n(x.CRIADO_POR||'') === n(u.usuario));
    } else if(perfilCanonico(u.perfil) === 'APROVADOR') {
      itens = fila.filter(x => n(x.ID_APROVADOR||'') === n(u.usuario) || n(x.NOME_APROVADOR||'') === n(u.nome||u.usuario) || n(x.ID_APROVADOR||'') === n(u.id||''));
    }
    const pendentes = itens.filter(x=>x.STATUS==='PENDENTE').length;
    res.json({sucesso:true,total:itens.length,pendentes,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Enviar item para aprovação (ANALISTA SAC, MASTER)
app.post('/api/fila-aprovacao', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
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
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Decidir sobre item na fila (APROVADOR, MASTER)
app.post('/api/fila-aprovacao/:id/decidir', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
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
    // APROVADOR: bloquear autoaprovação
    if(perfilCanonico(req.user.perfil) === 'APROVADOR') {
      const n = v => normalizarTexto(v);
      if(n(item.CRIADO_POR||'') === n(req.user.usuario)) {
        return res.status(403).json({sucesso:false,erro:'Autoaprovação não permitida. Você não pode aprovar um item que você mesmo enviou para aprovação.'});
      }
    }
    const now = new Date().toISOString();
    await atualizarPorID('FILA_APROVACAO',req.params.id,{STATUS:decisao,NOME_APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO:now,OBSERVACOES:observacoes||''},['ID_FILA']);
    const histId = await gerarProximoID('HISTORICO_APROVACAO','HAP','ID_HISTORICO');
    await appendObjeto('HISTORICO_APROVACAO',{ID_HISTORICO:histId,ID_FILA:req.params.id,ID_ENTIDADE:item.ID_ENTIDADE,TIPO_ENTIDADE:item.TIPO_ENTIDADE,DECISAO:decisao,OBSERVACOES:observacoes||'',APROVADOR:req.user.nome||req.user.usuario,DATA_DECISAO:now,DETALHES:JSON.stringify({empresa:item.EMPRESA,setor:item.SETOR,competencia:item.COMPETENCIA})}).catch(()=>{});
    const novoStatus = decisao==='APROVADO'?'APROVADA':decisao==='REJEITADO'?'REJEITADA':decisao==='DEVOLVIDO'?'EM_ANÁLISE':'AGUARDANDO_APROVAÇÃO';
    if(item.TIPO_ENTIDADE==='SAC') {
      await atualizarPorID('MANIFESTACOES',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now,OBSERVACOES_APROVADOR:observacoes||''},['ID_MANIFESTACAO']).catch(()=>{});
    } else if(item.TIPO_ENTIDADE==='RNC') {
      await atualizarPorID('BANCO_RNC',item.ID_ENTIDADE,{STATUS:novoStatus,APROVADO_POR:req.user.nome||req.user.usuario,DATA_APROVACAO:now},['ID_RNC']).catch(()=>{});
    }
    await registrarAuditoria(req.user.usuario,`APROVACAO_${decisao}`,item.ID_ENTIDADE,'FILA_APROVACAO',item.STATUS,JSON.stringify({decisao,observacoes}));
    res.json({sucesso:true,decisao,entidade:item.ID_ENTIDADE,novoStatus});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// Histórico de aprovações
app.get('/api/historico-aprovacao', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const hist = await lerAba('HISTORICO_APROVACAO',2000).catch(()=>[]);
    let itens = hist;
    if(perfilCanonico(req.user.perfil) === 'APROVADOR') {
      itens = hist.filter(x => normalizarTexto(x.APROVADOR||'') === normalizarTexto(req.user.nome||req.user.usuario));
    }
    res.json({sucesso:true,total:itens.length,itens});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
setInterval(() => { const cutoff = Date.now() - 2 * 60 * 1000; _publicRateMap.forEach((v, k) => { if (v.start < cutoff) _publicRateMap.delete(k); }); }, 5 * 60 * 1000);

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
      STATUS: 'NOVA',
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
// Listar fichas com filtros e paginação
app.get('/api/biblioteca/fichas', requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR DE SETOR','USUÁRIO DE SETOR'), async (req, res) => {
  try {
    const { ano, mes, empresa, setor, tipo, status, q, page = '1', limit = '50' } = req.query;
    const fichas = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    let filtered = fichas;
    if (ano) filtered = filtered.filter(f => (f.ANO || '') === String(ano));
    if (mes) filtered = filtered.filter(f => (f.MES || '') === String(mes).padStart(2,'0'));
    if (empresa) filtered = filtered.filter(f => normalizarTexto(f.EMPRESA||'').includes(normalizarTexto(empresa)));
    if (setor) filtered = filtered.filter(f => normalizarTexto(f.SETOR_RECEBIMENTO||'').includes(normalizarTexto(setor)));
    if (tipo) filtered = filtered.filter(f => normalizarTexto(f.TIPO_MANIFESTACAO||'').includes(normalizarTexto(tipo)));
    if (status) filtered = filtered.filter(f => normalizarTexto(f.STATUS||'').includes(normalizarTexto(status)));
    if (q) {
      const nq = normalizarTexto(q);
      filtered = filtered.filter(f =>
        normalizarTexto(f.PROTOCOLO||'').includes(nq) ||
        normalizarTexto(f.NOME_CLIENTE||'').includes(nq) ||
        normalizarTexto(f.EMPRESA||'').includes(nq) ||
        normalizarTexto(f.COLABORADOR_RECEBIMENTO||'').includes(nq) ||
        normalizarTexto(f.MOTIVO||'').includes(nq)
      );
    }
    // Sort desc por data
    filtered.sort((a, b) => (b.DATA_REGISTRO || b.CREATED_AT || '').localeCompare(a.DATA_REGISTRO || a.CREATED_AT || ''));
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit) || 50));
    const total = filtered.length;
    const items = filtered.slice((pageNum - 1) * limitNum, pageNum * limitNum);
    // Remove PDF Drive IDs from list response (available on detail)
    const safe = items.map(({ PDF_DRIVE_ID, ...rest }) => rest);
    res.json({ sucesso: true, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), fichas: safe });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// Stats da biblioteca (respeitam filtros de ano/mes/empresa)
app.get('/api/biblioteca/stats', requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR DE SETOR','USUÁRIO DE SETOR'), async (req, res) => {
  try {
    const { ano, mes, empresa } = req.query;
    const fichas = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    let base = fichas;
    if (empresa) base = base.filter(f => normalizarTexto(f.EMPRESA||'').includes(normalizarTexto(empresa)));
    const agora = new Date();
    const anoAtual = agora.getFullYear().toString();
    const mesAtual = String(agora.getMonth() + 1).padStart(2,'0');
    const doAno = base.filter(f => (f.ANO||'') === anoAtual);
    const doMes = doAno.filter(f => (f.MES||'') === mesAtual);
    // Por empresa
    const porEmpresa = {};
    base.forEach(f => { const e = f.EMPRESA||'Não informada'; porEmpresa[e] = (porEmpresa[e]||0)+1; });
    // Por tipo
    const porTipo = {};
    base.forEach(f => { const t = f.TIPO_MANIFESTACAO||'Reclamação'; porTipo[t] = (porTipo[t]||0)+1; });
    // Por ano/mes para navegação hierárquica
    const porAnoMes = {};
    base.forEach(f => {
      const a = f.ANO || 'S/A'; const m = f.MES || '00';
      if (!porAnoMes[a]) porAnoMes[a] = {};
      porAnoMes[a][m] = (porAnoMes[a][m]||0)+1;
    });
    const comEvidencias = base.filter(f => parseInt(f.TOTAL_EVIDENCIAS||0) > 0).length;
    let scope = base;
    if (ano) scope = scope.filter(f => (f.ANO||'') === String(ano));
    if (mes) scope = scope.filter(f => (f.MES||'') === String(mes).padStart(2,'0'));
    res.json({ sucesso: true, totalFichas: scope.length, fichasDoMes: doMes.length, fichasDoAno: doAno.length, porEmpresa, porTipo, porAnoMes, comEvidencias });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// Detalhe de uma ficha (inclui PDF Drive URL)
app.get('/api/biblioteca/fichas/:id', requerPerfil('MASTER','ADMINISTRADOR','ANALISTA SAC','SAC','APROVADOR','SETOR RESPONSÁVEL','GESTOR DE SETOR','USUÁRIO DE SETOR'), async (req, res) => {
  try {
    const fichas = await lerAba('FICHAS_BIBLIOTECA', 5000).catch(() => []);
    const ficha = fichas.find(f => f.ID_FICHA === req.params.id || f.ID_MANIFESTACAO === req.params.id || f.PROTOCOLO === req.params.id);
    if (!ficha) return res.status(404).json({ sucesso: false, erro: 'Ficha não encontrada.' });
    // Buscar evidências
    const evs = await lerAba('EVIDENCIAS', 2000).catch(() => []);
    const evidencias = evs.filter(e => e.ID_MANIFESTACAO === ficha.ID_MANIFESTACAO);
    registrarAuditoria(req.user.usuario, 'VISUALIZOU_FICHA_BIBLIOTECA', ficha.ID_MANIFESTACAO, 'FICHAS_BIBLIOTECA', null, {}).catch(() => {});
    res.json({ sucesso: true, ficha, evidencias });
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
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
  } catch(e) { res.status(500).json({ sucesso: false, erro: e.message }); }
});

// ===== CATCH ALL =====
app.use((req, res) => {
  res.status(404).json({ sucesso:false, erro:`Rota não encontrada: ${req.method} ${req.path}` });
});
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ sucesso:false, erro:'Erro interno do servidor.' });
});

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`SAC Chiacchio API v5.6.0 rodando na porta ${PORT}`));
}

module.exports = app;
