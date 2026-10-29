'use strict';

// Valida o contrato real da aba CEREBRO_APRENDIZADO sem qualquer serviço
// externo. O caso é sintético e a base do mock é restaurada ao final.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-learning-contract-32chars';
process.env.SHEETS_MOCK_PATH = path.join(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

const mock = require('./sheets-mock');
const anterior = mock.DB.CEREBRO_APRENDIZADO;
mock.DB.CEREBRO_APRENDIZADO = [{
  ID_CASO: 'CASO-TESTE-1', EMPRESA: 'CHIACCHIO EMBALAGENS',
  TIPO_PROBLEMA: 'Reclamação', TIPO_DESCRICAO: 'Caso aprendido sintético',
  CAUSA_RAIZ: 'Causa validada sintética', DATA_REGISTRO: '2026-10-29',
}];

function token(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 60_000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function request(base, auth) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/cerebro/matriz-operacional?aba=aprimoramentos', base);
    const req = http.request(url, { headers: { Authorization: `Bearer ${auth}` } }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  delete require.cache[require.resolve('../api/index.js')];
  const app = require('../api/index.js');
  const outer = express();
  outer.use(app);
  const server = http.createServer(outer);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await request(`http://127.0.0.1:${server.address().port}`, token({ perfil: 'MASTER', empresa: 'Grupo Chiacchio', usuario: 'master.test' }));
    assert.equal(result.status, 200);
    assert.equal(result.body.total, 1);
    assert.equal(result.body.itens[0].ID_APRIMORAMENTO, 'CASO-TESTE-1');
    assert.equal(result.body.itens[0].DESCRICAO, 'Caso aprendido sintético');
    assert.equal(result.body.itens[0].STATUS, '', 'ausência de status deve permanecer explícita');
    console.log('CIRCA contrato de aprendizado: CEREBRO_APRENDIZADO reconhecido sem inventar status.');
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    if (anterior === undefined) delete mock.DB.CEREBRO_APRENDIZADO;
    else mock.DB.CEREBRO_APRENDIZADO = anterior;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
