'use strict';

/*
 * Reconciliação sanitizada do conhecimento CIRCA.
 *
 * Lê Google Sheets com spreadsheets.readonly e PostgreSQL dentro de uma
 * transação READ ONLY. O artefato nunca inclui texto livre, contatos ou IDs
 * em claro: cada registro é identificado por um token SHA-256 curto.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { google } = require('googleapis');
const { Client } = require('pg');
const matriz = require('../server-services/matrizTratamentoService');
const cerebro = require('../server-services/cerebroServices');

const READONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const SHEETS = ['MATRIZ_TRATAMENTO', 'BANCO_HISTORICO', 'MODELOS_DEVOLUTIVA', 'DEVOLUTIVAS', 'CAUSAS', 'CEREBRO_APRENDIZADO'];

function token(value) {
  return `id:${crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex').slice(0, 12)}`;
}

function filled(value) { return String(value ?? '').trim() !== ''; }

function fieldMask(row, fields) {
  return Object.fromEntries(fields.map(field => [field, filled(row[field]) ? 'PRESENTE' : 'AUSENTE']));
}

function normalizarEmpresa(value) {
  const v = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
  if (!v) return 'AUSENTE';
  if (v.includes('PLASCHIO')) return 'PLASCHIO';
  if (v.includes('TUBAHIA') || v.includes('CESBAP')) return 'TUBAHIA';
  if (v.includes('CHIACCHIO') || v.includes('CHIACHIO')) return 'CHIACCHIO';
  return 'OUTRA';
}

function parseSheet(values) {
  const headers = (values[0] || []).map(v => String(v || '').trim());
  return (values.slice(1) || []).map((line, index) => {
    const row = { __linha: index + 2 };
    headers.forEach((header, column) => { if (header) row[header] = line[column] ?? ''; });
    return row;
  }).filter(row => Object.entries(row).some(([key, value]) => key !== '__linha' && filled(value)));
}

function tratarMatriz(rows) {
  return rows.map(row => {
    const regra = matriz.normalizarRegra(row);
    const validacao = matriz.validarRegra(regra);
    return {
      id: token(regra.ID_TRATAMENTO || regra.ID_REGRA || `linha:${row.__linha}`),
      linha: row.__linha,
      contrato: regra.CONTRATO,
      empresa: normalizarEmpresa(regra.EMPRESA),
      campos: fieldMask(regra, ['ID_TRATAMENTO', 'ID_REGRA', 'EMPRESA', 'TIPO_MANIFESTACAO', 'CATEGORIA', 'SUBCATEGORIA', 'CAUSA', 'SUBCAUSA', 'SETOR_RESPONSAVEL', 'TRATATIVA_OBRIGATORIA', 'TRATATIVA_RECOMENDADA', 'CONDICAO', 'ATIVO', 'STATUS']),
      estadoCadastral: filled(regra.STATUS) ? String(regra.STATUS).trim().toUpperCase() : (String(regra.ATIVO).trim().toUpperCase() === 'SIM' ? 'ATIVO_SEM_STATUS_OPERACIONAL' : 'SEM_ESTADO'),
      elegivelCirca: Boolean(validacao.utilizavel),
      motivosInelegibilidade: validacao.utilizavel ? [] : validacao.motivos,
    };
  });
}

function tratarHistorico(rows) {
  const ids = new Map();
  return rows.map(row => {
    const idOriginal = row.ORIG_ID_MANIFESTACAO || row.ID_MANIFESTACAO || row.ID_HISTORICO || row.ID || `linha:${row.__linha}`;
    const id = token(idOriginal);
    ids.set(id, (ids.get(id) || 0) + 1);
    const elegivel = cerebro.historicoPodeAlimentarCirca(row);
    return {
      id,
      linha: row.__linha,
      empresa: normalizarEmpresa(row.DRV_EMPRESA_NORMALIZADA || row.ORIG_EMPRESA || row.EMPRESA_RECLAMADA || row.EMPRESA),
      campos: fieldMask(row, ['ID_HISTORICO', 'ORIG_ID_MANIFESTACAO', 'DRV_EMPRESA_NORMALIZADA', 'ORIG_EMPRESA', 'ORIG_DESCRICAO_RECLAMACAO', 'STATUS_DADO', 'STATUS_HISTORICO']),
      elegivelSimilaridade: elegivel,
      elegivelReincidencia: elegivel,
      duplicado: false,
    };
  }).map(item => ({ ...item, duplicado: ids.get(item.id) > 1 }));
}

function tratarModelos(rows) {
  return rows.map(row => {
    const aprovado = ['APROVADA', 'APROVADO', 'PUBLICADA'].includes(String(row.STATUS || '').trim().toUpperCase());
    const elegivel = aprovado && filled(row.ID_MODELO) && filled(row.TEXTO_PADRAO);
    return {
      id: token(row.ID_MODELO || `linha:${row.__linha}`), linha: row.__linha,
      empresa: normalizarEmpresa(row.EMPRESA),
      campos: fieldMask(row, ['ID_MODELO', 'TITULO', 'TEXTO_PADRAO', 'STATUS', 'VERSAO']),
      elegivelDevolutiva: elegivel,
      motivo: elegivel ? '' : 'ID_TEXTO_OU_STATUS_INSUFICIENTE',
    };
  });
}

function tratarCasosAprendidos(rows) {
  return rows.map(row => ({
    id: token(row.ID_CASO || `linha:${row.__linha}`), linha: row.__linha,
    empresa: normalizarEmpresa(row.EMPRESA),
    contrato: 'CEREBRO_APRENDIZADO',
    campos: fieldMask(row, ['ID_CASO', 'TIPO_DESCRICAO', 'CAUSA_RAIZ', 'TRATATIVA_APLICADA', 'DATA_VALIDACAO', 'RESPONSAVEL_VALIDACAO']),
    elegivelComoAprovado: false,
    motivo: 'CONTRATO_SEM_STATUS_CANONICO',
  }));
}

function resumo(items, key) {
  return { total: items.length, elegiveis: items.filter(item => item[key]).length, inelegiveis: items.filter(item => !item[key]).length };
}

async function lerSheetsReadonly() {
  if (!process.env.GOOGLE_CREDENTIALS || !process.env.SPREADSHEET_ID) throw new Error('GOOGLE_SHEETS_CONFIG_AUSENTE');
  const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({ credentials, scopes: [READONLY_SCOPE] });
  const sheets = google.sheets({ version: 'v4', auth: await auth.getClient() });
  const response = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: process.env.SPREADSHEET_ID,
    ranges: SHEETS.map(name => `'${name.replace(/'/g, "''")}'!A:AZ`),
    valueRenderOption: 'FORMATTED_VALUE',
  });
  return Object.fromEntries(SHEETS.map((name, index) => [name, parseSheet(response.data.valueRanges?.[index]?.values || [])]));
}

async function lerPostgresReadonly() {
  const connectionString = process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) return { status: 'CONFIGURACAO_AUSENTE', necessidade: 'DATABASE_URL_UNPOOLED com acesso somente leitura ao Neon de produção.', tabelas: {} };
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '15000'");
    const available = await client.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])", [['matriz_tratamento', 'manifestacoes', 'devolutivas']]);
    const names = new Set(available.rows.map(row => row.table_name));
    const tabelas = {};
    if (names.has('matriz_tratamento')) {
      const rows = await client.query("SELECT id, id_original, empresa_id IS NOT NULL AS empresa_presente, setor_id IS NOT NULL AS setor_id_presente, tipo_manifestacao IS NOT NULL AND btrim(tipo_manifestacao) <> '' AS tipo_presente, categoria IS NOT NULL AND btrim(categoria) <> '' AS categoria_presente, subcategoria IS NOT NULL AND btrim(subcategoria) <> '' AS subcategoria_presente, setor_responsavel IS NOT NULL AND btrim(setor_responsavel) <> '' AS setor_presente, tratativa_obrigatoria IS NOT NULL AND btrim(tratativa_obrigatoria) <> '' AS tratamento_presente, ativo, versao FROM matriz_tratamento");
      tabelas.matrizTratamento = rows.rows.map(row => ({ id: token(row.id_original || `pg:${row.id}`), referenciaPlanilha: Boolean(row.id_original), campos: Object.fromEntries(Object.entries(row).filter(([key]) => key.endsWith('_presente')).map(([key, value]) => [key, value ? 'PRESENTE' : 'AUSENTE'])), ativo: row.ativo === true, versao: Number(row.versao || 0) }));
    }
    if (names.has('manifestacoes')) {
      const rows = await client.query("SELECT id, id_original, protocolo, empresa_nome IS NOT NULL AND btrim(empresa_nome) <> '' AS empresa_presente, descricao IS NOT NULL AND btrim(descricao) <> '' AS descricao_presente, status FROM manifestacoes");
      tabelas.manifestacoes = rows.rows.map(row => ({ id: token(row.id_original || row.protocolo || `pg:${row.id}`), referenciaPlanilha: Boolean(row.id_original), empresaPresente: row.empresa_presente, descricaoPresente: row.descricao_presente, status: String(row.status || '').toUpperCase() }));
    }
    if (names.has('devolutivas')) {
      const rows = await client.query("SELECT id, manifestacao_id, texto_final IS NOT NULL AND btrim(texto_final) <> '' AS texto_final_presente, status FROM devolutivas");
      tabelas.devolutivas = rows.rows.map(row => ({ id: token(`pg:${row.id}`), manifestacao: token(`pg-manifestacao:${row.manifestacao_id}`), textoFinalPresente: row.texto_final_presente, status: String(row.status || '').toUpperCase() }));
    }
    await client.query('ROLLBACK');
    return { status: 'OK', tabelas };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch (_) { /* conexão indisponível */ }
    return { status: 'LEITURA_INDISPONIVEL', necessidade: 'Confirmar DATABASE_URL_UNPOOLED de produção com permissão SELECT.', codigo: String(error.code || 'CONEXAO') };
  } finally { await client.end().catch(() => {}); }
}

function comparar(sheetItems, pgItems) {
  const pg = new Set((pgItems || []).filter(item => item.referenciaPlanilha).map(item => item.id));
  return {
    sheetsComCorrespondenciaPg: sheetItems.filter(item => pg.has(item.id)).length,
    somenteSheets: sheetItems.filter(item => !pg.has(item.id)).map(item => item.id),
    somentePg: (pgItems || []).filter(item => item.referenciaPlanilha && !new Set(sheetItems.map(x => x.id)).has(item.id)).map(item => item.id),
  };
}

function origemInterface() {
  return {
    bancoDeCasos: { fonte: 'GET /api/manifestacoes?status=FINALIZADA&limit=500', base: 'MANIFESTACOES', consequencia: 'Não exibe diretamente BANCO_HISTORICO.' },
    circa: { fonte: 'GET /api/manifestacoes/:id/circa', bases: ['MANIFESTACOES', 'MATRIZ_TRATAMENTO', 'CAUSAS', 'BANCO_HISTORICO', 'MODELOS_DEVOLUTIVA'], consequencia: 'Similares vêm de BANCO_HISTORICO e do repositório PostgreSQL quando disponível.' },
  };
}

async function executar() {
  const sheets = await lerSheetsReadonly();
  const tratamentos = tratarMatriz(sheets.MATRIZ_TRATAMENTO);
  const historico = tratarHistorico(sheets.BANCO_HISTORICO);
  const modelos = tratarModelos(sheets.MODELOS_DEVOLUTIVA);
  const aprendidos = tratarCasosAprendidos(sheets.CEREBRO_APRENDIZADO);
  const postgres = await lerPostgresReadonly();
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(), mode: 'read-only',
    privacy: { idsProtected: true, freeTextIncluded: false, personalDataIncluded: false, secretsIncluded: false },
    matrizTratamento: { resumo: resumo(tratamentos, 'elegivelCirca'), registros: tratamentos },
    bancoHistorico: { resumo: resumo(historico, 'elegivelSimilaridade'), registros: historico },
    modelosDevolutiva: { resumo: resumo(modelos, 'elegivelDevolutiva'), registros: modelos },
    cerebroAprendizado: { total: aprendidos.length, registros: aprendidos },
    devolutivas: { total: sheets.DEVOLUTIVAS.length },
    postgres,
    divergencias: {
      matrizTratamento: postgres.status === 'OK' ? comparar(tratamentos, postgres.tabelas.matrizTratamento) : { status: 'NAO_COMPARADO' },
      manifestacoesHistoricas: postgres.status === 'OK' ? comparar(historico, postgres.tabelas.manifestacoes) : { status: 'NAO_COMPARADO' },
    },
    interface: origemInterface(),
  };
}

async function main() {
  const output = process.env.RECONCILIACAO_OUTPUT || path.join(process.cwd(), 'circa-reconciliacao.json');
  const report = await executar();
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`Reconciliação sanitizada: matriz=${report.matrizTratamento.resumo.total}; histórico=${report.bancoHistorico.resumo.total}; postgres=${report.postgres.status}`);
}

if (require.main === module) main().catch(error => { console.error(`Reconciliação interrompida: ${error.message === 'GOOGLE_SHEETS_CONFIG_AUSENTE' ? 'configuração Google Sheets ausente.' : 'falha de leitura.'}`); process.exitCode = 1; });

module.exports = { token, fieldMask, normalizarEmpresa, tratarMatriz, tratarHistorico, tratarModelos, tratarCasosAprendidos, comparar, origemInterface, lerPostgresReadonly };
