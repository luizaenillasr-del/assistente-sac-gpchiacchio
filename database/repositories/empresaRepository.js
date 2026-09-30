'use strict';

const prisma = require('../connection');

const empresaRepository = {
  async findAll() {
    return prisma.empresa.findMany({ where: { ativa: true }, orderBy: { nome: 'asc' } });
  },

  async findById(id) {
    return prisma.empresa.findUnique({ where: { id: Number(id) }, include: { setores: true } });
  },

  async findByCodigo(codigo) {
    return prisma.empresa.findUnique({ where: { codigo: codigo.toUpperCase() } });
  },

  async upsert(codigo, nome, cnpj = null) {
    return prisma.empresa.upsert({
      where: { codigo: codigo.toUpperCase() },
      update: { nome },
      create: { codigo: codigo.toUpperCase(), nome, cnpj },
    });
  },

  async create(data) {
    return prisma.empresa.create({ data: { ...data, codigo: data.codigo.toUpperCase() } });
  },

  async update(id, data) {
    return prisma.empresa.update({ where: { id: Number(id) }, data });
  },
};

module.exports = empresaRepository;
