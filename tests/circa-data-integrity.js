'use strict';

// Regressão da matriz e do histórico. Usa somente fixtures em memória:
// nenhuma planilha, banco ou serviço externo é alterado.
const assert = require('node:assert/strict');
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;

const sheets = require('../server-services/sheets');
const originalLerAba = sheets.lerAba;
const originalCache = require('../server-services/matrizTratamentoService');

const matrizRows = [
  {
    ID_REGRA: 'MTR-LEG-1', EMPRESA: 'CHIACCHIO', TIPO_MANIFESTACAO: 'Reclamação',
    CAUSA: 'Atraso', SETOR_RESPONSAVEL: 'Logística', SLA_HORAS: '72', PRIORIDADE: 'NORMAL',
    TRATATIVA_PADRAO: 'Verificar rastreio', ATIVO: 'SIM', REQUER_APROVACAO: 'NAO',
  },
  {
    ID_TRATAMENTO: 'TRAT-1', EMPRESA: 'CHIACCHIO', TIPO_MANIFESTACAO: 'Reclamação',
    CATEGORIA: 'Logística', SUBCATEGORIA: 'Entrega', SETOR_RESPONSAVEL: 'Logística',
    PROCEDIMENTO: 'Confirmar prazo', ATIVO: 'SIM', STATUS: 'APROVADO', VERSAO: '1',
  },
  {
    ID_REGRA: 'MTR-MVR3OOD1WG5', ID_TRATAMENTO: '', EMPRESA: 'tubahia',
    TIPO_MANIFESTACAO: 'Reclamação', SETOR_RESPONSAVEL: 'SAC', PRIORIDADE: 'NORMAL',
    SLA_HORAS: '72', REQUER_APROVACAO: 'NÃO', CAUSA: 'Qualidade do produto',
    CATEGORIA: '', SUBCATEGORIA: '', TRATATIVA_OBRIGATORIA: '', ATIVO: 'SIM',
  },
  {
    ID_REGRA: 'MTR-INATIVA', ID_TRATAMENTO: '', EMPRESA: 'tubahia',
    TIPO_MANIFESTACAO: 'Reclamação', SETOR_RESPONSAVEL: 'SAC', ATIVO: 'NAO',
  },
];

const historicoRows = [
  {
    ID_HISTORICO: 'HIST-VALIDO', ORIG_ID_MANIFESTACAO: 'MAN-VALIDO',
    DRV_EMPRESA_NORMALIZADA: 'CHIACCHIO', ORIG_EMPRESA: 'CHIACCHIO', ORIG_CONTATO: 'Cliente A',
    ORIG_PRODUTO: 'Caixa', ORIG_DESCRICAO_RECLAMACAO: 'Atraso na entrega da caixa',
    COMP_CAUSA_PROVAVEL: 'Atraso logístico', STATUS_DADO: 'COMPLETO', ORIG_DATA_ABERTURA: '2026-10-01',
  },
  {
    ID_HISTORICO: 'HIST-0058', STATUS_DADO: 'INCOMPLETO', MOTIVO_INCOMPLETUDE: 'DESCRICAO_RECLAMACAO vazia',
    ORIG_DATA_ABERTURA: '2026-06-16', COMP_CAUSA_PROVAVEL: 'Erro administrativo',
  },
  {
    ID_HISTORICO: '', ORIG_DATA_ABERTURA: '2026-06-16', ORIG_EMPRESA: '',
    ORIG_DESCRICAO_RECLAMACAO: '', COMP_CAUSA_PROVAVEL: 'Não deve ser evidência',
  },
  {
    ID_HISTORICO: 'HIST-OUTRA-EMPRESA', DRV_EMPRESA_NORMALIZADA: 'PLASCHIO', ORIG_EMPRESA: 'PLASCHIO',
    ORIG_CONTATO: 'Cliente A', ORIG_PRODUTO: 'Caixa', ORIG_DESCRICAO_RECLAMACAO: 'Atraso na entrega da caixa',
    COMP_CAUSA_PROVAVEL: 'Atraso logístico', STATUS_DADO: 'COMPLETO',
  },
];

const manifestacoes = [
  { ID_MANIFESTACAO: 'MAN-VALIDO', EMPRESA_RECLAMADA: 'CHIACCHIO', EMPRESA_RECLAMANTE: 'Cliente A', PRODUTO: 'Caixa', DESCRICAO: 'Atraso na entrega da caixa' },
  { ID_MANIFESTACAO: 'MAN-OUTRA-EMPRESA', EMPRESA_RECLAMADA: 'PLASCHIO', EMPRESA_RECLAMANTE: 'Cliente A', PRODUTO: 'Caixa', DESCRICAO: 'Atraso na entrega da caixa' },
];

(async () => {
  sheets.lerAba = async nome => {
    if (nome === 'MATRIZ_TRATAMENTO') return matrizRows.map(r => ({ ...r }));
    if (nome === 'BANCO_HISTORICO') return historicoRows.map(r => ({ ...r }));
    if (nome === 'MANIFESTACOES') return manifestacoes.map(r => ({ ...r }));
    return [];
  };

  try {
    const matriz = require('../server-services/matrizTratamentoService');
    const legado = matriz.normalizarRegra(matrizRows[0]);
    assert.equal(legado.ID_REGRA, 'MTR-LEG-1');
    assert.equal(legado.ID_TRATAMENTO, '', 'ID_REGRA nunca deve virar ID_TRATAMENTO');
    assert.equal(matriz.regraUtilizavel(legado), true, 'regra legada completa deve ser utilizável');

    const incompleta = matriz.normalizarRegra(matrizRows[2]);
    assert.equal(matriz.regraUtilizavel(incompleta), false, 'regra canônica incompleta ativa deve ser bloqueada');
    assert.ok(incompleta.MOTIVOS_INCOMPLETUDE.includes('ID_TRATAMENTO'));
    assert.equal(matriz.regraUtilizavel(matriz.normalizarRegra(matrizRows[3])), false, 'regra inativa não deve ser utilizada');

    matriz._cache = null;
    const regra = await matriz.consultarMatriz({ empresa: 'CHIACCHIO', tipo: 'Reclamação', causa: 'Atraso', setor: 'Logística' });
    assert.ok(regra, 'uma regra completa deve ser encontrada');
    assert.equal(regra.idRegra, 'MTR-LEG-1');
    assert.equal(regra.idTratamento, null, 'consulta não pode misturar os identificadores');

    const cerebro = require('../server-services/cerebroServices');
    assert.equal(cerebro.historicoPodeAlimentarCirca(historicoRows[0]), true);
    assert.equal(cerebro.historicoPodeAlimentarCirca(historicoRows[1]), false);
    assert.equal(cerebro.historicoPodeAlimentarCirca(historicoRows[2]), false);

    const similares = await cerebro.buscarCasosSimilares(
      { DESCRICAO: 'Atraso na entrega da caixa' }, 10, 'CHIACCHIO'
    );
    assert.ok(similares.some(item => item.id === 'HIST-VALIDO'));
    assert.ok(!similares.some(item => item.id === 'HIST-0058'), 'histórico incompleto não pode ser evidência');
    assert.ok(!similares.some(item => item.id === 'HIST-OUTRA-EMPRESA'), 'empresa diferente deve ser isolada');

    const reincidencia = await cerebro.detectarReincidencia({
      EMPRESA_RECLAMADA: 'CHIACCHIO', EMPRESA_RECLAMANTE: 'Cliente A', PRODUTO: 'Caixa', ID_MANIFESTACAO: 'ATUAL',
    });
    assert.equal(reincidencia.quantidade, 1, 'a mesma manifestação em histórico não pode ser contada duas vezes');
    assert.ok(reincidencia.casos.every(item => item.id !== 'HIST-0058'));
    console.log('CIRCA integridade: matriz, histórico incompleto, deduplicação e isolamento aprovados.');
  } finally {
    sheets.lerAba = originalLerAba;
    originalCache._cache = null;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
