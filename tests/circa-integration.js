'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

const SECRET = 'test-secret-for-circa-integration-32chars';
const MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = SECRET;
process.env.SHEETS_MOCK_PATH = MOCK_PATH;
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

function token(payload) {
  const full = { ...payload, iat: Date.now(), exp: Date.now() + 60_000 };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function request(baseUrl, route, auth) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, baseUrl);
    const req = http.request({ hostname: url.hostname, port: url.port, path: url.pathname, headers: auth ? { Authorization: `Bearer ${auth}` } : {} }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on('error', reject);
    req.end();
  });
}

(async () => {
  const mock = require(MOCK_PATH);
  delete require.cache[require.resolve('../api/index.js')];
  const app = require('../api/index.js');
  const before = JSON.stringify(mock.DB);
  const outer = express();
  outer.use(express.static(path.join(__dirname, '../public')));
  outer.use(app);
  const server = http.createServer(outer);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const chi = token({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'ana.chiacchio' });
  const pla = token({ perfil: 'ANALISTA SAC', empresa: 'PLASCHIO', usuario: 'joao.plaschio' });

  try {
    const unauthorized = await request(base, '/api/manifestacoes/MAN-CHI-001/circa');
    assert.equal(unauthorized.status, 401, 'CIRCA exige sessão autenticada');

    const denied = await request(base, '/api/manifestacoes/MAN-CHI-001/circa', pla);
    assert.equal(denied.status, 403, 'CIRCA respeita o escopo de empresa');

    const ok = await request(base, '/api/manifestacoes/MAN-CHI-001/circa', chi);
    assert.equal(ok.status, 200, `CIRCA deveria responder 200: ${JSON.stringify(ok.body)}`);
    assert.equal(ok.body.sucesso, true);
    assert.equal(ok.body.circa.deterministico, true);
    assert.equal(ok.body.circa.idManifestacao, 'MAN-CHI-001');
    assert.deepEqual(Object.keys(ok.body.circa.etapas), ['captura', 'investigacao', 'resolucao', 'conhecimento', 'aprimoramento']);
    assert.equal(ok.body.circa.governanca.exigeAprovacaoHumana, true);
    assert.equal(ok.body.circa.governanca.promoverAutomaticamente, undefined);
    assert.equal(JSON.stringify(mock.DB), before, 'consulta CIRCA não deve gravar dados');

    console.log('CIRCA integração: autenticação, escopo empresarial, etapas determinísticas e consulta sem gravação aprovados.');
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
