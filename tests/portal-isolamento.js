"use strict";
const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { build } = require("../portal-cliente/scripts/build");
const { createPortalApp } = require("../scripts/dev-portal");
const policy = require("../portal-cliente/policy");
const addressFactory = require("../server-services/portalEndereco");
const secret = "isolation-test-secret-01234567890123456789";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = secret;
process.env.PG_LEITURA_ATIVA = "false";
process.env.SHEETS_MOCK_PATH = path.join(__dirname, "sheets-mock.js");
process.env.PORTAL_PUBLIC_URL = "https://portal-cliente-gpchiacchio.vercel.app";
delete process.env.DATABASE_URL;
const mock = require("./sheets-mock");
const folder = fs.mkdtempSync(path.join(os.tmpdir(), "portal-isolamento-"));
let internal,
  portal,
  base,
  inside,
  passed = 0,
  failed = 0,
  ip = 30,
  protocol;
function auth(perfil = "MASTER", empresa = "MASTER", usuario = "master.test") {
  const body = Buffer.from(
    JSON.stringify({ perfil, empresa, usuario, exp: Date.now() + 3600000 }),
  ).toString("base64url");
  return (
    body +
    "." +
    crypto.createHmac("sha256", secret).update(body).digest("base64url")
  );
}
async function request(origin, method, url, body, token, address) {
  const response = await fetch(origin + url, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "X-Forwarded-For": address || "192.0.2." + ip++,
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const content = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    parsed = content;
  }
  return { status: response.status, body: parsed, headers: response.headers };
}
async function test(name, run) {
  try {
    await run();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.error("  ✗ " + name + ": " + e.stack);
  }
}
async function serve(app) {
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return server;
}
(async () => {
  try {
    build(folder);
    internal = await serve(require("../api/index"));
    inside = "http://127.0.0.1:" + internal.address().port;
    portal = await serve(
      createPortalApp({ backendUrl: inside, outputDir: folder }),
    );
    base = "http://127.0.0.1:" + portal.address().port;
    await test("artefato público contém somente arquivos permitidos e o HTML original do portal", async () => {
      assert.deepEqual(fs.readdirSync(folder).sort(), [
        "404.html",
        "assets",
        "index.html",
      ]);
      assert.deepEqual(
        fs.readdirSync(path.join(folder, "assets")).sort(),
        [...policy.assets].sort(),
      );
      assert.equal(
        fs.readFileSync(path.join(folder, "index.html"), "utf8"),
        fs.readFileSync(path.join(__dirname, "../public/portal.html"), "utf8"),
      );
      for (const asset of [
        "pesquisas-admin.js",
        "portal-links.js",
        "index.html",
        "api/index.js",
        ".env",
      ])
        assert.ok(!fs.existsSync(path.join(folder, "assets", asset)));
      const data = fs.readFileSync(path.join(folder, "index.html"), "utf8");
      assert.ok(!data.includes("login-screen"));
      assert.ok(!data.includes("DATABASE_URL"));
      assert.ok(!data.includes("OPENAI_API_KEY"));
      assert.ok(!data.includes("ANTHROPIC_API_KEY"));
    });
    await test("raiz pública, caminhos de pesquisas e retirada do caminho exibem somente o portal", async () => {
      for (const url of [
        "/",
        "/index.html",
        "/portal",
        "/portal.html",
        "/pesquisas/chiacchio",
        "/portal/pesquisas/plaschio",
        "/pesquisa/tubahia",
        "/pesquisa?t=legado-token",
      ]) {
        const r = await request(base, "GET", url);
        assert.equal(r.status, 200, url);
        assert.match(r.body, /<title>Portal do Cliente/);
        assert.ok(!r.body.includes("login-screen"));
      }
      assert.equal((await request(base, "GET", "/")).status, 200);
    });
    await test("projeto público bloqueia páginas, código e APIs internos mesmo com token Master", async () => {
      for (const url of [
        "/admin/portal",
        "/login",
        "/dashboard",
        "/fichas.html",
        "/assets/pesquisas-admin.js",
        "/assets/portal-links.js",
        "/.env",
        "/api/manifestacoes",
        "/api/portal-admin/config",
        "/api/auth/login",
        "/api/portal/endereco",
        "/api/public/solicitar-acesso",
        "/api/public/whatsapp/interno",
        "/api/public/pesquisas/chiacchio/interno",
        "/api/public/pesquisas/%2e%2e%2fauth%2flogin",
      ]) {
        const r = await request(base, "GET", url, undefined, auth());
        assert.equal(r.status, 404, url);
        assert.ok(!String(r.body).includes("login-screen"));
      }
      assert.equal(
        (
          await request(base, "POST", "/api/auth/login", {
            usuario: "master.test",
            senha: "masterPass",
          })
        ).status,
        404,
      );
      assert.equal(
        (await request(base, "POST", "/api/public/whatsapp", {})).status,
        404,
      );
      assert.equal(
        (
          await request(
            base,
            "DELETE",
            "/api/public/pesquisas/chiacchio",
            {},
            auth(),
          )
        ).status,
        404,
      );
    });
    await test("destinos públicos são fixos e usam capturas restritas, sem proxy administrativo genérico", async () => {
      const routes = require("../portal-cliente/vercel.json").routes.filter(
        (r) => r.dest?.startsWith("https:"),
      );
      assert.equal(routes.length, policy.apiRoutes.length);
      for (const route of routes) {
        assert.ok(route.dest.startsWith(policy.backend + "/api/"));
        assert.ok(!route.dest.includes("("));
        assert.ok(!route.src.includes(".*"));
        assert.ok(route.methods.length === 1);
      }
      assert.throws(() =>
        createPortalApp({
          backendUrl: "https://example.com",
          outputDir: folder,
        }),
      );
      // Configurações externas inválidas não derrubam o servidor: o módulo
      // volta para a rota interna, sem aceitar a URL insegura como destino.
      for (const publicUrl of [
        "https://example.com/private",
        "https://user:pass@example.com",
        inside,
      ]) {
        const fallback = addressFactory({ appUrl: inside, publicUrl });
        assert.equal(fallback.separado, false);
        assert.equal(fallback.root, inside + "/portal");
      }
      const legacy = addressFactory({ appUrl: inside });
      assert.equal(legacy.root, inside + "/portal");
      assert.equal(
        legacy.survey("chiacchio"),
        inside + "/portal/pesquisas/chiacchio",
      );
    });
    await test("projeto interno mantém login e exige sessão nas APIs administrativas", async () => {
      const root = await request(inside, "GET", "/");
      assert.equal(root.status, 200);
      assert.match(root.body, /id="login-screen"/);
      for (const url of [
        "/api/manifestacoes",
        "/api/pesquisas/formularios",
        "/api/portal-admin/config",
        "/api/portal/endereco",
      ])
        assert.equal((await request(inside, "GET", url)).status, 401, url);
      const login = await request(inside, "POST", "/api/auth/login", {
        usuario: "ana.chiacchio",
        senha: "senhaChia",
      });
      assert.equal(login.status, 200);
      assert.ok(login.body.token);
      const forbidden = await request(
        inside,
        "GET",
        "/api/portal-admin/config",
        undefined,
        login.body.token,
      );
      // O bloqueio de onboarding ocorre antes da autorização administrativa.
      // Depois de concluir o perfil, a mesma conta deve receber 403 por não
      // possuir permissão para administrar o portal.
      assert.equal(forbidden.status, 428);
      const perfil = await request(
        inside,
        "PATCH",
        "/api/meu-perfil",
        { descricaoFuncao: "Analista SAC", responsabilidades: ["Atendimento"], concluir: true },
        login.body.token,
      );
      assert.equal(perfil.status, 200);
      assert.equal(perfil.body.completo, true);
      const forbiddenAfterOnboarding = await request(
        inside,
        "GET",
        "/api/portal-admin/config",
        undefined,
        perfil.body.token,
      );
      assert.equal(forbiddenAfterOnboarding.status, 403);
      assert.equal(
        (
          await request(
            inside,
            "GET",
            "/api/manifestacoes",
            undefined,
            perfil.body.token,
          )
        ).status,
        200,
      );
    });
    await test("administração, pesquisas e convites geram URLs no domínio independente", async () => {
      const address = await request(
        inside,
        "GET",
        "/api/portal/endereco",
        undefined,
        auth(),
      );
      assert.equal(address.body.url, process.env.PORTAL_PUBLIC_URL);
      assert.equal(address.body.separado, true);
      const manager = await request(
        inside,
        "GET",
        "/api/portal-admin/visao-geral",
        undefined,
        auth(),
      );
      assert.equal(manager.body.enderecoPublico, process.env.PORTAL_PUBLIC_URL);
      const forms = await request(
        inside,
        "GET",
        "/api/pesquisas/formularios",
        undefined,
        auth(),
      );
      assert.equal(
        forms.body.itens[0].url,
        process.env.PORTAL_PUBLIC_URL + "/pesquisas/chiacchio",
      );
      const invitation = await request(
        inside,
        "POST",
        "/api/pesquisas/tokens/gerar",
        { empresa: "CHIACCHIO", nome_cliente: "Convidado externo" },
        auth(),
      );
      assert.equal(invitation.status, 200);
      assert.ok(
        invitation.body.link.startsWith(
          process.env.PORTAL_PUBLIC_URL + "/pesquisas/chiacchio?convite=",
        ),
      );
      const tokens = await request(
        inside,
        "GET",
        "/api/pesquisas/tokens",
        undefined,
        auth(),
      );
      assert.ok(
        tokens.body.itens.some(
          (t) =>
            t.link ===
            process.env.PORTAL_PUBLIC_URL +
              "/pesquisa/" +
              invitation.body.token,
        ),
      );
    });
    await test("reclamação do segundo ambiente chega à mesma base, fila e consulta no SAC", async () => {
      const result = await request(base, "POST", "/api/public/reclamacoes", {
        origem: "PORTAL_PUBLICO",
        empresa: "CHIACCHIO",
        tipoCliente: "direto",
        nomeCliente: "Cliente externo",
        colaboradorRecebimento: "Cliente externo",
        setorRecebimento: "Portal do Cliente",
        descricaoOriginal: "Teste de integração entre os dois ambientes",
        motivoManifestacao: "Qualidade",
        email: "cliente@example.test",
        telefone: "(11) 99999-1234",
      });
      assert.equal(result.status, 200);
      protocol = result.body.protocolo;
      const id = result.body.id;
      assert.match(protocol, /^CHIA-\d{8}-\d{2}-\d{4}$/);
      assert.ok(id);
      assert.ok(
        mock.DB.MANIFESTACOES.some(
          (m) =>
            m.ID_MANIFESTACAO === id && m.PROTOCOLO === protocol && m.ORIGEM === "PORTAL_PUBLICO",
        ),
      );
      assert.ok(
        mock.DB.FILA_APROVACAO.some(
          (m) => m.ID_ENTIDADE === id && m.STATUS === "PENDENTE",
        ),
      );
      const list = await request(
        inside,
        "GET",
        "/api/manifestacoes",
        undefined,
        auth(),
      );
      assert.ok(list.body.itens.some((m) => m.ID_MANIFESTACAO === id && m.PROTOCOLO === protocol));
      const status = await request(
        base,
        "POST",
        "/api/public/protocolo/consultar",
        { protocolo: protocol },
      );
      assert.equal(status.status, 200);
      assert.equal(status.body.status, "Recebida");
      assert.equal(
        (await request(base, "GET", "/api/public/protocolo/" + protocol))
          .status,
        200,
      );
    });
    await test("resposta pública de pesquisa usa a mesma versão e os mesmos indicadores internos", async () => {
      const survey = await request(
        base,
        "GET",
        "/api/public/pesquisas/chiacchio",
      );
      assert.equal(survey.status, 200);
      const form = survey.body.formulario;
      const result = await request(
        base,
        "POST",
        "/api/pesquisas/resposta-portal",
        {
          formularioId: form.id,
          versaoId: form.versaoId,
          envioId: "isolated-request-001",
          respostas: { recomendacao: 0, qualidade: 9 },
        },
      );
      assert.equal(result.status, 200);
      const answer = mock.DB.PESQUISA_RESPOSTAS.find(
        (r) => r.ID_RESPOSTA === result.body.id,
      );
      assert.ok(answer);
      assert.equal(answer.RECOMENDACAO, "0");
      assert.equal(answer.VERSAO_ID, form.versaoId);
      const results = await request(
        inside,
        "GET",
        "/api/pesquisas/formularios/resultados?formularioId=chiacchio",
        undefined,
        auth(),
      );
      assert.equal(results.body.nps, -100);
      assert.ok(
        results.body.itens.some((r) => r.ID_RESPOSTA === result.body.id),
      );
    });
    await test("consulta protege protocolos antigos sem apagar histórico nem expor contato", async () => {
      const old = {
        ID_MANIFESTACAO: "MAN-ANTIGO-001",
        EMPRESA_RECLAMADA: "CHIACCHIO",
        EMAIL: "antigo@example.test",
        TELEFONE: "+55 (11) 98888-7777",
        STATUS: "EM TRATAMENTO",
        DESCRICAO: "segredo interno",
        CAUSA_RAIZ: "confidencial",
      };
      mock.DB.MANIFESTACOES.push(old);
      const snapshot = JSON.stringify(old);
      assert.equal(
        (await request(base, "GET", "/api/public/protocolo/MAN-ANTIGO-001"))
          .status,
        404,
      );
      const denied = await request(
        base,
        "POST",
        "/api/public/protocolo/consultar",
        {
          protocolo: old.ID_MANIFESTACAO,
          identificador: "errado@example.test",
        },
      );
      assert.equal(denied.status, 404);
      const missing = await request(
        base,
        "POST",
        "/api/public/protocolo/consultar",
        { protocolo: "MAN-INEXISTENTE", identificador: "errado@example.test" },
      );
      assert.deepEqual(missing.body, denied.body);
      for (const identificador of ["ANTIGO@example.test", "(11) 98888-7777"]) {
        const allowed = await request(
          base,
          "POST",
          "/api/public/protocolo/consultar",
          { protocolo: old.ID_MANIFESTACAO, identificador },
        );
        assert.equal(allowed.status, 200);
        assert.equal(allowed.body.status, "Em tratamento");
        for (const field of [
          "EMAIL",
          "TELEFONE",
          "DESCRICAO",
          "CAUSA_RAIZ",
          "NOME_CLIENTE",
        ])
          assert.ok(!(field in allowed.body));
        assert.equal(allowed.headers.get("cache-control"), "no-store");
      }
      assert.equal(JSON.stringify(old), snapshot);
      assert.equal(
        (
          await request(
            base,
            "GET",
            "/api/public/protocolo/MAN-ANTIGO-001?identificador=antigo@example.test",
          )
        ).status,
        404,
      );
    });
    await test("somente a devolutiva efetivamente liberada após encerramento aparece no portal", async () => {
      const man = mock.DB.MANIFESTACOES.find(
        (m) => m.PROTOCOLO === protocol,
      );
      Object.assign(man, {
        DEVOLUTIVA_ENVIADA: "Resposta aprovada pelo SAC",
        DEVOLUTIVA_SUGERIDA: "rascunho confidencial",
        CAUSA_RAIZ: "análise confidencial",
      });
      assert.equal(
        (await request(base, "GET", "/api/public/protocolo/" + protocol)).body
          .devolutiva,
        "",
      );
      man.STATUS = "ENCERRADA";
      const result = await request(
        base,
        "GET",
        "/api/public/protocolo/" + protocol,
      );
      assert.equal(result.status, 200);
      assert.equal(result.body.devolutiva, "Resposta aprovada pelo SAC");
      assert.ok(!JSON.stringify(result.body).includes("confidencial"));
    });
    await test("configurações internas continuam refletidas no portal e rate limit permanece", async () => {
      const configured = await request(
        inside,
        "POST",
        "/api/portal-admin/config",
        { tipo: "WHATSAPP", valor: "5511999998888", ativo: "SIM" },
        auth(),
      );
      assert.equal(configured.status, 200);
      const publicConfig = await request(base, "GET", "/api/public/whatsapp");
      assert.equal(publicConfig.body.numero, "5511999998888");
      assert.ok(!("UPDATED_BY" in publicConfig.body));
      const address = "203.0.113.189";
      for (let n = 0; n < 5; n++)
        assert.equal(
          (
            await request(
              base,
              "GET",
              "/api/public/whatsapp",
              undefined,
              undefined,
              address,
            )
          ).status,
          200,
        );
      assert.equal(
        (
          await request(
            base,
            "GET",
            "/api/public/whatsapp",
            undefined,
            undefined,
            address,
          )
        ).status,
        429,
      );
      const headers = (await request(base, "GET", "/")).headers;
      assert.match(
        headers.get("content-security-policy"),
        /connect-src 'self'/,
      );
      assert.equal(headers.get("referrer-policy"), "no-referrer");
      assert.equal(headers.get("x-frame-options"), "DENY");
    });
  } catch (e) {
    failed++;
    console.error(e.stack);
  } finally {
    for (const server of [portal, internal])
      if (server) {
        server.closeAllConnections();
        await new Promise((r) => server.close(r));
      }
    fs.rmSync(folder, { recursive: true, force: true });
    console.log(`ISOLAMENTO: ${passed} passou | ${failed} falhou`);
    process.exitCode = failed ? 1 : 0;
  }
})();
