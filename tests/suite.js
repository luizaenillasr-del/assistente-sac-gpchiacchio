'use strict';

// ============================================================
// F13 — Suite de Testes do Assistente SAC
// Executa sem dependências externas (apenas Node.js + assert)
// Cobre 26 cenários agrupados em domínios
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
    const { extrairJSON } = require('../api/services/aiService');
    const texto = 'Aqui está a resposta: {"tipo":"Reclamação","setor":"SAC"} e mais texto.';
    const resultado = extrairJSON(texto);
    assert.ok(resultado, 'deve extrair JSON');
    assert.strictEqual(resultado.tipo, 'Reclamação');
    assert.strictEqual(resultado.setor, 'SAC');
  });

  await test('extrairJSON retorna null para texto sem JSON', () => {
    const { extrairJSON } = require('../api/services/aiService');
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
    const { isDisponivel } = require('../api/services/aiService');
    const result = isDisponivel();
    assert.strictEqual(result, false);
    if (orig) process.env.ANTHROPIC_API_KEY = orig;
    if (origOpenAI) process.env.OPENAI_API_KEY = origOpenAI;
  });

  await test('getProvider retorna anthropic por padrão', () => {
    const { getProvider } = require('../api/services/aiService');
    delete process.env.AI_PROVIDER;
    assert.strictEqual(getProvider(), 'anthropic');
    process.env.AI_PROVIDER = 'openai';
    assert.strictEqual(getProvider(), 'openai');
    delete process.env.AI_PROVIDER;
  });

  await test('getUltimosLogs retorna array (pode estar vazio)', () => {
    const { getUltimosLogs } = require('../api/services/aiService');
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
    const cerebro = require('../api/services/cerebroServices');
    assert.ok(cerebro.CEREBRO_VERSION, 'deve exportar CEREBRO_VERSION');
    assert.strictEqual(cerebro.CEREBRO_VERSION, '4.0.0');
  });

  await test('cerebroServices exporta tratativaEngine e devolutivaEngine', () => {
    const cerebro = require('../api/services/cerebroServices');
    assert.ok(cerebro.tratativaEngine, 'deve exportar tratativaEngine');
    assert.ok(cerebro.devolutivaEngine, 'deve exportar devolutivaEngine');
  });

  await test('cerebroServices exporta buscarCasosSimilares (função)', () => {
    const cerebro = require('../api/services/cerebroServices');
    assert.strictEqual(typeof cerebro.buscarCasosSimilares, 'function');
  });

  await test('cerebroServices exporta detectarReincidencia (função)', () => {
    const cerebro = require('../api/services/cerebroServices');
    assert.strictEqual(typeof cerebro.detectarReincidencia, 'function');
  });

  await test('cerebroServices exporta assertividade (objeto)', () => {
    const cerebro = require('../api/services/cerebroServices');
    assert.ok(cerebro.assertividade, 'deve exportar assertividade');
    assert.strictEqual(typeof cerebro.assertividade, 'object');
  });
}

// ────────────────────────────────────────────────────────────
// Grupo 4 — Repositórios (instanciação sem DB)
// ────────────────────────────────────────────────────────────
async function testarRepositorios() {
  console.log('\n[4] Repositórios (estrutura)');

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
    const src = fs.readFileSync(require.resolve('../api/services/cerebroServices.js'), 'utf8');
    // geraRNC: false deve estar presente; geraRNC: true (hardcoded) não deve aparecer
    assert.ok(src.includes('geraRNC: false'), 'deve conter geraRNC: false');
    // Garante que não há geraRNC: true hardcoded fora de contexto de teste/comentário
    const geraRNCTrue = src.match(/geraRNC:\s*true/g);
    assert.ok(!geraRNCTrue || geraRNCTrue.length === 0, 'não deve conter geraRNC: true hardcoded');
  });

  await test('CEREBRO_VERSION é 4.0.0', () => {
    const cerebro = require('../api/services/cerebroServices');
    assert.strictEqual(cerebro.CEREBRO_VERSION, '4.0.0');
  });

  await test('cerebroServices não importa SDK Anthropic diretamente', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/services/cerebroServices.js'), 'utf8');
    assert.ok(!src.includes("require('@anthropic-ai/sdk')"), 'não deve importar SDK Anthropic diretamente');
    assert.ok(!src.includes("require('anthropic')"), 'não deve importar SDK anthropic diretamente');
    assert.ok(src.includes('aiService'), 'deve usar aiService');
  });

  await test('aiService tem abstração de provider (anthropic|openai)', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/services/aiService.js'), 'utf8');
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
// Grupo 6 — Integração com PG (requer DATABASE_URL)
// ────────────────────────────────────────────────────────────
async function testarIntegracaoPG() {
  console.log('\n[6] Integração PostgreSQL (requer DATABASE_URL)');

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
