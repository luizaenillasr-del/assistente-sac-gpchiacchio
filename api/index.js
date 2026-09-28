const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// ===== SHEETS SERVICE =====
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;

async function getSheets() {
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function lerAba(nomeAba) {
  const sheets = await getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
  });
  const rows = response.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i] || ''; });
    return obj;
  });
}

async function appendLinha(nomeAba, linha) {
  const sheets = await getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: nomeAba,
    valueInputOption: 'RAW',
    resource: { values: [linha] },
  });
}

async function gerarProximoID(nomeAba, prefixo) {
  const dados = await lerAba(nomeAba);
  let max = 0;
  dados.forEach(r => {
    const campo = r.ID_MANIFESTACAO || r.ID_HISTORICO || r.ID || '';
    const match = campo.match(/(\d+)$/);
    if (match) max = Math.max(max, parseInt(match[1]));
  });
  return `${prefixo}-${String(max + 1).padStart(3, '0')}`;
}

// ===== ROTAS =====
app.get('/', (req, res) => {
  res.json({ status: 'ok', versao: '1.0.0', sistema: 'Assistente SAC Chiacchio' });
});

app.get('/api/manifestacoes', async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES');
    res.json({ sucesso: true, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.post('/api/manifestacoes', async (req, res) => {
  try {
    const { empresaReclamada, empresaReclamante, contato, produto, lote, descricao } = req.body;
    if (!empresaReclamada || !empresaReclamante || !contato || !descricao) {
      return res.status(400).json({ sucesso: false, erro: 'Campos obrigatórios faltando.' });
    }
    const id = await gerarProximoID('MANIFESTACOES', 'MAN');
    const linha = [id, new Date().toISOString(), empresaReclamada, empresaReclamante, contato, produto || '', lote || '', descricao, 'EM ANÁLISE'];
    await appendLinha('MANIFESTACOES', linha);
    res.json({ sucesso: true, id });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

app.get('/api/manifestacoes/:id', async (req, res) => {
  try {
    const data = await lerAba('MANIFESTACOES');
    const item = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Não encontrada.' });
    res.json({ sucesso: true, manifestacao: item });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

module.exports = app;
