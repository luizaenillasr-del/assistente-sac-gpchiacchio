'use strict';

// Regressão do caminho de autenticação. Usa somente o Sheets mock e não toca
// em usuários, credenciais ou banco de qualquer ambiente real.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'auth-resilience-test-secret-32-chars';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.PG_LEITURA_ATIVA = 'false';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

const apiSource = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8');
const connectionSource = fs.readFileSync(path.resolve(__dirname, '../database/connection.js'), 'utf8');
assert.match(apiSource, /PostgreSQL.*fonte primária de autenticação/s);
assert.match(connectionSource, /connection_limit/);
assert.match(connectionSource, /pool_timeout/);
assert.match(connectionSource, /connect_timeout/);

const mock = require('./sheets-mock');
for (const key of Object.keys(require.cache)) {
  if (key.includes(`${path.sep}api${path.sep}index`)) delete require.cache[key];
}
const app = require('../api/index');

function request(base, body) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/auth/login', base);
    const payload = JSON.stringify(body);
    const req = http.request({ method: 'POST', hostname: url.hostname, port: url.port, path: url.pathname,
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => { let parsed = {}; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', reject); req.end(payload);
  });
}

(async () => {
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const originalRead = mock.lerAba;
  try {
    const valid = await request(base, { usuario: 'ana.chiacchio', senha: 'senhaChia' });
    assert.equal(valid.status, 200, JSON.stringify(valid.body));
    assert.equal(valid.body.sucesso, true);

    const wrong = await request(base, { usuario: 'ana.chiacchio', senha: 'senha-incorreta' });
    assert.equal(wrong.status, 401, 'senha incorreta deve ser rejeitada sem erro 500');

    let quota = true;
    mock.lerAba = async (nome, max) => {
      if (quota && nome === 'USUARIOS') {
        const e = new Error('Quota exceeded'); e.response = { status: 429 }; throw e;
      }
      return originalRead.call(mock, nome, max);
    };
    const blocked = await request(base, { usuario: 'ana.chiacchio', senha: 'senhaChia' });
    assert.ok([401, 429, 503].includes(blocked.status), `quota não pode virar sucesso ou 500: ${blocked.status}`);
    assert.notEqual(blocked.status, 500);
    quota = false;
    const recovered = await request(base, { usuario: 'ana.chiacchio', senha: 'senhaChia' });
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));

    mock.lerAba = originalRead;
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => request(base, { usuario: 'ana.chiacchio', senha: 'senhaChia' })));
    assert.ok(concurrent.every(r => r.status === 200), concurrent.map(r => r.status).join(','));
    console.log('Autenticação: login válido, senha incorreta, quota 429, recuperação e concorrência aprovados.');
  } finally {
    mock.lerAba = originalRead;
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

