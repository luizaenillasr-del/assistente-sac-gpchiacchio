'use strict';

/**
 * Contrato de dados do CIRCA.
 *
 * Este módulo é deliberadamente puro: não lê credenciais, não acessa Sheets
 * ou PostgreSQL e não faz qualquer escrita. Ele valida objetos já carregados
 * por um inventário autorizado e devolve somente contagens, IDs técnicos e
 * motivos sanitizados.
 */

const EMPRESA_ALIASES = new Map([
  ['chiacchio', 'CHIACCHIO'],
  ['chiacchio embalagens', 'CHIACCHIO'],
  ['chiachio embalagens', 'CHIACCHIO'],
  ['plaschio', 'PLASCHIO'],
  ['tubahia', 'TUBAHIA'],
  ['cesbap', 'TUBAHIA'],
]);

const STATUS_MANIFESTACAO = new Set([
  'RASCUNHO', 'AGUARDANDO_TRIAGEM_SAC', 'ABERTA', 'EM_ANALISE',
  'EM_TRATAMENTO', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_DEVOLUTIVA',
  'ENCERRADA', 'FINALIZADA', 'CANCELADA',
]);

const STATUS_HISTORICO = new Set(['PROCESSANDO', 'CONCLUIDO', 'ENCERRADO', 'ATIVO']);

const FONTES_CANONICAS = Object.freeze({
  identidade: { sistema: 'POSTGRESQL', entidades: ['empresas', 'usuarios', 'perfis', 'setores', 'responsaveis'] },
  manifestacoes: { sistema: 'GOOGLE_SHEETS', aba: 'MANIFESTACOES', chave: 'ID_MANIFESTACAO/PROTOCOLO' },
  tratativas: { sistema: 'POSTGRESQL', entidades: ['tratativas', 'tratativa_acoes', 'resultados_tratamento'] },
  acionamentos: { sistema: 'GOOGLE_SHEETS', aba: 'ACIONAMENTOS_INTERNOS', chave: 'ID_ACIONAMENTO/ID_MANIFESTACAO' },
  historico: { sistema: 'GOOGLE_SHEETS', aba: 'BANCO_HISTORICO', chave: 'ID_HISTORICO/ORIG_ID_MANIFESTACAO' },
  matrizTratamento: { sistema: 'GOOGLE_SHEETS', aba: 'MATRIZ_TRATAMENTO', chave: 'ID_TRATAMENTO (ou ID_REGRA legado)' },
  causas: { sistema: 'GOOGLE_SHEETS', aba: 'CAUSAS', chave: 'ID_CAUSA' },
  devolutivasModelo: { sistema: 'GOOGLE_SHEETS', aba: 'MODELOS_DEVOLUTIVA', chave: 'ID_MODELO/ID_DEVOLUTIVA' },
  devolutivasRealizadas: { sistema: 'POSTGRESQL', entidade: 'devolutivas', chave: 'id/manifestacao_id' },
  aprendizado: { sistema: 'GOOGLE_SHEETS', abas: ['CEREBRO_APRENDIZADO', 'APRIMORAMENTOS_CEREBRO'], chave: 'ID' },
});

function texto(v) {
  return String(v ?? '').trim();
}

function normalizarEmpresa(v) {
  const valor = texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  return EMPRESA_ALIASES.get(valor) || (valor ? valor.toUpperCase() : null);
}

function idTecnico(row = {}, campos = []) {
  for (const campo of campos) {
    const valor = texto(row[campo]);
    if (valor) return valor;
  }
  return null;
}

function contarDuplicados(rows, campos) {
  const ids = new Map();
  for (const row of rows || []) {
    const id = idTecnico(row, campos);
    if (!id) continue;
    ids.set(id, (ids.get(id) || 0) + 1);
  }
  return [...ids.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function validarManifestacoes(rows = []) {
  const itens = rows.map(row => {
    const id = idTecnico(row, ['ID_MANIFESTACAO', 'PROTOCOLO', 'ID']);
    const status = texto(row.STATUS || row.STATUS_FICHA).toUpperCase();
    const empresa = normalizarEmpresa(row.EMPRESA_NORMALIZADA || row.EMPRESA_RECLAMADA || row.EMPRESA);
    const motivos = [];
    if (!id) motivos.push('ID_AUSENTE');
    if (!empresa) motivos.push('EMPRESA_AUSENTE');
    if (!texto(row.DESCRICAO_ORIGINAL || row.DESCRICAO_RECLAMACAO || row.DESCRICAO)) motivos.push('RELATO_ORIGINAL_AUSENTE');
    if (status && !STATUS_MANIFESTACAO.has(status)) motivos.push('STATUS_NAO_PADRONIZADO');
    if (texto(row.CAUSA_RAIZ_CONFIRMADA) && !texto(row.CAUSA_CONFIRMADA_POR || row.CAUSA_EVIDENCIA)) motivos.push('CAUSA_CONFIRMADA_SEM_EVIDENCIA');
    return { id, empresa, status: status || null, elegivel: motivos.length === 0, motivos };
  });
  return { total: itens.length, elegiveis: itens.filter(i => i.elegivel).length, itens, duplicados: contarDuplicados(rows, ['ID_MANIFESTACAO', 'PROTOCOLO', 'ID']) };
}

function validarMatriz(rows = []) {
  const itens = rows.map(row => {
    const id = idTecnico(row, ['ID_TRATAMENTO', 'ID_REGRA', 'ID']);
    const ativo = !['NAO', 'NÃO', 'INATIVO', '0', 'FALSE'].includes(texto(row.ATIVO).toUpperCase()) &&
      !['INATIVO', 'RASCUNHO', 'DESCARTADO'].includes(texto(row.STATUS).toUpperCase());
    const campos = {
      id, empresa: texto(row.EMPRESA), tipo: texto(row.TIPO_MANIFESTACAO || row.TIPO),
      categoria: texto(row.CATEGORIA), subcategoria: texto(row.SUBCATEGORIA || row.SUBCAUSA),
      setor: texto(row.SETOR_RESPONSAVEL || row.SETOR),
      procedimento: texto(row.TRATATIVA_OBRIGATORIA || row.TRATATIVA_RECOMENDADA || row.TRATATIVA_PADRAO || row.PROCEDIMENTO),
    };
    const motivos = Object.entries(campos).filter(([campo, valor]) => campo !== 'subcategoria' && !valor).map(([campo]) => `${campo.toUpperCase()}_AUSENTE`);
    if (!ativo) motivos.push('INATIVA');
    return { id, ativo, camposPresentes: Object.fromEntries(Object.entries(campos).map(([k, v]) => [k, Boolean(v)])), elegivelEstruturalmente: motivos.length === 0, motivos };
  });
  return { total: itens.length, elegiveis: itens.filter(i => i.elegivelEstruturalmente).length, itens, duplicados: contarDuplicados(rows, ['ID_TRATAMENTO', 'ID_REGRA', 'ID']) };
}

function validarHistorico(rows = []) {
  const itens = rows.map(row => {
    const id = idTecnico(row, ['ID_HISTORICO', 'ORIG_ID_MANIFESTACAO', 'ID']);
    const empresa = normalizarEmpresa(row.DRV_EMPRESA_NORMALIZADA || row.EMPRESA || row.EMPRESA_RECLAMADA);
    const status = texto(row.STATUS_HISTORICO || row.STATUS).toUpperCase();
    const motivos = [];
    if (!id) motivos.push('ID_AUSENTE');
    if (!empresa) motivos.push('EMPRESA_AUSENTE');
    if (status && !STATUS_HISTORICO.has(status)) motivos.push('STATUS_NAO_PADRONIZADO');
    if (!texto(row.ORIG_DESCRICAO_RECLAMACAO || row.DESCRICAO || row.DESCRICAO_ORIGINAL)) motivos.push('RELATO_AUSENTE');
    if (status === 'PROCESSANDO') motivos.push('PROCESSAMENTO_INCOMPLETO');
    return { id, empresa, status: status || null, elegivelSimilaridade: motivos.length === 0, elegivelReincidencia: motivos.length === 0 && Boolean(empresa), motivos };
  });
  return { total: itens.length, similares: itens.filter(i => i.elegivelSimilaridade).length, reincidencias: itens.filter(i => i.elegivelReincidencia).length, itens, duplicados: contarDuplicados(rows, ['ID_HISTORICO', 'ORIG_ID_MANIFESTACAO', 'ID']) };
}

function validarModelosDevolutiva(rows = []) {
  const itens = rows.map(row => {
    const id = idTecnico(row, ['ID_MODELO', 'ID_DEVOLUTIVA', 'ID']);
    const status = texto(row.STATUS).toUpperCase();
    const motivos = [];
    if (!id) motivos.push('ID_AUSENTE');
    if (!texto(row.TEXTO_PADRAO || row.TEXTO || row.CONTEUDO)) motivos.push('TEXTO_AUSENTE');
    if (!['APROVADA', 'APROVADO', 'PUBLICADA'].includes(status)) motivos.push('NAO_APROVADO');
    return { id, aprovado: motivos.length === 0, motivos };
  });
  return { total: itens.length, aprovados: itens.filter(i => i.aprovado).length, itens, duplicados: contarDuplicados(rows, ['ID_MODELO', 'ID_DEVOLUTIVA', 'ID']) };
}

function validarBaseCirca({ manifestacoes = [], matrizTratamento = [], bancoHistorico = [], modelosDevolutiva = [] } = {}) {
  return {
    fontes: FONTES_CANONICAS,
    manifestacoes: validarManifestacoes(manifestacoes),
    matrizTratamento: validarMatriz(matrizTratamento),
    bancoHistorico: validarHistorico(bancoHistorico),
    modelosDevolutiva: validarModelosDevolutiva(modelosDevolutiva),
  };
}

module.exports = {
  FONTES_CANONICAS,
  normalizarEmpresa,
  validarManifestacoes,
  validarMatriz,
  validarHistorico,
  validarModelosDevolutiva,
  validarBaseCirca,
};
