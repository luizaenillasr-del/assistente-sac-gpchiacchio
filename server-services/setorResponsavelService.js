'use strict';
// ================================================================
// SERVIÇO DE RESOLUÇÃO DE RESPONSÁVEL ATIVO DO SETOR — v1.0
// Implementa a cadeia de fallback:
//   RESPONSAVEL (CONFIG_SETORES) → SUBSTITUTO → GERENTES
// e notifica liderança quando criticidade exige.
// ================================================================

const sheets = require('./sheets');

/**
 * Verifica se um usuário está ativo na planilha USUARIOS.
 * Retorna o objeto do usuário ou null se inativo/ausente.
 */
async function buscarUsuarioAtivo(emailOuNome, lerAba) {
  if (!emailOuNome) return null;
  const fn = lerAba || sheets.lerAba;
  const usuarios = await fn('USUARIOS', 500).catch(() => []);
  const normalizar = v => String(v || '').toLowerCase().trim();
  const termo = normalizar(emailOuNome);
  return usuarios.find(u => {
    const ativo = normalizar(u.ATIVO || u.STATUS || '');
    if (['nao', 'inativo', 'inactive', '0', 'false'].includes(ativo)) return false;
    return normalizar(u.EMAIL || '') === termo || normalizar(u.NOME || '') === termo;
  }) || null;
}

/**
 * Busca o gerente do setor na planilha GERENTES.
 * Filtra por empresa quando informada.
 */
async function buscarGerenteSetor(setor, empresa, lerAba) {
  const fn = lerAba || sheets.lerAba;
  const gerentes = await fn('GERENTES', 200).catch(() => []);
  const norm = v => String(v || '').toLowerCase().trim();
  const setorNorm = norm(setor);
  const empNorm = norm(empresa);
  const candidatos = gerentes.filter(g => {
    const setorBate = !setorNorm || norm(g.SETOR || '').includes(setorNorm) || norm(g.SETOR || '') === '*';
    const empBate = !empNorm || norm(g.EMPRESA || '').includes(empNorm) || norm(g.EMPRESA || '') === '*';
    return setorBate && empBate;
  });
  if (!candidatos.length) return null;
  const g = candidatos[0];
  return {
    usuario: g.EMAIL || g.USUARIO || '',
    nome: g.NOME || '',
    email: g.EMAIL || '',
    perfil: g.PERFIL || 'GERENTE',
    fonte: 'GERENTE',
  };
}

/**
 * Resolve o responsável ativo do setor usando a cadeia de fallback:
 *   1. RESPONSAVEL em CONFIG_SETORES (se ativo em USUARIOS)
 *   2. SUBSTITUTO em CONFIG_SETORES (se ativo em USUARIOS)
 *   3. GERENTES do setor/empresa
 *
 * Retorna: { usuario, nome, email, perfil, fonte } ou null
 */
async function resolverResponsavelAtivo(setor, empresa, lerAba) {
  if (!setor) return null;
  const fn = lerAba || sheets.lerAba;

  // 1. Buscar configuração do setor
  const setores = await fn('CONFIG_SETORES', 200).catch(() => []);
  const norm = v => String(v || '').toLowerCase().trim();
  const setorNorm = norm(setor);
  const empNorm = norm(empresa);
  const config = setores.find(s =>
    norm(s.SETOR || '') === setorNorm &&
    (!empNorm || norm(s.EMPRESA || '') === empNorm || norm(s.EMPRESA || '') === '*')
  );

  if (config) {
    // Tentar RESPONSAVEL
    if (config.RESPONSAVEL) {
      const u = await buscarUsuarioAtivo(config.RESPONSAVEL, fn);
      if (u) {
        return {
          usuario: u.EMAIL || config.RESPONSAVEL,
          nome: u.NOME || config.RESPONSAVEL,
          email: u.EMAIL || '',
          perfil: u.PERFIL || 'ANALISTA',
          fonte: 'RESPONSAVEL',
        };
      }
    }
    // Tentar SUBSTITUTO
    if (config.SUBSTITUTO) {
      const u = await buscarUsuarioAtivo(config.SUBSTITUTO, fn);
      if (u) {
        return {
          usuario: u.EMAIL || config.SUBSTITUTO,
          nome: u.NOME || config.SUBSTITUTO,
          email: u.EMAIL || '',
          perfil: u.PERFIL || 'ANALISTA',
          fonte: 'SUBSTITUTO',
        };
      }
    }
  }

  // 3. Fallback: GERENTES
  const gerente = await buscarGerenteSetor(setor, empresa, fn);
  return gerente;
}

/**
 * Decide se a criticidade exige notificação de liderança.
 * Critério: prioridade ALTA/CRITICA ou SLA_HORAS < 24
 */
function exigeNotificacaoLideranca(criticidade = {}) {
  const p = String(criticidade.prioridade || '').toUpperCase();
  const sla = Number(criticidade.slaHoras);
  return ['ALTA', 'CRITICA', 'CRÍTICA'].includes(p) || (sla > 0 && sla < 24);
}

/**
 * Notifica gerentes/diretores responsáveis pelo setor.
 * Escreve em NOTIFICACOES_INTERNAS com tipo LIDERANCA.
 * Não bloqueia nem interrompe a tratativa.
 */
async function notificarLiderancaSetor({ manifestacaoId, protocolo, setor, empresa, criticidade, lerAba, appendObjeto }) {
  if (!exigeNotificacaoLideranca(criticidade)) return { notificado: false, motivo: 'criticidade_insuficiente' };

  const fn = lerAba || sheets.lerAba;
  const append = appendObjeto || sheets.appendObjeto;
  const gerente = await buscarGerenteSetor(setor, empresa, fn);
  if (!gerente || !gerente.email) return { notificado: false, motivo: 'gerente_nao_encontrado' };

  const notif = {
    ID_NOTIFICACAO: `NOTIF-LID-${manifestacaoId}-${Date.now()}`,
    ID_MANIFESTACAO: manifestacaoId,
    ID_ACIONAMENTO: '',
    DESTINATARIO: gerente.email,
    NOME_DESTINATARIO: gerente.nome,
    PERFIL_DESTINATARIO: gerente.perfil || 'GERENTE',
    TIPO: 'LIDERANCA',
    TITULO: `[Liderança] Manifestação ${protocolo || manifestacaoId} — ação requerida`,
    MENSAGEM: `Manifestação ${protocolo || manifestacaoId} direcionada ao setor ${setor} requer atenção da liderança. Prioridade: ${criticidade.prioridade || 'N/A'}. SLA: ${criticidade.slaHoras || 'N/A'}h.`,
    STATUS: 'PENDENTE',
    CRIADO_EM: new Date().toISOString(),
    EMPRESA: empresa || '',
    SETOR: setor || '',
  };

  await append('NOTIFICACOES_INTERNAS', notif);
  return { notificado: true, destinatario: gerente.email, fonte: gerente.fonte };
}

module.exports = {
  resolverResponsavelAtivo,
  notificarLiderancaSetor,
  buscarUsuarioAtivo,
  buscarGerenteSetor,
  exigeNotificacaoLideranca,
};
