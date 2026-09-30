'use strict';

const prisma = require('../connection');

const manifestacaoRepository = {
  async findById(id) {
    return prisma.manifestacao.findUnique({
      where: { id: Number(id) },
      include: {
        empresa: true,
        setor: true,
        cliente: true,
        historico: { orderBy: { criadoEm: 'asc' } },
        tratativas: { include: { acoes: true } },
        devolutivas: true,
      },
    });
  },

  async findByProtocolo(protocolo) {
    return prisma.manifestacao.findFirst({
      where: { protocolo },
      include: { empresa: true, setor: true, cliente: true },
    });
  },

  async findByIdOriginal(idOriginal) {
    return prisma.manifestacao.findFirst({ where: { idOriginal } });
  },

  async findAll({ empresaId, setorId, status, clienteId, skip = 0, take = 100 } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (status) where.status = status;
    if (clienteId) where.clienteId = Number(clienteId);
    return prisma.manifestacao.findMany({
      where,
      include: { empresa: true, setor: true, cliente: true },
      orderBy: { criadaEm: 'desc' },
      skip,
      take,
    });
  },

  async count(where = {}) {
    return prisma.manifestacao.count({ where });
  },

  async create(data) {
    return prisma.manifestacao.create({
      data,
      include: { empresa: true, setor: true, cliente: true },
    });
  },

  async update(id, data) {
    return prisma.manifestacao.update({
      where: { id: Number(id) },
      data,
      include: { empresa: true, setor: true, cliente: true },
    });
  },

  async registrarHistorico(manifestacaoId, { campo, valorAnterior, valorNovo, usuario, observacao }) {
    return prisma.manifestacaoHistorico.create({
      data: {
        manifestacaoId: Number(manifestacaoId),
        campo,
        valorAnterior: valorAnterior ? String(valorAnterior) : null,
        valorNovo: valorNovo ? String(valorNovo) : null,
        alteradoPor: usuario || 'sistema',
        observacao,
      },
    });
  },

  // Busca para similaridade — retorna manifestações com descrição e tratativa
  async buscarParaSimilaridade(limite = 1000) {
    return prisma.manifestacao.findMany({
      where: { descricao: { not: null } },
      select: {
        id: true,
        protocolo: true,
        idOriginal: true,
        descricao: true,
        tipo: true,
        categoria: true,
        subcategoria: true,
        status: true,
        criadaEm: true,
        empresa: { select: { nome: true, codigo: true } },
        cliente: { select: { nome: true } },
        setor: { select: { nome: true } },
        tratativas: { select: { descricaoTratativa: true, resultado: true }, take: 1 },
      },
      orderBy: { criadaEm: 'desc' },
      take: limite,
    });
  },

  // Busca para reincidência — manifestações por cliente/produto
  async buscarPorCliente(clienteId, excludeId) {
    const where = { clienteId: Number(clienteId) };
    if (excludeId) where.id = { not: Number(excludeId) };
    return prisma.manifestacao.findMany({
      where,
      orderBy: { criadaEm: 'desc' },
      take: 50,
      select: {
        id: true, protocolo: true, idOriginal: true, descricao: true,
        tipo: true, produto: true, criadaEm: true, status: true,
        tratativas: { select: { descricaoTratativa: true }, take: 1 },
      },
    });
  },

  async upsertFromSheets(sheetsData) {
    const { ID_MANIFESTACAO: idOriginal, EMPRESA_RECLAMANTE, EMPRESA_RECLAMADA, DESCRICAO, STATUS, TIPO, PRODUTO, SETOR_SUGERIDO, DATA_ABERTURA } = sheetsData;
    if (!idOriginal) return null;

    const existente = await this.findByIdOriginal(idOriginal);
    if (existente) return { acao: 'ignorado', id: existente.id };

    // Resolver empresa
    const empresa = await prisma.empresa.findFirst();
    if (!empresa) return null;

    const criada = await prisma.manifestacao.create({
      data: {
        protocolo: idOriginal,
        idOriginal,
        empresaId: empresa.id,
        descricao: DESCRICAO || '',
        empresaReclamante: EMPRESA_RECLAMANTE || '',
        tipo: TIPO || 'Reclamação',
        produto: PRODUTO || null,
        status: STATUS || 'EM ANÁLISE',
        criadaEm: DATA_ABERTURA ? new Date(DATA_ABERTURA) : new Date(),
      },
    });
    return { acao: 'inserido', id: criada.id };
  },
};

module.exports = manifestacaoRepository;
