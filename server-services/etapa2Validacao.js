'use strict';

const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

function classificacaoTipos(descricao, tipos = []) {
  const texto = norm(descricao);
  const candidatos = tipos.filter(t => String(t.ATIVO || 'SIM').toUpperCase() === 'SIM').map(t => {
    const palavras = String(t.PALAVRAS_CHAVE || '').split(',').map(norm).filter(p => p.length >= 4);
    const correspondencias = palavras.filter(p => texto.includes(p));
    const percentual = palavras.length ? correspondencias.length / palavras.length : 0;
    return { tipo: t.TIPO || t.ID_TIPO || '', tipoID: t.ID_TIPO || '', correspondencias, percentual, origem: 'TIPOS_RECLAMACAO' };
  }).filter(c => c.tipo && c.correspondencias.length && c.percentual >= 0.5).sort((a,b) => b.percentual - a.percentual);
  const escolhido = candidatos[0] || null;
  return {
    escolhido,
    candidatos: candidatos.slice(0, 5),
    confianca: escolhido ? Math.round(escolhido.percentual * 100) : 0,
    // Uma correspondência textual é hipótese de triagem, nunca classificação
    // definitiva. O SAC precisa validar mesmo quando há candidato.
    status: escolhido ? 'PENDENTE_VALIDACAO' : 'NAO_IDENTIFICADO',
    justificativa: escolhido
      ? 'Correspondência parcial com TIPOS_RECLAMACAO; validação humana obrigatória.'
      : 'Nenhuma regra ativa atingiu o limiar de correspondência.',
  };
}

function alertaProduto(produto, descricao) {
  const cadastrado = norm(produto), relato = norm(descricao);
  if (!cadastrado || !relato) return null;
  const equivalentes = valor => new Set(norm(valor).split(/\s+/)
    .map(t => t.replace(/s$/, ''))
    .filter(t => t.length >= 3 && !['com','para','dos','das','uma','um'].includes(t)));
  const cadastroTokens = equivalentes(cadastrado);
  const relatoTokens = equivalentes(relato);
  // Descrições compostas equivalentes ("pote plástico com tampa" e
  // "potes, tampas") não devem gerar falso alerta.
  const intersecao = [...cadastroTokens].filter(t => relatoTokens.has(t));
  if (intersecao.length && intersecao.length >= Math.min(2, cadastroTokens.size)) return null;
  const termos = ['pote','potes','copo','copos','sacola','sacolas','mangueira','tampa','tampas','embalagem'];
  const mencionados = termos.filter(t => relato.includes(t) && ![...cadastroTokens].some(c => t.replace(/s$/,'') === c));
  return mencionados.length ? { codigo: 'PRODUTO_RELATO_DIVERGENTE', produtoCadastrado: produto, termosRelato: mencionados, requerValidacaoHumana: true } : null;
}

function slaOperacional(procedimentoHoras) {
  return { triagemSAC: 24, retornoSetor: 72, retornoCliente: 96, procedimento: Number(procedimentoHoras) || null };
}

function filtrarColetas(acoes = [], m = {}) {
  const disponivel = {
    nf: Boolean(m.NFE || m.NF || m.nfe),
    lote: Boolean(m.LOTE || m.lote),
    evidencia: Boolean(m.ANEXOS || m.anexos || m.EVIDENCIAS),
  };
  return acoes.map(a => {
    let descricao = String(a.descricao || '');
    const antes = descricao;
    const itens = [
      { chave:'nf', re:/\b(?:NF(?:\/e)?|nota fiscal)\b/ig },
      { chave:'lote', re:/\blote\b/ig },
      { chave:'evidencia', re:/\b(?:foto|fotos|imagem|imagens|anexo|anexos)\b/ig },
    ];
    itens.filter(i => disponivel[i.chave]).forEach(i => { descricao = descricao.replace(i.re, ''); });
    descricao = descricao
      .replace(/\s*,\s*(?=,|ou\b|e\b)/ig, ' ')
      .replace(/\b(?:solicitar|coletar|pedir)\s+(?:e|ou)\s+/ig, '')
      .replace(/\b(?:solicitar|coletar|pedir)\s*(?=,|ou\b|e\b|como\b)/ig, '')
      .replace(/^\s*(?:e|ou)\s+/ig, '')
      .replace(/\s+(?:e|ou)\s+(?=como\b|para\b|evid[eê]ncia\b)/ig, ' ')
      .replace(/^[\s,;:-]+|[\s,;:-]+$/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/^(?:como|para)\s+evid[eê]ncia\s*$/i, '')
      .replace(/^(?:solicitar|coletar|pedir)$/i, '')
      .trim();
    if (!descricao) return null;
    // Se nada foi alterado, preservar a ação integralmente.
    return descricao === antes ? a : { ...a, descricao };
  }).filter(Boolean);
}

module.exports = { classificacaoTipos, alertaProduto, slaOperacional, filtrarColetas };
