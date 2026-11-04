'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
  validarBaseCirca,
  validarMatriz,
  validarHistorico,
  normalizarEmpresa,
} = require('../database/circaDataContract');

const matriz = [
  { ID_TRATAMENTO: 'TRAT-001', EMPRESA: 'Plaschio', TIPO_MANIFESTACAO: 'Reclamação', CATEGORIA: 'Entrega', SUBCATEGORIA: 'Atraso', SETOR_RESPONSAVEL: 'Logística', TRATATIVA_OBRIGATORIA: 'Verificar pedido', ATIVO: 'SIM' },
  { ID_TRATAMENTO: '', EMPRESA: 'Tubahia', CATEGORIA: '', SETOR_RESPONSAVEL: '', TRATATIVA_OBRIGATORIA: '', ATIVO: 'SIM' },
  { ID_TRATAMENTO: 'TRAT-002', EMPRESA: 'Plaschio', TIPO_MANIFESTACAO: 'Reclamação', CATEGORIA: 'Entrega', SUBCATEGORIA: 'Atraso', SETOR_RESPONSAVEL: 'Logística', TRATATIVA_OBRIGATORIA: 'Antiga', ATIVO: 'NÃO' },
];

const manifestacoes = [
  { ID_MANIFESTACAO: 'MAN-1', EMPRESA_RECLAMADA: 'PLASCHIO', DESCRICAO_ORIGINAL: 'Relato original', STATUS: 'AGUARDANDO_TRIAGEM_SAC', CAUSA_RAIZ_CONFIRMADA: '' },
  { ID_MANIFESTACAO: 'MAN-1', EMPRESA_RECLAMADA: 'PLASCHIO', DESCRICAO_ORIGINAL: '', STATUS: 'ABERTA' },
  { ID_MANIFESTACAO: 'MAN-2', EMPRESA_RECLAMADA: 'PLASCHIO', DESCRICAO_ORIGINAL: 'Hipótese somente', STATUS: 'ABERTA', CAUSA_RAIZ_CONFIRMADA: 'Causa sem evidência' },
];

const historico = [
  { ID_HISTORICO: 'HIST-1', DRV_EMPRESA_NORMALIZADA: 'PLASCHIO', ORIG_DESCRICAO_RECLAMACAO: 'Atraso', STATUS_HISTORICO: 'CONCLUIDO' },
  { ID_HISTORICO: 'HIST-2', DRV_EMPRESA_NORMALIZADA: '', ORIG_DESCRICAO_RECLAMACAO: 'Sem empresa', STATUS_HISTORICO: 'CONCLUIDO' },
];

const modelos = [
  { ID_MODELO: 'MOD-1', STATUS: 'APROVADA', TEXTO_PADRAO: 'Protocolo {{protocolo}}' },
  { ID_MODELO: 'MOD-2', STATUS: 'RASCUNHO', TEXTO_PADRAO: 'não usar' },
];

assert.equal(normalizarEmpresa('Cesbap'), 'TUBAHIA');
const matrizReport = validarMatriz(matriz);
assert.equal(matrizReport.elegiveis, 1, 'linha incompleta ou inativa não pode ser elegível');
assert.deepEqual(matrizReport.duplicados, [], 'IDs válidos únicos devem permanecer únicos');
assert.ok(matrizReport.itens[1].motivos.includes('ID_AUSENTE'));
assert.ok(matrizReport.itens[2].motivos.includes('INATIVA'));

const historicoReport = validarHistorico(historico);
assert.equal(historicoReport.similares, 1, 'histórico sem empresa não alimenta similaridade');
assert.equal(historicoReport.reincidencias, 1, 'reincidência exige isolamento empresarial');

const report = validarBaseCirca({ manifestacoes, matrizTratamento: matriz, bancoHistorico: historico, modelosDevolutiva: modelos });
assert.equal(report.manifestacoes.duplicados[0].id, 'MAN-1');
assert.equal(report.manifestacoes.elegiveis, 1, 'causa sem evidência não pode ser confirmada');
assert.equal(report.modelosDevolutiva.aprovados, 1, 'disponibilidade não aprova modelo em revisão');

const plannedMigration = fs.readFileSync(path.join(__dirname, '..', 'database/migrations/planned/20261104_auxiliary_tables.sql'), 'utf8');
const plannedSql = plannedMigration.replace(/^\s*--.*$/gm, '');
assert.match(plannedMigration, /CREATE TABLE IF NOT EXISTS/);
assert.doesNotMatch(plannedSql, /\b(DROP|DELETE|TRUNCATE)\b/i, 'migração planejada não pode ser destrutiva');
assert.match(plannedMigration, /BEGIN;/);
assert.match(plannedMigration, /COMMIT;/);
assert.ok(!fs.existsSync(path.join(__dirname, '..', 'prisma/migrations/20260930000001_init/migration_parte2.sql')), 'sidecar duplicado não deve permanecer no diretório Prisma');

console.log('CIRCA base integrity: contratos, duplicidades, isolamento e estados aprovados validados.');
