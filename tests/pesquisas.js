"use strict";
const assert = require("assert/strict"),
  http = require("http"),
  crypto = require("crypto"),
  path = require("path");
const secret = "pesquisas-http-test-secret-0123456789-abcdef";
process.env.NODE_ENV = "test";
process.env.SESSION_SECRET = secret;
process.env.PG_LEITURA_ATIVA = "false";
process.env.SHEETS_MOCK_PATH = path.join(__dirname, "sheets-mock.js");
delete process.env.DATABASE_URL;
const mock = require("./sheets-mock");
const legacyQuestions = [
  {
    id: "nps",
    tipo: "NPS",
    label: "Recomendaria a empresa?",
    obrigatorio: true,
  },
  {
    id: "qualidade",
    tipo: "ESCALA",
    label: "Qualidade dos produtos",
    obrigatorio: true,
  },
  {
    id: "prazo",
    tipo: "ESCALA",
    label: "Prazo de entrega",
    obrigatorio: false,
  },
  {
    id: "atendimento",
    tipo: "ESCALA",
    label: "Atendimento",
    obrigatorio: false,
  },
  { id: "comentario", tipo: "TEXTO", label: "Comentário", obrigatorio: false },
];
mock.DB.PESQUISA_QUESTIONARIO = [
  {
    ID_VERSAO: "QV-ANTIGA-CHI",
    STATUS: "PUBLICADA",
    EMPRESA: "CHIACCHIO",
    CRIADO_EM: "2025-01-01T00:00:00Z",
    PUBLICADO_EM: "2025-01-01T00:00:00Z",
    PERGUNTAS_JSON: JSON.stringify(legacyQuestions),
  },
];
mock.DB.PESQUISA_RESPOSTAS = [
  {
    ID_RESPOSTA: "RSP-HISTORICA",
    TOKEN: "",
    EMPRESA: "CHIACCHIO",
    NOME_CLIENTE: "Cliente histórico",
    DATA: "2025-01-01T12:00:00Z",
    ATENDIMENTO: "10",
    PRAZO_ENTREGA: "9",
    QUALIDADE: "10",
    RECOMENDACAO: "10",
    COMENTARIO: "Resposta antiga",
    NOTA_MEDIA: "9.8",
    NOTA_BAIXA: "NAO",
  },
];
const original = JSON.stringify(mock.DB.PESQUISA_RESPOSTAS[0]);
function token(perfil, empresa = "CHIACCHIO", usuario = "ana.chiacchio") {
  const body = Buffer.from(
    JSON.stringify({ perfil, empresa, usuario, exp: Date.now() + 3600000 }),
  ).toString("base64url");
  return (
    body +
    "." +
    crypto.createHmac("sha256", secret).update(body).digest("base64url")
  );
}
const master = token("MASTER", "Grupo Chiacchio", "master.test"),
  analyst = token("ANALISTA SAC"),
  director = token("DIRETOR");
let server,
  base,
  passed = 0,
  failed = 0,
  ip = 20;
async function request(method, url, auth, body, address) {
  const r = await fetch(base + url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(auth ? { Authorization: "Bearer " + auth } : {}),
      "X-Forwarded-For": address || "198.51.100." + ip++,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, body: await r.json() };
}
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log("  ✓ " + name);
  } catch (e) {
    failed++;
    console.error("  ✗ " + name + ": " + e.message);
  }
}
let initial, draft, published, responseId, invitation;
async function edit(action, data = {}) {
  const r = await request(
    "POST",
    "/api/pesquisas/formularios/chiacchio",
    analyst,
    { ...draft, ...data, baseId: draft.revision, acao: action },
  );
  assert.equal(r.status, 200, JSON.stringify(r.body));
  draft = r.body.formulario;
  return draft;
}
(async () => {
  try {
    server = http.createServer(require("../api/index"));
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = "http://127.0.0.1:" + server.address().port;
    await test("existentes são reutilizados sem alterar a resposta histórica", async () => {
      const r = await request("GET", "/api/pesquisas/formularios", analyst);
      assert.equal(r.status, 200);
      assert.equal(r.body.itens.length, 1);
      initial = r.body.itens[0];
      draft = initial;
      assert.equal(initial.publicada.revision, "QV-ANTIGA-CHI");
      assert.equal(initial.perguntas[0].id, "nps");
      assert.equal(JSON.stringify(mock.DB.PESQUISA_RESPOSTAS[0]), original);
    });
    await test("permissões e escopo valem também nas APIs antigas", async () => {
      assert.equal(
        (await request("GET", "/api/pesquisas/formularios")).status,
        401,
      );
      assert.equal(
        (await request("GET", "/api/pesquisas/formularios/plaschio", analyst))
          .status,
        403,
      );
      assert.equal(
        (await request("GET", "/api/questionarios/plaschio", analyst)).status,
        403,
      );
      assert.equal(
        (
          await request("POST", "/api/questionarios/plaschio", analyst, {
            perguntas: legacyQuestions,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await request(
            "POST",
            "/api/pesquisas/formularios/chiacchio",
            director,
            { ...draft, baseId: draft.revision },
          )
        ).status,
        403,
      );
      const r = await request("GET", "/api/pesquisas/formularios", director);
      assert.equal(r.status, 200);
      assert.equal(r.body.podeGerenciar, false);
    });
    await test("editar rascunho não muda a versão pública", async () => {
      const questions = structuredClone(draft.perguntas);
      questions[0].label = "Você recomendaria a nossa empresa?";
      questions.push({
        id: "detalhe",
        tipo: "TEXTO",
        label: "Como podemos melhorar?",
        obrigatorio: true,
        condicao: { perguntaId: "nps", operador: "LT", valor: 6 },
      });
      await edit("RASCUNHO", {
        perguntas: questions,
        titulo: "Pesquisa editada",
        descricao: "Descrição editada",
        instrucoes: "Instruções editadas",
      });
      const r = await request("GET", "/api/public/pesquisas/chiacchio");
      assert.equal(r.status, 200);
      assert.equal(
        r.body.formulario.perguntas[0].label,
        "Recomendaria a empresa?",
      );
      assert.equal(
        mock.DB.PESQUISA_QUESTIONARIO[0].PERGUNTAS_JSON,
        JSON.stringify(legacyQuestions),
      );
    });
    await test("prévia não publica nem registra respostas", async () => {
      const before = mock.DB.PESQUISA_RESPOSTAS.length;
      const versions = mock.DB.PESQUISA_QUESTIONARIO.length;
      const r = await request(
        "POST",
        "/api/pesquisas/formularios/chiacchio/previa",
        analyst,
        draft,
      );
      assert.equal(r.status, 200);
      assert.equal(r.body.formulario.previa, true);
      assert.equal(mock.DB.PESQUISA_RESPOSTAS.length, before);
      assert.equal(mock.DB.PESQUISA_QUESTIONARIO.length, versions);
    });
    await test("publicação cria versão imutável e atualiza a mesma URL pública", async () => {
      published = await edit("PUBLICADA");
      const r = await request("GET", "/api/public/pesquisas/chiacchio");
      assert.equal(r.status, 200);
      assert.equal(r.body.formulario.titulo, "Pesquisa editada");
      assert.equal(
        r.body.formulario.perguntas[0].label,
        "Você recomendaria a nossa empresa?",
      );
      assert.equal(r.body.formulario.versaoId, published.publicada.revision);
      assert.ok(!("historico" in r.body.formulario));
      assert.ok(!("autor" in r.body.formulario));
    });
    await test("rejeita rascunho, campo oculto forçado e condição obrigatória faltante", async () => {
      const r = await request("POST", "/api/pesquisas/resposta-portal", null, {
        formularioId: "chiacchio",
        versaoId: initial.revision + "-inventada",
        envioId: "request-invalid",
        respostas: { nps: 0, qualidade: 8 },
      });
      assert.equal(r.status, 409);
      const missing = await request(
        "POST",
        "/api/pesquisas/resposta-portal",
        null,
        {
          formularioId: "chiacchio",
          versaoId: published.publicada.revision,
          envioId: "request-missing",
          respostas: { nps: 0, qualidade: 8 },
        },
      );
      assert.equal(missing.status, 400);
    });
    await test("nota zero preserva NPS e sinaliza análise sem abrir OCP automaticamente", async () => {
      const payload = {
        formularioId: "chiacchio",
        versaoId: published.publicada.revision,
        envioId: "request-zero-001",
        nome: "Cliente identificado",
        respostas: {
          nps: 0,
          qualidade: 8,
          detalhe: "Atendimento deve melhorar",
        },
      };
      const [a, b] = await Promise.all([
        request("POST", "/api/pesquisas/resposta-portal", null, payload),
        request("POST", "/api/pesquisas/resposta-portal", null, payload),
      ]);
      assert.equal(a.status, 200);
      assert.equal(b.status, 200);
      assert.equal(a.body.id, b.body.id);
      responseId = a.body.id;
      assert.equal(
        mock.DB.PESQUISA_RESPOSTAS.filter((r) => r.ID_RESPOSTA === responseId)
          .length,
        1,
      );
      const r = mock.DB.PESQUISA_RESPOSTAS.find(
        (r) => r.ID_RESPOSTA === responseId,
      );
      assert.equal(r.RECOMENDACAO, "0");
      assert.equal(r.VERSAO_ID, published.publicada.revision);
      assert.equal(r.NOTA_BAIXA, "SIM");
      assert.equal(
        JSON.parse(r.FORMULARIO_JSON).perguntas[0].label,
        "Você recomendaria a nossa empresa?",
      );
      assert.equal(
        (mock.DB.PESQUISA_OCORRENCIAS || []).filter((o) => o.ID_RESPOSTA === responseId)
          .length,
        0,
      );
      assert.ok(
        !mock.DB.MANIFESTACOES.some((m) => m.ID_PESQUISA === responseId),
      );
    });
    await test("respostas, NPS e filtros por pesquisa/período chegam aos resultados internos", async () => {
      const r = await request(
        "GET",
        "/api/pesquisas/formularios/resultados?formularioId=chiacchio&inicio=2026-01-01",
        analyst,
      );
      assert.equal(r.status, 200);
      assert.equal(r.body.total, 1);
      assert.equal(r.body.nps, -100);
      assert.equal(r.body.notasBaixas, 1);
      assert.equal(r.body.itens[0].NOME_CLIENTE, "Cliente identificado");
      assert.ok(r.body.historico.length);
      const legacy = await request("GET", "/api/pesquisas/relatorio", analyst);
      assert.equal(legacy.status, 200);
      assert.ok(
        legacy.body.itens.some(
          (x) => x._id === responseId && x["Recomendação"] === "0",
        ),
      );
    });
    await test("SAC assume análise, registra observação e marca a notificação como lida", async () => {
      const analysis = await request(
        "PATCH",
        "/api/pesquisas/respostas/" + responseId + "/analise",
        analyst,
        { assumir: true, observacoesInternas: "Contato com o cliente em preparação." },
      );
      assert.equal(analysis.status, 200);
      assert.equal(analysis.body.analista, "ana.chiacchio");
      const stored = mock.DB.PESQUISA_RESPOSTAS.find(
        (r) => r.ID_RESPOSTA === responseId,
      );
      assert.equal(stored.STATUS_ANALISE, "EM_ANALISE");
      assert.equal(stored.OBSERVACOES_INTERNAS, "Contato com o cliente em preparação.");
      const forbidden = await request(
        "PATCH",
        "/api/pesquisas/respostas/" + responseId + "/analise",
        token("ANALISTA SAC", "PLASCHIO", "joao.plaschio"),
        { assumir: true },
      );
      assert.equal(forbidden.status, 403);
      const notifications = await request("GET", "/api/notificacoes/analista", analyst);
      assert.equal(notifications.status, 200);
      assert.equal(notifications.body.pesquisasBaixas, 1);
      const event = notifications.body.notificacoes.find(
        (n) => n.origem === responseId,
      );
      assert.ok(event);
      assert.equal(event.lida, false);
      const read = await request(
        "POST",
        "/api/notificacoes/analista/" + encodeURIComponent(event.id) + "/lida",
        analyst,
        {},
      );
      assert.equal(read.status, 200);
      const after = await request("GET", "/api/notificacoes/analista", analyst);
      assert.equal(after.body.notificacoes.find((n) => n.id === event.id).lida, true);
    });
    await test("SAC abre OCP manualmente para resposta crítica sem token", async () => {
      const r = mock.DB.PESQUISA_RESPOSTAS.find(
        (item) => item.ID_RESPOSTA === responseId,
      );
      const created = await request(
        "POST",
        "/api/pesquisas/ocorrencias",
        analyst,
        {
          respostaId: responseId,
          empresa: r.EMPRESA,
          nps: r.NOTA_MEDIA,
          setor: "Qualidade",
          descricao: "Tratamento formal autorizado pelo SAC.",
        },
      );
      assert.equal(created.status, 200);
      assert.ok(created.body.id);
      assert.equal(
        (mock.DB.PESQUISA_OCORRENCIAS || []).filter(
          (o) => o.ID_RESPOSTA === responseId,
        ).length,
        1,
      );
      const updated = await request(
        "PATCH",
        "/api/pesquisas/ocorrencias/" + created.body.id,
        analyst,
        {
          status: "EM_TRATATIVA",
          responsavel: "Analista SAC",
          prazo: "2026-12-31",
          resultado: "",
        },
      );
      assert.equal(updated.status, 200);
      const ocp = mock.DB.PESQUISA_OCORRENCIAS.find(
        (o) => o.ID_OCP === created.body.id,
      );
      assert.equal(ocp.STATUS, "EM_TRATATIVA");
      assert.equal(ocp.RESPONSAVEL, "Analista SAC");
      const forbidden = await request(
        "PATCH",
        "/api/pesquisas/ocorrencias/" + created.body.id,
        token("ANALISTA SAC", "PLASCHIO", "joao.plaschio"),
        { status: "ENCERRADA", resultado: "Não autorizado" },
      );
      assert.equal(forbidden.status, 403);
    });
    await test("SAC decide uma vez e a manifestação entra na aprovação", async () => {
      const before = mock.DB.MANIFESTACOES.length;
      const body = {
        decisao: "MANIFESTACAO",
        justificativa: "Cliente insatisfeito; requer análise do SAC.",
      };
      const a = await request(
        "POST",
        "/api/pesquisas/respostas/" + responseId + "/decisao",
        analyst,
        body,
      );
      assert.equal(a.status, 200);
      const b = await request(
        "POST",
        "/api/pesquisas/respostas/" + responseId + "/decisao",
        analyst,
        body,
      );
      assert.equal(b.status, 200);
      assert.equal(a.body.manifestacaoId, b.body.manifestacaoId);
      assert.equal(mock.DB.MANIFESTACOES.length, before + 1);
      assert.ok(
        mock.DB.FILA_APROVACAO.some(
          (f) =>
            f.ID_ENTIDADE === a.body.manifestacaoId && f.STATUS === "PENDENTE",
        ),
      );
      assert.equal(
        mock.DB.MANIFESTACOES.find(
          (m) => m.ID_MANIFESTACAO === a.body.manifestacaoId,
        ).STATUS,
        "AGUARDANDO_APROVAÇÃO",
      );
    });
    await test("convite fixa empresa e versão sem expor dados internos", async () => {
      const r = await request("POST", "/api/pesquisas/tokens/gerar", analyst, {
        empresa: "CHIACCHIO",
        nome_cliente: "Convidado",
        formularioId: "chiacchio",
      });
      assert.equal(r.status, 200);
      invitation = r.body.token;
      const tk = mock.DB.PESQUISA_TOKENS.find((t) => t.TOKEN === invitation);
      assert.equal(tk.VERSAO_ID, published.publicada.revision);
      const other = await request(
        "GET",
        "/api/public/pesquisas/plaschio?convite=" + invitation,
      );
      assert.equal(other.status, 403);
    });
    await test("editar e publicar novamente preserva resposta e versão do convite anterior", async () => {
      const questions = structuredClone(draft.perguntas);
      questions[0].label = "Novo texto após a resposta";
      await edit("PUBLICADA", { perguntas: questions });
      const r = await request(
        "GET",
        "/api/public/pesquisas/chiacchio?convite=" + invitation,
      );
      assert.equal(r.status, 200);
      assert.equal(
        r.body.formulario.perguntas[0].label,
        "Você recomendaria a nossa empresa?",
      );
      assert.equal(
        JSON.parse(
          mock.DB.PESQUISA_RESPOSTAS.find((r) => r.ID_RESPOSTA === responseId)
            .FORMULARIO_JSON,
        ).perguntas[0].label,
        "Você recomendaria a nossa empresa?",
      );
      assert.equal(JSON.stringify(mock.DB.PESQUISA_RESPOSTAS[0]), original);
    });
    await test("convite não registra respostas duplicadas e ignora respostas de perguntas ocultas", async () => {
      const payload = {
        formularioId: "chiacchio",
        versaoId: published.publicada.revision,
        envioId: "request-invite-001",
        token: invitation,
        respostas: { nps: 10, qualidade: 9, detalhe: "Não deve ser gravado" },
      };
      const a = await request(
        "POST",
        "/api/pesquisas/resposta-portal",
        null,
        payload,
      );
      assert.equal(a.status, 200);
      const b = await request(
        "POST",
        "/api/pesquisas/resposta-portal",
        null,
        payload,
      );
      assert.equal(b.status, 200);
      assert.equal(a.body.id, b.body.id);
      const rows = mock.DB.PESQUISA_RESPOSTAS.filter(
        (r) => r.TOKEN === invitation,
      );
      assert.equal(rows.length, 1);
      assert.equal(rows[0].NOME_CLIENTE, "Convidado");
      assert.ok(!("detalhe" in JSON.parse(rows[0].RESPOSTAS_JSON)));
      assert.equal(
        (
          await request(
            "GET",
            "/api/public/pesquisas/chiacchio?convite=" + invitation,
          )
        ).status,
        410,
      );
    });
    await test("convites vencidos pelos dois campos legados são recusados", async () => {
      for (const field of ["EXPIRA_EM", "VALIDADE_EM"]) {
        const tk = "expired-" + field;
        mock.DB.PESQUISA_TOKENS.push({
          TOKEN: tk,
          EMPRESA: "CHIACCHIO",
          [field]: "2000-01-01T00:00:00Z",
        });
        assert.equal(
          (
            await request(
              "GET",
              "/api/public/pesquisas/chiacchio?convite=" + tk,
            )
          ).status,
          410,
        );
      }
    });
    await test("slot reservado do convite mantém uma linha mesmo entre duas instâncias", async () => {
      const generated = await request(
        "POST",
        "/api/pesquisas/tokens/gerar",
        analyst,
        { empresa: "CHIACCHIO", formularioId: "chiacchio" },
      );
      assert.equal(generated.status, 200);
      const token = generated.body.token;
      const tk = mock.DB.PESQUISA_TOKENS.find((t) => t.TOKEN === token);
      assert.equal(
        mock.DB.PESQUISA_RESPOSTAS.filter((r) => r.TOKEN === token).length,
        1,
      );
      assert.equal(
        mock.DB.PESQUISA_RESPOSTAS.find((r) => r.TOKEN === token)
          .STATUS_REGISTRO,
        "RESERVADA",
      );
      const before = (
        await request("GET", "/api/pesquisas/formularios/resultados", analyst)
      ).body.total;
      const companies = [
        {
          slug: "chiacchio",
          codigo: "CHIACCHIO",
          nome: "Chiacchio Embalagens",
          cor: "#C70602",
          logo: "/assets/logo-chiacchio-new.png",
        },
        {
          slug: "plaschio",
          codigo: "PLASCHIO",
          nome: "Plaschio",
          cor: "#1A6632",
          logo: "/assets/logo-plaschio-new.png",
        },
        {
          slug: "tubahia",
          codigo: "TUBAHIA",
          nome: "Cesbap",
          cor: "#24508F",
          logo: "/assets/logo-tubahia-new.png",
        },
      ];
      const deps = {
        empresas: () => companies,
        canon: (v) =>
          companies.find((e) =>
            [e.codigo, e.slug, e.nome].some(
              (x) => x.toLowerCase() === String(v).toLowerCase(),
            ),
          )?.codigo,
        role: (u) => u?.perfil,
        read: mock.lerAba,
        append: mock.appendObjeto,
        ensure: mock.garantirAbaComCabecalhos,
        update: mock.atualizarPorID,
        invalidate: () => {},
        audit: async () => {},
        responses: () => mock.lerAba("PESQUISA_RESPOSTAS"),
        limite: () => 6,
        sync: async () => {},
      };
      const factory = require("../server-services/pesquisaFormulariosService");
      const a = factory(deps),
        b = factory(deps);
      const payload = {
        formularioId: "chiacchio",
        versaoId: tk.VERSAO_ID,
        token,
        envioId: "cross-instance-id",
        respostas: { nps: 10, qualidade: 10 },
      };
      const results = await Promise.all([a.submit(payload), b.submit(payload)]);
      assert.equal(results[0].id, results[1].id);
      assert.equal(
        mock.DB.PESQUISA_RESPOSTAS.filter((r) => r.TOKEN === token).length,
        1,
      );
      assert.equal(
        (await request("GET", "/api/pesquisas/formularios/resultados", analyst))
          .body.total,
        before + 1,
      );
    });
    await test("tipos, opções, condições, base dos indicadores e metadados são validados", async () => {
      const questions = [
        {
          id: "escolha",
          tipo: "UNICA",
          label: "Escolha",
          obrigatorio: true,
          opcoes: ["Sim", "Não"],
        },
        {
          id: "varias",
          tipo: "MULTIPLA",
          label: "Selecione",
          obrigatorio: true,
          opcoes: ["A", "B"],
        },
        { id: "email", tipo: "EMAIL", label: "E-mail", obrigatorio: true },
        { id: "data", tipo: "DATA", label: "Data", obrigatorio: true },
        {
          id: "confirmacao",
          tipo: "BOOLEANO",
          label: "Confirma?",
          obrigatorio: true,
        },
        {
          id: "extra",
          tipo: "TEXTO",
          label: "Explique",
          obrigatorio: true,
          condicao: { perguntaId: "escolha", operador: "EQ", valor: "Sim" },
        },
      ];
      let created = await request(
        "POST",
        "/api/pesquisas/formularios",
        analyst,
        {
          empresa: "CHIACCHIO",
          titulo: "Formulário de tipos",
          perguntas: questions,
        },
      );
      assert.equal(created.status, 200);
      let f = created.body.formulario;
      f = (
        await request("POST", "/api/pesquisas/formularios/" + f.id, analyst, {
          ...f,
          baseId: f.revision,
          acao: "PUBLICADA",
        })
      ).body.formulario;
      const payload = {
        formularioId: f.id,
        versaoId: f.publicada.revision,
        envioId: "types-request-001",
        respostas: {
          escolha: "Não",
          varias: ["A", "B"],
          email: "cliente@example.test",
          data: "2026-10-21",
          confirmacao: false,
          extra: "Não persistir",
        },
      };
      assert.equal(
        (
          await request("POST", "/api/pesquisas/resposta-portal", null, {
            ...payload,
            respostas: { ...payload.respostas, varias: ["A", "INVÁLIDA"] },
          })
        ).status,
        400,
      );
      const ok = await request(
        "POST",
        "/api/pesquisas/resposta-portal",
        null,
        payload,
      );
      assert.equal(ok.status, 200);
      const stored = JSON.parse(
        mock.DB.PESQUISA_RESPOSTAS.find((r) => r.ID_RESPOSTA === ok.body.id)
          .RESPOSTAS_JSON,
      );
      assert.equal(stored.confirmacao, false);
      assert.ok(!("extra" in stored));
      assert.deepEqual(stored.varias, ["A", "B"]);
      assert.equal(
        (
          await request(
            "POST",
            "/api/pesquisas/formularios/chiacchio",
            analyst,
            {
              ...draft,
              baseId: draft.revision,
              perguntas: draft.perguntas.filter((p) => p.id !== "nps"),
            },
          )
        ).status,
        400,
      );
    });
    await test("rotas públicas antigas por token usam versão e bloqueiam repetição", async () => {
      const generated = await request(
        "POST",
        "/api/pesquisas/tokens/gerar",
        analyst,
        { empresa: "CHIACCHIO", formularioId: "chiacchio" },
      );
      const token = generated.body.token;
      const form = await request("GET", "/api/pesquisa/" + token);
      assert.equal(form.status, 200);
      assert.equal(
        form.body.versaoId,
        mock.DB.PESQUISA_TOKENS.find((t) => t.TOKEN === token).VERSAO_ID,
      );
      const result = await request(
        "POST",
        "/api/pesquisas/resposta/" + token,
        null,
        {
          versaoId: form.body.versaoId,
          respostas: [
            { id: "nps", nota: 10 },
            { id: "qualidade", nota: 9 },
          ],
        },
      );
      assert.equal(result.status, 200);
      assert.equal(
        (
          await request("POST", "/api/pesquisas/resposta-token", null, {
            token,
            nps: 10,
            qualidade_produto: 9,
          })
        ).status,
        410,
      );
      assert.equal(
        mock.DB.PESQUISA_RESPOSTAS.filter((r) => r.TOKEN === token).length,
        1,
      );
    });
    await test("período legado e isolamento dos resultados e decisões por empresa", async () => {
      mock.DB.PESQUISA_RESPOSTAS.push({
        ID_RESPOSTA: "RSP-DATA-BR",
        EMPRESA: "CHIACCHIO",
        DATA: "21/10/2024 12:30:00",
        RECOMENDACAO: "0",
      });
      try {
        const r = await request(
          "GET",
          "/api/pesquisas/formularios/resultados?inicio=2024-10-01&fim=2024-10-31",
          analyst,
        );
        assert.equal(r.status, 200);
        assert.equal(r.body.total, 1);
        assert.equal(r.body.nps, -100);
        const plas = token("ANALISTA SAC", "PLASCHIO", "joao.plaschio");
        assert.equal(
          (await request("GET", "/api/pesquisas/formularios/resultados", plas))
            .body.total,
          0,
        );
        assert.equal(
          (
            await request(
              "GET",
              "/api/pesquisas/formularios/resultados?empresa=CHIACCHIO",
              plas,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              "POST",
              "/api/pesquisas/respostas/" + responseId + "/decisao",
              plas,
              { decisao: "MANIFESTACAO", justificativa: "Sem acesso" },
            )
          ).status,
          403,
        );
      } finally {
        mock.DB.PESQUISA_RESPOSTAS = mock.DB.PESQUISA_RESPOSTAS.filter(
          (r) => r.ID_RESPOSTA !== "RSP-DATA-BR",
        );
      }
    });
    await test("controle de concorrência impede sobrescrever edição mais nova", async () => {
      const r = await request(
        "POST",
        "/api/pesquisas/formularios/chiacchio",
        analyst,
        { ...initial, baseId: initial.revision },
      );
      assert.equal(r.status, 409);
    });
    await test("cria outra pesquisa, edita tipos e arquiva sem apagar históricos", async () => {
      const r = await request("POST", "/api/pesquisas/formularios", analyst, {
        ...draft,
        titulo: "Pesquisa nova",
        empresa: "CHIACCHIO",
      });
      assert.equal(r.status, 200);
      let f = r.body.formulario;
      let pub = await request(
        "POST",
        "/api/pesquisas/formularios/" + f.id,
        analyst,
        { ...f, baseId: f.revision, acao: "PUBLICADA" },
      );
      assert.equal(pub.status, 200);
      f = pub.body.formulario;
      const archive = await request(
        "POST",
        "/api/pesquisas/formularios/" + f.id,
        analyst,
        { ...f, baseId: f.revision, acao: "ARQUIVADA" },
      );
      assert.equal(archive.status, 200);
      assert.equal(
        (await request("GET", "/api/public/pesquisas/" + f.id)).status,
        410,
      );
      assert.ok(
        (await request("GET", "/api/pesquisas/formularios/" + f.id, analyst))
          .body.formulario.historico.length >= 3,
      );
    });
    await test("autenticação pública não libera administração e mantém rate limit", async () => {
      assert.equal(
        (await request("POST", "/api/pesquisas/formularios", null, {})).status,
        401,
      );
      const ip = "203.0.113.244";
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await request(
              "GET",
              "/api/public/pesquisas/chiacchio",
              null,
              undefined,
              ip,
            )
          ).status,
          200,
        );
      assert.equal(
        (
          await request(
            "GET",
            "/api/public/pesquisas/chiacchio",
            null,
            undefined,
            ip,
          )
        ).status,
        429,
      );
    });
  } catch (e) {
    failed++;
    console.error(e.stack);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
    console.log(`PESQUISAS: ${passed} passou | ${failed} falhou`);
    process.exitCode = failed ? 1 : 0;
  }
})();
