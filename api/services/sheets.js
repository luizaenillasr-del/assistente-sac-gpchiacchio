const { google } = require('googleapis');

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

function getAuth() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
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
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!1:1`,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return response.data.values?.[0] || [];
}

async function lerAba(nomeAba, maxRows) {
  const sheets = await getSheets();
  const range = maxRows ? `${nomeAba}!A1:AZ${maxRows}` : `${nomeAba}!A:AZ`;
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const rows = response.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row,index)=>{
    const obj={};
    headers.forEach((h,i)=>{ if(h) obj[h]=row[i] ?? ''; });
    obj.__linha=index+2;
    return obj;
  });
}

async function appendLinha(nomeAba, linha) {
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
  const headers=await obterCabecalhos(nomeAba);
  if(!headers.length) throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  const linha=headers.map(h=>objeto[h]!==undefined?objeto[h]:'');
  await appendLinha(nomeAba,linha);
  return linha;
}

async function encontrarLinhaPorID(nomeAba,id,campoIds=['ID_MANIFESTACAO','ID_RNC','ID_HISTORICO','ID','PROTOCOLO']){
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
  const reg=await encontrarLinhaPorID(nomeAba,id,campoIds);
  if(!reg)return null;
  const obj={}; reg.headers.forEach((h,i)=>obj[h]=reg.valores[i]||''); obj.__linha=reg.linha; return obj;
}

async function gerarProximoID(nomeAba,prefixo,campoID){
  const dados=await lerAba(nomeAba,5000); let max=0;
  dados.forEach(r=>{const c=(campoID&&r[campoID])||r.ID_MANIFESTACAO||r.ID_RNC||r.ID_VALIDACAO||r.ID||''; const m=String(c).match(/(\d+)$/); if(m)max=Math.max(max,parseInt(m[1],10));});
  return `${prefixo}-${String(max+1).padStart(4,'0')}`;
}

async function garantirAbaComCabecalhos(nomeAba, headers) {
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
