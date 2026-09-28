const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { google } = require('googleapis');
const cerebroService = require('./services/cerebroServices');
const documentService = require('./services/documentService');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));

// ===== AUTH GOOGLE =====
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
const SESSION_SECRET = process.env.SESSION_SECRET || 'ALTERE_SESSION_SECRET_EM_PRODUCAO';
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
  {ID_USUARIO:'USR-DEMO-002',USUARIO:'joao.aprovador',EMAIL:'',NOME:'João Silva',PERFIL:'APROVADOR',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'Aprovador2026!',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-003',USUARIO:'ana.sac',EMAIL:'',NOME:'Ana Lima',PERFIL:'ANALISTA SAC',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'AnaSAC2026!',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-004',USUARIO:'carlos.rca',EMAIL:'',NOME:'Carlos Silva',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'Chiacchio',SETOR:'Comercial',STATUS:'ATIVO',SENHA:'RCA2026!',CODIGO_RCA:'RCA-023'},
  {ID_USUARIO:'USR-DEMO-005',USUARIO:'maria.qualidade',EMAIL:'',NOME:'Maria Santos',PERFIL:'SETOR RESPONSÁVEL',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'Qualidade2026!',CODIGO_RCA:''}
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
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'true').toLowerCase()!=='false';
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
  const demoEnabled=String(process.env.DEMO_LOGIN_ENABLED||'true').toLowerCase()!=='false';
  if(demoEnabled){
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
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function lerAba(nomeAba, maxRows) {
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:Z${maxRows}` : nomeAba;
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
  const dados = await lerAba(nomeAba, 2000);
  let max = 0;
  dados.forEach(r => {
    const campo = r[campoID] || r.ID_MANIFESTACAO || r.ID_HISTORICO || r.ID || '';
    const match = campo.match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1]));
  });
  return `${prefixo}-${String(max + 1).padStart(3, '0')}`;
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

async function motorRegras(descricao, tipo, empresa) {
  try {
    const [regras, tipos, procedimentos, slaData, perguntas] = await Promise.all([
      lerAba('REGRAS_ROTEAMENTO', 500), lerAba('TIPOS_RECLAMACAO', 500),
      lerAba('PROCEDIMENTOS', 200), lerAba('SLA_ESCALONAMENTO', 50), lerAba('PERGUNTAS_ANALISE', 200),
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
    let setores = [], regraAplicada = null;
    for (const r of regras) {
      if (r.ATIVO !== 'SIM') continue;
      const tiposRegra = (r.TIPO || '').split('/').map(t => t.trim());
      if (tiposRegra.includes(tipoID) || tiposRegra.some(t => (tipoID || '').includes(t))) {
        setores = (r.SETORES_ENVOLVIDOS || '').split('+').map(s => s.trim().split('(')[0].trim()).filter(Boolean);
        regraAplicada = r.ID_REGRA; break;
      }
    }
    if (setores.length === 0) {
      if (texto.includes('entrega') || texto.includes('prazo') || texto.includes('atraso')) setores = ['Logística'];
      else if (texto.includes('qualidade') || texto.includes('defeito') || texto.includes('ruptura')) setores = ['Qualidade'];
      else if (texto.includes('nota') || texto.includes('nf') || texto.includes('cobrança')) setores = ['Financeiro'];
      else if (texto.includes('comercial') || texto.includes('preço') || texto.includes('pedido')) setores = ['Comercial'];
      else setores = ['SAC'];
    }
    let slaHoras = 72;
    const slaSetor = slaData.find(s => s.SETOR && s.SETOR.includes('SAC'));
    if (slaSetor) { const match = (slaSetor.SLA_PADRAO_HORAS || '72').match(/\d+/); if (match) slaHoras = parseInt(match[0]); }
    let prioridade = 'Média';
    if (texto.includes('urgente') || texto.includes('urgência') || texto.includes('perda')) prioridade = 'Alta';
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
  const setor = (Array.isArray(setores) ? setores[0] : setores) || 'nossos setores responsáveis';
  return `Prezado(a) cliente da ${empresa || 'empresa'},\n\nRecebemos seu relato referente a ${tipo || 'sua manifestação'} e registramos formalmente em nosso sistema.\n\nEncaminhamos o caso ao setor de ${setor} para análise e providências.\n\nRetornaremos com um posicionamento completo dentro do prazo estabelecido.\n\nAgradecemos o contato e pedimos desculpas pelos transtornos causados.\n\nAtenciosamente,\nEquipe SAC — Grupo Chiacchio`;
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
  if (typeof val === 'string') { const d = new Date(val); return isNaN(d) ? null : d.toISOString().split('T')[0]; }
  if (val instanceof Date) return val.toISOString().split('T')[0];
  return null;
}

// ===========================================================
// ROTAS
// ===========================================================

app.get('/api/health', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '5.3.0', sistema: 'Assistente SAC Chiacchio', ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '5.3.0', sistema: 'Assistente SAC Chiacchio' });
});

// ===== MIDDLEWARE AUTH =====
app.use('/api', async (req,res,next)=>{
  const publicPaths = new Set(['/health','/','/auth/login','/auth/forgot-password','/analise','/analise/similares']);
  if(publicPaths.has(req.path) || req.path.endsWith('/auth/login') || req.path.endsWith('/auth/forgot-password')) return next();
  const header=req.headers.authorization||'';
  const token=header.startsWith('Bearer ')?header.slice(7):'';
  const payload=verificarToken(token);
  if(!payload) return res.status(401).json({sucesso:false,erro:'Sessão inválida ou expirada.'});
  req.user=payload;
  next();
});

// ===== AUTH =====
app.post('/api/auth/login', async (req, res) => {
  try {
    const { usuario, senha } = req.body || {};
    if(!usuario || !senha) return res.status(400).json({sucesso:false,erro:'Usuário e senha são obrigatórios.'});
    const registro=await carregarUsuarioPorLogin(usuario);
    if(!registro || !senhaValida(senha, registro.SENHA_HASH ?? registro.SENHA)) {
      return res.status(401).json({ sucesso: false, erro: 'Usuário ou senha incorretos.' });
    }
    const pub=usuarioPublico(registro);
    if(normalizarTexto(pub.status)==='inativo') return res.status(403).json({sucesso:false,erro:'Usuário inativo.'});
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

// ===== ANÁLISE IA (pública para demo) =====
app.post('/api/analise', async (req, res) => {
  try {
    const { descricao, tipo, empresaReclamada, empresaReclamante, produto, lote, id } = req.body;
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

// ===== MANIFESTAÇÕES =====
app.get('/api/manifestacoes', async (req, res) => {
  try {
    let data = await lerAba('MANIFESTACOES', 2000);
    if (perfilCanonico(req.user.perfil)==='RCA / REPRESENTANTE') {
      const rca=normalizarTexto(req.user.codigoRCA||req.user.usuario);
      data=data.filter(r=>normalizarTexto(r.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario) || normalizarTexto(r.CODIGO_RCA||'')===rca || normalizarTexto(r.RCA||'')===rca);
    }
    res.json({ sucesso: true, total: data.length, itens: data });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message, dados: [] }); }
});

app.get('/api/manifestacoes/:id', async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES', 2000);
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
    const id = await gerarProximoID('MANIFESTACOES','MAN','ID_MANIFESTACAO');
    const agora = new Date().toISOString();
    const tipoFinal = tipo || 'Reclamação';
    const objeto = {
      ID_MANIFESTACAO:id, DATA_ABERTURA:agora, DATA_REGISTRO:agora, EMPRESA_RECLAMANTE:empresaReclamante,
      CONTATO:contato||'', PRODUTO:produto||'', LOTE:lote||'', NFE:nfe||'', DESCRICAO:descricao, DESCRICAO_MANIFESTACAO:descricao,
      STATUS:'EM ANÁLISE', TIPO:tipoFinal, TIPO_SUGERIDO:'', SETOR_SUGERIDO:'', SETORES_SUGERIDOS:'',
      PROCEDIMENTO_SUGERIDO:'', SLA_HORAS:'', PRIORIDADE:'', RNC_SUGERIDO:'NÃO',
      EMPRESA_RECLAMADA:empNorm||empresaReclamada||'', CANAL:canal||'', CNPJ:cnpj||'', TELEFONE:telefone||'',
      EMAIL:email||'', QUANTIDADE:quantidade||'', VALOR:valor||'', TRATATIVA_SUGERIDA:'', TRATATIVA_APLICAVEL:'',
      TRATATIVA_REALIZADA:'', STATUS_TRATATIVA:'NÃO INICIADA', DEVOLUTIVA_SUGERIDA:'', DEVOLUTIVA_FINAL:'',
      DEVOLUTIVA_ENVIADA:'', ORIGEM_DOCUMENTO:origemDocumento||'', ARQUIVO_ORIGEM:arquivoOrigem||'',
      USUARIO_CRIACAO:usuario||req.user?.usuario||'sistema', ORIGEM:req.body.origem||'SAC',
    };
    await appendObjeto('MANIFESTACOES', objeto);
    let analise = null;
    try {
      analise = await executarAnalise({ ...objeto, empresaReclamante, empresaReclamada, descricao, tipo:tipoFinal });
      await atualizarPorID('MANIFESTACOES', id, {
        TIPO_SUGERIDO:analise.tipoSugerido||'',
        SETOR_SUGERIDO:Array.isArray(analise.setoresSugeridos)?analise.setoresSugeridos.join(', '):'',
        SETORES_SUGERIDOS:Array.isArray(analise.setoresSugeridos)?analise.setoresSugeridos.join(', '):'',
        PROCEDIMENTO_SUGERIDO:analise.procedimentoSugerido?.nome||'',
        SLA_HORAS:analise.slaHoras||'', PRIORIDADE:analise.prioridade||'',
        RNC_SUGERIDO:analise.geraRNC?'SIM':'NÃO', TRATATIVA_SUGERIDA:analise.tratativaSugerida?.sugestao||'',
        DEVOLUTIVA_SUGERIDA:analise.devolutivaSugerida||'', STATUS:'AGUARDANDO_DECISÃO'
      });
    } catch (e) { console.error('Falha na análise automática:', e.message); }
    await registrarAuditoria(usuario||'sistema','CRIOU_MANIFESTAÇÃO',id,'MANIFESTACOES',null,{empresaReclamante,tipo:tipoFinal});
    res.json({ sucesso:true, id, analise, mensagem:'Manifestação registrada e analisada.' });
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message }); }
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
    const novoStatus = decisaoStatus === 'APROVADA' ? 'APROVADA' : (decisaoStatus === 'REJEITADA' ? 'REJEITADA' : 'AGUARDANDO_ENCAMINHAMENTO');
    await atualizarPorID('MANIFESTACOES', id, {
      TIPO:tipoConfirmado||item.TIPO||'', TIPO_CONFIRMADO:tipoConfirmado||'', SETOR_SUGERIDO:setoresStr,
      SETORES_CONFIRMADOS:setoresStr, ID_PROCEDIMENTO_APLICADO:procedimentoUsado||'',
      PRIORIDADE:prioridade||item.PRIORIDADE||'', SLA_HORAS:slaHoras||item.SLA_HORAS||'',
      GERA_RNC:geraRNC||'NÃO', STATUS:novoStatus, TRATATIVA_APLICAVEL:tratativaAplicavel||'',
      TRATATIVA_REALIZADA:tratativaRealizada||'', DATA_INICIO_TRATATIVA:dataInicioTratativa||'',
      DEPENDE_OUTRO_SETOR:dependeOutroSetor||'NÃO', SETOR_DEPENDENTE:depStr,
      STATUS_TRATATIVA:status, DATA_CONCLUSAO_TRATATIVA:dataConclusaoTratativa||'',
      DEVOLUTIVA_FINAL:devolutivaFinal||'', DEVOLUTIVA_ENVIADA:devolutivaEnviada||'',
      DATA_DEVOLUTIVA:devolutivaEnviada?agora:'',
      DATA_CONCLUSAO_MANIFESTACAO:devolutivaEnviada&&dataConclusaoTratativa?agora:''
    });
    await registrarAuditoria(usuario,'DECISAO_MANIFESTACAO',id,'MANIFESTACOES',item.STATUS,{novoStatus,status});
    res.json({ sucesso:true, id, status:novoStatus, statusTratativa:status });
  } catch(e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ===== DASHBOARD =====
app.get('/api/dashboard', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
    const [mans, recs] = await Promise.all([lerAba('MANIFESTACOES', 2000), lerAba('Reclamações + devolutiva', 2000)]);
    const emAndamento = mans.filter(m => !['FINALIZADA','ENCERRADA','CONCLUÍDA'].some(s => (m.STATUS||'').toUpperCase().includes(s))).length;
    const rncsAbertas = mans.filter(m => m.ID_RNC && m.ID_RNC !== '').length;
    const recComSLA = recs.filter(r => r['Dentro do prazo? '] || r['Dentro do prazo?']);
    const dentroPrazo = recComSLA.filter(r => { const v=(r['Dentro do prazo? ']||r['Dentro do prazo?']||'').toUpperCase().trim(); return v==='SIM'||v==='S'; }).length;
    const slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo/recComSLA.length*100) : null;
    const porEmpresa = {};
    recs.forEach(r => {
      const emp = normalizarEmpresa(r['Empresa']);
      if (!emp) return;
      if (!porEmpresa[emp]) porEmpresa[emp] = { total:0, finaliz:0, sla:0, foraSLA:0 };
      porEmpresa[emp].total++;
      const st=(r['Status']||r['Situação Final']||'').toUpperCase();
      if(st.includes('FINALIZ')||st.includes('CONCLUÍD'))porEmpresa[emp].finaliz++;
      const slaV=(r['Dentro do prazo? ']||r['Dentro do prazo?']||'').toUpperCase().trim();
      if(slaV==='SIM')porEmpresa[emp].sla++; else if(slaV==='NÃO'||slaV==='NAO')porEmpresa[emp].foraSLA++;
    });
    const motivos = {};
    recs.forEach(r => { const m=(r['Motivo da Reclamação']||'').trim(); if(m&&m!=='Não identificado')motivos[m]=(motivos[m]||0)+1; });
    const statusCount = {};
    mans.forEach(m => { const s=m.STATUS||'EM ANÁLISE'; statusCount[s]=(statusCount[s]||0)+1; });
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
    res.json({ sucesso:true, dados:{ kpis:{ emAndamento, totalManifestacoes:mans.length, totalReclamacoes:recs.length, rncsAbertas, slaPercent:slaPercent!==null?slaPercent:'Sem dados', foraPrazo:recComSLA.length-dentroPrazo }, statusCount, porEmpresa, motivos:Object.entries(motivos).sort((a,b)=>b[1]-a[1]).slice(0,10).map(([m,c])=>({motivo:m,count:c})), semanas }});
  } catch (e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message, dados:{} }); }
});

// ===== RNC =====
app.get('/api/rnc', requerPerfil('MASTER','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    const data = await lerAba('BANCO_RNC', 5000);
    res.json({ sucesso:true, total:data.length, itens:data });
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message, dados:[] }); }
});

app.post('/api/rnc', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const body=req.body||{};
    if(!body.COMPETENCIA&&!body.competencia) return res.status(400).json({sucesso:false,erro:'Competência da RNC é obrigatória.'});
    const id=await gerarProximoID('BANCO_RNC','RNC','ID_RNC');
    const agora=new Date().toISOString();
    const competencia=body.COMPETENCIA||body.competencia;
    await appendObjeto('BANCO_RNC',{ID_RNC:id,DATA_ABERTURA:agora,EMPRESA:body.EMPRESA||body.empresa||'',SETOR:body.SETOR||body.setor||'',COMPETENCIA:competencia,NAO_CONFORMIDADE:body.NAO_CONFORMIDADE||body.naoConformidade||'',CAUSA:body.CAUSA||body.causa||'',RESPONSAVEL:body.RESPONSAVEL||body.responsavel||'',PRIORIDADE:body.PRIORIDADE||body.prioridade||'Média',PRAZO:body.PRAZO||body.prazo||'',STATUS:body.STATUS||'AGUARDANDO_APROVACAO'});
    await registrarAuditoria(body.usuario||'sistema','CRIOU_RNC',id,'BANCO_RNC',null,{competencia});
    res.json({sucesso:true,id,competencia,status:'AGUARDANDO_APROVACAO'});
  } catch(e){console.error(e);res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/rnc/:id', requerPerfil('APROVADOR','MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req,res)=>{
  try{
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
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
    const rnc=(await lerAba('BANCO_RNC',5000)).find(x=>x.ID_RNC===req.params.id);
    if(!rnc) return res.status(404).json({sucesso:false,erro:'RNC não encontrada.'});
    const d=String(decisao).toUpperCase();
    if(d!=='APROVAR'&&(!observacoes||!String(observacoes).trim())) return res.status(400).json({sucesso:false,erro:'Justificativa é obrigatória.'});
    const status=d==='APROVAR'?'APROVADA':(d==='REJEITAR'?'REJEITADA':'DEVOLVIDA');
    const agora=new Date().toISOString();
    await atualizarPorID('BANCO_RNC',req.params.id,{STATUS:status,APROVADOR_DECISAO:req.user.usuario,DATA_DECISAO:agora,OBSERVACOES_APROVACAO:observacoes||''},['ID_RNC','ID']);
    await registrarAuditoria(req.user.usuario,'DECISAO_RNC',req.params.id,'BANCO_RNC',rnc.STATUS,{status,observacoes:observacoes||''});
    res.json({sucesso:true,id:req.params.id,status});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.post('/api/rnc/:id/visualizacao', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try{
    const agora=new Date().toISOString();
    const idEvento=await gerarProximoID('RNC_EVENTOS','EVT','ID_EVENTO');
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

// ===== CLIENTES =====
app.get('/api/clientes/:cnpj', requerPerfil('MASTER','ANALISTA SAC','RCA / REPRESENTANTE'), async (req, res) => {
  try {
    const cnpj = req.params.cnpj.replace(/\D/g,'');
    const historico = await lerAba('BANCO_HISTORICO', 2000);
    const casos = historico.filter(h => { const hcnpj=(h.ORIG_CONTATO||'').replace(/\D/g,''); return hcnpj.includes(cnpj)||cnpj.includes(hcnpj); });
    if (casos.length===0) return res.json({ sucesso:true, encontrado:false, cliente:null, historico:[] });
    const ultimo = casos[casos.length-1];
    res.json({ sucesso:true, encontrado:true, cliente:{ contato:ultimo.ORIG_CONTATO, empresa:normalizarEmpresa(ultimo.ORIG_EMPRESA)||ultimo.ORIG_EMPRESA, reincidente:casos.length>1 }, historico:casos.slice(-5).map(c=>({ id:c.ID_HISTORICO, data:normalizarData(c.ORIG_DATA_ABERTURA), descricao:(c.ORIG_DESCRICAO_RECLAMACAO||'').slice(0,100), status:c.ORIG_STATUS, tipo:c.COMP_TIPO_PROBLEMA_VALIDADO })), totalCasos:casos.length });
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message }); }
});

// ===== RECLAMAÇÕES =====
app.get('/api/reclamacoes', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req, res) => {
  try {
    const data = await lerAba('Reclamações + devolutiva', 2000);
    const normalizado = data.map(r => ({ ...r, 'Data do Registro':normalizarData(r['Data do Registro']), 'Empresa':normalizarEmpresa(r['Empresa'])||r['Empresa'] })).filter(r=>r['Empresa']&&!['TR01','TR08'].includes(r['Empresa']));
    res.json({ sucesso:true, total:normalizado.length, itens:normalizado });
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message, dados:[] }); }
});

// ===== HISTORICO =====
app.get('/api/historico', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL'), async (req, res) => {
  try { const data=await lerAba('BANCO_HISTORICO',1000); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== SETORES =====
app.get('/api/setores', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('CONFIG_SETORES',50); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== CONHECIMENTO =====
app.get('/api/conhecimento', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('CONHECIMENTO_SETORES',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== PROCEDIMENTOS =====
app.get('/api/procedimentos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('PROCEDIMENTOS',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== POLÍTICAS =====
app.get('/api/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('POLITICAS',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== TIPOS =====
app.get('/api/tipos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('TIPOS_RECLAMACAO',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== SLA =====
app.get('/api/sla', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('SLA_ESCALONAMENTO',50); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== VALIDAÇÕES =====
app.get('/api/validacoes', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try { const data=await lerAba('HISTORICO_VALIDACOES',1000); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

// ===== AUDITORIA =====
app.get('/api/auditoria', requerPerfil('MASTER'), async (req, res) => {
  try { const data=await lerAba('LOG_SISTEMA',1000); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
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
    res.json({sucesso:true});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

// ===== APROVADORES =====
app.get('/api/aprovadores', requerPerfil('MASTER','APROVADOR'), async (req,res)=>{
  try {
    const [a,c,ac]=await Promise.all([lerAba('APROVADORES',500),lerAba('COMPETENCIAS',500),lerAba('APROVADOR_COMPETENCIAS',2000)]);
    res.json({sucesso:true,aprovadores:a,competencias:c,relacionamentos:ac});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/aprovadores/:usuario/pendencias', requerPerfil('APROVADOR','MASTER'), async (req,res)=>{
  try {
    const usuario=req.params.usuario;
    const [aprovadores,rel,comp,rncs,mans]=await Promise.all([lerAba('APROVADORES',500),lerAba('APROVADOR_COMPETENCIAS',5000),lerAba('COMPETENCIAS',500),lerAba('BANCO_RNC',5000),lerAba('MANIFESTACOES',5000)]);
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

// ===== SETOR RESPONSÁVEL =====
app.get('/api/setor/minhas-pendencias', requerPerfil('SETOR RESPONSÁVEL','MASTER'), async (req,res)=>{
  try{
    const rows=await lerAba('BANCO_RNC',5000);
    const setor=normalizarTexto(req.user.setor);
    const itens=rows.filter(r=>!['APROVADA','ENCERRADA','CANCELADA','REJEITADA'].includes(String(r.STATUS||'').toUpperCase())&&(!setor||normalizarTexto(r.SETOR||r.SETOR_ACAO)===setor));
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

// ===== REPRESENTANTES =====
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
  app.listen(PORT, () => console.log(`SAC Chiacchio API v5.3.0 rodando na porta ${PORT}`));
}

module.exports = app;
