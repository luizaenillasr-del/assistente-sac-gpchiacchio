'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// Launcher de desenvolvimento — MODO TESTE COM MOCK
// Sobe o app usando o mock do Google Sheets (tests/sheets-mock.js) e serve o
// frontend (public/index.html), replicando o roteamento do vercel.json.
// NÃO usa nenhuma credencial real: sem Google, sem Postgres, sem IA.
// Uso:  node scripts/dev-mock.js   → http://localhost:3000
// ─────────────────────────────────────────────────────────────────────────────
const path = require('path');
const express = require('express');

// Dados de planilha simulados (usuários, manifestações, reclamações…)
process.env.SHEETS_MOCK_PATH = path.join(__dirname, '..', 'tests', 'sheets-mock.js');
// Segredo de sessão só-local (>=32 chars). NÃO é segredo de produção.
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-mock-session-secret-0123456789-abcdef';
process.env.NODE_ENV = 'development';
process.env.PG_LEITURA_ATIVA = 'false';   // tudo via mock de Sheets
process.env.DEMO_LOGIN_ENABLED = 'false';  // usuários demo desligados; usamos os do mock
process.env.AI_PROVIDER = process.env.AI_PROVIDER || 'openai'; // só evita o aviso C1

const app = require('../api/index.js');
const publicDir = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Replica o vercel.json: estáticos primeiro, depois a API, depois fallback p/ o
// frontend (SPA). Prefixos abaixo são tratados pelo app Express (não são SPA).
const APP_PREFIXES = ['/api', '/relatorio-publico', '/pesquisa', '/portal'];

const wrapper = express();
wrapper.use(require('compression')()); // gzip
// Em dev, nunca cachear — evita o browser servir CSS/HTML antigo após edição
const noCache = (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate');
// 1) Arquivos estáticos: /assets, *.png, fichas.html e "/" → index.html
wrapper.use(express.static(publicDir, { index: 'index.html', etag: false, lastModified: false, setHeaders: noCache }));
// 2) Fallback SPA: qualquer GET de página (não-API) devolve o index.html
wrapper.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html') &&
      !APP_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    noCache(res);
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  next();
});
// 3) Demais rotas (/api/*, /relatorio-publico/*, /pesquisa/*) → app SAC
wrapper.use(app);

wrapper.listen(PORT, () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  SAC Chiacchio — MODO TESTE (mock, sem credenciais reais) │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log(`  ▸ Abra:  http://localhost:${PORT}`);
  console.log('  ▸ Logins de teste (do mock):');
  console.log('      master.test     / masterPass     (MASTER — vê tudo)');
  console.log('      ana.chiacchio   / senhaChia      (ANALISTA SAC — Chiacchio)');
  console.log('      joao.plaschio   / senhaPla       (ANALISTA SAC — Plaschio)');
  console.log('      aprovador.chi   / senhaAprovChi  (APROVADOR — Chiacchio)');
  console.log('');
});
