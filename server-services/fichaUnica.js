'use strict';

// Regras de domínio da ficha única. Mantê-las fora da UI evita que cada tela
// interprete o fluxo de uma manifestação de forma diferente.
const CANAIS = {
  TELEFONE: '01', EMAIL: '02', 'E-MAIL': '02', WHATSAPP: '03',
  PRESENCIAL: '04', PESQUISA: '05', 'PESQUISA DE SATISFACAO': '05',
  PORTAL: '06', 'PORTAL DO CLIENTE': '06', COLABORADOR: '07', OUTROS: '09'
};

function normalizar(valor) {
  return String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
}

function prefixoEmpresa(empresa) {
  const nome = normalizar(empresa);
  if (nome.includes('PLAS')) return 'PLA';
  if (nome.includes('TUB') || nome.includes('CESBAP') || nome.includes('CESB')) return 'TUB';
  return 'CHIA';
}

function codigoCanal(canal) {
  const chave = normalizar(canal);
  return CANAIS[chave] || '09';
}

function unidadeEmpresa(empresa) {
  const nome = normalizar(empresa);
  if (nome.includes('PLAS')) return 'caixas';
  if (nome.includes('TUB') || nome.includes('CESBAP') || nome.includes('CESB')) return 'rolos';
  return 'kg';
}

function dataProtocolo(data = new Date()) {
  const d = new Date(data);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}${mes}${dia}`;
}

function montarProtocolo({ empresa, canal, data, sequencial }) {
  return `${prefixoEmpresa(empresa)}-${dataProtocolo(data)}-${codigoCanal(canal)}-${String(sequencial).padStart(4, '0')}`;
}

function etapaAtual(manifestacao = {}) {
  const status = normalizar(manifestacao.STATUS_FICHA || manifestacao.STATUS);
  if (/ENCERRAD|FECHAD|REJEITAD|CANCELAD/.test(status)) return 6;
  if (/DEVOLUTIVA/.test(status)) return 5;
  if (/VALIDACAO/.test(status)) return 4;
  if (/TRATATIVA|ANDAMENTO|SETOR/.test(status)) return 3;
  if (/TRIAGEM|ANALISE|APROVACAO|DECISAO|RECEBID/.test(status)) return 2;
  return 1;
}

function mensagemContextual(manifestacao = {}) {
  const status = normalizar(manifestacao.STATUS_FICHA || manifestacao.STATUS);
  const setor = manifestacao.SETOR_CONFIRMADO || manifestacao.SETOR_DESTINADO || '';
  const responsavel = manifestacao.RESPONSAVEL_SETOR || manifestacao.RESPONSAVEL_SAC || manifestacao.RESPONSAVEL || '';
  if (/ENCERRAD|FECHAD/.test(status)) return 'Manifestação encerrada.';
  if (/DEVOLUTIVA/.test(status)) return 'Devolutiva pendente.';
  if (/VALIDACAO/.test(status)) return 'Aguardando validação do SAC.';
  if (/AGUARDANDO.*SETOR/.test(status)) return `Aguardando aceite do setor de ${setor || 'destino'}.`;
  if (/TRATATIVA|ANDAMENTO/.test(status)) return `Em tratativa${responsavel ? ` com ${responsavel}` : ''}${setor ? ` — ${setor}` : ''}.`;
  if (/TRIAGEM|ANALISE|APROVACAO|DECISAO|RECEBID/.test(status)) return 'Aguardando triagem SAC.';
  return 'Dados da manifestação em preenchimento.';
}

module.exports = { codigoCanal, dataProtocolo, etapaAtual, mensagemContextual, montarProtocolo, prefixoEmpresa, unidadeEmpresa };
