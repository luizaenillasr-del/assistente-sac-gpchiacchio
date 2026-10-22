/* Gerenciamento integrado à tela existente de Pesquisas de Satisfação. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id),
    esc = (v) =>
      String(v ?? "").replace(
        /[&<>"']/g,
        (c) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[c],
      );
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const state = {
    forms: [],
    canManage: false,
    loaded: false,
    draft: null,
    index: 0,
    dirty: false,
    view: "gerenciar",
    results: null,
  };
  const types = {
    NPS: "Nota NPS (0–10)",
    ESCALA: "Nota (0–10)",
    UNICA: "Seleção única",
    MULTIPLA: "Múltipla escolha",
    TEXTO: "Texto livre",
    EMAIL: "E-mail",
    NUMERO: "Número",
    DATA: "Data",
    BOOLEANO: "Sim ou não",
  };
  const call = async (path, body) => {
    const result = await _apiFetch(
      "/api/pesquisas/" + path,
      30000,
      body === undefined
        ? undefined
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          },
    );
    if (!result || result.sucesso === false)
      throw new Error(result?.erro || "Não foi possível concluir.");
    return result;
  };
  function message(text, error = false) {
    $("psm-message").textContent = text;
    $("psm-message").classList.toggle("psm-error", error);
  }
  function button(label, fn, kind = "") {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "psm-button " + kind;
    b.textContent = label;
    b.onclick = fn;
    return b;
  }
  function open(view) {
    state.view = view;
    document
      .querySelectorAll("[data-psm-view]")
      .forEach((e) => (e.hidden = e.dataset.psmView !== view));
    document.querySelectorAll("[data-psm-tab]").forEach((e) => {
      e.classList.toggle("psm-active", e.dataset.psmTab === view);
    });
    if (view === "resultados") loadResults();
    if (view === "editor" && !state.draft)
      message("Selecione uma pesquisa em Gerenciar pesquisas.");
  }
  async function load() {
    try {
      const r = await call("formularios");
      state.forms = r.itens;
      state.canManage = r.podeGerenciar;
      state.loaded = true;
      renderList();
      fillFilters();
      $("psm-new-button").hidden = !state.canManage;
      $("psm-tab-editor").hidden = !state.canManage;
      if (!state.canManage) open("gerenciar");
    } catch (e) {
      message(e.message, true);
    }
  }
  function fillFilters() {
    const formFilter = $("psm-filter-form");
    if (formFilter) {
      const previous = formFilter.value;
      formFilter.innerHTML =
        '<option value="">Todas as pesquisas</option>' +
        state.forms
          .map(
            (f) =>
              '<option value="' + esc(f.id) + '">' + esc(f.titulo) + "</option>",
          )
          .join("");
      formFilter.value = previous;
    }
    const companies = [
      ...new Map(state.forms.map((f) => [f.empresa, f.empresaNome])).entries(),
    ];
    for (const id of ["psm-filter-company", "psm-new-company"]) {
      const select = $(id),
        old = select ? select.value : "";
      if (!select) continue;
      select.innerHTML =
        (id === "psm-filter-company"
          ? '<option value="">Todas as empresas</option>'
          : "") +
        companies
          .map(
            ([v, l]) =>
              '<option value="' + esc(v) + '">' + esc(l) + "</option>",
          )
          .join("");
      if (old) select.value = old;
    }
  }
  function renderList() {
    const list = $("psm-list");
    list.replaceChildren();
    const groups = new Map();
    state.forms.forEach((f) => {
      if (!groups.has(f.empresaNome)) groups.set(f.empresaNome, []);
      groups.get(f.empresaNome).push(f);
    });
    for (const [company, forms] of groups) {
      const section = document.createElement("section");
      section.className = "psm-company";
      const h = document.createElement("h3");
      h.textContent = company;
      section.append(h);
      for (const f of forms) {
        const card = document.createElement("article");
        card.className = "psm-survey";
        const info = document.createElement("div");
        const title = document.createElement("strong");
        title.textContent = f.titulo;
        const meta = document.createElement("p");
        meta.textContent =
          f.status +
          " · Última edição: " +
          (f.editadoEm
            ? new Date(f.editadoEm).toLocaleString("pt-BR")
            : "formulário existente") +
          " · Versão publicada: " +
          (f.publicada?.versao || "—");
        const link = document.createElement("a");
        link.href = f.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = f.url;
        info.append(title, meta, link);
        const actions = document.createElement("div");
        actions.className = "psm-actions";
        actions.append(
          button(state.canManage ? "Editar" : "Visualizar", () => edit(f.id)),
        );
        if (f.publicada)
          actions.append(
            button("Abrir no portal", () =>
              window.open(f.url, "_blank", "noopener"),
            ),
          );
        if (state.canManage) {
          actions.append(
            button("Publicar", () => publishFromList(f.id), "psm-primary"),
            button(f.status === "INATIVA" ? "Ativar" : "Desativar", () =>
              changeStatus(
                f.id,
                f.status === "INATIVA" ? "PUBLICADA" : "INATIVA",
              ),
            ),
            button("Arquivar", () => changeStatus(f.id, "ARQUIVADA")),
            button("Convite", () => invite(f.id)),
          );
        }
        card.append(info, actions);
        section.append(card);
      }
      list.append(section);
    }
  }
  async function edit(id) {
    try {
      if (
        state.dirty &&
        !confirm("Há alterações não salvas. Deseja descartá-las?")
      )
        return;
      const r = await call("formularios/" + encodeURIComponent(id));
      state.draft = clone(r.formulario);
      state.draft.baseId = r.formulario.revision;
      state.index = 0;
      state.dirty = false;
      renderEditor();
      open("editor");
      message("");
    } catch (e) {
      message(e.message, true);
    }
  }
  function editValue(key, value) {
    state.draft[key] = value;
    state.dirty = true;
    updatePreview();
  }
  let previewTimer;
  function updatePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      if (state.draft && window.SACSurvey)
        SACSurvey.render(
          $("psm-preview"),
          { ...state.draft, versaoId: state.draft.revision },
          { preview: true },
        );
    }, 250);
  }
  function renderEditor() {
    const d = state.draft;
    if (!d) return;
    const host = $("psm-editor");
    host.replaceChildren();
    const toolbar = document.createElement("div");
    toolbar.className = "psm-actions";
    toolbar.append(
      button("Salvar rascunho", () => save("RASCUNHO")),
      button("Visualizar prévia", preview),
      button("Publicar alterações", () => save("PUBLICADA"), "psm-primary"),
    );
    host.append(toolbar);
    const title = document.createElement("h3");
    title.textContent = d.empresaNome + " · " + d.titulo;
    host.append(title);
    const info = document.createElement("p");
    info.className = "psm-muted";
    info.textContent =
      "As alterações ficam em rascunho até a publicação. Respostas anteriores mantêm sua versão.";
    host.append(info);
    const settings = document.createElement("div");
    settings.className = "psm-settings";
    for (const [key, label, multi] of [
      ["titulo", "Título"],
      ["descricao", "Descrição / boas-vindas", true],
      ["instrucoes", "Instruções", true],
      ["agradecimento", "Agradecimento", true],
    ])
      settings.append(
        field(
          label,
          d[key] || "",
          (v) => editValue(key, v),
          multi ? "textarea" : "text",
        ),
      );
    for (const [key, label] of [
      ["cor", "Cor da pesquisa"],
      ["fundo", "Cor de fundo"],
    ])
      settings.append(
        field(
          label,
          d.aparencia[key] || "#C70602",
          (v) => {
            d.aparencia[key] = v;
            state.dirty = true;
            updatePreview();
          },
          "color",
        ),
      );
    const logo = selectField(
      "Marca",
      d.aparencia.logo || "/assets/portal-grupo-chiacchio.png",
      [
        ["/assets/portal-grupo-chiacchio.png", "Grupo Chiacchio"],
        ["/assets/logo-chiacchio-new.png", "Chiacchio"],
        ["/assets/logo-plaschio-new.png", "Plaschio"],
        ["/assets/logo-tubahia-new.png", "Cesbap / Tubahia"],
      ],
      (v) => {
        d.aparencia.logo = v;
        state.dirty = true;
        updatePreview();
      },
    );
    settings.append(logo);
    host.append(settings);
    const split = document.createElement("div");
    split.className = "psm-editor-grid";
    const questions = document.createElement("section");
    const h = document.createElement("h3");
    h.textContent = "Perguntas";
    questions.append(h);
    d.perguntas.forEach((p, i) => {
      const row = document.createElement("div");
      row.className =
        "psm-question" + (i === state.index ? " psm-selected" : "");
      row.append(
        button(i + 1 + ". " + p.label, () => {
          state.index = i;
          renderEditor();
        }),
      );
      const actions = document.createElement("div");
      actions.className = "psm-actions";
      if (i > 0) actions.append(button("↑", () => move(i, -1)));
      if (i < d.perguntas.length - 1)
        actions.append(button("↓", () => move(i, 1)));
      if (!p.indicador)
        actions.append(
          button("Remover", () => {
            d.perguntas.splice(i, 1);
            state.index = Math.max(0, i - 1);
            state.dirty = true;
            renderEditor();
          }),
        );
      else {
        const lock = document.createElement("small");
        lock.textContent = "Base dos indicadores";
        actions.append(lock);
      }
      row.append(actions);
      questions.append(row);
    });
    questions.append(
      button("+ Adicionar pergunta", () => {
        d.perguntas.push({
          id: "p_" + crypto.randomUUID().replaceAll("-", ""),
          label: "Nova pergunta",
          tipo: "TEXTO",
          obrigatorio: false,
          opcoes: [],
          min: 0,
          max: 10,
          indicador: "",
          ajuda: "",
          secao: "",
          condicao: null,
        });
        state.index = d.perguntas.length - 1;
        state.dirty = true;
        renderEditor();
      }),
    );
    const config = document.createElement("section");
    config.className = "psm-question-config";
    const q = d.perguntas[state.index];
    if (q) {
      config.append(
        field("Enunciado", q.label, (v) => {
          q.label = v;
          state.dirty = true;
          updatePreview();
        }),
        field(
          "Texto de apoio",
          q.ajuda || "",
          (v) => {
            q.ajuda = v;
            state.dirty = true;
            updatePreview();
          },
          "textarea",
        ),
        field("Seção", q.secao || "", (v) => {
          q.secao = v;
          state.dirty = true;
          updatePreview();
        }),
      );
      config.append(
        selectField(
          "Tipo de resposta",
          q.tipo,
          Object.entries(types).filter(
            ([k]) => !q.indicador || ["NPS", "ESCALA"].includes(k),
          ),
          (v) => {
            q.tipo = v;
            if (v === "NPS") {
              q.min = 0;
              q.max = 10;
            }
            state.dirty = true;
            renderEditor();
          },
        ),
      );
      const required = field(
        "Resposta obrigatória",
        q.obrigatorio,
        (v) => {
          q.obrigatorio = v;
          state.dirty = true;
          updatePreview();
        },
        "checkbox",
      );
      config.append(required);
      if (["ESCALA", "NUMERO"].includes(q.tipo))
        for (const [key, label] of [
          ["min", "Nota mínima"],
          ["max", "Nota máxima"],
        ])
          config.append(
            field(
              label,
              q[key],
              (v) => {
                q[key] = Number(v);
                state.dirty = true;
                updatePreview();
              },
              "number",
            ),
          );
      if (["UNICA", "MULTIPLA"].includes(q.tipo))
        config.append(
          field(
            "Opções (uma por linha)",
            (q.opcoes || []).join("\n"),
            (v) => {
              q.opcoes = v
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean);
              state.dirty = true;
              updatePreview();
            },
            "textarea",
          ),
        );
      const previous = d.perguntas.slice(0, state.index);
      config.append(
        selectField(
          "Mostrar esta pergunta quando",
          q.condicao?.perguntaId || "",
          [["", "Sempre"], ...previous.map((p) => [p.id, p.label])],
          (v) => {
            q.condicao = v
              ? { perguntaId: v, operador: "EQ", valor: "" }
              : null;
            state.dirty = true;
            renderEditor();
          },
        ),
      );
      if (q.condicao) {
        config.append(
          selectField(
            "Comparação",
            q.condicao.operador,
            [
              ["EQ", "É igual a"],
              ["NE", "É diferente de"],
              ["CONTAINS", "Contém"],
              ["LT", "É menor que"],
              ["GT", "É maior que"],
            ],
            (v) => {
              q.condicao.operador = v;
              state.dirty = true;
              updatePreview();
            },
          ),
          field("Valor esperado", q.condicao.valor, (v) => {
            q.condicao.valor = v;
            state.dirty = true;
            updatePreview();
          }),
        );
      }
    }
    split.append(questions, config);
    host.append(split);
    const history = document.createElement("details");
    history.innerHTML = "<summary>Histórico das versões</summary>";
    for (const v of d.historico || []) {
      const row = document.createElement("p");
      row.textContent =
        "v" +
        v.versao +
        " · " +
        v.status +
        " · " +
        (v.publicadoEm || v.editadoEm || "Legado") +
        " · " +
        (v.autor || "Histórico existente");
      history.append(row);
    }
    host.append(history);
    host
      .querySelectorAll("input,textarea,select,button")
      .forEach((e) => (e.disabled = !state.canManage));
    updatePreview();
  }
  function field(label, value, onChange, type = "text") {
    const wrapper = document.createElement("label");
    wrapper.className = "psm-field";
    const text = document.createElement("span");
    text.textContent = label;
    const input = document.createElement(
      type === "textarea" ? "textarea" : "input",
    );
    if (type !== "textarea") input.type = type;
    if (type === "checkbox") input.checked = !!value;
    else input.value = value ?? "";
    if (type === "number") {
      input.min = 0;
      input.max = 10;
    }
    if (type === "textarea") input.rows = 3;
    input.oninput = () =>
      onChange(type === "checkbox" ? input.checked : input.value);
    wrapper.append(text, input);
    return wrapper;
  }
  function selectField(label, value, options, onChange) {
    const wrapper = document.createElement("label");
    wrapper.className = "psm-field";
    const span = document.createElement("span");
    span.textContent = label;
    const select = document.createElement("select");
    options.forEach(([v, l]) => select.add(new Option(l, v)));
    select.value = value;
    select.onchange = () => onChange(select.value);
    wrapper.append(span, select);
    return wrapper;
  }
  function move(i, direction) {
    const target = i + direction;
    [state.draft.perguntas[i], state.draft.perguntas[target]] = [
      state.draft.perguntas[target],
      state.draft.perguntas[i],
    ];
    state.index = target;
    state.dirty = true;
    renderEditor();
  }
  async function save(action) {
    try {
      if (!state.draft) throw new Error("Selecione uma pesquisa.");
      const r = await call(
        "formularios/" + encodeURIComponent(state.draft.id),
        { ...state.draft, acao: action },
      );
      state.draft = clone(r.formulario);
      state.draft.baseId = r.formulario.revision;
      state.dirty = false;
      await load();
      renderEditor();
      message(
        action === "PUBLICADA"
          ? "Pesquisa publicada. O link público já usa esta versão."
          : "Rascunho salvo.",
      );
    } catch (e) {
      message(e.message, true);
    }
  }
  async function preview() {
    try {
      const d = state.draft;
      const r = await call(
        "formularios/" + encodeURIComponent(d.id) + "/previa",
        d,
      );
      SACSurvey.render($("psm-preview"), r.formulario, { preview: true });
      $("psm-preview").scrollIntoView({ block: "start", behavior: "smooth" });
      message("Prévia do rascunho: respostas não são registradas.");
    } catch (e) {
      message(e.message, true);
    }
  }
  async function publishFromList(id) {
    await edit(id);
    if (state.draft?.id === id) await save("PUBLICADA");
  }
  async function changeStatus(id, action) {
    try {
      const r = await call("formularios/" + encodeURIComponent(id));
      await call("formularios/" + encodeURIComponent(id), {
        ...r.formulario,
        baseId: r.formulario.revision,
        acao: action,
      });
      await load();
      message(
        action === "ARQUIVADA"
          ? "Pesquisa arquivada. O histórico foi preservado."
          : "Status atualizado.",
      );
    } catch (e) {
      message(e.message, true);
    }
  }
  async function create() {
    try {
      const empresa = $("psm-new-company").value,
        titulo = $("psm-new-title").value.trim();
      if (!titulo) throw new Error("Informe o título da pesquisa.");
      const base = state.forms.find((f) => f.empresa === empresa);
      if (!base) throw new Error("Selecione uma empresa autorizada.");
      const r = await call("formularios", { ...base, titulo, empresa });
      state.dirty = false;
      await load();
      await edit(r.formulario.id);
      $("psm-new").hidden = true;
    } catch (e) {
      message(e.message, true);
    }
  }
  async function invite(id) {
    const host = $("psm-invite");
    host.replaceChildren();
    host.hidden = false;
    const name = field("Nome do cliente (opcional)", "", () => {});
    const email = field("E-mail do cliente (opcional)", "", () => {}, "email");
    const result = document.createElement("p");
    host.append(
      name,
      email,
      button("Gerar convite individual", async () => {
        try {
          const f = state.forms.find((f) => f.id === id);
          const r = await call("tokens/gerar", {
            empresa: f.empresa,
            formularioId: id,
            nome_cliente: name.querySelector("input").value,
            email_cliente: email.querySelector("input").value,
            dias_validade: 30,
          });
          result.replaceChildren();
          const a = document.createElement("a");
          a.href = r.link;
          a.textContent = r.link;
          a.target = "_blank";
          a.rel = "noopener";
          result.append(
            a,
            button("Copiar", () => navigator.clipboard.writeText(r.link)),
          );
        } catch (e) {
          message(e.message, true);
        }
      }),
      result,
      button("Fechar", () => (host.hidden = true)),
    );
    host.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  async function loadResults() {
    try {
      const q = new URLSearchParams();
      for (const [key, id] of [
        ["empresa", "psm-filter-company"],
        ["formularioId", "psm-filter-form"],
        ["inicio", "psm-filter-start"],
        ["fim", "psm-filter-end"],
      ])
        if ($(id).value) q.set(key, $(id).value);
      state.results = await call("formularios/resultados?" + q);
      renderResults();
    } catch (e) {
      message(e.message, true);
    }
  }
  function renderResults() {
    const r = state.results;
    const k = $("psm-kpis");
    k.replaceChildren();
    for (const [label, value] of [
      ["Respostas", r.total],
      ["Média", r.media == null ? "—" : r.media.toFixed(2)],
      ["NPS", r.nps ?? "—"],
      ["Notas ≤ 6", r.notasBaixas],
      ["Manifestações vinculadas", r.manifestacoes],
    ]) {
      const card = document.createElement("div");
      card.className = "psm-kpi";
      const small = document.createElement("small");
      small.textContent = label;
      const b = document.createElement("strong");
      b.textContent = value;
      card.append(small, b);
      k.append(card);
    }
    const charts = $("psm-charts");
    charts.innerHTML =
      '<section><h3>Evolução mensal</h3><div id="psm-months"></div></section><section><h3>Distribuição das notas</h3><div id="psm-distribution"></div></section>';
    for (const [host, items] of [
      [
        $("psm-months"),
        r.historico.map((m) => ({
          label: m.mes + " · " + m.total + " respostas",
          value: m.media,
          max: 10,
        })),
      ],
      [
        $("psm-distribution"),
        r.distribuicao.map((m) => ({
          label: String(m.nota),
          value: m.total,
          max: Math.max(1, ...r.distribuicao.map((n) => n.total)),
        })),
      ],
    ])
      for (const item of items) {
        const row = document.createElement("div");
        row.className = "psm-bar";
        const label = document.createElement("span");
        label.textContent = item.label;
        const track = document.createElement("div");
        const fill = document.createElement("i");
        fill.style.width = ((item.value || 0) * 100) / item.max + "%";
        track.append(fill);
        const val = document.createElement("b");
        val.textContent =
          item.value == null
            ? "—"
            : Number(item.value).toFixed(item.max === 10 ? 1 : 0);
        row.append(label, track, val);
        host.append(row);
      }
    const table = $("psm-responses");
    table.replaceChildren();
    for (const response of r.itens) {
      const row = document.createElement("div");
      row.className = "psm-response";
      const span = document.createElement("span");
      span.textContent =
        (response.NOME_CLIENTE || "Cliente não identificado") +
        " · " +
        response.EMPRESA +
        " · " +
        new Date(response.DATA).toLocaleString("pt-BR") +
        " · " +
        (response.VERSAO ? "v" + response.VERSAO : "Legado");
      row.append(
        span,
        button("Ver respostas", () => details(response)),
      );
      if (response.NOTA_BAIXA === "SIM") {
        const tag = document.createElement("strong");
        tag.textContent = "Nota ≤ 6";
        row.append(tag);
      }
      table.append(row);
    }
    if (!r.total) table.textContent = "Nenhuma resposta para este recorte.";
  }
  function details(r) {
    const host = $("psm-response-detail");
    host.replaceChildren();
    host.hidden = false;
    const title = document.createElement("h3");
    title.textContent = "Resposta " + r.ID_RESPOSTA;
    host.append(title);
    let snapshot = {},
      answers = {};
    try {
      snapshot = JSON.parse(r.FORMULARIO_JSON || "{}");
      answers = JSON.parse(r.RESPOSTAS_JSON || "{}");
    } catch {}
    const rows = snapshot.perguntas
      ? snapshot.perguntas
          .filter((p) => Object.hasOwn(answers, p.id))
          .map((p) => [
            p.label,
            Array.isArray(answers[p.id])
              ? answers[p.id].join(", ")
              : String(answers[p.id]),
          ])
      : [
          ["Atendimento", r.ATENDIMENTO],
          ["Qualidade", r.QUALIDADE],
          ["Prazo", r.PRAZO_ENTREGA],
          ["Recomendação", r.RECOMENDACAO],
          ["Comentário", r.COMENTARIO],
        ];
    for (const [label, value] of rows) {
      const p = document.createElement("p");
      const strong = document.createElement("strong");
      strong.textContent = label + ": ";
      p.append(strong, document.createTextNode(value ?? ""));
      host.append(p);
    }
    if (r.ID_MANIFESTACAO_GERADA) {
      const p = document.createElement("p");
      p.textContent = "Manifestação vinculada: " + r.ID_MANIFESTACAO_GERADA;
      host.append(p);
    } else if (
      state.canManage &&
      r.NOTA_BAIXA === "SIM" &&
      r.STATUS_OCP !== "NAO_REQUER_TRATAMENTO"
    ) {
      const decision = selectField(
        "Encaminhamento",
        "MANIFESTACAO",
        [
          ["MANIFESTACAO", "Transformar em manifestação (aguarda aprovação)"],
          ["NAO_REQUER", "Não requer tratamento"],
        ],
        () => {},
      );
      const why = field("Justificativa obrigatória", "", () => {}, "textarea");
      host.append(
        decision,
        why,
        button("Registrar decisão", async () => {
          try {
            const result = await call(
              "respostas/" + encodeURIComponent(r.ID_RESPOSTA) + "/decisao",
              {
                decisao: decision.querySelector("select").value,
                justificativa: why.querySelector("textarea").value,
              },
            );
            message(
              result.manifestacaoId
                ? "Manifestação criada e encaminhada à aprovação: " +
                    result.manifestacaoId
                : "Decisão registrada.",
            );
            host.hidden = true;
            await loadResults();
          } catch (e) {
            message(e.message, true);
          }
        }),
      );
    }
    host.append(button("Fechar", () => (host.hidden = true)));
    host.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  function mount() {
    const page = $("page-sugestoes-melhoria");
    if (!page || $("psm-root")) return;
    const host = $("cp-formularios-admin");
    if (!host) return;
    const root = document.createElement("div");
    root.id = "psm-root";
    root.innerHTML = `<header class="psm-header"><div><small>CENTRO DAS PESQUISAS / FORMULÁRIOS</small><h2>Formulários de satisfação</h2><p>Gerencie, edite, versione e publique os formulários consumidos pelo Portal do Cliente.</p></div></header><nav class="psm-nav"><button data-psm-tab="gerenciar" class="psm-active">Gerenciar formulários</button><button id="psm-tab-editor" data-psm-tab="editor">Editor de formulário</button></nav><p id="psm-message" role="status"></p><section data-psm-view="gerenciar"><button id="psm-new-button" class="psm-button psm-primary">+ Novo formulário</button><div id="psm-new" class="psm-box" hidden><label>Empresa<select id="psm-new-company"></select></label><label>Título<input id="psm-new-title" maxlength="200"></label><button id="psm-create" class="psm-button">Criar rascunho</button></div><div id="psm-list"></div><div id="psm-invite" class="psm-box" hidden></div></section><section data-psm-view="editor" hidden><div class="psm-workspace"><div id="psm-editor"><p>Selecione um formulário para editar.</p></div><aside><div class="psm-preview-label">Pré-visualização · não registra respostas</div><div id="psm-preview"></div></aside></div></section>`;
    host.append(root);
    root.querySelectorAll("[data-psm-tab]").forEach(
      (b) =>
        (b.onclick = () => {
          open(b.dataset.psmTab);
          if (!state.loaded) load();
        }),
    );
    $("psm-new-button").onclick = () =>
      ($("psm-new").hidden = !$("psm-new").hidden);
    $("psm-create").onclick = create;
    window.qEditorCarregar = () => {
      open("gerenciar");
      if (!state.loaded) load();
    };
    const observer = new MutationObserver(() => {
      if (page.classList.contains("active") && !state.loaded) load();
    });
    observer.observe(page, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    if (page.classList.contains("active")) load();
    window.SACPesquisasAdmin = { load, open, edit, state };
  }
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
