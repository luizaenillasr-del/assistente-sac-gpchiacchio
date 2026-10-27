const { google } = require('googleapis');

// Injeção explícita somente para testes isolados; produção nunca define esta variável.
const _mock = process.env.SHEETS_MOCK_PATH ? (() => {
  try { return require(process.env.SHEETS_MOCK_PATH); } catch (_) { return null; }
})() : null;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const _readInFlight = new Map();

async function withReadRetry(operation, tentativas = 3) {
  let espera = 500;
  for (let i = 0; i < tentativas; i++) {
    try { return await operation(); } catch (e) {
      const status = e?.response?.status || e?.code;
      if (![429, 503].includes(Number(status)) || i === tentativas - 1) throw e;
      const atraso = espera + Math.floor(Math.random() * Math.max(100, espera * 0.25));
      await new Promise(resolve => setTimeout(resolve, atraso));
      espera = Math.min(4000, espera * 2);
    }
  }
}

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

async function getSheets() {
  const client = await getAuth().getClient();
  return google.sheets({ version: 'v4', auth: client });
}

function colunaParaLetra(numero) {
  let resultado = '';
  while (numero > 0) {
    const resto = (numero - 1) % 26;
    resultado = String.fromCharCode(65 + resto) + resultado;
    numero = Math.floor((numero - 1) / 26);
  }
  return resultado;
}

async function obterCabecalhos(nomeAba) {
  if (_mock?.obterCabecalhos) return _mock.obterCabecalhos(nomeAba);
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!1:1`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return response.data.values?.[0] || [];
}

async function lerAba(nomeAba, maxRows) {
  if (_mock?.lerAba) return _mock.lerAba(nomeAba, maxRows);
  const key = `${nomeAba}|${maxRows || ''}`;
  if (_readInFlight.has(key)) return _readInFlight.get(key);
  const leitura = (async () => {
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:AZ${maxRows}` : `${nomeAba}!A:AZ`;
  const response = await withReadRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  }));
  const rows = response.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row,index)=>{
    const obj={};
    headers.forEach((h,i)=>{ if(h) obj[h]=row[i] ?? ''; });
    obj.__linha=index+2;
    return obj;
  });
  })();
  _readInFlight.set(key, leitura);
  try { return await leitura; }
  finally { if (_readInFlight.get(key) === leitura) _readInFlight.delete(key); }
}

async function appendLinha(nomeAba, linha) {
  if (_mock?.appendLinha) return _mock.appendLinha(nomeAba, linha);
  const sheets = await getSheets();
  return sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [linha] },
  });
}

async function appendObjeto(nomeAba,objeto){
  if (_mock?.appendObjeto) return _mock.appendObjeto(nomeAba, objeto);
  const headers=await obterCabecalhos(nomeAba);
  if(!headers.length) throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  const linha=headers.map(h=>objeto[h]!==undefined?objeto[h]:'');
  await appendLinha(nomeAba,linha);
  return linha;
}

async function encontrarLinhaPorID(nomeAba,id,campoIds=['ID_MANIFESTACAO','ID_RNC','ID_HISTORICO','ID','PROTOCOLO']){
  if (_mock?.encontrarLinhaPorID) return _mock.encontrarLinhaPorID(nomeAba, id, campoIds);
  const sheets=await getSheets();
  const response=await sheets.spreadsheets.values.get({spreadsheetId:SPREADSHEET_ID,range:nomeAba,valueRenderOption:'FORMATTED_VALUE'});
  const rows=response.data.values||[];
  if(rows.length<2)return null;
  const headers=rows[0];
  const idIdxs=campoIds.map(c=>headers.indexOf(c)).filter(i=>i>=0);
  for(let i=1;i<rows.length;i++){
    if(idIdxs.some(j=>String(rows[i][j]||'').trim()===String(id).trim())) return {linha:i+1,headers,valores:rows[i]};
  }
  return null;
}

async function atualizarPorID(nomeAba,id,dados,campoIds){
  if (_mock?.atualizarPorID) return _mock.atualizarPorID(nomeAba, id, dados, campoIds);
  const reg=await encontrarLinhaPorID(nomeAba,id,campoIds);
  if(!reg) return null;
  const valores=[...reg.valores];
  reg.headers.forEach((h,i)=>{if(Object.prototype.hasOwnProperty.call(dados,h)) valores[i]=dados[h];});
  const sheets=await getSheets();
  const fim=colunaParaLetra(valores.length);
  await sheets.spreadsheets.values.update({spreadsheetId:SPREADSHEET_ID,range:`${nomeAba}!A${reg.linha}:${fim}${reg.linha}`,valueInputOption:'USER_ENTERED',resource:{values:[valores]}});
  return {linha:reg.linha,valores};
}

async function buscarPorID(nomeAba,id,campoIds){
  if (_mock?.buscarPorID) return _mock.buscarPorID(nomeAba, id, campoIds);
  const reg=await encontrarLinhaPorID(nomeAba,id,campoIds);
  if(!reg)return null;
  const obj={}; reg.headers.forEach((h,i)=>obj[h]=reg.valores[i]||''); obj.__linha=reg.linha; return obj;
}

async function gerarProximoID(nomeAba,prefixo,campoID){
  if (_mock?.gerarProximoID) return _mock.gerarProximoID(nomeAba, prefixo, campoID);
  const dados=await lerAba(nomeAba,5000); let max=0;
  dados.forEach(r=>{const c=(campoID&&r[campoID])||r.ID_MANIFESTACAO||r.ID_RNC||r.ID_VALIDACAO||r.ID||''; const m=String(c).match(/(\d+)$/); if(m)max=Math.max(max,parseInt(m[1],10));});
  return `${prefixo}-${String(max+1).padStart(4,'0')}`;
}

async function garantirAbaComCabecalhos(nomeAba, headers) {
  if (_mock?.garantirAbaComCabecalhos) return _mock.garantirAbaComCabecalhos(nomeAba, headers);
  const sheets = await getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const existe = meta.data.sheets?.find(s => s.properties?.title === nomeAba);
  if (!existe) {
    await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, resource: { requests: [{ addSheet: { properties: { title: nomeAba } } }] } });
  }
  const atual = await obterCabecalhos(nomeAba);
  const faltantes = headers.filter(h => !atual.includes(h));
  if (faltantes.length) {
    const todos = [...atual, ...faltantes];
    await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${nomeAba}!A1:${colunaParaLetra(todos.length)}1`, valueInputOption: 'RAW', resource: { values: [todos] } });
  }
  return await obterCabecalhos(nomeAba);
}

module.exports={getAuth,getSheets,obterCabecalhos,lerAba,appendLinha,appendObjeto,encontrarLinhaPorID,atualizarPorID,buscarPorID,gerarProximoID,garantirAbaComCabecalhos};
