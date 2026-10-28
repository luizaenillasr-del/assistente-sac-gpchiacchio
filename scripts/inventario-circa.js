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
    id: ['ID_APRIMORAMENTO', 'ID'],
    company: ['EMPRESA'],
    status: ['STATUS'],
    required: { id: ['ID_APRIMORAMENTO', 'ID'], description: ['DESCRICAO', 'PROBLEMA_RECORRENTE'], status: ['STATUS'] },
    semantic: ['TIPO', 'CAUSA_ID', 'CAUSA', 'ID_MANIFESTACAO', 'PROBLEMA_RECORRENTE', 'DESCRICAO', 'PROPOSTA_MELHORIA', 'SETOR_RESPONSAVEL'],
    version: ['VERSAO'],
  },
};

const SHEETS = Object.keys(SHEET_PROFILES);

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[\s\-_]+/g, ' ').trim();
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

function valueFor(row, headers, aliases) {
  const field = firstField(headers, aliases);
  return field ? String(row[field] ?? '').trim() : '';
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

function analyzeSheets(rawSheets) {
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
  const message = String(error?.message || error || 'erro desconhecido');
  if (/credential|token|secret|password|authorization|spreadsheet/i.test(message)) {
    return 'Falha de autenticação ou acesso ao Google Sheets.';
  }
  return message.replace(/https?:\/\/[^\s]+/gi, '[url omitida]').slice(0, 240);
}

async function readSheets() {
  if (!process.env.GOOGLE_CREDENTIALS) throw new Error('GOOGLE_CREDENTIALS ausente');
  if (!process.env.SPREADSHEET_ID) throw new Error('SPREADSHEET_ID ausente');
  let credentials;
  try { credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS); } catch (_) { throw new Error('credencial inválida'); }
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [READONLY_SCOPE] });
  const client = await auth.getClient();
  const sheets = google.sheets({ version: 'v4', auth: client });
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: process.env.SPREADSHEET_ID,
    ranges: SHEETS.map(sheet => `${sheet}!A:AZ`),
    valueRenderOption: 'FORMATTED_VALUE',
  });
  const result = {};
  for (const [index, sheet] of SHEETS.entries()) {
    const values = response.data.valueRanges?.[index]?.values || [];
    const headers = values[0] || [];
    const rows = values.slice(1).map((row, rowIndex) => {
      const item = { __linha: rowIndex + 2 };
      headers.forEach((header, columnIndex) => {
        if (header) item[header] = row[columnIndex] ?? '';
      });
      return item;
    });
    result[sheet] = { headers, rows };
  }
  return result;
}

async function main() {
  const output = process.env.INVENTARIO_OUTPUT || path.join(process.cwd(), 'circa-inventario.json');
  try {
    const report = analyzeSheets(await readSheets());
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    for (const sheet of SHEETS) console.log(`${sheet}: ${report.sheets[sheet].count} registros`);
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
  analyzeSheets,
  normalize,
  safeError,
};
