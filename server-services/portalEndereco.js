"use strict";
module.exports = function portalEndereco({ appUrl, publicUrl = "" }) {
  const internal = new URL(appUrl);
  const configured = publicUrl.trim();
  const base = configured ? new URL(configured) : new URL("/portal", internal);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
  if (
    (base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
    base.username ||
    base.password ||
    base.search ||
    base.hash ||
    (configured && (base.pathname !== "/" || base.origin === internal.origin))
  ) {
    throw new Error(
      "PORTAL_PUBLIC_URL deve ser uma origem HTTPS distinta do SAC, sem caminho nem credenciais.",
    );
  }
  const origin = base.origin;
  const root = configured ? origin : base.href.replace(/\/$/, "");
  return {
    root,
    separado: !!configured && origin !== internal.origin,
    survey: (id) =>
      configured
        ? `${origin}/pesquisas/${encodeURIComponent(id)}`
        : `${internal.origin}/portal/pesquisas/${encodeURIComponent(id)}`,
    invite: (token) => `${origin}/pesquisa/${encodeURIComponent(token)}`,
  };
};
