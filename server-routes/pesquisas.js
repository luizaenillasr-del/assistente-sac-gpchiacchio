"use strict";
const crypto = require("crypto");
const path = require("path");
module.exports = function registerPesquisas(app, service, h) {
  // Catálogo público é somente leitura e pode ser solicitado por todos os
  // clientes do Portal ao mesmo tempo. Mantemos um snapshot curto por
  // processo para que um 429/503 transitório do Sheets não interrompa a
  // abertura do formulário já publicado. Respostas e alterações nunca usam
  // este fallback.
  let publicCatalogCache = null;
  const PUBLIC_CATALOG_TTL_MS = 60_000;
  const viewer = h.requerPermissao("pesquisas.visualizar");
  const manage = (req, res, next) => {
    if (
      ![
        "MASTER",
        "GESTOR SAC",
        "ANALISTA SAC",
        "ATENDENTE SAC",
        "SETOR SAC",
      ].includes(h.role(req.user)) ||
      !["pesquisas.criar", "pesquisas.editar", "pesquisas.gerenciar"].some(
        (p) => h.can(req.user, p),
      )
    )
      return res
        .status(403)
        .json({
          sucesso: false,
          erro: "Sem permissão para gerenciar pesquisas.",
        });
    next();
  };
  const run = (fn) => async (req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      await fn(req, res, next);
    } catch (e) {
      res
        .status(e.status || 500)
        .json({
          sucesso: false,
          erro: e.status
            ? e.message
            : "Não foi possível concluir a operação de pesquisa.",
        });
      if (!e.status) console.error("[PESQUISAS]", e.message);
    }
  };
  app.get(
    "/api/pesquisas/formularios",
    viewer,
    run(async (req, res) =>
      res.json({
        sucesso: true,
        itens: await service.list(req.user),
        podeGerenciar:
          [
            "MASTER",
            "GESTOR SAC",
            "ANALISTA SAC",
            "ATENDENTE SAC",
            "SETOR SAC",
          ].includes(h.role(req.user)) &&
          ["pesquisas.criar", "pesquisas.editar", "pesquisas.gerenciar"].some(
            (p) => h.can(req.user, p),
          ),
      }),
    ),
  );
  app.get(
    "/api/pesquisas/formularios/resultados",
    viewer,
    run(async (req, res) =>
      res.json({
        sucesso: true,
        ...(await service.results(req.user, req.query)),
      }),
    ),
  );
  app.post(
    "/api/pesquisas/formularios",
    manage,
    run(async (req, res) =>
      res.json({
        sucesso: true,
        formulario: await service.save(req.user, null, req.body, "RASCUNHO"),
      }),
    ),
  );
  app.get(
    "/api/pesquisas/formularios/:id",
    viewer,
    run(async (req, res) => {
      const f = await service.get(req.params.id);
      service.assertAccess(req.user, f.empresa);
      res.json({ sucesso: true, formulario: f });
    }),
  );
  app.post(
    "/api/pesquisas/formularios/:id",
    manage,
    run(async (req, res) =>
      res.json({
        sucesso: true,
        formulario: await service.save(
          req.user,
          req.params.id,
          req.body,
          req.body.acao || "RASCUNHO",
        ),
      }),
    ),
  );
  app.post(
    "/api/pesquisas/formularios/:id/previa",
    manage,
    run(async (req, res) => {
      const f = await service.get(req.params.id);
      service.assertAccess(req.user, f.empresa);
      res.json({
        sucesso: true,
        formulario: {
          ...service.publicDefinition(f),
          ...service.validateDefinition(req.body, f.publicada || f),
          previa: true,
        },
      });
    }),
  );
  app.post(
    "/api/pesquisas/respostas/:id/decisao",
    manage,
    run(async (req, res) =>
      res.json(await service.decide(req.user, req.params.id, req.body)),
    ),
  );
  app.post(
    "/api/pesquisas/decisao",
    manage,
    run(async (req, res) =>
      res.json(await service.decide(req.user, req.body.respostaId, req.body)),
    ),
  );
  app.get(
    "/api/public/pesquisas",
    h.rate,
    run(async (req, res) => {
      const now = Date.now();
      if (publicCatalogCache && now - publicCatalogCache.ts < PUBLIC_CATALOG_TTL_MS)
        return res.json({ sucesso: true, itens: publicCatalogCache.itens });
      try {
        const itens = await service.catalog();
        publicCatalogCache = { itens, ts: Date.now() };
        return res.json({ sucesso: true, itens });
      } catch (e) {
        if (publicCatalogCache?.itens) {
          console.warn("[PESQUISAS] catálogo indisponível; usando snapshot público anterior.", e.message);
          return res.json({ sucesso: true, itens: publicCatalogCache.itens, degradado: true });
        }
        throw e;
      }
    }),
  );
  app.get(
    "/api/public/pesquisa-convite/:token",
    h.rate,
    run(async (req, res) => {
      const tk = await service.invite(req.params.token);
      const id = tk.FORMULARIO_ID || service.company(tk.EMPRESA)?.slug;
      res.json({
        sucesso: true,
        formulario: await service.publicGet(id, req.params.token),
      });
    }),
  );
  app.get(
    "/api/public/pesquisas/:id",
    h.rate,
    run(async (req, res) =>
      res.json({
        sucesso: true,
        formulario: await service.publicGet(req.params.id, req.query.convite),
      }),
    ),
  );
  app.post(
    "/api/pesquisas/resposta-portal",
    h.rate,
    run(async (req, res, next) => {
      if (!req.body.formularioId) return next();
      res.json(await service.submit(req.body));
    }),
  );
  const tokenForm = async (token) => {
    const tk = await service.invite(token);
    const id = tk.FORMULARIO_ID || service.company(tk.EMPRESA)?.slug;
    return { tk, form: await service.publicGet(id, token) };
  };
  app.get(
    "/api/pesquisa/:token",
    h.rate,
    run(async (req, res) => {
      const { tk, form } = await tokenForm(req.params.token);
      res.json({
        sucesso: true,
        token: req.params.token,
        empresa: form.empresa,
        nomeCliente: tk.NOME_CLIENTE || "",
        perguntas: form.perguntas,
        versaoId: form.versaoId,
        formulario: form,
      });
    }),
  );
  const legacyTokenSubmit = run(async (req, res) => {
    const token = req.params.token || req.body.token;
    const { form } = await tokenForm(token);
    const answers = {};
    if (Array.isArray(req.body.respostas)) {
      for (const r of req.body.respostas) {
        const q = form.perguntas.find(
          (p) =>
            p.id === (r.id || r.perguntaId) ||
            p.label === (r.pergunta || r.label || r.titulo),
        );
        if (!q) {
          const e = new Error("Pergunta não pertence à versão do convite.");
          e.status = 400;
          throw e;
        }
        answers[q.id] = r.nota ?? r.valor ?? r.resposta;
      }
    } else if (req.body.respostas && typeof req.body.respostas === "object")
      Object.assign(answers, req.body.respostas);
    else
      for (const q of form.perguntas) {
        const names = {
          recomendacao: ["nps", "recomendaria_a_empresa"],
          qualidade: ["qualidade_produto", "qualidade_do_produto"],
          prazo: ["prazo_entrega", "prazo_de_entrega"],
          atendimento: ["atendimento"],
        };
        const keys = names[q.indicador] || [q.id];
        for (const key of keys)
          if (req.body[key] !== undefined && req.body[key] !== "") {
            const v = req.body[key];
            answers[q.id] = ["NPS", "ESCALA", "NUMERO"].includes(q.tipo)
              ? Number(v)
              : v;
            break;
          }
      }
    const result = await service.submit({
      formularioId: form.id,
      versaoId: req.body.versaoId || form.versaoId,
      token,
      envioId:
        req.body.envioId ||
        "convite_" +
          crypto.createHash("sha256").update(token).digest("hex").slice(0, 24),
      respostas: answers,
      comentario: req.body.comentario,
    });
    res.json({ ...result, flagrada: result.notaBaixa });
  });
  app.post("/api/pesquisas/resposta/:token", h.rate, legacyTokenSubmit);
  app.post("/api/pesquisas/resposta-token", h.rate, legacyTokenSubmit);
  // Versões e rotas antigas seguem aceitas, agora com escopo de empresa e o mesmo armazenamento.
  const legacyGet = run(async (req, res) => {
    const emp = service.company(
      req.params.empresa ||
        req.query.empresa ||
        (h.role(req.user) === "MASTER"
          ? "chiacchio"
          : String(req.user.empresa || "").split(/[,;]/)[0]),
    );
    if (!emp) {
      const e = new Error("Empresa inválida.");
      e.status = 400;
      throw e;
    }
    const f = await service.get(emp.slug);
    service.assertAccess(req.user, f.empresa);
    const row = (v) =>
      v
        ? {
            ID_VERSAO: v.revision,
            STATUS: v.status,
            EMPRESA: v.empresa,
            PUBLICADO_EM: v.publicadoEm,
            CRIADO_EM: v.editadoEm,
            PERGUNTAS_JSON: JSON.stringify(v.perguntas),
            perguntas: v.perguntas,
            textos: {
              titulo: v.titulo,
              descricao: v.descricao,
              instrucoes: v.instrucoes,
            },
          }
        : null;
    res.json({
      sucesso: true,
      empresa: emp.codigo,
      publicada: row(f.publicada),
      rascunho: f.historico.filter((v) => v.status === "RASCUNHO").at(-1)
        ? row(f.historico.filter((v) => v.status === "RASCUNHO").at(-1))
        : null,
    });
  });
  const legacySave = run(async (req, res) => {
    const emp = service.company(
      req.params.empresa ||
        req.body.empresa ||
        (h.role(req.user) === "MASTER"
          ? "chiacchio"
          : String(req.user.empresa || "").split(/[,;]/)[0]),
    );
    if (!emp) {
      const e = new Error("Empresa inválida.");
      e.status = 400;
      throw e;
    }
    const f = await service.get(emp.slug);
    service.assertAccess(req.user, f.empresa);
    const form = await service.save(
      req.user,
      f.id,
      {
        ...f,
        ...req.body,
        ...(req.body.textos || {}),
        baseId: req.body.baseId || f.revision,
      },
      req.body.acao || "RASCUNHO",
    );
    res.json({
      sucesso: true,
      id: form.revision,
      status: form.status,
      empresa: emp.codigo,
    });
  });
  app.get("/api/pesquisas/questionario", viewer, legacyGet);
  app.post("/api/pesquisas/questionario", manage, legacySave);
  app.get("/api/questionarios/:empresa", viewer, legacyGet);
  app.post("/api/questionarios/:empresa", manage, legacySave);
  app.post(
    "/api/questionarios/:empresa/publicar",
    manage,
    run(async (req, res) => {
      const emp = service.company(req.params.empresa);
      if (!emp) {
        const e = new Error("Empresa inválida.");
        e.status = 400;
        throw e;
      }
      const f = await service.get(emp.slug);
      service.assertAccess(req.user, f.empresa);
      if (req.body.id && !f.historico.some((v) => v.revision === req.body.id)) {
        const e = new Error("Versão não pertence a esta pesquisa.");
        e.status = 403;
        throw e;
      }
      const base = req.body.id
        ? f.historico.find((v) => v.revision === req.body.id)
        : f;
      const form = await service.save(
        req.user,
        f.id,
        { ...base, baseId: f.revision },
        "PUBLICADA",
      );
      res.json({ sucesso: true, id: form.revision, empresa: emp.codigo });
    }),
  );
  app.post(
    "/api/pesquisas/tokens/gerar",
    manage,
    run(async (req, res) => {
      const emp = service.company(req.body.empresa);
      if (!emp) {
        const e = new Error("Selecione uma empresa válida.");
        e.status = 400;
        throw e;
      }
      const id = req.body.formularioId || emp.slug;
      const form = await service.get(id);
      service.assertAccess(req.user, form.empresa);
      if (form.empresa !== emp.codigo) {
        const e = new Error("Empresa e pesquisa não correspondem.");
        e.status = 400;
        throw e;
      }
      const pub = await service.publicGet(id);
      const days = Number(req.body.dias_validade ?? 30);
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        const e = new Error("Validade deve ser de 1 a 365 dias.");
        e.status = 400;
        throw e;
      }
      if (
        req.body.id_manifestacao &&
        (await h.read("PESQUISA_TOKENS")).some(
          (t) =>
            t.ID_MANIFESTACAO === req.body.id_manifestacao &&
            (t.STATUS === "RESPONDIDO" || t.RESPONDIDO_EM) &&
            Date.parse(t.DATA_RESPOSTA || t.RESPONDIDO_EM) >
              Date.now() - 90 * 86400000,
        )
      ) {
        const e = new Error("Cliente já respondeu nos últimos 90 dias.");
        e.status = 409;
        throw e;
      }
      const token = crypto.randomBytes(24).toString("base64url"),
        now = new Date().toISOString(),
        expira = new Date(Date.now() + days * 86400000).toISOString();
      const row = {
        TOKEN: token,
        EMPRESA: emp.codigo,
        NOME_CLIENTE: String(req.body.nome_cliente || "").slice(0, 200),
        EMAIL_CLIENTE: String(req.body.email_cliente || "").slice(0, 200),
        ID_CLIENTE: String(req.body.id_cliente || "").slice(0, 100),
        ID_MANIFESTACAO: String(req.body.id_manifestacao || "").slice(0, 100),
        STATUS: "ENVIADO",
        CRIADO_EM: now,
        EXPIRA_EM: expira,
        DATA_ABERTURA: "",
        DATA_RESPOSTA: "",
        CRIADO_POR: req.user.usuario,
        FORMULARIO_ID: id,
        VERSAO_ID: pub.versaoId,
      };
      row.RESPOSTA_ID = await service.reserveInvite(row);
      await h.ensure("PESQUISA_TOKENS", Object.keys(row));
      await h.append("PESQUISA_TOKENS", row);
      h.invalidate("PESQUISA_TOKENS");
      res.json({
        sucesso: true,
        token,
        link: `${h.surveyUrl ? h.surveyUrl(id) : h.appUrl + "/portal/pesquisas/" + id}?convite=${encodeURIComponent(token)}`,
        expira,
      });
    }),
  );
  app.get("/portal/pesquisas/:id", (req, res) =>
    res.sendFile(path.join(__dirname, "../public/portal.html")),
  );
  app.get("/pesquisa/:token", (req, res, next) => {
    // Os links legados continuam públicos e passam a renderizar a versão cadastrada.
    if (req.params.token.length < 6) return next();
    res.sendFile(path.join(__dirname, "../public/portal.html"));
  });
};
