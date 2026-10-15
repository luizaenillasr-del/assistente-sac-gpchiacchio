'use strict';

const prisma = require('../connection');

const conhecimentoRepository = {
  // Políticas por empresa/setor
  async findPoliticas({ empresaId, setorId, ativo = true } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (ativo) where.status = 'ATIVA';
    return prisma.politica.findMany({ where, orderBy: { titulo: 'asc' } });
  },

  // Procedimentos por empresa/setor/tipo
  async findProcedimentos({ empresaId, setorId, tipo } = {}) {
    const where = { status: 'ATIVO' };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipo = tipo;
    return prisma.procedimento.findMany({ where, orderBy: { titulo: 'asc' } });
  },

  // Regras por empresa/setor
  async findRegras({ empresaId, setorId } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    return prisma.regra.findMany({ where, orderBy: { titulo: 'asc' } });
  },

  // Base de conhecimento (FAQ)
  async findBaseConhecimento({ setorId, tipo, busca } = {}) {
    const where = { ativo: true };
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipo = tipo;
    if (busca) where.resposta = { contains: busca, mode: 'insensitive' };
    return prisma.baseConhecimento.findMany({ where, orderBy: { criadoEm: 'desc' }, take: 20 });
  },

  // SLA configurado para empresa/setor/tipo
  async findSla({ empresaId, setorId, tipo, categoria } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (tipo) where.tipoManifestacao = tipo;
    if (categoria) where.categoria = categoria;
    return prisma.slaConfig.findFirst({
      where,
      orderBy: { criadaEm: 'desc' },
    });
  },

  // Matriz de tratamento por empresa/tipo/categoria
  async findMatriz({ empresaId, tipo, categoria, subcategoria, setor } = {}) {
    const where = { ativo: true };
    if (empresaId) where.empresaId = Number(empresaId);
    if (tipo) where.tipoManifestacao = tipo;
    if (categoria) where.categoria = categoria;
    if (subcategoria) where.subcategoria = subcategoria;
    if (setor) where.setorResponsavel = setor;
    return prisma.matrizTratamento.findMany({ where, orderBy: { prioridade: 'asc' } });
  },

  // Upsert política
  async upsertPolitica({ empresaId, setorId, titulo, texto, responsavel }) {
    const existente = await prisma.politica.findFirst({
      where: { empresaId: Number(empresaId), titulo },
    });
    if (existente) {
      return prisma.politica.update({ where: { id: existente.id }, data: { texto, responsavel } });
    }
    return prisma.politica.create({
      data: {
        empresaId: Number(empresaId),
        setorId: setorId ? Number(setorId) : null,
        titulo, texto: texto || '', responsavel,
      },
    });
  },

  // Upsert procedimento
  async upsertProcedimento({ empresaId, setorId, titulo, texto, tipo }) {
    const existente = await prisma.procedimento.findFirst({
      where: { empresaId: Number(empresaId), titulo },
    });
    if (existente) {
      return prisma.procedimento.update({ where: { id: existente.id }, data: { texto, tipo } });
    }
    return prisma.procedimento.create({
      data: {
        empresaId: Number(empresaId),
        setorId: setorId ? Number(setorId) : null,
        titulo, texto: texto || '', tipo,
      },
    });
  },

  // Upsert regra
  async upsertRegra({ empresaId, setorId, titulo, descricao, condicao, acao }) {
    const existente = await prisma.regra.findFirst({
      where: { empresaId: Number(empresaId), titulo },
    });
    if (existente) {
      return prisma.regra.update({ where: { id: existente.id }, data: { descricao, condicao, acao } });
    }
    return prisma.regra.create({
      data: {
        empresaId: Number(empresaId),
        setorId: setorId ? Number(setorId) : null,
        titulo: titulo || 'Sem título', descricao: descricao || '', condicao, acao,
      },
    }).catch(() => null);
  },

  // Resolve nomes de empresa/setor para IDs (usado pelas escritas que vêm das telas)
  async _resolver(empresaNome, setorNome) {
    let empresaId = null, setorId = null;
    if (empresaNome && String(empresaNome).toUpperCase() !== 'TODAS') {
      const v = String(empresaNome).toUpperCase().trim();
      const e = await prisma.empresa.findFirst({ where: { OR: [{ codigo: v }, { nome: { contains: empresaNome, mode: 'insensitive' } }] } });
      empresaId = e ? e.id : null;
    }
    if (!empresaId) { const e = await prisma.empresa.findFirst(); empresaId = e ? e.id : null; }
    if (setorNome && empresaId) {
      const s = await prisma.setor.findFirst({ where: { empresaId, nome: { equals: setorNome, mode: 'insensitive' } } });
      setorId = s ? s.id : null;
    }
    return { empresaId, setorId };
  },

  async criarPolitica({ empresa, setor, titulo, texto, responsavel }) {
    if (!titulo) return null;
    const { empresaId, setorId } = await this._resolver(empresa, setor);
    if (!empresaId) return null;
    return this.upsertPolitica({ empresaId, setorId, titulo, texto, responsavel });
  },

  async criarProcedimento({ empresa, setor, titulo, texto, tipo }) {
    if (!titulo) return null;
    const { empresaId, setorId } = await this._resolver(empresa, setor);
    if (!empresaId) return null;
    return this.upsertProcedimento({ empresaId, setorId, titulo, texto, tipo });
  },

  // Matriz de tratamento — upsert por chave de negócio
  async upsertMatriz({ empresa, tipo, categoria, subcategoria, setor, dados = {} }) {
    const { empresaId } = await this._resolver(empresa, null);
    if (!empresaId) return null;
    const where = {
      empresaId,
      tipoManifestacao: tipo || null,
      categoria: categoria || null,
      subcategoria: subcategoria || null,
      setorResponsavel: setor || null,
    };
    const existente = await prisma.matrizTratamento.findFirst({ where });
    if (existente) return prisma.matrizTratamento.update({ where: { id: existente.id }, data: dados });
    return prisma.matrizTratamento.create({ data: { empresaId, tipoManifestacao: tipo || null, categoria: categoria || null, subcategoria: subcategoria || null, setorResponsavel: setor || null, ...dados } });
  },
};

module.exports = conhecimentoRepository;
