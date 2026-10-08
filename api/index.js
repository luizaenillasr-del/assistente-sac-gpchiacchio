const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { Resend } = require('resend');
const _resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'SAC Grupo Chiacchio <noreply@grupochiacchio.com.br>';
const APP_URL = (process.env.APP_URL || 'https://assistente-sac-gpchiacchio.vercel.app').replace(/\/$/, '');
const cerebroService = require('./services/cerebroServices');
const mcService = require('./services/matrizConhecimentoService');
const documentService = require('./services/documentService');
const aiService = require('./services/aiService');
const { tratativaEngine, devolutivaEngine, assertividade: assertividadeService } = cerebroService;
const permissoesService = require('./services/permissoesService');
// Injeção de mock Sheets para testes — nunca ativo em produção (env var não existe em prod)
const _sheetsMock = process.env.SHEETS_MOCK_PATH ? (() => { try { return require(process.env.SHEETS_MOCK_PATH); } catch(e) { console.warn('[MOCK] falhou ao carregar:', e.message); return null; } })() : null;
// Flag de leitura PG: padrão false = leituras sempre do Sheets (seguro ao configurar DATABASE_URL)
const PG_LEITURA_ATIVA = String(process.env.PG_LEITURA_ATIVA || 'false').toLowerCase() === 'true';
// Repositórios PostgreSQL (F4/F7) — falha silenciosa, fallback para Sheets
let usuarioRepo, manifestacaoRepo, rncRepo, empresaRepo, conhecimentoRepo;
try {
  usuarioRepo = require('../database/repositories/usuarioRepository');
  manifestacaoRepo = require('../database/repositories/manifestacaoRepository');
  rncRepo = require('../database/repositories/rncRepository');
  empresaRepo = require('../database/repositories/empresaRepository');
  conhecimentoRepo = require('../database/repositories/conhecimentoRepository');
} catch (e) {
  console.warn('[F4] Repositórios PG não disponíveis:', e.message);
}
const app = express();
const ALLOWED_ORIGINS = [
  'https://assistente-sac-gpchiacchio.vercel.app',
  'https://assistente-sac-gpchiacchio-grudfk40c-luiza4.vercel.app',
];
const _ORIGIN_RE = /^https:\/\/assistente-sac-gpchiacchio[a-z0-9-]*\.vercel\.app$/;
const corsOptions = { origin: (origin, cb) => {
  if (!origin || ALLOWED_ORIGINS.includes(origin) || _ORIGIN_RE.test(origin)) cb(null, true);
  else cb(null, false);
}, credentials: true };
app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json({ limit: '25mb' }));
// ===== SECURITY HEADERS =====
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none';"
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  next();
});
function getAuth() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS não configurada.');
  const creds = JSON.parse(raw);
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
// PDF service
let gerarFichaPDF;
try { ({ gerarFichaPDF } = require('./services/pdfFicha')); } catch(e) { console.warn('[PDF] pdfFicha não disponível:', e.message); }
// Google Drive upload (usa mesma service account com scope drive.file)
async function uploadArquivoDrive(nome, mimeType, bufferOuBase64) {
  const buf = Buffer.isBuffer(bufferOuBase64) ? bufferOuBase64 : Buffer.from(bufferOuBase64, 'base64');
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const stream = Readable.from(buf);
  const folderId = process.env.DRIVE_FOLDER_ID || null;
  const meta = { name: nome, mimeType };
  if (folderId) meta.parents = [folderId];
  const res = await drive.files.create({
    requestBody: meta,
    media: { mimeType, body: stream },
    fields: 'id,name,webViewLink,webContentLink',
  });
  const fileId = res.data.id;
  // Torna o arquivo acessível para qualquer pessoa com o link
  try {
