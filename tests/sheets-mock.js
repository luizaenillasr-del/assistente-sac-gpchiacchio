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
  { ID_SETOR:'SET-001', NOME_SETOR:'Qualidade', SETOR:'Qualidade', EMPRESA:'' },
  { ID_SETOR:'SET-002', NOME_SETOR:'Comercial', SETOR:'Comercial', EMPRESA:'' },
  { ID_SETOR:'SET-003', NOME_SETOR:'Produção', SETOR:'Produção', EMPRESA:'CHIACCHIO EMBALAGENS' },
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

// ─── DADOS FICTÍCIOS (apenas dev — NÃO roda em testes) ───────────────────────
// Gera volume realista pra popular o dashboard e exercitar fluxos / caçar bugs.
// Gated por NODE_ENV!=='test' para não alterar as contagens de suite.js/behavior.js.
if (process.env.NODE_ENV !== 'test') {
  const hoje = new Date();
  const diasAtras = (n) => { const d = new Date(hoje); d.setDate(d.getDate() - n); return d; };
  const iso = (d) => d.toISOString();
  const ymd = (d) => d.toISOString().slice(0, 10);
  const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

  const EMPRESAS = ['CHIACCHIO EMBALAGENS', 'Chiacchio', 'PLASCHIO', 'TUBAHIA', 'Cesbap'];
  const CLIENTES = ['Supermercado Bom Preço', 'Distribuidora Aurora', 'Padaria Pão Quente', 'Mercado União', 'Atacadão Silva', 'Farmácia Vida', 'Comercial Andrade', 'Loja do Zé', 'Mercearia Central', 'Hortifruti Sabor', 'Adega do Vinho', 'Açougue Boi Gordo'];
  const MOTIVOS = ['Entrega atrasada', 'Produto danificado', 'Divergência de nota fiscal', 'Embalagem rompida', 'Falta de produto', 'Qualidade do produto', 'Erro de faturamento', 'Prazo de entrega não cumprido'];
  const SETORES = ['Qualidade', 'Comercial', 'Logística', 'Financeiro', 'Produção', 'Faturamento / Expedição'];
  const STATUS_MAN = ['EM ANÁLISE', 'AGUARDANDO_DECISÃO', 'AGUARDANDO_APROVAÇÃO', 'EM TRATATIVA', 'AGUARDANDO OUTRO SETOR', 'AGUARDANDO_DEVOLUTIVA', 'CONCLUÍDA', 'FINALIZADA'];
  const TIPOS = ['Reclamação', 'Reclamação', 'Reclamação', 'Dúvida', 'Sugestão', 'Elogio'];
  const PRIORIDADES = ['Baixa', 'Média', 'Alta'];
  const CANAIS = ['E-mail', 'Telefone', 'WhatsApp', 'Site'];

  // 300 reclamações espalhadas nas últimas 12 semanas
  for (let i = 0; i < 300; i++) {
    const dias = Math.floor(i * 83 / 300);
    const finalizada = i % 3 === 0;
    const noPrazo = i % 10 < 7; // ~70% dentro do prazo
    RECLAMACOES.push({
      'ID': `REC-GEN-${String(i + 1).padStart(3, '0')}`,
      'Empresa': pick(EMPRESAS, i),
      'Motivo da Reclamação': pick(MOTIVOS, i),
      'Status': finalizada ? 'Finalizada' : 'Aberta',
      'Situação Final': finalizada ? 'Concluída' : '',
      'Dentro do prazo?': noPrazo ? 'SIM' : 'NÃO',
      'Data do Registro': ymd(diasAtras(dias)),
      'Tempo Médio de Atendimento': String(12 + (i % 60)),
      'Cliente': pick(CLIENTES, i),
    });
  }

  // 150 manifestações com campos completos e variados
  for (let i = 0; i < 150; i++) {
    const dias = Math.floor(i * 83 / 150);
    const d = diasAtras(dias);
    const temRNC = i % 5 === 0;
    MANIFESTACOES.push({
      ID_MANIFESTACAO: `MAN-GEN-${String(i + 1).padStart(3, '0')}`,
      DATA_ABERTURA: iso(d),
      DATA_REGISTRO: iso(d),
      EMPRESA_RECLAMADA: pick(EMPRESAS, i + 2),
      EMPRESA_RECLAMANTE: pick(CLIENTES, i + 3),
      DESCRICAO: `${pick(MOTIVOS, i)} — relato do cliente ${i + 1}`,
      STATUS: pick(STATUS_MAN, i),
      TIPO: pick(TIPOS, i),
      TIPO_SUGERIDO: pick(TIPOS, i),
      SETOR_SUGERIDO: pick(SETORES, i),
      SETORES_SUGERIDOS: pick(SETORES, i),
      SLA_HORAS: '72',
      PRIORIDADE: pick(PRIORIDADES, i),
      PROCEDENTE: i % 3 === 0 ? 'SIM' : (i % 3 === 1 ? 'NÃO' : ''),
      CANAL: pick(CANAIS, i),
      CNPJ: `${String(10 + i).padStart(2, '0')}.${String(100 + i).padStart(3, '0')}.${String(200 + i).padStart(3, '0')}/0001-${String(10 + i % 90).padStart(2, '0')}`,
      ID_RNC: temRNC ? `RNC-GEN-${String(i + 1).padStart(3, '0')}` : '',
      USUARIO_CRIACAO: 'ana.chiacchio',
    });
  }

  // RNCs (algumas casam com manifestações acima)
  for (let i = 0; i < 30; i++) {
    BANCO_RNC.push({
      ID_RNC: `RNC-GEN-${String(i * 5 + 1).padStart(3, '0')}`,
      EMPRESA_RECLAMADA: EMPRESAS[i % EMPRESAS.length],
      STATUS: i % 2 === 0 ? 'ABERTA' : 'EM TRATAMENTO',
      NAO_CONFORMIDADE: MOTIVOS[i % MOTIVOS.length],
      DATA_ABERTURA: ymd(diasAtras(i * 7)),
    });
  }

  // Fila de aprovação pendente
  for (let i = 0; i < 20; i++) {
    FILA_APROVACAO.push({
      ID_FILA: `FAP-GEN-${String(i + 1).padStart(3, '0')}`,
      ID_ENTIDADE: `MAN-GEN-${String(i * 3 + 1).padStart(3, '0')}`,
      TIPO_ENTIDADE: 'SAC',
      EMPRESA: EMPRESAS[i % EMPRESAS.length],
      STATUS: 'PENDENTE',
      CRIADO_POR: 'ana.chiacchio',
      ID_APROVADOR: 'aprovador.chi',
    });
  }

  // ── Casos extremos (pra provocar bugs: datas, campos faltando, caracteres especiais) ──
  MANIFESTACOES.push(
    { ID_MANIFESTACAO: 'MAN-EDGE-001', EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS', EMPRESA_RECLAMANTE: 'Cliente com <tag> & "aspas"', DESCRICAO: 'Acentos çãõ, emoji 😀, caracteres & < > e aspas "duplas"', STATUS: 'EM ANÁLISE', TIPO: 'Reclamação', SETOR_SUGERIDO: 'Qualidade', DATA_ABERTURA: iso(new Date(hoje.getTime() + 30 * 86400000)) /* data no futuro */ },
    { ID_MANIFESTACAO: 'MAN-EDGE-002', EMPRESA_RECLAMADA: 'PLASCHIO', EMPRESA_RECLAMANTE: 'Campos faltando', DESCRICAO: 'Sem TIPO, sem SETOR, sem DATA, STATUS vazio', STATUS: '' /* status vazio */ },
    { ID_MANIFESTACAO: 'MAN-EDGE-003', EMPRESA_RECLAMADA: 'TUBAHIA', EMPRESA_RECLAMANTE: 'Registro antigo', DESCRICAO: 'Data de 2019', STATUS: 'FINALIZADA', TIPO: 'Reclamação', DATA_ABERTURA: '2019-01-01T00:00:00.000Z' },
    { ID_MANIFESTACAO: 'MAN-EDGE-004', EMPRESA_RECLAMADA: 'Chiacchio', EMPRESA_RECLAMANTE: 'Texto gigante', DESCRICAO: 'X'.repeat(2000) /* descrição de 2000 chars */, STATUS: 'EM TRATATIVA', TIPO: 'Sugestão', SETOR_SUGERIDO: 'Comercial', DATA_ABERTURA: iso(hoje) },
  );
  RECLAMACOES.push(
    { 'ID': 'REC-EDGE-001', 'Empresa': 'CHIACCHIO EMBALAGENS', 'Motivo da Reclamação': 'Data malformada', 'Status': 'Aberta', 'Dentro do prazo?': 'SIM', 'Data do Registro': 'data-invalida-xyz' /* data inválida */ },
    { 'ID': 'REC-EDGE-002', 'Empresa': 'PLASCHIO', 'Motivo da Reclamação': 'Data serial Excel', 'Status': 'Aberta', 'Dentro do prazo?': 'NÃO', 'Data do Registro': 45900 /* número serial Excel */ },
    { 'ID': 'REC-EDGE-003', 'Empresa': '', 'Motivo da Reclamação': '', 'Status': '', 'Dentro do prazo?': '', 'Data do Registro': '' /* tudo vazio */ },
  );
}

const PERMISSOES_USUARIO = [
  { ID_PERMISSAO:'PERM-0001', USUARIO_ID:'USR-CHI-001', USUARIO_EMAIL:'', EMPRESA:'CHIACCHIO EMBALAGENS', PERFIL:'ANALISTA_SAC', MODULO:'{}', NIVEL:'', COMPETENCIAS:'', STATUS:'ATIVO', CRIADO_EM:'', CRIADO_POR:'', ATUALIZADO_EM:'', ATUALIZADO_POR:'' },
];

const ASSERTIVIDADE_IA = [
  { ID_ASSERTIVIDADE:'AST-001', ID_MANIFESTACAO:'MAN-CHI-001', DECISAO_ACEITA:'SIM', CAUSA_CONFIRMADA:'Falha de vedação', SUBCAUSA_CONFIRMADA:'', SETOR_CONFIRMADO:'Qualidade', TRATATIVA_ACEITA:'SIM', DEVOLUTIVA_ACEITA:'SIM', OBSERVACAO:'', PONTUACAO:'100', AVALIADO_EM:'2026-09-10T10:00:00.000Z' },
  { ID_ASSERTIVIDADE:'AST-002', ID_MANIFESTACAO:'MAN-CHI-010', DECISAO_ACEITA:'NAO', CAUSA_CONFIRMADA:'Erro de rotulagem', SUBCAUSA_CONFIRMADA:'', SETOR_CONFIRMADO:'Qualidade', TRATATIVA_ACEITA:'NAO', DEVOLUTIVA_ACEITA:'NAO', OBSERVACAO:'Setor sugerido errado: era Produção, não Qualidade.', PONTUACAO:'40', AVALIADO_EM:'2026-09-20T10:00:00.000Z' },
  { ID_ASSERTIVIDADE:'AST-003', ID_MANIFESTACAO:'MAN-CHI-022', DECISAO_ACEITA:'SIM', CAUSA_CONFIRMADA:'Falha de vedação', SUBCAUSA_CONFIRMADA:'', SETOR_CONFIRMADO:'Qualidade', TRATATIVA_ACEITA:'SIM', DEVOLUTIVA_ACEITA:'SIM', OBSERVACAO:'', PONTUACAO:'80', AVALIADO_EM:'2026-10-01T10:00:00.000Z' },
];

const DB = {
  MANIFESTACOES,
  PERMISSOES_USUARIO,
  ASSERTIVIDADE_IA,
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

// ── DADOS DE TESTE (opt-in via SEED_TESTE=1) ──────────────────────────────────
// Ligado: `SEED_TESTE=1 node scripts/dev-mock.js` → popula pesquisas + manifestações
// marcadas (TOKEN/ORIGEM='SEED_TESTE', IDs *-TESTE-*). Desligado/padrão: nada disso.
// "Apagar" = reiniciar sem a flag. Não afeta `npm test` (que não define SEED_TESTE).
if (process.env.SEED_TESTE === '1' || process.env.SEED_TESTE === 'true') {
  const _n = new Date();
  const _dt = (mesOffset, dia) => new Date(_n.getFullYear(), _n.getMonth() + mesOffset, dia, 10, 0, 0).toISOString();
  const _resp = (i, emp, mesOffset, at, pr, qu, re, com) => {
    const notas = [at, pr, qu, re];
    const media = notas.reduce((a, b) => a + b, 0) / notas.length;
    return { ID_RESPOSTA: `RSP-TESTE-${String(i).padStart(3, '0')}`, TOKEN: 'SEED_TESTE', EMPRESA: emp,
      NOME_CLIENTE: `Cliente Teste ${i}`, DATA: _dt(mesOffset, (i % 26) + 1), ATENDIMENTO: at, PRAZO_ENTREGA: pr,
      QUALIDADE: qu, RECOMENDACAO: re, COMENTARIO: com || '', NOTA_MEDIA: media.toFixed(1),
      NOTA_BAIXA: notas.some(n => n <= 6) ? 'SIM' : 'NAO', STATUS_OCP: '' };
  };
  DB.PESQUISA_RESPOSTAS = DB.PESQUISA_RESPOSTAS || [];
  DB.PESQUISA_RESPOSTAS.push(
    _resp(1, 'Chiacchio Embalagens', -1, 9, 8, 9, 10, 'Ótimo atendimento'),
    _resp(2, 'Chiacchio Embalagens', -1, 7, 6, 8, 7, 'Entrega atrasou um pouco'),
    _resp(3, 'Chiacchio Embalagens', -1, 5, 4, 6, 5, 'Produto veio com defeito'),
    _resp(4, 'Chiacchio Embalagens', 0, 8, 8, 9, 9, 'Melhorou bastante'),
    _resp(5, 'Chiacchio Embalagens', 0, 6, 5, 7, 6, 'Prazo ainda é problema'),
    _resp(6, 'Plaschio', 0, 10, 9, 10, 10, 'Excelente'),
    _resp(7, 'Plaschio', -1, 8, 8, 7, 9, '')
  );
  DB.MANIFESTACOES = DB.MANIFESTACOES || [];
  DB.MANIFESTACOES.push(
    { ID_MANIFESTACAO: 'MAN-TESTE-001', EMPRESA_RECLAMADA: 'Chiacchio Embalagens', EMPRESA_RECLAMANTE: 'Cliente Teste A', STATUS: 'EM ANÁLISE', DESCRICAO: 'Manifestação de teste (seed)', TIPO: 'Reclamação', DATA_ABERTURA: _dt(0, 2), ORIGEM: 'SEED_TESTE' },
    { ID_MANIFESTACAO: 'MAN-TESTE-002', EMPRESA_RECLAMADA: 'Plaschio', EMPRESA_RECLAMANTE: 'Cliente Teste B', STATUS: 'EM TRATAMENTO', DESCRICAO: 'Outra manifestação de teste (seed)', TIPO: 'Sugestão', DATA_ABERTURA: _dt(0, 3), ORIGEM: 'SEED_TESTE' }
  );
}

const appendedRows = [];
// Registro de cabeçalhos por aba — permite abas vazias (ex: RELATORIOS_SAC) terem
// colunas definidas via garantirAbaComCabecalhos, como no Sheets real.
const _headers = {};
function _cabecalhos(nomeAba) {
  if (_headers[nomeAba] && _headers[nomeAba].length) return _headers[nomeAba];
  const rows = DB[nomeAba];
  return (rows && rows.length) ? Object.keys(rows[0]) : [];
}

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
    // Fidelidade ao Sheets real: o app envia linha POSICIONAL (array) montada via cabeçalhos.
    // Reconstrói o objeto a partir dos cabeçalhos da aba para lerAba devolver objetos.
    if (Array.isArray(linha)) {
      const headers = _cabecalhos(nomeAba);
      if (headers.length) {
        const obj = {};
        headers.forEach((h, i) => { obj[h] = linha[i] !== undefined ? linha[i] : ''; });
        DB[nomeAba].push(obj);
        return Promise.resolve();
      }
    }
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
    return Promise.resolve(_cabecalhos(nomeAba));
  },
  atualizarPorID(nomeAba, id, dados, idCampos) {
    const rows = DB[nomeAba] || [];
    const campos = (Array.isArray(idCampos) && idCampos.length)
      ? idCampos
      : ['ID_MANIFESTACAO','ID_RNC','ID','ID_HISTORICO','ID_USUARIO','USUARIO','EMAIL','ID_PERMISSAO','ID_SOLICITACAO'];
    const row = rows.find(r => campos.some(c => r[c] === id));
    if (row) Object.assign(row, dados);
    return Promise.resolve(row ? { rowIndex: rows.indexOf(row) + 2 } : null);
  },
  garantirAbaComCabecalhos(nomeAba, headers) {
    if (!DB[nomeAba]) DB[nomeAba] = [];
    if (Array.isArray(headers) && headers.length) {
      const atual = _headers[nomeAba] || (DB[nomeAba].length ? Object.keys(DB[nomeAba][0]) : []);
      _headers[nomeAba] = [...atual, ...headers.filter(h => !atual.includes(h))];
    }
    return Promise.resolve(_cabecalhos(nomeAba));
  },
  gerarProximoID(nomeAba, prefixo) {
    const rows = DB[nomeAba] || [];
    return Promise.resolve(`${prefixo}-${String(rows.length + 1).padStart(4, '0')}`);
  },
  getAppendedRows() { return appendedRows; },
  reset() { appendedRows.length = 0; },
  USUARIOS,
  DB,
};
