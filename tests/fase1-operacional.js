'use strict';

// Testes isolados da Fase 1. Usam somente o Sheets mock e removem os registros
// criados antes de sair; nenhum dado real ou ambiente publicado é acessado.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'fase1-operacional-secret-32-caracteres';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

function token(payload) {
  const full = { ...payload, iat: Date.now(), exp: Date.now() + 3600000 };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')}`;
}

function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ method, hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => { let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; } resolve({ status: res.statusCode, body: parsed, headers: res.headers }); });
    });
    req.on('error', reject); if (body !== undefined) req.write(payload); req.end();
  });
}

(async () => {
  const mock = require('./sheets-mock');
  Object.keys(require.cache).filter(k => k.includes('/api/index')).forEach(k => delete require.cache[k]);
  const app = require('../api/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const master = token({ perfil: 'MASTER', empresa: 'Grupo Chiacchio', usuario: 'master.test', id: 'USR-MST-001' });
  const created = [];
  const draftIds = [];
  try {
    const novo = await request(base, 'POST', '/api/usuarios', master, {
      usuario: 'fase1.usuario', email: 'fase1.usuario@example.com', nome: 'Fase 1 Usuario',
      perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', senha: 'Fase1Senha!123', status: 'ATIVO',
    });
    assert.equal(novo.status, 200, JSON.stringify(novo.body));
    const uid = novo.body.usuario.id;
    created.push(uid);

    const edit = await request(base, 'PATCH', `/api/admin/usuarios/${encodeURIComponent(uid)}/permissoes`, master, {
      perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', setor: 'Qualidade', email: 'fase1.usuario@example.com',
      modulosNiveis: { MANIFESTACOES: 2 }, competencias: ['QUALIDADE'],
    });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const row = mock.DB.USUARIOS.find(u => u.ID_USUARIO === uid);
    assert.equal(row.SETOR, 'Qualidade');

    const desativar = await request(base, 'POST', `/api/admin/usuarios/${encodeURIComponent(uid)}/desativar`, master, {});
    assert.equal(desativar.status, 200, JSON.stringify(desativar.body));
    assert.equal(row.STATUS, 'INATIVO');
    const sessaoRevogada = await request(base, 'GET', '/api/manifestacoes', token({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'fase1.usuario' }));
    assert.equal(sessaoRevogada.status, 401);

    const ativar = await request(base, 'POST', `/api/admin/usuarios/${encodeURIComponent(uid)}/ativar`, master, {});
    assert.equal(ativar.status, 200, JSON.stringify(ativar.body));
    assert.equal(row.STATUS, 'ATIVO');

    const semPermissao = await request(base, 'PATCH', `/api/admin/usuarios/${encodeURIComponent(uid)}/permissoes`, token({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'fase1.usuario' }), { setor: 'Financeiro' });
    assert.equal(semPermissao.status, 403);
    const semMotivo = await request(base, 'DELETE', `/api/usuarios/${encodeURIComponent(uid)}`, master, {});
    assert.equal(semMotivo.status, 400);

    const excluir = await request(base, 'DELETE', `/api/usuarios/${encodeURIComponent(uid)}`, master, { motivo: 'Conta criada para homologação da Fase 1.' });
    assert.equal(excluir.status, 200, JSON.stringify(excluir.body));
    assert.equal(row.STATUS, 'EXCLUIDO');
    const excluida = await request(base, 'GET', '/api/manifestacoes', token({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'fase1.usuario' }));
    assert.equal(excluida.status, 401);

    const draft = await request(base, 'POST', '/api/manifestacoes', master, { rascunho: true });
    assert.equal(draft.status, 200, JSON.stringify(draft.body));
    assert.ok(draft.body.id);
    draftIds.push(draft.body.id);
    const full = await request(base, 'POST', '/api/manifestacoes', master, {
      rascunho: true, empresaReclamada: 'CHIACCHIO EMBALAGENS', empresaReclamante: 'Cliente Sintético',
      contato: 'Contato Teste', descricao: 'Descrição sintética para validar o avanço entre as sete etapas.', canal: 'MANUAL',
    });
    assert.equal(full.status, 200, JSON.stringify(full.body));
    const id = full.body.id; draftIds.push(id);
    const statuses = ['EM_TRIAGEM', 'EM_TRATATIVA', 'EM_INVESTIGACAO', 'AGUARDANDO_VALIDACAO_SAC', 'AGUARDANDO_DEVOLUTIVA', 'AGUARDANDO_ENCERRAMENTO'];
    for (let i = 0; i < statuses.length; i++) {
      const saved = await request(base, 'PATCH', `/api/manifestacoes/${encodeURIComponent(id)}/circa-dados`, master, {
        ETAPA_ATUAL: String(i + 2), STATUS: statuses[i], STATUS_FICHA: statuses[i], MENSAGEM_ETAPA: `Etapa ${i + 2}`,
      });
      assert.equal(saved.status, 200, `etapa ${i + 2}: ${JSON.stringify(saved.body)}`);
    }
    const final = await request(base, 'PATCH', `/api/manifestacoes/${encodeURIComponent(id)}/circa-dados`, master, { finalizar: true, ETAPA_ATUAL: '7' });
    assert.equal(final.status, 200, JSON.stringify(final.body));
    console.log('FASE 1: gestão de acessos (CRUD, persistência, exclusão lógica e revogação) e nova manifestação (rascunho, 7 etapas e finalização) aprovados em ambiente isolado.');
  } finally {
    for (const id of created) { const i = mock.DB.USUARIOS.findIndex(u => u.ID_USUARIO === id); if (i >= 0) mock.DB.USUARIOS.splice(i, 1); }
    for (const id of draftIds) { const i = mock.DB.MANIFESTACOES.findIndex(m => m.ID_MANIFESTACAO === id); if (i >= 0) mock.DB.MANIFESTACOES.splice(i, 1); }
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
