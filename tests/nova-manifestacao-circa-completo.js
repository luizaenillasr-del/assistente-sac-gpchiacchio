'use strict';
// Testes: Nova Manifestacao - fluxo completo
// Requisitos 2, 3, 4, 6 e 8

var assert = require('assert');
var path = require('path');
var fs = require('fs');

var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
var apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf-8');
var setorSvc = require('../server-services/setorResponsavelService');

// 1. HTML: estrutura etapa 4 com painel CIRCA (req 2)
assert.ok(html.includes('data-nm-step="4"'), 'etapa 4 deve existir no HTML');
assert.ok(html.includes('nm-circa-investigacao-panel'), 'painel CIRCA de investigacao deve existir na etapa 4');
assert.ok(html.includes('nm-circa-inv-perguntas'), 'div de perguntas CIRCA deve existir na etapa 4');
assert.ok(html.includes('nm-circa-inv-similares'), 'div de casos similares CIRCA deve existir na etapa 4');
assert.ok(html.includes('nm-circa-inv-tratativa'), 'div de tratativa CIRCA deve existir na etapa 4');
assert.ok(html.includes('nm-btn-enviar-validacao'), 'botao enviar-para-validacao-SAC deve existir na etapa 4');
assert.ok(html.includes('nmEnviarParaValidacaoSAC'), 'funcao nmEnviarParaValidacaoSAC deve estar definida');
assert.ok(html.includes('nmRenderizarCircaInvestigacao'), 'funcao nmRenderizarCircaInvestigacao deve estar definida');
assert.ok(html.includes('n === 4'), 'navegacao para etapa 4 deve disparar nmRenderizarCircaInvestigacao');

// 2. HTML: etapa 5 com botao validacao SAC (req 6)
var step5Start = html.indexOf('data-nm-step="5"');
var step6Start = html.indexOf('data-nm-step="6"');
assert.ok(step5Start > 0 && step6Start > step5Start, 'etapas 5 e 6 devem existir em ordem');
var step5Html = html.slice(step5Start, step6Start);
assert.ok(step5Html.includes('nmEnviarParaValidacaoSAC'), 'etapa 5 deve ter botao de validacao SAC');

// 3. API: rotas de comentarios de lideranca (req 4)
assert.ok(apiSrc.includes('/lideranca/comentarios'), 'rota /lideranca/comentarios deve existir na API');
var liderancaCount = (apiSrc.match(/\/lideranca\/comentarios/g) || []).length;
assert.ok(liderancaCount >= 2, 'rota /lideranca/comentarios deve aparecer ao menos 2 vezes (GET e POST)');
assert.ok(apiSrc.includes("'OBSERVACAO'") || apiSrc.includes('"OBSERVACAO"'), 'tipo OBSERVACAO deve existir');
assert.ok(apiSrc.includes("'SUGESTAO'") || apiSrc.includes('"SUGESTAO"'), 'tipo SUGESTAO deve existir');
assert.ok(apiSrc.includes("'INTERVENCAO'") || apiSrc.includes('"INTERVENCAO"'), 'tipo INTERVENCAO deve existir');

// 4. API: notificacao de lideranca no acionamento (req 4)
assert.ok(apiSrc.includes("require('../server-services/setorResponsavelService')"), 'setorResponsavelService deve ser importado');
assert.ok(apiSrc.includes('notificarLiderancaSetor'), 'notificarLiderancaSetor deve ser chamada na API');

// 5. setorResponsavelService: exports (req 3 e 4)
var svcExports = Object.keys(setorSvc);
assert.ok(svcExports.includes('resolverResponsavelAtivo'), 'deve exportar resolverResponsavelAtivo');
assert.ok(svcExports.includes('notificarLiderancaSetor'), 'deve exportar notificarLiderancaSetor');
assert.ok(svcExports.includes('exigeNotificacaoLideranca'), 'deve exportar exigeNotificacaoLideranca');
assert.ok(svcExports.includes('buscarUsuarioAtivo'), 'deve exportar buscarUsuarioAtivo');
assert.ok(svcExports.includes('buscarGerenteSetor'), 'deve exportar buscarGerenteSetor');

// 6. exigeNotificacaoLideranca: logica de criticidade (req 4)
assert.ok(setorSvc.exigeNotificacaoLideranca({ prioridade: 'ALTA', slaHoras: 72 }) === true, 'ALTA deve exigir notificacao');
assert.ok(setorSvc.exigeNotificacaoLideranca({ prioridade: 'CRITICA' }) === true, 'CRITICA deve exigir notificacao');
assert.ok(setorSvc.exigeNotificacaoLideranca({ prioridade: 'NORMAL', slaHoras: 12 }) === true, 'SLA < 24h deve exigir notificacao');
assert.ok(setorSvc.exigeNotificacaoLideranca({ prioridade: 'NORMAL', slaHoras: 48 }) === false, 'NORMAL + SLA>=24h nao deve exigir');
assert.ok(setorSvc.exigeNotificacaoLideranca({}) === false, 'criticidade vazia nao deve exigir notificacao');

// 7 e 8: testes async (resolverResponsavelAtivo e notificarLiderancaSetor)
function makeDb(setores, usuarios, gerentes) {
  gerentes = gerentes || [];
  return function(aba) {
    if (aba === 'CONFIG_SETORES') return Promise.resolve(setores);
    if (aba === 'USUARIOS') return Promise.resolve(usuarios);
    if (aba === 'GERENTES') return Promise.resolve(gerentes);
    return Promise.resolve([]);
  };
}

function runAsyncTests() {
  var p1 = setorSvc.resolverResponsavelAtivo('Qualidade', 'EmpA', makeDb(
    [{ SETOR:'qualidade', EMPRESA:'empa', RESPONSAVEL:'ana@empresa.com', SUBSTITUTO:'' }],
    [{ EMAIL:'ana@empresa.com', NOME:'Ana', PERFIL:'ANALISTA', ATIVO:'SIM' }]
  )).then(function(r) {
    assert.ok(r && r.fonte === 'RESPONSAVEL', 'deve retornar fonte RESPONSAVEL quando ativo');
    assert.ok(r.email === 'ana@empresa.com', 'deve retornar email correto do RESPONSAVEL');
  });

  var p2 = setorSvc.resolverResponsavelAtivo('Qualidade', 'EmpA', makeDb(
    [{ SETOR:'qualidade', EMPRESA:'empa', RESPONSAVEL:'inativo@empresa.com', SUBSTITUTO:'sub@empresa.com' }],
    [
      { EMAIL:'inativo@empresa.com', NOME:'Inativo', PERFIL:'ANALISTA', ATIVO:'NAO' },
      { EMAIL:'sub@empresa.com', NOME:'Sub', PERFIL:'ANALISTA', ATIVO:'SIM' }
    ]
  )).then(function(r) {
    assert.ok(r && r.fonte === 'SUBSTITUTO', 'deve cair para SUBSTITUTO quando RESPONSAVEL inativo');
  });

  var p3 = setorSvc.resolverResponsavelAtivo('Qualidade', 'EmpA', makeDb(
    [{ SETOR:'qualidade', EMPRESA:'empa', RESPONSAVEL:'x@a.com', SUBSTITUTO:'y@a.com' }],
    [{ EMAIL:'x@a.com', ATIVO:'NAO' }, { EMAIL:'y@a.com', ATIVO:'NAO' }],
    [{ SETOR:'qualidade', EMPRESA:'empa', EMAIL:'gerente@empresa.com', NOME:'Gerente', PERFIL:'GERENTE' }]
  )).then(function(r) {
    assert.ok(r && r.fonte === 'GERENTE', 'deve cair para GERENTES quando ambos inativos');
  });

  var p4 = setorSvc.resolverResponsavelAtivo('Inexistente', 'EmpA', makeDb([], [])).then(function(r) {
    assert.ok(r === null, 'deve retornar null quando setor nao existe');
  });

  var written = [];
  var p5 = setorSvc.notificarLiderancaSetor({
    manifestacaoId: 'MAN-001', protocolo: 'SAC-001',
    setor: 'Logistica', empresa: 'EmpA',
    criticidade: { prioridade: 'ALTA', slaHoras: 48 },
    lerAba: function(aba) {
      if (aba === 'GERENTES') return Promise.resolve([{ SETOR:'logistica', EMPRESA:'empa', EMAIL:'ger@empresa.com', NOME:'Gerente', PERFIL:'GERENTE' }]);
      return Promise.resolve([]);
    },
    appendObjeto: function(aba, row) { written.push({ aba: aba, row: row }); return Promise.resolve(); }
  }).then(function(result) {
    assert.ok(result.notificado === true, 'deve notificar quando criticidade alta');
    assert.ok(written.length === 1, 'deve escrever exatamente 1 registro');
    assert.ok(written[0].aba === 'NOTIFICACOES_INTERNAS', 'deve escrever na aba NOTIFICACOES_INTERNAS');
    assert.ok(written[0].row.TIPO === 'LIDERANCA', 'tipo deve ser LIDERANCA');
    assert.ok(written[0].row.DESTINATARIO === 'ger@empresa.com', 'destinatario deve ser o gerente');
  });

  var written2 = [];
  var p6 = setorSvc.notificarLiderancaSetor({
    manifestacaoId: 'MAN-002', protocolo: 'SAC-002',
    setor: 'Logistica', empresa: 'EmpA',
    criticidade: { prioridade: 'NORMAL', slaHoras: 72 },
    lerAba: function() { return Promise.resolve([]); },
    appendObjeto: function(_, row) { written2.push(row); return Promise.resolve(); }
  }).then(function(result) {
    assert.ok(result.notificado === false, 'nao deve notificar quando criticidade insuficiente');
    assert.ok(written2.length === 0, 'nao deve escrever registro quando criticidade insuficiente');
  });

  return Promise.all([p1, p2, p3, p4, p5, p6]);
}

runAsyncTests().then(function() {
  console.log('Nova manifestacao CIRCA completo: estrutura etapa 4, CIRCA investigacao, botao validacao SAC, rotas lideranca, cadeia responsavel ativo, notificacao lideranca aprovados.');
}).catch(function(e) { console.error(e); process.exit(1); });
