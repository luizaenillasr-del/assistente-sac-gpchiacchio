'use strict';

const prisma = require('../connection');

// No schema, as relações da Manifestação são empresaRel/setorRel/clienteRel.
// A API consome pg.empresa/pg.setor/pg.cliente — então incluímos pelas relações
// reais e expomos aliases sem o sufixo "Rel".
const INCLUDE_BASICO = { empresaRel: true, setorRel: true, clienteRel: true, responsavelRel: true };
const INCLUDE_FICHA = {
  ...INCLUDE_BASICO,
  historico: { orderBy: { criadoEm: 'asc' } },
  tratativas: { include: { acoes: true }, orderBy: { criadaEm: 'asc' } },
  devolutivas: { orderBy: { criadaEm: 'asc' } },
};
function _alias(m) {
  if (!m) return m;
  if (m.empresaRel !== undefined) m.empresa = m.empresaRel;
  if (m.setorRel !== undefined) m.setor = m.setorRel;
  if (m.clienteRel !== undefined) m.cliente = m.clienteRel;
  if (m.responsavelRel !== undefined) m.responsavel = m.responsavelRel;
  return m;
}

const manifestacaoRepository = {
  async findById(id) {
    return _alias(await prisma.manifestacao.findUnique({ where: { id: Number(id) }, include: INCLUDE_FICHA }));
  },

  async findByProtocolo(protocolo) {
    return _alias(await prisma.manifestacao.findFirst({ where: { protocolo }, include: INCLUDE_FICHA }));
  },

  async findByIdOriginal(idOriginal) {
    return _alias(await prisma.manifestacao.findFirst({ where: { idOriginal }, include: INCLUDE_FICHA }));
  },

  async findAll({ empresaId, setorId, status, clienteId, skip = 0, take = 100 } = {}) {
    const where = {};
    if (empresaId) where.empresaId = Number(empresaId);
    if (setorId) where.setorId = Number(setorId);
    if (status) where.status = status;
    if (clienteId) where.clienteId = Number(clienteId);
    const rows = await prisma.manifestacao.findMany({
      where,
      include: INCLUDE_BASICO,
      orderBy: { criadaEm: 'desc' },
      skip,
      take,
    });
    return rows.map(_alias);
  },

  async count(where = {}) {
    return prisma.manifestacao.count({ where });
  },

  // Agregação do dashboard direto no Postgres (COUNT/GROUP BY) — rápido e escalável,
  // sem baixar todas as linhas para somar no cliente.
  async aggregateDashboard({ empresaId } = {}) {
    const where = {};
    if (empresaId && Number(empresaId) > 0) where.empresaId = Number(empresaId);
    const [total, porStatus, porTipo, porEmpresa, encerradas] = await Promise.all([
      prisma.manifestacao.count({ where }),
      prisma.manifestacao.groupBy({ by: ['status'], where, _count: { _all: true } }),
      prisma.manifestacao.groupBy({ by: ['tipo'], where, _count: { _all: true } }),
      prisma.manifestacao.groupBy({ by: ['empresaNome'], where, _count: { _all: true } }),
      prisma.manifestacao.count({ where: { ...where, status: { in: ['ENCERRADA', 'FINALIZADA', 'CONCLUIDA'] } } }),
    ]);
    const toMap = (rows, key) => Object.fromEntries(rows.map(r => [r[key] || '(sem)', r._count._all]));
    return {
      total,
      encerradas,
      emAberto: total - encerradas,
      porStatus: toMap(porStatus, 'status'),
      porTipo: toMap(porTipo, 'tipo'),
      porEmpresa: toMap(porEmpresa, 'empresaNome'),
    };
  },

  async create(data) {
    return _alias(await prisma.manifestacao.create({ data, include: INCLUDE_BASICO }));
  },

  async update(id, data) {
    return _alias(await prisma.manifestacao.update({ where: { id: Number(id) }, data, include: INCLUDE_BASICO }));
  },

  // Resolve o nome de um setor para o setorId dentro da empresa (ficha → PG)
  async resolverSetorId(empresaId, nome) {
    if (!nome || !empresaId) return null;
    const n = String(nome).toLowerCase().trim();
    const setores = await prisma.setor.findMany({ where: { empresaId: Number(empresaId) } });
    const s = setores.find(x =>
      x.nome.toLowerCase() === n || x.codigo.toLowerCase() === n ||
      x.nome.toLowerCase().includes(n) || n.includes(x.codigo.toLowerCase())
    );
    return s ? s.id : null;
  },

  // Encontra ou cria um responsável por nome dentro de um setor (ficha → PG)
  async resolverResponsavelId(setorId, nome) {
    if (!nome || !setorId) return null;
    const n = String(nome).trim();
    let r = await prisma.responsavel.findFirst({ where: { setorId: Number(setorId), nome: { equals: n, mode: 'insensitive' } } });
    if (!r) r = await prisma.responsavel.create({ data: { setorId: Number(setorId), nome: n } });
    return r.id;
  },

  async criarTratativa(manifestacaoId, textoFinal, { usuarioId = null, setorId = null } = {}) {
    return prisma.tratativa.create({
      data: { manifestacaoId: Number(manifestacaoId), textoFinal: String(textoFinal || ''), status: 'REALIZADA', usuarioId: usuarioId || undefined, setorId: setorId || undefined },
    });
  },

  async criarDevolutiva(manifestacaoId, textoFinal, { tipo = 'RECEBIMENTO' } = {}) {
    return prisma.devolutiva.create({
      data: { manifestacaoId: Number(manifestacaoId), textoFinal: String(textoFinal || ''), status: 'ENVIADA', tipo },
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
    const rows = await prisma.manifestacao.findMany({
      where: { descricao: { not: '' } },
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
        empresaRel: { select: { nome: true, codigo: true } },
        clienteRel: { select: { nome: true } },
        setorRel: { select: { nome: true } },
        tratativas: { select: { descricaoTratativa: true, resultado: true }, take: 1 },
      },
      orderBy: { criadaEm: 'desc' },
      take: limite,
    });
    return rows.map(r => { r.empresa = r.empresaRel; r.cliente = r.clienteRel; r.setor = r.setorRel; return r; });
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
        tipo: true, criadaEm: true, status: true,
        tratativas: { select: { descricaoTratativa: true }, take: 1 },
      },
    });
  },

  async upsertFromSheets(sheetsData) {
    const { ID_MANIFESTACAO: idOriginal, EMPRESA_RECLAMANTE, EMPRESA_RECLAMADA, DESCRICAO, STATUS, TIPO, PRODUTO, DATA_ABERTURA } = sheetsData;
    if (!idOriginal) return null;

    const existente = await this.findByIdOriginal(idOriginal);
    if (existente) return { acao: 'ignorado', id: existente.id };

    const empresa = await prisma.empresa.findFirst();
    if (!empresa) return null;

    const criada = await prisma.manifestacao.create({
      data: {
        protocolo: idOriginal,
        idOriginal,
        empresaId: empresa.id,
        empresaNome: EMPRESA_RECLAMADA || EMPRESA_RECLAMANTE || empresa.nome,
        contato: EMPRESA_RECLAMANTE || null,
        descricao: DESCRICAO || '',
        tipo: TIPO || 'RECLAMACAO',
        produtoNome: PRODUTO || null,
        prioridade: 'Media',
        status: STATUS || 'ABERTA',
        criadaEm: DATA_ABERTURA ? new Date(DATA_ABERTURA) : new Date(),
      },
    });
    return { acao: 'inserido', id: criada.id };
  },
};

module.exports = manifestacaoRepository;
