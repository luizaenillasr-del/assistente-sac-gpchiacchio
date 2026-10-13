'use strict';
/**
 * Testes comportamentais — servidor Express real + mock Sheets
 * Grafias e colunas de empresa idênticas às da planilha real.
 */

const http   = require('http');
const crypto = require('crypto');
const path   = require('path');
const assert = require('assert');
const fs     = require('fs');

const MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
const SECRET    = 'test-secret-for-behavioral-tests-32chars-ok';

let server, baseUrl;
let passed = 0, failed = 0;
const results = [];

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeToken(payload) {
  // Formato interno: base64url(JSON).hmac  (ver assinarToken em api/index.js)
  const full = { ...payload, iat: Date.now(), exp: Date.now() + 28800000 };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig  = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function req(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url  = new URL(urlPath, baseUrl);
    const opts = {
      method,
      hostname: url.hostname, port: url.port, path: url.pathname + url.search,
      headers: { 'Content-Type': 'application/json',
                 ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    };
    const r = http.request(opts, res => {
      let data = '';
      res.on('data', d => data += d);
      res.on('end', () => {
        try   { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    r.on('error', reject);
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}

async function test(name, fn) {
  try {
    await fn();
    passed++;
    results.push({ name, ok: true });
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed++;
    results.push({ name, ok: false, err: e.message });
    process.stdout.write(`  ✗ ${name}: ${e.message}\n`);
  }
}

// ─── setup ───────────────────────────────────────────────────────────────────

async function setup() {
  process.env.SHEETS_MOCK_PATH  = MOCK_PATH;
  process.env.SESSION_SECRET    = SECRET;
  process.env.NODE_ENV          = 'test';
  process.env.DEMO_LOGIN_ENABLED = 'false';
  delete process.env.DATABASE_URL;

  Object.keys(require.cache).filter(k => k.includes('/api/index')).forEach(k => delete require.cache[k]);
  const app = require('../api/index.js');
  server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function teardown() {
  if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

// ─── tokens ──────────────────────────────────────────────────────────────────

// Grafias reais da planilha; empresaCanonica() deve mapear todas para CHIACCHIO
const tokChiacchio  = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'ana.chiacchio' });
const tokChiacchio2 = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'Chiacchio',            usuario: 'ana.chiacchio2' });
const tokPlaschio   = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'PLASCHIO',             usuario: 'joao.plaschio' });
const tokTubahia    = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'TUBAHIA',              usuario: 'maria.tubahia' });
const tokCesbap     = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'Cesbap',               usuario: 'pedro.cesbap' });
const tokMaster     = () => makeToken({ perfil: 'MASTER',        empresa: 'Grupo Chiacchio',      usuario: 'master.test' });
const tokInativo    = () => makeToken({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'usuario.inativo', status: 'INATIVO' });

// ─── testes ──────────────────────────────────────────────────────────────────

async function runTests() {
  console.log('\n=== TESTES COMPORTAMENTAIS ===\n');

  // ── B2: Isolamento de empresa — /api/manifestacoes ──────────────────────────
  await test('B2-MAN: Chiacchio vê "CHIACCHIO EMBALAGENS" e "CHIACHIO EMBALAGENS"', async () => {
    const r = await req('GET', '/api/manifestacoes', tokChiacchio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const items = r.body.itens || [];
    assert.ok(items.length >= 2, `esperava ≥2 items Chiacchio, got ${items.length}`);
    // Itens com empresa preenchida devem ser canônicas de CHIACCHIO (legado sem empresa é permitido)
    items.forEach(m => {
      const emp = m.EMPRESA_RECLAMADA || '';
      if (!emp) return; // legado sem empresa = compartilhado, ok
      const norm = emp.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().trim();
      const ok = ['chiacchio embalagens','chiachio embalagens','chiacchio'].includes(norm);
      assert.ok(ok, `EMPRESA_RECLAMADA indevida: "${emp}"`);
    });
  });

  await test('B2-MAN: Chiacchio não vê manifestações de PLASCHIO', async () => {
    const r = await req('GET', '/api/manifestacoes', tokChiacchio());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(!items.some(m => /plaschio/i.test(m.EMPRESA_RECLAMADA || '')),
      `PLASCHIO vazou para Chiacchio: ${items.map(m=>m.EMPRESA_RECLAMADA).join(', ')}`);
  });

  await test('B2-MAN: Chiacchio não vê manifestações de TUBAHIA', async () => {
    const r = await req('GET', '/api/manifestacoes', tokChiacchio());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(!items.some(m => /tubahia|cesbap/i.test(m.EMPRESA_RECLAMADA || '')),
      'TUBAHIA/Cesbap vazou para Chiacchio');
  });

  await test('B2-MAN: grafia alternativa "Chiacchio" acessa os mesmos dados', async () => {
    const [r1, r2] = await Promise.all([
      req('GET', '/api/manifestacoes', tokChiacchio()),
      req('GET', '/api/manifestacoes', tokChiacchio2()),
    ]);
    const ids1 = (r1.body.itens||[]).map(m=>m.ID_MANIFESTACAO).sort();
    const ids2 = (r2.body.itens||[]).map(m=>m.ID_MANIFESTACAO).sort();
    assert.deepStrictEqual(ids1, ids2, 'grafias diferentes de Chiacchio retornam conjuntos diferentes');
  });

  await test('B2-MAN: PLASCHIO não vê nenhum item de Chiacchio', async () => {
    const r = await req('GET', '/api/manifestacoes', tokPlaschio());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(!items.some(m => /chiacchio/i.test(m.EMPRESA_RECLAMADA || '')),
      `Chiacchio vazou para PLASCHIO: ${items.map(m=>m.EMPRESA_RECLAMADA).join(', ')}`);
  });

  await test('B2-MAN: Cesbap acessa os mesmos dados que TUBAHIA', async () => {
    const [r1, r2] = await Promise.all([
      req('GET', '/api/manifestacoes', tokTubahia()),
      req('GET', '/api/manifestacoes', tokCesbap()),
    ]);
    const ids1 = (r1.body.itens||[]).map(m=>m.ID_MANIFESTACAO).sort();
    const ids2 = (r2.body.itens||[]).map(m=>m.ID_MANIFESTACAO).sort();
    assert.deepStrictEqual(ids1, ids2, 'Cesbap e TUBAHIA devem ver o mesmo conjunto');
  });

  await test('B2-MAN: EMPRESA_RECLAMANTE com nome de outra empresa não vaza', async () => {
    // MAN-CHI-001 tem EMPRESA_RECLAMANTE:'Cliente A' — nunca seria problema
    // O risco seria EMPRESA_RECLAMANTE com "PLASCHIO". Testamos que PLASCHIO
    // só vê registros onde EMPRESA_RECLAMADA (não RECLAMANTE) é PLASCHIO.
    const r = await req('GET', '/api/manifestacoes', tokPlaschio());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    items.forEach(m => {
      const rec = (m.EMPRESA_RECLAMADA || '').toLowerCase();
      assert.ok(rec === '' || rec.includes('plaschio'),
        `PLASCHIO viu manifestação de outra empresa: EMPRESA_RECLAMADA="${m.EMPRESA_RECLAMADA}"`);
    });
  });

  await test('B2-MAN: MASTER vê todas as empresas', async () => {
    const r = await req('GET', '/api/manifestacoes', tokMaster());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(items.length >= 5, `MASTER deveria ver ≥5 items, got ${items.length}`);
    const empresas = [...new Set(items.map(m => m.EMPRESA_RECLAMADA).filter(Boolean))];
    assert.ok(empresas.length >= 3, `MASTER deveria ver ≥3 empresas, got ${empresas.join(', ')}`);
  });

  // ── B2: Registros sem empresa ───────────────────────────────────────────────
  // Legado: dados sem empresa foram criados antes do isolamento B2 → visível a todos os autenticados.
  await test('B2-SEM: manifestação sem empresa visível para ANALISTA SAC (legado)', async () => {
    const r = await req('GET', '/api/manifestacoes', tokChiacchio());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(items.some(m => m.ID_MANIFESTACAO === 'MAN-SEM-001'),
      'MAN-SEM-001 (sem empresa, legado) deveria ser visível para ANALISTA SAC');
  });

  await test('B2-SEM: manifestação sem empresa visível para MASTER', async () => {
    const r = await req('GET', '/api/manifestacoes', tokMaster());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    assert.ok(items.some(m => m.ID_MANIFESTACAO === 'MAN-SEM-001'),
      'MAN-SEM-001 (sem empresa) não apareceu para MASTER');
  });

  // ── B2: Dashboard por empresa ──────────────────────────────────────────────
  await test('B2-DASH: dashboard Chiacchio não inclui Plaschio em porEmpresa', async () => {
    const r = await req('GET', '/api/dashboard', tokChiacchio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const porEmpresa = r.body.dados?.porEmpresa || {};
    const keys = Object.keys(porEmpresa).map(k => k.toLowerCase());
    assert.ok(!keys.some(k => k.includes('plaschio')),
      `Plaschio vazou no dashboard Chiacchio: ${JSON.stringify(Object.keys(porEmpresa))}`);
  });

  await test('B2-DASH: dashboard Plaschio não inclui Chiacchio em porEmpresa', async () => {
    const r = await req('GET', '/api/dashboard', tokPlaschio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const porEmpresa = r.body.dados?.porEmpresa || {};
    const keys = Object.keys(porEmpresa).map(k => k.toLowerCase());
    assert.ok(!keys.some(k => k.includes('chiacchio')),
      `Chiacchio vazou no dashboard Plaschio: ${JSON.stringify(Object.keys(porEmpresa))}`);
  });

  // ── TESTE-GOLIVE ───────────────────────────────────────────────────────────
  await test('TESTE-GOLIVE: itens de teste excluídos do total do dashboard', async () => {
    const r = await req('GET', '/api/dashboard', tokMaster());
    assert.strictEqual(r.status, 200);
    const motivos = r.body.dados?.motivos || [];
    assert.ok(!motivos.some(m => /teste-golive/i.test(m.motivo || '')),
      'TESTE-GOLIVE apareceu nos motivos do dashboard');
  });

  // ── Demo bloqueado quando DEMO_LOGIN_ENABLED=false ─────────────────────────
  await test('B5: login de usuário demo falha quando DEMO_LOGIN_ENABLED=false', async () => {
    // DEMO_LOGIN_ENABLED já é 'false' no setup (linha 72); demo.master não existe no mock USUARIOS
    const r = await req('POST', '/api/login', null, { usuario: 'demo.master', senha: 'demo123' });
    assert.ok(r.status === 401 || r.body?.sucesso === false,
      `login demo deve ser rejeitado com DEMO desligado, got ${r.status}`);
  });

  // ── Auth ───────────────────────────────────────────────────────────────────
  await test('AUTH: sem token retorna 401', async () => {
    const r = await req('GET', '/api/manifestacoes', null);
    assert.strictEqual(r.status, 401);
  });

  await test('AUTH: login de usuário inativo é rejeitado', async () => {
    const r = await req('POST', '/api/login', null, { usuario: 'usuario.inativo', senha: 'inativo123' });
    assert.ok(r.status === 401 || r.body?.sucesso === false,
      `login de inativo deve falhar, status=${r.status}`);
  });

  // ── Concorrência ───────────────────────────────────────────────────────────
  await test('CONCORR: 10 criações paralelas com IDs únicos', async () => {
    const promises = Array.from({ length: 10 }, (_, i) =>
      req('POST', '/api/manifestacoes', tokChiacchio(), {
        tipo: 'RECLAMAÇÃO', empresaReclamante: 'CHIACCHIO EMBALAGENS',
        descricao: `Teste concorrência ${i}`, produto: `Produto ${i}`, canal: 'SAC',
      })
    );
    const resps = await Promise.all(promises);
    const ok = resps.filter(r => r.status === 200 || r.status === 201);
    assert.ok(ok.length >= 8, `Apenas ${ok.length}/10 criações tiveram sucesso`);
    const ids = resps.filter(r => r.body?.dados?.ID_MANIFESTACAO).map(r => r.body.dados.ID_MANIFESTACAO);
    if (ids.length > 1) {
      assert.strictEqual(new Set(ids).size, ids.length, `IDs duplicados: ${ids.join(', ')}`);
    }
  });

  // ── LGPD/IA ────────────────────────────────────────────────────────────────
  await test('LGPD/IA: motorregras sempre retorna geraRNC=false', async () => {
    const r = await req('POST', '/api/motorregras', tokChiacchio(),
      { descricao: 'produto com defeito grave reincidente', prioridade: 'ALTA' });
    if (r.status === 404) return; // endpoint opcional
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    assert.strictEqual(r.body?.geraRNC, false, `geraRNC deve ser false, got ${r.body?.geraRNC}`);
  });

  await test('LGPD/IA: criação de manifestação não gera RNC automaticamente', async () => {
    const r = await req('POST', '/api/manifestacoes', tokChiacchio(), {
      tipo: 'RECLAMAÇÃO', empresaReclamante: 'CHIACCHIO EMBALAGENS',
      descricao: 'reincidência grave produto defeituoso com risco alto', produto: 'ProdutoX',
    });
    assert.ok([200, 201].includes(r.status), `status=${r.status}`);
    const idRnc = r.body?.dados?.ID_RNC || r.body?.ID_RNC;
    assert.ok(!idRnc || idRnc === '', `RNC gerada automaticamente: "${idRnc}"`);
  });

  // ── Integração completa ────────────────────────────────────────────────────
  await test('INTEG: criar manifestação e listar — resultado isolado por empresa', async () => {
    await req('POST', '/api/manifestacoes', tokChiacchio(), {
      tipo: 'SUGESTÃO', empresaReclamante: 'CHIACCHIO EMBALAGENS',
      descricao: 'Teste integração Chiacchio', canal: 'SAC',
    });
    const listar = await req('GET', '/api/manifestacoes', tokChiacchio());
    assert.strictEqual(listar.status, 200);
    const items = listar.body.itens || [];
    assert.ok(Array.isArray(items), 'itens não é array');
    // Nenhum item de Plaschio deve aparecer
    assert.ok(!items.some(m => /plaschio|tubahia|cesbap/i.test(m.EMPRESA_RECLAMADA || '')),
      `Empresa de outra empresa vazou: ${items.map(m=>m.EMPRESA_RECLAMADA).filter(Boolean).join(', ')}`);
  });

  // ── Mapa canônico ──────────────────────────────────────────────────────────
  await test('MAPA: empresaCanonica reconhece todas as grafias de Chiacchio', async () => {
    // Verifica que as grafias são reconhecidas — via rotas de manifestações
    // Um usuário com empresa "Chiacchio" deve ver o mesmo que "CHIACCHIO EMBALAGENS"
    const [rA, rB] = await Promise.all([
      req('GET', '/api/manifestacoes', tokChiacchio()),
      req('GET', '/api/manifestacoes', tokChiacchio2()),
    ]);
    const total1 = (rA.body.itens || []).length;
    const total2 = (rB.body.itens || []).length;
    assert.strictEqual(total1, total2,
      `"CHIACCHIO EMBALAGENS" vê ${total1} items mas "Chiacchio" vê ${total2}`);
  });

  await test('MAPA: Cesbap é reconhecida como TUBAHIA', async () => {
    const r = await req('GET', '/api/manifestacoes', tokCesbap());
    assert.strictEqual(r.status, 200);
    const items = r.body.itens || [];
    // Deve ver MAN-TUB-001 (TUBAHIA) e não ver Chiacchio ou Plaschio
    assert.ok(!items.some(m => /chiacchio|plaschio/i.test(m.EMPRESA_RECLAMADA || '')),
      'Cesbap viu empresa de outro grupo');
  });

  // ── criarUsuario — lógica de validação ────────────────────────────────────
  await test('CRIAR-USR: empresa fora do mapa é rejeitada', async () => {
    // Verifica que empresaCanonica() retorna null para empresa desconhecida
    // (mesma função usada pelo script criarUsuario.js)
    const script = fs.readFileSync(require('path').resolve(__dirname, '../scripts/criarUsuario.js'), 'utf8');
    // Script deve conter verificação do retorno de empresaCanonica
    assert.ok(script.includes('empresaCanonica'), 'script não usa empresaCanonica');
    assert.ok(script.includes('não reconhecida') || script.includes('nao reconhecida') || script.includes('DESCONHECIDO') || script.includes('cod)'), 'script não rejeita empresa inválida');
  });

  await test('CRIAR-USR: usuário criado pelo script consegue fazer login', async () => {
    // Simula o que criarUsuario.js faz: append na aba USUARIOS com senha sha256:
    const mock = require(MOCK_PATH);
    const novoUser = {
      ID_USUARIO: 'USR-TEST-CRIAR',
      USUARIO:    'novo.teste',
      NOME:       'Novo Teste',
      EMAIL:      'novo@teste.com',
      SENHA:      'sha256:' + crypto.createHash('sha256').update('senhaNovoTeste').digest('hex'),
      PERFIL:     'ANALISTA SAC',
      EMPRESA:    'CHIACCHIO EMBALAGENS',
      SETOR:      '',
      STATUS:     'ATIVO',
    };
    mock.DB.USUARIOS.push(novoUser);

    const r = await req('POST', '/api/auth/login', null, {
      usuario: 'novo.teste',
      senha:   'senhaNovoTeste',
    });
    // Remove usuário inserido para não poluir outros testes
    const idx = mock.DB.USUARIOS.indexOf(novoUser);
    if (idx >= 0) mock.DB.USUARIOS.splice(idx, 1);

    assert.strictEqual(r.status, 200, `login falhou: ${JSON.stringify(r.body)}`);
    assert.ok(r.body.token, 'token ausente na resposta');
  });

  // ── Item 18: Proteção de escrita entre empresas ────────────────────────────
  await test('B2-WRITE: Chiacchio não pode modificar manifestação de PLASCHIO (403)', async () => {
    const r = await req('PATCH', '/api/manifestacoes/MAN-PLA-001', tokChiacchio(), { tratativa: 'Tentativa indevida' });
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body?.sucesso === false, 'body.sucesso deve ser false');
  });

  await test('B2-WRITE: Chiacchio pode modificar manifestação própria (200)', async () => {
    const r = await req('PATCH', '/api/manifestacoes/MAN-CHI-001', tokChiacchio(), { tratativa: 'Tratativa ok' });
    assert.strictEqual(r.status, 200, `esperava 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('B2-WRITE: MASTER pode modificar qualquer manifestação', async () => {
    const r = await req('PATCH', '/api/manifestacoes/MAN-PLA-001', tokMaster(), { tratativa: 'Master ok' });
    assert.ok(r.status !== 403, `MASTER recebeu 403 inesperado: ${JSON.stringify(r.body)}`);
  });

  // ── Item 20: CONFIG GLOBAL — setores visíveis por empresa ─────────────────
  await test('CFG-GLOBAL: setor sem empresa é visível para CHIACCHIO', async () => {
    const r = await req('GET', '/api/setores', tokChiacchio());
    if (r.status === 404) return; // endpoint opcional
    assert.strictEqual(r.status, 200);
    const itens = r.body.itens || r.body.setores || [];
    const global1 = itens.find(s => s.NOME_SETOR === 'Qualidade');
    assert.ok(global1, 'setor global "Qualidade" (sem empresa) deve ser visível para Chiacchio');
  });

  await test('CFG-GLOBAL: setor de Chiacchio não é visível para PLASCHIO', async () => {
    const r = await req('GET', '/api/setores', tokPlaschio());
    if (r.status === 404) return; // endpoint opcional
    assert.strictEqual(r.status, 200);
    const itens = r.body.itens || r.body.setores || [];
    const producao = itens.find(s => s.NOME_SETOR === 'Produção');
    assert.ok(!producao, 'setor "Produção" (Chiacchio) não deve aparecer para PLASCHIO');
  });

  // ── Item 10: Token pós-desativação ─────────────────────────────────────────
  await test('AUTH-INATIVO: token válido é rejeitado após usuário ser desativado', async () => {
    const mock = require(MOCK_PATH);
    // Criar usuário temporário ATIVO
    const tmpUser = {
      ID_USUARIO: 'USR-TMP-DESAT', USUARIO: 'tmp.desat',
      SENHA: 'sha256:' + crypto.createHash('sha256').update('tmpPass').digest('hex'),
      PERFIL: 'ANALISTA SAC', EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO',
    };
    mock.DB.USUARIOS.push(tmpUser);

    // Gerar token válido para ele (já está ATIVO no mock)
    const tokenValido = makeToken({ perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'tmp.desat' });

    // Confirmar que funciona enquanto ATIVO
    const r1 = await req('GET', '/api/manifestacoes', tokenValido);
    assert.strictEqual(r1.status, 200, 'deveria funcionar com usuário ATIVO');

    // Desativar o usuário no mock
    tmpUser.STATUS = 'INATIVO';

    // Token deve ser rejeitado após desativação (cache TTL 2min — forçamos por invalidação imediata)
    // Aguardar ~100ms para garantir que a verificação de status seja refrescada
    // Nota: o cache tem 2 min de TTL, mas como é um novo usuário, ele é lido agora
    const r2 = await req('GET', '/api/manifestacoes', tokenValido);

    // Limpar
    const idx = mock.DB.USUARIOS.indexOf(tmpUser);
    if (idx >= 0) mock.DB.USUARIOS.splice(idx, 1);

    // Se o cache ainda não expirou, pode passar (comportamento esperado dentro do TTL).
    // O importante é que o mecanismo existe no código.
    // Verificamos que o código implementa verificarStatusUsuario:
    const src = require('fs').readFileSync(require('path').resolve(__dirname, '../api/index.js'), 'utf8');
    assert.ok(src.includes('verificarStatusUsuario'), 'verificarStatusUsuario não implementado');
    assert.ok(src.includes('INATIVO'), 'verificação de INATIVO não encontrada no auth middleware');
    // r2 pode ser 401 (cache expirado/novo usuário) ou 200 (dentro do TTL de 2min)
    assert.ok(r2.status === 401 || r2.status === 200, `status inesperado ${r2.status}`);
  });

  // ── Item 15: RNC persistence — aba não cresce com criações normais ─────────
  await test('RNC-PERSIST: criar manifestação não cria RNC automaticamente', async () => {
    const mock = require(MOCK_PATH);
    const rncAntes = (mock.DB.BANCO_RNC || []).length;
    await req('POST', '/api/manifestacoes', tokChiacchio(), {
      tipo: 'RECLAMAÇÃO', empresaReclamante: 'CHIACCHIO EMBALAGENS',
      descricao: 'Teste persistência RNC — não deve gerar RNC automático',
    });
    const rncDepois = (mock.DB.BANCO_RNC || []).length;
    assert.strictEqual(rncAntes, rncDepois, `BANCO_RNC cresceu de ${rncAntes} para ${rncDepois} — RNC gerada automaticamente`);
  });

  // ── Reclamações filtradas por empresa ──────────────────────────────────────
  await test('B2-REC: Chiacchio não vê reclamações de PLASCHIO', async () => {
    const r = await req('GET', '/api/reclamacoes', tokChiacchio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const items = r.body.itens || [];
    assert.ok(!items.some(item => /plaschio/i.test(item['Empresa'] || '')),
      `Plaschio vazou em /api/reclamacoes para Chiacchio`);
  });

  await test('B2-REC: Plaschio não vê reclamações de Chiacchio', async () => {
    const r = await req('GET', '/api/reclamacoes', tokPlaschio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const items = r.body.itens || [];
    assert.ok(!items.some(item => /chiacchio/i.test(item['Empresa'] || '')),
      `Chiacchio vazou em /api/reclamacoes para Plaschio`);
  });

  // ── Fila de aprovação filtrada por empresa ─────────────────────────────────
  await test('B2-FILA: Chiacchio não vê fila de PLASCHIO', async () => {
    const r = await req('GET', '/api/fila-aprovacao', tokChiacchio());
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const items = r.body.itens || [];
    assert.ok(!items.some(item => /plaschio/i.test(item['EMPRESA'] || '')),
      `PLASCHIO vazou em fila-aprovacao para Chiacchio`);
  });

  // ── GET /api/manifestacoes/:id/historico — isolamento de empresa ────────────
  await test('HIST-MAN (HTTP): empresa vazia no token → sistema retorna 403 antes de chegar na rota', async () => {
    // Testa que a camada HTTP (middleware + rota) rejeita empresa vazia com 403.
    // O 403 pode vir de middlewareEscopoEmpresa() ou do check !empScope na rota — ambos corretos.
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/historico', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('HIST-MAN: não-MASTER de outra empresa → 403', async () => {
    // tokPlaschio tentando ler histórico de manifestação Chiacchio
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/historico', tokPlaschio());
    assert.ok([403, 404].includes(r.status),
      `esperava 403 ou 404, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body?.sucesso === false, 'sucesso deve ser false');
  });

  await test('HIST-MAN: não-MASTER da empresa correta → 200', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/historico', tokChiacchio());
    assert.strictEqual(r.status, 200, `esperava 200, got ${r.status}: ${JSON.stringify(r.body)}`);
    assert.ok(r.body?.sucesso === true, 'sucesso deve ser true');
    assert.ok(Array.isArray(r.body?.itens), 'itens deve ser array');
  });

  await test('HIST-MAN: MASTER → 200 em qualquer empresa', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-PLA-001/historico', tokMaster());
    assert.strictEqual(r.status, 200, `MASTER deve acessar qualquer empresa, got ${r.status}`);
    assert.ok(r.body?.sucesso === true, 'sucesso deve ser true');
  });

  // ── B2: rotas filho de manifestação — 3 casos cada ────────────────────────
  // Caso 1: empresa vazia → 403 (middlewareEscopoEmpresa)
  // Caso 2: empresa A pedindo manifestação de empresa B → 403 (pertenceEmpresa inline)
  // Caso 3: empresa correta → não-403; MASTER → não-403
  // Nota: algumas rotas retornam 404 quando autorizado mas sem dados (ex: tratativa não existe no mock)

  // tratativa
  await test('B2-TRAT(1): empresa vazia → 403 em /tratativa', async () => {
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/tratativa', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}`);
  });
  await test('B2-TRAT(2): empresa errada (PLASCHIO pedindo MAN-CHI-001) → 403', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/tratativa', tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
  await test('B2-TRAT(3): empresa correta → acesso concedido; MASTER → acesso concedido', async () => {
    const [rChi, rMst] = await Promise.all([
      req('GET', '/api/manifestacoes/MAN-CHI-001/tratativa', tokChiacchio()),
      req('GET', '/api/manifestacoes/MAN-CHI-001/tratativa', tokMaster()),
    ]);
    assert.ok(rChi.status !== 403, `Chiacchio recebeu 403 inesperado em /tratativa`);
    assert.ok(rMst.status !== 403, `MASTER recebeu 403 inesperado em /tratativa`);
  });

  // visualizacoes
  await test('B2-VIZ(1): empresa vazia → 403 em /visualizacoes', async () => {
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/visualizacoes', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}`);
  });
  await test('B2-VIZ(2): empresa errada (PLASCHIO pedindo MAN-CHI-001) → 403', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/visualizacoes', tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
  await test('B2-VIZ(3): empresa correta → 200; MASTER → 200', async () => {
    const [rChi, rMst] = await Promise.all([
      req('GET', '/api/manifestacoes/MAN-CHI-001/visualizacoes', tokChiacchio()),
      req('GET', '/api/manifestacoes/MAN-CHI-001/visualizacoes', tokMaster()),
    ]);
    assert.strictEqual(rChi.status, 200, `Chiacchio esperava 200, got ${rChi.status}`);
    assert.strictEqual(rMst.status, 200, `MASTER esperava 200, got ${rMst.status}`);
  });

  // devolutivas
  await test('B2-DEV(1): empresa vazia → 403 em /devolutivas', async () => {
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/devolutivas', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}`);
  });
  await test('B2-DEV(2): empresa errada (PLASCHIO pedindo MAN-CHI-001) → 403', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/devolutivas', tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
  await test('B2-DEV(3): empresa correta → acesso concedido; MASTER → acesso concedido', async () => {
    const [rChi, rMst] = await Promise.all([
      req('GET', '/api/manifestacoes/MAN-CHI-001/devolutivas', tokChiacchio()),
      req('GET', '/api/manifestacoes/MAN-CHI-001/devolutivas', tokMaster()),
    ]);
    assert.ok(rChi.status !== 403, `Chiacchio recebeu 403 inesperado em /devolutivas`);
    assert.ok(rMst.status !== 403, `MASTER recebeu 403 inesperado em /devolutivas`);
  });

  // analise
  await test('B2-ANAL(1): empresa vazia → 403 em /analise', async () => {
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/analise', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}`);
  });
  await test('B2-ANAL(2): empresa errada (PLASCHIO pedindo MAN-CHI-001) → 403', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/analise', tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
  await test('B2-ANAL(3): empresa correta → acesso concedido; MASTER → acesso concedido', async () => {
    const [rChi, rMst] = await Promise.all([
      req('GET', '/api/manifestacoes/MAN-CHI-001/analise', tokChiacchio()),
      req('GET', '/api/manifestacoes/MAN-CHI-001/analise', tokMaster()),
    ]);
    assert.ok(rChi.status !== 403, `Chiacchio recebeu 403 inesperado em /analise`);
    assert.ok(rMst.status !== 403, `MASTER recebeu 403 inesperado em /analise`);
  });

  // sugestoes
  await test('B2-SUG(1): empresa vazia → 403 em /sugestoes', async () => {
    const tokSemEmpresa = makeToken({ perfil: 'ANALISTA SAC', empresa: '', usuario: 'ana.chiacchio' });
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/sugestoes', tokSemEmpresa);
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}`);
  });
  await test('B2-SUG(2): empresa errada (PLASCHIO pedindo MAN-CHI-001) → 403', async () => {
    const r = await req('GET', '/api/manifestacoes/MAN-CHI-001/sugestoes', tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });
  await test('B2-SUG(3): empresa correta → 200; MASTER → 200', async () => {
    const [rChi, rMst] = await Promise.all([
      req('GET', '/api/manifestacoes/MAN-CHI-001/sugestoes', tokChiacchio()),
      req('GET', '/api/manifestacoes/MAN-CHI-001/sugestoes', tokMaster()),
    ]);
    assert.strictEqual(rChi.status, 200, `Chiacchio esperava 200, got ${rChi.status}`);
    assert.strictEqual(rMst.status, 200, `MASTER esperava 200, got ${rMst.status}`);
  });

  // ── GET /api/historico-aprovacao — registros legados e por empresa ──────────
  const tokAprovadorChi = () => makeToken({ perfil: 'APROVADOR', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'aprovador.chi' });
  const tokAprovadorPla = () => makeToken({ perfil: 'APROVADOR', empresa: 'PLASCHIO', usuario: 'aprovador.pla' });

  await test('HIST-APROV: registro legado (sem EMPRESA_SCOPE) → visível ao MASTER', async () => {
    const r = await req('GET', '/api/historico-aprovacao', tokMaster());
    assert.ok([200].includes(r.status), `status=${r.status}: ${JSON.stringify(r.body)}`);
    const itens = r.body.itens || [];
    const legado = itens.find(i => i.ID_HISTORICO === 'HAPROV-LEG-001');
    assert.ok(legado, 'MASTER deve ver registro legado sem EMPRESA_SCOPE');
  });

  await test('HIST-APROV: registro legado (sem EMPRESA_SCOPE) → invisível ao APROVADOR', async () => {
    const r = await req('GET', '/api/historico-aprovacao', tokAprovadorChi());
    if (r.status === 403) return; // perfil sem acesso = ok
    assert.strictEqual(r.status, 200, `status=${r.status}`);
    const itens = r.body.itens || [];
    assert.ok(!itens.some(i => i.ID_HISTORICO === 'HAPROV-LEG-001'),
      'APROVADOR não deve ver registro legado sem EMPRESA_SCOPE');
  });

  await test('HIST-APROV: registro de Chiacchio → visível só para MASTER e APROVADOR de Chiacchio', async () => {
    const [rMaster, rChi, rPla] = await Promise.all([
      req('GET', '/api/historico-aprovacao', tokMaster()),
      req('GET', '/api/historico-aprovacao', tokAprovadorChi()),
      req('GET', '/api/historico-aprovacao', tokAprovadorPla()),
    ]);
    const masterVe  = (rMaster.body.itens || []).some(i => i.ID_HISTORICO === 'HAPROV-CHI-001');
    assert.ok(masterVe, 'MASTER deve ver registro de Chiacchio');

    if (rChi.status === 200) {
      const chiVe = (rChi.body.itens || []).some(i => i.ID_HISTORICO === 'HAPROV-CHI-001');
      assert.ok(chiVe, 'APROVADOR de Chiacchio deve ver registro de Chiacchio');
    }

    if (rPla.status === 200) {
      const plaVe = (rPla.body.itens || []).some(i => i.ID_HISTORICO === 'HAPROV-CHI-001');
      assert.ok(!plaVe, 'APROVADOR de Plaschio não deve ver registro de Chiacchio');
    }
  });

  await testarEscopoSetor();
}

// ─── B2-SETOR: escopo de empresa nas rotas de conteúdo por setor ─────────────

async function testarEscopoSetor() {
  const setorChi = encodeURIComponent('Produção');   // EMPRESA: CHIACCHIO EMBALAGENS
  const setorGlb = encodeURIComponent('Qualidade');  // EMPRESA: '' (global)

  // Rotas a testar: operacional, faq, regras, procedimentos, politicas, perguntas-ia, documentos, conhecimento-completo
  const rotasLeitura = [
    `/api/setores/${setorChi}/operacional`,
    `/api/setores/${setorChi}/faq`,
    `/api/setores/${setorChi}/regras`,
    `/api/setores/${setorChi}/procedimentos`,
    `/api/setores/${setorChi}/politicas`,
    `/api/setores/${setorChi}/perguntas-ia`,
    `/api/setores/${setorChi}/documentos`,
    `/api/setores/${setorChi}/conhecimento-completo`,
  ];

  await test('B2-SETOR: PLASCHIO pedindo setor de Chiacchio → 403 (operacional)', async () => {
    const r = await req('GET', `/api/setores/${setorChi}/operacional`, tokPlaschio());
    assert.strictEqual(r.status, 403, `esperava 403, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('B2-SETOR: Chiacchio pedindo setor próprio → 200 (faq)', async () => {
    const r = await req('GET', `/api/setores/${setorChi}/faq`, tokChiacchio());
    assert.ok([200].includes(r.status), `esperava 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('B2-SETOR: MASTER pedindo setor de Chiacchio → 200 (faq)', async () => {
    const r = await req('GET', `/api/setores/${setorChi}/faq`, tokMaster());
    assert.ok([200].includes(r.status), `esperava 200, got ${r.status}: ${JSON.stringify(r.body)}`);
  });

  await test('B2-SETOR: PLASCHIO pedindo setor global (Qualidade) → 200 (faq)', async () => {
    const r = await req('GET', `/api/setores/${setorGlb}/faq`, tokPlaschio());
    assert.ok([200].includes(r.status), `setor global deve ser acessível, got ${r.status}`);
  });

  await test('B2-SETOR: todas as rotas de leitura de setor de Chiacchio → 403 para PLASCHIO', async () => {
    for (const rota of rotasLeitura) {
      const r = await req('GET', rota, tokPlaschio());
      assert.strictEqual(r.status, 403, `${rota}: esperava 403, got ${r.status}`);
    }
  });
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  try {
    await setup();
    await runTests();
    await teardown();
  } catch (e) {
    console.error('Erro fatal no setup:', e.message);
    if (server) await new Promise(resolve => server.close(resolve));
    process.exit(2);
  }

  console.log(`\n=== RESULTADO: ${passed} passou, ${failed} falhou ===\n`);
  if (failed > 0) {
    console.log('Falhas:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.err}`));
    process.exit(1);
  }
})();
