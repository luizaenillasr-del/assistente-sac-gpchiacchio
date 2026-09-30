'use strict';
// ================================================================
// SERVIÇO DE ASSERTIVIDADE — v1.0
// Rastreia aceitação, edição e rejeição de tratativas e
// devolutivas para medir e melhorar a qualidade do motor IA.
// ================================================================

const sheets = require('./sheets');

const CABECALHOS_ASSERTIVIDADE = [
  'ID_REGISTRO','ID_MANIFESTACAO','ID_TRATATIVA','ID_DEVOLUTIVA',
  'TIPO_REGISTRO','DECISAO','CONFIANCA_INICIAL',
  'EMPRESA','TIPO_MANIFESTACAO','CATEGORIA','SETOR',
  'USUARIO','REGISTRADO_EM',
  'TEMPO_REVISAO_S','MOTIVO_EDICAO',
  'TAXA_EDICAO_TEXTO','ORIGEM_REGRA',
];

const CABECALHOS_RESULTADOS = [
  'ID_RESULTADO','ID_MANIFESTACAO','ID_TRATATIVA',
  'RESULTADO_FINAL','SATISFACAO_CLIENTE','REABERTA','REINCIDENTE',
  'TEMPO_TOTAL_H','PRAZO_CUMPRIDO',
  'REGISTRADO_EM','REGISTRADO_POR','EMPRESA',
];

// ── Registrar decisão (aceitar / editar / rejeitar) ───────────────
async function registrarDecisao({
  idManifestacao, idTratativa, idDevolutiva,
  tipoRegistro,  // 'TRATATIVA' | 'DEVOLUTIVA'
  decisao,       // 'ACEITA' | 'EDITADA' | 'REJEITADA'
  confiancaInicial,
  empresa, tipoManifestacao, categoria, setor,
  usuario, motivoEdicao, textoOriginal, textoEditado,
}) {
  await sheets.garantirAbaComCabecalhos('ASSERTIVIDADE', CABECALHOS_ASSERTIVIDADE).catch(() => {});

  const id = await sheets.gerarProximoID('ASSERTIVIDADE', 'ASSERT', 'ID_REGISTRO').catch(() =>
    'ASSERT-' + Date.now().toString().slice(-6)
  );

  let taxaEdicao = 0;
  if (decisao === 'EDITADA' && textoOriginal && textoEditado) {
    const orig = textoOriginal.split(/\s+/).length;
    const edit = textoEditado.split(/\s+/).length;
    const diferenca = Math.abs(orig - edit);
    taxaEdicao = orig > 0 ? Math.round((diferenca / orig) * 100) : 100;
  }

  await sheets.appendObjeto('ASSERTIVIDADE', {
    ID_REGISTRO:       id,
    ID_MANIFESTACAO:   idManifestacao || '',
    ID_TRATATIVA:      idTratativa    || '',
    ID_DEVOLUTIVA:     idDevolutiva   || '',
    TIPO_REGISTRO:     tipoRegistro   || 'TRATATIVA',
    DECISAO:           decisao,
    CONFIANCA_INICIAL: confiancaInicial || 0,
    EMPRESA:           empresa           || '',
    TIPO_MANIFESTACAO: tipoManifestacao  || '',
    CATEGORIA:         categoria         || '',
    SETOR:             setor             || '',
    USUARIO:           usuario           || 'SISTEMA',
    REGISTRADO_EM:     new Date().toISOString(),
    TEMPO_REVISAO_S:   0,
    MOTIVO_EDICAO:     motivoEdicao || '',
    TAXA_EDICAO_TEXTO: taxaEdicao,
    ORIGEM_REGRA:      '',
  });

  return { id, decisao };
}

// ── Calcular métricas de assertividade ────────────────────────────
async function calcularMetricas(filtros = {}) {
  const { empresa, tipoManifestacao, categoria, setor, dias } = filtros;
  const todos = await sheets.lerAba('ASSERTIVIDADE', 5000).catch(() => []);

  let registros = todos;

  if (empresa)           registros = registros.filter(r => r.EMPRESA === empresa);
  if (tipoManifestacao)  registros = registros.filter(r => r.TIPO_MANIFESTACAO === tipoManifestacao);
  if (categoria)         registros = registros.filter(r => r.CATEGORIA === categoria);
  if (setor)             registros = registros.filter(r => r.SETOR === setor);
  if (dias) {
    const corte = new Date();
    corte.setDate(corte.getDate() - dias);
    registros = registros.filter(r => r.REGISTRADO_EM && new Date(r.REGISTRADO_EM) >= corte);
  }

  const total     = registros.length;
  const aceitas   = registros.filter(r => r.DECISAO === 'ACEITA').length;
  const editadas  = registros.filter(r => r.DECISAO === 'EDITADA').length;
  const rejeitadas= registros.filter(r => r.DECISAO === 'REJEITADA').length;

  const txAceitacao  = total > 0 ? Math.round((aceitas   / total) * 100) : 0;
  const txEdicao     = total > 0 ? Math.round((editadas  / total) * 100) : 0;
  const txRejeicao   = total > 0 ? Math.round((rejeitadas/ total) * 100) : 0;

  const confiancaMedia = total > 0
    ? Math.round(registros.reduce((s, r) => s + (parseFloat(r.CONFIANCA_INICIAL) || 0), 0) / total)
    : 0;

  // Por tipo de registro
  const porTipo = {};
  for (const r of registros) {
    const t = r.TIPO_REGISTRO || 'TRATATIVA';
    if (!porTipo[t]) porTipo[t] = { total: 0, aceitas: 0, editadas: 0, rejeitadas: 0 };
    porTipo[t].total++;
    if (r.DECISAO === 'ACEITA')    porTipo[t].aceitas++;
    if (r.DECISAO === 'EDITADA')   porTipo[t].editadas++;
    if (r.DECISAO === 'REJEITADA') porTipo[t].rejeitadas++;
  }

  // Motivos de edição mais frequentes
  const motivosMap = {};
  for (const r of registros) {
    if (r.MOTIVO_EDICAO) {
      motivosMap[r.MOTIVO_EDICAO] = (motivosMap[r.MOTIVO_EDICAO] || 0) + 1;
    }
  }
  const motivosFrequentes = Object.entries(motivosMap)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([motivo, count]) => ({ motivo, count }));

  return {
    total,
    aceitas,
    editadas,
    rejeitadas,
    taxaAceitacao:  txAceitacao,
    taxaEdicao:     txEdicao,
    taxaRejeicao:   txRejeicao,
    confiancaMedia,
    porTipo,
    motivosFrequentes,
    geradoEm: new Date().toISOString(),
  };
}

// ── Registrar resultado final de uma manifestação ─────────────────
async function registrarResultado({
  idManifestacao, idTratativa,
  resultadoFinal, satisfacaoCliente,
  reaberta, reincidente,
  tempoTotalH, prazoCumprido,
  usuario, empresa,
}) {
  await sheets.garantirAbaComCabecalhos('TRATATIVAS_RESULTADOS', CABECALHOS_RESULTADOS).catch(() => {});

  const id = await sheets.gerarProximoID('TRATATIVAS_RESULTADOS', 'RES', 'ID_RESULTADO').catch(() =>
    'RES-' + Date.now().toString().slice(-6)
  );

  await sheets.appendObjeto('TRATATIVAS_RESULTADOS', {
    ID_RESULTADO:       id,
    ID_MANIFESTACAO:    idManifestacao  || '',
    ID_TRATATIVA:       idTratativa     || '',
    RESULTADO_FINAL:    resultadoFinal  || '',
    SATISFACAO_CLIENTE: satisfacaoCliente != null ? satisfacaoCliente : '',
    REABERTA:           reaberta    ? 'SIM' : 'NAO',
    REINCIDENTE:        reincidente ? 'SIM' : 'NAO',
    TEMPO_TOTAL_H:      tempoTotalH || '',
    PRAZO_CUMPRIDO:     prazoCumprido ? 'SIM' : 'NAO',
    REGISTRADO_EM:      new Date().toISOString(),
    REGISTRADO_POR:     usuario  || 'SISTEMA',
    EMPRESA:            empresa  || '',
  });

  return { id };
}

// ── Sugestões automáticas para administrador ─────────────────────
async function gerarSugestoes() {
  const metricas = await calcularMetricas({ dias: 30 });
  const sugestoes = [];

  if (metricas.taxaRejeicao > 20) {
    sugestoes.push({
      prioridade: 'ALTA',
      tipo: 'QUALIDADE_IA',
      mensagem: `Taxa de rejeição de ${metricas.taxaRejeicao}% nos últimos 30 dias está acima do ideal (≤20%). Revise os templates de devolutiva e as regras da MATRIZ_TRATAMENTO.`,
    });
  }

  if (metricas.taxaEdicao > 40) {
    sugestoes.push({
      prioridade: 'MEDIA',
      tipo: 'TEMPLATES',
      mensagem: `${metricas.taxaEdicao}% das sugestões foram editadas. Considere ajustar os templates base ou ampliar as regras da matriz de tratamento.`,
    });
  }

  if (metricas.confiancaMedia < 70) {
    sugestoes.push({
      prioridade: 'MEDIA',
      tipo: 'DADOS_CONTEXTO',
      mensagem: `Confiança média de ${metricas.confiancaMedia}% indica que faltam dados de contexto. Verifique se MATRIZ_TRATAMENTO e histórico de casos estão sendo preenchidos.`,
    });
  }

  if (metricas.motivosFrequentes.length > 0) {
    const top = metricas.motivosFrequentes[0];
    sugestoes.push({
      prioridade: 'BAIXA',
      tipo: 'MOTIVOS_EDICAO',
      mensagem: `Motivo de edição mais frequente: "${top.motivo}" (${top.count} ocorrências). Considere melhorar a geração para esse padrão.`,
    });
  }

  return { metricas, sugestoes };
}

module.exports = {
  registrarDecisao,
  calcularMetricas,
  registrarResultado,
  gerarSugestoes,
};
