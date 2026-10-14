'use strict';

const prisma = require('../connection');

const usuarioRepository = {
  async findByEmail(email) {
    return prisma.usuario.findUnique({
      where: { email: email.toLowerCase() },
      include: { perfil: true, empresa: true },
    });
  },

  async findById(id) {
    return prisma.usuario.findUnique({
      where: { id: Number(id) },
      include: { perfil: true, empresa: true },
    });
  },

  async findByLogin(login) {
    const norm = login.toLowerCase().trim();
    return prisma.usuario.findFirst({
      where: {
        OR: [{ email: norm }, { nome: { contains: norm, mode: 'insensitive' } }],
        ativo: true,
      },
      include: { perfil: true, empresa: true },
    });
  },

  async findAll({ empresaId, perfilId, ativo } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (perfilId) where.perfilId = Number(perfilId);
    if (ativo !== undefined) where.ativo = ativo;
    return prisma.usuario.findMany({
      where,
      include: { perfil: true, empresa: true },
      orderBy: { nome: 'asc' },
    });
  },

  async create(data) {
    return prisma.usuario.create({
      data: { ...data, email: data.email.toLowerCase() },
      include: { perfil: true, empresa: true },
    });
  },

  async update(id, data) {
    return prisma.usuario.update({
      where: { id: Number(id) },
      data,
      include: { perfil: true, empresa: true },
    });
  },

  async inativar(id) {
    return prisma.usuario.update({ where: { id: Number(id) }, data: { ativo: false } });
  },

  async registrarAcesso(id) {
    return prisma.usuario.update({
      where: { id: Number(id) },
      data: { ultimoAcesso: new Date() },
    }).catch(() => null);
  },

  // Importar da planilha (idempotente)
  async upsertFromSheets(sheetData) {
    if (!sheetData.email) return null;
    const empresa = await prisma.empresa.findFirst();
    const perfil = await prisma.perfil.findFirst({ where: { codigo: 'USUARIO_DE_SETOR' } });
    if (!empresa || !perfil) return null;

    return prisma.usuario.upsert({
      where: { email: sheetData.email.toLowerCase() },
      update: {
        nome: sheetData.nome || sheetData.NOME || '',
        ativo: (sheetData.STATUS || sheetData.status || 'ATIVO').toUpperCase() !== 'INATIVO',
      },
      create: {
        empresaId: empresa.id,
        perfilId: perfil.id,
        nome: sheetData.nome || sheetData.NOME || '',
        email: sheetData.email.toLowerCase(),
        senhaHash: sheetData.SENHA || sheetData.senhaHash || '',
        ativo: true,
        idOriginal: sheetData.ID_USUARIO || null,
      },
    });
  },
};

module.exports = usuarioRepository;
