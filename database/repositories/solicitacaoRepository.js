'use strict';

const prisma = require('../connection');

const solicitacaoRepository = {
  async findByEmail(email) {
    return prisma.solicitacaoAcesso.findMany({
      where: { email: email.toLowerCase() },
      orderBy: { criadaEm: 'desc' },
    });
  },

  async findPendenteByEmail(email) {
    return prisma.solicitacaoAcesso.findFirst({
      where: { email: email.toLowerCase(), status: 'PENDENTE' },
    });
  },

  async findById(idSolicitacao) {
    return prisma.solicitacaoAcesso.findUnique({
      where: { idSolicitacao },
    });
  },

  async findAll({ status, empresa } = {}) {
    const where = {};
    if (status) where.status = status.toUpperCase();
    if (empresa) where.empresa = empresa;
    return prisma.solicitacaoAcesso.findMany({
      where,
      orderBy: { criadaEm: 'desc' },
    });
  },

  async create(data) {
    return prisma.solicitacaoAcesso.create({ data });
  },

  async update(idSolicitacao, data) {
    return prisma.solicitacaoAcesso.update({
      where: { idSolicitacao },
      data,
    });
  },
};

module.exports = solicitacaoRepository;
