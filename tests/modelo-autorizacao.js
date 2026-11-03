'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const modelo = require('../server-services/modeloAutorizacao');

assert.equal(modelo.perfilFuncional('MASTER'), 'MASTER');
assert.equal(modelo.perfilFuncional('', 'ANALISTA SAC'), 'SAC');
assert.equal(modelo.perfilFuncional('', 'SETOR LOGISTICA'), 'APROVADOR_SETORIAL');
assert.equal(modelo.perfilFuncional('', 'DIRETOR'), 'DIRETORIA_GESTOR');
assert.equal(modelo.nivelHierarquico('Supervisor'), 'SUPERVISOR');
assert.equal(modelo.nivelHierarquico('vice-presidente'), '');
assert.deepEqual(modelo.listaEscopo('["Chiacchio Embalagens","Plaschio"]'), ['Chiacchio Embalagens','Plaschio']);
assert.deepEqual(modelo.alcadas(['aprovar RNC', 'aprovar RNC']), ['APROVAR RNC']);

const larissa = {
  STATUS: 'ATIVO', PERFIL_FUNCIONAL: 'SAC', EMPRESA: 'Chiacchio Embalagens', SETOR: 'SAC',
};
assert.equal(modelo.usuarioAutorizadoParaTratativa(larissa), true, 'SAC ativo pode conduzir/encaminhar');
assert.equal(modelo.escopoContem(larissa, 'Chiacchio Embalagens', 'SAC'), true);

const karol = {
  STATUS: 'ATIVO', PERFIL_FUNCIONAL: 'APROVADOR_SETORIAL', NIVEL_HIERARQUICO: 'SUPERVISOR',
  EMPRESAS: ['Chiacchio Embalagens', 'Plaschio', 'Tubahia'], SETORES: ['Logística'],
  COMPETENCIAS_ALCADAS: ['investigar', 'responder'],
};
assert.equal(modelo.usuarioAutorizadoParaTratativa(karol), true);
assert.equal(modelo.escopoContem(karol, 'Plaschio', 'Logística'), true);
assert.equal(modelo.escopoContem(karol, 'Tubahia', 'Qualidade'), false, 'setor fora do escopo é bloqueado');
assert.equal(modelo.escopoContem(karol, 'Outra empresa', 'Logística'), false, 'empresa fora do escopo é bloqueada');
assert.equal(modelo.usuarioAutorizadoParaTratativa({ ...karol, STATUS: 'INATIVO' }), false);

const api = fs.readFileSync('api/index.js', 'utf8');
assert.match(api, /PERFIL_FUNCIONAL/);
assert.match(api, /NIVEL_HIERARQUICO/);
assert.match(api, /COMPETENCIAS_ALCADAS/);
assert.match(api, /PERFIL_INVALIDO/);
assert.match(api, /PERFIL_NAO_PERSISTIDO/);
assert.match(api, /findPerfilByCodigo/);
assert.match(api, /usuarioAutorizadoParaTratativa/);

console.log('MODELO DE AUTORIZAÇÃO: perfis funcionais, legado, hierarquia, escopo e elegibilidade aprovados.');
