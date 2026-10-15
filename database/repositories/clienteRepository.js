'use strict';

const prisma = require('../connection');

function normalizarDoc(v) {
  return String(v || '').replace(/\D/g, '') || null;
}

const clienteRepository = {
  async findByCnpj(cnpj) {
    const doc = normalizarDoc(cnpj);
    if (!doc) return null;
    return prisma.cliente.findFirst({ where: { cnpj: doc } });
  },

  async findByNome(nome, empresaId) {
    const where = { nome: { contains: nome, mode: 'insensitive' } };
    if (empresaId) where.empresaId = Number(empresaId);
    return prisma.cliente.findFirst({ where });
  },

  async findById(id) {
    return prisma.cliente.findUnique({
      where: { id: Number(id) },
      include: { manifestacoes: { take: 10, orderBy: { criadaEm: 'desc' } } },
    });
  },

  async findAll({ empresaId, ativo = true } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (ativo !== undefined) where.ativo = ativo;
    return prisma.cliente.findMany({ where, orderBy: { nome: 'asc' } });
  },

  async upsert({ nome, cnpj, email, telefone, empresaId }) {
    const doc = normalizarDoc(cnpj);
    const where = doc ? { cnpj: doc } : null;

    if (where) {
      return prisma.cliente.upsert({
        where,
        update: { nome, email, telefone },
        create: { nome, cnpj: doc, email, telefone, empresaId: Number(empresaId) },
      });
    }

    const existente = await this.findByNome(nome, empresaId);
    if (existente) return existente;
    return prisma.cliente.create({ data: { nome, cnpj: doc, email, telefone, empresaId: Number(empresaId) } });
  },

  async create(data) {
    return prisma.cliente.create({ data: { ...data, cnpj: normalizarDoc(data.cnpj) } });
  },

  async historico(clienteId, limite = 10) {
    return prisma.manifestacao.findMany({
      where: { clienteId: Number(clienteId) },
      orderBy: { criadaEm: 'desc' },
      take: limite,
      include: { setor: true },
    });
  },
};

module.exports = clienteRepository;
