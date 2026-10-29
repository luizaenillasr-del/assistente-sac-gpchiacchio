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

const semRegra = analisar({
  manifestacao,
  tratamentos: [
    { ID_REGRA: '', STATUS: 'APROVADO', SETOR_RESPONSAVEL: '', PROCEDIMENTO: '' },
    { ID_REGRA: 'INAT-1', STATUS: 'INATIVO', SETOR_RESPONSAVEL: 'Qualidade', PROCEDIMENTO: 'Não usar' },
  ],
});
assert.deepEqual(semRegra.analiseEstruturada.informacoesAusentes, [], 'dados preenchidos permanecem presentes');
assert.equal(semRegra.analiseEstruturada.procedimentosAplicaveis.length, 0, 'regra sem identidade/inativa não pode ser recomendada');
assert.deepEqual(semRegra.analiseEstruturada.setoresRecomendados, [], 'setor não pode ser extraído diretamente de palavras do relato');
assert.equal(semRegra.hipotesesClassificacao.length, 2);

const originalLerAba = sheets.lerAba;
(async () => {
  try {
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
    console.log('CIRCA Nova Manifestação: campos PLASCHIO, hipóteses múltiplas, regras inválidas, isolamento de reincidência e renderização aprovados.');
  } finally {
    sheets.lerAba = originalLerAba;
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
