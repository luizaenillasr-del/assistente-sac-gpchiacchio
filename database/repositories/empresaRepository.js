'use strict';

const prisma = require('../connection');

const _codigoDe = (nome) => String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'SETOR';

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

  // Setores no formato esperado pela tela (compatível com a aba CONFIG_SETORES do Sheets)
  async listarSetores() {
    const setores = await prisma.setor.findMany({
      where: { ativo: true },
      include: { empresa: true, responsaveis: { where: { ativo: true } }, slaConfigs: true },
      orderBy: [{ empresaId: 'asc' }, { nome: 'asc' }],
    });
    return setores.map(s => ({
      ID_SETOR: s.codigo || String(s.id),
      SETOR: s.nome,
      DESCRICAO: s.descricao || '',
      RESPONSABILIDADES: s.responsabilidades || '',
      RESPONSAVEL: s.responsaveis?.[0]?.nome || '',
      EMAIL_RESPONSAVEL: s.responsaveis?.[0]?.email || '',
      SLA_HORAS: s.slaConfigs?.[0]?.prazoHoras != null ? String(s.slaConfigs[0].prazoHoras) : '',
      EMPRESA: s.empresa?.codigo || s.empresa?.nome || '',
      ATIVO: 'SIM',
      _pgId: s.id,
    }));
  },

  async _resolverEmpresaId(valor) {
    if (!valor) { const e = await prisma.empresa.findFirst(); return e ? e.id : null; }
    const v = String(valor).toUpperCase().trim();
    let e = await prisma.empresa.findFirst({ where: { OR: [{ codigo: v }, { nome: { contains: valor, mode: 'insensitive' } }] } });
    if (!e) e = await prisma.empresa.findFirst();
    return e ? e.id : null;
  },

  async criarSetor({ nome, empresa, descricao }) {
    const empresaId = await this._resolverEmpresaId(empresa);
    if (!empresaId || !nome) return null;
    const codigo = _codigoDe(nome);
    return prisma.setor.upsert({
      where: { empresaId_codigo: { empresaId, codigo } },
      update: { nome, descricao: descricao || null, ativo: true },
      create: { empresaId, codigo, nome, descricao: descricao || null },
    });
  },

  async atualizarSetorPorCodigo(codigo, { nome, descricao, ativo } = {}) {
    const s = await prisma.setor.findFirst({ where: { codigo: String(codigo) } });
    if (!s) return null;
    const data = {};
    if (nome !== undefined) data.nome = nome;
    if (descricao !== undefined) data.descricao = descricao;
    if (ativo !== undefined) data.ativo = ativo;
    if (!Object.keys(data).length) return s;
    return prisma.setor.update({ where: { id: s.id }, data });
  },

  async excluirSetorPorCodigo(codigo) {
    const s = await prisma.setor.findFirst({ where: { codigo: String(codigo) } });
    if (!s) return null;
    return prisma.setor.update({ where: { id: s.id }, data: { ativo: false } });
  },
};

module.exports = empresaRepository;
