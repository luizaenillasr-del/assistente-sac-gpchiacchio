"use strict";
// Somente operações públicas. Não ampliar para /api/:path*.
const backend = "https://assistente-sac-gpchiacchio.vercel.app";
const apiRoutes = [
  { src: "/api/public/reclamacoes", methods: ["POST"] },
  { src: "/api/public/empresas", methods: ["GET"] },
  { src: "/api/public/whatsapp", methods: ["GET"] },
  { src: "/api/public/pesquisas-ativas", methods: ["GET"] },
  { src: "/api/public/pesquisas", methods: ["GET"] },
  { src: "/api/public/pesquisas/([A-Za-z0-9_-]+)", methods: ["GET"] },
  { src: "/api/public/pesquisa-convite/([A-Za-z0-9_-]+)", methods: ["GET"] },
  { src: "/api/public/protocolo/([A-Za-z0-9-]+)", methods: ["GET"] },
  { src: "/api/public/protocolo/consultar", methods: ["POST"] },
  { src: "/api/pesquisas/resposta-portal", methods: ["POST"] },
];
const assets = [
  "portal-grupo-chiacchio.png",
  "logo-chiacchio-new.png",
  "logo-plaschio-new.png",
  "logo-tubahia-new.png",
  "portal-montserrat-cyrillic-ext.woff2",
  "portal-montserrat-cyrillic.woff2",
  "portal-montserrat-vietnamese.woff2",
  "portal-montserrat-latin-ext.woff2",
  "portal-montserrat-latin.woff2",
  "pesquisa-formulario.css",
  "pesquisa-formulario.js",
];
const pageRoutes = [
  "/",
  "/index.html",
  "/portal",
  "/portal.html",
  "/pesquisas/([A-Za-z0-9_-]+)",
  "/portal/pesquisas/([A-Za-z0-9_-]+)",
  "/pesquisa/([A-Za-z0-9_-]+)",
  "/pesquisa",
];
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
};
function config() {
  return {
    version: 2,
    framework: null,
    installCommand: "node --version",
    buildCommand: "node scripts/build.js",
    outputDirectory: "dist",
    routes: [
      { src: "/(.*)", headers: securityHeaders, continue: true },
      ...apiRoutes.map((r) => ({
        src: "^" + r.src + "$",
        methods: r.methods,
        dest: backend + r.src.replace(/\([^)]*\)/g, "$1"),
        headers: { "Cache-Control": "no-store" },
      })),
      // Não permitir que um erro/URL desconhecida de API caia em uma página.
      { src: "^/api(?:/.*)?$", status: 404, dest: "/404.html" },
      ...pageRoutes.map((src) => ({
        src: "^" + src.replaceAll(".", "\\.") + "/?$",
        methods: ["GET", "HEAD"],
        dest: "/index.html",
        headers: { "Cache-Control": "no-store" },
      })),
      { handle: "filesystem" },
      { src: "/(.*)", status: 404, dest: "/404.html" },
    ],
  };
}
module.exports = { apiRoutes, assets, pageRoutes, config, backend };
