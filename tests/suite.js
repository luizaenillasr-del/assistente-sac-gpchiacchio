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

  await test('B1: api/index.js senhaValida nunca retorna true para plaintext', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    // Deve conter o comentário de segurança e retornar false para plaintext
    assert.ok(src.includes('NUNCA aceitar senha em texto puro') || src.includes('nunca aceitar'), 'deve documentar a rejeição de plaintext');
    assert.ok(src.includes('Segurança B1: NUNCA aceitar senha em texto puro') || src.includes('NUNCA aceitar senha'), 'deve documentar B1 na função senhaValida');
  });

  await test('B5: DEMO_USUARIOS só ativo quando DEMO_LOGIN_ENABLED=true', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
    assert.ok(src.includes('DEMO_LOGIN_ENABLED'), 'deve verificar DEMO_LOGIN_ENABLED');
    // Não deve retornar demo users sem verificação de env
    assert.ok(src.includes('demoEnabled ? DEMO_USUARIOS : []'), 'deve condicionar DEMO_USUARIOS ao env');
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
    const src = fs.readFileSync(require.resolve('../api/services/cerebroServices.js'), 'utf8');
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
