'use strict';

// Regressão isolada do CIRCA. O teste substitui apenas a camada de leitura
// Sheets em memória; nenhuma API externa, planilha ou banco é acessado.
const assert = require('node:assert/strict');
const fs = require('node:fs');
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const sheets = require('../server-services/sheets');
let writes = 0;
const fixtures = {
  MATRIZ_TRATAMENTO: [{
    ID_REGRA: 'REG-1', EMPRESA: 'TODAS', TIPO_MANIFESTACAO: 'Reclamação',
    CAUSA: 'Atraso logístico', TRATATIVA_PADRAO: 'Confirmar rastreamento',
    REQUER_APROVACAO: 'SIM', ATIVO: 'SIM', SLA_HORAS: '72', PRIORIDADE: 'NORMAL', VERSAO: '1.0', SETOR_RESPONSAVEL: 'Logística',
  }, {
    ID_REGRA: 'REG-CATEGORIA', EMPRESA: 'TODAS', TIPO_MANIFESTACAO: 'Reclamação', CATEGORIA: 'Faturamento',
    SETOR_RESPONSAVEL: 'Financeiro', TRATATIVA_PADRAO: 'Conferir cobrança', ATIVO: 'SIM', SLA_HORAS: '72', PRIORIDADE: 'NORMAL',
  }],
  MODELOS_DEVOLUTIVA: [{
    ID_MODELO: 'MOD-1', TITULO: 'Recebimento aprovado', EMPRESA: 'TODAS',
    TIPO_MANIFESTACAO: 'Reclamação', TIPO_DEVOLUTIVA: 'RECEBIMENTO',
    TEXTO_PADRAO: 'Protocolo {{protocolo}} — {{empresa}}', STATUS: 'APROVADA', VERSAO: '2',
  }],
  BANCO_HISTORICO: [{
    ID_HISTORICO: 'HIST-1', DRV_EMPRESA_NORMALIZADA: 'CHIACCHIO EMBALAGENS',
    ORIG_DESCRICAO_RECLAMACAO: 'Atraso logístico no pedido',
    COMP_TIPO_PROBLEMA_VALIDADO: 'Reclamação', COMP_CAUSA_PROVAVEL: 'Atraso logístico',
    CAUSA_RAIZ_VALIDADA: '',
  }],
  MANIFESTACOES: [{
    ID_MANIFESTACAO: 'HIST-1', EMPRESA_RECLAMANTE: 'Cliente teste', EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS', PRODUTO: 'Caixa',
  }],
  POLITICAS: [], PROCEDIMENTOS: [], BASE_CONHECIMENTO: [], CAUSAS: [],
};

const original = {
  lerAba: sheets.lerAba,
  garantir: sheets.garantirAbaComCabecalhos,
};
sheets.lerAba = async nome => fixtures[nome] ? fixtures[nome].map(row => ({ ...row })) : [];
sheets.garantirAbaComCabecalhos = async () => { writes++; throw new Error('leitura não pode criar abas'); };

// Carrega os serviços depois do mock para que todos compartilhem o mesmo objeto.
const matriz = require('../server-services/matrizTratamentoService');
const devolutiva = require('../server-services/devolutivaEngine');
const cerebro = require('../server-services/cerebroServices');

(async () => {
  const apiSource = fs.readFileSync(require.resolve('../api/index.js'), 'utf8');
  const circaSource = apiSource.slice(apiSource.indexOf("app.get('/api/manifestacoes/:id/circa'"), apiSource.indexOf("app.patch('/api/manifestacoes/:id/circa-dados'"));
  assert.match(circaSource, /lerAba\('CAUSAS'/, 'CIRCA deve usar a aba canônica CAUSAS');

  const regra = await matriz.consultarMatriz({
    empresa: 'CHIACCHIO EMBALAGENS', tipo: 'Reclamação', causa: 'Atraso logístico', setor: 'Logística',
  });
  assert.equal(regra.idTratamento, null, 'ID_REGRA não pode ser usado como ID_TRATAMENTO');
  assert.equal(regra.idRegra, 'REG-1', 'ID_REGRA deve ser preservado separadamente');
  assert.ok(regra.acoesRecomendadas.includes('Confirmar rastreamento'));
  assert.equal(regra.necessitaAprovacao, true);
  assert.equal(regra.origem, 'MATRIZ');
  const regraSemCategoria = await matriz.consultarMatriz({ empresa: 'CHIACCHIO EMBALAGENS', tipo: 'Reclamação' });
  assert.equal(regraSemCategoria, null, 'regra com critério obrigatório ausente não pode ser elegível');

  const resposta = await devolutiva.gerarDevolutiva({
    idManifestacao: 'MAN-1', protocolo: 'CHIA-0001', tipo: 'RECEBIMENTO',
    empresa: 'CHIACCHIO EMBALAGENS', tipoManifestacao: 'Reclamação',
  });
  assert.equal(resposta.modeloDevolutiva, 'MOD-1');
  assert.equal(resposta.modeloDevolutivaOrigem, 'MODELOS_DEVOLUTIVA');
  assert.match(resposta.textoGerado, /CHIA-0001/);
  assert.match(resposta.textoGerado, /CHIACCHIO EMBALAGENS/);

  const conhecimento = await cerebro.consultarBaseConhecimento('Reclamação', 'SAC', null, 'Atraso logístico no pedido');
  const hipotese = conhecimento.itens.find(item => item.fonte_aba === 'BANCO_HISTORICO');
  assert.ok(hipotese, 'causa histórica deve ser considerada quando CAUSAS está vazia');
  assert.equal(hipotese.nivel, 'HIPOTESE_HISTORICA');
  assert.equal(hipotese.confirmada, false);

  const reincidencia = await cerebro.detectarReincidencia({
    EMPRESA_RECLAMANTE: 'Cliente teste', EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS', PRODUTO: 'Caixa', ID_MANIFESTACAO: 'ATUAL-1',
  });
  assert.equal(reincidencia.quantidade, 1, 'mesmo ID em MANIFESTACOES e histórico não pode duplicar ocorrência');
  assert.equal(writes, 0, 'leituras do CIRCA não podem criar abas ou registros');
  console.log('CIRCA conhecimento: matriz legada, modelos aprovados, hipóteses históricas e deduplicação aprovados.');
})()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => {
    sheets.lerAba = original.lerAba;
    sheets.garantirAbaComCabecalhos = original.garantir;
  });
