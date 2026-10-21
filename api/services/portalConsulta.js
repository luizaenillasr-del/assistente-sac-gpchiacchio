"use strict";
const strongProtocol = /^(CHI|PLAS|TUB)-[A-F0-9]{24}$/;
const deny = () =>
  Object.assign(
    new Error("Protocolo não encontrado ou dados de confirmação inválidos."),
    { status: 404 },
  );
function contactMatches(man, value) {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw.includes("@"))
    return [man.EMAIL, man.EMAIL_CLIENTE].some(
      (v) => v && String(v).trim().toLowerCase() === raw,
    );
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 13) return false;
  // Aceita o DDI brasileiro opcional, mantendo DDD + número completos.
  const phone = (v) =>
    String(v || "")
      .replace(/\D/g, "")
      .replace(/^55(?=\d{10,11}$)/, "");
  return [man.TELEFONE, man.TELEFONE_CLIENTE].some(
    (v) => v && phone(v) === phone(raw),
  );
}
function summary(man, proto) {
  const status = String(man.STATUS || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  const encerrada = [
    "ENCERRADA",
    "ENCERRADO",
    "FINALIZADA",
    "FINALIZADO",
    "CONCLUIDA",
    "CONCLUIDO",
  ].includes(status);
  let st = {
    label: "Em análise",
    desc: "Nossa equipe está analisando sua manifestação.",
  };
  if (["AGUARDANDO_APROVACAO", "RECEBIDA", "ABERTA"].includes(status))
    st = { label: "Recebida", desc: "Sua manifestação foi recebida pelo SAC." };
  if (
    [
      "EM_TRATATIVA",
      "EM_TRATAMENTO",
      "AGUARDANDO_OUTRO_SETOR",
      "APROVADA",
    ].includes(status)
  )
    st = {
      label: "Em tratamento",
      desc: "Estamos trabalhando para resolver sua solicitação.",
    };
  if (["AGUARDANDO_VALIDACAO", "AGUARDANDO_DEVOLUTIVA"].includes(status))
    st = {
      label: "Em revisão final",
      desc: "O SAC está validando a conclusão do atendimento.",
    };
  if (encerrada)
    st = {
      label: "Encerrada",
      desc: "Sua manifestação foi encerrada. Obrigado pelo contato.",
    };
  if (["CANCELADA", "CANCELADO", "REJEITADA"].includes(status))
    st = {
      label: "Encerrada",
      desc: "O atendimento foi encerrado. Para esclarecimentos, entre em contato com o SAC.",
    };
  const enviada = String(man.DEVOLUTIVA_ENVIADA || "").trim();
  const devolutiva =
    encerrada &&
    man.ORIGEM === "PORTAL_PUBLICO" &&
    !["SIM", "NAO", "NÃO"].includes(enviada.toUpperCase())
      ? enviada
      : "";
  return {
    sucesso: true,
    protocolo: proto,
    empresa: man.EMPRESA_RECLAMADA || man.EMPRESA_RECLAMANTE || "",
    tipo: man.TIPO_MANIFESTACAO || man.TIPO || "Manifestação",
    dataAbertura: man.DATA_ABERTURA || man.DATA_REGISTRO || "",
    status: st.label,
    descricaoStatus: st.desc,
    dataAtualizacao:
      man.DATA_ENCERRAMENTO ||
      man.DATA_CONCLUSAO_MANIFESTACAO ||
      man.UPDATED_AT ||
      man.DATA_DEVOLUTIVA ||
      man.DATA_ABERTURA ||
      "",
    devolutiva,
  };
}
module.exports = function createLookup(read) {
  return async (protocol, identifier) => {
    const proto = String(protocol || "")
      .trim()
      .toUpperCase();
    if (
      !/^[A-Z0-9-]{3,50}$/.test(proto) ||
      String(identifier || "").length > 200
    )
      throw deny();
    const strong = strongProtocol.test(proto);
    // Não consultar a base para um ID sequencial sem confirmação adicional.
    if (!strong && !identifier) throw deny();
    const man = (await read("MANIFESTACOES")).find((r) =>
      [r.ID_MANIFESTACAO, r.PROTOCOLO].some(
        (p) => p && String(p).toUpperCase() === proto,
      ),
    );
    if (
      !man ||
      (!(strong && man.ORIGEM === "PORTAL_PUBLICO") &&
        !contactMatches(man, identifier))
    )
      throw deny();
    return summary(man, proto);
  };
};
