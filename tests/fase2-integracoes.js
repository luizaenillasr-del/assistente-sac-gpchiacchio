'use strict';

// Validações isoladas da Fase 2. Nenhuma credencial ou integração real é usada.
const assert = require('node:assert/strict');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
delete process.env.GOOGLE_CREDENTIALS;
delete process.env.OPENAI_API_KEY;

const mock = require('./sheets-mock');
const sheets = require('../server-services/sheets');
const documentService = require('../server-services/documentService');
const aiService = require('../server-services/aiService');
const matriz = require('../server-services/matrizConhecimentoService');

(async () => {
  assert.throws(() => sheets.getAuth(), /GOOGLE_CREDENTIALS não configurada/);
  assert.throws(() => documentService.validarArquivo({ dataBase64: 'data:text/plain;base64,QQ==' }), /Tipo de arquivo não permitido/);
  assert.throws(() => documentService.validarArquivo({ dataBase64: 'data:application/pdf;base64,!!!' }), /Base64 inválido/);
  assert.throws(() => documentService.validarArquivo({ dataBase64: 'data:application/pdf;base64,' }), /Base64 inválido/);
  assert.throws(() => documentService.normalizarJson(undefined), /Resposta de extração vazia/);
  assert.throws(() => documentService.normalizarJson('resposta sem objeto'), /sem JSON válido/);
  assert.deepEqual(documentService.normalizarJson('```json\n{"ok":true}\n```'), { ok: true });
  assert.equal(aiService.isDisponivel(), false);

  const semIa = await require('../server-services/cerebroServices').analisarManifestacaoCompleta({ DESCRICAO: '', EMPRESA_RECLAMADA: '' }, {}, 'fase2');
  assert.equal(semIa.ia.disponivel, false);
  assert.ok(semIa.informacoesAusentes.includes('DESCRICAO'));
  assert.equal(semIa.geraRNC, false);

  const created = [];
  const itemIds = [];
  try {
    const m = await matriz.criarMatriz({ nome: 'Matriz Fase 2', empresa: 'CHIACCHIO EMBALAGENS' }, 'fase2');
    created.push(m.ID);
    const item = await matriz.adicionarItem(m.ID, { tipoFonte: 'FAQ', fonteId: 'FAQ-F2-001', titulo: 'Orientação sintética' }, 'fase2');
    itemIds.push(item.ID);
    await assert.rejects(() => matriz.adicionarItem(m.ID, { tipoFonte: 'FAQ', fonteId: 'FAQ-F2-001', titulo: 'Orientação sintética' }, 'fase2'), /já vinculado/);
    const resolvido = await matriz.resolverConhecimento({ EMPRESA_RECLAMADA: 'CHIACCHIO EMBALAGENS', TIPO_MANIFESTACAO: 'Reclamação' });
    assert.equal(resolvido.status, 'SEM_MATRIZ');
    console.log('FASE 2: validação de credenciais, arquivos, JSON, funcionamento sem IA e deduplicação de conhecimento aprovados em ambiente isolado.');
  } finally {
    for (const id of itemIds) { const i = (mock.DB.MC_ITENS_CONHECIMENTO || []).findIndex(x => x.ID === id); if (i >= 0) mock.DB.MC_ITENS_CONHECIMENTO.splice(i, 1); }
    for (const id of created) { const i = (mock.DB.MATRIZ_CONHECIMENTO || []).findIndex(x => x.ID === id); if (i >= 0) mock.DB.MATRIZ_CONHECIMENTO.splice(i, 1); }
  }
})().catch(err => { console.error(err); process.exitCode = 1; });
