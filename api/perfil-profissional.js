'use strict';

// O ID do usuário é a chave permanente. Cargo, competências e atividades são
// declarações; empresa, setor, perfil e alçadas vêm exclusivamente de USUARIOS.
const CAMPOS = ['nomeExibicao','cargoDeclarado','gestorImediato','telefoneCorporativo','descricaoFuncao','atividades','processos','entregas','setoresRelacionados','responsabilidades','decisoes','aprovacoesNecessarias','produtos','procedimentos','especialidades','sistemas','problemas','contribuicoes'];
const LISTAS = new Set(['atividades','processos','entregas','setoresRelacionados','responsabilidades','decisoes','aprovacoesNecessarias','produtos','procedimentos','especialidades','sistemas','problemas','contribuicoes']);
const limpar = v => String(v ?? '').trim().slice(0, 2000);
const normalizar = v => limpar(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\bsetor\s+/g,'').replace(/\s+/g,' ');
function lista(v) {
  const valores = Array.isArray(v) ? v : String(v ?? '').split(/[;,\n]/);
  return [...new Map(valores.map(limpar).filter(Boolean).map(x => [normalizar(x), x])).values()].slice(0, 30);
}
function declaracoes(body={}) {
  return Object.fromEntries(CAMPOS.map(k => [k, LISTAS.has(k) ? lista(body[k]) : limpar(body[k])]));
}
function valido(d) { return Boolean(d.descricaoFuncao && d.responsabilidades.length); }
function registroParaPerfil(row, usuario) {
  let d={};
  try { d=JSON.parse(row?.DADOS_JSON || '{}'); } catch (_) {}
  return {
    idUsuario: usuario.id, usuario: usuario.usuario, nomeOficial: usuario.nome,
    empresa: usuario.empresa, setor: usuario.setor, perfilAcesso: usuario.perfil,
    cargoOficial: usuario.cargo, email: usuario.email, codigoRCA: usuario.codigoRCA,
    ...declaracoes(d), status: row?.STATUS || 'PENDENTE', versao: Number(row?.VERSAO || 0),
    criadoEm: row?.CRIADO_EM || '', atualizadoEm: row?.ATUALIZADO_EM || '',
    origem: 'AUTODECLARADO', validacaoAdministrativa: row?.VALIDACAO_ADMIN || 'PENDENTE',
  };
}
function escopoEmpresa(perfil, empresa) {
  if (normalizar(perfil.empresa)==='grupo chiacchio') return true;
  return String(perfil.empresa||'').split(',').some(e => normalizar(e) === normalizar(empresa));
}
function especialistas(perfis, contexto={}, limite=5) {
  const termos = lista([contexto.produto, contexto.processo, contexto.tipo, contexto.categoria, contexto.descricao])
    .flatMap(x => normalizar(x).split(/[^a-z0-9]+/)).filter(x => x.length >= 4);
  if (!termos.length) return [];
  return perfis.filter(p => p.status==='CONCLUIDO' && p.ativo !== false && (!contexto.empresa || escopoEmpresa(p, contexto.empresa)))
    .map(p => {
      const campos = [p.processos,p.produtos,p.especialidades,p.problemas,p.contribuicoes,p.atividades,p.descricaoFuncao].flat().map(normalizar);
      const encontrados = [...new Set(termos.filter(t => campos.some(c => c.includes(t))))];
      return {idUsuario:p.idUsuario,nome:p.nomeOficial,setor:p.setor,empresa:p.empresa,termos:encontrados,pontos:encontrados.length};
    }).filter(p=>p.pontos).sort((a,b)=>b.pontos-a.pontos).slice(0,limite);
}
module.exports = { CAMPOS, declaracoes, valido, registroParaPerfil, especialistas, normalizar };
