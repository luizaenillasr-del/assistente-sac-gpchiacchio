'use strict';

const prisma = require('../connection');

const rncRepository = {
  async findById(id) {
    return prisma.rnc.findUnique({
      where: { id: Number(id) },
      include: {
        empresa: true,
        setor: true,
        manifestacao: true,
        investigacoes: true,
        acoes: true,
        eficacias: true,
      },
    });
  },

  async findByNumero(numero) {
    return prisma.rnc.findFirst({ where: { numero } });
  },

  async findByIdOriginal(idOriginal) {
    return prisma.rnc.findFirst({ where: { idOriginal } });
  },

  async findAll({ empresaId, setorId, status, skip = 0, take = 100 } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (status) where.status = status;
    return prisma.rnc.findMany({
      where,
      include: { empresa: true, setor: true },
      orderBy: { abertaEm: 'desc' },
      skip,
      take,
    });
  },

  async create(data) {
    return prisma.rnc.create({
      data,
      include: { empresa: true, setor: true },
    });
  },

  async update(id, data) {
    return prisma.rnc.update({ where: { id: Number(id) }, data });
  },

  async adicionarAcao(rncId, { descricao, responsavel, prazo, tipo }) {
    return prisma.rncAcao.create({
      data: { rncId: Number(rncId), descricao, responsavel, prazo, tipo: tipo || 'CORRETIVA' },
    });
  },

  async registrarEficacia(rncId, { resultado, avaliador, observacao }) {
    return prisma.rncEficacia.create({
      data: { rncId: Number(rncId), resultado, avaliador, observacao, avaliadaEm: new Date() },
    });
  },

  async metricas(empresaId) {
    const where = empresaId ? { empresaId: Number(empresaId) } : {};
    const [total, pendentes, aprovadas, encerradas] = await Promise.all([
      prisma.rnc.count({ where }),
      prisma.rnc.count({ where: { ...where, status: { in: ['AGUARDANDO_APROVACAO', 'EM_INVESTIGACAO'] } } }),
      prisma.rnc.count({ where: { ...where, status: 'APROVADA' } }),
      prisma.rnc.count({ where: { ...where, status: 'ENCERRADA' } }),
    ]);
    return { total, pendentes, aprovadas, encerradas };
  },
};

module.exports = rncRepository;
