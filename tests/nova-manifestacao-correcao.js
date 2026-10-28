'use strict';

// Regressão isolada do fluxo Nova Manifestação. Não usa Vercel, Neon, Drive ou
// Google Sheets: o backend é executado contra o mock local.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'nova-manifestacao-correcao-secret-32';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('res.protocolo || res.id'), 'a tela deve exibir o protocolo oficial retornado pelo backend');
assert.ok(html.includes('/api/manifestacoes/${encodeURIComponent(technicalId)}/evidencias'), 'a ficha deve recuperar anexos pelo identificador técnico');
assert.ok(html.includes('Preencha os campos obrigatórios:'), 'a navegação deve informar campos obrigatórios pendentes');
assert.ok(html.includes('nmTextoEstruturado'), 'valores estruturados do Cérebro devem ser normalizados antes da exibição');

function token(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')}`;
}

function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ method, hostname:url.hostname, port:url.port, path:url.pathname + url.search,
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload), Authorization:`Bearer ${auth}` } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => { let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; } resolve({ status:res.statusCode, body:parsed }); });
    });
    req.on('error', reject); if (body !== undefined) req.write(payload); req.end();
  });
}

(async () => {
  const mock = require('./sheets-mock');
  mock.protocoloPrisma.reset();
  Object.keys(require.cache).filter(k => k.includes('/api/index')).forEach(k => delete require.cache[k]);
  const app = require('../api/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const master = token({ perfil:'MASTER', empresa:'Grupo Chiacchio', usuario:'master.test', id:'USR-MST-001' });
  const key = 'NOVA-CORRECAO-001';
  let createdId = '';
  try {
    const analise = await request(base, 'POST', '/api/analise', master, {
      descricao:'A embalagem chegou danificada e o cliente solicita retorno.', tipo:'Reclamação',
      empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Cliente Teste', produto:'Caixa',
      canal:'E-mail', nfe:'NF-123', quantidade:'2', nome:'Contato Teste', email:'contato@example.test',
    });
    assert.equal(analise.status, 200, JSON.stringify(analise.body));
    const ausentes = analise.body.analise?.informacoesAusentes || [];
    assert.ok(!ausentes.includes('DESCRICAO'), 'descrição preenchida não pode aparecer como ausente');
    assert.ok(!ausentes.includes('EMPRESA_RECLAMADA'), 'empresa preenchida não pode aparecer como ausente');
    assert.ok(!ausentes.includes('CANAL'), 'canal preenchido não pode aparecer como ausente');

    const anexo = { nome:'evidencia.txt', mimeType:'image/png', tamanho:3, categoria:'EVIDENCIA', dataBase64:'data:image/png;base64,AQID' };
    const criado = await request(base, 'POST', '/api/manifestacoes', master, {
      idempotencyKey:key, empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Cliente Teste',
      contato:'Contato Teste', descricao:'Relato completo para registrar uma reclamação.', tipo:'Reclamação',
      canal:'E-mail', anexos:[anexo], analiseIA:JSON.stringify({ tipoDetectado:'Reclamação', devolutivaSugerida:'Recebemos seu relato e iniciaremos a apuração.' }),
    });
    assert.equal(criado.status, 200, JSON.stringify(criado.body));
    createdId = criado.body.id;
    assert.match(criado.body.protocolo, /^CHIA-\d{8}-[A-Z0-9]{2}-\d{4}$/, 'protocolo oficial deve ser exibido');
    const row = mock.DB.MANIFESTACOES.find(r => r.ID_MANIFESTACAO === criado.body.id);
    assert.equal(row.STATUS, 'AGUARDANDO_TRIAGEM_SAC');
    assert.equal(row.PROTOCOLO, criado.body.protocolo);
    assert.ok(!String(row.ANEXOS).includes('dataBase64'), 'Base64 não pode ser gravado na ficha');
    assert.ok(String(row.ANEXOS).includes('evidencia.txt'), 'metadado do anexo deve permanecer vinculado');

    const recuperada = await request(base, 'GET', `/api/manifestacoes/${encodeURIComponent(criado.body.id)}`, master);
    assert.equal(recuperada.status, 200, JSON.stringify(recuperada.body));
    assert.ok(String(recuperada.body.manifestacao?.ANALISE_IA || '').includes('tipoDetectado'), 'análise deve permanecer recuperável na ficha');
    const evidencias = await request(base, 'GET', `/api/manifestacoes/${encodeURIComponent(criado.body.id)}/evidencias`, master);
    assert.equal(evidencias.status, 200, JSON.stringify(evidencias.body));
    assert.ok(evidencias.body.itens.some(item => item.nome === 'evidencia.txt'), 'anexo deve ser recuperável pelo protocolo interno');

    const repetido = await request(base, 'POST', '/api/manifestacoes', master, {
      idempotencyKey:key, empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Outro cliente',
      contato:'Outro contato', descricao:'Tentativa repetida não deve criar segunda ficha.', canal:'E-mail',
    });
    assert.equal(repetido.status, 200);
    assert.equal(repetido.body.id, criado.body.id);
    assert.equal(mock.DB.MANIFESTACOES.filter(r => r.ID_MANIFESTACAO === criado.body.id).length, 1);
    console.log('Nova manifestação: análise com campos completos, salvamento sem HTTP 500, protocolo oficial único, triagem e anexo sem Base64 na ficha aprovados.');
  } finally {
    const i = mock.DB.MANIFESTACOES.findIndex(r => r.ID_MANIFESTACAO === createdId);
    if (i >= 0) mock.DB.MANIFESTACOES.splice(i, 1);
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
