"use strict";
const crypto = require("crypto");
const COLS = {
  atendimento: "ATENDIMENTO",
  prazo: "PRAZO_ENTREGA",
  qualidade: "QUALIDADE",
  recomendacao: "RECOMENDACAO",
};
const TIPOS = [
  "NPS",
  "ESCALA",
  "UNICA",
  "MULTIPLA",
  "TEXTO",
  "EMAIL",
  "NUMERO",
  "DATA",
  "BOOLEANO",
];
const metricId = {
  nps: "recomendacao",
  recomendacao: "recomendacao",
  qualidade: "qualidade",
  prazo: "prazo",
  atendimento: "atendimento",
};
const parse = (v, fallback) => {
  try {
    return JSON.parse(v || "null") ?? fallback;
  } catch {
    return fallback;
  }
};
const text = (v, max = 500) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const hash = (v) =>
  crypto.createHash("sha256").update(v).digest("hex").slice(0, 24);
const dateValue = (value) => {
  const m = String(value || "").match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : Date.parse(value);
};
const fail = (status, message) => {
  const e = new Error(message);
  e.status = status;
  throw e;
};
const defaults = () => [
  {
    id: "recomendacao",
    label:
      "Em uma escala de 0 a 10, o quanto você nos recomendaria a um amigo ou colega?",
    tipo: "NPS",
    obrigatorio: true,
    indicador: "recomendacao",
    min: 0,
    max: 10,
  },
  {
    id: "qualidade",
    label: "Como você avalia a qualidade dos nossos produtos?",
    tipo: "ESCALA",
    obrigatorio: true,
    indicador: "qualidade",
    min: 1,
    max: 10,
  },
  {
    id: "prazo",
    label: "Como você avalia o prazo de entrega?",
    tipo: "ESCALA",
    obrigatorio: false,
    indicador: "prazo",
    min: 1,
    max: 10,
  },
  {
    id: "atendimento",
    label: "Como você avalia o atendimento recebido?",
    tipo: "ESCALA",
    obrigatorio: false,
    indicador: "atendimento",
    min: 1,
    max: 10,
  },
  {
    id: "motivo",
    label: "Qual o principal motivo da sua compra?",
    tipo: "UNICA",
    opcoes: [
      "Qualidade",
      "Preço",
      "Prazo de entrega",
      "Parceria",
      "Indicação",
      "Outro",
    ],
    obrigatorio: false,
  },
  {
    id: "comentario",
    label: "Algum comentário ou sugestão? (opcional)",
    tipo: "TEXTO",
    obrigatorio: false,
  },
];
function normalizeQuestions(input, legacy = false) {
  return input.map((p, i) => {
    let tipo = text(p.tipo || "TEXTO", 20).toUpperCase();
    if (legacy && tipo === "MULTIPLA") tipo = "UNICA";
    if (!TIPOS.includes(tipo) && legacy) tipo = "TEXTO";
    const id = text(p.id || `p_${i + 1}`, 60);
    return {
      id,
      label: text(p.label || p.pergunta || p.titulo, 500),
      tipo,
      obrigatorio: !!(p.obrigatorio ?? p.obrig),
      ajuda: text(p.ajuda || p.help, 1000),
      secao: text(p.secao, 100),
      indicador: p.indicador || metricId[id] || "",
      min: tipo === "NPS" ? 0 : Number(p.min ?? (tipo === "ESCALA" ? 1 : 0)),
      max: tipo === "NPS" ? 10 : Number(p.max ?? 10),
      opcoes: Array.isArray(p.opcoes)
        ? p.opcoes.map((o) =>
            text(typeof o === "object" ? o.label || o.valor : o, 200),
          )
        : [],
      condicao: p.condicao || null,
    };
  });
}
function validateDefinition(data, previous) {
  if (
    !Array.isArray(data.perguntas) ||
    !data.perguntas.length ||
    data.perguntas.length > 40
  )
    fail(400, "Informe entre 1 e 40 perguntas.");
  const perguntas = normalizeQuestions(data.perguntas);
  const ids = new Set(),
    metrics = new Set();
  for (const p of perguntas) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,59}$/.test(p.id) || ids.has(p.id))
      fail(400, "Cada pergunta precisa ter um identificador único e válido.");
    if (!p.label || !TIPOS.includes(p.tipo))
      fail(400, "Informe o enunciado e um tipo de resposta compatível.");
    if (
      ["NPS", "ESCALA", "NUMERO"].includes(p.tipo) &&
      (!Number.isFinite(p.min) ||
        !Number.isFinite(p.max) ||
        p.min < 0 ||
        p.max > 10 ||
        p.min >= p.max)
    )
      fail(400, "A escala deve ficar entre 0 e 10.");
    if (
      ["UNICA", "MULTIPLA"].includes(p.tipo) &&
      (!p.opcoes.length ||
        p.opcoes.length > 30 ||
        p.opcoes.some((o) => !o) ||
        new Set(p.opcoes).size !== p.opcoes.length)
    )
      fail(400, "Informe até 30 opções distintas e preenchidas.");
    if (
      p.indicador &&
      (!COLS[p.indicador] ||
        !["NPS", "ESCALA"].includes(p.tipo) ||
        metrics.has(p.indicador))
    )
      fail(400, "Cada indicador precisa de uma única pergunta de nota.");
    if (p.indicador) metrics.add(p.indicador);
    if (p.condicao) {
      const c = p.condicao;
      if (
        !ids.has(c.perguntaId) ||
        !["EQ", "NE", "CONTAINS", "LT", "GT"].includes(c.operador) ||
        !["string", "number", "boolean"].includes(typeof c.valor)
      )
        fail(
          400,
          "A condição deve referenciar uma pergunta anterior e uma comparação válida.",
        );
      p.condicao = {
        perguntaId: c.perguntaId,
        operador: c.operador,
        valor: c.valor,
      };
    }
    ids.add(p.id);
  }
  for (const p of previous?.perguntas || [])
    if (
      p.indicador &&
      !perguntas.some((q) => q.id === p.id && q.indicador === p.indicador)
    )
      fail(
        400,
        "Preserve as perguntas base dos indicadores; seus textos podem ser editados.",
      );
  const aparencia = {
    cor: /^#[A-Fa-f0-9]{6}$/.test(data.aparencia?.cor || "")
      ? data.aparencia.cor
      : "#C70602",
    fundo: /^#[A-Fa-f0-9]{6}$/.test(data.aparencia?.fundo || "")
      ? data.aparencia.fundo
      : "#F4F4F4",
    logo:
      /^\/assets\/[A-Za-z0-9_.\/-]+$/.test(data.aparencia?.logo || "") &&
      !data.aparencia.logo.includes("..")
        ? data.aparencia.logo
        : "/assets/portal-grupo-chiacchio.png",
  };
  const result = {
    titulo: text(data.titulo, 200),
    descricao: text(data.descricao, 2000),
    instrucoes: text(data.instrucoes, 2000),
    agradecimento: text(data.agradecimento, 1000),
    perguntas,
    aparencia,
  };
  if (!result.titulo) fail(400, "Informe o título da pesquisa.");
  if (JSON.stringify(result).length > 40000)
    fail(
      400,
      "O formulário excede o tamanho permitido. Reduza textos ou opções.",
    );
  return result;
}
function conditionVisible(p, answers, visible) {
  const c = p.condicao;
  if (!c) return true;
  if (!visible.has(c.perguntaId) || answers[c.perguntaId] === undefined)
    return false;
  const a = answers[c.perguntaId],
    b = c.valor;
  if (c.operador === "EQ") return String(a) === String(b);
  if (c.operador === "NE") return String(a) !== String(b);
  if (c.operador === "CONTAINS")
    return Array.isArray(a)
      ? a.map(String).includes(String(b))
      : String(a).includes(String(b));
  if (c.operador === "LT") return Number(a) < Number(b);
  return Number(a) > Number(b);
}
function validateAnswers(form, input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail(400, "Informe as respostas por identificador de pergunta.");
  const answers = {},
    visible = new Set(),
    notas = {},
    columns = {};
  for (const p of form.perguntas) {
    if (!conditionVisible(p, answers, visible)) continue;
    visible.add(p.id);
    let v = input[p.id];
    const empty =
      v === undefined ||
      v === null ||
      v === "" ||
      (Array.isArray(v) && !v.length);
    if (empty) {
      if (p.obrigatorio) fail(400, `Responda: ${p.label}`);
      continue;
    }
    if (["NPS", "ESCALA", "NUMERO"].includes(p.tipo)) {
      if (
        typeof v !== "number" ||
        !Number.isFinite(v) ||
        !Number.isInteger(v) ||
        v < p.min ||
        v > p.max
      )
        fail(400, `Nota inválida: ${p.label}`);
      if (["NPS", "ESCALA"].includes(p.tipo)) notas[p.id] = v;
      if (p.indicador) columns[COLS[p.indicador]] = String(v);
    } else if (p.tipo === "MULTIPLA") {
      if (
        !Array.isArray(v) ||
        v.length > p.opcoes.length ||
        v.some((o) => !p.opcoes.includes(o)) ||
        new Set(v).size !== v.length
      )
        fail(400, `Selecione opções válidas: ${p.label}`);
    } else if (p.tipo === "UNICA") {
      if (typeof v !== "string" || !p.opcoes.includes(v))
        fail(400, `Selecione uma opção válida: ${p.label}`);
    } else if (p.tipo === "BOOLEANO") {
      if (typeof v !== "boolean") fail(400, `Resposta inválida: ${p.label}`);
    } else {
      if (typeof v !== "string" || v.length > 2000)
        fail(400, `Texto inválido: ${p.label}`);
      v = v.trim();
      if (p.obrigatorio && !v) fail(400, `Responda: ${p.label}`);
      if (p.tipo === "EMAIL" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v))
        fail(400, `E-mail inválido: ${p.label}`);
      if (
        p.tipo === "DATA" &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
          Number.isNaN(Date.parse(v)) ||
          new Date(v).toISOString().slice(0, 10) !== v)
      )
        fail(400, `Data inválida: ${p.label}`);
    }
    answers[p.id] = v;
  }
  if (JSON.stringify(answers).length > 40000)
    fail(400, "As respostas excedem o tamanho permitido.");
  return { answers, notas, columns };
}
module.exports = function createSurveyService(s) {
  const locks = new Map();
  async function locked(key, fn) {
    const before = locks.get(key) || Promise.resolve();
    let release;
    const wait = new Promise((r) => (release = r));
    locks.set(key, wait);
    await before;
    try {
      return await fn();
    } finally {
      release();
      if (locks.get(key) === wait) locks.delete(key);
    }
  }
  const companies = () => s.empresas();
  const surveyUrl = (id) =>
    s.surveyUrl ? s.surveyUrl(id) : `/portal/pesquisas/${id}`;
  const company = (v) =>
    companies().find(
      (e) =>
        e.slug === String(v).toLowerCase() ||
        s.canon(v) === e.codigo ||
        String(v).toLowerCase() === e.nome.toLowerCase(),
    );
  function canAccess(user, emp) {
    if (s.role(user) === "MASTER") return true;
    const codes = String(user?.empresa || "")
      .split(/[,;]/)
      .map(s.canon)
      .filter(Boolean);
    return codes.includes(company(emp)?.codigo);
  }
  function assertAccess(user, emp) {
    if (!canAccess(user, emp))
      fail(403, "Sem acesso à empresa desta pesquisa.");
  }
  const read = async (name) => {
    s.invalidate(name);
    return s.read(name);
  };
  const write = async (name, row) => {
    await s.ensure(name, Object.keys(row));
    await s.append(name, row);
    s.invalidate(name);
  };
  const rowForm = (row) => {
    const emp = company(row.EMPRESA);
    if (!emp) return null;
    const texts = parse(row.TEXTOS_JSON, {}),
      definition = parse(row.DEFINICAO_JSON, null);
    return {
      id: row.FORMULARIO_ID || emp.slug,
      empresa: emp.codigo,
      empresaNome: emp.nome,
      revision: row.ID_VERSAO,
      versao: Number(row.VERSAO) || 1,
      status: row.STATUS,
      titulo:
        definition?.titulo ||
        row.TITULO ||
        texts.titulo ||
        `Pesquisa de Satisfação — ${emp.nome}`,
      descricao:
        definition?.descricao ||
        texts.descricao ||
        texts.boasVindas ||
        "Sua opinião contribui para melhorarmos nossos produtos e atendimento.",
      instrucoes: definition?.instrucoes || texts.instrucoes || "",
      agradecimento:
        definition?.agradecimento ||
        texts.agradecimento ||
        "Obrigado por compartilhar sua experiência.",
      aparencia:
        definition?.aparencia ||
        parse(row.APARENCIA_JSON, {
          cor: emp.cor,
          fundo: "#F4F4F4",
          logo: emp.logo,
        }),
      perguntas:
        definition?.perguntas ||
        normalizeQuestions(parse(row.PERGUNTAS_JSON, []), true),
      editadoEm: row.CRIADO_EM || "",
      publicadoEm: row.PUBLICADO_EM || "",
      autor: row.CRIADO_POR || "",
      url: surveyUrl(row.FORMULARIO_ID || emp.slug),
    };
  };
  function allForms(rows) {
    const groups = new Map();
    // Versões globais antigas serviam a todas as empresas; preservar esse alcance na leitura.
    for (const emp of companies()) {
      const legacy = rows
        .filter(
          (r) =>
            !r.FORMULARIO_ID &&
            (!r.EMPRESA || company(r.EMPRESA)?.codigo === emp.codigo),
        )
        .map((r) => ({ ...r, EMPRESA: emp.codigo }));
      if (!legacy.length)
        legacy.push({
          EMPRESA: emp.codigo,
          ID_VERSAO: `LEGADO-${emp.slug}`,
          STATUS: "PUBLICADA",
          PERGUNTAS_JSON: JSON.stringify(defaults()),
          VERSAO: "1",
        });
      groups.set(emp.slug, legacy);
    }
    for (const row of rows.filter((r) => r.FORMULARIO_ID)) {
      if (!company(row.EMPRESA)) continue;
      const g = groups.get(row.FORMULARIO_ID) || [];
      g.push(row);
      groups.set(row.FORMULARIO_ID, g);
    }
    return [...groups.entries()].map(([id, list]) => {
      const sorted = list
        .map((r, i) => ({ ...r, _i: i }))
        .sort(
          (a, b) =>
            Date.parse(a.CRIADO_EM || a.PUBLICADO_EM || 0) -
              Date.parse(b.CRIADO_EM || b.PUBLICADO_EM || 0) || a._i - b._i,
        );
      const latest = sorted.at(-1);
      const pub = sorted.filter((r) => r.STATUS === "PUBLICADA").at(-1);
      const state =
        sorted.filter((r) => r.STATUS !== "RASCUNHO").at(-1)?.STATUS ||
        "RASCUNHO";
      return {
        ...rowForm(latest),
        id,
        status: ["INATIVA", "ARQUIVADA"].includes(state)
          ? state
          : latest.STATUS,
        publicada: pub ? rowForm(pub) : null,
        historico: sorted.map(rowForm),
        url: surveyUrl(id),
      };
    });
  }
  async function getAll() {
    return allForms(await read("PESQUISA_QUESTIONARIO"));
  }
  async function get(id) {
    const form = (await getAll()).find((f) => f.id === id);
    if (!form) fail(404, "Pesquisa não encontrada.");
    return form;
  }
  async function list(user) {
    return (await getAll()).filter((f) => canAccess(user, f.empresa));
  }
  function publicDefinition(f) {
    return {
      id: f.id,
      empresa: f.empresa,
      empresaNome: f.empresaNome,
      versaoId: f.revision,
      versao: f.versao,
      titulo: f.titulo,
      descricao: f.descricao,
      instrucoes: f.instrucoes,
      agradecimento: f.agradecimento,
      aparencia: f.aparencia,
      perguntas: f.perguntas,
      url: f.url,
    };
  }
  async function save(user, id, data, action = "RASCUNHO") {
    return locked("form:" + id, async () => {
      const old = id ? await get(id) : null;
      const emp = company(data.empresa || old?.empresa);
      if (!emp) fail(400, "Selecione uma empresa válida.");
      assertAccess(user, emp.codigo);
      if (old) {
        assertAccess(user, old.empresa);
        if (old.empresa !== emp.codigo)
          fail(400, "Crie outra pesquisa para mudar de empresa.");
        if (data.baseId !== old.revision)
          fail(409, "A pesquisa foi alterada. Recarregue antes de salvar.");
      }
      if (!["RASCUNHO", "PUBLICADA", "INATIVA", "ARQUIVADA"].includes(action))
        fail(400, "Ação inválida.");
      const definition = validateDefinition(data, old?.publicada || old);
      id = id || `${emp.slug}-${crypto.randomBytes(6).toString("hex")}`;
      const version =
        (old?.historico.filter((f) => f.status === "PUBLICADA").length || 0) +
        1;
      const now = new Date().toISOString(),
        revision = "QV-" + crypto.randomUUID();
      const row = {
        ID_VERSAO: revision,
        FORMULARIO_ID: id,
        VERSAO: String(version),
        STATUS: action,
        EMPRESA: emp.codigo,
        TITULO: definition.titulo,
        CRIADO_EM: now,
        PUBLICADO_EM: action === "PUBLICADA" ? now : "",
        CRIADO_POR: user.usuario || "",
        PERGUNTAS_JSON: JSON.stringify(definition.perguntas),
        TEXTOS_JSON: JSON.stringify({
          titulo: definition.titulo,
          descricao: definition.descricao,
          instrucoes: definition.instrucoes,
          agradecimento: definition.agradecimento,
        }),
        APARENCIA_JSON: JSON.stringify(definition.aparencia),
        DEFINICAO_JSON: JSON.stringify(definition),
      };
      await write("PESQUISA_QUESTIONARIO", row);
      await s.audit(
        user.usuario,
        "PESQUISA_" + action,
        id,
        "PESQUISA_QUESTIONARIO",
        old?.revision || "",
        revision,
      );
      return get(id);
    });
  }
  async function invite(token) {
    const tk = (await read("PESQUISA_TOKENS")).find((t) => t.TOKEN === token);
    if (!tk) fail(404, "Convite não encontrado.");
    const expiry = tk.EXPIRA_EM || tk.VALIDADE_EM;
    if (
      expiry &&
      (!Number.isFinite(Date.parse(expiry)) || Date.parse(expiry) < Date.now())
    )
      fail(410, "Este convite expirou.");
    return tk;
  }
  async function publicGet(id, token) {
    const form = await get(id);
    if (
      !form.publicada ||
      !form.publicada.perguntas.length ||
      ["INATIVA", "ARQUIVADA"].includes(form.status)
    )
      fail(410, "Esta pesquisa não está disponível.");
    const config = await read("CONFIG_PORTAL");
    const emp = company(form.empresa);
    if (
      config.some(
        (c) =>
          c.TIPO === `PESQUISA_ATIVA_${emp.slug.toUpperCase()}` &&
          c.ATIVO === "NAO",
      )
    )
      fail(
        410,
        "As pesquisas desta empresa estão temporariamente indisponíveis.",
      );
    let published = form.publicada;
    if (token) {
      const tk = await invite(token);
      if (
        company(tk.EMPRESA)?.codigo !== form.empresa ||
        (tk.FORMULARIO_ID && tk.FORMULARIO_ID !== form.id)
      )
        fail(403, "O convite não pertence a esta pesquisa.");
      if (
        tk.STATUS === "RESPONDIDO" ||
        tk.RESPONDIDO_EM ||
        tk.DATA_RESPOSTA ||
        (await read("PESQUISA_RESPOSTAS")).some(
          (r) => r.TOKEN === token && r.STATUS_REGISTRO !== "RESERVADA",
        )
      )
        fail(410, "Esta pesquisa já foi respondida.");
      if (tk.VERSAO_ID) {
        published = form.historico.find(
          (v) => v.revision === tk.VERSAO_ID && v.status === "PUBLICADA",
        );
        if (!published) fail(410, "A versão do convite não está disponível.");
      }
    }
    return publicDefinition(published);
  }
  async function catalog() {
    const config = await read("CONFIG_PORTAL");
    return (await getAll())
      .filter(
        (f) =>
          f.publicada &&
          !["INATIVA", "ARQUIVADA"].includes(f.status) &&
          !config.some(
            (c) =>
              c.TIPO ===
                `PESQUISA_ATIVA_${company(f.empresa).slug.toUpperCase()}` &&
              c.ATIVO === "NAO",
          ),
      )
      .map((f) => ({
        id: f.id,
        empresa: f.empresa,
        empresaNome: f.empresaNome,
        titulo: f.publicada.titulo,
        url: f.url,
        versao: f.publicada.versao,
      }));
  }
  async function ensureOccurrence(row) {
    if (row.NOTA_BAIXA !== "SIM") return;
    const id = "OCP-" + hash(row.ID_RESPOSTA);
    const rows = await read("PESQUISA_OCORRENCIAS");
    if (rows.some((r) => r.ID_OCP === id || r.ID_RESPOSTA === row.ID_RESPOSTA))
      return;
    await write("PESQUISA_OCORRENCIAS", {
      ID_OCP: id,
      ID_RESPOSTA: row.ID_RESPOSTA,
      TOKEN: row.TOKEN,
      EMPRESA: row.EMPRESA,
      DATA: row.DATA,
      NPS: row.NOTA_MEDIA,
      STATUS: "PENDENTE",
      DECISAO: "",
      JUSTIFICATIVA: "",
      ID_MANIFESTACAO_GERADA: "",
      ANALISTA: "",
      DATA_DECISAO: "",
    });
  }
  async function reserveInvite(tk) {
    const id = "RSP-" + hash(`${tk.FORMULARIO_ID}|${tk.TOKEN}`);
    await write("PESQUISA_RESPOSTAS", {
      ID_RESPOSTA: id,
      TOKEN: tk.TOKEN,
      EMPRESA: tk.EMPRESA,
      DATA: "",
      STATUS_REGISTRO: "RESERVADA",
      ORIGEM: "CONVITE_RESERVADO",
    });
    return id;
  }
  async function finishInvite(tk, row) {
    if (!tk) return;
    await s.update(
      "PESQUISA_TOKENS",
      tk.TOKEN,
      {
        STATUS: "RESPONDIDO",
        RESPONDIDO_EM: row.DATA,
        DATA_RESPOSTA: row.DATA,
        FORMULARIO_ID: row.FORMULARIO_ID || tk.FORMULARIO_ID || "",
        VERSAO_ID: row.VERSAO_ID || tk.VERSAO_ID || "",
      },
      ["TOKEN"],
    );
    s.invalidate("PESQUISA_TOKENS");
  }
  async function submit(data) {
    const key = data.token
      ? "token:" + data.token
      : "request:" + text(data.envioId, 100);
    return locked(key, async () => {
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(data.envioId || ""))
        fail(400, "Identificador de envio inválido.");
      const form = await get(text(data.formularioId, 100));
      const published = await publicGet(form.id); // estado atual, sem impedir repetição idempotente do mesmo convite
      let version = form.historico.find(
        (v) => v.revision === data.versaoId && v.status === "PUBLICADA",
      );
      if (!version && published.versaoId === data.versaoId)
        version = form.publicada;
      if (!version)
        fail(409, "Versão inválida. Reabra o formulário publicado.");
      let tk = null;
      if (data.token) {
        tk = await invite(data.token);
        if (
          company(tk.EMPRESA)?.codigo !== form.empresa ||
          (tk.FORMULARIO_ID && tk.FORMULARIO_ID !== form.id) ||
          (tk.VERSAO_ID && tk.VERSAO_ID !== version.revision)
        )
          fail(403, "O convite não corresponde ao formulário e à versão.");
      }
      const validated = validateAnswers(version, data.respostas);
      const fingerprint = hash(JSON.stringify(validated.answers));
      const id = "RSP-" + hash(`${form.id}|${data.token || data.envioId}`);
      const previous = (await read("PESQUISA_RESPOSTAS")).find(
        (r) => r.ID_RESPOSTA === id || (data.token && r.TOKEN === data.token),
      );
      if (previous && previous.STATUS_REGISTRO !== "RESERVADA") {
        if (previous.HASH_RESPOSTAS && previous.HASH_RESPOSTAS !== fingerprint)
          fail(409, "Este envio já foi registrado com outras respostas.");
        await ensureOccurrence(previous);
        await finishInvite(tk, previous);
        return {
          sucesso: true,
          id: previous.ID_RESPOSTA,
          idempotente: true,
          notaBaixa: previous.NOTA_BAIXA === "SIM",
        };
      }
      if (
        tk &&
        (tk.STATUS === "RESPONDIDO" || tk.RESPONDIDO_EM || tk.DATA_RESPOSTA)
      )
        fail(410, "Este convite já foi respondido.");
      const notes = Object.values(validated.columns).map(Number);
      const critical = Object.values(validated.notas).some(
        (n) => n <= s.limite(),
      );
      const now = new Date().toISOString();
      const row = {
        ID_RESPOSTA: id,
        STATUS_REGISTRO: "REGISTRADA",
        TOKEN: data.token || "",
        EMPRESA: form.empresa,
        NOME_CLIENTE: text(
          tk?.NOME_CLIENTE || data.nome || validated.answers.nome,
          200,
        ),
        DATA: now,
        ATENDIMENTO: "",
        PRAZO_ENTREGA: "",
        QUALIDADE: "",
        RECOMENDACAO: "",
        ...validated.columns,
        COMENTARIO: text(validated.answers.comentario || data.comentario, 2000),
        NOTA_MEDIA: notes.length
          ? (notes.reduce((a, b) => a + b, 0) / notes.length).toFixed(1)
          : "",
        NOTA_BAIXA: critical ? "SIM" : "NAO",
        STATUS_OCP: "",
        ORIGEM: "PORTAL_PUBLICO",
        FORMULARIO_ID: form.id,
        VERSAO_ID: version.revision,
        VERSAO: String(version.versao),
        RESPOSTAS_JSON: JSON.stringify(validated.answers),
        FORMULARIO_JSON: JSON.stringify(publicDefinition(version)),
        HASH_RESPOSTAS: fingerprint,
        ID_CLIENTE: text(tk?.ID_CLIENTE, 100),
        ID_MANIFESTACAO: text(tk?.ID_MANIFESTACAO, 100),
      };
      if (previous?.STATUS_REGISTRO === "RESERVADA") {
        await s.ensure("PESQUISA_RESPOSTAS", Object.keys(row));
        await s.update("PESQUISA_RESPOSTAS", id, row, ["ID_RESPOSTA"]);
        s.invalidate("PESQUISA_RESPOSTAS");
      } else await write("PESQUISA_RESPOSTAS", row);
      await ensureOccurrence(row);
      await finishInvite(tk, row);
      await s.sync(row);
      return { sucesso: true, id, notaBaixa: critical };
    });
  }
  async function results(user, filters = {}) {
    const seen = new Set();
    let rows = (await s.responses()).filter((r) => {
      if (r.STATUS_REGISTRO === "RESERVADA") return false;
      if (r.ID_RESPOSTA && seen.has(r.ID_RESPOSTA)) return false;
      if (r.ID_RESPOSTA) seen.add(r.ID_RESPOSTA);
      return canAccess(user, r.EMPRESA);
    });
    if (filters.empresa) {
      const emp = company(filters.empresa);
      if (!emp) fail(400, "Empresa inválida.");
      assertAccess(user, emp.codigo);
      rows = rows.filter((r) => company(r.EMPRESA)?.codigo === emp.codigo);
    }
    if (filters.formularioId)
      rows = rows.filter(
        (r) =>
          r.FORMULARIO_ID === filters.formularioId ||
          (!r.FORMULARIO_ID &&
            company(r.EMPRESA)?.slug === filters.formularioId),
      );
    const start = filters.inicio
        ? Date.parse(filters.inicio + "T00:00:00Z")
        : null,
      end = filters.fim
        ? Date.parse(filters.fim + "T00:00:00Z") + 86400000
        : null;
    if (
      (start !== null && !Number.isFinite(start)) ||
      (end !== null && !Number.isFinite(end))
    )
      fail(400, "Período inválido.");
    rows = rows.filter((r) => {
      const d = dateValue(r.DATA);
      return (start === null || d >= start) && (end === null || d < end);
    });
    const ns = rows
      .map((r) => r.RECOMENDACAO)
      .filter((v) => v !== "" && v != null)
      .map(Number)
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 10);
    const notes = rows.flatMap((r) =>
      Object.values(COLS)
        .map((c) => r[c])
        .filter((v) => v !== "" && v != null)
        .map(Number)
        .filter(Number.isFinite),
    );
    const months = {};
    for (const r of rows) {
      const date = dateValue(r.DATA);
      if (!Number.isFinite(date)) continue;
      const key = new Date(date).toISOString().slice(0, 7);
      const m =
        months[key] || (months[key] = { mes: key, total: 0, notas: [] });
      m.total++;
      Object.values(COLS).forEach((c) => {
        if (r[c] !== "" && r[c] != null && Number.isFinite(Number(r[c])))
          m.notas.push(Number(r[c]));
      });
    }
    const historico = Object.values(months)
      .sort((a, b) => a.mes.localeCompare(b.mes))
      .map((m) => ({
        mes: m.mes,
        total: m.total,
        media: m.notas.length
          ? m.notas.reduce((a, b) => a + b, 0) / m.notas.length
          : null,
      }));
    return {
      itens: rows,
      total: rows.length,
      media: notes.length
        ? notes.reduce((a, b) => a + b, 0) / notes.length
        : null,
      nps: ns.length
        ? Math.round(
            ((ns.filter((n) => n >= 9).length -
              ns.filter((n) => n <= 6).length) *
              100) /
              ns.length,
          )
        : null,
      notasBaixas: rows.filter((r) => r.NOTA_BAIXA === "SIM").length,
      distribuicao: Array.from({ length: 11 }, (_, nota) => ({
        nota,
        total: notes.filter((n) => n === nota).length,
      })),
      historico,
      manifestacoes: rows.filter((r) => r.ID_MANIFESTACAO_GERADA).length,
    };
  }
  async function decide(user, id, data) {
    return locked("decision:" + id, async () => {
      const row = (await read("PESQUISA_RESPOSTAS")).find(
        (r) => r.ID_RESPOSTA === id,
      );
      if (!row) fail(404, "Resposta não encontrada.");
      assertAccess(user, row.EMPRESA);
      if (
        !["MANIFESTACAO", "NAO_REQUER"].includes(data.decisao) ||
        !text(data.justificativa, 2000)
      )
        fail(400, "Selecione a decisão e informe a justificativa.");
      if (
        row.ID_MANIFESTACAO_GERADA ||
        row.STATUS_OCP === "NAO_REQUER_TRATAMENTO"
      )
        return {
          sucesso: true,
          manifestacaoId: row.ID_MANIFESTACAO_GERADA || null,
          idempotente: true,
        };
      const now = new Date().toISOString(),
        mid = "MAN-PESQ-" + hash(id);
      if (data.decisao === "MANIFESTACAO") {
        if (
          !(await read("MANIFESTACOES")).some((m) => m.ID_MANIFESTACAO === mid)
        )
          await write("MANIFESTACOES", {
            ID_MANIFESTACAO: mid,
            ID_PESQUISA: id,
            DATA_ABERTURA: now,
            DATA_REGISTRO: now,
            EMPRESA_RECLAMADA: row.EMPRESA,
            EMPRESA_RECLAMANTE: row.NOME_CLIENTE || row.EMPRESA,
            CONTATO: row.NOME_CLIENTE || "",
            DESCRICAO:
              row.COMENTARIO || "Insatisfação identificada na pesquisa.",
            STATUS: "AGUARDANDO_APROVAÇÃO",
            APROVACAO_NECESSARIA: "SIM",
            TIPO: "Reclamação",
            SETOR_RESPONSAVEL: text(data.setor, 200),
            ORIGEM: "PESQUISA_SATISFACAO",
            USUARIO_CRIACAO: user.usuario,
            NOTA_PESQUISA: row.NOTA_MEDIA,
          });
        const fid = "FAP-PESQ-" + hash(id);
        if (!(await read("FILA_APROVACAO")).some((f) => f.ID_FILA === fid))
          await write("FILA_APROVACAO", {
            ID_FILA: fid,
            ID_ENTIDADE: mid,
            TIPO_ENTIDADE: "SAC",
            EMPRESA: row.EMPRESA,
            STATUS: "PENDENTE",
            DATA_ENVIO: now,
            CRIADO_POR: user.usuario,
            DESCRICAO: "Manifestação originada da pesquisa " + id,
          });
      }
      const changes = {
        STATUS_OCP:
          data.decisao === "MANIFESTACAO"
            ? "TRANSFORMADA_MANIFESTACAO"
            : "NAO_REQUER_TRATAMENTO",
        ID_MANIFESTACAO_GERADA: data.decisao === "MANIFESTACAO" ? mid : "",
        JUSTIFICATIVA_DECISAO: text(data.justificativa, 2000),
        DECIDIDO_POR: user.usuario,
        DECIDIDO_EM: now,
      };
      await s.update("PESQUISA_RESPOSTAS", id, changes, ["ID_RESPOSTA"]);
      s.invalidate("PESQUISA_RESPOSTAS");
      for (const ocp of (await read("PESQUISA_OCORRENCIAS")).filter(
        (o) => o.ID_RESPOSTA === id,
      ))
        await s.update(
          "PESQUISA_OCORRENCIAS",
          ocp.ID_OCP,
          {
            STATUS: "TRATADA",
            DECISAO: data.decisao,
            JUSTIFICATIVA: changes.JUSTIFICATIVA_DECISAO,
            ID_MANIFESTACAO_GERADA: changes.ID_MANIFESTACAO_GERADA,
            ANALISTA: user.usuario,
            DATA_DECISAO: now,
          },
          ["ID_OCP"],
        );
      s.invalidate("PESQUISA_OCORRENCIAS");
      await s.audit(
        user.usuario,
        "DECISAO_PESQUISA",
        id,
        "PESQUISA_RESPOSTAS",
        "",
        changes,
      );
      return {
        sucesso: true,
        manifestacaoId: changes.ID_MANIFESTACAO_GERADA || null,
      };
    });
  }
  return {
    reserveInvite,
    catalog,
    list,
    get,
    save,
    publicGet,
    submit,
    results,
    decide,
    assertAccess,
    company,
    invite,
    publicDefinition,
    validateDefinition,
    canAccess,
  };
};
