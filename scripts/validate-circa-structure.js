'use strict';

// Auditoria estática e somente leitura. Não requer DATABASE_URL, GOOGLE_CREDENTIALS
// nem SPREADSHEET_ID. Serve para detectar drift entre Prisma e os artefatos SQL.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const schema = fs.readFileSync(path.join(root, 'prisma/schema.prisma'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'prisma/migrations/20260930000001_init/migration.sql'), 'utf8');
const sidecarPath = path.join(root, 'prisma/migrations/20260930000001_init/migration_parte2.sql');
const sidecar = fs.existsSync(sidecarPath) ? fs.readFileSync(sidecarPath, 'utf8') : '';

const models = [...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map(m => m[1]);
const mappedTables = [...schema.matchAll(/@@map\("([^"]+)"\)/g)].map(m => m[1]);
const migrationTables = [...migration.matchAll(/CREATE TABLE\s+"([^"]+)"/g)].map(m => m[1]);
const sidecarTables = [...sidecar.matchAll(/CREATE TABLE\s+"([^"]+)"/g)].map(m => m[1]);
const duplicatesBetweenSql = [...new Set(sidecarTables.filter(table => migrationTables.includes(table)))];
const modelTablesWithoutMigration = mappedTables.filter(table => !migrationTables.includes(table));

const report = {
  modo: 'somente_leitura',
  prisma: {
    modelos: models.length,
    tabelasMapeadas: mappedTables.length,
    tabelasSemModelo: migrationTables.filter(t => !mappedTables.includes(t)),
    tabelasSemMigracaoInicial: modelTablesWithoutMigration,
  },
  migracoes: {
    init: { tabelas: migrationTables.length },
    artefatoNaoAplicado: { caminho: 'prisma/migrations/20260930000001_init/migration_parte2.sql', tabelas: sidecarTables.length, duplicadasDoInit: duplicatesBetweenSql },
  },
  achados: [],
};

if (duplicatesBetweenSql.length) report.achados.push({ tipo: 'ARTEFATO_SQL_DUPLICADO', severidade: 'alta', tabelas: duplicatesBetweenSql, acao: 'manter somente migration.sql no diretório Prisma; não executar o sidecar' });
if (report.prisma.tabelasSemModelo.length) report.achados.push({ tipo: 'TABELA_SEM_MODELO_PRISMA', severidade: 'informativa', tabelas: report.prisma.tabelasSemModelo });
if (modelTablesWithoutMigration.length) report.achados.push({ tipo: 'MODELO_SEM_MIGRACAO_INICIAL', severidade: 'alta', tabelas: modelTablesWithoutMigration, acao: 'confirmar a origem dessas tabelas antes de executar qualquer migração; não usar db push' });
if (schema.includes('DATABASE_URL_UNPOOLED')) report.achados.push({ tipo: 'CONEXAO_DIRETA_SEPARADA', severidade: 'informativa', acao: 'usar DATABASE_URL para runtime e DATABASE_URL_UNPOOLED apenas em migrações autorizadas' });

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.achados.some(a => a.severidade === 'critica') ? 1 : 0;
