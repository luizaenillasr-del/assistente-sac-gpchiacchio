'use strict';
// Mock do Google Sheets para testes comportamentais
// Dados isolados por empresa: EMPRESA_A e EMPRESA_B

const USUARIOS = [
  { ID_USUARIO:'USR-A-001', USUARIO:'usuario.a', SENHA:'sha256:' + require('crypto').createHash('sha256').update('senhaA123').digest('hex'), PERFIL:'ANALISTA SAC', EMPRESA:'EMPRESA_A', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-B-001', USUARIO:'usuario.b', SENHA:'sha256:' + require('crypto').createHash('sha256').update('senhaB123').digest('hex'), PERFIL:'ANALISTA SAC', EMPRESA:'EMPRESA_B', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-M-001', USUARIO:'master.test', SENHA:'sha256:' + require('crypto').createHash('sha256').update('masterPass').digest('hex'), PERFIL:'MASTER', EMPRESA:'', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-DIS-001', USUARIO:'usuario.inativo', SENHA:'sha256:' + require('crypto').createHash('sha256').update('inativo123').digest('hex'), PERFIL:'ANALISTA SAC', EMPRESA:'EMPRESA_A', STATUS:'INATIVO' },
];

const MANIFESTACOES = [
  { ID_MANIFESTACAO:'MAN-A-001', EMPRESA_RECLAMANTE:'EMPRESA_A', EMPRESA_RECLAMADA:'EMPRESA_A', STATUS:'EM ANÁLISE', TITULO:'Reclamação A1', TIPO:'RECLAMAÇÃO' },
  { ID_MANIFESTACAO:'MAN-A-002', EMPRESA_RECLAMANTE:'EMPRESA_A', EMPRESA_RECLAMADA:'EMPRESA_A', STATUS:'FINALIZADA', TITULO:'Reclamação A2', TIPO:'RECLAMAÇÃO' },
  { ID_MANIFESTACAO:'MAN-B-001', EMPRESA_RECLAMANTE:'EMPRESA_B', EMPRESA_RECLAMADA:'EMPRESA_B', STATUS:'EM ANÁLISE', TITULO:'Reclamação B1', TIPO:'RECLAMAÇÃO' },
  { ID_MANIFESTACAO:'TESTE-GOLIVE-001', EMPRESA_RECLAMANTE:'EMPRESA_A', EMPRESA_RECLAMADA:'EMPRESA_A', STATUS:'EM ANÁLISE', TITULO:'TESTE-GOLIVE item', TIPO:'RECLAMAÇÃO' },
];

const RECLAMACOES = [
  { 'ID':'REC-A-001', 'Empresa':'EMPRESA_A', 'Motivo da Reclamação':'Entrega', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-15' },
  { 'ID':'REC-B-001', 'Empresa':'EMPRESA_B', 'Motivo da Reclamação':'Qualidade', 'Status':'Aberta', 'Dentro do prazo?':'NÃO', 'Data do Registro':'2024-01-16' },
  { 'ID':'TESTE-GOLIVE-REC', 'Empresa':'EMPRESA_A', 'Motivo da Reclamação':'TESTE-GOLIVE rec', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-17' },
];

const RNC = [
  { ID_RNC:'RNC-A-001', EMPRESA:'EMPRESA_A', STATUS:'ABERTA', NAO_CONFORMIDADE:'NC teste A' },
  { ID_RNC:'RNC-B-001', EMPRESA:'EMPRESA_B', STATUS:'ABERTA', NAO_CONFORMIDADE:'NC teste B' },
];

const HISTORICO = [
  { ID_HISTORICO:'HIST-A-001', EMPRESA:'EMPRESA_A', DESCRICAO:'Histórico A' },
  { ID_HISTORICO:'HIST-B-001', EMPRESA:'EMPRESA_B', DESCRICAO:'Histórico B' },
];

const DB = {
  MANIFESTACOES, RNC, HISTORICO,
  USUARIOS,
  'Reclamações': RECLAMACOES,
  'Reclamações + devolutiva': [],
  LOG_SISTEMA: [],
};

const appendedRows = [];

module.exports = {
  lerAba(nomeAba) {
    return Promise.resolve(JSON.parse(JSON.stringify(DB[nomeAba] || [])));
  },
  lerAbaReclamacoes() {
    return Promise.resolve(JSON.parse(JSON.stringify(RECLAMACOES)));
  },
  appendLinha(nomeAba, linha) {
    appendedRows.push({ nomeAba, linha });
    if (!DB[nomeAba]) DB[nomeAba] = [];
    DB[nomeAba].push(linha);
    return Promise.resolve();
  },
  appendObjeto(nomeAba, objeto) {
    appendedRows.push({ nomeAba, objeto });
    if (!DB[nomeAba]) DB[nomeAba] = [];
    DB[nomeAba].push(objeto);
    return Promise.resolve({ headers: Object.keys(objeto), linha: Object.values(objeto) });
  },
  obterCabecalhos(nomeAba) {
    const rows = DB[nomeAba];
    if (!rows || !rows.length) return Promise.resolve([]);
    return Promise.resolve(Object.keys(rows[0]));
  },
  atualizarPorID(nomeAba, id, dados) {
    const rows = DB[nomeAba] || [];
    const idCampos = ['ID_MANIFESTACAO','ID_RNC','ID','ID_HISTORICO'];
    const row = rows.find(r => idCampos.some(c => r[c] === id));
    if (row) Object.assign(row, dados);
    return Promise.resolve(row ? { rowIndex: rows.indexOf(row) + 2 } : null);
  },
  getAppendedRows() { return appendedRows; },
  reset() { appendedRows.length = 0; },
  USUARIOS,
};
