"use strict";

// Preflight não acessa serviços nem grava dados. Ele documenta se o ambiente
// está pronto para a homologação real e nunca imprime valores de segredos.
const required = [
  "DATABASE_URL",
  "SPREADSHEET_ID",
  "PESQUISA_SPREADSHEET_ID",
  "GOOGLE_CREDENTIALS",
  "SESSION_SECRET",
];
const missing = required.filter((name) => !String(process.env[name] || "").trim());
const invalid = [];
if (process.env.GOOGLE_CREDENTIALS) {
  try {
    const c = JSON.parse(process.env.GOOGLE_CREDENTIALS);
    if (!c || typeof c !== "object" || Array.isArray(c)) invalid.push("GOOGLE_CREDENTIALS (objeto)");
  } catch (_) {
    invalid.push("GOOGLE_CREDENTIALS (JSON)");
  }
}
if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length < 32)
  invalid.push("SESSION_SECRET (mínimo 32 caracteres)");

console.log("FASE 4 — preflight de homologação real");
console.log("Perfis necessários: MASTER, GESTOR SAC, APROVADOR, ANALISTA SAC e RCA.");
console.log(`Variáveis presentes: ${required.filter((name) => !missing.includes(name)).length}/${required.length}`);
if (missing.length) console.log("Bloqueios por ausência: " + missing.join(", "));
if (invalid.length) console.log("Bloqueios por formato: " + invalid.join(", "));
if (!missing.length && !invalid.length) {
  console.log("Preflight aprovado. Execute os cenários de homologação com dados sintéticos isolados.");
  process.exit(0);
}
console.log("Homologação real ainda bloqueada; nenhum serviço foi acessado.");
process.exit(0);
