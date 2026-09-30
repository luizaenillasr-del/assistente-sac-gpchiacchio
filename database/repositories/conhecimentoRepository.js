'use strict';

const prisma = require('../connection');

const conhecimentoRepository = {
  // Políticas por empresa/setor
  async findPoliticas({ empresaId, setorId, ativo = true } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (ativo) where.ativo = true;
    return prisma.politica.findMany({ where, orderBy: { nome: 'asc' } });
  },

  // Procedimentos por empresa/setor/tipo
  async findProcedimentos({ empresaId, setorId, tipo } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipo = tipo;
    return prisma.procedimento.findMany({ where, orderBy: { nome: 'asc' } });
  },

  // Regras por empresa/setor
  async findRegras({ empresaId, setorId } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    return prisma.regra.findMany({ where, orderBy: { prioridade: 'asc' } });
  },

  // Base de conhecimento (FAQ)
  async findBaseConhecimento({ setorId, tipo, busca } = {}) {
    const where = { ativo: true };
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipo = tipo;
    if (busca) where.conteudo = { contains: busca, mode: 'insensitive' };
    return prisma.baseConhecimento.findMany({ where, orderBy: { criadoEm: 'desc' }, take: 20 });
  },

  // SLA configurado para empresa/setor/tipo
  async findSla({ empresaId, setorId, tipo, categoria } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipo = tipo;
    if (categoria) where.categoria = categoria;
    return prisma.slaConfig.findFirst({
      where,
      orderBy: { criadoEm: 'desc' },
    });
  },

  // Matriz de tratamento por empresa/tipo/categoria
  async findMatriz({ empresaId, tipo, categoria, subcategoria, setor } = {}) {
    const where = { ativa: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (tipo) where.tipoManifestacao = tipo;
    if (categoria) where.categoria = categoria;
    if (subcategoria) where.subcategoria = subcategoria;
    if (setor) where.setor = setor;
    return prisma.matrizTratamento.findMany({ where, orderBy: { prioridade: 'asc' } });
  },

  // Upsert política
  async upsertPolitica({ empresaId, setorId, nome, descricao, regra, vigencia }) {
    return prisma.politica.upsert({
      where: { empresaId_setorId_nome: { empresaId: Number(empresaId), setorId: Number(setorId), nome } },
      update: { descricao, regra, vigencia },
      create: { empresaId: Number(empresaId), setorId: Number(setorId), nome, descricao, regra, vigencia },
    });
  },

  // Upsert procedimento
  async upsertProcedimento({ empresaId, setorId, nome, objetivo, passos, tipo }) {
    return prisma.procedimento.create({
      data: { empresaId: Number(empresaId), setorId: Number(setorId), nome, objetivo, passos, tipo },
    }).catch(async () => {
      const existente = await prisma.procedimento.findFirst({
        where: { empresaId: Number(empresaId), nome },
      });
      if (existente) return prisma.procedimento.update({ where: { id: existente.id }, data: { objetivo, passos } });
      return null;
    });
  },

  // Upsert regra
  async upsertRegra({ empresaId, setorId, nome, condicao, acao, palavrasGatilho, prioridade }) {
    return prisma.regra.create({
      data: {
        empresaId: Number(empresaId),
        setorId: Number(setorId),
        nome, condicao, acao,
        palavrasGatilho: palavrasGatilho || [],
        prioridade: prioridade || 5,
      },
    }).catch(() => null);
  },
};

module.exports = conhecimentoRepository;
