'use strict';
/**
 * Testes de integridade de geração de protocolos e persistência
 * Cobre: criação simultânea, idempotência, todas as origens, consulta com
 * protocolo duplicado, autorização/privacidade e compatibilidade com dados legados.
 */

const assert = require('assert/strict');
const path = require('path');

process.env.NODE_ENV = 'test';
process.env.PG_LEITURA_ATIVA = 'false';
process.env.SHEETS_MOCK_PATH = path.join(__dirname, 'sheets-mock.js');
delete process.env.DATABASE_URL;

const mock = require('./sheets-mock');
const protocoloAtomico = require('../server-services/protocoloAtomico');
const fichaUnica = require('../server-services/fichaUnica');
const createLookup = require('../server-services/portalConsulta');

let passed = 0, failed = 0;
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

// ─── Setup de mock para protocoloAtomico ───────────────────────────────────
function makeAtomicDeps(extraManifestacoes = []) {
  const localDB = {
    MANIFESTACOES: [...mock.DB.MANIFESTACOES, ...extraManifestacoes],
    CONTADORES_PROTOCOLO: [],
  };
  const _headers = {};

  function garantirAbaComCabecalhos(nomeAba, headers) {
    if (!localDB[nomeAba]) localDB[nomeAba] = [];
    if (!_headers[nomeAba]) _headers[nomeAba] = headers || [];
    return Promise.resolve(_headers[nomeAba]);
  }
  function lerAba(nomeAba) {
    return Promise.resolve(JSON.parse(JSON.stringify(localDB[nomeAba] || [])));
  }
  function appendObjeto(nomeAba, obj) {
    if (!localDB[nomeAba]) localDB[nomeAba] = [];
    localDB[nomeAba].push(obj);
    return Promise.resolve({ headers: Object.keys(obj), linha: Object.values(obj) });
  }
  function invalidarCacheAba() {}

  return { deps: { lerAba, appendObjeto, invalidarCacheAba, garantirAbaComCabecalhos, prisma: null, claimWindowMs: 0 }, db: localDB };
}

(async () => {
  // ─── Grupo 1: geração atômica — estratégia Sheets ─────────────────────────
  console.log('\n[1] Geração atômica de protocolo (Sheets fallback)');

  await test('protocolo segue formato CHIA/PLA/TUB-AAAAMMDD-CC-NNNN', async () => {
    const { deps } = makeAtomicDeps();
    protocoloAtomico.init(deps);
    const proto = await protocoloAtomico.gerarProtocolo('Chiacchio', 'PORTAL', new Date('2026-10-28'));
    assert.match(proto, /^CHIA-20261028-06-\d{4}$/);
  });

  await test('primeiro protocolo para uma chave nova recebe seq=0001', async () => {
    const { deps } = makeAtomicDeps();
    protocoloAtomico.init(deps);
    const proto = await protocoloAtomico.gerarProtocolo('Plaschio', 'TELEFONE', new Date('2026-10-28'));
    assert.strictEqual(proto, 'PLA-20261028-01-0001');
  });

  await test('seq respeita protocolos já existentes na aba MANIFESTACOES', async () => {
    const existentes = [
      { PROTOCOLO: 'CHIA-20261028-09-0001', ID_MANIFESTACAO: 'TEST-EXIST-01' },
      { PROTOCOLO: 'CHIA-20261028-09-0002', ID_MANIFESTACAO: 'TEST-EXIST-02' },
    ];
    const { deps } = makeAtomicDeps(existentes);
    protocoloAtomico.init(deps);
    const proto = await protocoloAtomico.gerarProtocolo('Chiacchio', 'OUTROS', new Date('2026-10-28'));
    assert.strictEqual(proto, 'CHIA-20261028-09-0003');
  });

  await test('criação simultânea (2 req) gera protocolos únicos', async () => {
    const { deps } = makeAtomicDeps();
    protocoloAtomico.init(deps);
    const agora = new Date('2026-10-28');
    const [p1, p2] = await Promise.all([
      protocoloAtomico.gerarProtocolo('Chiacchio', 'EMAIL', agora),
      protocoloAtomico.gerarProtocolo('Chiacchio', 'EMAIL', agora),
    ]);
    assert.notStrictEqual(p1, p2, `Protocolos devem ser distintos: ${p1} vs ${p2}`);
    assert.match(p1, /^CHIA-20261028-02-\d{4}$/);
    assert.match(p2, /^CHIA-20261028-02-\d{4}$/);
  });

  await test('criação simultânea (5 req) gera 5 protocolos únicos', async () => {
    const { deps } = makeAtomicDeps();
    protocoloAtomico.init(deps);
    const agora = new Date('2026-10-28');
    const promises = Array.from({ length: 5 }, () =>
      protocoloAtomico.gerarProtocolo('Tubahia', 'WHATSAPP', agora),
    );
    const protos = await Promise.all(promises);
    const unicos = new Set(protos);
    assert.strictEqual(unicos.size, 5, `Esperado 5 únicos, gerou: ${protos.join(', ')}`);
  });

  await test('prefixo TUB para empresa Tubahia/Cesbap', async () => {
    const { deps } = makeAtomicDeps();
    protocoloAtomico.init(deps);
    const proto = await protocoloAtomico.gerarProtocolo('Cesbap', 'EMAIL', new Date('2026-10-28'));
    assert.match(proto, /^TUB-20261028-02-\d{4}$/);
  });

  // ─── Grupo 2: todas as origens geram protocolo oficial ────────────────────
  console.log('\n[2] Todas as origens geram protocolo oficial');

  await test('fichaUnica.montarProtocolo formata protocolo completo', () => {
    const proto = fichaUnica.montarProtocolo({ empresa: 'Chiacchio', canal: 'PORTAL', data: new Date('2026-10-28'), sequencial: 7 });
    assert.strictEqual(proto, 'CHIA-20261028-06-0007');
  });

  await test('codigoCanal mapeia PORTAL → 06, PESQUISA → 05, RCA → 09', () => {
    assert.strictEqual(fichaUnica.codigoCanal('PORTAL'), '06');
    assert.strictEqual(fichaUnica.codigoCanal('PORTAL DO CLIENTE'), '06');
    assert.strictEqual(fichaUnica.codigoCanal('PESQUISA'), '05');
    assert.strictEqual(fichaUnica.codigoCanal('RCA'), '09');
    assert.strictEqual(fichaUnica.codigoCanal('OUTROS'), '09');
  });

  await test('prefixoEmpresa preserva CHIA, PLA, TUB', () => {
    assert.strictEqual(fichaUnica.prefixoEmpresa('Chiacchio Embalagens'), 'CHIA');
    assert.strictEqual(fichaUnica.prefixoEmpresa('Plaschio'), 'PLA');
    assert.strictEqual(fichaUnica.prefixoEmpresa('PLASCHIO EMBALAGENS'), 'PLA');
    assert.strictEqual(fichaUnica.prefixoEmpresa('Tubahia'), 'TUB');
    assert.strictEqual(fichaUnica.prefixoEmpresa('CESBAP'), 'TUB');
  });

  // ─── Grupo 3: consulta com protocolo duplicado ────────────────────────────
  console.log('\n[3] Consulta pública com protocolo duplicado');

  await test('lookup retorna dado correto quando identificador resolve ambiguidade de duplicado', async () => {
    const duplicateProto = 'PLA-20261028-06-0099';
    const records = [
      { ID_MANIFESTACAO: 'TEST-DUP-A', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'a@example.test', STATUS: 'RECEBIDA' },
      { ID_MANIFESTACAO: 'TEST-DUP-B', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'b@example.test', STATUS: 'RECEBIDA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup(duplicateProto, 'a@example.test');
    assert.ok(result.sucesso);
    assert.strictEqual(result.protocolo, duplicateProto);
  });

  await test('lookup retorna 409 quando ambos os duplicados têm o mesmo contato', async () => {
    const duplicateProto = 'PLA-20261028-06-0088';
    const records = [
      { ID_MANIFESTACAO: 'TEST-SAME-A', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'same@example.test', STATUS: 'RECEBIDA' },
      { ID_MANIFESTACAO: 'TEST-SAME-B', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'same@example.test', STATUS: 'RECEBIDA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    try {
      await lookup(duplicateProto, 'same@example.test');
      assert.fail('Deveria ter lançado 409');
    } catch (e) {
      assert.strictEqual(e.status, 409);
    }
  });

  await test('lookup retorna 404 quando protocolo duplicado e identificador não casa com nenhum', async () => {
    const duplicateProto = 'CHIA-20261028-06-0077';
    const records = [
      { ID_MANIFESTACAO: 'TEST-MISS-A', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'x@example.test', STATUS: 'RECEBIDA' },
      { ID_MANIFESTACAO: 'TEST-MISS-B', PROTOCOLO: duplicateProto, ORIGEM: 'SAC', EMAIL: 'y@example.test', STATUS: 'RECEBIDA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    try {
      await lookup(duplicateProto, 'nobody@example.test');
      assert.fail('Deveria ter lançado 404');
    } catch (e) {
      assert.strictEqual(e.status, 404);
    }
  });

  await test('lookup com protocolo oficial PORTAL_PUBLICO duplicado retorna 409 sem identificador', async () => {
    const duplicateProto = 'CHIA-20261028-06-0066';
    const records = [
      { ID_MANIFESTACAO: 'TEST-PP-A', PROTOCOLO: duplicateProto, ORIGEM: 'PORTAL_PUBLICO', STATUS: 'RECEBIDA' },
      { ID_MANIFESTACAO: 'TEST-PP-B', PROTOCOLO: duplicateProto, ORIGEM: 'PORTAL_PUBLICO', STATUS: 'RECEBIDA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    try {
      await lookup(duplicateProto, undefined);
      assert.fail('Deveria ter lançado 409');
    } catch (e) {
      assert.strictEqual(e.status, 409);
    }
  });

  // ─── Grupo 4: autorização e privacidade ───────────────────────────────────
  console.log('\n[4] Autorização e privacidade na consulta pública');

  await test('consulta sem identificador para protocolo legado retorna 404', async () => {
    const records = [
      { ID_MANIFESTACAO: 'MAN-LEG-001', ORIGEM: 'SAC', EMAIL: 'leg@example.test', STATUS: 'RECEBIDA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    try {
      await lookup('MAN-LEG-001', undefined);
      assert.fail('Deveria ter lançado 404');
    } catch (e) {
      assert.strictEqual(e.status, 404);
    }
  });

  await test('resposta não expõe EMAIL, TELEFONE, DESCRICAO, CAUSA_RAIZ', async () => {
    const records = [
      {
        ID_MANIFESTACAO: 'TEST-PRIV-001',
        EMAIL: 'secreto@example.test',
        TELEFONE: '11999999999',
        DESCRICAO: 'dados confidenciais',
        CAUSA_RAIZ: 'análise interna',
        STATUS: 'RECEBIDA',
        ORIGEM: 'SAC',
      },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('TEST-PRIV-001', 'secreto@example.test');
    assert.ok(!('EMAIL' in result), 'EMAIL não deve aparecer na resposta pública');
    assert.ok(!('TELEFONE' in result), 'TELEFONE não deve aparecer');
    assert.ok(!('DESCRICAO' in result), 'DESCRICAO não deve aparecer');
    assert.ok(!('CAUSA_RAIZ' in result), 'CAUSA_RAIZ não deve aparecer');
  });

  await test('resposta com identificador errado retorna 404 indistinguível de não-encontrado', async () => {
    const records = [
      { ID_MANIFESTACAO: 'TEST-WRONG-001', EMAIL: 'real@example.test', STATUS: 'RECEBIDA', ORIGEM: 'SAC' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const erroNaoEncontrado = await lookup('MAN-INEXISTENTE-999', 'q@q.com').catch(e => e);
    const erroIdentErrado  = await lookup('TEST-WRONG-001', 'errado@example.test').catch(e => e);
    assert.strictEqual(erroNaoEncontrado.message, erroIdentErrado.message, 'Mensagens devem ser idênticas para impedir enumeração');
    assert.strictEqual(erroNaoEncontrado.status, 404);
    assert.strictEqual(erroIdentErrado.status, 404);
  });

  await test('protocolo oficial PORTAL_PUBLICO sem identificador retorna dados (acesso legítimo de portal)', async () => {
    const records = [
      { ID_MANIFESTACAO: 'TEST-PORT-001', PROTOCOLO: 'CHIA-20261028-06-0001', ORIGEM: 'PORTAL_PUBLICO', STATUS: 'RECEBIDA', EMPRESA_RECLAMADA: 'Chiacchio' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('CHIA-20261028-06-0001', undefined);
    assert.ok(result.sucesso);
    assert.strictEqual(result.status, 'Recebida');
  });

  // ─── Grupo 5: compatibilidade com dados históricos ─────────────────────────
  console.log('\n[5] Compatibilidade com dados históricos');

  await test('protocolo legado hexadecimal continua consultável com identificador', async () => {
    const records = [
      { ID_MANIFESTACAO: 'PLAS-MVS5SFPUHOV', PROTOCOLO: 'PLAS-MVS5SFPUHOV', ORIGEM: 'SAC', EMAIL: 'cliente@example.test', STATUS: 'EM ANÁLISE' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('PLAS-MVS5SFPUHOV', 'cliente@example.test');
    assert.ok(result.sucesso);
  });

  await test('lookup por ID_MANIFESTACAO (sem campo PROTOCOLO) continua funcionando', async () => {
    const records = [
      { ID_MANIFESTACAO: 'CHI-AABBCCDD', ORIGEM: 'SAC', EMAIL: 'hist@example.test', STATUS: 'FINALIZADA' },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('CHI-AABBCCDD', 'hist@example.test');
    assert.ok(result.sucesso);
  });

  await test('devolutiva só aparece para manifestação encerrada de PORTAL_PUBLICO', async () => {
    const records = [
      {
        ID_MANIFESTACAO: 'TEST-DEV-001', PROTOCOLO: 'CHIA-20261028-09-0001', ORIGEM: 'PORTAL_PUBLICO',
        STATUS: 'ENCERRADA', DEVOLUTIVA_ENVIADA: 'Resposta final ao cliente',
      },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('CHIA-20261028-09-0001', undefined);
    assert.strictEqual(result.devolutiva, 'Resposta final ao cliente');
  });

  await test('devolutiva fica em branco quando status não é ENCERRADA', async () => {
    const records = [
      {
        ID_MANIFESTACAO: 'TEST-DEV-002', PROTOCOLO: 'CHIA-20261028-09-0002', ORIGEM: 'PORTAL_PUBLICO',
        STATUS: 'EM ANÁLISE', DEVOLUTIVA_ENVIADA: 'Resposta não liberada',
      },
    ];
    const lookup = createLookup(() => Promise.resolve(records));
    const result = await lookup('CHIA-20261028-09-0002', undefined);
    assert.strictEqual(result.devolutiva, '');
  });

  // ─── Resultado ─────────────────────────────────────────────────────────────
  console.log(`\nPROTOCOLO-ATOMICO: ${passed} passou | ${failed} falhou`);
  if (failures.length) {
    for (const f of failures) console.error(`  ✗ ${f.nome}: ${f.erro}`);
  }
  process.exitCode = failed ? 1 : 0;
})();
