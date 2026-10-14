'use strict';

const prisma = require('../connection');

const _intNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : Math.round(n); };
const _floatNum = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n; };

// PG → formato da planilha (PESQUISA_RESPOSTAS) para a API/telas existentes
function respostaToSheets(r) {
  return {
    ID_RESPOSTA: r.idOriginal || `RSP-${r.id}`,
    TOKEN: r.token || '',
    EMPRESA: r.empresa || '',
    NOME_CLIENTE: r.nomeCliente || '',
    DATA: (r.data && r.data.toISOString) ? r.data.toISOString() : (r.data || ''),
    ATENDIMENTO: r.atendimento ?? '',
    PRAZO_ENTREGA: r.prazoEntrega ?? '',
    QUALIDADE: r.qualidade ?? '',
    RECOMENDACAO: r.recomendacao ?? '',
    COMENTARIO: r.comentario || '',
    NOTA_MEDIA: r.notaMedia != null ? String(r.notaMedia) : '',
    NOTA_BAIXA: r.notaBaixa ? 'SIM' : 'NAO',
    STATUS_OCP: r.statusOcp || '',
  };
}

function respostaFromSheets(o) {
  return {
    idOriginal: o.ID_RESPOSTA || null,
    token: o.TOKEN || null,
    empresa: o.EMPRESA || '',
    nomeCliente: o.NOME_CLIENTE || null,
    data: o.DATA ? new Date(o.DATA) : new Date(),
    atendimento: _intNum(o.ATENDIMENTO),
    prazoEntrega: _intNum(o.PRAZO_ENTREGA),
    qualidade: _intNum(o.QUALIDADE),
    recomendacao: _intNum(o.RECOMENDACAO),
    comentario: o.COMENTARIO || null,
    notaMedia: _floatNum(o.NOTA_MEDIA),
    notaBaixa: String(o.NOTA_BAIXA || '').toUpperCase() === 'SIM',
    statusOcp: o.STATUS_OCP || null,
  };
}

function relatorioToSheets(r) {
  return {
    ID_RELATORIO: r.idOriginal || `REL-${r.id}`,
    CHAVE: r.chave || '',
    EMPRESA: r.empresa || '',
    ANO: r.ano || '',
    MES: r.mes || '',
    VERSAO: String(r.versao || 1),
    STATUS: r.status || 'RASCUNHO',
    INDICADOR: r.indicador || '',
    NPS_SCORE: r.npsScore || '',
    TEXTOS_JSON: r.textosJson || '',
    DADOS_JSON: r.dadosJson || '',
    LINK_TOKEN: r.linkToken || '',
    CRIADO_POR: r.criadoPor || '',
    PUBLICADO_EM: (r.publicadoEm && r.publicadoEm.toISOString) ? r.publicadoEm.toISOString() : (r.publicadoEm || ''),
    CRIADO_EM: (r.criadoEm && r.criadoEm.toISOString) ? r.criadoEm.toISOString() : (r.criadoEm || ''),
  };
}

const pesquisaRepository = {
  async listarRespostas({ empresa } = {}) {
    const where = {};
    if (empresa && String(empresa).toUpperCase() !== 'TODAS') where.empresa = empresa;
    const rows = await prisma.pesquisaResposta.findMany({ where, orderBy: { data: 'desc' } });
    return rows.map(respostaToSheets);
  },

  async criarResposta(sheetsObj) {
    const data = respostaFromSheets(sheetsObj);
    if (data.idOriginal) {
      return prisma.pesquisaResposta.upsert({ where: { idOriginal: data.idOriginal }, update: data, create: data });
    }
    return prisma.pesquisaResposta.create({ data });
  },

  async listarRelatorios({ chave, empresa } = {}) {
    const where = {};
    if (chave) where.chave = chave;
    if (empresa && String(empresa).toUpperCase() !== 'TODAS') where.empresa = empresa;
    const rows = await prisma.relatorioSac.findMany({ where, orderBy: [{ chave: 'asc' }, { versao: 'desc' }] });
    return rows.map(relatorioToSheets);
  },

  async criarRelatorio(obj) {
    const data = {
      idOriginal: obj.ID_RELATORIO || null,
      chave: obj.CHAVE || '', empresa: obj.EMPRESA || '', ano: String(obj.ANO || ''), mes: String(obj.MES || ''),
      versao: Number(obj.VERSAO) || 1, status: obj.STATUS || 'RASCUNHO',
      indicador: obj.INDICADOR || null, npsScore: obj.NPS_SCORE || null,
      textosJson: obj.TEXTOS_JSON || null, dadosJson: obj.DADOS_JSON || null,
      linkToken: obj.LINK_TOKEN || null, criadoPor: obj.CRIADO_POR || null,
    };
    if (data.idOriginal) {
      return prisma.relatorioSac.upsert({ where: { idOriginal: data.idOriginal }, update: data, create: data });
    }
    return prisma.relatorioSac.create({ data });
  },

  async maxVersaoPorChave(chave) {
    const r = await prisma.relatorioSac.findFirst({ where: { chave }, orderBy: { versao: 'desc' } });
    return r ? r.versao : 0;
  },
};

module.exports = pesquisaRepository;
