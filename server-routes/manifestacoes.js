const express = require('express');
const router = express.Router();

const sheets = require('../server-services/sheets');
const cerebro = require('../server-services/cerebroService');

// =====================================================
// LISTAR MANIFESTAÇÕES
// =====================================================

router.get('/', async (req, res) => {
  try {
    const data = await sheets.lerAba(
      'MANIFESTACOES'
    );

    res.json({
      sucesso: true,
      itens: data,
    });
  } catch (e) {
    console.error(
      'Erro ao listar manifestações:',
      e
    );

    res.status(500).json({
      sucesso: false,
      erro: e.message,
    });
  }
});

// =====================================================
// CRIAR MANIFESTAÇÃO
// =====================================================

router.post('/', async (req, res) => {
  try {
    const {
      empresaReclamada,
      empresaReclamante,
      contato,
      produto,
      lote,
      descricao,
    } = req.body;

    if (
      !empresaReclamada ||
      !empresaReclamante ||
      !contato ||
      !descricao
    ) {
      return res.status(400).json({
        sucesso: false,
        erro:
          'Campos obrigatórios faltando.',
      });
    }

    // -------------------------------------------------
    // 1. Gera ID
    // -------------------------------------------------

    const id =
      await sheets.gerarProximoID(
        'MANIFESTACOES',
        'MAN'
      );

    // -------------------------------------------------
    // 2. Monta manifestação
    // -------------------------------------------------

    const manifestacao = {
      ID_MANIFESTACAO: id,

      DATA_ABERTURA:
        new Date().toISOString(),

      EMPRESA_RECLAMADA:
        empresaReclamada,

      EMPRESA_RECLAMANTE:
        empresaReclamante,

      CONTATO:
        contato,

      PRODUTO:
        produto || '',

      LOTE:
        lote || '',

      DESCRICAO:
        descricao,

      STATUS:
        'EM ANÁLISE',
    };

    // -------------------------------------------------
    // 3. Grava na planilha
    // -------------------------------------------------

    await sheets.appendObjeto(
      'MANIFESTACOES',
      manifestacao
    );

    // -------------------------------------------------
    // 4. Aciona o cérebro
    // -------------------------------------------------

    let analise = null;

    try {
      analise =
        await cerebro.analisarManifestacao(
          manifestacao
        );
    } catch (erroCerebro) {
      console.error(
        'Erro no cérebro:',
        erroCerebro
      );

      analise = {
        sucesso: false,
        erro:
          erroCerebro.message,
      };
    }

    // -------------------------------------------------
    // 5. Retorno
    // -------------------------------------------------

    res.status(201).json({
      sucesso: true,

      id,

      manifestacao,

      analise,
    });

  } catch (e) {
    console.error(
      'Erro ao criar manifestação:',
      e
    );

    res.status(500).json({
      sucesso: false,
      erro: e.message,
    });
  }
});

// =====================================================
// BUSCAR MANIFESTAÇÃO POR ID
// =====================================================

router.get('/:id', async (req, res) => {
  try {
    const item =
      await sheets.buscarPorID(
        'MANIFESTACOES',
        req.params.id,
        ['ID_MANIFESTACAO']
      );

    if (!item) {
      return res.status(404).json({
        sucesso: false,
        erro: 'Não encontrada.',
      });
    }

    res.json({
      sucesso: true,
      manifestacao: item,
    });

  } catch (e) {
    console.error(
      'Erro ao buscar manifestação:',
      e
    );

    res.status(500).json({
      sucesso: false,
      erro: e.message,
    });
  }
});

// =====================================================
// ATUALIZAR MANIFESTAÇÃO
// =====================================================

router.patch('/:id', async (req, res) => {
  try {
    const id = req.params.id;

    const dadosPermitidos = [
      'STATUS',
      'MOTIVO',
      'TIPO_PROBLEMA_VALIDADO',
      'CAUSA_RAIZ',
      'SUBCAUSA',
      'SETOR_RESPONSAVEL',
      'TRATAMENTO',
      'TRATAMENTO_REALIZADO',
      'DEVOLUTIVA',
      'RESULTADO',
      'DATA_FECHAMENTO',
      'OBSERVACOES',
      'OBSERVAÇÕES',
      'RESPONSAVEL',
      'ANALISTA',
    ];

    const dados = {};

    dadosPermitidos.forEach(campo => {
      if (
        req.body[campo] !== undefined
      ) {
        dados[campo] =
          req.body[campo];
      }
    });

    if (!Object.keys(dados).length) {
      return res.status(400).json({
        sucesso: false,
        erro:
          'Nenhum campo válido para atualização.',
      });
    }

    await sheets.atualizarPorID(
      'MANIFESTACOES',
      id,
      dados,
      ['ID_MANIFESTACAO']
    );

    const atualizada =
      await sheets.buscarPorID(
        'MANIFESTACOES',
        id,
        ['ID_MANIFESTACAO']
      );

    res.json({
      sucesso: true,
      manifestacao: atualizada,
    });

  } catch (e) {
    console.error(
      'Erro ao atualizar manifestação:',
      e
    );

    res.status(500).json({
      sucesso: false,
      erro: e.message,
    });
  }
});

// =====================================================
// ANALISAR UMA MANIFESTAÇÃO MANUALMENTE
// =====================================================

router.get(
  '/:id/analise',
  async (req, res) => {
    try {
      const manifestacao =
        await sheets.buscarPorID(
          'MANIFESTACOES',
          req.params.id,
          ['ID_MANIFESTACAO']
        );

      if (!manifestacao) {
        return res.status(404).json({
          sucesso: false,
          erro:
            'Manifestação não encontrada.',
        });
      }

      const analise =
        await cerebro.analisarManifestacao(
          manifestacao
        );

      res.json({
        sucesso: true,
        id: req.params.id,
        analise,
      });

    } catch (e) {
      console.error(
        'Erro na análise:',
        e
      );

      res.status(500).json({
        sucesso: false,
        erro: e.message,
      });
    }
  }
);

module.exports = router;
