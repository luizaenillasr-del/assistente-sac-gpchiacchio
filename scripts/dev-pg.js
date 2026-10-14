'use strict';
// Sobe o app SAC lendo/gravando no POSTGRES (estrutura Prisma ativada).
// O mock do Sheets fica apenas como fallback dos endpoints ainda não migrados.
// Uso:  node scripts/dev-pg.js   → http://localhost:3001
const path = require('path');
const express = require('express');

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://karinearaujo@localhost:5432/sac_chiacchio';
process.env.DATABASE_URL_UNPOOLED = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
process.env.PG_LEITURA_ATIVA = 'true';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'dev-pg-secret-0123456789-abcdef-0123456789';
process.env.DEMO_LOGIN_ENABLED = 'false';
// Fallback: endpoints ainda não migrados ao PG caem no mock (evita exigir credencial Google)
process.env.SHEETS_MOCK_PATH = path.join(__dirname, '..', 'tests', 'sheets-mock.js');

const publicDir = path.join(__dirname, '..', 'public');
const app = require('../api/index.js');
const APP_PREFIXES = ['/api', '/relatorio-publico', '/pesquisa'];

const wrapper = express();
const compression = require('compression');
wrapper.use(compression()); // gzip: index.html de ~1,5MB cai p/ ~250KB
const noCache = (res) => res.setHeader('Cache-Control', 'no-store, must-revalidate');
wrapper.use(express.static(publicDir, { index: 'index.html', etag: false, lastModified: false, setHeaders: noCache }));
wrapper.use((req, res, next) => {
  if (req.method === 'GET' && req.accepts('html') &&
      !APP_PREFIXES.some(p => req.path === p || req.path.startsWith(p + '/'))) {
    noCache(res);
    return res.sendFile(path.join(publicDir, 'index.html'));
  }
  next();
});
wrapper.use(app);

const PORT = process.env.PORT || 3001;
wrapper.listen(PORT, () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────────────────────┐');
  console.log('  │  SAC Chiacchio — MODO POSTGRES (estrutura Prisma ativa)   │');
  console.log('  └─────────────────────────────────────────────────────────┘');
  console.log('  ▸ Abra:  http://localhost:' + PORT);
  console.log('  ▸ Login: master.test / masterPass');
  console.log('');
});
