'use strict';
// ================================================================
// DATABASE CONNECTION — PrismaClient singleton (lazy)
// Instanciado apenas quando DATABASE_URL está presente, evitando
// erros de validação Prisma em testes sem banco de dados.
// ================================================================

const { PrismaClient } = require('@prisma/client');

function createPrismaClient() {
  const rawUrl = process.env.DATABASE_URL;
  let datasourceUrl = rawUrl;
  // Neon pooled connections precisam de limites explícitos em funções
  // serverless. Os valores podem ser ajustados por ambiente sem alterar a
  // URL armazenada nem a conexão direta usada pelas migrações.
  if (rawUrl) {
    try {
      const url = new URL(rawUrl);
      if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', process.env.PRISMA_CONNECTION_LIMIT || '3');
      if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', process.env.PRISMA_POOL_TIMEOUT_SECONDS || '10');
      if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', process.env.PRISMA_CONNECT_TIMEOUT_SECONDS || '5');
      datasourceUrl = url.toString();
    } catch (_) { /* Prisma emitirá a mensagem padrão para URL inválida. */ }
  }
  return new PrismaClient({
    ...(datasourceUrl ? { datasources: { db: { url: datasourceUrl } } } : {}),
    log: process.env.NODE_ENV === 'development'
      ? ['query', 'error', 'warn']
      : ['error'],
    errorFormat: 'minimal',
  });
}

const globalForPrisma = globalThis;

// Lazy: não instanciar se DATABASE_URL ausente (modo Sheets-only / testes)
let prisma = null;

if (process.env.DATABASE_URL) {
  prisma = globalForPrisma.__prisma ?? createPrismaClient();
  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.__prisma = prisma;
  }
}

module.exports = prisma;
