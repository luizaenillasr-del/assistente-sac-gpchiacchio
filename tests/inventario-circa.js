'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { analyzeSheets, READONLY_SCOPE, SHEETS, resolveSheetNames, quoteSheetRange, safeError } = require('../scripts/inventario-circa');

const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'inventario-circa-manual.yml'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'inventario-circa.js'), 'utf8');

assert.match(workflow, /workflow_dispatch:/);
assert.doesNotMatch(workflow, /(^|\n)\s+(push|pull_request):/);
assert.doesNotMatch(workflow, /migrate\s+(deploy|resolve|reset)|DATABASE_URL|prisma\s+db\s+push/i);
assert.doesNotMatch(workflow, /values\.(append|update|batchUpdate)|spreadsheets\.batchUpdate/i);
assert.equal(READONLY_SCOPE, 'https://www.googleapis.com/auth/spreadsheets.readonly');
assert.match(script, /spreadsheets\.readonly/);
assert.match(script, /spreadsheets\.get/);
assert.match(script, /sheets\(properties\(title,sheetId,index,hidden\)\)/);
assert.match(script, /values\.batchGet/);
assert.doesNotMatch(script, /values\.(append|update|batchUpdate)|spreadsheets\.batchUpdate/);
assert.doesNotMatch(script, /console\.(log|error)\([^\n]*(row|relato|texto|nome|email|cliente)/i);

const rows = {
  CAUSAS: {
    headers: ['ID_CAUSA', 'CATEGORIA', 'CAUSA', 'SUBCAUSA', 'EMPRESA', 'STATUS_VALIDACAO', 'ATIVO', 'VERSAO'],
    rows: [
      { ID_CAUSA: 'CAU-1', CATEGORIA: 'Qualidade', CAUSA: 'Falha A', SUBCAUSA: 'Sub A', EMPRESA: 'CHIACCHIO', STATUS_VALIDACAO: 'HIPOTESE', ATIVO: 'SIM', VERSAO: '1', __linha: 2 },
      { ID_CAUSA: 'CAU-1', CATEGORIA: 'Qualidade', CAUSA: 'Falha A', SUBCAUSA: 'Sub A', EMPRESA: 'CHIACCHIO', STATUS_VALIDACAO: 'HIPOTESE', ATIVO: 'SIM', VERSAO: '2', __linha: 3 },
    ],
  },
  MATRIZ_TRATAMENTO: {
    headers: ['ID_TRATAMENTO', 'EMPRESA', 'CAUSA_ID', 'PROCEDIMENTO', 'STATUS', 'VERSAO'],
    rows: [{ ID_TRATAMENTO: 'TRAT-1', EMPRESA: 'CHIACCHIO', CAUSA_ID: 'CAU-inexistente', PROCEDIMENTO: 'Procedimento', STATUS: 'RASCUNHO', VERSAO: '1', __linha: 2 }],
  },
  MODELOS_DEVOLUTIVA: {
    headers: ['ID_MODELO', 'TITULO', 'TEXTO_PADRAO', 'STATUS', 'VERSAO', 'EMPRESA'],
    rows: [{ ID_MODELO: 'MOD-1', TITULO: 'Modelo', TEXTO_PADRAO: 'Cliente: pessoa@example.com; relato confidencial', STATUS: 'APROVADA', VERSAO: '1', EMPRESA: 'CHIACCHIO', __linha: 2 }],
  },
  DEVOLUTIVAS: {
    headers: ['ID_DEVOLUTIVA', 'ID_MANIFESTACAO', 'TEXTO_GERADO', 'STATUS', 'EMPRESA'],
    rows: [{ ID_DEVOLUTIVA: 'DEV-1', ID_MANIFESTACAO: 'MAN-1', TEXTO_GERADO: 'relato confidencial', STATUS: 'ENVIADA', EMPRESA: 'CHIACCHIO', __linha: 2 }],
  },
  BANCO_HISTORICO: {
    headers: ['ID_HISTORICO', 'EMPRESA', 'STATUS_FINAL'],
    rows: [{ ID_HISTORICO: 'HIST-1', EMPRESA: 'CHIACCHIO', STATUS_FINAL: 'CONCLUIDA', __linha: 2 }],
  },
  APRIMORAMENTOS_CEREBRO: {
    headers: ['ID_APRIMORAMENTO', 'CAUSA_ID', 'ID_MANIFESTACAO', 'DESCRICAO', 'STATUS', 'VERSAO'],
    rows: [{ ID_APRIMORAMENTO: 'APR-1', CAUSA_ID: 'CAU-inexistente', ID_MANIFESTACAO: 'HIST-inexistente', DESCRICAO: 'Melhoria', STATUS: 'EM_REVISAO', VERSAO: '1', __linha: 2 }],
  },
};

const report = analyzeSheets(rows);
assert.deepEqual(Object.keys(report.sheets), SHEETS);
assert.equal(report.sheets.CAUSAS.count, 2);
assert.equal(report.sheets.CAUSAS.ids.groups.length, 1);
assert.equal(report.references.find(item => item.source === 'MATRIZ_TRATAMENTO').invalid, 1);
assert.equal(report.references.find(item => item.source === 'APRIMORAMENTOS_CEREBRO' && item.field === 'ID_MANIFESTACAO').unresolved, 1);
assert.equal(report.privacy.rawRowsIncluded, false);
assert.equal(report.privacy.freeTextIncluded, false);
assert.equal(report.privacy.personalDataIncluded, false);
const serialized = JSON.stringify(report);
assert.doesNotMatch(serialized, /pessoa@example\.com|relato confidencial/i);
assert.doesNotMatch(serialized, /Falha A|Procedimento/);

const resolved = resolveSheetNames([
  'CAUSAS E SUBCAUSAS',
  'Matriz de Tratamentos',
  'Modelos de Devolutivas',
  'Devolutiva',
  'Banco de Casos',
]);
assert.equal(resolved.CAUSAS.status, 'OK');
assert.equal(resolved.CAUSAS.actualName, 'CAUSAS E SUBCAUSAS');
assert.equal(resolved.MATRIZ_TRATAMENTO.status, 'OK');
assert.equal(resolved.MODELOS_DEVOLUTIVA.actualName, 'Modelos de Devolutivas');
assert.equal(resolved.DEVOLUTIVAS.actualName, 'Devolutiva');
assert.equal(resolved.BANCO_HISTORICO.actualName, 'Banco de Casos');
assert.equal(resolved.APRIMORAMENTOS_CEREBRO.status, 'ABA_AUSENTE');
assert.equal(quoteSheetRange("Aba de teste's"), "'Aba de teste''s'!A:AZ");

const missingReport = analyzeSheets({
  ...rows,
  APRIMORAMENTOS_CEREBRO: { headers: [], rows: [], status: 'ABA_AUSENTE', actualName: null },
}, {
  availableSheets: [{ title: 'CAUSAS E SUBCAUSAS', sheetId: 1, index: 0, hidden: false }],
  sheetMap: resolved,
});
assert.equal(missingReport.sheets.APRIMORAMENTOS_CEREBRO.status, 'ABA_AUSENTE');
assert.equal(missingReport.sheets.APRIMORAMENTOS_CEREBRO.count, 0);
assert.equal(missingReport.sheetMap.APRIMORAMENTOS_CEREBRO.status, 'ABA_AUSENTE');
assert.equal(missingReport.sheets.CAUSAS.status, 'OK');
assert.match(safeError(Object.assign(new Error('range not found'), { inventoryCode: 'API_VALUES' })), /valores das abas existentes/);
assert.match(safeError(Object.assign(new Error('permission denied'), { inventoryCode: 'PERMISSION' })), /permissão de leitura/);
assert.match(safeError(Object.assign(new Error('network'), { inventoryCode: 'API_COMMUNICATION' })), /comunicação/);
assert.doesNotMatch(safeError(new Error('APRIMORAMENTOS_CEREBRO!A:AZ not found')), /ABA_AUSENTE/);

console.log('Inventário CIRCA: testes de segurança e agregação aprovados.');
