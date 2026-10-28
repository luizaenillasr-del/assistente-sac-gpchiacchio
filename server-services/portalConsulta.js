"use strict";
// Protocolos oficiais da ficha única (CHIA/PLA/TUB-AAAAMMDD-CANAL-SEQUENCIAL)
// e identificadores aleatórios legados continuam consultáveis.
const strongProtocol = /^(?:(?:CHIA|PLA|TUB)-\d{8}-\d{2}-\d{4}|(?:CHI|PLAS|TUB)-[A-F0-9]{24})$/;
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
  if (["AGUARDANDO_APROVACAO", "AGUARDANDO_TRIAGEM_SAC", "AGUARDANDO_TRIAGEM", "RECEBIDA", "ABERTA"].includes(status))
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
    const all = (await read("MANIFESTACOES")).filter((r) =>
      [r.ID_MANIFESTACAO, r.PROTOCOLO].some(
        (p) => p && String(p).toUpperCase() === proto,
      ),
    );
    if (!all.length) throw deny();

    let man;
    if (all.length === 1) {
      man = all[0];
    } else {
      // Protocolo duplicado detectado — logar para reconciliação manual.
      console.warn(
        `[portalConsulta] CONFLITO: protocolo "${proto}" encontrado em ${all.length} registros. IDs: ${all.map(r => r.ID_MANIFESTACAO).join(", ")} — encaminhar para reconciliação.`,
      );
      // Prioriza o registro que confirme o identificador fornecido.
      const byContact = identifier
        ? all.filter((r) => contactMatches(r, identifier))
        : [];
      if (byContact.length === 1) {
        man = byContact[0];
      } else if (byContact.length > 1) {
        // Ambiguidade irredutível mesmo com identificador.
        const err = Object.assign(
          new Error("Protocolo com múltiplos registros. Entre em contato com o SAC para esclarecimento."),
          { status: 409 },
        );
        throw err;
      } else {
        // Sem identificador ou identificador não bate: usa o primeiro registro
        // com ORIGEM=PORTAL_PUBLICO se existir, respeitando a isenção de
        // identificador para registros do portal público.
        const portalPub = all.filter(r => r.ORIGEM === "PORTAL_PUBLICO");
        if (strong && portalPub.length === 1) {
          man = portalPub[0];
        } else if (strong && portalPub.length > 1) {
          const err = Object.assign(
            new Error("Protocolo com múltiplos registros. Entre em contato com o SAC para esclarecimento."),
            { status: 409 },
          );
          throw err;
        } else {
          throw deny();
        }
      }
    }

    if (
      !(strong && man.ORIGEM === "PORTAL_PUBLICO") &&
      !contactMatches(man, identifier)
    )
      throw deny();
    return summary(man, proto);
  };
};
