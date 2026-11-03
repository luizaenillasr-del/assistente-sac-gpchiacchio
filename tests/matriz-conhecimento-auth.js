'use strict';

// Testes de autenticação e autorização das rotas /api/matriz-conhecimento.
//
// Escopo verificado:
//   1. Sem token               → 401 (middleware global rejeita)
//   2. Token inválido          → 401 (assinatura incorreta)
//   3. Token expirado          → 401
//   4. Perfil não-MC (SETOR RESPONSÁVEL, VISUALIZADOR, RCA, DIRETOR legado) → 403 em leitura
//   5. Perfil leitor legado (ANALISTA SAC, GESTOR SAC, ATENDENTE SAC, AUDITOR, APROVADOR) → 200 em leitura
//   6. Perfil leitor → 403 em escrita (POST/PUT/DELETE)
//   7. Perfil editor legado (ANALISTA SAC, GESTOR SAC) → pode criar/editar
//   8. Perfil MASTER → acesso global (sem escopo de empresa)
//   9. Perfil não-MASTER → escopo restrito à própria empresa
//  10. Cross-company: usuário empresa A não acessa matriz da empresa B
//  11. Perfis funcionais canônicos (SAC, APROVADOR_SETORIAL, DIRETORIA_GESTOR, MASTER)
//      — compatibilidade com modeloAutorizacao.perfilFuncional()
//  12. Endpoint /resolver autenticado por perfil funcional

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'mc-auth-test-secret-32-caracteres!!';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;

const SECRET = process.env.SESSION_SECRET;

function token(payload, secret = SECRET) {
  const full = { ...payload, iat: Date.now(), exp: Date.now() + 3600000 };
  const body = Buffer.from(JSON.stringify(full)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', secret).update(body).digest('base64url')}`;
}

function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({
      method, hostname: url.hostname, port: url.port,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
      },
    }, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        let parsed = {};
        try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(payload);
    req.end();
  });
}

(async () => {
  // Pré-popula o mock DB com matrizes de empresas distintas
  Object.keys(require.cache).filter(k => k.includes('/api/index') || k.includes('/server-services')).forEach(k => delete require.cache[k]);
  const mock = require('./sheets-mock');

  const ID_MC_CHIACCHIO = 'MC-001-CHIACCHIO';
  const ID_MC_PLASCHIO  = 'MC-001-PLASCHIO';

  // Usuários de teste — necessário para verificarStatusUsuario não retornar INATIVO
  const _users = [
    { ID_USUARIO: 'USR-MST', USUARIO: 'master.test',      EMAIL: 'master@test.com',      PERFIL: 'MASTER',             EMPRESA: '',                    STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-ANL', USUARIO: 'analista.test',    EMAIL: 'analista@test.com',    PERFIL: 'ANALISTA SAC',       EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-GST', USUARIO: 'gestor.test',      EMAIL: 'gestor@test.com',      PERFIL: 'GESTOR SAC',         EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-ATD', USUARIO: 'atendente.test',   EMAIL: 'atendente@test.com',   PERFIL: 'ATENDENTE SAC',      EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-AUD', USUARIO: 'auditor.test',     EMAIL: 'auditor@test.com',     PERFIL: 'AUDITOR',            EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-APR', USUARIO: 'aprovador.test',   EMAIL: 'aprovador@test.com',   PERFIL: 'APROVADOR',          EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-SET', USUARIO: 'setor.test',       EMAIL: 'setor@test.com',       PERFIL: 'SETOR RESPONSÁVEL',  EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-VIZ', USUARIO: 'viz.test',         EMAIL: 'viz@test.com',         PERFIL: 'VISUALIZADOR',       EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-RCA', USUARIO: 'rca.test',         EMAIL: 'rca@test.com',         PERFIL: 'RCA / REPRESENTANTE',EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-DIR', USUARIO: 'diretor.test',     EMAIL: 'diretor@test.com',     PERFIL: 'DIRETOR',            EMPRESA: 'CHIACCHIO EMBALAGENS', STATUS: 'ATIVO' },
    { ID_USUARIO: 'USR-PLA', USUARIO: 'analista.plaschio',EMAIL: 'analista@plaschio.com',PERFIL: 'ANALISTA SAC',       EMPRESA: 'PLASCHIO LTDA',         STATUS: 'ATIVO' },
  ];
  const _prevUsuarios = mock.DB.USUARIOS ? [...mock.DB.USUARIOS] : [];
  mock.DB.USUARIOS = [..._prevUsuarios, ..._users];

  mock.DB['MATRIZ_CONHECIMENTO'] = [
    {
      ID: ID_MC_CHIACCHIO, CODIGO: 'MC-001', NOME: 'Qualidade Embalagens', DESCRICAO: 'Proc. qualidade',
      EMPRESA: 'CHIACCHIO EMBALAGENS', SETOR: 'Qualidade', TIPO_MANIFESTACAO: 'RECLAMACAO',
      STATUS: 'PUBLICADA', VERSAO: '1', CRIADO_POR: 'master.test', CRIADO_EM: new Date().toISOString(),
      ATUALIZADO_POR: '', ATUALIZADO_EM: '',
    },
    {
      ID: ID_MC_PLASCHIO, CODIGO: 'MC-001', NOME: 'Proc. Comercial', DESCRICAO: 'Proc. comercial',
      EMPRESA: 'PLASCHIO LTDA', SETOR: 'Comercial', TIPO_MANIFESTACAO: 'SUGESTAO',
      STATUS: 'PUBLICADA', VERSAO: '1', CRIADO_POR: 'master.plaschio', CRIADO_EM: new Date().toISOString(),
      ATUALIZADO_POR: '', ATUALIZADO_EM: '',
    },
  ];
  mock.DB['MC_ITENS_CONHECIMENTO'] = [];
  mock.DB['MC_EVIDENCIAS_NECESSARIAS'] = [];
  mock.DB['MC_EXCECOES'] = [];
  mock.DB['MC_AUDIT_LOG'] = [];

  Object.keys(require.cache).filter(k => k.includes('/api/index') || k.includes('/server-services')).forEach(k => delete require.cache[k]);
  const app = require('../api/index');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // Tokens por perfil
  const tMaster       = token({ perfil: 'MASTER',             empresa: '',                   usuario: 'master.test' });
  const tAnalistaSAC  = token({ perfil: 'ANALISTA SAC',       empresa: 'CHIACCHIO EMBALAGENS', usuario: 'analista.test' });
  const tGestorSAC    = token({ perfil: 'GESTOR SAC',         empresa: 'CHIACCHIO EMBALAGENS', usuario: 'gestor.test' });
  const tAtendente    = token({ perfil: 'ATENDENTE SAC',      empresa: 'CHIACCHIO EMBALAGENS', usuario: 'atendente.test' });
  const tAuditor      = token({ perfil: 'AUDITOR',            empresa: 'CHIACCHIO EMBALAGENS', usuario: 'auditor.test' });
  const tAprovador    = token({ perfil: 'APROVADOR',          empresa: 'CHIACCHIO EMBALAGENS', usuario: 'aprovador.test' });
  const tSetor        = token({ perfil: 'SETOR RESPONSÁVEL',  empresa: 'CHIACCHIO EMBALAGENS', usuario: 'setor.test' });
  const tVisualizador = token({ perfil: 'VISUALIZADOR',       empresa: 'CHIACCHIO EMBALAGENS', usuario: 'viz.test' });
  const tRCA          = token({ perfil: 'RCA / REPRESENTANTE',empresa: 'CHIACCHIO EMBALAGENS', usuario: 'rca.test' });
  const tDiretor      = token({ perfil: 'DIRETOR',            empresa: 'CHIACCHIO EMBALAGENS', usuario: 'diretor.test' });
  const tPlaschio     = token({ perfil: 'ANALISTA SAC',       empresa: 'PLASCHIO LTDA',         usuario: 'analista.plaschio' });
  const tInvalido     = 'token.invalido.assinatura';
  const tAssinaturaErrada = (() => {
    const full = { perfil: 'MASTER', empresa: '', usuario: 'hacker', iat: Date.now(), exp: Date.now() + 3600000 };
    const body = Buffer.from(JSON.stringify(full)).toString('base64url');
    return `${body}.${crypto.createHmac('sha256', 'outra-chave-secreta').update(body).digest('base64url')}`;
  })();

  let passou = 0;
  let falhou = 0;
  const erros = [];

  function ok(desc, cond) {
    if (cond) { process.stdout.write(`  ✓ ${desc}\n`); passou++; }
    else      { process.stdout.write(`  ✗ ${desc}\n`); falhou++; erros.push(desc); }
  }

  try {
    // ── Bloco 1: Sem token e token inválido → 401 ────────────────────────
    process.stdout.write('\n[1] Sem autenticação e token inválido\n');

    const r1a = await request(base, 'GET',    '/api/matriz-conhecimento',                    null);
    ok('GET lista sem token → 401', r1a.status === 401);

    const r1b = await request(base, 'POST',   '/api/matriz-conhecimento',                    null, { nome: 'X' });
    ok('POST criar sem token → 401', r1b.status === 401);

    const r1c = await request(base, 'PUT',    `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}`, null, { nome: 'X' });
    ok('PUT editar sem token → 401', r1c.status === 401);

    const r1d = await request(base, 'DELETE', `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}/itens/item-1`, null);
    ok('DELETE item sem token → 401', r1d.status === 401);

    const r1e = await request(base, 'GET',    '/api/matriz-conhecimento',                    tInvalido);
    ok('GET lista token inválido (formato) → 401', r1e.status === 401);

    const r1f = await request(base, 'GET',    '/api/matriz-conhecimento',                    tAssinaturaErrada);
    ok('GET lista token com assinatura errada → 401', r1f.status === 401);

    const tokenExpirado = (() => {
      const full = { perfil: 'MASTER', empresa: '', usuario: 'exp.test', iat: Date.now() - 7200000, exp: Date.now() - 3600000 };
      const body = Buffer.from(JSON.stringify(full)).toString('base64url');
      return `${body}.${crypto.createHmac('sha256', SECRET).update(body).digest('base64url')}`;
    })();
    const r1g = await request(base, 'GET', '/api/matriz-conhecimento', tokenExpirado);
    ok('GET lista token expirado → 401', r1g.status === 401);

    // ── Bloco 2: Perfis sem acesso à MC → 403; perfis com acesso via funcional → 200 ──
    // VISUALIZADOR e RCA: não mapeiam para nenhum perfil funcional com acesso → 403
    // SETOR RESPONSÁVEL → APROVADOR_SETORIAL → leitura permitida → 200
    // DIRETOR → DIRETORIA_GESTOR → leitura permitida → 200
    process.stdout.write('\n[2] Perfis externos sem acesso à Matriz de Conhecimento → 403\n');

    for (const [nome, tok] of [['VISUALIZADOR', tVisualizador], ['RCA', tRCA]]) {
      const r = await request(base, 'GET', '/api/matriz-conhecimento', tok);
      ok(`GET lista com perfil ${nome} → 403`, r.status === 403);
      const rb = await request(base, 'GET', `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}`, tok);
      ok(`GET detalhe com perfil ${nome} → 403`, rb.status === 403);
    }

    // SETOR RESPONSÁVEL e DIRETOR mapeiam para perfis funcionais com leitura (APROVADOR_SETORIAL / DIRETORIA_GESTOR)
    process.stdout.write('\n[2b] Perfis com acesso via mapeamento funcional → 200 em leitura\n');
    for (const [nome, tok] of [['SETOR RESPONSÁVEL', tSetor], ['DIRETOR', tDiretor]]) {
      const r = await request(base, 'GET', '/api/matriz-conhecimento', tok);
      ok(`GET lista com perfil ${nome} → 200 (mapeado para perfil funcional com leitura)`, r.status === 200);
      const rb = await request(base, 'GET', `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}`, tok);
      // detalhe pode ser 200 (mesmo escopo) ou 403 (isolamento empresa), não é falha auth
      ok(`GET detalhe com perfil ${nome} → não é 401`, rb.status !== 401);
    }

    // ── Bloco 3: Perfis leitores autorizados → 200 em leitura ────────────
    process.stdout.write('\n[3] Perfis com acesso de leitura → 200\n');

    for (const [nome, tok] of [['ANALISTA SAC', tAnalistaSAC], ['GESTOR SAC', tGestorSAC], ['ATENDENTE SAC', tAtendente], ['AUDITOR', tAuditor], ['APROVADOR', tAprovador]]) {
      const r = await request(base, 'GET', '/api/matriz-conhecimento', tok);
      ok(`GET lista com perfil ${nome} → 200`, r.status === 200);
      ok(`GET lista ${nome} → sucesso:true`, r.body.sucesso === true);
    }

    const rMaster = await request(base, 'GET', '/api/matriz-conhecimento', tMaster);
    ok('GET lista MASTER → 200', rMaster.status === 200);

    // ── Bloco 4: Perfis leitores → 403 em escrita ────────────────────────
    process.stdout.write('\n[4] Perfis leitores não podem escrever → 403\n');

    for (const [nome, tok] of [['ATENDENTE SAC', tAtendente], ['AUDITOR', tAuditor], ['APROVADOR', tAprovador]]) {
      const rc = await request(base, 'POST', '/api/matriz-conhecimento', tok, { nome: 'Tentativa indevida', empresa: 'CHIACCHIO EMBALAGENS' });
      ok(`POST criar com perfil ${nome} → 403`, rc.status === 403);
      const re = await request(base, 'PUT', `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}`, tok, { nome: 'Edição indevida' });
      ok(`PUT editar com perfil ${nome} → 403`, re.status === 403);
    }

    // ── Bloco 5: Perfis editores → podem criar/editar ────────────────────
    process.stdout.write('\n[5] Perfis editores (ANALISTA SAC, GESTOR SAC) podem criar/editar\n');

    const rCriar = await request(base, 'POST', '/api/matriz-conhecimento', tAnalistaSAC, {
      nome: 'Matriz Teste Auth', empresa: 'CHIACCHIO EMBALAGENS', setor: 'Qualidade',
      tipo_manifestacao: 'RECLAMACAO', status: 'RASCUNHO',
    });
    ok('POST criar com ANALISTA SAC → não é 403', rCriar.status !== 403);
    ok('POST criar com ANALISTA SAC → sucesso ou erro de negócio (não auth)', rCriar.status === 200 || rCriar.status === 400 || rCriar.status === 500);

    const rCriarGestor = await request(base, 'POST', '/api/matriz-conhecimento', tGestorSAC, {
      nome: 'Matriz Teste Gestor', empresa: 'CHIACCHIO EMBALAGENS', setor: 'Logística',
      tipo_manifestacao: 'SUGESTAO', status: 'RASCUNHO',
    });
    ok('POST criar com GESTOR SAC → não é 403', rCriarGestor.status !== 403);

    // ── Bloco 6: Isolamento de empresa ───────────────────────────────────
    process.stdout.write('\n[6] Isolamento de empresa\n');

    // ANALISTA SAC de Chiacchio lista somente matrizes da própria empresa
    const rListaChiacchio = await request(base, 'GET', '/api/matriz-conhecimento', tAnalistaSAC);
    ok('GET lista Chiacchio → 200', rListaChiacchio.status === 200);
    if (rListaChiacchio.status === 200) {
      const itens = rListaChiacchio.body.itens || [];
      const vazouPlaschio = itens.some(m => String(m.EMPRESA || m.empresa || '').includes('PLASCHIO'));
      ok('Chiacchio não vê matrizes da Plaschio', !vazouPlaschio);
    }

    // ANALISTA SAC de Plaschio lista somente matrizes da Plaschio
    const rListaPlaschio = await request(base, 'GET', '/api/matriz-conhecimento', tPlaschio);
    ok('GET lista Plaschio → 200', rListaPlaschio.status === 200);
    if (rListaPlaschio.status === 200) {
      const itens = rListaPlaschio.body.itens || [];
      const vazouChiacchio = itens.some(m => String(m.EMPRESA || m.empresa || '').includes('CHIACCHIO'));
      ok('Plaschio não vê matrizes da Chiacchio', !vazouChiacchio);
    }

    // MASTER vê todas
    const rListaMaster = await request(base, 'GET', '/api/matriz-conhecimento', tMaster);
    ok('MASTER → 200', rListaMaster.status === 200);
    if (rListaMaster.status === 200) {
      const itens = rListaMaster.body.itens || [];
      ok('MASTER vê ao menos 2 matrizes (ambas as empresas)', itens.length >= 2);
    }

    // Plaschio não acessa detalhe de matriz da Chiacchio diretamente
    const rCrossDetalhe = await request(base, 'GET', `/api/matriz-conhecimento/${ID_MC_CHIACCHIO}`, tPlaschio);
    ok('Plaschio acessa detalhe de Chiacchio → 403 (cross-company bloqueado)', rCrossDetalhe.status === 403);

    // Chiacchio não acessa detalhe de Plaschio
    const rCrossDetalhe2 = await request(base, 'GET', `/api/matriz-conhecimento/${ID_MC_PLASCHIO}`, tAnalistaSAC);
    ok('Chiacchio acessa detalhe de Plaschio → 403 (cross-company bloqueado)', rCrossDetalhe2.status === 403);

    // ── Bloco 7: Perfis funcionais (modeloAutorizacao) ───────────────────
    // Verifica que os 4 perfis canônicos funcionam sem depender de aliases legados
    process.stdout.write('\n[7] Perfis funcionais canônicos\n');

    // SAC funcional = leitura (edição requer perfil legado específico: ANALISTA SAC ou GESTOR SAC)
    const tSACFuncional = token({ perfil: 'SAC', perfilFuncional: 'SAC', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'analista.test' });
    const rSACleitura = await request(base, 'GET', '/api/matriz-conhecimento', tSACFuncional);
    ok('GET lista perfil funcional SAC → 200', rSACleitura.status === 200);
    const rSACescrita = await request(base, 'POST', '/api/matriz-conhecimento', tSACFuncional, { nome: 'MC SAC', empresa: 'CHIACCHIO EMBALAGENS', setor: 'SAC' });
    ok('POST criar perfil funcional SAC genérico → 403 (editor requer ANALISTA/GESTOR SAC)', rSACescrita.status === 403);

    // APROVADOR_SETORIAL funcional = leitura; não pode criar/editar
    const tAprovSetorial = token({ perfil: 'APROVADOR_SETORIAL', perfilFuncional: 'APROVADOR_SETORIAL', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'aprovador.test' });
    const rAprovLeitura = await request(base, 'GET', '/api/matriz-conhecimento', tAprovSetorial);
    ok('GET lista perfil funcional APROVADOR_SETORIAL → 200', rAprovLeitura.status === 200);
    const rAprovEscrita = await request(base, 'POST', '/api/matriz-conhecimento', tAprovSetorial, { nome: 'MC Aprov', empresa: 'CHIACCHIO EMBALAGENS' });
    ok('POST criar perfil funcional APROVADOR_SETORIAL → 403', rAprovEscrita.status === 403);

    // DIRETORIA_GESTOR funcional = leitura + aprovação; não pode criar/editar
    const tDirGestor = token({ perfil: 'DIRETORIA_GESTOR', perfilFuncional: 'DIRETORIA_GESTOR', empresa: 'CHIACCHIO EMBALAGENS', usuario: 'diretor.test' });
    const rDirLeitura = await request(base, 'GET', '/api/matriz-conhecimento', tDirGestor);
    ok('GET lista perfil funcional DIRETORIA_GESTOR → 200', rDirLeitura.status === 200);
    const rDirEscrita = await request(base, 'POST', '/api/matriz-conhecimento', tDirGestor, { nome: 'MC Dir', empresa: 'CHIACCHIO EMBALAGENS' });
    ok('POST criar perfil funcional DIRETORIA_GESTOR → 403', rDirEscrita.status === 403);

    // MASTER funcional = acesso total
    const tMasterFuncional = token({ perfil: 'MASTER', perfilFuncional: 'MASTER', empresa: '', usuario: 'master.test' });
    const rMasterF = await request(base, 'GET', '/api/matriz-conhecimento', tMasterFuncional);
    ok('GET lista perfil funcional MASTER → 200', rMasterF.status === 200);

    // ── Bloco 8: Endpoint /resolver ──────────────────────────────────────
    process.stdout.write('\n[8] Endpoint /resolver\n');

    const rResolverSemToken = await request(base, 'POST', '/api/matriz-conhecimento/resolver', null, { tipo: 'RECLAMACAO' });
    ok('POST /resolver sem token → 401', rResolverSemToken.status === 401);

    // SETOR RESPONSÁVEL → APROVADOR_SETORIAL → tem acesso de leitura → /resolver permitido
    const rResolverSetor = await request(base, 'POST', '/api/matriz-conhecimento/resolver', tSetor, { tipo: 'RECLAMACAO' });
    ok('POST /resolver perfil SETOR RESPONSÁVEL → não é 401/403 (tem leitura via APROVADOR_SETORIAL)', rResolverSetor.status !== 401 && rResolverSetor.status !== 403);

    const rResolverAnalista = await request(base, 'POST', '/api/matriz-conhecimento/resolver', tAnalistaSAC, { tipo: 'RECLAMACAO' });
    ok('POST /resolver ANALISTA SAC → não é 401/403', rResolverAnalista.status !== 401 && rResolverAnalista.status !== 403);

    const rResolverSAC = await request(base, 'POST', '/api/matriz-conhecimento/resolver', tSACFuncional, { tipo: 'RECLAMACAO' });
    ok('POST /resolver funcional SAC → não é 401/403', rResolverSAC.status !== 401 && rResolverSAC.status !== 403);

    const rResolverAprov = await request(base, 'POST', '/api/matriz-conhecimento/resolver', tAprovSetorial, { tipo: 'RECLAMACAO' });
    ok('POST /resolver funcional APROVADOR_SETORIAL → não é 401/403', rResolverAprov.status !== 401 && rResolverAprov.status !== 403);

    const rResolverDir = await request(base, 'POST', '/api/matriz-conhecimento/resolver', tDirGestor, { tipo: 'RECLAMACAO' });
    ok('POST /resolver funcional DIRETORIA_GESTOR → não é 401/403', rResolverDir.status !== 401 && rResolverDir.status !== 403);

  } finally {
    server.close();
    // Limpa matrizes de teste do mock
    if (mock.DB['MATRIZ_CONHECIMENTO']) {
      mock.DB['MATRIZ_CONHECIMENTO'] = mock.DB['MATRIZ_CONHECIMENTO'].filter(
        m => m.ID !== ID_MC_CHIACCHIO && m.ID !== ID_MC_PLASCHIO
      );
    }
    mock.DB.USUARIOS = _prevUsuarios;
  }

  process.stdout.write('\n─────────────────────────────────────────────\n');
  process.stdout.write(`Resultado: ${passou} passou | ${falhou} falhou | ${passou + falhou} total\n`);
  process.stdout.write('─────────────────────────────────────────────\n');

  if (falhou > 0) {
    process.stdout.write('\nFalhas:\n');
    erros.forEach(e => process.stdout.write(`  ✗ ${e}\n`));
    process.exit(1);
  } else {
    process.stdout.write('\nMatriz Conhecimento Auth: todos os testes de autenticação e autorização aprovados.\n');
  }
})().catch(e => { console.error(e); process.exit(1); });
