'use strict';
// ================================================================
// DATABASE CONNECTION — PrismaClient singleton
// Funciona corretamente em Vercel serverless (evita connection exhaustion)
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

// Singleton global para reutilizar conexão entre invocações serverless
const globalForPrisma = globalThis;

const prisma = globalForPrisma.__prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prisma = prisma;
}

module.exports = prisma;
