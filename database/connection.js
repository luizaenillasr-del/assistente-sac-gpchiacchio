'use strict';
// ================================================================
// DATABASE CONNECTION — PrismaClient singleton (lazy)
// Instanciado apenas quando DATABASE_URL está presente, evitando
// erros de validação Prisma em testes sem banco de dados.
// ================================================================

const { PrismaClient } = require('@prisma/client');

function createPrismaClient() {
  return new PrismaClient({
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
