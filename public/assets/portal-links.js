/* Endereços externos gerados pelo servidor; não contém credenciais. */
(function () {
  "use strict";
  let base = location.origin + "/portal",
    pending;
  function url(path = "/portal") {
    const parsed = new URL(base);
    if (path === "/portal" || path === "/") return base;
    const survey =
      path.match(/^\/(?:portal\/)?pesquisas\/([A-Za-z0-9_-]+)$/) ||
      path.match(/^\/pesquisa\/(chiacchio|plaschio|tubahia)$/);
    if (survey)
      return (
        parsed.origin +
        (parsed.pathname === "/portal" ? "/portal" : "") +
        "/pesquisas/" +
        survey[1]
      );
    if (/^\/pesquisa(?:\/|\?)/.test(path)) return parsed.origin + path;
    return base;
  }
  function updateLinks() {
    document.querySelectorAll("a[href]").forEach((a) => {
      const path = a.dataset.portalPath || a.getAttribute("href");
      if (!(path === "/portal" || /^\/(?:portal\/)?pesquisas?\//.test(path)))
        return;
      a.dataset.portalPath = path;
      a.href = url(path);
      a.rel = "noopener noreferrer";
      if (
        a.textContent.startsWith("/portal") ||
        a.textContent.startsWith("/pesquisa/")
      )
        a.textContent = a.href;
    });
  }
  async function load() {
    if (pending) return pending;
    pending = _apiFetch("/api/portal/endereco", 10000)
      .then((r) => {
        const candidate = new URL(r.url);
        if (
          !["http:", "https:"].includes(candidate.protocol) ||
          candidate.username ||
          candidate.password
        )
          throw new Error("Endereço público inválido.");
        base = candidate.href.replace(/\/$/, "");
        updateLinks();
        const label = document.getElementById("padm-public-address");
        if (label) label.textContent = base;
        return base;
      })
      .catch((e) => {
        pending = null;
        throw e;
      });
    return pending;
  }
  window.SACPortalLinks = { load, url };
  if (sessionStorage.getItem("sac-token")) load().catch(() => {});
})();
