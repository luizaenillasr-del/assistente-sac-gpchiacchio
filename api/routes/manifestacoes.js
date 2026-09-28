const express = require('express');
const router = express.Router();
const sheets = require('../services/sheets');

// Listar manifestações
router.get('/', async (req, res) => {
  try {
    const data = await sheets.lerAba('MANIFESTACOES');
    res.json({ sucesso: true, itens: data });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// Criar manifestação
router.post('/', async (req, res) => {
  try {
    const { empresaReclamada, empresaReclamante, contato, produto, lote, descricao } = req.body;
    if (!empresaReclamada || !empresaReclamante || !contato || !descricao) {
      return res.status(400).json({ sucesso: false, erro: 'Campos obrigatórios faltando.' });
    }
    const id = await sheets.gerarProximoID('MANIFESTACOES', 'MAN');
    const linha = [id, new Date().toISOString(), empresaReclamada, empresaReclamante, contato, produto || '', lote || '', descricao, 'EM ANÁLISE'];
    await sheets.appendLinha('MANIFESTACOES', linha);
    res.json({ sucesso: true, id });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

// Buscar manifestação por ID
router.get('/:id', async (req, res) => {
  try {
    const data = await sheets.lerAba('MANIFESTACOES');
    const item = data.find(r => r.ID_MANIFESTACAO === req.params.id);
    if (!item) return res.status(404).json({ sucesso: false, erro: 'Não encontrada.' });
    res.json({ sucesso: true, manifestacao: item });
  } catch (e) {
    res.status(500).json({ sucesso: false, erro: e.message });
  }
});

module.exports = router;
