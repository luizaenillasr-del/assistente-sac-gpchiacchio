const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getSheets() {
  const client = await auth.getClient();
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
  const range = maxRows ? `${nomeAba}!A1:Z${maxRows}` : nomeAba;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return [];

  const headers = rows[0];

  return rows.slice(1).map((row, index) => {
    const obj = {};
    headers.forEach((h, i) => {
      if (h) obj[h] = row[i] !== undefined ? row[i] : '';
    });
    obj.__linha = index + 2;
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

async function appendObjeto(nomeAba, objeto) {
  const headers = await obterCabecalhos(nomeAba);
  if (!headers.length) {
    throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  }

  const linha = headers.map(header =>
    objeto[header] !== undefined ? objeto[header] : ''
  );

  return appendLinha(nomeAba, linha);
}

async function encontrarLinhaPorID(nomeAba, id, camposID = []) {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];
  if (rows.length < 2) return null;

  const headers = rows[0];

  const campos = camposID.length
    ? camposID
    : ['ID_MANIFESTACAO', 'ID_HISTORICO', 'ID', 'PROTOCOLO'];

  const indiceID = campos
    .map(campo => headers.indexOf(campo))
    .find(index => index !== -1);

  if (indiceID === undefined) return null;

  for (let i = 1; i < rows.length; i++) {
    if (String(rows[i][indiceID] || '').trim() === String(id).trim()) {
      return {
        linha: i + 1,
        headers,
        valores: rows[i],
      };
    }
  }

  return null;
}

async function atualizarLinha(nomeAba, numeroLinha, valores) {
  const sheets = await getSheets();
  const ultimaColuna = colunaParaLetra(valores.length);

  return sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!A${numeroLinha}:${ultimaColuna}${numeroLinha}`,
    valueInputOption: 'USER_ENTERED',
    resource: { values: [valores] },
  });
}

async function atualizarPorID(nomeAba, id, dados, camposID = []) {
  const registro = await encontrarLinhaPorID(nomeAba, id, camposID);

  if (!registro) {
    throw new Error(`Registro "${id}" não encontrado na aba "${nomeAba}".`);
  }

  const valores = [...registro.valores];

  registro.headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(dados, header)) {
      valores[index] = dados[header];
    }
  });

  return atualizarLinha(nomeAba, registro.linha, valores);
}

async function buscarPorID(nomeAba, id, camposID = []) {
  const registro = await encontrarLinhaPorID(nomeAba, id, camposID);
  if (!registro) return null;

  const obj = {};
  registro.headers.forEach((header, index) => {
    obj[header] = registro.valores[index] || '';
  });
  obj.__linha = registro.linha;
  return obj;
}

async function gerarProximoID(nomeAba, prefixo, campoID) {
  const dados = await lerAba(nomeAba, 5000);
  let max = 0;

  dados.forEach(r => {
    const campo =
      (campoID && r[campoID]) ||
      r.ID_MANIFESTACAO ||
      r.ID_HISTORICO ||
      r.ID_VALIDACAO ||
      r.ID ||
      '';

    const match = String(campo).match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1], 10));
  });

  return `${prefixo}-${String(max + 1).padStart(3, '0')}`;
}

module.exports = {
  getSheets,
  lerAba,
  obterCabecalhos,
  appendLinha,
  appendObjeto,
  encontrarLinhaPorID,
  atualizarLinha,
  atualizarPorID,
  buscarPorID,
  gerarProximoID,
};
