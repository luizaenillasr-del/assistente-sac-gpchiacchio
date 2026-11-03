'use strict';

// Modelo funcional novo, mantido separado dos aliases legados para que
// históricos e sessões antigas continuem legíveis durante a transição.
const PERFIS_FUNCIONAIS = Object.freeze({
  MASTER: 'MASTER',
  SAC: 'SAC',
  APROVADOR_SETORIAL: 'APROVADOR_SETORIAL',
  DIRETORIA_GESTOR: 'DIRETORIA_GESTOR',
});

const NIVEIS_HIERARQUICOS = Object.freeze(['COLABORADOR','SUPERVISOR','GERENTE','DIRETOR']);

const LEGADOS = new Map([
  ['MASTER', 'MASTER'], ['ADMINISTRADOR', 'MASTER'],
  ['GESTOR SAC', 'SAC'], ['ANALISTA SAC', 'SAC'], ['ATENDENTE SAC', 'SAC'], ['SAC', 'SAC'],
  ['APROVADOR', 'APROVADOR_SETORIAL'], ['SETOR RESPONSÁVEL', 'APROVADOR_SETORIAL'],
  ['ESPECIALISTA', 'APROVADOR_SETORIAL'], ['APROVADOR SETORIAL', 'APROVADOR_SETORIAL'],
  ['DIRETOR', 'DIRETORIA_GESTOR'], ['APROVADOR MASTER', 'DIRETORIA_GESTOR'],
]);

function texto(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().replace(/\s+/g, ' ').toUpperCase();
}

function perfilFuncional(valor, legado = '') {
  const direto = texto(valor);
  if (Object.values(PERFIS_FUNCIONAIS).includes(direto)) return direto;
  const antigo = texto(legado || valor);
  if (LEGADOS.has(antigo)) return LEGADOS.get(antigo);
  if (antigo.startsWith('SETOR ')) return PERFIS_FUNCIONAIS.APROVADOR_SETORIAL;
  return '';
}

function nivelHierarquico(valor) {
  const n = texto(valor);
  return NIVEIS_HIERARQUICOS.includes(n) ? n : '';
}

function listaEscopo(valor) {
  if (Array.isArray(valor)) return valor.flatMap(listaEscopo);
  if (valor && typeof valor === 'object') return Object.values(valor).flatMap(listaEscopo);
  const s = String(valor ?? '').trim();
  if (!s) return [];
  try { const parsed = JSON.parse(s); if (parsed !== valor) return listaEscopo(parsed); } catch (_) {}
  return s.split(/[;,|\n]+/).map(x => x.trim()).filter(Boolean);
}

function alcadas(valor) {
  return [...new Set(listaEscopo(valor).map(texto).filter(Boolean))];
}

function usuarioAutorizadoParaTratativa(usuario = {}) {
  if (texto(usuario.STATUS || usuario.status || 'ATIVO') !== 'ATIVO') return false;
  const p = perfilFuncional(usuario.PERFIL_FUNCIONAL || usuario.perfilFuncional, usuario.PERFIL || usuario.perfil);
  return [PERFIS_FUNCIONAIS.MASTER, PERFIS_FUNCIONAIS.SAC, PERFIS_FUNCIONAIS.APROVADOR_SETORIAL, PERFIS_FUNCIONAIS.DIRETORIA_GESTOR].includes(p);
}

function escopoContem(usuario, empresa, setor, normalizarEmpresa = texto, normalizarSetor = texto) {
  const empresas = listaEscopo(usuario.EMPRESAS || usuario.EMPRESA || usuario.empresas).map(normalizarEmpresa);
  const setores = listaEscopo(usuario.SETORES || usuario.SETOR || usuario.setores).map(normalizarSetor);
  const e = normalizarEmpresa(empresa || '');
  const s = normalizarSetor(setor || '');
  const empresaOk = !e || empresas.includes('MASTER') || empresas.includes(e) || !empresas.length;
  const setorOk = !s || setores.some(x => x === s || x.includes(s) || s.includes(x));
  return empresaOk && setorOk;
}

module.exports = { PERFIS_FUNCIONAIS, NIVEIS_HIERARQUICOS, perfilFuncional, nivelHierarquico, listaEscopo, alcadas, usuarioAutorizadoParaTratativa, escopoContem };
