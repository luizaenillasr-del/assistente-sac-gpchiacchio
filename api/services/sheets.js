const { google } = require('googleapis');

const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getSheets() {
  const client = await auth.getClient();

  return google.sheets({
    version: 'v4',
    auth: client,
  });
}

/**
 * Converte número de coluna para letra A, B, C...
 */
function colunaParaLetra(numero) {
  let resultado = '';

  while (numero > 0) {
    const resto = (numero - 1) % 26;
    resultado = String.fromCharCode(65 + resto) + resultado;
    numero = Math.floor((numero - 1) / 26);
  }

  return resultado;
}

/**
 * Lê uma aba inteira usando a primeira linha como cabeçalho.
 */
async function lerAba(nomeAba) {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  if (rows.length < 2) {
    return [];
  }

  const headers = rows[0];

  return rows.slice(1).map((row, index) => {
    const obj = {};

    headers.forEach((h, i) => {
      obj[h] = row[i] !== undefined ? row[i] : '';
    });

    // Guarda internamente o número real da linha.
    obj.__linha = index + 2;

    return obj;
  });
}

/**
 * Obtém os cabeçalhos de uma aba.
 */
async function obterCabecalhos(nomeAba) {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!1:1`,
  });

  return response.data.values?.[0] || [];
}

/**
 * Adiciona uma linha diretamente.
 */
async function appendLinha(nomeAba, linha) {
  const sheets = await getSheets();

  return sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    resource: {
      values: [linha],
    },
  });
}

/**
 * Adiciona um objeto respeitando os cabeçalhos existentes.
 *
 * Exemplo:
 * appendObjeto('MANIFESTACOES', {
 *   ID_MANIFESTACAO: 'MAN-001',
 *   EMPRESA_RECLAMADA: 'Chiacchio',
 *   DESCRICAO: '...'
 * });
 */
async function appendObjeto(nomeAba, objeto) {
  const headers = await obterCabecalhos(nomeAba);

  if (!headers.length) {
    throw new Error(`A aba "${nomeAba}" não possui cabeçalhos.`);
  }

  const linha = headers.map(header => {
    return objeto[header] !== undefined
      ? objeto[header]
      : '';
  });

  return appendLinha(nomeAba, linha);
}

/**
 * Localiza uma linha pelo ID.
 */
async function encontrarLinhaPorID(nomeAba, id, camposID = []) {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = response.data.values || [];

  if (rows.length < 2) {
    return null;
  }

  const headers = rows[0];

  const campos = camposID.length
    ? camposID
    : [
        'ID_MANIFESTACAO',
        'ID_HISTORICO',
        'ID',
        'PROTOCOLO',
      ];

  const indiceID = campos
    .map(campo => headers.indexOf(campo))
    .find(index => index !== -1);

  if (indiceID === undefined) {
    return null;
  }

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

/**
 * Atualiza uma linha inteira.
 */
async function atualizarLinha(nomeAba, numeroLinha, valores) {
  const sheets = await getSheets();

  const ultimaColuna = colunaParaLetra(valores.length);

  return sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${nomeAba}!A${numeroLinha}:${ultimaColuna}${numeroLinha}`,
    valueInputOption: 'USER_ENTERED',
    resource: {
      values: [valores],
    },
  });
}

/**
 * Atualiza campos específicos de uma linha identificada pelo ID.
 *
 * Exemplo:
 *
 * atualizarPorID(
 *   'MANIFESTACOES',
 *   'MAN-001',
 *   {
 *     STATUS: 'CONCLUÍDA',
 *     CAUSA_RAIZ: 'Falha logística'
 *   }
 * )
 */
async function atualizarPorID(nomeAba, id, dados, camposID = []) {
  const registro = await encontrarLinhaPorID(
    nomeAba,
    id,
    camposID
  );

  if (!registro) {
    throw new Error(
      `Registro "${id}" não encontrado na aba "${nomeAba}".`
    );
  }

  const valores = [...registro.valores];

  registro.headers.forEach((header, index) => {
    if (Object.prototype.hasOwnProperty.call(dados, header)) {
      valores[index] = dados[header];
    }
  });

  return atualizarLinha(
    nomeAba,
    registro.linha,
    valores
  );
}

/**
 * Busca um registro pelo ID e devolve o objeto completo.
 */
async function buscarPorID(nomeAba, id, camposID = []) {
  const registro = await encontrarLinhaPorID(
    nomeAba,
    id,
    camposID
  );

  if (!registro) {
    return null;
  }

  const obj = {};

  registro.headers.forEach((header, index) => {
    obj[header] = registro.valores[index] || '';
  });

  obj.__linha = registro.linha;

  return obj;
}

/**
 * Gera próximo ID.
 */
async function gerarProximoID(nomeAba, prefixo) {
  const dados = await lerAba(nomeAba);

  let max = 0;

  dados.forEach(registro => {
    const campos = [
      registro.ID_MANIFESTACAO,
      registro.ID_HISTORICO,
      registro.ID,
      registro.PROTOCOLO,
    ];

    campos.forEach(campo => {
      if (!campo) return;

      const match = String(campo).match(/(\d+)$/);

      if (match) {
        max = Math.max(
          max,
          parseInt(match[1], 10)
        );
      }
    });
  });

  return `${prefixo}-${String(max + 1).padStart(3, '0')}`;
}

module.exports = {
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
