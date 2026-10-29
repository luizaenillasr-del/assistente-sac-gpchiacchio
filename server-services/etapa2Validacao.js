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
  return { escolhido, candidatos: candidatos.slice(0, 5), confianca: escolhido ? Math.round(escolhido.percentual * 100) : 0 };
}

function alertaProduto(produto, descricao) {
  const cadastrado = norm(produto), relato = norm(descricao);
  if (!cadastrado || !relato || relato.includes(cadastrado)) return null;
  const termos = ['pote','potes','copo','copos','sacola','sacolas','mangueira','tampa','tampas','embalagem'];
  const mencionados = termos.filter(t => relato.includes(t) && !cadastrado.includes(t));
  return mencionados.length ? { codigo: 'PRODUTO_RELATO_DIVERGENTE', produtoCadastrado: produto, termosRelato: mencionados, requerValidacaoHumana: true } : null;
}

function slaOperacional(procedimentoHoras) {
  return { triagemSAC: 24, retornoSetor: 72, retornoCliente: 96, procedimento: Number(procedimentoHoras) || null };
}

function filtrarColetas(acoes = [], m = {}) {
  const texto = a => String(a.descricao || '').toLowerCase();
  const nf = m.NFE || m.NF || m.nfe;
  const lote = m.LOTE || m.lote;
  const anexos = m.ANEXOS || m.anexos || m.EVIDENCIAS;
  return acoes.map(a => {
    let descricao = String(a.descricao || '');
    if (nf) descricao = descricao.replace(/(?:solicitar|coletar|pedir)\s+(?:a\s+)?(?:NF|nota fiscal)\s*(?:e\s*)?/ig, '').trim();
    if (lote) descricao = descricao.replace(/(?:solicitar|coletar|pedir)\s+(?:o\s+)?lote\s*(?:e\s*)?/ig, '').trim();
    if (anexos) descricao = descricao.replace(/(?:solicitar|coletar|pedir)\s+(?:fotos?|imagens?|anexos?)\s*(?:e\s*)?/ig, '').trim();
    return descricao ? { ...a, descricao } : null;
  }).filter(Boolean);
}

module.exports = { classificacaoTipos, alertaProduto, slaOperacional, filtrarColetas };
