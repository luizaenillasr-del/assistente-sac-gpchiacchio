/* Renderizador compartilhado pelo Portal do Cliente e pela prévia do editor. */
(function () {
  "use strict";
  const node = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  function visible(p, values, shown) {
    const c = p.condicao;
    if (!c) return true;
    if (!shown.has(c.perguntaId) || values[c.perguntaId] === undefined)
      return false;
    const a = values[c.perguntaId],
      b = c.valor;
    return c.operador === "EQ"
      ? String(a) === String(b)
      : c.operador === "NE"
        ? String(a) !== String(b)
        : c.operador === "CONTAINS"
          ? Array.isArray(a)
            ? a.map(String).includes(String(b))
            : String(a).includes(String(b))
          : c.operador === "LT"
            ? Number(a) < Number(b)
            : Number(a) > Number(b);
  }
  function render(container, form, opts = {}) {
    container.replaceChildren();
    container.classList.add("psv");
    container.style.setProperty(
      "--psv-brand",
      form.aparencia?.cor || "#C70602",
    );
    container.style.setProperty("--psv-bg", form.aparencia?.fundo || "#F4F4F4");
    const values = {},
      fields = new Map(),
      envioId = crypto.randomUUID();
    let busy = false;
    const intro = node("section", "psv-intro");
    const logo = node("img");
    logo.src = form.aparencia?.logo || "/assets/portal-grupo-chiacchio.png";
    logo.alt = form.empresaNome || "Grupo Chiacchio";
    intro.append(
      logo,
      node("div", "psv-kicker", "PESQUISA DE SATISFAÇÃO"),
      node("h2", "", form.titulo),
      node(
        "p",
        "",
        form.descricao ||
          "Sua opinião é importante para melhorarmos nosso atendimento.",
      ),
    );
    const facts = node("div", "psv-facts");
    ["Poucos minutos", "Notas de 0 a 10", "Sem login"].forEach((t) =>
      facts.append(node("span", "", t)),
    );
    intro.append(facts);
    const start = node("button", "psv-primary", "COMEÇAR A PESQUISA");
    start.type = "button";
    intro.append(start);
    container.append(intro);
    const body = node("form", "psv-body");
    body.hidden = true;
    body.noValidate = true;
    body.append(node("h2", "", form.titulo));
    if (form.instrucoes)
      body.append(node("p", "psv-instructions", form.instrucoes));
    body.append(node("p", "psv-help", "* Indica uma pergunta obrigatória."));
    const identity = node("label", "psv-identity", "Seu nome (opcional)");
    const name = node("input");
    name.name = "nome";
    name.autocomplete = "name";
    name.maxLength = 200;
    identity.append(name);
    body.append(identity);
    let section = "";
    for (const p of form.perguntas) {
      if (p.secao && p.secao !== section) {
        body.append(node("h3", "psv-section", p.secao));
        section = p.secao;
      }
      const field = node("fieldset", "psv-field");
      field.dataset.question = p.id;
      const legend = node("legend", "", p.label + (p.obrigatorio ? " *" : ""));
      field.append(legend);
      if (p.ajuda) field.append(node("p", "psv-help", p.ajuda));
      const inputArea = node("div", "psv-inputs");
      let input;
      if (["NPS", "ESCALA"].includes(p.tipo)) {
        inputArea.classList.add("psv-scores");
        for (let score = p.min; score <= p.max; score++) {
          const button = node("button", "psv-score", String(score));
          button.type = "button";
          button.dataset.score = String(score);
          button.setAttribute("aria-label", p.label + ": " + score);
          button.setAttribute("aria-pressed", "false");
          button.onclick = () => {
            values[p.id] = score;
            inputArea.querySelectorAll("button").forEach((b) => {
              const selected = Number(b.dataset.score) === score;
              b.classList.toggle("psv-selected", selected);
              b.setAttribute("aria-pressed", String(selected));
            });
            updateVisibility();
          };
          inputArea.append(button);
        }
        const endpoints = node("div", "psv-endpoints");
        endpoints.append(
          node("span", "", p.min + " · Muito insatisfeito"),
          node("span", "", p.max + " · Muito satisfeito"),
        );
        field.append(inputArea, endpoints);
      } else if (["UNICA", "MULTIPLA", "BOOLEANO"].includes(p.tipo)) {
        const options = p.tipo === "BOOLEANO" ? ["Sim", "Não"] : p.opcoes;
        for (const option of options) {
          const label = node("label", "psv-option");
          const check = node("input");
          check.type = p.tipo === "MULTIPLA" ? "checkbox" : "radio";
          check.name = "psv-" + envioId + "-" + p.id;
          check.value = option;
          check.onchange = () => {
            if (p.tipo === "MULTIPLA")
              values[p.id] = [
                ...inputArea.querySelectorAll("input:checked"),
              ].map((e) => e.value);
            else
              values[p.id] = p.tipo === "BOOLEANO" ? option === "Sim" : option;
            updateVisibility();
          };
          label.append(check, node("span", "", option));
          inputArea.append(label);
        }
        field.append(inputArea);
      } else {
        input = node(p.tipo === "TEXTO" ? "textarea" : "input");
        if (p.tipo === "TEXTO") {
          input.rows = 4;
          input.maxLength = 2000;
        } else {
          input.type =
            { EMAIL: "email", DATA: "date", NUMERO: "number" }[p.tipo] ||
            "text";
          if (p.tipo === "NUMERO") {
            input.min = p.min;
            input.max = p.max;
            input.step = 1;
          } else input.maxLength = 2000;
        }
        input.setAttribute("aria-label", p.label);
        input.oninput = () => {
          values[p.id] =
            p.tipo === "NUMERO"
              ? input.value === ""
                ? undefined
                : Number(input.value)
              : input.value;
          updateVisibility();
        };
        field.append(input);
      }
      const error = node("p", "psv-error");
      error.hidden = true;
      error.setAttribute("role", "alert");
      field.append(error);
      fields.set(p.id, { field, error, input });
      body.append(field);
    }
    const error = node("div", "psv-error");
    error.hidden = true;
    error.setAttribute("role", "alert");
    body.append(error);
    const submit = node(
      "button",
      "psv-primary",
      opts.preview ? "Concluir prévia" : "Enviar pesquisa",
    );
    submit.type = "submit";
    body.append(
      submit,
      node(
        "p",
        "psv-privacy",
        "Seus dados são usados apenas para o atendimento e a melhoria dos nossos serviços.",
      ),
    );
    container.append(body);
    function updateVisibility() {
      const shown = new Set();
      for (const p of form.perguntas) {
        const f = fields.get(p.id);
        f.field.hidden = !visible(p, values, shown);
        if (!f.field.hidden) shown.add(p.id);
        f.error.hidden = true;
      }
      return shown;
    }
    start.onclick = () => {
      intro.hidden = true;
      body.hidden = false;
      body
        .querySelector("button,input,textarea")
        ?.focus({ preventScroll: true });
    };
    body.onsubmit = async (event) => {
      event.preventDefault();
      if (busy) return;
      error.hidden = true;
      const shown = updateVisibility(),
        answers = {};
      let first;
      for (const p of form.perguntas) {
        if (!shown.has(p.id)) continue;
        const f = fields.get(p.id),
          v = values[p.id];
        const empty =
          v === undefined ||
          v === null ||
          v === "" ||
          (typeof v === "string" && !v.trim()) ||
          (Array.isArray(v) && !v.length);
        let message = "";
        if (p.obrigatorio && empty) message = "Esta pergunta é obrigatória.";
        if (!empty && f.input && !f.input.checkValidity())
          message = "Confira o formato da resposta.";
        if (message) {
          f.error.textContent = message;
          f.error.hidden = false;
          first = first || f.field;
        } else if (!empty) answers[p.id] = v;
      }
      if (first) {
        first.scrollIntoView({ block: "center", behavior: "smooth" });
        first
          .querySelector("input,textarea,button")
          ?.focus({ preventScroll: true });
        return;
      }
      if (opts.preview) {
        error.textContent =
          "Pré-visualização: nenhuma resposta foi registrada.";
        error.hidden = false;
        return;
      }
      busy = true;
      body
        .querySelectorAll("button,input,textarea")
        .forEach((e) => (e.disabled = true));
      submit.textContent = "Enviando…";
      try {
        await opts.onSubmit({
          formularioId: form.id,
          versaoId: form.versaoId,
          respostas: answers,
          nome: name.value.trim(),
          envioId,
        });
        container.replaceChildren(
          node(
            "div",
            "psv-thanks",
            form.agradecimento || "Pesquisa enviada. Obrigado!",
          ),
        );
      } catch (e) {
        error.textContent =
          e.message || "Não foi possível enviar. Tente novamente.";
        error.hidden = false;
      } finally {
        busy = false;
        body
          .querySelectorAll("button,input,textarea")
          .forEach((e) => (e.disabled = false));
        submit.textContent = "Enviar pesquisa";
      }
    };
    updateVisibility();
    return { form, values };
  }
  window.SACSurvey = { render };
})();
