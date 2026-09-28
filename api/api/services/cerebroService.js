const sheets = require('./sheets');

/**
 * Normalização de texto.
 */
function normalizar(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Divide texto em palavras relevantes.
 */
function tokens(valor) {
  const stopwords = new Set([
    'a',
    'o',
    'e',
    'de',
    'da',
    'do',
    'das',
    'dos',
    'em',
    'no',
    'na',
    'nos',
    'nas',
    'um',
    'uma',
    'para',
    'por',
    'com',
    'que',
    'se',
    'foi',
    'ser',
    'estava',
    'estao',
    'está',
  ]);

  return new Set(
    normalizar(valor)
      .split(' ')
      .filter(
        palavra =>
          palavra.length >= 3 &&
          !stopwords.has(palavra)
      )
  );
}

/**
 * Similaridade textual baseada em interseção de termos.
 */
function similaridadeTexto(a, b) {
  const A = tokens(a);
  const B = tokens(b);

  if (!A.size || !B.size) {
    return 0;
  }

  let intersecao = 0;

  A.forEach(token => {
    if (B.has(token)) {
      intersecao++;
    }
  });

  const uniao = new Set([
    ...A,
    ...B,
  ]).size;

  if (!uniao) {
    return 0;
  }

  return intersecao / uniao;
}

/**
 * Pega o primeiro campo existente entre vários nomes possíveis.
 *
 * Isso permite que o cérebro funcione mesmo se sua planilha
 * tiver nomes de colunas ligeiramente diferentes.
 */
function campo(obj, nomes) {
  for (const nome of nomes) {
    if (
      obj &&
      obj[nome] !== undefined &&
      obj[nome] !== ''
    ) {
      return obj[nome];
    }
  }

  return '';
}

/**
 * Monta o texto principal do caso.
 */
function textoCaso(caso) {
  return [
    campo(caso, [
      'DESCRICAO_RECLAMACAO',
      'DESCRIÇÃO_RECLAMAÇÃO',
      'DESCRICAO',
      'DESCRIÇÃO',
      'RELATO',
      'MOTIVO_RELATADO_BRUTO',
    ]),

    campo(caso, [
      'MOTIVO',
      'MOTIVO_RECLAMACAO',
      'MOTIVO_RELATADO_BRUTO',
      'TIPO_PROBLEMA_VALIDADO',
    ]),

    campo(caso, [
      'CAUSA_RAIZ',
      'CAUSA',
      'CAUSA_VALIDADA',
    ]),

    campo(caso, [
      'SUBCAUSA',
      'SUB_CAUSA',
    ]),

    campo(caso, [
      'PRODUTO',
      'PRODUTO_RECLAMADO',
    ]),
  ]
    .filter(Boolean)
    .join(' ');
}

/**
 * Calcula compatibilidade entre dois casos.
 *
 * Pesos:
 * descrição       35%
 * motivo          20%
 * produto         15%
 * causa           10%
 * empresa         10%
 * setor           10%
 */
function calcularCompatibilidade(novo, historico) {
  const descricaoNovo = campo(novo, [
    'DESCRICAO',
    'DESCRIÇÃO',
    'DESCRICAO_RECLAMACAO',
    'DESCRIÇÃO_RECLAMAÇÃO',
    'RELATO',
    'MOTIVO_RELATADO_BRUTO',
  ]);

  const descricaoHistorico = campo(historico, [
    'DESCRICAO',
    'DESCRIÇÃO',
    'DESCRICAO_RECLAMACAO',
    'DESCRIÇÃO_RECLAMAÇÃO',
    'RELATO',
    'MOTIVO_RELATADO_BRUTO',
  ]);

  const motivoNovo = campo(novo, [
    'MOTIVO',
    'MOTIVO_RECLAMACAO',
    'TIPO_PROBLEMA_VALIDADO',
  ]);

  const motivoHistorico = campo(historico, [
    'MOTIVO',
    'MOTIVO_RECLAMACAO',
    'TIPO_PROBLEMA_VALIDADO',
  ]);

  const produtoNovo = campo(novo, [
    'PRODUTO',
    'PRODUTO_RECLAMADO',
  ]);

  const produtoHistorico = campo(historico, [
    'PRODUTO',
    'PRODUTO_RECLAMADO',
  ]);

  const causaNovo = campo(novo, [
    'CAUSA_RAIZ',
    'CAUSA',
  ]);

  const causaHistorico = campo(historico, [
    'CAUSA_RAIZ',
    'CAUSA',
  ]);

  const empresaNovo = campo(novo, [
    'EMPRESA_RECLAMADA',
    'EMPRESA',
  ]);

  const empresaHistorico = campo(historico, [
    'EMPRESA_RECLAMADA',
    'EMPRESA',
  ]);

  const setorNovo = campo(novo, [
    'SETOR_RESPONSAVEL',
    'SETOR',
  ]);

  const setorHistorico = campo(historico, [
    'SETOR_RESPONSAVEL',
    'SETOR',
  ]);

  const descricaoScore = similaridadeTexto(
    descricaoNovo,
    descricaoHistorico
  );

  const motivoScore = normalizar(motivoNovo) &&
    normalizar(motivoNovo) === normalizar(motivoHistorico)
    ? 1
    : similaridadeTexto(
        motivoNovo,
        motivoHistorico
      );

  const produtoScore = normalizar(produtoNovo) &&
    normalizar(produtoNovo) === normalizar(produtoHistorico)
    ? 1
    : similaridadeTexto(
        produtoNovo,
        produtoHistorico
      );

  const causaScore = normalizar(causaNovo) &&
    normalizar(causaNovo) === normalizar(causaHistorico)
    ? 1
    : similaridadeTexto(
        causaNovo,
        causaHistorico
      );

  const empresaScore =
    normalizar(empresaNovo) &&
    normalizar(empresaNovo) === normalizar(empresaHistorico)
      ? 1
      : 0;

  const setorScore =
    normalizar(setorNovo) &&
    normalizar(setorNovo) === normalizar(setorHistorico)
      ? 1
      : 0;

  const score =
    descricaoScore * 0.35 +
    motivoScore * 0.20 +
    produtoScore * 0.15 +
    causaScore * 0.10 +
    empresaScore * 0.10 +
    setorScore * 0.10;

  return Math.round(score * 100);
}

/**
 * Busca casos semelhantes no histórico.
 */
async function buscarCasosSimilares(
  manifestacao,
  limite = 5
) {
  let historico = [];

  try {
    historico = await sheets.lerAba(
      'BANCO_HISTORICO'
    );
  } catch (erro) {
    console.error(
      'Erro ao ler BANCO_HISTORICO:',
      erro.message
    );

    return [];
  }

  if (!historico.length) {
    return [];
  }

  const resultados = historico
    .map(caso => {
      const compatibilidade =
        calcularCompatibilidade(
          manifestacao,
          caso
        );

      return {
        id: campo(caso, [
          'ID_HISTORICO',
          'ID_MANIFESTACAO',
          'ID',
          'PROTOCOLO',
        ]),

        compatibilidade,

        descricao: campo(caso, [
          'DESCRICAO_RECLAMACAO',
          'DESCRIÇÃO_RECLAMAÇÃO',
          'DESCRICAO',
          'DESCRIÇÃO',
          'RELATO',
          'MOTIVO_RELATADO_BRUTO',
        ]),

        motivo: campo(caso, [
          'MOTIVO',
          'MOTIVO_RECLAMACAO',
          'TIPO_PROBLEMA_VALIDADO',
        ]),

        causaRaiz: campo(caso, [
          'CAUSA_RAIZ',
          'CAUSA',
          'CAUSA_VALIDADA',
        ]),

        subcausa: campo(caso, [
          'SUBCAUSA',
          'SUB_CAUSA',
        ]),

        setor: campo(caso, [
          'SETOR_RESPONSAVEL',
          'SETOR',
        ]),

        empresa: campo(caso, [
          'EMPRESA_RECLAMADA',
          'EMPRESA',
        ]),

        produto: campo(caso, [
          'PRODUTO',
          'PRODUTO_RECLAMADO',
        ]),

        tratamento: campo(caso, [
          'TRATAMENTO',
          'TRATAMENTO_REALIZADO',
          'SOLUCAO',
          'SOLUÇÃO',
          'DEVOLUTIVA',
        ]),

        resultado: campo(caso, [
          'RESULTADO',
          'STATUS_FINAL',
          'DESFECHO',
        ]),
      };
    })
    .filter(caso => caso.compatibilidade > 0)
    .sort(
      (a, b) =>
        b.compatibilidade -
        a.compatibilidade
    )
    .slice(0, limite);

  return resultados;
}

/**
 * Detecta reincidência.
 */
async function detectarReincidencia(manifestacao) {
  let historico = [];

  try {
    historico = await sheets.lerAba(
      'BANCO_HISTORICO'
    );
  } catch (erro) {
    return {
      existe: false,
      quantidade: 0,
      casos: [],
    };
  }

  const cliente = normalizar(
    campo(manifestacao, [
      'EMPRESA_RECLAMANTE',
      'CLIENTE',
      'CLIENTE_RECLAMANTE',
    ])
  );

  const produto = normalizar(
    campo(manifestacao, [
      'PRODUTO',
      'PRODUTO_RECLAMADO',
    ])
  );

  if (!cliente) {
    return {
      existe: false,
      quantidade: 0,
      casos: [],
    };
  }

  const casos = historico.filter(caso => {
    const clienteHistorico = normalizar(
      campo(caso, [
        'EMPRESA_RECLAMANTE',
        'CLIENTE',
        'CLIENTE_RECLAMANTE',
      ])
    );

    const produtoHistorico = normalizar(
      campo(caso, [
        'PRODUTO',
        'PRODUTO_RECLAMADO',
      ])
    );

    const mesmoCliente =
      clienteHistorico === cliente;

    const mesmoProduto =
      !produto ||
      !produtoHistorico ||
      produtoHistorico === produto;

    return mesmoCliente && mesmoProduto;
  });

  return {
    existe: casos.length > 0,
    quantidade: casos.length,
    casos: casos.slice(0, 10).map(caso => ({
      id: campo(caso, [
        'ID_HISTORICO',
        'ID_MANIFESTACAO',
        'ID',
        'PROTOCOLO',
      ]),

      motivo: campo(caso, [
        'MOTIVO',
        'MOTIVO_RECLAMACAO',
        'TIPO_PROBLEMA_VALIDADO',
      ]),

      causaRaiz: campo(caso, [
        'CAUSA_RAIZ',
        'CAUSA',
      ]),

      subcausa: campo(caso, [
        'SUBCAUSA',
        'SUB_CAUSA',
      ]),
    })),
  };
}

/**
 * Analisa padrões do histórico.
 */
async function analisarPadroes(
  manifestacao,
  similares
) {
  const causas = {};
  const subcausas = {};
  const setores = {};
  const tratamentos = {};

  similares.forEach(caso => {
    if (caso.causaRaiz) {
      causas[caso.causaRaiz] =
        (causas[caso.causaRaiz] || 0) + 1;
    }

    if (caso.subcausa) {
      subcausas[caso.subcausa] =
        (subcausas[caso.subcausa] || 0) + 1;
    }

    if (caso.setor) {
      setores[caso.setor] =
        (setores[caso.setor] || 0) + 1;
    }

    if (caso.tratamento) {
      tratamentos[caso.tratamento] =
        (tratamentos[caso.tratamento] || 0) + 1;
    }
  });

  function maisFrequente(obj) {
    const entradas = Object.entries(obj);

    if (!entradas.length) {
      return null;
    }

    entradas.sort((a, b) => b[1] - a[1]);

    return {
      valor: entradas[0][0],
      ocorrencias: entradas[0][1],
    };
  }

  return {
    causaMaisFrequente:
      maisFrequente(causas),

    subcausaMaisFrequente:
      maisFrequente(subcausas),

    setorMaisFrequente:
      maisFrequente(setores),

    tratamentoMaisFrequente:
      maisFrequente(tratamentos),
  };
}

/**
 * Função principal do cérebro.
 */
async function analisarManifestacao(
  manifestacao
) {
  const [similares, reincidencia] =
    await Promise.all([
      buscarCasosSimilares(
        manifestacao,
        5
      ),

      detectarReincidencia(
        manifestacao
      ),
    ]);

  const padroes =
    await analisarPadroes(
      manifestacao,
      similares
    );

  const casoMaisSimilar =
    similares.length
      ? similares[0]
      : null;

  let nivelConfianca = 'BAIXA';

  if (
    casoMaisSimilar &&
    casoMaisSimilar.compatibilidade >= 80
  ) {
    nivelConfianca = 'ALTA';
  } else if (
    casoMaisSimilar &&
    casoMaisSimilar.compatibilidade >= 60
  ) {
    nivelConfianca = 'MÉDIA';
  }

  return {
    sucesso: true,

    confianca: nivelConfianca,

    compatibilidadePrincipal:
      casoMaisSimilar
        ? casoMaisSimilar.compatibilidade
        : 0,

    casoMaisSimilar,

    casosSimilares: similares,

    reincidencia,

    padroes,

    sugestao: {
      causaRaiz:
        padroes.causaMaisFrequente?.valor ||
        casoMaisSimilar?.causaRaiz ||
        '',

      subcausa:
        padroes.subcausaMaisFrequente?.valor ||
        casoMaisSimilar?.subcausa ||
        '',

      setor:
        padroes.setorMaisFrequente?.valor ||
        casoMaisSimilar?.setor ||
        '',

      tratamento:
        padroes.tratamentoMaisFrequente?.valor ||
        casoMaisSimilar?.tratamento ||
        '',
    },

    observacao:
      casoMaisSimilar
        ? 'Sugestão baseada em casos históricos semelhantes. A decisão final permanece com a analista.'
        : 'Não foram encontrados casos históricos suficientemente semelhantes.',
  };
}

module.exports = {
  normalizar,
  calcularCompatibilidade,
  buscarCasosSimilares,
  detectarReincidencia,
  analisarManifestacao,
};
