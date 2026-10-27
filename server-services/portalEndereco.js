"use strict";
module.exports = function portalEndereco({ appUrl, publicUrl = "" }) {
  const internal = new URL(appUrl);
  const configured = publicUrl.trim();

  if (configured) {
    try {
      const base = new URL(configured);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname);
      const invalido =
        (base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
        base.username ||
        base.password ||
        base.search ||
        base.hash ||
        base.pathname !== "/" ||
        base.origin === internal.origin;
      if (!invalido) {
        const origin = base.origin;
        return {
          root: origin,
          separado: true,
          survey: (id) => `${origin}/pesquisas/${encodeURIComponent(id)}`,
          invite: (token) => `${origin}/pesquisa/${encodeURIComponent(token)}`,
        };
      }
      console.warn(
        "[PORTAL] PORTAL_PUBLIC_URL inválida (ignorada, usando portal interno):",
        configured,
      );
    } catch (e) {
      console.warn(
        "[PORTAL] PORTAL_PUBLIC_URL inválida (ignorada, usando portal interno):",
        e.message,
      );
    }
  }

  const root = new URL("/portal", internal).href.replace(/\/$/, "");
  return {
    root,
    separado: false,
    survey: (id) =>
      `${internal.origin}/portal/pesquisas/${encodeURIComponent(id)}`,
    invite: (token) =>
      `${internal.origin}/pesquisa/${encodeURIComponent(token)}`,
  };
};
