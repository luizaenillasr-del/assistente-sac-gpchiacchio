const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { google } = require('googleapis');
const cerebroService = require('./services/cerebroServices');
const documentService = require('./services/documentService');

const app = express();
app.use(cors());
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

// ===== MOTOR DE REGRAS — MÚLTIPLOS SETORES =====
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
  if (typeof val === 'string') { const d = new Date(val); return isNaN(d) ? null : d.toISOString().split('T')[0]; }
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
    '/analise',
    '/analise/similares',
    '/empresas',
    '/setores-unicos',
    '/reclamacoes',
    '/manifestacoes',
    '/dashboard',
  ]);
  if(publicPaths.has(req.path)) return next();
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
    const { usuario } = req.body || {};
    if(!usuario) return res.status(400).json({sucesso:false,erro:'Usuário é obrigatório.'});
    const registro=await carregarUsuarioPorLogin(usuario);
    if(!registro) return res.status(401).json({ sucesso:false, erro:'Usuário não encontrado ou inativo.' });
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
    let data = await lerAba('MANIFESTACOES', 2000);
    if (req.user && perfilCanonico(req.user.perfil)==='RCA / REPRESENTANTE') {
      const rca=normalizarTexto(req.user.codigoRCA||req.user.usuario);
      data=data.filter(r=>normalizarTexto(r.USUARIO_CRIACAO||'')===normalizarTexto(req.user.usuario)||normalizarTexto(r.CODIGO_RCA||'')===rca||normalizarTexto(r.RCA||'')===rca);
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
    let analise = null;
    try {
      analise = await executarAnalise({ ...objeto, empresaReclamante, empresaReclamada, descricao, tipo:tipoFinal });
      await atualizarPorID('MANIFESTACOES', id, {
        TIPO_SUGERIDO:analise.tipoSugerido||'',
        SETOR_SUGERIDO:Array.isArray(analise.setoresSugeridos)?analise.setoresSugeridos[0]||'':'',
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
    res.json({ sucesso:true, id, status:novoStatus, statusTratativa:status });
  } catch(e) { console.error(e); res.status(500).json({ sucesso:false, erro:e.message }); }
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
  await garantirAbaComCabecalhos(aba, headers);
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
  try{const nome=decodeURIComponent(req.params.setor);const dados={};for(const c of SETOR_OPERACIONAL_FIELDS){if(req.body?.[c]!==undefined)dados[c]=req.body[c];}dados.ATIVO=req.body?.ATIVO||'SIM';const out=await atualizarOuCriarSetor(nome,dados,req.user.usuario);await registrarAuditoria(req.user.usuario,'ATUALIZOU_FICHA_SETOR',nome,'CONFIG_SETORES',null,dados);res.json({sucesso:true,setor:out});}
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
app.post('/api/calculadora/parametros/logistica', requerPerfil('MASTER'), async(req,res)=>{try{await garantirAbaComCabecalhos('PARAMETROS_LOGISTICA',LOG_HEADERS);const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_LOGISTICA','LOG','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_LOGISTICA',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:e.message});}});
app.post('/api/calculadora/parametros/producao', requerPerfil('MASTER'), async(req,res)=>{try{await garantirAbaComCabecalhos('PARAMETROS_PRODUCAO',PROD_HEADERS);const b=req.body||{};const obj={...b,ID:b.ID||await gerarProximoID('PARAMETROS_PRODUCAO','PROD','ID'),ATIVO:b.ATIVO||'SIM',DATA_ATUALIZACAO:new Date().toISOString(),USUARIO_ATUALIZACAO:req.user.usuario};await appendObjeto('PARAMETROS_PRODUCAO',obj);res.json({sucesso:true,item:obj});}catch(e){res.status(500).json({sucesso:false,erro:e.message});}});

// ===== DASHBOARD =====
app.get('/api/dashboard', async (req, res) => {
  try {
    const [mans, recs] = await Promise.all([lerAba('MANIFESTACOES', 2000), lerAba('Reclamações + devolutiva', 2000)]);
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
  try { const data=await lerAba('BANCO_RNC',5000); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});

app.post('/api/rnc', requerPerfil('MASTER','ANALISTA SAC'), async (req,res)=>{
  try {
    const body=req.body||{};
    if(!body.COMPETENCIA&&!body.competencia) return res.status(400).json({sucesso:false,erro:'Competência da RNC é obrigatória.'});
    const id=await gerarProximoID('BANCO_RNC','RNC','ID_RNC'); const agora=new Date().toISOString();
    const competencia=body.COMPETENCIA||body.competencia;
    await appendObjeto('BANCO_RNC',{ID_RNC:id,DATA_ABERTURA:agora,EMPRESA:body.EMPRESA||body.empresa||'',SETOR:body.SETOR||body.setor||'',COMPETENCIA:competencia,NAO_CONFORMIDADE:body.NAO_CONFORMIDADE||body.naoConformidade||'',CAUSA:body.CAUSA||body.causa||'',RESPONSAVEL:body.RESPONSAVEL||body.responsavel||'',PRIORIDADE:body.PRIORIDADE||body.prioridade||'Média',PRAZO:body.PRAZO||body.prazo||'',STATUS:body.STATUS||'AGUARDANDO_APROVACAO'});
    await registrarAuditoria(body.usuario||'sistema','CRIOU_RNC',id,'BANCO_RNC',null,{competencia});
    res.json({sucesso:true,id,competencia,status:'AGUARDANDO_APROVACAO'});
  } catch(e){res.status(500).json({sucesso:false,erro:e.message});}
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
    const historico=await lerAba('BANCO_HISTORICO',2000);
    const casos=historico.filter(h=>{const hcnpj=(h.ORIG_CONTATO||'').replace(/\D/g,'');return hcnpj.includes(cnpj)||cnpj.includes(hcnpj);});
    if(casos.length===0) return res.json({sucesso:true,encontrado:false,cliente:null,historico:[]});
    const ultimo=casos[casos.length-1];
    res.json({sucesso:true,encontrado:true,cliente:{contato:ultimo.ORIG_CONTATO,empresa:normalizarEmpresa(ultimo.ORIG_EMPRESA)||ultimo.ORIG_EMPRESA,reincidente:casos.length>1},historico:casos.slice(-5).map(c=>({id:c.ID_HISTORICO,data:normalizarData(c.ORIG_DATA_ABERTURA),descricao:(c.ORIG_DESCRICAO_RECLAMACAO||'').slice(0,100),status:c.ORIG_STATUS,tipo:c.COMP_TIPO_PROBLEMA_VALIDADO})),totalCasos:casos.length});
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message}); }
});

// ===== RECLAMAÇÕES =====
app.get('/api/reclamacoes', async (req, res) => {
  try {
    const data=await lerAba('Reclamações + devolutiva',2000);
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
  try { const data=await lerAba('BANCO_HISTORICO',1000); res.json({sucesso:true,total:data.length,itens:data}); }
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
    await garantirAbaComCabecalhos('CONFIG_SETORES',['ID_SETOR','SETOR','DESCRICAO','RESPONSAVEL','SUBSTITUTO','EMAIL_RESPONSAVEL','SLA_HORAS','RESPONSABILIDADES','REGRAS_OPERACIONAIS','PROCEDIMENTOS_ORIENTACOES','ALERTAS','ATIVO','EMPRESA']).catch(()=>{});
    const data = await lerAba('CONFIG_SETORES', 500).catch(()=>[]);
    // Attach knowledge counts per sector
    const [faqs, regras, procs, pols, pergs] = await Promise.all([
      lerAba('FAQ_SETORES',5000).catch(()=>[]),
      lerAba('REGRAS_SETORES',5000).catch(()=>[]),
      lerAba('PROCEDIMENTOS_SETORES',5000).catch(()=>[]),
      lerAba('POLITICAS_SETORES',5000).catch(()=>[]),
      lerAba('PERGUNTAS_IA_SETORES',2000).catch(()=>[]),
    ]);
    const itens = data.map(s => {
      const n = normalizarTexto(s.SETOR||'');
      return {
        ...s,
        _counts: {
          faqs: faqs.filter(r=>normalizarTexto(r.SETOR||'')===n&&(r.ATIVO||'SIM')!=='NÃO').length,
          regras: regras.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA').length,
          procedimentos: procs.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA').length,
          politicas: pols.filter(r=>normalizarTexto(r.SETOR||'')===n&&r.STATUS!=='OBSOLETA'&&r.STATUS!=='EXPIRADA').length,
          perguntas: pergs.filter(r=>normalizarTexto(r.SETOR||'')===n&&(r.ATIVO||'SIM')!=='NÃO').length,
        }
      };
    });
    res.json({ sucesso:true, total:itens.length, itens });
  } catch (e) { res.status(500).json({ sucesso:false, erro:e.message, itens:[] }); }
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
    await garantirAbaComCabecalhos('PROCEDIMENTOS',['ID_PROCEDIMENTO','NOME','SETOR_RESPONSAVEL','DESCRICAO','PASSOS','ATIVO']).catch(()=>{});
    const data=await lerAba('PROCEDIMENTOS',200).catch(()=>[]);
    res.json({sucesso:true,total:data.length,itens:data});
  } catch (e) { res.status(500).json({sucesso:false,erro:e.message,itens:[]}); }
});
app.get('/api/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try {
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
    await garantirAbaComCabecalhos('MATRIZ_DECISAO', ['ID_MATRIZ','TEMA','SETOR_PRINCIPAL','SETORES_APOIO','SLA_HORAS','PRIORIDADE','GERA_RNC','APROVACAO','FOLLOW_UP','REGRAS']);
    const data = await lerAba('MATRIZ_DECISAO', 500);
    res.json({ sucesso: true, itens: data });
  } catch (e) { res.status(500).json({ sucesso: false, erro: e.message, itens: [] }); }
});
app.patch('/api/matriz/:id', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try {
    const id = req.params.id;
    await garantirAbaComCabecalhos('MATRIZ_DECISAO', ['ID_MATRIZ','TEMA','SETOR_PRINCIPAL','SETORES_APOIO','SLA_HORAS','PRIORIDADE','GERA_RNC','APROVACAO','FOLLOW_UP','REGRAS']);
    const reg = await atualizarPorID('MATRIZ_DECISAO', id, req.body, ['ID_MATRIZ','ID']);
    if (!reg) return res.status(404).json({ sucesso: false, erro: 'Regra não encontrada.' });
    res.json({ sucesso: true, linha: reg.linha });
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
    const NOTA_CRITICA = Number(process.env.PESQUISA_NOTA_CRITICA || 3);
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
  try { const data=await lerAba('TIPOS_RECLAMACAO',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/sla', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('SLA_ESCALONAMENTO',50); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/validacoes', requerPerfil('MASTER','ANALISTA SAC'), async (req, res) => {
  try { const data=await lerAba('HISTORICO_VALIDACOES',1000); res.json({sucesso:true,total:data.length,itens:data}); }
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
  app.listen(PORT, () => console.log(`SAC Chiacchio API v5.6.0 rodando na porta ${PORT}`));
}

module.exports = app;
