'use strict';
// Mock do Google Sheets para testes comportamentais
// Usa nomes de colunas e grafias reais da planilha do Grupo Chiacchio

const crypto = require('crypto');
function sha256(s) { return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex'); }

// ─── Usuários ───────────────────────────────────────────────────────────────
const USUARIOS = [
  { ID_USUARIO:'USR-CHI-001', USUARIO:'ana.chiacchio', SENHA:sha256('senhaChia'), PERFIL:'ANALISTA SAC', EMPRESA:'CHIACCHIO EMBALAGENS', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-CHI-002', USUARIO:'ana.chiacchio2', SENHA:sha256('senhaChia2'), PERFIL:'ANALISTA SAC', EMPRESA:'Chiacchio', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-PLA-001', USUARIO:'joao.plaschio', SENHA:sha256('senhaPla'), PERFIL:'ANALISTA SAC', EMPRESA:'PLASCHIO', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-TUB-001', USUARIO:'maria.tubahia', SENHA:sha256('senhaTub'), PERFIL:'ANALISTA SAC', EMPRESA:'TUBAHIA', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-CES-001', USUARIO:'pedro.cesbap', SENHA:sha256('senhaCes'), PERFIL:'ANALISTA SAC', EMPRESA:'Cesbap', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-MST-001', USUARIO:'master.test', SENHA:sha256('masterPass'), PERFIL:'MASTER', EMPRESA:'Grupo Chiacchio', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-DIS-001', USUARIO:'usuario.inativo', SENHA:sha256('inativo123'), PERFIL:'ANALISTA SAC', EMPRESA:'CHIACCHIO EMBALAGENS', STATUS:'INATIVO' },
  { ID_USUARIO:'USR-APROV-CHI', USUARIO:'aprovador.chi', SENHA:sha256('senhaAprovChi'), PERFIL:'APROVADOR', EMPRESA:'CHIACCHIO EMBALAGENS', STATUS:'ATIVO' },
  { ID_USUARIO:'USR-APROV-PLA', USUARIO:'aprovador.pla', SENHA:sha256('senhaAprovPla'), PERFIL:'APROVADOR', EMPRESA:'PLASCHIO', STATUS:'ATIVO' },
];

// ─── MANIFESTACOES — coluna de empresa: EMPRESA_RECLAMADA ────────────────────
const MANIFESTACOES = [
  // Chiacchio — grafias distintas
  { ID_MANIFESTACAO:'MAN-CHI-001', EMPRESA_RECLAMADA:'CHIACCHIO EMBALAGENS', EMPRESA_RECLAMANTE:'Cliente A', STATUS:'EM ANÁLISE', DESCRICAO:'Problema embalagem' },
  { ID_MANIFESTACAO:'MAN-CHI-002', EMPRESA_RECLAMADA:'CHIACHIO EMBALAGENS', EMPRESA_RECLAMANTE:'Cliente B', STATUS:'FINALIZADA', DESCRICAO:'Atraso entrega' },
  // Plaschio
  { ID_MANIFESTACAO:'MAN-PLA-001', EMPRESA_RECLAMADA:'PLASCHIO', EMPRESA_RECLAMANTE:'Cliente C', STATUS:'EM ANÁLISE', DESCRICAO:'Produto danificado' },
  // Tubahia (Cesbap)
  { ID_MANIFESTACAO:'MAN-TUB-001', EMPRESA_RECLAMADA:'TUBAHIA', EMPRESA_RECLAMANTE:'Cliente D', STATUS:'EM ANÁLISE', DESCRICAO:'Prazo SLA' },
  // Sem empresa
  { ID_MANIFESTACAO:'MAN-SEM-001', EMPRESA_RECLAMADA:'', EMPRESA_RECLAMANTE:'Cliente E', STATUS:'EM ANÁLISE', DESCRICAO:'Sem empresa definida' },
  // TESTE-GOLIVE
  { ID_MANIFESTACAO:'TESTE-GOLIVE-001', EMPRESA_RECLAMADA:'CHIACCHIO EMBALAGENS', EMPRESA_RECLAMANTE:'Teste', STATUS:'EM ANÁLISE', DESCRICAO:'Item de teste' },
  // Empresa desconhecida
  { ID_MANIFESTACAO:'MAN-DESCONHECIDA-001', EMPRESA_RECLAMADA:'OUTRA EMPRESA LTDA', EMPRESA_RECLAMANTE:'Externo', STATUS:'EM ANÁLISE', DESCRICAO:'Empresa fora do mapa' },
];

// ─── Reclamações — coluna de empresa: Empresa ────────────────────────────────
const RECLAMACOES = [
  { 'ID':'REC-CHI-001', 'Empresa':'Chiacchio', 'Motivo da Reclamação':'Entrega atrasada', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-15' },
  { 'ID':'REC-PLA-001', 'Empresa':'Plaschio', 'Motivo da Reclamação':'Qualidade', 'Status':'Aberta', 'Dentro do prazo?':'NÃO', 'Data do Registro':'2024-01-16' },
  { 'ID':'REC-TUB-001', 'Empresa':'Tubahia', 'Motivo da Reclamação':'Prazo', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-17' },
  { 'ID':'REC-SEM-001', 'Empresa':'', 'Motivo da Reclamação':'Sem empresa', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-18' },
  { 'ID':'TESTE-GOLIVE-REC', 'Empresa':'Chiacchio', 'Motivo da Reclamação':'TESTE-GOLIVE rec', 'Status':'Aberta', 'Dentro do prazo?':'SIM', 'Data do Registro':'2024-01-19' },
];

// ─── BANCO_RNC — coluna de empresa: EMPRESA_RECLAMADA ────────────────────────
const BANCO_RNC = [
  { ID_RNC:'RNC-CHI-001', EMPRESA_RECLAMADA:'CHIACCHIO EMBALAGENS', STATUS:'ABERTA', NAO_CONFORMIDADE:'NC Chiacchio' },
  { ID_RNC:'RNC-PLA-001', EMPRESA_RECLAMADA:'PLASCHIO', STATUS:'ABERTA', NAO_CONFORMIDADE:'NC Plaschio' },
];

// ─── BANCO_HISTORICO — coluna de empresa: DRV_EMPRESA_NORMALIZADA ────────────
const BANCO_HISTORICO = [
  { ID_HISTORICO:'HIST-CHI-001', DRV_EMPRESA_NORMALIZADA:'CHIACCHIO EMBALAGENS', DESCRICAO:'Histórico Chiacchio' },
  { ID_HISTORICO:'HIST-PLA-001', DRV_EMPRESA_NORMALIZADA:'PLASCHIO', DESCRICAO:'Histórico Plaschio' },
  { ID_HISTORICO:'HIST-SEM-001', DRV_EMPRESA_NORMALIZADA:'', DESCRICAO:'Histórico sem empresa' },
];

// ─── CONFIG_SETORES — sem empresa = global ────────────────────────────────────
const CONFIG_SETORES = [
  { ID_SETOR:'SET-001', NOME_SETOR:'Qualidade', EMPRESA:'' },
  { ID_SETOR:'SET-002', NOME_SETOR:'Comercial', EMPRESA:'' },
  { ID_SETOR:'SET-003', NOME_SETOR:'Produção', EMPRESA:'CHIACCHIO EMBALAGENS' },
];

// ─── FILA_APROVACAO — coluna de empresa: EMPRESA ────────────────────────────
const FILA_APROVACAO = [
  { ID_FILA:'FAP-CHI-001', ID_ENTIDADE:'MAN-CHI-001', TIPO_ENTIDADE:'SAC', EMPRESA:'CHIACCHIO EMBALAGENS', STATUS:'PENDENTE', CRIADO_POR:'ana.chiacchio', ID_APROVADOR:'aprovador.chi' },
  { ID_FILA:'FAP-PLA-001', ID_ENTIDADE:'MAN-PLA-001', TIPO_ENTIDADE:'SAC', EMPRESA:'PLASCHIO',             STATUS:'PENDENTE', CRIADO_POR:'joao.plaschio',  ID_APROVADOR:'aprovador.pla' },
];

// ─── HISTORICO_APROVACAO — coluna de isolamento: EMPRESA_SCOPE ───────────────
const HISTORICO_APROVACAO = [
  // Registro com EMPRESA_SCOPE de Chiacchio
  { ID_HISTORICO:'HAPROV-CHI-001', ID_FILA:'FAP-CHI-001', ID_ENTIDADE:'MAN-CHI-001', TIPO_ENTIDADE:'SAC', DECISAO:'APROVADO', OBSERVACOES:'ok', APROVADOR:'aprovador.chi', DATA_DECISAO:'2026-01-10', DETALHES:'{}', EMPRESA_SCOPE:'CHIACCHIO' },
  // Registro com EMPRESA_SCOPE de Plaschio
  { ID_HISTORICO:'HAPROV-PLA-001', ID_FILA:'FAP-PLA-001', ID_ENTIDADE:'MAN-PLA-001', TIPO_ENTIDADE:'SAC', DECISAO:'REJEITADO', OBSERVACOES:'', APROVADOR:'aprovador.pla', DATA_DECISAO:'2026-01-11', DETALHES:'{}', EMPRESA_SCOPE:'PLASCHIO' },
  // Registro legado sem EMPRESA_SCOPE
  // APROVADOR igual ao usuário do teste (aprovador.chi) para que só o filtro de legados possa excluí-lo
  { ID_HISTORICO:'HAPROV-LEG-001', ID_FILA:'FAP-OLD-001', ID_ENTIDADE:'MAN-OLD-001', TIPO_ENTIDADE:'SAC', DECISAO:'APROVADO', OBSERVACOES:'legado', APROVADOR:'aprovador.chi', DATA_DECISAO:'2025-06-01', DETALHES:'{}', EMPRESA_SCOPE:'' },
];

// ─── LOG_SISTEMA — entradas por manifestação ──────────────────────────────────
const LOG_SISTEMA_SEED = [
  { DATA_HORA:'2026-01-10T10:00:00', USUARIO:'ana.chiacchio', ACAO:'Manifestação criada', ID_REGISTRO:'MAN-CHI-001', DETALHES:'Criação inicial' },
  { DATA_HORA:'2026-01-10T11:00:00', USUARIO:'ana.chiacchio', ACAO:'Enviado para revisão', ID_REGISTRO:'MAN-CHI-001', DETALHES:'' },
  { DATA_HORA:'2026-01-11T09:00:00', USUARIO:'joao.plaschio', ACAO:'Manifestação criada', ID_REGISTRO:'MAN-PLA-001', DETALHES:'Criação inicial' },
];

const DB = {
  MANIFESTACOES,
  BANCO_RNC,
  BANCO_HISTORICO,
  HISTORICO_APROVACAO,
  CONFIG_SETORES,
  FILA_APROVACAO,
  USUARIOS,
  'Reclamações': RECLAMACOES,
  'Reclamações + devolutiva': [],
  LOG_SISTEMA: JSON.parse(JSON.stringify(LOG_SISTEMA_SEED)),
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
  DB,
};
