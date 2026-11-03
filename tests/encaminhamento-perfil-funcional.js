'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'encaminhamento-perfil-funcional-secret-32';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

const mock = require('./sheets-mock');
Object.keys(require.cache).filter(k => k.includes('/api/index')).forEach(k => delete require.cache[k]);
const app = require('../api/index');

function token(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')}`;
}

function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { Authorization: `Bearer ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => { let parsed = {}; try { parsed = JSON.parse(raw); } catch (_) {} resolve({ status: res.statusCode, body: parsed }); });
    });
    req.on('error', reject); req.end(payload);
  });
}

(async () => {
  const originalManifestacao = mock.DB.MANIFESTACOES.find(r => r.ID_MANIFESTACAO === 'MAN-CHI-001');
  const manifestacaoSnapshot = { ...originalManifestacao };
  const acionamentosSnapshot = (mock.DB.ACIONAMENTOS_INTERNOS || []).slice();
  const notificacoesSnapshot = (mock.DB.NOTIFICACOES_INTERNAS || []).slice();
  const historicoSnapshot = (mock.DB.HISTORICO || []).slice();
  const auditoriaSnapshot = (mock.DB.LOG_SISTEMA || []).slice();
  const karol = { ID_USUARIO: 'USR-KAROL-SINT', USUARIO: 'karol.sintetica', NOME: 'Karol Sintética', PERFIL: 'APROVADOR_SETORIAL', PERFIL_FUNCIONAL: 'APROVADOR_SETORIAL', NIVEL_HIERARQUICO: 'SUPERVISOR', EMPRESA: 'CHIACCHIO EMBALAGENS, PLASCHIO, TUBAHIA', SETOR: 'Logística', STATUS: 'ATIVO' };
  mock.DB.USUARIOS.push(karol);
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sac = token({ perfil: 'MASTER', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'master.test', id: 'USR-MST-001' });
  try {
    const payload = { acao: 'encaminhar_setor', SETOR_CONFIRMADO: 'Logística', RESPONSAVEL_SETOR: karol.USUARIO, RESPONSAVEL_SETOR_ID: karol.ID_USUARIO, prazoSlaHoras: 72, obs: 'Investigar atraso logístico.', idempotencyKey: 'TESTE-PERFIL-FUNCIONAL-001' };
    const resposta = await request(base, 'PATCH', '/api/manifestacoes/MAN-CHI-001/ficha', sac, payload);
    assert.equal(resposta.status, 200, JSON.stringify(resposta.body));
    const frente = (mock.DB.ACIONAMENTOS_INTERNOS || []).find(r => r.IDEMPOTENCY_KEY === payload.idempotencyKey);
    assert.ok(frente, 'a frente deve ser persistida');
    assert.equal(frente.RESPONSAVEL_ID, karol.ID_USUARIO);
    assert.equal(frente.SETOR_DESTINO, 'Logística');
    assert.equal(frente.PRAZO_ORIGEM, 'SLA_RETORNO_SETOR_72H');
    const prazoInvalido = await request(base, 'PATCH', '/api/manifestacoes/MAN-CHI-001/ficha', sac, { ...payload, idempotencyKey: 'TESTE-PERFIL-FUNCIONAL-002', prazoSlaHoras: 'data-inválida' });
    assert.equal(prazoInvalido.status, 400);
    assert.equal(prazoInvalido.body.codigo, 'PRAZO_INVALIDO');
    console.log('ENCAMINHAMENTO PERFIL FUNCIONAL: SAC → APROVADOR_SETORIAL persistido sem HTTP 500 e prazo inválido rejeitado.');
  } finally {
    Object.assign(originalManifestacao, manifestacaoSnapshot);
    mock.DB.USUARIOS.splice(mock.DB.USUARIOS.indexOf(karol), 1);
    mock.DB.ACIONAMENTOS_INTERNOS = acionamentosSnapshot;
    mock.DB.NOTIFICACOES_INTERNAS = notificacoesSnapshot;
    mock.DB.HISTORICO = historicoSnapshot;
    mock.DB.LOG_SISTEMA = auditoriaSnapshot;
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
