'use strict';

// Regressão isolada do contrato Nova Manifestação → Cérebro/CIRCA. Nenhuma
// planilha, banco, Drive ou serviço de IA real é usado neste teste.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

const { analisar, missingFields, classificarHipoteses } = require('../server-services/circaEngine');
const { alertaProduto, classificacaoTipos, filtrarColetas } = require('../server-services/etapa2Validacao');
const { buildChecklist } = require('../server-services/circaWorkflow');
const cerebro = require('../server-services/cerebroServices');
const sheets = require('../server-services/sheets');

const manifestacao = {
  empresaReclamada: 'PLASCHIO',
  empresaReclamante: 'Cliente de teste',
  canal: 'TELEFONE',
  tipo: 'Reclamação',
  produto: 'Potes',
  lote: '123',
  nfe: '3215',
  descricao: 'Atraso de três dias na entrega e aproximadamente 1.200 potes com dificuldade de encaixe das tampas.',
};

assert.deepEqual(missingFields(manifestacao), [], 'aliases do formulário não podem aparecer como campos ausentes');
assert.deepEqual(classificarHipoteses(manifestacao).map(h => h.codigo), ['ATRASO_LOGISTICO', 'NAO_CONFORMIDADE_PRODUTO']);
assert.ok(classificarHipoteses(manifestacao).every(h => h.confirmada === false), 'classificação textual permanece hipótese');
assert.equal(alertaProduto('Pote plástico com tampa', 'Recebemos potes, tampas e embalagens plásticas.'), null, 'termos equivalentes não geram divergência');
assert.equal(alertaProduto('sacola', manifestacao.descricao).requerValidacaoHumana, true, 'produto divergente exige validação humana');
assert.equal(classificacaoTipos('Relato sem termos cadastrados', [{ ID_TIPO: 'X', TIPO: 'Conversão', PALAVRAS_CHAVE: 'aba, colado', ATIVO: 'SIM' }]).status, 'NAO_IDENTIFICADO');
assert.deepEqual(filtrarColetas([{ descricao: 'Coletar NF, lote ou foto como evidência' }], { NFE: 'NF-1', ANEXOS: '[foto]' }).map(x => x.descricao), ['Solicitar o número do lote ao cliente e registrar a evidência.'], 'coleta parcial vira instrução operacional');
assert.match(filtrarColetas([{ descricao: 'Coletar NF, lote ou foto como evidência' }], {}).at(0).descricao, /número da nota fiscal.*lote.*foto/i, 'coleta completa deve ser uma instrução clara');
const checklistA = buildChecklist([{ descricao: 'Confirmar causa com evidência' }]);
const checklistB = buildChecklist([{ descricao: 'Confirmar causa com evidência' }]);
assert.equal(checklistA[0].id, checklistB[0].id, 'checklist mantém ID estável entre reanálises');
const checklistComPrazo = buildChecklist([{ descricao: 'Confirmar causa com evidência', prazoHoras: 72, vencimento: '2026-10-30T12:00:00.000Z' }]);
assert.equal(checklistComPrazo[0].prazo, '72h');
assert.equal(checklistComPrazo[0].vencimento, '2026-10-30T12:00:00.000Z');

const semRegra = analisar({
  manifestacao,
  categoriasDisponiveis: [{ categoria: 'Qualidade', subcategorias: ['Defeito de produto'] }],
  tratamentos: [
    { ID_REGRA: '', STATUS: 'APROVADO', SETOR_RESPONSAVEL: '', PROCEDIMENTO: '' },
    { ID_REGRA: 'INAT-1', STATUS: 'INATIVO', SETOR_RESPONSAVEL: 'Qualidade', PROCEDIMENTO: 'Não usar' },
  ],
});
assert.deepEqual(semRegra.analiseEstruturada.informacoesAusentes, ['CATEGORIA'], 'somente a categoria realmente ausente deve permanecer pendente');
assert.equal(semRegra.analiseEstruturada.procedimentosAplicaveis.length, 0, 'regra sem identidade/inativa não pode ser recomendada');
assert.deepEqual(semRegra.analiseEstruturada.setoresRecomendados, [], 'setor não pode ser extraído diretamente de palavras do relato');
assert.equal(semRegra.hipotesesClassificacao.length, 2);
assert.equal(semRegra.analiseEstruturada.classificacaoStatus, 'PENDENTE_VALIDACAO');
assert.equal(semRegra.analiseEstruturada.alertaProduto, null, 'produto equivalente não gera pendência');
assert.equal(semRegra.checklist.find(x => /Confirmar causa/.test(x.descricao)).prazo, '', 'confirmação de causa não recebe 72h artificial');
assert.ok(Array.isArray(semRegra.analiseEstruturada.procedimentosDetalhados), 'procedimentos expõem rastreabilidade estruturada');

const multiproblema = analisar({ manifestacao: {
  ...manifestacao,
  descricao: 'Recebemos quantidade inferior à solicitada, potes com defeito e atraso de quatro dias na entrega.',
} });
assert.deepEqual(multiproblema.problemasRelatados.map(p => p.codigo), ['DIVERGENCIA_QUANTIDADE', 'ATRASO_LOGISTICO', 'NAO_CONFORMIDADE_PRODUTO']);
assert.ok(multiproblema.problemasRelatados.every(p => p.causa.status === 'HIPOTESE' && p.confirmada === false));
assert.ok(multiproblema.problemasRelatados.every(p => p.validacaoHumana === 'PENDENTE'));

const relatoSacolas = analisar({ manifestacao: {
  ...manifestacao,
  descricao: 'Cliente informa sacolas com espessura inferior à especificada e unidades que rasgam durante o uso.',
} });
assert.deepEqual(relatoSacolas.problemasRelatados.map(p => p.codigo), ['NAO_CONFORMIDADE_PRODUTO'], '"unidades" isolado não deve ser confundido com divergência quantitativa');

const semComplementacao = { ...manifestacao, CANAL: '', canal: '', CATEGORIA: '', SUBCATEGORIA: '' };
const complementada = analisar({
  manifestacao: semComplementacao,
  complementacoes: {
    CANAL: { status: 'PREENCHIDA', valor: 'TELEFONE' },
    CATEGORIA: { status: 'PREENCHIDA', valor: 'Qualidade' },
    SUBCATEGORIA: { status: 'PREENCHIDA', valor: 'Defeito de produto' },
    QUANTIDADE: { status: 'PREENCHIDA', valor: 1200, unidade: 'unidades' },
  },
});
assert.ok(!complementada.analiseEstruturada.informacoesAusentes.includes('CATEGORIA'), 'categoria preenchida na complementação deve sair das pendências');
assert.ok(!complementada.analiseEstruturada.informacoesAusentes.includes('SUBCATEGORIA'), 'subcategoria preenchida na complementação deve sair das pendências');
assert.ok(!complementada.analiseEstruturada.informacoesAusentes.includes('CANAL'), 'canal informado na complementação deve sair das pendências');
assert.equal(semComplementacao.CATEGORIA, '', 'complementação não pode alterar o relato ou o objeto original');
assert.equal(complementada.complementacoes.CATEGORIA.valor, 'Qualidade', 'complementações devem ser devolvidas para recuperação da interface');

const originalLerAba = sheets.lerAba;
(async () => {
  try {
    const relatada = await cerebro.detectarReincidencia({ EMPRESA_RECLAMADA: 'PLASCHIO', DESCRICAO: 'O mesmo problema ocorreu novamente.' });
    assert.equal(relatada.nivel, 'REINCIDENCIA_RELATADA', 'relato sem cliente/histórico não pode ser confirmado');
    assert.equal(relatada.casos.length, 0);
    sheets.lerAba = async nome => {
      if (nome === 'MANIFESTACOES') return [{
        ID_MANIFESTACAO: 'PLAS-ANT-1', EMPRESA_RECLAMADA: 'PLASCHIO', EMPRESA_RECLAMANTE: 'Cliente de teste',
        PRODUTO: 'Tampas', DESCRICAO: 'Falha diferente no produto', STATUS: 'ENCERRADA',
      }, {
        ID_MANIFESTACAO: 'CHI-OUTRA-EMPRESA', EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS', EMPRESA_RECLAMANTE: 'Cliente de teste',
        PRODUTO: 'Potes', DESCRICAO: manifestacao.descricao, STATUS: 'ENCERRADA',
      }];
      if (nome === 'BANCO_HISTORICO') return [];
      return [];
    };
    const reincidencia = await cerebro.detectarReincidencia({
      EMPRESA_RECLAMADA: 'PLASCHIO', EMPRESA_RECLAMANTE: 'Cliente de teste', PRODUTO: 'Potes', ID_MANIFESTACAO: 'ATUAL',
    });
    assert.equal(reincidencia.detectada, false, 'produto sem correspondência não pode gerar reincidência');
    assert.equal(reincidencia.quantidade, 0);

    const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
    assert.match(html, /function nmCanalSelecionado\(\)/, 'canal deve usar um leitor canônico do formulário');
    assert.match(html, /_nmEvidencias\.map/, 'anexos devem permanecer no estado entre etapas');
    assert.ok(!html.includes('(p.termos || []).join'), 'termos livres não podem ser apresentados como competência/responsável');
    assert.match(html, /HIPÓTESE — validar/, 'classificações do texto devem aparecer como hipóteses');
    assert.match(html, /ia-alerta-produto/, 'divergência de produto deve ser visível na Etapa 2');
    assert.match(html, /nmSalvarComplementacoes/, 'informações faltantes devem possuir salvamento contextual');
    assert.match(html, /Complementar informações da manifestação/, 'formulário deve ser visível abaixo das informações faltantes');
    assert.match(html, /confirmadas pelo servidor/, 'sucesso só pode ser exibido após leitura de confirmação');
    assert.match(html, /salvarRascunho\(\{silent:true,reportError:true\}\)/, 'complementação sem ID deve criar rascunho com erro explícito');
    assert.match(html, /nmSolicitarComplementacoesAoCliente/, 'pendências do cliente devem ser encaminháveis à Etapa 3');
    assert.match(html, /data-comp-status/, 'cada complementação deve possuir estado persistível');
    assert.match(html, /checklistPersistido/, 'checklist visual deve usar estado persistido');
    assert.match(html, /nmAbrirRevisaoOrientacao/, 'ajuste de condução deve abrir revisão humana sem avançar automaticamente');
    assert.match(html, /nmUtilizarOrientacao/, 'utilizar orientação deve registrar decisão antes de avançar');
    assert.match(html, /ORIENTACAO_REJEITADA/, 'rejeição da orientação deve ter estado explícito');
    const api = fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8');
    assert.match(api, /analisePatch/, 'backend deve persistir decisão como patch da análise existente');
    assert.match(api, /const revisadoPor = req\.user/, 'identidade da decisão deve vir da sessão do backend');
    assert.match(api, /estadosComplementacao/, 'backend deve validar estados das complementações');
    assert.match(api, /atualizadoPor: req\.user/, 'backend deve registrar usuário da complementação pela sessão');
    assert.match(api, /gravação das complementações não foi confirmada/, 'backend deve confirmar a persistência na fonte oficial');
    assert.match(api, /complemento Sheets indisponível/, 'ficha deve complementar um registro PG resumido com a fonte oficial do Sheets');
    assert.match(api, /historico: \[\.\.\.historico, registro\]/, 'revisões repetidas devem manter histórico auditável');
    assert.match(html, /sac-rascunho-id/, 'rascunho deve poder ser retomado pelo ID persistido');
    assert.match(html, /ci\?\.circa/, 'ficha deve ler o envelope CIRCA correto após recarregar');
    assert.match(html, /nmPlanoConducao/, 'Etapa 3 deve exibir plano de condução persistível');
    assert.match(html, /nmConfirmarPlano/, 'Etapa 3 deve confirmar as ações preparadas em conjunto');
    assert.match(html, /A API confirmou .* ações na leitura de confirmação/, 'Confirmar ações deve verificar a persistência antes de exibir sucesso');
    assert.match(html, /Nenhum sucesso foi declarado/, 'falha na confirmação das ações não pode ser mascarada');
    assert.match(html, /nmCarregarResponsaveisSetor/, 'responsáveis devem vir do cadastro por setor');
    assert.match(html, /\/api\/aprovadores\/'.*pendencias/, 'pendências devem usar a rota canônica com o sufixo pendencias');
    assert.match(html, /window\.__SAC_PERM_MODULOS/, 'catálogo de permissões deve atravessar os escopos por uma referência global');
    assert.doesNotMatch(html, /Object\.keys\(_PERM_MODULOS/, 'renderização de perfis não pode referenciar módulo fora do escopo');
    assert.match(html, /Nenhum responsável ativo e autorizado/, 'lista vazia de responsáveis deve ser distinguida de erro de API');
    assert.match(html, /Erro ao carregar responsáveis/, 'falha da API de responsáveis deve ser apresentada explicitamente');
    assert.match(html, /SAC_CONFIG_STATUS/, 'falha 401 de configurações deve terminar em estado explícito');
    assert.match(api, /function setoresDoCadastro/, 'backend deve normalizar todos os setores autorizados do cadastro');
    assert.match(api, /RESPONSAVEL_FORA_DA_EMPRESA/, 'backend deve bloquear responsável fora da empresa da manifestação');
    assert.match(api, /setoresAlvo\.some/, 'backend deve validar correspondência de setor por item cadastrado');
    assert.match(api, /RESPONSAVEL_FORA_DO_SETOR/, 'backend deve bloquear responsável de setor incompatível');
    assert.match(api, /RESPONSAVEL_ID/, 'acionamento deve persistir o identificador do responsável');
    assert.match(api, /PRAZO_ORIGEM/, 'acionamento deve registrar a origem do prazo');
    assert.match(html, /responsavel,tarefa/, 'acionamento deve preservar responsável e tarefa da frente');
    console.log('CIRCA Nova Manifestação: campos PLASCHIO, hipóteses múltiplas, regras inválidas, isolamento de reincidência e renderização aprovados.');
  } finally {
    sheets.lerAba = originalLerAba;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
