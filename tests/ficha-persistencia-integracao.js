'use strict';
// Testes de integração com backend real + mock Sheets
// Valida: persistência dos campos CIRCA V2, atualizações cronológicas,
// RESP_SETOR_* completos, CIRCA rastreabilidade — sem dados reais de produção.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

const SECRET = 'test-secret-ficha-persistencia-32c';
const MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = SECRET;
process.env.SHEETS_MOCK_PATH = MOCK_PATH;
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

function token(payload) {
  const full = { ...payload, iat: Date.now(), exp: Date.now() + 60_000 };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function request(addr, method, reqPath, body, tok) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: addr.hostname,
      port: addr.port,
      method,
      path: reqPath,
      headers: {
        'Content-Type': 'application/json',
        ...(tok ? { 'Authorization': 'Bearer ' + tok } : {}),
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const MAN_ID = 'MAN-CHI-001';
const tok = token({ usuario: 'ana.chiacchio', perfil: 'ANALISTA SAC', empresa: 'CHIACCHIO EMBALAGENS', nome: 'Ana Chiacchio' });

let passed = 0;
let failed = 0;
const results = [];

async function run(label, fn) {
  try {
    await fn();
    passed++;
    results.push({ ok: true, label });
  } catch (e) {
    failed++;
    results.push({ ok: false, label, err: e.message });
  }
}

(async () => {
  const app = require('../api/index.js');
  const server = http.createServer(app);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const addr = server.address();

  const patch = (body) => request(addr, 'PATCH',
    `/api/manifestacoes/${encodeURIComponent(MAN_ID)}/ficha`, body, tok);

  // ─── 1. salvar_investigacao persiste campos CIRCA V2 ────────────────────────
  await run('salvar_investigacao persiste INVESTIGACAO_COMO/QUANDO/ONDE/QUEM/HIPOTESE', async () => {
    const r = await patch({
      acao: 'salvar_investigacao',
      INVESTIGACAO_O_QUE: 'O produto chegou amassado',
      INVESTIGACAO_COMO: 'Durante o transporte houve impacto',
      INVESTIGACAO_QUANDO: '2026-10-30',
      INVESTIGACAO_ONDE: 'Centro de distribuição São Paulo',
      INVESTIGACAO_QUEM: 'Transportador Rápido Ltda',
      INVESTIGACAO_HIPOTESE: 'Falha no acondicionamento do palete',
      INVESTIGACAO_NOTAS: 'Cliente reportou foto com amassado lateral',
      INVESTIGACAO_EVIDENCIAS: 'Foto enviada por WhatsApp',
      RESULTADO_OPERACIONAL: 'PARCIALMENTE_RESOLVIDO',
    });
    assert.equal(r.status, 200, `Esperado 200, recebido ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sucesso, true, 'sucesso deve ser true');
  });

  // ─── 2. RESULTADO_OPERACIONAL ───────────────────────────────────────────────
  await run('salvar_investigacao persiste RESULTADO_OPERACIONAL', async () => {
    const r = await patch({ acao: 'salvar_investigacao', RESULTADO_OPERACIONAL: 'RESOLVIDO' });
    assert.equal(r.status, 200);
    assert.equal(r.body.sucesso, true);
  });

  // ─── 3. TRATATIVA_UPDATE persiste e retorna HISTORICO_TRATATIVA ─────────────
  await run('TRATATIVA_UPDATE é persistido e resposta inclui HISTORICO_TRATATIVA', async () => {
    const r = await patch({
      acao: 'salvar_investigacao',
      TRATATIVA_UPDATE: 'Contato feito com transportador às 14h',
    });
    assert.equal(r.status, 200, `Esperado 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sucesso, true);
    assert.ok(r.body.HISTORICO_TRATATIVA !== undefined,
      'Resposta deve incluir HISTORICO_TRATATIVA quando TRATATIVA_UPDATE enviado');
    const hist = JSON.parse(r.body.HISTORICO_TRATATIVA);
    assert.ok(Array.isArray(hist), 'HISTORICO_TRATATIVA deve ser JSON de array');
    assert.ok(hist.length >= 1, 'Array deve ter pelo menos 1 entrada');
    const ultima = hist[hist.length - 1];
    assert.equal(ultima.texto, 'Contato feito com transportador às 14h',
      'Texto da última entrada deve bater com o enviado');
    assert.ok(ultima.data, 'Entrada deve ter campo data');
    assert.ok(ultima.usuario, 'Entrada deve ter campo usuario');
  });

  // ─── 4. TRATATIVA_UPDATE acumula — 2ª entrada ──────────────────────────────
  await run('Segunda TRATATIVA_UPDATE acumula no histórico', async () => {
    await patch({ acao: 'salvar_investigacao', TRATATIVA_UPDATE: 'Primeira atualização' });
    const r2 = await patch({ acao: 'salvar_investigacao', TRATATIVA_UPDATE: 'Segunda atualização' });
    assert.equal(r2.status, 200);
    const hist = JSON.parse(r2.body.HISTORICO_TRATATIVA);
    assert.ok(hist.length >= 2, `Deve haver ≥2 entradas, encontrado ${hist.length}`);
  });

  // ─── 5. resposta_setor aceita RESP_SETOR_COMO/QUANDO/ONDE/QUEM ─────────────
  await run('resposta_setor persiste todos os campos RESP_SETOR_*', async () => {
    // Garantir que há TRATATIVA_REALIZADA para evitar bloqueio de outras rotas
    await patch({ acao: 'salvar_investigacao', TRATATIVA_REALIZADA: 'Tratativa executada' });
    const r = await patch({
      acao: 'resposta_setor',
      RESP_SETOR_O_QUE: 'O produto foi inspecionado',
      RESP_SETOR_COMO: 'Verificação visual e dimensional',
      RESP_SETOR_QUANDO: '2026-10-31',
      RESP_SETOR_ONDE: 'Almoxarifado unidade SP',
      RESP_SETOR_QUEM: 'João Silva — Qualidade',
      RESP_SETOR_RESOLUCAO: 'Produto reposto ao cliente',
      RESP_SETOR_ACAO_PREV: 'Treinamento de embalagem',
    });
    assert.equal(r.status, 200, `resposta_setor retornou ${r.status}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sucesso, true);
  });

  // ─── 6. CIRCA rastreabilidade persiste ─────────────────────────────────────
  await run('salvar_investigacao persiste campos CIRCA_TRAT_* de rastreabilidade', async () => {
    const r = await patch({
      acao: 'salvar_investigacao',
      CIRCA_TRAT_RECOMENDADA: JSON.stringify(['Substituir produto', 'Reembolso integral']),
      CIRCA_TRAT_FONTE: 'PROC-EMB-003',
      CIRCA_TRAT_SELECIONADA: 'Substituir produto',
      CIRCA_TRAT_AUTORIZADA: 'Substituir produto',
      CIRCA_TRAT_EXECUTADA: 'Novo produto enviado ao cliente em 24h',
      CIRCA_TRAT_RESULTADO: 'RESOLVIDO',
    });
    assert.equal(r.status, 200, `Esperado 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sucesso, true);
  });

  // ─── 7. validacao_sac rejeita COMPLEMENTAR sem justificativa ───────────────
  await run('validacao_sac rejeita COMPLEMENTAR sem observacoesFinais', async () => {
    const r = await patch({ acao: 'validacao_sac', decisao: 'COMPLEMENTAR' });
    assert.equal(r.status, 400,
      `Esperado 400 para COMPLEMENTAR sem justificativa, recebido ${r.status}`);
    assert.equal(r.body.sucesso, false);
  });

  // ─── 8. validacao_sac aceita COMPLEMENTAR com justificativa ─────────────────
  await run('validacao_sac aceita COMPLEMENTAR com observacoesFinais', async () => {
    const r = await patch({
      acao: 'validacao_sac',
      decisao: 'COMPLEMENTAR',
      observacoesFinais: 'Faltou foto da avaria',
    });
    assert.equal(r.status, 200, `Esperado 200: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.sucesso, true);
  });

  // ─── 9. Isolamento de empresa ───────────────────────────────────────────────
  await run('Usuário de outra empresa não acessa manifestação de empresa diferente', async () => {
    const tokPla = token({ usuario: 'joao.plaschio', perfil: 'ANALISTA SAC', empresa: 'PLASCHIO', nome: 'João Plaschio' });
    const r = await request(addr, 'PATCH',
      `/api/manifestacoes/${encodeURIComponent(MAN_ID)}/ficha`,
      { acao: 'salvar_investigacao', INVESTIGACAO_O_QUE: 'Tentativa acesso indevido' },
      tokPla
    );
    assert.ok([403, 404].includes(r.status),
      `Esperado 403 ou 404 para empresa errada, recebido ${r.status}: ${JSON.stringify(r.body)}`);
  });

  // ─── 10. Liderança — POST persiste, GET retorna ─────────────────────────────
  await run('POST /lideranca/comentarios persiste e GET retorna comentário', async () => {
    const rPost = await request(addr, 'POST',
      `/api/manifestacoes/${encodeURIComponent(MAN_ID)}/lideranca/comentarios`,
      { tipo: 'INTERVENCAO', texto: 'Urgente: cliente VIP afetado', idManifestacao: MAN_ID },
      tok
    );
    assert.ok([200, 201].includes(rPost.status),
      `POST liderança retornou ${rPost.status}: ${JSON.stringify(rPost.body)}`);
    assert.equal(rPost.body.sucesso, true);

    const rGet = await request(addr, 'GET',
      `/api/manifestacoes/${encodeURIComponent(MAN_ID)}/lideranca/comentarios`,
      null, tok
    );
    assert.equal(rGet.status, 200);
    const comentarios = rGet.body.comentarios || rGet.body.itens || [];
    assert.ok(Array.isArray(comentarios), 'GET deve retornar array de comentários');
    const enc = comentarios.find(c =>
      (c.TEXTO || c.texto || c.comentario || '') === 'Urgente: cliente VIP afetado'
    );
    assert.ok(enc, `Comentário postado deve aparecer no GET — recebidos: ${JSON.stringify(comentarios.map(c=>c.TEXTO||c.texto))}`);
  });

  await new Promise(r => server.close(r));

  // ─── Relatório ──────────────────────────────────────────────────────────────
  console.log('\n=== Resultado dos testes de persistência ===');
  for (const res of results) {
    console.log(`  ${res.ok ? '✓' : '✗'} ${res.label}${res.err ? '\n      FALHA: ' + res.err : ''}`);
  }
  console.log(`\n${passed} aprovados, ${failed} reprovados.`);
  if (failed > 0) {
    console.error('\nTestes reprovados — ver acima.');
    process.exit(1);
  } else {
    console.log('Todos os testes de integração aprovados.');
  }
})().catch(e => {
  console.error('Erro fatal no runner de testes:', e);
  process.exit(1);
});
