'use strict';
/**
 * Audita senhas na aba USUARIOS do Google Sheets.
 * Exibe APENAS contagens — nenhum login, email ou senha é impresso.
 *
 * Uso: node scripts/auditarSenhas.js
 * Requer: GOOGLE_SERVICE_ACCOUNT_JSON e SPREADSHEET_ID nas env vars.
 */

require('dotenv').config();
const { google } = require('googleapis');

async function main() {
  const credRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const spreadsheetId = process.env.SPREADSHEET_ID;
  if (!credRaw || !spreadsheetId) {
    console.error('ERRO: GOOGLE_SERVICE_ACCOUNT_JSON e SPREADSHEET_ID são obrigatórios.');
    process.exit(1);
  }

  const cred = JSON.parse(credRaw);
  const auth = new google.auth.GoogleAuth({ credentials: cred, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] });
  const sheets = google.sheets({ version: 'v4', auth });

  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: 'USUARIOS', valueRenderOption: 'FORMATTED_VALUE' });
  const rows = res.data.values || [];
  if (rows.length < 2) { console.log('Aba USUARIOS vazia ou sem dados.'); return; }

  const headers = rows[0];
  const senhaIdx = headers.findIndex(h => h.toUpperCase() === 'SENHA');
  const statusIdx = headers.findIndex(h => h.toUpperCase() === 'STATUS');

  if (senhaIdx < 0) { console.error('Coluna SENHA não encontrada.'); process.exit(1); }

  let total = 0, ativos = 0, comHash = 0, semPrefixo = 0, vazios = 0;

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const senha = (row[senhaIdx] || '').trim();
    const status = statusIdx >= 0 ? (row[statusIdx] || 'ATIVO').trim().toUpperCase() : 'ATIVO';
    total++;
    if (status !== 'INATIVO') ativos++;
    if (!senha) vazios++;
    else if (senha.startsWith('sha256:')) comHash++;
    else semPrefixo++;
  }

  console.log('\n=== AUDITORIA DE SENHAS — USUARIOS ===\n');
  console.log(`Total de usuários cadastrados : ${total}`);
  console.log(`Usuários ativos               : ${ativos}`);
  console.log(`Com hash sha256:              : ${comHash}`);
  console.log(`Sem prefixo (texto plano)     : ${semPrefixo}`);
  console.log(`Senha vazia                   : ${vazios}`);
  console.log();
  if (semPrefixo > 0) {
    console.log(`⚠️  ${semPrefixo} usuário(s) com senha sem prefixo sha256: — migração necessária.`);
    console.log('   Use scripts/gerarHash.js para gerar o hash e atualize a aba USUARIOS.');
  } else {
    console.log('✓ Todos os usuários com senha usam hash sha256:');
  }
  console.log();
}

main().catch(e => { console.error('Erro:', e.message); process.exit(1); });
