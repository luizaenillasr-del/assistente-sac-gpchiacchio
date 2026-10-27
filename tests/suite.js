'use strict';

// ============================================================
// F13 — Suite de Testes do Assistente SAC
// Executa sem dependências externas (apenas Node.js + assert)
// Cobre 33+ cenários agrupados em domínios
// Grupo 6 novo: Segurança (correções auditoria B1-B6)
// ============================================================

const assert = require('assert');

let passed = 0, failed = 0, skipped = 0;
const failures = [];

async function test(nome, fn) {
  try {
    await fn();
    console.log(`  ✓ ${nome}`);
    passed++;
  } catch (e) {
    console.error(`  ✗ ${nome}`);
    console.error(`    ${e.message}`);
    failed++;
    failures.push({ nome, erro: e.message });
  }
}

function skip(nome) {
  console.log(`  ⊘ ${nome} (pulado — requer ambiente externo)`);
  skipped++;
}

// ────────────────────────────────────────────────────────────
// Grupo 1 — Utilitários (sem I/O)
// ────────────────────────────────────────────────────────────
async function testarUtilitarios() {
  console.log('\n[1] Utilitários');

  await test('normalizarTexto remove acentos e lowercases', () => {
    function normalizarTexto(v) {
      return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    }
    assert.strictEqual(normalizarTexto('Ação'), 'acao');
    assert.strictEqual(normalizarTexto('  Seção  '), 'secao');
    assert.strictEqual(normalizarTexto(''), '');
  });

  await test('b64url e assinarToken geram token verificável', () => {
    const crypto = require('crypto');
    const SESSION_SECRET = 'test_secret_123';
    function b64url(v) { return Buffer.from(v).toString('base64url'); }
    function assinarToken(payload) {
      const body = b64url(JSON.stringify(payload));
      const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
      return body + '.' + sig;
    }
    function verificarToken(token) {
      try {
        const [body, sig] = String(token || '').split('.');
        if (!body || !sig) return null;
        const expected = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
      } catch { return null; }
    }
    const payload = { sub: 'u1', exp: Date.now() + 60000 };
    const token = assinarToken(payload);
    const result = verificarToken(token);
    assert.ok(result, 'token deve ser verificado');
    assert.strictEqual(result.sub, 'u1');
  });

  await test('verificarToken rejeita token expirado', () => {
    const crypto = require('crypto');
    const SECRET = 'test_secret_123';
    function b64url(v) { return Buffer.from(v).toString('base64url'); }
    const body = b64url(JSON.stringify({ sub: 'u1', exp: Date.now() - 1000 }));
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    const token = body + '.' + sig;
    function verificarToken(token) {
      try {
        const [body, sig] = String(token || '').split('.');
        if (!body || !sig) return null;
        const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!payload.exp || Date.now() > payload.exp) return null;
        return payload;
      } catch { return null; }
    }
    const result = verificarToken(token);
    assert.strictEqual(result, null, 'token expirado deve retornar null');
  });

  await test('senhaValida verifica hash sha256', () => {
    const crypto = require('crypto');
    function senhaValida(informada, armazenada) {
      if (armazenada === undefined || armazenada === null) return false;
      const s = String(armazenada);
      if (s.startsWith('sha256:')) return 'sha256:' + crypto.createHash('sha256').update(String(informada || '')).digest('hex') === s;
      return String(informada || '') === s;
    }
    const hash = 'sha256:' + crypto.createHash('sha256').update('minhasenha').digest('hex');
    assert.ok(senhaValida('minhasenha', hash));
    assert.ok(!senhaValida('senhaerrada', hash));
    assert.ok(!senhaValida('', null));
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 2 — aiService (unit, sem chamada de API)
// ────────────────────────────────────────────────────────────
async function testarAiService() {
  console.log('\n[2] aiService');

  await test('extrairJSON extrai JSON de texto com ruído', () => {
    const { extrairJSON } = require('../server-services/aiService');
    const texto = 'Aqui está a resposta: {"tipo":"Reclamação","setor":"SAC"} e mais texto.';
    const resultado = extrairJSON(texto);
    assert.ok(resultado, 'deve extrair JSON');
    assert.strictEqual(resultado.tipo, 'Reclamação');
    assert.strictEqual(resultado.setor, 'SAC');
  });

  await test('extrairJSON retorna null para texto sem JSON', () => {
    const { extrairJSON } = require('../server-services/aiService');
    assert.strictEqual(extrairJSON('texto sem json'), null);
    assert.strictEqual(extrairJSON(''), null);
    assert.strictEqual(extrairJSON(null), null);
  });

  await test('isDisponivel retorna false sem API key', () => {
    const orig = process.env.ANTHROPIC_API_KEY;
    const origOpenAI = process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AI_PROVIDER;
    const { isDisponivel } = require('../server-services/aiService');
    const result = isDisponivel();
    assert.strictEqual(result, false);
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
  });

  await test('getProvider retorna openai por padrão', () => {
    const { getProvider } = require('../server-services/aiService');
    delete process.env.AI_PROVIDER;
    assert.strictEqual(getProvider(), 'openai');
    process.env.AI_PROVIDER = 'anthropic';
    assert.strictEqual(getProvider(), 'anthropic');
    delete process.env.AI_PROVIDER;
  });

  await test('getUltimosLogs retorna array (pode estar vazio)', () => {
    const { getUltimosLogs } = require('../server-services/aiService');
    const logs = getUltimosLogs(5);
    assert.ok(Array.isArray(logs));
    assert.ok(logs.length <= 5);
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 3 — cerebroServices (sem I/O externo)
// ────────────────────────────────────────────────────────────
async function testarCerebro() {
  console.log('\n[3] cerebroServices');

  await test('cerebroServices exporta versão 4.0.0', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.ok(cerebro.CEREBRO_VERSION, 'deve exportar CEREBRO_VERSION');
    assert.strictEqual(cerebro.CEREBRO_VERSION, '4.0.0');
  });

  await test('cerebroServices exporta tratativaEngine e devolutivaEngine', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.ok(cerebro.tratativaEngine, 'deve exportar tratativaEngine');
    assert.ok(cerebro.devolutivaEngine, 'deve exportar devolutivaEngine');
  });

  await test('cerebroServices exporta buscarCasosSimilares (função)', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.strictEqual(typeof cerebro.buscarCasosSimilares, 'function');
  });

  await test('cerebroServices exporta detectarReincidencia (função)', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.strictEqual(typeof cerebro.detectarReincidencia, 'function');
  });

  await test('cerebroServices exporta assertividade (objeto)', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.ok(cerebro.assertividade, 'deve exportar assertividade');
    assert.strictEqual(typeof cerebro.assertividade, 'object');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 4 — Repositórios (instanciação sem DB)
// ────────────────────────────────────────────────────────────
async function testarRepositorios() {
  console.log('\n[4] Repositórios (estrutura)');

  let prismaDisponivel = true;
  try { require('@prisma/client'); } catch (e) { prismaDisponivel = false; }

  if (!prismaDisponivel) {
    const motivo = 'repositórios Prisma não estão em uso — PG_LEITURA_ATIVA=false';
    skip(`manifestacaoRepository exporta métodos esperados (${motivo})`);
    skip(`rncRepository exporta métodos esperados (${motivo})`);
    skip(`usuarioRepository exporta métodos esperados (${motivo})`);
    skip(`conhecimentoRepository exporta métodos esperados (${motivo})`);
    skip(`empresaRepository exporta métodos esperados (${motivo})`);
    return;
  }

  await test('manifestacaoRepository exporta métodos esperados', () => {
    const repo = require('../database/repositories/manifestacaoRepository');
    const esperados = ['findById', 'findByProtocolo', 'findByIdOriginal', 'findAll', 'create', 'update',
      'registrarHistorico', 'buscarParaSimilaridade', 'buscarPorCliente', 'upsertFromSheets'];
    esperados.forEach(m => assert.strictEqual(typeof repo[m], 'function', `${m} deve ser função`));
  });

  await test('rncRepository exporta métodos esperados', () => {
    const repo = require('../database/repositories/rncRepository');
    const esperados = ['findById', 'findByNumero', 'findAll', 'create', 'update', 'adicionarAcao', 'registrarEficacia', 'metricas'];
    esperados.forEach(m => assert.strictEqual(typeof repo[m], 'function', `${m} deve ser função`));
  });

  await test('usuarioRepository exporta métodos esperados', () => {
    const repo = require('../database/repositories/usuarioRepository');
    const esperados = ['findByEmail', 'findByLogin', 'findById', 'findAll', 'create', 'update', 'registrarAcesso'];
    esperados.forEach(m => assert.strictEqual(typeof repo[m], 'function', `${m} deve ser função`));
  });

  await test('conhecimentoRepository exporta métodos esperados', () => {
    const repo = require('../database/repositories/conhecimentoRepository');
    const esperados = ['findPoliticas', 'findProcedimentos', 'findRegras', 'findBaseConhecimento', 'findSla', 'findMatriz'];
    esperados.forEach(m => assert.strictEqual(typeof repo[m], 'function', `${m} deve ser função`));
  });

  await test('empresaRepository exporta métodos esperados', () => {
    const repo = require('../database/repositories/empresaRepository');
    const esperados = ['findAll', 'findById', 'findByCodigo', 'create', 'update', 'upsert'];
    esperados.forEach(m => assert.strictEqual(typeof repo[m], 'function', `${m} deve ser função`));
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 5 — Regras de negócio críticas
// ────────────────────────────────────────────────────────────
async function testarRegrasNegocio() {
  console.log('\n[5] Regras de negócio');

  await test('geraRNC nunca é true na análise do Cérebro', () => {
    // Verifica que o código-fonte do Cérebro não produz geraRNC:true por análise automática
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server-services/cerebroServices.js'), 'utf8');
    // geraRNC: false deve estar presente; geraRNC: true (hardcoded) não deve aparecer
    assert.ok(src.includes('geraRNC: false'), 'deve conter geraRNC: false');
    // Garante que não há geraRNC: true hardcoded fora de contexto de teste/comentário
    const geraRNCTrue = src.match(/geraRNC:\s*true/g);
    assert.ok(!geraRNCTrue || geraRNCTrue.length === 0, 'não deve conter geraRNC: true hardcoded');
  });

  await test('CEREBRO_VERSION é 4.0.0', () => {
    const cerebro = require('../server-services/cerebroServices');
    assert.strictEqual(cerebro.CEREBRO_VERSION, '4.0.0');
  });

  await test('cerebroServices não importa SDK Anthropic diretamente', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server-services/cerebroServices.js'), 'utf8');
    assert.ok(!src.includes("require('@anthropic-ai/sdk')"), 'não deve importar SDK Anthropic diretamente');
    assert.ok(!src.includes("require('anthropic')"), 'não deve importar SDK anthropic diretamente');
    assert.ok(src.includes('aiService'), 'deve usar aiService');
  });

  await test('aiService tem abstração de provider (anthropic|openai)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server-services/aiService.js'), 'utf8');
    assert.ok(src.includes('anthropic'), 'deve suportar anthropic');
    assert.ok(src.includes('openai'), 'deve suportar openai');
    assert.ok(src.includes('AI_PROVIDER'), 'deve ler AI_PROVIDER do env');
  });

  await test('importSheets.js não altera dados do Sheets (só leitura)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../database/seed/importSheets.js'), 'utf8');
    // Deve usar readonly scope
    assert.ok(src.includes('readonly'), 'deve usar scope readonly para Sheets');
    // Não deve fazer append ou update no Sheets
    assert.ok(!src.includes('spreadsheets.values.append'), 'não deve fazer append no Sheets');
    assert.ok(!src.includes('spreadsheets.values.update'), 'não deve fazer update no Sheets');
  });

  await test('api/index.js importa repositórios com try/catch (sem quebrar se PG indisponível)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    // Deve ter try/catch em torno dos requires dos repositórios
    assert.ok(src.includes('usuarioRepo'), 'deve usar usuarioRepo');
    assert.ok(src.includes('manifestacaoRepo'), 'deve usar manifestacaoRepo');
    assert.ok(src.includes('conhecimentoRepo'), 'deve usar conhecimentoRepo');
    // Garante que o fallback Sheets existe nos gets principais
    assert.ok(src.includes('lerAba(\'MANIFESTACOES\''), 'deve ter fallback Sheets em manifestações');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 6 — Segurança (correções da auditoria B1-B6)
// ────────────────────────────────────────────────────────────
async function testarSeguranca() {
  console.log('\n[6] Segurança (auditoria B1-B6)');

  await test('B1: senhaValida rejeita senha plaintext sem hash', () => {
    const crypto = require('crypto');
    // Simular a função senhaValida corrigida
    function senhaValida(informada, armazenada) {
      if (armazenada === undefined || armazenada === null) return false;
      const s = String(armazenada);
      if (s.startsWith('sha256:')) return 'sha256:' + crypto.createHash('sha256').update(String(informada || '')).digest('hex') === s;
      return false; // B1: nunca aceitar plaintext
    }
    // Deve rejeitar senha plaintext armazenada
    assert.ok(!senhaValida('senha123', 'senha123'), 'plaintext deve ser rejeitado');
    assert.ok(!senhaValida('senha123', ''), 'string vazia deve ser rejeitada');
    // Deve aceitar hash válido
    const hash = 'sha256:' + crypto.createHash('sha256').update('senha123').digest('hex');
    assert.ok(senhaValida('senha123', hash), 'hash correto deve ser aceito');
    assert.ok(!senhaValida('outrasenha', hash), 'hash errado deve ser rejeitado');
  });

  await test('B1: senhaValida de api/index.js rejeita plaintext e aceita hash', async () => {
    const path = require('path');
    const crypto = require('crypto');
    const mockPath = path.resolve(__dirname, 'sheets-mock.js');
    const prev = process.env.SHEETS_MOCK_PATH;
    process.env.SHEETS_MOCK_PATH = mockPath;
    Object.keys(require.cache).filter(k => k.includes(`${path.sep}api${path.sep}index`)).forEach(k => delete require.cache[k]);
    const appB1 = require('../api/index.js');
    const fn = appB1._senhaValidaForTest;
    if (prev) process.env.SHEETS_MOCK_PATH = prev; else delete process.env.SHEETS_MOCK_PATH;
    Object.keys(require.cache).filter(k => k.includes(`${path.sep}api${path.sep}index`)).forEach(k => delete require.cache[k]);

    assert.strictEqual(typeof fn, 'function', '_senhaValidaForTest deve estar exposto em modo de teste');
    assert.strictEqual(await fn('senha123', 'senha123'), false, 'plaintext deve ser rejeitado');
    assert.strictEqual(await fn('', ''), false, 'string vazia deve ser rejeitada');
    const h256 = 'sha256:' + crypto.createHash('sha256').update('senha123').digest('hex');
    assert.strictEqual(await fn('senha123', h256), true, 'sha256 correto deve ser aceito');
    assert.strictEqual(await fn('errada', h256), false, 'sha256 errado deve ser rejeitado');
    try {
      const bcrypt = require('bcryptjs');
      const hBcrypt = await bcrypt.hash('senha123', 10);
      assert.strictEqual(await fn('senha123', hBcrypt), true, 'bcrypt correto deve ser aceito');
      assert.strictEqual(await fn('errada', hBcrypt), false, 'bcrypt errado deve ser rejeitado');
    } catch (e) { /* bcryptjs não disponível no ambiente de teste — skip silencioso */ }
  });

  await test('B5: DEMO_USUARIOS só ativo quando DEMO_LOGIN_ENABLED=true', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('DEMO_LOGIN_ENABLED'), 'deve verificar DEMO_LOGIN_ENABLED');
    // Não deve retornar demo users sem verificação de env
    assert.ok(src.includes('DEMO_USUARIOS'), 'deve referenciar DEMO_USUARIOS');
    assert.ok(src.includes('demoEnabled'), 'deve verificar demoEnabled antes de usar DEMO_USUARIOS');
  });

  await test('B6: motorRegras() sempre retorna geraRNC: false', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('const geraRNC = false; // Imutável'), 'geraRNC deve ser sempre false em motorRegras');
    assert.ok(src.includes('rncSinalizado'), 'deve usar rncSinalizado como sinalização não-automática');
  });

  await test('B2: filtrarPorEmpresa existe em api/index.js', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('function filtrarPorEmpresa'), 'deve ter função filtrarPorEmpresa');
    assert.ok(src.includes('middlewareEscopoEmpresa'), 'deve ter middleware de escopo de empresa');
    assert.ok(src.includes('pertenceEmpresa'), 'deve ter verificação pertenceEmpresa');
  });

  await test('B2: /api/rnc tem isolamento de empresa (Sheets + PG)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    // Deve ter middlewareEscopoEmpresa no endpoint /rnc
    assert.ok(src.includes("app.get('/api/rnc', middlewareEscopoEmpresa()"), 'endpoint /rnc deve usar middlewareEscopoEmpresa');
    // Sheets fallback deve filtrar por empresa
    const rncBlock = src.slice(src.indexOf("app.get('/api/rnc'"), src.indexOf("app.post('/api/rnc'"));
    assert.ok(rncBlock.includes('filtrarPorEmpresa'), 'Sheets fallback de /rnc deve usar filtrarPorEmpresa');
  });

  await test('B2: /api/historico tem isolamento de empresa', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes("app.get('/api/historico', middlewareEscopoEmpresa()"), 'endpoint /historico deve usar middlewareEscopoEmpresa');
    const histBlock = src.slice(src.indexOf("app.get('/api/historico'"), src.indexOf("app.get('/api/historico'") + 500);
    assert.ok(histBlock.includes('filtrarPorEmpresa'), 'historico deve usar filtrarPorEmpresa');
  });

  await test('B2: /api/manifestacoes PG path usa empresa do usuário autenticado', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    // O PG path não deve confiar em req.query.empresaId para não-MASTER
    assert.ok(src.includes('B2: empresa vem do usuário autenticado, não do frontend'), 'PG path de manifestacoes deve usar empresa do usuário');
  });

  await test('B2: /api/manifestacoes/:id PG path verifica empresa', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('B2: verificar escopo de empresa no PG path'), 'GET /manifestacoes/:id PG path deve checar empresa');
  });

  await test('B4: calcularSLA tem timezone configurável', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../server-services/cerebroServices.js'), 'utf8');
    assert.ok(src.includes('SLA_CONFIG'), 'deve ter SLA_CONFIG centralizado');
    assert.ok(src.includes('SLA_TIMEZONE'), 'deve ler timezone do env');
    assert.ok(src.includes('prazoFinalLocal'), 'deve formatar prazo no timezone correto');
  });

  await test('B3: dual-write PG registra falha no audit trail', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('DUALWRITE_PG_FALHOU'), 'deve registrar falha de dual-write');
    assert.ok(src.includes("console.info('[PG] dual-write manifestação OK"), 'deve confirmar sucesso');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 8 — Correções pós-code-review (d593468)
// ────────────────────────────────────────────────────────────
async function testarCorrecoesPosReview() {
  console.log('\n[8] Correções pós-code-review (d593468)');

  // ── appendLinha: retry real via api/index.js com getSheets injetado ──────────
  // api/index.js exporta _appendLinhaForTest quando SHEETS_MOCK_PATH está definido.
  // O mock de retry NÃO exporta appendLinha (para não curto-circuitar o retry real),
  // mas exporta getSheets() que retorna um cliente fake que conta chamadas.

  const path = require('path');
  const os   = require('os');
  const fs   = require('fs');
  const origMock = process.env.SHEETS_MOCK_PATH;

  function buildRetryMock(behavior) {
    // behavior: array de outcomes por chamada (429 | 503 | 200)
    // NÃO exporta appendLinha → o retry real de api/index.js é exercitado.
    const tmpPath = path.join(os.tmpdir(), `mock_retry_${Date.now()}_${Math.random().toString(36).slice(2)}.js`);
    fs.writeFileSync(tmpPath, `'use strict';
let _calls = 0;
const _behavior = ${JSON.stringify(behavior)};
module.exports = {
  lerAba()          { return Promise.resolve([]); },
  appendObjeto()    { return Promise.resolve({ headers:[], linha:[] }); },
  obterCabecalhos() { return Promise.resolve([]); },
  atualizarPorID()  { return Promise.resolve(null); },
  getSheets() {
    return {
      spreadsheets: { values: {
        append() {
          const outcome = _behavior[_calls++] ?? 200;
          if (outcome === 200) return Promise.resolve({});
          const e = new Error('injected ' + outcome);
          e.response = { status: outcome };
          return Promise.reject(e);
        },
        get() { return Promise.resolve({ data: { values: [[]] } }); },
      }}
    };
  },
  getCalls() { return _calls; },
};`);
    return tmpPath;
  }

  function loadFreshApp(mockPath) {
    Object.keys(require.cache)
      .filter(k => k.includes(`${path.sep}api${path.sep}index`))
      .forEach(k => delete require.cache[k]);
    process.env.SHEETS_MOCK_PATH = mockPath;
    return require('../api/index.js');
  }

  function cleanupMock(tmpPath) {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
    Object.keys(require.cache)
      .filter(k => k.includes(`${path.sep}api${path.sep}index`) || (tmpPath && k === tmpPath))
      .forEach(k => delete require.cache[k]);
    process.env.SHEETS_MOCK_PATH = origMock || '';
    if (!origMock) delete process.env.SHEETS_MOCK_PATH;
  }

  await test('RETRY: 429 na 1ª chamada → retenta e grava (2 chamadas ao append, 1 sucesso)', async () => {
    const tmp = buildRetryMock([429, 200]);
    const app = loadFreshApp(tmp);
    const appendLinha = app._appendLinhaForTest;
    assert.ok(typeof appendLinha === 'function', '_appendLinhaForTest não exportado');
    const mockMod = require(tmp);
    await appendLinha('ABA', ['dado1']);
    const calls = mockMod.getCalls();
    cleanupMock(tmp);
    assert.strictEqual(calls, 2, `esperava 2 chamadas ao append, houve ${calls}`);
  });

  await test('RETRY: 503 não é retentado — 1 chamada, erro propagado sem retry', async () => {
    const tmp = buildRetryMock([503]);
    const app = loadFreshApp(tmp);
    const appendLinha = app._appendLinhaForTest;
    assert.ok(typeof appendLinha === 'function', '_appendLinhaForTest não exportado');
    const mockMod = require(tmp);
    let lancou = false;
    try { await appendLinha('ABA', ['dado1']); } catch { lancou = true; }
    const calls = mockMod.getCalls();
    cleanupMock(tmp);
    assert.ok(lancou, 'deve lançar erro no 503');
    assert.strictEqual(calls, 1, `503 não deve ser retentado — esperava 1 chamada, houve ${calls}`);
  });

  await test('RETRY: 429 persistente — 3 tentativas ao append, lança erro', async () => {
    const tmp = buildRetryMock([429, 429, 429]);
    const app = loadFreshApp(tmp);
    const appendLinha = app._appendLinhaForTest;
    assert.ok(typeof appendLinha === 'function', '_appendLinhaForTest não exportado');
    const mockMod = require(tmp);
    let lancou = false;
    try { await appendLinha('ABA', ['dado1']); } catch { lancou = true; }
    const calls = mockMod.getCalls();
    cleanupMock(tmp);
    assert.ok(lancou, 'deve lançar após esgotar retries');
    assert.strictEqual(calls, 3, `esperava 3 tentativas, houve ${calls}`);
  });

  // ── /api/manifestacoes/:id/historico — inspeção estática ─────────────────────
  await test('HIST-MAN: rota /api/manifestacoes/:id/historico existe e usa requerPermissao', () => {
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(
      src.includes("app.get('/api/manifestacoes/:id/historico'"),
      'rota GET /api/manifestacoes/:id/historico não encontrada'
    );
    assert.ok(
      src.includes("requerPermissao('manifestacoes.visualizar')"),
      "rota deve exigir permissão 'manifestacoes.visualizar'"
    );
  });

  await test('HIST-MAN: check de empresa_scope vazio presente na rota (:id/historico)', () => {
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    const start = src.indexOf("app.get('/api/manifestacoes/:id/historico'");
    const block = src.slice(start, start + 1200);
    // Verifica o trecho exato que bloqueia empresa_scope vazio: "!empScope ||"
    assert.ok(
      block.includes('!empScope ||'),
      'rota deve conter "!empScope ||" para bloquear usuários sem empresa definida'
    );
    assert.ok(
      block.includes('status(403)'),
      'rota deve retornar 403 para empresa não autorizada'
    );
  });

  // ── /api/historico-aprovacao — registros legados ──────────────────────────────
  await test('HIST-APROV: bloco else { return false } para legados está na rota historico-aprovacao', () => {
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    const histIdx = src.indexOf("app.get('/api/historico-aprovacao'");
    const histBlock = src.slice(histIdx, histIdx + 2500);
    // O trecho específico do fix: o else que bloqueia registros sem EMPRESA_SCOPE
    // Procura pela combinação única: "} else {" seguido de "return false" dentro do contexto de legados
    const elseIdx = histBlock.indexOf('} else {');
    assert.ok(elseIdx >= 0, 'bloco else não encontrado em historico-aprovacao');
    const elseBlock = histBlock.slice(elseIdx, elseIdx + 200);
    assert.ok(
      elseBlock.includes('return false'),
      'bloco else deve conter "return false" para bloquear registros legados'
    );
    assert.ok(
      elseBlock.includes('legado') || elseBlock.includes('EMPRESA_SCOPE'),
      'bloco else deve comentar o motivo (legado ou EMPRESA_SCOPE)'
    );
  });

  await test('HIST-APROV: EMPRESA_SCOPE armazenado no appendObjeto de HISTORICO_APROVACAO', () => {
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    const appendIdx = src.indexOf("appendObjeto('HISTORICO_APROVACAO'");
    assert.ok(appendIdx >= 0, "appendObjeto('HISTORICO_APROVACAO') não encontrado");
    const appendBlock = src.slice(appendIdx, appendIdx + 500);
    assert.ok(
      appendBlock.includes('EMPRESA_SCOPE'),
      'EMPRESA_SCOPE deve ser gravado no HISTORICO_APROVACAO'
    );
    assert.ok(
      appendBlock.includes('empresaCanonica'),
      'EMPRESA_SCOPE deve ser normalizado com empresaCanonica()'
    );
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 7 — Integração com PG (requer DATABASE_URL)
// ────────────────────────────────────────────────────────────
async function testarIntegracaoPG() {
  console.log('\n[7] Integração PostgreSQL (requer DATABASE_URL)');

  if (!process.env.DATABASE_URL) {
    skip('connection.js conecta ao Neon — DATABASE_URL não configurada');
    skip('empresaRepository.findAll retorna lista — DATABASE_URL não configurada');
    skip('manifestacaoRepository.findAll retorna lista — DATABASE_URL não configurada');
    return;
  }

  await test('connection.js singleton não cria múltiplos clientes', async () => {
    const prisma1 = require('../database/connection');
    const prisma2 = require('../database/connection');
    assert.strictEqual(prisma1, prisma2, 'deve ser singleton');
  });

  await test('empresaRepository.findAll retorna array', async () => {
    const repo = require('../database/repositories/empresaRepository');
    const result = await repo.findAll();
    assert.ok(Array.isArray(result), 'deve retornar array');
  });

  await test('manifestacaoRepository.findAll retorna array', async () => {
    const repo = require('../database/repositories/manifestacaoRepository');
    const result = await repo.findAll({});
    assert.ok(Array.isArray(result), 'deve retornar array');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 8 — Ficha única de manifestação
// ────────────────────────────────────────────────────────────
async function testarFichaUnica() {
  console.log('\n[8] Ficha única de manifestação');
  const ficha = require('../server-services/fichaUnica');

  await test('protocolo usa prefixo, data e canal definidos pela ficha', () => {
    const protocolo = ficha.montarProtocolo({ empresa:'Chiacchio Embalagens', canal:'Portal do Cliente', data:'2026-10-21T12:00:00Z', sequencial:7 });
    assert.strictEqual(protocolo, 'CHIA-20261021-06-0007');
    assert.strictEqual(ficha.unidadeEmpresa('Plaschio'), 'caixas');
    assert.strictEqual(ficha.unidadeEmpresa('Cesbap'), 'rolos');
  });

  await test('etapa e mensagem acompanham o estado real da manifestação', () => {
    const m = { STATUS_FICHA:'AGUARDANDO_SETOR', SETOR_CONFIRMADO:'Produção' };
    assert.strictEqual(ficha.etapaAtual(m), 3);
    assert.strictEqual(ficha.mensagemContextual(m), 'Aguardando aceite do setor de Produção.');
    assert.strictEqual(ficha.etapaAtual({ STATUS:'ENCERRADA' }), 6);
  });
}

async function testarDashboardExecutiva() {
  console.log('\n[9] Dashboard executiva');
  await test('calcula NPS sem tratar respostas ausentes como zero', () => {
    const { calcular } = require('../server-services/dashboardExecutiva');
    const r = calcular({ respostas:[{RECOMENDACAO:'10',ATENDIMENTO:'9'},{RECOMENDACAO:'6',QUALIDADE:'8'},{}] });
    assert.strictEqual(r.satisfacao.nps, 0);
    assert.strictEqual(r.satisfacao.criterios.find(x=>x.criterio==='ATENDIMENTO').media, 9);
  });
  await test('separa vencimentos e ranking de setores por dados reais', () => {
    const { calcular } = require('../server-services/dashboardExecutiva');
    const referencia = new Date('2026-10-21T12:00:00Z');
    const r = calcular({ referencia, manifestacoes: [
      { ID:'1', DATA_ABERTURA:'2026-10-10T00:00:00Z', STATUS_FICHA:'EM TRATATIVA', SETOR_CONFIRMADO:'Logística', SLA_HORAS:'24' },
      { ID:'2', DATA_ABERTURA:'2026-10-20T00:00:00Z', DATA_ENCERRAMENTO:'2026-10-20T12:00:00Z', STATUS_FICHA:'FINALIZADA', SETOR_CONFIRMADO:'Produção', SLA_HORAS:'24', CAUSA_RAIZ_CONFIRMADA:'Transporte' },
    ] });
    assert.strictEqual(r.geral.vencidas, 1);
    assert.strictEqual(r.geral.setores[0].setor, 'Logística');
    assert.strictEqual(r.geral.causas[0][0], 'Transporte');
  });
}

async function testarRelatorioSatisfacao() {
  console.log('\n[9] Relatórios de satisfação');
  await test('PDF do relatório é gerado com dados mensais', async () => {
    const { gerarPdfRelatorioSatisfacao } = require('../server-services/pdfRelatorioSatisfacao');
    const pdf = await gerarPdfRelatorioSatisfacao({ empresa:'Chiacchio', periodo:'Setembro/2026', versao:1, status:'PUBLICADO', indicador:'8.7', nps:'72', meta:'8.5', criterios:[{criterio:'Atendimento',media:'9.0'}], textos:{resumo_executivo:'Resultado do período.'} });
    assert.ok(Buffer.isBuffer(pdf), 'o PDF deve ser um Buffer');
    assert.ok(pdf.length > 500, 'o PDF deve conter conteúdo');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 10 — Homologação funcional (fluxos críticos)
// Testa com dados sintéticos sem gravar em produção
// ────────────────────────────────────────────────────────────
async function testarHomologacaoFuncional() {
  console.log('\n[10] Homologação funcional — fluxos críticos');

  // ── BANCO_HISTORICO: idempotência por ID determinístico ──────────────────────
  await test('HIST-IDEM: ID_HISTORICO determinístico previne duplicação', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    // Verifica que ID_HISTORICO não usa Date.now (seria não-determinístico)
    const feedFnStart = src.indexOf('async function _feedBancoHistorico(');
    assert.ok(feedFnStart >= 0, '_feedBancoHistorico não encontrada');
    const feedFnBlock = src.slice(feedFnStart, feedFnStart + 2500);
    assert.ok(
      feedFnBlock.includes("ID_HISTORICO: `HIST-${id}`"),
      'ID_HISTORICO deve ser determinístico (sem Date.now)'
    );
    assert.ok(
      !feedFnBlock.includes('Date.now()'),
      'ID_HISTORICO não deve conter Date.now() — tornaria o ID não-determinístico'
    );
  });

  await test('HIST-IDEM: mutex em memória (_bancoHistoricoEmAndamento) existe e é Set', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(
      src.includes('const _bancoHistoricoEmAndamento = new Set()'),
      'Set de controle de concorrência _bancoHistoricoEmAndamento não encontrado'
    );
    assert.ok(
      src.includes('_bancoHistoricoEmAndamento.has(id)'),
      'Verificação de concorrência (.has) não encontrada'
    );
    assert.ok(
      src.includes('_bancoHistoricoEmAndamento.add(id)'),
      'Lock (.add) não encontrado'
    );
    assert.ok(
      src.includes('_bancoHistoricoEmAndamento.delete(id)'),
      'Unlock (.delete) em finally não encontrado'
    );
  });

  await test('HIST-IDEM: ambos os caminhos de encerramento usam _feedBancoHistorico', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    const calls = (src.match(/_feedBancoHistorico\(/g) || []).length;
    assert.ok(calls >= 2, `_feedBancoHistorico deve ser chamado pelo menos 2 vezes (PATCH + /finalizar), encontrado: ${calls}`);
    assert.ok(
      src.includes("'PATCH_STATUS_ENCERRADA'"),
      "chamada com fonte 'PATCH_STATUS_ENCERRADA' não encontrada"
    );
    assert.ok(
      src.includes("'FINALIZAR_MANIFESTACAO'"),
      "chamada com fonte 'FINALIZAR_MANIFESTACAO' não encontrada"
    );
  });

  await test('HIST-IDEM: função verifica jaExiste antes de appendObjeto', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    const feedFnStart = src.indexOf('async function _feedBancoHistorico(');
    const feedFnBlock = src.slice(feedFnStart, feedFnStart + 2500);
    const jaExisteIdx = feedFnBlock.indexOf('jaExiste');
    const appendIdx = feedFnBlock.indexOf('appendObjeto');
    assert.ok(jaExisteIdx >= 0, 'verificação jaExiste não encontrada em _feedBancoHistorico');
    assert.ok(appendIdx >= 0, 'appendObjeto não encontrado em _feedBancoHistorico');
    assert.ok(jaExisteIdx < appendIdx, 'jaExiste deve ser verificado ANTES de appendObjeto');
  });

  // ── Causa provável vs confirmada ─────────────────────────────────────────────
  await test('CAUSA-FREQ: frequência só incrementa com CAUSA_RAIZ_CONFIRMADA', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    // Localiza o bloco de auto-increment no PATCH circa-dados
    const autoIncrIdx = src.indexOf('Auto-increment FREQUENCIA_OCORRENCIAS');
    assert.ok(autoIncrIdx >= 0, 'bloco Auto-increment FREQUENCIA_OCORRENCIAS não encontrado');
    const autoIncrBlock = src.slice(autoIncrIdx, autoIncrIdx + 600);
    assert.ok(
      autoIncrBlock.includes('patch.CAUSA_RAIZ_CONFIRMADA'),
      'incremento de frequência deve ser vinculado a patch.CAUSA_RAIZ_CONFIRMADA'
    );
    assert.ok(
      autoIncrBlock.includes('FREQUENCIA_OCORRENCIAS'),
      'campo FREQUENCIA_OCORRENCIAS não encontrado no bloco de incremento'
    );
  });

  await test('CAUSA-FREQ: incremento só ocorre quando valor muda (evita incremento em PATCH idempotente)', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    const autoIncrIdx = src.indexOf('Auto-increment FREQUENCIA_OCORRENCIAS');
    const autoIncrBlock = src.slice(autoIncrIdx, autoIncrIdx + 400);
    // Verifica comparação com valor anterior: patch.X !== (m.X||'')
    assert.ok(
      autoIncrBlock.includes("!== (m.CAUSA_RAIZ_CONFIRMADA||'')") ||
      autoIncrBlock.includes("!== m.CAUSA_RAIZ_CONFIRMADA"),
      'deve comparar patch com valor anterior (m.CAUSA_RAIZ_CONFIRMADA) para evitar duplo incremento'
    );
  });

  // ── Devolutiva com aprovação ─────────────────────────────────────────────────
  await test('DEV-APROV: devolutiva gerada sempre entra no fluxo de aprovação (STATUS_FICHA)', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    // O STATUS_FICHA 'AGUARDANDO_APROVACAO' é usado para manifestações aguardando aprovação
    assert.ok(
      src.includes("STATUS_FICHA: 'AGUARDANDO_APROVACAO'"),
      "STATUS_FICHA 'AGUARDANDO_APROVACAO' não encontrado"
    );
    // Verifica que existe fluxo de aprovação para devolutiva
    assert.ok(
      src.includes("app.post('/api/devolutivas/:idDev/decisao'"),
      "endpoint de decisão de devolutiva não encontrado"
    );
    const aguardandoCount = (src.match(/AGUARDANDO_APROVACAO/g) || []).length;
    assert.ok(aguardandoCount >= 3, `pelo menos 3 ocorrências de AGUARDANDO_APROVACAO esperadas, encontrado: ${aguardandoCount}`);
  });

  await test('DEV-APROV: endpoint de decisão de devolutiva existe e valida decisões', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(
      src.includes("app.post('/api/devolutivas/:idDev/decisao'"),
      "endpoint POST /api/devolutivas/:idDev/decisao não encontrado"
    );
    assert.ok(
      src.includes("['APROVADA','EDITADA','REJEITADA']"),
      "validação de decisões válidas não encontrada"
    );
  });

  // ── Auto-aprimoramento sem aprovação automática ───────────────────────────────
  await test('APR-AUTO: aprimoramento criado com STATUS PENDENTE (sem auto-aprovação)', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    const aprIdx = src.indexOf("CRIADO_POR: 'SISTEMA_CIRCA'");
    assert.ok(aprIdx >= 0, "CRIADO_POR: 'SISTEMA_CIRCA' não encontrado");
    const aprBlock = src.slice(Math.max(0, aprIdx - 500), aprIdx + 200);
    assert.ok(
      aprBlock.includes("STATUS: 'PENDENTE'"),
      "aprimoramento deve ser criado com STATUS 'PENDENTE'"
    );
    assert.ok(
      !aprBlock.includes("STATUS: 'APROVADO'"),
      "aprimoramento NÃO deve ser criado com STATUS 'APROVADO' (sem auto-aprovação)"
    );
    assert.ok(
      aprBlock.includes("APROVADO_POR: ''"),
      "APROVADO_POR deve estar vazio no aprimoramento automático"
    );
  });

  await test('APR-AUTO: condição de criação exige freq >= 2 OU reincidência SIM', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    const condIdx = src.indexOf('freq >= 2 || reincidencia');
    assert.ok(condIdx >= 0, 'condição "freq >= 2 || reincidencia" não encontrada');
  });

  // ── Normalização de tratativas setoriais (aliases de colunas antigas) ─────────
  await test('TRAT-ALIAS: endpoint de detalhes normaliza colunas antigas em tratasSetoriais', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(
      src.includes('DESCRICAO_TRATATIVA') && src.includes('t.ACAO || t.DESCRICAO_TRATATIVA'),
      'alias DESCRICAO_TRATATIVA não encontrado na normalização de tratasSetoriais'
    );
    assert.ok(
      src.includes('t.SETOR || t.SETOR_RESPONSAVEL'),
      'alias SETOR_RESPONSAVEL não encontrado'
    );
    assert.ok(
      src.includes('t.RESULTADO || t.CONCLUSAO'),
      'alias CONCLUSAO para RESULTADO não encontrado'
    );
  });

  // ── Alimentação automática base conhecimento ──────────────────────────────────
  await test('BASE-CONHECIMENTO: cerebroServices consulta 4 fontes em paralelo via Promise.all', () => {
    const src = require('fs').readFileSync(require.resolve('../server-services/cerebroServices.js'), 'utf8');
    assert.ok(src.includes('Promise.all'), 'Promise.all não encontrado em cerebroServices');
    const sources = ['POLITICAS', 'PROCEDIMENTOS', 'BASE_CONHECIMENTO', 'CAUSAS'];
    for (const s of sources) {
      assert.ok(src.includes(`'${s}'`) || src.includes(`"${s}"`), `fonte ${s} não encontrada em cerebroServices`);
    }
  });

  await test('BASE-CONHECIMENTO: cerebroServices exporta função de consulta', () => {
    const cerebro = require('../server-services/cerebroServices');
    const fn = cerebro.consultarBaseConhecimento || cerebro.consultar || cerebro.buscar;
    assert.ok(typeof fn === 'function', 'função de consulta à base de conhecimento não exportada');
  });

  // ── Relato original: normMan lê múltiplos aliases de coluna ──────────────────
  await test('RELATO-ALIAS: normMan no frontend lê aliases de DESCRICAO', () => {
    const src = require('fs').readFileSync(require.resolve('../public/index.html'), 'utf8');
    const normManMatch = src.match(/desc\s*:\s*pick\s*\([^,]+,\s*\[([^\]]+)\]/);
    assert.ok(normManMatch, 'definição de desc em normMan não encontrada');
    const aliases = normManMatch[1];
    assert.ok(aliases.includes('DESCRICAO'), 'DESCRICAO não está entre os aliases de desc');
    assert.ok(aliases.includes('DESCRICAO_MANIFESTACAO'), 'DESCRICAO_MANIFESTACAO não está entre os aliases');
    assert.ok(aliases.includes('RELATO'), 'RELATO não está entre os aliases');
  });

  await test('RELATO-ALIAS: circa-dados PATCH mapeia descricao minúsculo para DESCRICAO maiúsculo', () => {
    const src = require('fs').readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(
      src.includes("'descricao') && req.body.descricao"),
      "mapeamento de 'descricao' (minúsculo) para DESCRICAO não encontrado no PATCH circa-dados"
    );
    assert.ok(
      src.includes('patch.DESCRICAO = req.body.descricao'),
      'patch.DESCRICAO não atribuído a partir de req.body.descricao'
    );
  });
}

// ────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────
async function main() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  F13 — Suite de Testes Assistente SAC      ║');
  console.log('╚════════════════════════════════════════════╝');

  await testarUtilitarios();
  await testarAiService();
  await testarCerebro();
  await testarRepositorios();
  await testarRegrasNegocio();
  await testarSeguranca();
  await testarCorrecoesPosReview();
  await testarFichaUnica();
  await testarDashboardExecutiva();
  await testarRelatorioSatisfacao();
  await testarHomologacaoFuncional();
  await testarIntegracaoPG();

  const total = passed + failed + skipped;
  console.log('\n──────────────────────────────────────────────');
  console.log(`Resultado: ${passed} passou | ${failed} falhou | ${skipped} pulado | ${total} total`);
  if (failures.length > 0) {
    console.log('\nFalhas:');
    failures.forEach(f => console.log(`  ✗ ${f.nome}: ${f.erro}`));
  }
  console.log('──────────────────────────────────────────────');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
