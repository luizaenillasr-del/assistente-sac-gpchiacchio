'use strict';

// Regras puras do fluxo operacional CIRCA. Persistência e autorização ficam na
// API; este módulo apenas valida transições e normaliza recomendações.
const STAGES = Object.freeze([
  { id: 'registro', label: 'Registro' },
  { id: 'analise', label: 'Análise inteligente e triagem' },
  { id: 'conducao', label: 'Condução' },
  { id: 'investigacao', label: 'Investigação e resolução' },
  { id: 'validacao', label: 'Validação SAC' },
  { id: 'devolutiva', label: 'Devolutiva conclusiva' },
  { id: 'encerramento', label: 'Encerramento e aprendizado' },
]);

const STATUS = Object.freeze({
  RASCUNHO: 'RASCUNHO', REGISTRADA: 'REGISTRADA', EM_TRIAGEM: 'EM_TRIAGEM',
  EM_INVESTIGACAO: 'EM_INVESTIGACAO', AGUARDANDO_INFORMACOES: 'AGUARDANDO_INFORMACOES',
  EM_TRATATIVA: 'EM_TRATATIVA', AGUARDANDO_VALIDACAO: 'AGUARDANDO_VALIDACAO_SAC',
  DEVOLVIDA_COMPLEMENTACAO: 'DEVOLVIDA_PARA_COMPLEMENTACAO', AGUARDANDO_DEVOLUTIVA: 'AGUARDANDO_DEVOLUTIVA',
  AGUARDANDO_ENCERRAMENTO: 'AGUARDANDO_ENCERRAMENTO', FINALIZADA: 'FINALIZADA',
  REABERTA: 'REABERTA', CANCELADA: 'CANCELADA',
});

const STATUS_ALIASES = Object.freeze({
  'ABERTA': STATUS.REGISTRADA, 'NOVA': STATUS.REGISTRADA, 'RECEBIDA': STATUS.REGISTRADA,
  'AGUARDANDO_TRIAGEM_SAC': STATUS.EM_TRIAGEM, 'TRIAGEM': STATUS.EM_TRIAGEM,
  'EM TRATAMENTO': STATUS.EM_TRATATIVA, 'EM_TRATAMENTO': STATUS.EM_TRATATIVA,
  'AGUARDANDO_SETOR': STATUS.EM_INVESTIGACAO, 'AGUARDANDO_VALIDACAO': STATUS.AGUARDANDO_VALIDACAO,
  'ENCERRADA': STATUS.FINALIZADA, 'FECHADA': STATUS.FINALIZADA, 'RESOLVIDA': STATUS.FINALIZADA,
});

const TRANSITIONS = Object.freeze({
  [STATUS.RASCUNHO]: [STATUS.REGISTRADA, STATUS.CANCELADA],
  [STATUS.REGISTRADA]: [STATUS.EM_TRIAGEM, STATUS.CANCELADA],
  [STATUS.EM_TRIAGEM]: [STATUS.EM_INVESTIGACAO, STATUS.EM_TRATATIVA, STATUS.AGUARDANDO_INFORMACOES, STATUS.CANCELADA],
  [STATUS.EM_INVESTIGACAO]: [STATUS.EM_TRATATIVA, STATUS.AGUARDANDO_INFORMACOES, STATUS.AGUARDANDO_VALIDACAO, STATUS.REABERTA],
  [STATUS.AGUARDANDO_INFORMACOES]: [STATUS.EM_INVESTIGACAO, STATUS.EM_TRATATIVA, STATUS.CANCELADA],
  [STATUS.EM_TRATATIVA]: [STATUS.AGUARDANDO_VALIDACAO, STATUS.AGUARDANDO_INFORMACOES, STATUS.REABERTA],
  [STATUS.AGUARDANDO_VALIDACAO]: [STATUS.DEVOLVIDA_COMPLEMENTACAO, STATUS.AGUARDANDO_DEVOLUTIVA, STATUS.REABERTA],
  [STATUS.DEVOLVIDA_COMPLEMENTACAO]: [STATUS.EM_INVESTIGACAO, STATUS.EM_TRATATIVA],
  [STATUS.AGUARDANDO_DEVOLUTIVA]: [STATUS.AGUARDANDO_ENCERRAMENTO, STATUS.DEVOLVIDA_COMPLEMENTACAO],
  [STATUS.AGUARDANDO_ENCERRAMENTO]: [STATUS.FINALIZADA, STATUS.DEVOLVIDA_COMPLEMENTACAO, STATUS.REABERTA],
  [STATUS.FINALIZADA]: [STATUS.REABERTA],
  [STATUS.REABERTA]: [STATUS.EM_TRIAGEM, STATUS.EM_INVESTIGACAO, STATUS.EM_TRATATIVA],
  [STATUS.CANCELADA]: [],
});

function normalizeStatus(value) {
  const key = String(value == null ? '' : value).trim().toUpperCase().replace(/[ÁÀÃÂ]/g, 'A').replace(/[ÉÊ]/g, 'E').replace(/[Í]/g, 'I').replace(/[ÓÔÕ]/g, 'O').replace(/[Ú]/g, 'U');
  return STATUS[key] || STATUS_ALIASES[key] || (Object.values(STATUS).includes(key) ? key : STATUS.REGISTRADA);
}

function canTransition(from, to) {
  const current = normalizeStatus(from);
  const next = normalizeStatus(to);
  return current === next || (TRANSITIONS[current] || []).includes(next);
}

function stageForStatus(value) {
  const status = normalizeStatus(value);
  if (status === STATUS.RASCUNHO || status === STATUS.REGISTRADA) return 1;
  if (status === STATUS.EM_TRIAGEM) return 2;
  if (status === STATUS.EM_INVESTIGACAO || status === STATUS.AGUARDANDO_INFORMACOES) return 4;
  if (status === STATUS.EM_TRATATIVA) return 3;
  if (status === STATUS.AGUARDANDO_VALIDACAO || status === STATUS.DEVOLVIDA_COMPLEMENTACAO) return 5;
  if (status === STATUS.AGUARDANDO_DEVOLUTIVA) return 6;
  return 7;
}

function normalizeList(values) {
  const input = Array.isArray(values) ? values : String(values || '').split(/[|,;\n]/);
  const seen = new Set();
  return input.map(v => String(v || '').trim()).filter(Boolean).filter(v => {
    const k = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

function buildChecklist(recommendations = [], previous = []) {
  const old = Array.isArray(previous) ? previous : [];
  const byKey = new Map(old.map(item => [String(item.chave || item.descricao || '').trim().toLowerCase(), item]));
  return (Array.isArray(recommendations) ? recommendations : []).map(item => {
    const description = typeof item === 'string' ? item : item.descricao || item.titulo || '';
    const key = String(description).trim().toLowerCase();
    const existing = byKey.get(key);
    const stableId = `circa-${key.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
    return existing ? { ...existing, id: existing.id || stableId, prazo: existing.prazo || item.prazo || '', prazoHoras: existing.prazoHoras || item.prazoHoras || null, vencimento: existing.vencimento || item.vencimento || '', origem: existing.origem || 'HISTORICO' } : {
      id: stableId,
      chave: key, descricao: description, responsavel: item.responsavel || '', prazo: item.prazo || (item.prazoHoras ? `${item.prazoHoras}h` : ''), prazoHoras: item.prazoHoras || null, vencimento: item.vencimento || '',
      obrigatoria: item.obrigatoria !== false, status: 'PENDENTE', evidencia: '', origem: item.origem || 'CIRCA',
    };
  }).filter(item => item.descricao);
}

function validateClosure({ status, investigationComplete, validationDone, devolutivaDone, blockingOpen = false, exceptionalJustification = '' } = {}) {
  const normalized = normalizeStatus(status);
  const errors = [];
  if (![STATUS.AGUARDANDO_ENCERRAMENTO, STATUS.FINALIZADA].includes(normalized)) errors.push('status_nao_permite_encerramento');
  if (!investigationComplete && !exceptionalJustification) errors.push('investigacao_pendente');
  if (!validationDone) errors.push('validacao_sac_pendente');
  if (!devolutivaDone) errors.push('devolutiva_pendente');
  if (blockingOpen) errors.push('acionamento_critico_pendente');
  return { permitido: errors.length === 0, erros: errors };
}

function autonomia({ procedimentoValidado, compatibilidade, evidencias, risco, alçada, autorizacao, historico } = {}) {
  const checks = { procedimentoValidado, compatibilidade, evidencias, risco, alçada, autorizacao, historico };
  const faltantes = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return { permitida: faltantes.length === 0, faltantes };
}

module.exports = { STAGES, STATUS, TRANSITIONS, normalizeStatus, canTransition, stageForStatus, normalizeList, buildChecklist, autonomia, validateClosure };
