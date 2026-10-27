'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-canais-integracao-32chars';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
process.env.WHATSAPP_VERIFY_TOKEN = 'verify-token-test';
process.env.WHATSAPP_APP_SECRET = 'app-secret-test';
delete process.env.DATABASE_URL;

const mock = require(process.env.SHEETS_MOCK_PATH);
delete require.cache[require.resolve('../api/index.js')];
const app = require('../api/index.js');
const outer = express();
outer.use(express.static(path.join(__dirname, '../public')));
outer.use(app);

function request(base, route, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const body = options.body ? JSON.stringify(options.body) : '';
    const headers = { ...(options.headers || {}) };
    if (body) { headers['content-type'] = 'application/json'; headers['content-length'] = Buffer.byteLength(body); }
    const req = http.request({ method: options.method || 'GET', hostname: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, headers }, res => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : null }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  const server = http.createServer(outer);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const key = 'portal-test-idempotency-001';
    const payload = {
      origem: 'PORTAL_PUBLICO', idempotencyKey: key,
      empresa: 'CHIACCHIO EMBALAGENS', nomeCliente: 'Cliente Portal Teste',
      email: 'teste@example.com', telefone: '77999999999', tipoCliente: 'direto',
      cnpj: '00.000.000/0001-00', razaoSocial: 'Cliente Portal Teste Ltda',
      produto: 'Produto de teste', motivoManifestacao: 'Qualidade',
      descricaoOriginal: 'Manifestação de teste para validar integração Portal SAC.',
      colaboradorRecebimento: 'Portal do Cliente', setorRecebimento: 'SAC',
      canalRecebimento: 'Portal do Cliente', tipoManifestacao: 'Reclamação', evidencias: [],
    };
    const first = await request(base, '/api/public/reclamacoes', { method: 'POST', body: payload });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.sucesso, true);
    const second = await request(base, '/api/public/reclamacoes', { method: 'POST', body: payload });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    assert.equal(second.body.idempotente, true);
    assert.equal(second.body.id, first.body.id);
    const created = mock.DB.MANIFESTACOES.filter(row => row.IDEMPOTENCY_KEY === key);
    assert.equal(created.length, 1, 'reenvio não pode criar manifestação duplicada');
    assert.equal(mock.DB.FICHAS_BIBLIOTECA.filter(row => row.ID_MANIFESTACAO === first.body.id).length, 1);
    assert.equal(mock.DB.FILA_APROVACAO.filter(row => row.ID_ENTIDADE === first.body.id).length, 1);
    assert.equal(created[0].CIRCA_ANALISE_STATUS, 'CONCLUIDA');

    const webhookPayload = { object: 'whatsapp_business_account', entry: [{ id: 'WABA-1', changes: [{ value: { metadata: { phone_number_id: 'PHONE-1' }, contacts: [{ profile: { name: 'Teste WhatsApp' } }], messages: [{ id: 'wamid.TESTE.001', from: '5577999999999', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'Olá, preciso de ajuda.' } }] } }] }] };
    const raw = JSON.stringify(webhookPayload);
    const sig = `sha256=${crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET).update(raw).digest('hex')}`;
    const wh = await request(base, '/api/public/whatsapp/webhook', { method: 'POST', body: webhookPayload, headers: { 'x-hub-signature-256': sig } });
    assert.equal(wh.status, 200, JSON.stringify(wh.body));
    assert.equal(wh.body.gravados, 1);
    const whRetry = await request(base, '/api/public/whatsapp/webhook', { method: 'POST', body: webhookPayload, headers: { 'x-hub-signature-256': sig } });
    assert.equal(whRetry.body.duplicados, 1);
    assert.equal(mock.DB.WHATSAPP_EVENTOS.filter(row => row.EVENT_ID === 'wamid.TESTE.001').length, 1);
    assert.equal(mock.DB.MANIFESTACOES.filter(row => row.ID_MANIFESTACAO === first.body.id).length, 1, 'WhatsApp não abre manifestação automaticamente');
    console.log('CANAIS: portal idempotente, ficha/fila/CIRCA e webhook WhatsApp com assinatura e deduplicação aprovados.');
  } finally {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
