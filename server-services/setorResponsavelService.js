'use strict';
// ================================================================
// SERVIÇO DE RESOLUÇÃO DE RESPONSÁVEL ATIVO DO SETOR — v1.1
// Cadeia de fallback: RESPONSAVEL (CONFIG_SETORES) → SUBSTITUTO
// Gerente só assume quando formalmente configurado no CONFIG_SETORES.
// Notificação de liderança: TODAS as manifestações encaminhadas.
// ALTA/CRITICA gera notificação adicional de escalada.
// ================================================================

const sheets = require('./sheets');

/**
 * Verifica se um usuário está ativo na planilha USUARIOS.
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
 * Busca gerentes do setor na planilha GERENTES (para notificação).
 * Retorna lista (pode haver mais de um gerente por setor).
 */
async function buscarGerentesSetor(setor, empresa, lerAba) {
  const fn = lerAba || sheets.lerAba;
  const gerentes = await fn('GERENTES', 200).catch(() => []);
  const norm = v => String(v || '').toLowerCase().trim();
  const setorNorm = norm(setor);
  const empNorm = norm(empresa);
  return gerentes.filter(g => {
    const setorBate = !setorNorm || norm(g.SETOR || '').includes(setorNorm) || norm(g.SETOR || '') === '*';
    const empBate = !empNorm || norm(g.EMPRESA || '').includes(empNorm) || norm(g.EMPRESA || '') === '*';
    return setorBate && empBate;
  }).map(g => ({
    usuario: g.EMAIL || g.USUARIO || '',
    nome: g.NOME || '',
    email: g.EMAIL || '',
    perfil: g.PERFIL || 'GERENTE',
    fonte: 'GERENTE',
  }));
}

/**
 * buscarGerenteSetor — retorna o primeiro gerente (compatibilidade).
 */
async function buscarGerenteSetor(setor, empresa, lerAba) {
  const lista = await buscarGerentesSetor(setor, empresa, lerAba);
  return lista.length ? lista[0] : null;
}

/**
 * Resolve o responsável ativo do setor:
 *   1. RESPONSAVEL em CONFIG_SETORES (se ativo em USUARIOS)
 *   2. SUBSTITUTO em CONFIG_SETORES (se ativo em USUARIOS)
 *
 * O gerente NÃO assume automaticamente por ausência. Só é retornado
 * quando estiver formalmente listado como RESPONSAVEL ou SUBSTITUTO
 * em CONFIG_SETORES.
 *
 * Retorna: { usuario, nome, email, perfil, fonte } ou null
 */
async function resolverResponsavelAtivo(setor, empresa, lerAba) {
  if (!setor) return null;
  const fn = lerAba || sheets.lerAba;

  const setores = await fn('CONFIG_SETORES', 200).catch(() => []);
  const norm = v => String(v || '').toLowerCase().trim();
  const setorNorm = norm(setor);
  const empNorm = norm(empresa);
  const config = setores.find(s =>
    norm(s.SETOR || '') === setorNorm &&
    (!empNorm || norm(s.EMPRESA || '') === empNorm || norm(s.EMPRESA || '') === '*')
  );

  if (!config) return null;

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

  // Sem responsável ativo configurado — retorna null.
  // O gerente só assume quando formalmente configurado no CONFIG_SETORES.
  return null;
}

/**
 * Decide se a criticidade exige notificação de ESCALADA (nível adicional).
 * Critério: prioridade ALTA/CRITICA ou SLA_HORAS < 24
 */
function exigeNotificacaoLideranca(criticidade = {}) {
  const p = String(criticidade.prioridade || '').toUpperCase();
  const sla = Number(criticidade.slaHoras);
  return ['ALTA', 'CRITICA', 'CRÍTICA'].includes(p) || (sla > 0 && sla < 24);
}

/**
 * Notifica gerentes/diretores responsáveis pelo setor.
 *
 * Regra:
 *   - TODAS as manifestações encaminhadas geram notificação básica (TIPO='LIDERANCA').
 *   - Criticidade ALTA/CRITICA ou SLA < 24h geram notificação adicional de escalada
 *     (TIPO='LIDERANCA_ESCALADA').
 *
 * Não bloqueia nem interrompe a tratativa.
 */
async function notificarLiderancaSetor({ manifestacaoId, protocolo, setor, empresa, criticidade, lerAba, appendObjeto }) {
  const fn = lerAba || sheets.lerAba;
  const append = appendObjeto || sheets.appendObjeto;

  const gerentes = await buscarGerentesSetor(setor, empresa, fn);
  if (!gerentes.length) return { notificado: false, motivo: 'gerente_nao_encontrado' };

  const agora = new Date().toISOString();
  const prio = (criticidade && criticidade.prioridade) || 'N/A';
  const slaH = (criticidade && criticidade.slaHoras) || 'N/A';
  const escalada = exigeNotificacaoLideranca(criticidade || {});

  const notifs = [];
  for (const gerente of gerentes) {
    if (!gerente.email) continue;

    const notif = {
      ID_NOTIFICACAO: `NOTIF-LID-${manifestacaoId}-${Date.now()}-${gerente.email.replace(/\W/g, '')}`,
      ID_MANIFESTACAO: manifestacaoId,
      ID_ACIONAMENTO: '',
      DESTINATARIO: gerente.email,
      NOME_DESTINATARIO: gerente.nome,
      PERFIL_DESTINATARIO: gerente.perfil || 'GERENTE',
      TIPO: 'LIDERANCA',
      TITULO: `[Liderança] Manifestação ${protocolo || manifestacaoId} encaminhada ao setor ${setor}`,
      MENSAGEM: `Manifestação ${protocolo || manifestacaoId} foi encaminhada ao setor ${setor}. Prioridade: ${prio}. SLA: ${slaH}h.`,
      STATUS: 'PENDENTE',
      CRIADO_EM: agora,
      EMPRESA: empresa || '',
      SETOR: setor || '',
    };
    await append('NOTIFICACOES_INTERNAS', notif);
    notifs.push(notif);

    if (escalada) {
      const escNotif = Object.assign({}, notif, {
        ID_NOTIFICACAO: `NOTIF-ESC-${manifestacaoId}-${Date.now()}-${gerente.email.replace(/\W/g, '')}`,
        TIPO: 'LIDERANCA_ESCALADA',
        TITULO: `[ESCALADA] Manifestação ${protocolo || manifestacaoId} — prioridade ${prio}`,
        MENSAGEM: `ATENÇÃO — Manifestação ${protocolo || manifestacaoId} com prioridade ${prio} e SLA de ${slaH}h encaminhada ao setor ${setor}. Requer acompanhamento imediato da liderança.`,
      });
      await append('NOTIFICACOES_INTERNAS', escNotif);
      notifs.push(escNotif);
    }
  }

  if (!notifs.length) return { notificado: false, motivo: 'gerente_sem_email' };
  return { notificado: true, total: notifs.length, escalada, destinatarios: gerentes.map(g => g.email) };
}

module.exports = {
  resolverResponsavelAtivo,
  notificarLiderancaSetor,
  buscarUsuarioAtivo,
  buscarGerenteSetor,
  buscarGerentesSetor,
  exigeNotificacaoLideranca,
};
