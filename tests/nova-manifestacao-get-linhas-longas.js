'use strict';

// Regressão do fluxo POST -> GET confirmatório de rascunhos. O Sheets real
// pode conter mais de 5.000 linhas; a ficha recém-criada não pode desaparecer
// apenas por estar além do limite artificial usado anteriormente.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'nova-manifestacao-linhas-longas-secret-32';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

const mock = require('./sheets-mock');
mock.protocoloPrisma.reset();
const id = 'MAN-LONG-5001';
while (mock.DB.MANIFESTACOES.length <= 5000) {
  mock.DB.MANIFESTACOES.push({
    ID_MANIFESTACAO: `MAN-FILL-${mock.DB.MANIFESTACOES.length + 1}`,
    EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS',
    STATUS: 'RASCUNHO',
    DESCRICAO: 'registro sintético de regressão',
  });
}
mock.DB.MANIFESTACOES.push({
  ID_MANIFESTACAO: id,
  EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS',
  EMPRESA_NORMALIZADA: 'CHIACCHIO EMBALAGENS',
  STATUS: 'RASCUNHO',
  STATUS_FICHA: 'RASCUNHO',
  DESCRICAO: 'rascunho além da linha cinco mil',
  DATA_ULTIMA_EDICAO: '2026-11-05T00:00:00.000Z',
});

function token(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')}`;
}
function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }));
    });
    req.on('error', reject); if (body !== undefined) req.write(payload); req.end();
  });
}

(async () => {
  delete require.cache[require.resolve('../api/index')];
  const app = require('../api/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const auth = token({ perfil: 'MASTER', empresa: 'Grupo Chiacchio', usuario: 'master.test', id: 'USR-MST-001' });
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await request(base, 'GET', `/api/manifestacoes/${id}`, auth);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body.manifestacao.ID_MANIFESTACAO, id);
    assert.equal(response.body.manifestacao.DESCRICAO, 'rascunho além da linha cinco mil');
    console.log('✓ GET confirmatório recupera rascunho além da linha 5.000');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
