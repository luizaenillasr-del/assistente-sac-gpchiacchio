'use strict';

/**
 * Inventário somente leitura das bases de conhecimento do CIRCA.
 *
 * Este script usa uma credencial dedicada ao Google Sheets com escopo
 * spreadsheets.readonly. Nenhum método de escrita da API é importado ou
 * chamado. O relatório contém apenas metadados e agregações; valores de
 * relatos, nomes de pessoas, e-mails e outros campos livres nunca são
 * gravados no relatório.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');

const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';

const SHEET_PROFILES = {
  CAUSAS: {
    id: ['ID_CAUSA', 'ID'],
    company: ['EMPRESA', 'EMPRESA_APLICAVEL', 'EMPRESAS'],
    status: ['STATUS_VALIDACAO', 'STATUS', 'ATIVO'],
    required: { id: ['ID_CAUSA', 'ID'], category: ['CATEGORIA'], cause: ['CAUSA'], active: ['ATIVO', 'STATUS_VALIDACAO', 'STATUS'] },
    semantic: ['CATEGORIA', 'TIPO', 'CAUSA', 'SUBCAUSA', 'EMPRESA'],
    version: ['VERSAO'],
  },
  MATRIZ_TRATAMENTO: {
    id: ['ID_TRATAMENTO', 'ID_REGRA', 'ID'],
    company: ['EMPRESA'],
    status: ['STATUS', 'ATIVO'],
    required: { id: ['ID_TRATAMENTO', 'ID_REGRA', 'ID'], treatment: ['PROCEDIMENTO', 'TRATATIVA_OBRIGATORIA', 'TRATATIVA_RECOMENDADA', 'TRATATIVA_CONDICIONAL'], status: ['STATUS', 'ATIVO'] },
    semantic: ['EMPRESA', 'TIPO_MANIFESTACAO', 'CATEGORIA', 'SUBCATEGORIA', 'CAUSA_ID', 'CAUSA', 'SUBCAUSA', 'PROCEDIMENTO', 'TRATATIVA_OBRIGATORIA'],
    version: ['VERSAO'],
  },
  MODELOS_DEVOLUTIVA: {
    id: ['ID_MODELO', 'ID'],
    company: ['EMPRESA'],
    status: ['STATUS'],
    required: { id: ['ID_MODELO', 'ID'], title: ['TITULO'], template: ['TEXTO_PADRAO'], status: ['STATUS'], version: ['VERSAO'] },
    semantic: ['TITULO', 'EMPRESA', 'TIPO_MANIFESTACAO', 'CATEGORIA', 'TIPO_DEVOLUTIVA', 'SITUACAO', 'ASSUNTO', 'TEXTO_PADRAO'],
    version: ['VERSAO'],
  },
  DEVOLUTIVAS: {
    id: ['ID_DEVOLUTIVA', 'ID'],
    company: ['EMPRESA'],
    status: ['STATUS'],
    required: { id: ['ID_DEVOLUTIVA', 'ID'], manifestation: ['ID_MANIFESTACAO'], text: ['TEXTO_FINAL', 'TEXTO_APROVADO', 'TEXTO_GERADO'], status: ['STATUS'] },
    semantic: ['ID_MANIFESTACAO', 'ID_TRATATIVA', 'TIPO_DEVOLUTIVA', 'TEXTO_FINAL', 'TEXTO_APROVADO', 'TEXTO_GERADO'],
    version: ['VERSAO_FINAL'],
  },
  BANCO_HISTORICO: {
    id: ['ID_HISTORICO', 'ID_MANIFESTACAO', 'ID'],
    company: ['DRV_EMPRESA_NORMALIZADA', 'ORIG_EMPRESA', 'EMPRESA_RECLAMADA', 'EMPRESA'],
    status: ['STATUS_FINAL', 'STATUS'],
    required: { id: ['ID_HISTORICO', 'ID_MANIFESTACAO', 'ID'], company: ['DRV_EMPRESA_NORMALIZADA', 'ORIG_EMPRESA', 'EMPRESA_RECLAMADA', 'EMPRESA'], status: ['STATUS_FINAL', 'STATUS'] },
    semantic: ['ORIG_EMPRESA', 'EMPRESA_RECLAMADA', 'COMP_TIPO_PROBLEMA_VALIDADO', 'COMP_CAUSA_PROVAVEL', 'CAUSA_RAIZ', 'ORIG_PRODUTO', 'ORIG_DESCRICAO_RECLAMACAO'],
    version: ['VERSAO', 'VERSAO_CIRCA'],
  },
  APRIMORAMENTOS_CEREBRO: {
    id: ['ID_APRIMORAMENTO', 'ID_CASO', 'ID'],
    company: ['EMPRESA'],
    status: ['STATUS'],
    required: { id: ['ID_APRIMORAMENTO', 'ID_CASO', 'ID'], description: ['DESCRICAO', 'TIPO_DESCRICAO', 'PROBLEMA_RECORRENTE'], status: ['STATUS'] },
    semantic: ['TIPO', 'TIPO_PROBLEMA', 'TIPO_DESCRICAO', 'CAUSA_ID', 'CAUSA', 'CAUSA_RAIZ', 'ID_MANIFESTACAO', 'PROBLEMA_RECORRENTE', 'DESCRICAO', 'PROPOSTA_MELHORIA', 'SETOR_RESPONSAVEL', 'SETOR_ACIONADO'],
    version: ['VERSAO'],
  },
};

const SHEETS = Object.keys(SHEET_PROFILES);

const SHEET_ALIASES = {
  CAUSAS: ['CAUSAS', 'CAUSAS E SUBCAUSAS', 'BASE DE CAUSAS'],
  MATRIZ_TRATAMENTO: ['MATRIZ_TRATAMENTO', 'MATRIZ TRATAMENTO', 'MATRIZ DE TRATAMENTO', 'MATRIZ DE TRATAMENTOS'],
  MODELOS_DEVOLUTIVA: ['MODELOS_DEVOLUTIVA', 'MODELOS DEVOLUTIVA', 'MODELOS DEVOLUTIVAS', 'MODELOS DE DEVOLUTIVA', 'MODELOS DE DEVOLUTIVAS', 'BANCO DE DEVOLUTIVAS'],
  DEVOLUTIVAS: ['DEVOLUTIVAS', 'DEVOLUTIVA', 'HISTORICO DEVOLUTIVAS', 'HISTORICO DE DEVOLUTIVAS'],
  BANCO_HISTORICO: ['BANCO_HISTORICO', 'BANCO HISTORICO', 'BANCO DE CASOS', 'HISTORICO', 'HISTORICO DE CASOS'],
  // A planilha real expõe esta base como CEREBRO_APRENDIZADO. Mantemos os
  // nomes legados apenas como aliases para que a leitura não crie outra aba.
  APRIMORAMENTOS_CEREBRO: ['APRIMORAMENTOS_CEREBRO', 'CEREBRO_APRENDIZADO', 'APRIMORAMENTOS CEREBRO', 'APRIMORAMENTOS DO CEREBRO', 'APRIMORAMENTOS CIRCA', 'APRIMORAMENTOS'],
};

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
}

function normalizeSheetTitle(value) {
  return normalize(value).replace(/[^a-z0-9]/g, '');
}

function resolveSheetNames(availableTitles) {
  const titles = [...new Set((availableTitles || []).map(String).filter(Boolean))];
  const result = {};
  for (const expected of SHEETS) {
    const aliases = [expected, ...(SHEET_ALIASES[expected] || [])].map(normalizeSheetTitle);
    const candidates = titles.filter(title => aliases.includes(normalizeSheetTitle(title)));
    if (candidates.length === 1) {
      result[expected] = { expected, status: 'OK', actualName: candidates[0], candidates };
    } else if (candidates.length > 1) {
      result[expected] = { expected, status: 'ABA_AMBIGUA', actualName: null, candidates };
    } else {
      result[expected] = { expected, status: 'ABA_AUSENTE', actualName: null, candidates: [] };
    }
  }
  return result;
}

function quoteSheetRange(title) {
  return `'${String(title).replace(/'/g, "''")}'!A:AZ`;
}

function inventoryError(code, message, cause) {
  const error = new Error(message);
  error.inventoryCode = code;
  error.cause = cause;
  return error;
}

function hashToken(value) {
  return crypto.createHash('sha256').update(String(value ?? ''), 'utf8').digest('hex').slice(0, 12);
}

function safeCategory(value) {
  const normalized = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!normalized) return '(vazio)';
  if (normalized.length > 80 || /@/.test(normalized)) return `[hash:${hashToken(normalized)}]`;
  return normalized;
}

function firstField(headers, aliases) {
  return (aliases || []).find(alias => headers.includes(alias)) || null;
}

function nonBlankRows(rows) {
  return rows.filter(row => Object.entries(row).some(([key, value]) => key !== '__linha' && String(value ?? '').trim()));
}

function columnContract(headers, aliases) {
  const found = firstField(headers, aliases);
  return found || null;
}

function summarizeDistribution(rows, headers, aliases) {
  const field = firstField(headers, aliases);
  if (!field) return { field: null, values: {} };
  const values = {};
  for (const row of rows) {
    const key = safeCategory(row[field]);
    values[key] = (values[key] || 0) + 1;
  }
  return { field, values };
}

function duplicateGroups(rows, headers, aliases) {
  const field = firstField(headers, aliases);
  if (!field) return { field: null, missing: rows.length, groups: [] };
  const groups = new Map();
  for (const row of rows) {
    const value = String(row[field] ?? '').trim();
    if (!value) continue;
    const key = normalize(value);
    const item = groups.get(key) || { token: hashToken(value), rows: [], count: 0 };
    item.rows.push(Number(row.__linha || 0));
    item.count++;
    groups.set(key, item);
  }
  return {
    field,
    missing: rows.filter(row => !String(row[field] ?? '').trim()).length,
    groups: [...groups.values()].filter(group => group.count > 1).slice(0, 100),
  };
}

function incompleteRows(rows, headers, required) {
  const requiredFields = Object.entries(required).map(([label, aliases]) => ({ label, field: firstField(headers, aliases) }));
  const missingHeaders = requiredFields.filter(item => !item.field).map(item => item.label);
  const rowsWithMissing = [];
  for (const row of rows) {
    const missing = requiredFields.filter(item => item.field && !String(row[item.field] ?? '').trim()).map(item => item.label);
    if (missing.length) rowsWithMissing.push({ row: Number(row.__linha || 0), missing });
  }
  return { required: requiredFields, missingHeaders, rows: rowsWithMissing.slice(0, 200), total: rowsWithMissing.length };
}

function semanticDuplicateGroups(rows, headers, fields) {
  const available = fields.filter(field => headers.includes(field));
  if (!available.length) return { fields: [], groups: [] };
  const groups = new Map();
  for (const row of rows) {
    const values = available.map(field => normalize(row[field])).join('|');
    if (!values.replace(/\|/g, '')) continue;
    const item = groups.get(values) || { token: hashToken(values), rows: [], count: 0 };
    item.rows.push(Number(row.__linha || 0));
    item.count++;
    groups.set(values, item);
  }
  return { fields: available, groups: [...groups.values()].filter(group => group.count > 1).slice(0, 100) };
}

function versionSummary(rows, headers, aliases) {
  const field = firstField(headers, aliases);
  if (!field) return { field: null, missing: rows.length, invalid: 0, distinct: [] };
  const values = rows.map(row => String(row[field] ?? '').trim()).filter(Boolean);
  const invalid = values.filter(value => !/^\d+(?:\.\d+)*$/.test(value)).length;
  return { field, missing: rows.length - values.length, invalid, distinct: [...new Set(values)].sort().slice(0, 50) };
}

function buildIndex(rows, headers, aliases) {
  const field = firstField(headers, aliases);
  const index = new Map();
  if (!field) return { field: null, index };
  for (const row of rows) {
    const value = String(row[field] ?? '').trim();
    if (value) index.set(normalize(value), Number(row.__linha || 0));
  }
  return { field, index };
}

function referenceCheck(data) {
  const refs = [];
  const causas = buildIndex(data.CAUSAS.rows, data.CAUSAS.headers, SHEET_PROFILES.CAUSAS.id);
  const historico = buildIndex(data.BANCO_HISTORICO.rows, data.BANCO_HISTORICO.headers, SHEET_PROFILES.BANCO_HISTORICO.id);

  function check(sourceSheet, sourceAliases, target, targetIndex, relation, options = {}) {
    const source = data[sourceSheet];
    const sourceField = firstField(source.headers, sourceAliases);
    if (!sourceField || !targetIndex.field) {
      refs.push({ source: sourceSheet, field: sourceField, target, targetField: targetIndex.field, relation, checked: 0, invalid: 0, notVerifiable: source.rows.length });
      return;
    }
    let checked = 0;
    const invalidRows = [];
    for (const row of source.rows) {
      const value = String(row[sourceField] ?? '').trim();
      if (!value) continue;
      checked++;
      if (!targetIndex.index.has(normalize(value))) invalidRows.push(Number(row.__linha || 0));
    }
    refs.push({
      source: sourceSheet, field: sourceField, target, targetField: targetIndex.field, relation, checked,
      invalid: options.externalPossible ? 0 : invalidRows.length,
      invalidRows: options.externalPossible ? [] : invalidRows.slice(0, 100),
      unresolved: options.externalPossible ? invalidRows.length : 0,
      notVerifiable: 0,
      note: options.externalPossible ? 'O alvo pode estar em uma base operacional fora deste inventário.' : undefined,
    });
  }

  check('MATRIZ_TRATAMENTO', ['CAUSA_ID'], 'CAUSAS', causas, 'CAUSA_ID -> ID_CAUSA');
  check('APRIMORAMENTOS_CEREBRO', ['CAUSA_ID'], 'CAUSAS', causas, 'CAUSA_ID -> ID_CAUSA');
  check('DEVOLUTIVAS', ['ID_MANIFESTACAO'], 'BANCO_HISTORICO', historico, 'ID_MANIFESTACAO -> ID_HISTORICO/ID_MANIFESTACAO', { externalPossible: true });
  check('APRIMORAMENTOS_CEREBRO', ['ID_MANIFESTACAO'], 'BANCO_HISTORICO', historico, 'ID_MANIFESTACAO -> ID_HISTORICO/ID_MANIFESTACAO', { externalPossible: true });

  const devolutivas = data.DEVOLUTIVAS;
  const trField = firstField(devolutivas.headers, ['ID_TRATATIVA']);
  refs.push({
    source: 'DEVOLUTIVAS', field: trField, target: 'TRATATIVAS_SETORIAIS/Tratativa', targetField: null,
    relation: 'ID_TRATATIVA -> base de tratativas fora do inventário', checked: trField ? devolutivas.rows.filter(row => String(row[trField] ?? '').trim()).length : 0,
    invalid: 0, notVerifiable: trField ? devolutivas.rows.filter(row => String(row[trField] ?? '').trim()).length : devolutivas.rows.length,
  });
  return refs;
}

function analyzeSheets(rawSheets, context = {}) {
  const data = {};
  for (const sheet of SHEETS) {
    const raw = rawSheets[sheet] || { headers: [], rows: [] };
    const headers = [...new Set((raw.headers || []).map(value => String(value).trim()).filter(Boolean))];
    const rows = nonBlankRows(raw.rows || []);
    const profile = SHEET_PROFILES[sheet];
    const semantic = semanticDuplicateGroups(rows, headers, profile.semantic);
    const version = versionSummary(rows, headers, profile.version);
    const versionsBySemantic = {};
    const availableVersionField = version.field;
    if (availableVersionField && semantic.fields.length) {
      const groups = new Map();
      for (const row of rows) {
        const key = semantic.fields.map(field => normalize(row[field])).join('|');
        if (!key.replace(/\|/g, '')) continue;
        const value = String(row[availableVersionField] ?? '').trim();
        if (!groups.has(key)) groups.set(key, new Set());
        if (value) groups.get(key).add(value);
      }
      versionsBySemantic.multipleVersions = [...groups.entries()]
        .filter(([, values]) => values.size > 1)
        .slice(0, 100)
        .map(([key, values]) => ({ token: hashToken(key), versions: [...values].sort() }));
    }
    data[sheet] = {
      status: raw.status || 'OK',
      actualName: raw.actualName || null,
      count: rows.length,
      headers,
      fields: {
        id: columnContract(headers, profile.id),
        company: columnContract(headers, profile.company),
        status: columnContract(headers, profile.status),
        used: [...new Set([
          ...profile.id, ...profile.company, ...profile.status,
          ...Object.values(profile.required).flat(), ...profile.semantic, ...profile.version,
        ].filter(field => headers.includes(field)))],
      },
      distribution: {
        company: summarizeDistribution(rows, headers, profile.company),
        status: summarizeDistribution(rows, headers, profile.status),
      },
      ids: duplicateGroups(rows, headers, profile.id),
      incomplete: incompleteRows(rows, headers, profile.required),
      semanticDuplicates: semantic,
      versions: { ...version, bySemantic: versionsBySemantic },
    };
    data[sheet].rows = rows;
  }

  const references = referenceCheck(data);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    availableSheets: context.availableSheets || [],
    sheetMap: context.sheetMap || resolveSheetNames(context.availableSheets || []),
    sheets: Object.fromEntries(SHEETS.map(sheet => {
      const item = { ...data[sheet] };
      delete item.rows;
      return [sheet, item];
    })),
    references,
    privacy: {
      rawRowsIncluded: false,
      freeTextIncluded: false,
      personalDataIncluded: false,
      identifiersMasked: true,
    },
  };
  return report;
}

function safeError(error) {
  const code = error?.inventoryCode;
  if (code === 'CONFIG_MISSING') return 'Configuração ausente para o inventário.';
  if (code === 'AUTHENTICATION') return 'Falha de autenticação no Google Sheets.';
  if (code === 'PERMISSION') return 'A conta configurada não tem permissão de leitura na planilha.';
  if (code === 'API_COMMUNICATION') return 'Falha de comunicação com a API Google Sheets.';
  if (code === 'API_METADATA') return 'Falha ao consultar os metadados da planilha.';
  if (code === 'API_VALUES') return 'Falha ao ler os valores das abas existentes.';
  const message = String(error?.message || error || 'erro desconhecido');
  if (/credential|token|secret|password|authorization/i.test(message)) {
    return 'Falha de autenticação ou acesso ao Google Sheets.';
  }
  return message.replace(/https?:\/\/[^\s]+/gi, '[url omitida]').slice(0, 240);
}

function classifyGoogleError(error, fallbackCode) {
  if (['ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(String(error?.code || ''))) {
    return inventoryError('API_COMMUNICATION', 'Falha de comunicação com a API Google Sheets.', error);
  }
  const status = Number(error?.response?.status || error?.code || 0);
  if (status === 401) return inventoryError('AUTHENTICATION', 'Google Sheets rejeitou a autenticação.', error);
  if (status === 403) return inventoryError('PERMISSION', 'A conta não possui permissão suficiente.', error);
  if (status === 429 || status >= 500) return inventoryError('API_COMMUNICATION', 'A API Google Sheets está indisponível.', error);
  return inventoryError(fallbackCode, 'Falha na API Google Sheets.', error);
}

async function readSheets() {
  if (!process.env.GOOGLE_CREDENTIALS) throw inventoryError('CONFIG_MISSING', 'GOOGLE_CREDENTIALS ausente');
  if (!process.env.SPREADSHEET_ID) throw inventoryError('CONFIG_MISSING', 'SPREADSHEET_ID ausente');
  let credentials;
  try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); } catch (_) { throw inventoryError('AUTHENTICATION', 'Credencial inválida'); }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [READONLY_SCOPE] });
  let client;
  try { client = await auth.getClient(); } catch (error) { throw classifyGoogleError(error, 'AUTHENTICATION'); }
  const sheets = google.sheets({ version: 'v4', auth: client });

  let metadata;
  try {
    metadata = await sheets.spreadsheets.get({
      spreadsheetId: process.env.SPREADSHEET_ID,
      fields: 'sheets(properties(title,sheetId,index,hidden))',
    });
  } catch (error) { throw classifyGoogleError(error, 'API_METADATA'); }

  const availableSheets = (metadata.data.sheets || []).map(item => ({
    title: String(item.properties?.title || ''),
    sheetId: Number(item.properties?.sheetId || 0),
    index: Number(item.properties?.index || 0),
    hidden: Boolean(item.properties?.hidden),
  })).filter(item => item.title);
  const sheetMap = resolveSheetNames(availableSheets.map(item => item.title));
  const readable = SHEETS.filter(expected => sheetMap[expected].status === 'OK');
  let response = { data: { valueRanges: [] } };
  if (readable.length) {
    try {
      response = await sheets.spreadsheets.values.batchGet({
        spreadsheetId: process.env.SPREADSHEET_ID,
        ranges: readable.map(expected => quoteSheetRange(sheetMap[expected].actualName)),
        valueRenderOption: 'FORMATTED_VALUE',
      });
    } catch (error) { throw classifyGoogleError(error, 'API_VALUES'); }
  }

  const valuesByExpected = new Map();
  readable.forEach((expected, index) => valuesByExpected.set(expected, response.data.valueRanges?.[index]?.values || []));
  const result = {};
  for (const sheet of SHEETS) {
    const resolution = sheetMap[sheet];
    const values = valuesByExpected.get(sheet) || [];
    const headers = values[0] || [];
    const rows = values.slice(1).map((row, rowIndex) => {
      const item = { __linha: rowIndex + 2 };
      headers.forEach((header, columnIndex) => {
        if (header) item[header] = row[columnIndex] ?? '';
      });
      return item;
    });
    result[sheet] = { headers, rows, status: resolution.status, actualName: resolution.actualName };
  }
  return { sheets: result, availableSheets, sheetMap };
}

async function main() {
  const output = process.env.INVENTARIO_OUTPUT || path.join(process.cwd(), 'circa-inventario.json');
  try {
    const source = await readSheets();
    const report = analyzeSheets(source.sheets, source);
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    for (const sheet of SHEETS) console.log(`${sheet}: ${report.sheets[sheet].status} (${report.sheets[sheet].count} registros)`);
    console.log(`Relatório sanitizado gravado em ${output}`);
  } catch (error) {
    console.error(`Inventário interrompido: ${safeError(error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  READONLY_SCOPE,
  SHEETS,
  SHEET_PROFILES,
  SHEET_ALIASES,
  analyzeSheets,
  resolveSheetNames,
  quoteSheetRange,
  normalize,
  safeError,
};
