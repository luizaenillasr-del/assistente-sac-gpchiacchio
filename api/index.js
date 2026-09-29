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

// ===== ACESSOS DE COMPATIBILIDADE =====
// Mantidos exatamente para preservar os logins já utilizados no sistema.
// Eles NÃO são retornados por APIs de dados/usuários e NÃO alimentam nenhuma
// informação operacional, RNC, manifestação, setor, regra ou indicador.
const ACESSOS_COMPATIBILIDADE = [
  {ID_USUARIO:'USR-DEMO-001',USUARIO:'luiza',EMAIL:'',NOME:'Luiza',PERFIL:'MASTER',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'sha256:b5d54c39e66671c9731b9f471e585d8262cd4f54daa9d7d033747a98ea9a9ef0',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-002',USUARIO:'joao.aprovador',EMAIL:'',NOME:'João Silva',PERFIL:'APROVADOR',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'Aprovador2026!',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-003',USUARIO:'ana.sac',EMAIL:'',NOME:'Ana Lima',PERFIL:'ANALISTA SAC',EMPRESA:'Grupo Chiacchio',SETOR:'SAC',STATUS:'ATIVO',SENHA:'AnaSAC2026!',CODIGO_RCA:''},
  {ID_USUARIO:'USR-DEMO-004',USUARIO:'carlos.rca',EMAIL:'',NOME:'Carlos Silva',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'Chiacchio',SETOR:'Comercial',STATUS:'ATIVO',SENHA:'RCA2026!',CODIGO_RCA:'RCA-023'},
  {ID_USUARIO:'USR-DEMO-005',USUARIO:'maria.qualidade',EMAIL:'',NOME:'Maria Santos',PERFIL:'SETOR RESPONSÁVEL',EMPRESA:'Chiacchio',SETOR:'Qualidade',STATUS:'ATIVO',SENHA:'Qualidade2026!',CODIGO_RCA:''}
];

async function carregarUsuarios(opcoes = {}){
  const incluirAcessosCompatibilidade = Boolean(opcoes.incluirAcessosCompatibilidade);
  let rows=[];
  try{ rows=await lerAba('USUARIOS',1000); }catch(e){ console.warn('USUARIOS não disponível:',e.message); }
  const raw=process.env.USUARIOS_JSON||'{}';
  let envUsers=[];
  try{
    const parsed=JSON.parse(raw);
    envUsers=Object.entries(parsed).map(([usuario,val])=>typeof val==='string'
      ? {ID_USUARIO:usuario,USUARIO:usuario,SENHA:val,NOME:usuario,PERFIL:'ANALISTA SAC',STATUS:'ATIVO'}
      : {ID_USUARIO:usuario,USUARIO:usuario,...val});
  }catch(e){ console.warn('USUARIOS_JSON inválido:', e.message); }

  const base = [...rows, ...envUsers];
  return incluirAcessosCompatibilidade ? [...base, ...ACESSOS_COMPATIBILIDADE] : base;
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

  // Primeiro: contas reais da planilha e/ou variáveis de ambiente.
  const usuarios=await carregarUsuarios({incluirAcessosCompatibilidade:false});
  const usuarioReal = usuarios.find(u=>
    normalizarTexto(u.USUARIO||u.EMAIL||u.ID_USUARIO)===alvo &&
    normalizarTexto(u.STATUS||'ATIVO')!=='inativo'
  );
  if(usuarioReal) return usuarioReal;

  // Segundo: compatibilidade com os logins que já existiam no sistema.
  const acessoCompat = ACESSOS_COMPATIBILIDADE.find(u=>
    normalizarTexto(u.USUARIO)===alvo &&
    normalizarTexto(u.STATUS||'ATIVO')!=='inativo'
  );
  return acessoCompat || null;
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
  const nomeEscapado = String(nomeAba).replace(/'/g, "''");
  const range = maxRows ? `'${nomeEscapado}'!A1:ZZ${Number(maxRows)+1}` : `'${nomeEscapado}'!A:ZZ`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'FORMATTED_VALUE'
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  const body = maxRows ? rows.slice(1, Number(maxRows)+1) : rows.slice(1);
  return body.map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] ?? ''; });
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

function registroAtivo(row){
  const ativo=normalizarTexto(row?.ATIVO||'');
  return !ativo || ativo==='sim' || ativo==='ativo' || ativo==='true' || ativo==='1';
}

function listaCampo(valor){
  return String(valor||'')
    .split(/[;,|+]/)
    .map(v=>v.trim())
    .filter(Boolean);
}

function numeroOuNulo(valor){
  const m=String(valor??'').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

function valorSimNao(valor){
  const v=normalizarTexto(valor);
  if(['sim','s','true','1','yes'].includes(v)) return 'SIM';
  if(['nao','não','n','false','0','no'].includes(v)) return 'NÃO';
  return '';
}

function contemTermo(texto, termos){
  const t=normalizarTexto(texto);
  return listaCampo(termos).some(termo=>t.includes(normalizarTexto(termo)));
}

function prioridadeValida(valor){
  const v=String(valor||'').trim();
  return ['Baixa','Média','Alta','Crítica','Critica'].find(x=>normalizarTexto(x)===normalizarTexto(v)) || '';
}

function escolherPrimeiroRegistro(registros, setor){
  const alvo=normalizarTexto(setor);
  return registros.find(r=>normalizarTexto(r.SETOR||'')===alvo) || registros.find(r=>!r.SETOR) || registros[0] || null;
}

// ===== MOTOR DE REGRAS — MÚLTIPLOS SETORES =====
async function motorRegras(descricao, tipo, empresa) {
  try {
    const [regras, tipos, procedimentos, slaData, perguntas, parametrosSetores, regrasOperacionais] = await Promise.all([
      lerAba('REGRAS_ROTEAMENTO', 500),
      lerAba('TIPOS_RECLAMACAO', 500),
      lerAba('PROCEDIMENTOS', 200),
      lerAba('SLA_ESCALONAMENTO', 100),
      lerAba('PERGUNTAS_ANALISE', 200),
      lerAba('PARAMETROS_SETORES', 2000).catch(()=>[]),
      lerAba('REGRAS_OPERACIONAIS_SAC', 2000).catch(()=>[]),
    ]);

    const texto = String(descricao || '');
    const textoNormalizado = normalizarTexto(texto);
    const tipoInformado = String(tipo || '').trim();
    const empresaInformada = String(empresa || '').trim();

    let tipoDetectado = tipoInformado || null;
    let tipoConfianca = tipoInformado ? 100 : 0;
    let tipoID = null;

    // 1. Classificação por TIPOS_RECLAMACAO real.
    for (const t of tipos) {
      const palavras = listaCampo(t.PALAVRAS_CHAVE);
      let matches = 0;
      for (const p of palavras) {
        if (normalizarTexto(p) && textoNormalizado.includes(normalizarTexto(p))) matches++;
      }
      const tipoLinha = String(t.TIPO || t.NOME || '').trim();
      const idLinha = String(t.ID_TIPO || '').trim();
      if (tipoInformado && (normalizarTexto(tipoLinha)===normalizarTexto(tipoInformado) || normalizarTexto(idLinha)===normalizarTexto(tipoInformado))) {
        tipoDetectado = tipoLinha || tipoInformado;
        tipoID = idLinha || tipoInformado;
        tipoConfianca = 100;
      }
      if (matches > 0) {
        const conf = Math.min(99, Math.round((matches / Math.max(palavras.length, 1)) * 100 * 2));
        if (conf > tipoConfianca) {
          tipoConfianca = conf;
          tipoDetectado = tipoLinha || idLinha || 'Não identificado';
          tipoID = idLinha || tipoLinha || null;
        }
      }
    }
    if (!tipoDetectado) tipoDetectado = 'Não identificado';

    // 2. Setores vindos exclusivamente de configuração/rotas armazenadas.
    const setoresSet = new Set();
    let regraAplicada = null;

    for (const r of regras) {
      if (!registroAtivo(r)) continue;
      const tiposRegra = listaCampo(r.TIPO);
      if (tipoID && (tiposRegra.some(t=>normalizarTexto(t)===normalizarTexto(tipoID)) || tiposRegra.some(t=>normalizarTexto(tipoID).includes(normalizarTexto(t))))) {
        listaCampo(r.SETORES_ENVOLVIDOS || r.SETOR || r.SETORES).forEach(s=>setoresSet.add(s));
        if (!regraAplicada) regraAplicada = r.ID_REGRA || null;
      }
    }

    // PARAMETROS_SETORES: usa tipo/tema/subtema/causa/subcausa/palavras-chave reais.
    const parametrosCorrespondentes = parametrosSetores.filter(p=>{
      if (!registroAtivo(p)) return false;
      const termos=[p.PALAVRAS_CHAVE,p.TIPO_MANIFESTACAO,p.TEMA,p.SUBTEMA,p.CAUSA,p.SUBCAUSA].filter(Boolean).join('|');
      const tipoMatch = tipoID && contemTermo(tipoID, p.TIPO_MANIFESTACAO);
      const textoMatch = contemTermo(texto, termos.replace(/\|/g,';'));
      return tipoMatch || textoMatch;
    });
    parametrosCorrespondentes.forEach(p=>{
      if (p.SETOR) setoresSet.add(String(p.SETOR).trim());
    });

    // REGRAS_OPERACIONAIS_SAC: condição e tema são dados configuráveis.
    const regrasCorrespondentes = regrasOperacionais.filter(r=>{
      if (!registroAtivo(r)) return false;
      const tipoRegra=normalizarTexto(r.TIPO_REGRA||'');
      const tema=String(r.TEMA||'');
      const condicao=String(r.CONDICAO||'');
      const tipoMatch=tipoID && (tipoRegra.includes(normalizarTexto(tipoID)) || normalizarTexto(tipoID).includes(tipoRegra));
      const temaMatch=tema && textoNormalizado.includes(normalizarTexto(tema));
      const condicaoMatch=condicao && contemTermo(texto, condicao);
      return Boolean(tipoMatch || temaMatch || condicaoMatch);
    });
    regrasCorrespondentes.forEach(r=>{
      if(r.SETOR) setoresSet.add(String(r.SETOR).trim());
      if(!regraAplicada && r.ID) regraAplicada=r.ID;
    });

    const setores = [...setoresSet].filter(Boolean);

    // 3. Busca dos parâmetros do(s) setor(es) identificado(s).
    const parametrosAtivos = parametrosSetores.filter(registroAtivo);
    const parametrosDosSetores = parametrosAtivos.filter(p=>{
      if(!p.SETOR) return false;
      return setores.some(s=>normalizarTexto(s)===normalizarTexto(p.SETOR));
    });

    let setorPrincipal = setores[0] || '';
    const paramPrincipal = escolherPrimeiroRegistro(parametrosDosSetores, setorPrincipal);
    const setorApoio = listaCampo(paramPrincipal?.SETORES_APOIO || '').filter(s=>!setores.some(x=>normalizarTexto(x)===normalizarTexto(s)));
    const setoresFinais = [...new Set([...setores, ...setorApoio])].filter(Boolean);

    // 4. SLA: primeiro parâmetro setorial real; depois tabela de SLA existente.
    let slaHoras = null;
    const paramSla = parametrosDosSetores.find(p=>numeroOuNulo(p.SLA_HORAS)!==null);
    if(paramSla) slaHoras = numeroOuNulo(paramSla.SLA_HORAS);
    if(slaHoras===null && setorPrincipal){
      const slaSetor=slaData.find(s=>normalizarTexto(s.SETOR||'')===normalizarTexto(setorPrincipal) && registroAtivo(s));
      if(slaSetor) slaHoras=numeroOuNulo(slaSetor.SLA_PADRAO_HORAS || slaSetor.SLA_HORAS || slaSetor.PRAZO_HORAS);
    }

    // 5. Prioridade e RNC: somente configuração cadastrada.
    let prioridade = prioridadeValida(paramPrincipal?.PRIORIDADE_PADRAO);
    if(!prioridade){
      const rp = regrasCorrespondentes.find(r=>prioridadeValida(r.PRIORIDADE));
      prioridade = prioridadeValida(rp?.PRIORIDADE);
    }

    let geraRNC = valorSimNao(paramPrincipal?.GERA_RNC);
    if(!geraRNC){
      const rr=regrasCorrespondentes.find(r=>valorSimNao(r.GERA_RNC));
      geraRNC=valorSimNao(rr?.GERA_RNC);
    }
    if(!geraRNC) geraRNC='NÃO';

    const necessitaAprovacao = valorSimNao(paramPrincipal?.NECESSITA_APROVACAO || regrasCorrespondentes.find(r=>valorSimNao(r.NECESSITA_APROVACAO))?.NECESSITA_APROVACAO) || '';
    const causa = paramPrincipal?.CAUSA || regrasCorrespondentes.find(r=>r.CAUSA)?.CAUSA || '';
    const subcausa = paramPrincipal?.SUBCAUSA || regrasCorrespondentes.find(r=>r.SUBCAUSA)?.SUBCAUSA || '';
    const tratativaPadrao = paramPrincipal?.TRATATIVA_PADRAO || regrasCorrespondentes.find(r=>r.TRATATIVA)?.TRATATIVA || '';
    const devolutivaModelo = paramPrincipal?.DEVOLUTIVA_MODELO || '';

    // 6. Procedimento real aplicável.
    let procedimentoSugerido = null;
    for (const p of procedimentos) {
      const tiposProc = listaCampo(p.TIPO_RECLAMACAO || p.TIPO || p.ID_TIPO);
      const tipoProcMatch = tipoID && (tiposProc.some(t=>normalizarTexto(t)===normalizarTexto(tipoID)) || tiposProc.some(t=>normalizarTexto(tipoID).includes(normalizarTexto(t))));
      const setorProcMatch = setorPrincipal && normalizarTexto(p.SETOR_RESPONSAVEL || p.SETOR || '')===normalizarTexto(setorPrincipal);
      if(tipoProcMatch || setorProcMatch){
        procedimentoSugerido = {
          id: p.ID_PROCEDIMENTO || p.ID,
          nome: p.NOME || p.PROCEDIMENTO || p.TITULO,
          passos: p.PASSOS || p.ETAPAS || '',
          documentos: p.DOCUMENTOS_NECESSARIOS || p.DOCUMENTOS || ''
        };
        break;
      }
    }

    const perguntasNecessarias = perguntas
      .filter(p => {
        const tipoPergunta=String(p.TIPO_RECLAMACAO || p.TIPO || '').trim();
        return !tipoID || tipoPergunta==='TODOS' || normalizarTexto(tipoPergunta)===normalizarTexto(tipoID) || normalizarTexto(tipoID).includes(normalizarTexto(tipoPergunta));
      })
      .slice(0,6)
      .map(p => ({ id:p.ID_PERGUNTA || p.ID, pergunta:p.PERGUNTA || p.TEXTO, obrigatoria:normalizarTexto(p.OBRIGATORIA)==='sim' }));

    return {
      tipoDetectado,
      tipoSugerido: tipoDetectado,
      tipoID,
      tipoConfianca,
      setores: setoresFinais,
      setoresSugeridos: setoresFinais,
      setorPrincipal,
      setoresApoio: setorApoio,
      regraAplicada,
      slaHoras,
      prioridade,
      geraRNC,
      necessitaAprovacao,
      causa,
      subcausa,
      tratativaPadrao,
      devolutivaModelo,
      procedimentoSugerido,
      perguntasNecessarias,
      empresa: empresaInformada,
      origemRegra: setoresFinais.length ? 'CONFIGURACAO_SISTEMA' : 'SEM_REGRA_CADASTRADA'
    };
  } catch (e) {
    console.error('Erro motor regras:', e.message);
    return {
      tipoDetectado:'Não identificado', tipoSugerido:'Não identificado', tipoConfianca:0,
      setores:[], setoresSugeridos:[], setorPrincipal:'', setoresApoio:[], regraAplicada:null,
      slaHoras:null, prioridade:'', geraRNC:'NÃO', necessitaAprovacao:'', causa:'', subcausa:'',
      tratativaPadrao:'', devolutivaModelo:'', procedimentoSugerido:null, perguntasNecessarias:[],
      origemRegra:'ERRO'
    };
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
  res.json({ sucesso: true, status: 'ok', versao: '6.0.0', sistema: 'Assistente SAC Chiacchio', ts: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ sucesso: true, status: 'ok', versao: '6.0.0', sistema: 'Assistente SAC Chiacchio' });
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
    if (!isDemo) {
      await registrarAcessoUsuario(registro);
      await registrarAuditoria(pub.usuario,'LOGIN',null,'AUTH',null,{perfil:pub.perfil});
    }
    res.json({ sucesso:true, token:assinarToken(payload), usuario:pub.usuario, usuarioInfo:pub, modo:'PRODUCAO' });
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
    const [config, params, regras, mans] = await Promise.all([
      lerAba('CONFIG_SETORES', 500).catch(()=>[]),
      lerAba('PARAMETROS_SETORES', 2000).catch(()=>[]),
      lerAba('REGRAS_OPERACIONAIS_SAC', 2000).catch(()=>[]),
      lerAba('MANIFESTACOES', 5000).catch(()=>[]),
    ]);
    const setores = new Set();
    for(const row of config){ if(registroAtivo(row) && row.SETOR) setores.add(String(row.SETOR).trim()); }
    for(const row of params){ if(registroAtivo(row) && row.SETOR) setores.add(String(row.SETOR).trim()); }
    for(const row of regras){ if(registroAtivo(row) && row.SETOR) setores.add(String(row.SETOR).trim()); }
    for(const row of mans){
      listaCampo(row.SETOR || row.SETOR_CONFIRMADO || row.SETOR_DESTINADO || row.SETOR_SUGERIDO).forEach(s=>setores.add(s));
    }
    res.json({ sucesso:true, total:setores.size, itens:[...setores].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')) });
  } catch (e) {
    console.error('Erro ao carregar setores:', e.message);
    res.status(500).json({ sucesso:false, erro:e.message, itens:[] });
  }
});

app.get('/api/setores', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('CONFIG_SETORES',50); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/setores/estrutura', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    const [config, params, conhecimento, procedimentos, politicas, regras] = await Promise.all([
      lerAba('CONFIG_SETORES',500).catch(()=>[]),
      lerAba('PARAMETROS_SETORES',5000).catch(()=>[]),
      lerAba('CONHECIMENTO_SETORES',5000).catch(()=>[]),
      lerAba('PROCEDIMENTOS',5000).catch(()=>[]),
      lerAba('POLITICAS',5000).catch(()=>[]),
      lerAba('REGRAS_OPERACIONAIS_SAC',5000).catch(()=>[]),
    ]);
    const nomes=new Set();
    const addNome=v=>listaCampo(v).forEach(s=>nomes.add(s));
    config.filter(registroAtivo).forEach(x=>addNome(x.SETOR));
    params.filter(registroAtivo).forEach(x=>addNome(x.SETOR));
    regras.filter(registroAtivo).forEach(x=>addNome(x.SETOR));
    conhecimento.filter(registroAtivo).forEach(x=>addNome(x.SETOR));

    const itens=[...nomes].filter(Boolean).sort((a,b)=>a.localeCompare(b,'pt-BR')).map(setor=>{
      const cfg=config.filter(x=>normalizarTexto(x.SETOR)===normalizarTexto(setor));
      const ps=params.filter(x=>registroAtivo(x)&&normalizarTexto(x.SETOR)===normalizarTexto(setor));
      const ks=conhecimento.filter(x=>registroAtivo(x)&&normalizarTexto(x.SETOR)===normalizarTexto(setor));
      const prs=procedimentos.filter(x=>normalizarTexto(x.SETOR_RESPONSAVEL||x.SETOR)===normalizarTexto(setor));
      const pol=politicas.filter(x=>normalizarTexto(x.SETOR_RESPONSAVEL||x.SETOR)===normalizarTexto(setor));
      const rs=regras.filter(x=>registroAtivo(x)&&normalizarTexto(x.SETOR)===normalizarTexto(setor));
      return {
        setor,
        ativo: cfg.some(registroAtivo) || ps.some(registroAtivo) || rs.some(registroAtivo),
        configuracao: cfg[0] || null,
        parametros: ps,
        conhecimento: ks,
        procedimentos: prs,
        politicas: pol,
        regras: rs,
        contadores:{parametros:ps.length,conhecimento:ks.length,procedimentos:prs.length,politicas:pol.length,regras:rs.length}
      };
    });
    res.json({sucesso:true,total:itens.length,itens});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.get('/api/setores/:setor', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    const setor=decodeURIComponent(req.params.setor||'');
    const alvo=normalizarTexto(setor);
    const [config, params, conhecimento, procedimentos, politicas, regras, sla] = await Promise.all([
      lerAba('CONFIG_SETORES',500).catch(()=>[]),
      lerAba('PARAMETROS_SETORES',5000).catch(()=>[]),
      lerAba('CONHECIMENTO_SETORES',5000).catch(()=>[]),
      lerAba('PROCEDIMENTOS',5000).catch(()=>[]),
      lerAba('POLITICAS',5000).catch(()=>[]),
      lerAba('REGRAS_OPERACIONAIS_SAC',5000).catch(()=>[]),
      lerAba('SLA_ESCALONAMENTO',500).catch(()=>[]),
    ]);
    const result={
      setor,
      configuracao:config.filter(x=>normalizarTexto(x.SETOR||'')===alvo),
      parametros:params.filter(x=>normalizarTexto(x.SETOR||'')===alvo),
      conhecimento:conhecimento.filter(x=>normalizarTexto(x.SETOR||'')===alvo),
      procedimentos:procedimentos.filter(x=>normalizarTexto(x.SETOR_RESPONSAVEL||x.SETOR||'')===alvo),
      politicas:politicas.filter(x=>normalizarTexto(x.SETOR_RESPONSAVEL||x.SETOR||'')===alvo),
      regras:regras.filter(x=>normalizarTexto(x.SETOR||'')===alvo),
      sla:sla.filter(x=>normalizarTexto(x.SETOR||'')===alvo),
    };
    const encontrado=Object.values(result).some(v=>Array.isArray(v)&&v.length) || result.configuracao.length>0;
    if(!encontrado) return res.status(404).json({sucesso:false,erro:'Setor não encontrado na base real.'});
    res.json({sucesso:true,setor:result});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/parametros-setores', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    let data=await lerAba('PARAMETROS_SETORES',5000);
    if(req.query.setor) data=data.filter(x=>normalizarTexto(x.SETOR)===normalizarTexto(req.query.setor));
    if(req.query.ativo) data=data.filter(x=>normalizarTexto(x.ATIVO)===normalizarTexto(req.query.ativo));
    res.json({sucesso:true,total:data.length,itens:data});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.post('/api/parametros-setores', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const body=req.body||{};
    if(!body.SETOR||!body.TEMA) return res.status(400).json({sucesso:false,erro:'SETOR e TEMA são obrigatórios.'});
    const id=body.ID || await gerarProximoID('PARAMETROS_SETORES','PSET','ID');
    const objeto={...body,ID:id,USUARIO_ATUALIZACAO:req.user?.usuario||body.USUARIO_ATUALIZACAO||'',DATA_ATUALIZACAO:new Date().toISOString()};
    await appendObjeto('PARAMETROS_SETORES',objeto);
    await registrarAuditoria(req.user?.usuario||'sistema','CRIAR_PARAMETRO_SETOR',id,'PARAMETROS_SETORES',null,objeto);
    res.json({sucesso:true,id,item:objeto});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.patch('/api/parametros-setores/:id', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const atual=await atualizarPorID('PARAMETROS_SETORES',req.params.id,{...req.body,USUARIO_ATUALIZACAO:req.user?.usuario||'',DATA_ATUALIZACAO:new Date().toISOString()},['ID']);
    if(!atual) return res.status(404).json({sucesso:false,erro:'Parâmetro de setor não encontrado.'});
    await registrarAuditoria(req.user?.usuario||'sistema','EDITAR_PARAMETRO_SETOR',req.params.id,'PARAMETROS_SETORES',null,req.body||{});
    res.json({sucesso:true,id:req.params.id});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/regras-operacionais', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    let data=await lerAba('REGRAS_OPERACIONAIS_SAC',5000);
    if(req.query.setor) data=data.filter(x=>normalizarTexto(x.SETOR)===normalizarTexto(req.query.setor));
    if(req.query.ativo) data=data.filter(x=>normalizarTexto(x.ATIVO)===normalizarTexto(req.query.ativo));
    res.json({sucesso:true,total:data.length,itens:data});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.post('/api/regras-operacionais', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const body=req.body||{};
    if(!body.SETOR||!body.TEMA||!body.TIPO_REGRA) return res.status(400).json({sucesso:false,erro:'SETOR, TEMA e TIPO_REGRA são obrigatórios.'});
    const id=body.ID || await gerarProximoID('REGRAS_OPERACIONAIS_SAC','ROP','ID');
    const objeto={...body,ID:id,DATA_ATUALIZACAO:new Date().toISOString()};
    await appendObjeto('REGRAS_OPERACIONAIS_SAC',objeto);
    await registrarAuditoria(req.user?.usuario||'sistema','CRIAR_REGRA_OPERACIONAL',id,'REGRAS_OPERACIONAIS_SAC',null,objeto);
    res.json({sucesso:true,id,item:objeto});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.patch('/api/regras-operacionais/:id', requerPerfil('MASTER'), async (req,res)=>{
  try{
    const atual=await atualizarPorID('REGRAS_OPERACIONAIS_SAC',req.params.id,{...req.body,DATA_ATUALIZACAO:new Date().toISOString()},['ID']);
    if(!atual) return res.status(404).json({sucesso:false,erro:'Regra operacional não encontrada.'});
    await registrarAuditoria(req.user?.usuario||'sistema','EDITAR_REGRA_OPERACIONAL',req.params.id,'REGRAS_OPERACIONAIS_SAC',null,req.body||{});
    res.json({sucesso:true,id:req.params.id});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message});}
});

app.get('/api/parametros-logistica', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    let data=await lerAba('PARAMETROS_LOGISTICA',10000);
    if(req.query.uf) data=data.filter(x=>normalizarTexto(x.UF)===normalizarTexto(req.query.uf));
    if(req.query.cidade) data=data.filter(x=>normalizarTexto(x.CIDADE)===normalizarTexto(req.query.cidade));
    if(req.query.ativo) data=data.filter(x=>normalizarTexto(x.ATIVO)===normalizarTexto(req.query.ativo));
    res.json({sucesso:true,total:data.length,itens:data});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.get('/api/parametros-producao', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req,res)=>{
  try{
    let data=await lerAba('PARAMETROS_PRODUCAO',10000);
    if(req.query.tipoProduto) data=data.filter(x=>normalizarTexto(x.TIPO_PRODUTO)===normalizarTexto(req.query.tipoProduto));
    if(req.query.familia) data=data.filter(x=>normalizarTexto(x.FAMILIA_PRODUTO)===normalizarTexto(req.query.familia));
    if(req.query.ativo) data=data.filter(x=>normalizarTexto(x.ATIVO)===normalizarTexto(req.query.ativo));
    res.json({sucesso:true,total:data.length,itens:data});
  }catch(e){res.status(500).json({sucesso:false,erro:e.message,itens:[]});}
});

app.get('/api/conhecimento', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('CONHECIMENTO_SETORES',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/procedimentos', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('PROCEDIMENTOS',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
});
app.get('/api/politicas', requerPerfil('MASTER','ANALISTA SAC','SETOR RESPONSÁVEL','APROVADOR'), async (req, res) => {
  try { const data=await lerAba('POLITICAS',200); res.json({sucesso:true,total:data.length,itens:data}); }
  catch (e) { res.status(500).json({sucesso:false,erro:e.message,dados:[]}); }
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
  try{ const itens=await carregarUsuarios({incluirAcessosCompatibilidade:false}); res.json({sucesso:true,total:itens.length,itens:itens.map(usuarioPublico)}); }
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
  app.listen(PORT, () => console.log(`SAC Chiacchio API v6.0.0 rodando na porta ${PORT}`));
}

module.exports = app;
