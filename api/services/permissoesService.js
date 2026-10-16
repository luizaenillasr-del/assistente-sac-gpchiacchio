/**
 * Serviço de Permissões e Controle de Acesso
 * Módulos, Níveis, Competências e Solicitações de Acesso
 */

// ── Perfis canônicos ──────────────────────────────────────────────────────────
const PERFIS_VALIDOS = ['MASTER','GESTOR_SAC','ANALISTA_SAC','REPRESENTANTE','APROVADOR','CONSULTA','AUDITOR'];

// ── Módulos do sistema ────────────────────────────────────────────────────────
const MODULOS_SISTEMA = [
  'DASHBOARD','MANIFESTACOES','HISTORICO','ANALISE_INTELIGENTE','CASOS_SIMILARES',
  'TRATATIVAS','DEVOLUTIVAS','RNC','FILA_APROVACAO','CEREBRO','CONHECIMENTO',
  'MATRIZ_TRATAMENTO','POLITICAS','PROCEDIMENTOS','RELATORIOS','AUDITORIA',
  'USUARIOS','CONFIGURACOES',
];

// ── Níveis de acesso ──────────────────────────────────────────────────────────
const NIVEIS = {
  SEM_ACESSO: 0,
  CONSULTA:   1,
  OPERACAO:   2,
  APROVACAO:  3,
  GESTAO:     4,
  MASTER:     99,
};

// ── Competências de aprovação ─────────────────────────────────────────────────
const COMPETENCIAS_VALIDAS = [
  'DEVOLUTIVAS','TRATATIVAS','RNC','CONHECIMENTO','MATRIZ','POLITICAS','PROCEDIMENTOS',
];

// ── Permissões padrão por perfil (fallback quando não há registro individual) ─
const PERMISSOES_PADRAO_PERFIL = {
  MASTER: Object.fromEntries(MODULOS_SISTEMA.map(m => [m, NIVEIS.MASTER])),
  GESTOR_SAC: {
    DASHBOARD: NIVEIS.GESTAO, MANIFESTACOES: NIVEIS.GESTAO, HISTORICO: NIVEIS.GESTAO,
    ANALISE_INTELIGENTE: NIVEIS.GESTAO, CASOS_SIMILARES: NIVEIS.GESTAO,
    TRATATIVAS: NIVEIS.GESTAO, DEVOLUTIVAS: NIVEIS.GESTAO, RNC: NIVEIS.OPERACAO,
    FILA_APROVACAO: NIVEIS.APROVACAO, CEREBRO: NIVEIS.GESTAO, CONHECIMENTO: NIVEIS.GESTAO,
    MATRIZ_TRATAMENTO: NIVEIS.GESTAO, POLITICAS: NIVEIS.CONSULTA, PROCEDIMENTOS: NIVEIS.CONSULTA,
    RELATORIOS: NIVEIS.GESTAO, AUDITORIA: NIVEIS.CONSULTA, USUARIOS: NIVEIS.SEM_ACESSO,
    CONFIGURACOES: NIVEIS.SEM_ACESSO,
  },
  ANALISTA_SAC: {
    DASHBOARD: NIVEIS.CONSULTA, MANIFESTACOES: NIVEIS.OPERACAO, HISTORICO: NIVEIS.CONSULTA,
    ANALISE_INTELIGENTE: NIVEIS.OPERACAO, CASOS_SIMILARES: NIVEIS.CONSULTA,
    TRATATIVAS: NIVEIS.OPERACAO, DEVOLUTIVAS: NIVEIS.OPERACAO, RNC: NIVEIS.SEM_ACESSO,
    FILA_APROVACAO: NIVEIS.SEM_ACESSO, CEREBRO: NIVEIS.CONSULTA, CONHECIMENTO: NIVEIS.OPERACAO,
    MATRIZ_TRATAMENTO: NIVEIS.CONSULTA, POLITICAS: NIVEIS.CONSULTA, PROCEDIMENTOS: NIVEIS.CONSULTA,
    RELATORIOS: NIVEIS.CONSULTA, AUDITORIA: NIVEIS.SEM_ACESSO, USUARIOS: NIVEIS.SEM_ACESSO,
    CONFIGURACOES: NIVEIS.SEM_ACESSO,
  },
  REPRESENTANTE: {
    DASHBOARD: NIVEIS.CONSULTA, MANIFESTACOES: NIVEIS.CONSULTA, HISTORICO: NIVEIS.CONSULTA,
    ANALISE_INTELIGENTE: NIVEIS.SEM_ACESSO, CASOS_SIMILARES: NIVEIS.CONSULTA,
    TRATATIVAS: NIVEIS.OPERACAO, DEVOLUTIVAS: NIVEIS.CONSULTA, RNC: NIVEIS.SEM_ACESSO,
    FILA_APROVACAO: NIVEIS.SEM_ACESSO, CEREBRO: NIVEIS.SEM_ACESSO, CONHECIMENTO: NIVEIS.SEM_ACESSO,
    MATRIZ_TRATAMENTO: NIVEIS.SEM_ACESSO, POLITICAS: NIVEIS.SEM_ACESSO, PROCEDIMENTOS: NIVEIS.SEM_ACESSO,
    RELATORIOS: NIVEIS.SEM_ACESSO, AUDITORIA: NIVEIS.SEM_ACESSO, USUARIOS: NIVEIS.SEM_ACESSO,
    CONFIGURACOES: NIVEIS.SEM_ACESSO,
  },
  APROVADOR: {
    DASHBOARD: NIVEIS.CONSULTA, MANIFESTACOES: NIVEIS.CONSULTA, HISTORICO: NIVEIS.CONSULTA,
    ANALISE_INTELIGENTE: NIVEIS.SEM_ACESSO, CASOS_SIMILARES: NIVEIS.CONSULTA,
    TRATATIVAS: NIVEIS.CONSULTA, DEVOLUTIVAS: NIVEIS.APROVACAO, RNC: NIVEIS.CONSULTA,
    FILA_APROVACAO: NIVEIS.APROVACAO, CEREBRO: NIVEIS.CONSULTA, CONHECIMENTO: NIVEIS.CONSULTA,
    MATRIZ_TRATAMENTO: NIVEIS.SEM_ACESSO, POLITICAS: NIVEIS.SEM_ACESSO, PROCEDIMENTOS: NIVEIS.SEM_ACESSO,
    RELATORIOS: NIVEIS.SEM_ACESSO, AUDITORIA: NIVEIS.SEM_ACESSO, USUARIOS: NIVEIS.SEM_ACESSO,
    CONFIGURACOES: NIVEIS.SEM_ACESSO,
  },
  CONSULTA: Object.fromEntries(MODULOS_SISTEMA.map(m =>
    ['AUDITORIA','USUARIOS','CONFIGURACOES','RNC','FILA_APROVACAO','CEREBRO'].includes(m)
      ? [m, NIVEIS.SEM_ACESSO] : [m, NIVEIS.CONSULTA]
  )),
  AUDITOR: {
    DASHBOARD: NIVEIS.CONSULTA, MANIFESTACOES: NIVEIS.CONSULTA, HISTORICO: NIVEIS.CONSULTA,
    ANALISE_INTELIGENTE: NIVEIS.SEM_ACESSO, CASOS_SIMILARES: NIVEIS.CONSULTA,
    TRATATIVAS: NIVEIS.CONSULTA, DEVOLUTIVAS: NIVEIS.CONSULTA, RNC: NIVEIS.CONSULTA,
    FILA_APROVACAO: NIVEIS.CONSULTA, CEREBRO: NIVEIS.CONSULTA, CONHECIMENTO: NIVEIS.CONSULTA,
    MATRIZ_TRATAMENTO: NIVEIS.CONSULTA, POLITICAS: NIVEIS.CONSULTA, PROCEDIMENTOS: NIVEIS.CONSULTA,
    RELATORIOS: NIVEIS.GESTAO, AUDITORIA: NIVEIS.GESTAO, USUARIOS: NIVEIS.SEM_ACESSO,
    CONFIGURACOES: NIVEIS.SEM_ACESSO,
  },
};

// ── Permissões Cérebro por perfil ─────────────────────────────────────────────
const CEREBRO_PERMISSOES_PADRAO = {
  MASTER:        { visualizar:true, criar:true, editar:true, solicitarAprovacao:true, aprovar:true, inativar:true, criarRegra:true, editarRegra:true, criarMatriz:true, editarMatriz:true, gerenciarFaq:true, gerenciarProcedimentos:true, visualizarPadroes:true, validarPadroes:true, visualizarAprendizado:true },
  GESTOR_SAC:    { visualizar:true, criar:true, editar:true, solicitarAprovacao:true, aprovar:true, inativar:true, criarRegra:true, editarRegra:true, criarMatriz:true, editarMatriz:true, gerenciarFaq:true, gerenciarProcedimentos:true, visualizarPadroes:true, validarPadroes:true, visualizarAprendizado:true },
  ANALISTA_SAC:  { visualizar:true, criar:true, editar:true, solicitarAprovacao:true, aprovar:false, inativar:false, criarRegra:false, editarRegra:false, criarMatriz:false, editarMatriz:false, gerenciarFaq:true, gerenciarProcedimentos:true, visualizarPadroes:true, validarPadroes:false, visualizarAprendizado:true },
  APROVADOR:     { visualizar:true, criar:false, editar:false, solicitarAprovacao:false, aprovar:true, inativar:false, criarRegra:false, editarRegra:false, criarMatriz:false, editarMatriz:false, gerenciarFaq:false, gerenciarProcedimentos:false, visualizarPadroes:true, validarPadroes:true, visualizarAprendizado:false },
  REPRESENTANTE: { visualizar:true, criar:false, editar:false, solicitarAprovacao:false, aprovar:false, inativar:false, criarRegra:false, editarRegra:false, criarMatriz:false, editarMatriz:false, gerenciarFaq:false, gerenciarProcedimentos:false, visualizarPadroes:false, validarPadroes:false, visualizarAprendizado:false },
  CONSULTA:      { visualizar:true, criar:false, editar:false, solicitarAprovacao:false, aprovar:false, inativar:false, criarRegra:false, editarRegra:false, criarMatriz:false, editarMatriz:false, gerenciarFaq:false, gerenciarProcedimentos:false, visualizarPadroes:false, validarPadroes:false, visualizarAprendizado:false },
  AUDITOR:       { visualizar:true, criar:false, editar:false, solicitarAprovacao:false, aprovar:false, inativar:false, criarRegra:false, editarRegra:false, criarMatriz:false, editarMatriz:false, gerenciarFaq:false, gerenciarProcedimentos:false, visualizarPadroes:true, validarPadroes:false, visualizarAprendizado:true },
};

/**
 * Normaliza perfil para chave canônica deste serviço.
 * Suporta os perfis legados do sistema atual.
 */
function normalizarPerfil(perfil) {
  const p = String(perfil || '').toUpperCase().trim().replace(/\s+/g, '_');
  const mapa = {
    'MASTER': 'MASTER',
    'GESTOR_SAC': 'GESTOR_SAC', 'ANALISTA_SAC': 'ANALISTA_SAC',
    // Perfis legados → novo
    'ANALISTA': 'ANALISTA_SAC', 'ANALISTA_SAC_LEGADO': 'ANALISTA_SAC',
    'SETOR_RESPONSÁVEL': 'REPRESENTANTE', 'SETOR_RESPONSAVEL': 'REPRESENTANTE',
    'RCA_/_REPRESENTANTE': 'REPRESENTANTE', 'RCA': 'REPRESENTANTE',
    'REPRESENTANTE': 'REPRESENTANTE', 'REPRESENTANTE_COMERCIAL': 'REPRESENTANTE',
    'GESTOR': 'GESTOR_SAC', 'GESTOR_SAC': 'GESTOR_SAC',
    'APROVADOR': 'APROVADOR',
    'CONSULTA': 'CONSULTA',
    'AUDITOR': 'AUDITOR',
  };
  return mapa[p] || p;
}

/**
 * Resolve as permissões de um usuário para um módulo.
 * Prioridade: permissão individual (PERMISSOES_USUARIO) > padrão do perfil.
 */
function resolverNivelModulo(perfil, modulo, permissoesIndividuais) {
  const perfilNorm = normalizarPerfil(perfil);
  if (perfilNorm === 'MASTER') return NIVEIS.MASTER;

  if (permissoesIndividuais) {
    const chave = `${modulo}`;
    if (permissoesIndividuais[chave] !== undefined) {
      const n = Number(permissoesIndividuais[chave]);
      if (!isNaN(n)) return n;
    }
  }

  const padrao = PERMISSOES_PADRAO_PERFIL[perfilNorm];
  if (padrao && padrao[modulo] !== undefined) return padrao[modulo];
  return NIVEIS.SEM_ACESSO;
}

/**
 * Verifica se usuário tem competência de aprovação para o item.
 */
function temCompetencia(competenciasUsuario, competenciaRequerida) {
  if (!competenciasUsuario) return false;
  const lista = Array.isArray(competenciasUsuario)
    ? competenciasUsuario
    : String(competenciasUsuario).split(',').map(c => c.trim().toUpperCase());
  return lista.includes(competenciaRequerida.toUpperCase());
}

module.exports = {
  PERFIS_VALIDOS,
  MODULOS_SISTEMA,
  NIVEIS,
  COMPETENCIAS_VALIDAS,
  PERMISSOES_PADRAO_PERFIL,
  CEREBRO_PERMISSOES_PADRAO,
  normalizarPerfil,
  resolverNivelModulo,
  temCompetencia,
};
