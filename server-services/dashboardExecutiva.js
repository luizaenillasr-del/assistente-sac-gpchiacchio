'use strict';

const normalizar = valor => String(valor || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const numero = valor => {
  if (valor == null || String(valor).trim() === '') return null;
  const resultado = Number(String(valor).replace(',', '.'));
  return Number.isFinite(resultado) ? resultado : null;
};
const data = valor => {
  const resultado = new Date(valor);
  return Number.isNaN(resultado.getTime()) ? null : resultado;
};
const media = valores => valores.length ? valores.reduce((total, valor) => total + valor, 0) / valores.length : null;
const status = manifestacao => manifestacao.STATUS_FICHA || manifestacao.STATUS || 'SEM STATUS';
const encerrada = manifestacao => /ENCERR|FINALIZ|CONCLUID/.test(normalizar(status(manifestacao)));
const setor = manifestacao => manifestacao.SETOR_CONFIRMADO || manifestacao.SETOR_DESTINADO || manifestacao.SETOR_RESPONSAVEL || manifestacao.SETOR_SUGERIDO || 'Não informado';
const abertura = manifestacao => data(manifestacao.DATA_ABERTURA || manifestacao.DATA_REGISTRO || manifestacao.DATA);
const encerramento = manifestacao => data(manifestacao.DATA_ENCERRAMENTO || manifestacao.DATA_CONCLUSAO_MANIFESTACAO);
const emPeriodo = (manifestacao, inicio, fim) => {
  const dia = abertura(manifestacao);
  if (!dia) return !inicio && !fim;
  return (!inicio || dia >= inicio) && (!fim || dia <= fim);
};
const horasResolucao = manifestacao => {
  const inicio = abertura(manifestacao);
  const fim = encerramento(manifestacao);
  return inicio && fim && fim >= inicio ? (fim - inicio) / 36e5 : null;
};
// Só calcula SLA quando o registro traz um prazo válido. Não inferimos 72h
// para registros legados porque isso transforma ausência de configuração em
// um resultado aparentemente confiável.
const slaHoras = manifestacao => numero(manifestacao.SLA_HORAS);
const noPrazo = manifestacao => {
  const duracao = horasResolucao(manifestacao);
  const sla = slaHoras(manifestacao);
  return duracao != null && sla != null && duracao <= sla;
};
const vencida = (manifestacao, referencia) => {
  const sla = slaHoras(manifestacao);
  return !encerrada(manifestacao) && abertura(manifestacao) && sla != null && (referencia - abertura(manifestacao)) > sla * 36e5;
};
const proximaDoVencimento = (manifestacao, referencia) => {
  const sla = slaHoras(manifestacao);
  if (encerrada(manifestacao) || !abertura(manifestacao) || sla == null) return false;
  const decorrido = (referencia - abertura(manifestacao)) / 36e5;
  return decorrido >= sla * .75 && decorrido <= sla;
};
const chaveMes = valor => {
  const dia = data(valor);
  return dia ? `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, '0')}` : null;
};

function acumuladoPorMes(manifestacoes) {
  const meses = new Map();
  manifestacoes.forEach(manifestacao => {
    const aberto = chaveMes(manifestacao.DATA_ABERTURA || manifestacao.DATA_REGISTRO || manifestacao.DATA);
    const fechado = chaveMes(manifestacao.DATA_ENCERRAMENTO || manifestacao.DATA_CONCLUSAO_MANIFESTACAO);
    if (aberto) {
      const item = meses.get(aberto) || { mes: aberto, abertas: 0, finalizadas: 0 };
      item.abertas += 1; meses.set(aberto, item);
    }
    if (fechado) {
      const item = meses.get(fechado) || { mes: fechado, abertas: 0, finalizadas: 0 };
      item.finalizadas += 1; meses.set(fechado, item);
    }
  });
  return [...meses.values()].sort((a, b) => a.mes.localeCompare(b.mes)).slice(-6);
}

function satisfacaoPorMes(respostas) {
  const grupos = new Map();
  respostas.forEach(resposta => {
    const dia = data(resposta.DATA || resposta.DATA_RESPOSTA || resposta.DATA_CRIACAO || resposta.CREATED_AT);
    const chave = chaveMes(dia);
    if (!chave) return;
    const item = grupos.get(chave) || { mes: chave, notas: [], recomendacoes: [] };
    ['ATENDIMENTO', 'PRAZO_ENTREGA', 'QUALIDADE'].forEach(campo => {
      const nota = numero(resposta[campo]); if (nota != null) item.notas.push(nota);
    });
    const recomendacao = numero(resposta.RECOMENDACAO);
    if (recomendacao != null && recomendacao >= 0 && recomendacao <= 10) item.recomendacoes.push(recomendacao);
    grupos.set(chave, item);
  });
  return [...grupos.values()].sort((a,b)=>a.mes.localeCompare(b.mes)).slice(-6).map(item => {
    const promotores = item.recomendacoes.filter(n=>n>=9).length;
    const detratores = item.recomendacoes.filter(n=>n<=6).length;
    return { mes:item.mes, media:media(item.notas), nps:item.recomendacoes.length ? Math.round((promotores-detratores)/item.recomendacoes.length*100) : null };
  });
}

function calcular({ manifestacoes = [], respostas = [], logsIA = [], inicio = null, fim = null, referencia = new Date() }) {
  const mans = manifestacoes.filter(manifestacao => emPeriodo(manifestacao, inicio, fim));
  const abertas = mans.filter(manifestacao => !encerrada(manifestacao));
  const finalizadas = mans.filter(encerrada);
  const resolvidas = finalizadas.filter(manifestacao => horasResolucao(manifestacao) != null);
  const atrasadas = abertas.filter(manifestacao => vencida(manifestacao, referencia));
  const proximasVencimento = abertas.filter(manifestacao => proximaDoVencimento(manifestacao, referencia));
  const porStatus = {}, porCausa = {}, porSetor = new Map();

  mans.forEach(manifestacao => {
    const nomeStatus = status(manifestacao);
    porStatus[nomeStatus] = (porStatus[nomeStatus] || 0) + 1;
    const causa = String(manifestacao.CAUSA_RAIZ_CONFIRMADA || '').trim();
    if (causa) porCausa[causa] = (porCausa[causa] || 0) + 1;
    const nomeSetor = setor(manifestacao);
    const item = porSetor.get(nomeSetor) || { setor: nomeSetor, volume: 0, atrasadas: 0, tempos: [] };
    item.volume += 1;
    if (vencida(manifestacao, referencia)) item.atrasadas += 1;
    const duracao = horasResolucao(manifestacao);
    if (duracao != null) item.tempos.push(duracao);
    porSetor.set(nomeSetor, item);
  });

  const notasPorDimensao = ['ATENDIMENTO', 'PRAZO_ENTREGA', 'QUALIDADE', 'RECOMENDACAO'].map(campo => ({
    criterio: campo,
    media: media(respostas.map(resposta => numero(resposta[campo])).filter(nota => nota != null)),
  }));
  const notas = notasPorDimensao.flatMap(item => respostas.map(resposta => numero(resposta[item.criterio])).filter(nota => nota != null));
  const recomendacoes = respostas.map(resposta => numero(resposta.RECOMENDACAO)).filter(nota => nota != null && nota >= 0 && nota <= 10);
  const promotores = recomendacoes.filter(nota => nota >= 9).length;
  const neutros = recomendacoes.filter(nota => nota >= 7 && nota <= 8).length;
  const detratores = recomendacoes.filter(nota => nota <= 6).length;
  const criticas = respostas.filter(resposta => ['ATENDIMENTO', 'PRAZO_ENTREGA', 'QUALIDADE', 'RECOMENDACAO'].some(campo => (numero(resposta[campo]) ?? 11) <= 6));
  const analisesIA = logsIA.filter(log => /IA|CEREBRO/.test(normalizar(log.ACAO || log.TIPO || log.MODULO)));
  const decisoes = { aceitas: 0, editadas: 0, rejeitadas: 0 };
  analisesIA.forEach(log => {
    const decisao = normalizar(log.DECISAO_IA || log.DECISAO_HUMANA || log.RESULTADO || '');
    if (/ACEIT/.test(decisao)) decisoes.aceitas += 1;
    else if (/EDIT|PARCIAL/.test(decisao)) decisoes.editadas += 1;
    else if (/REJEIT/.test(decisao)) decisoes.rejeitadas += 1;
  });

  const alertas = [
    ...atrasadas.slice(0, 5).map(manifestacao => ({ tipo: 'vencida', titulo: `${manifestacao.PROTOCOLO || manifestacao.ID || 'Manifestação'} vencida`, detalhe: `${setor(manifestacao)} · prazo excedido`, id: manifestacao.ID || manifestacao.PROTOCOLO })),
    ...proximasVencimento.slice(0, 4).map(manifestacao => ({ tipo: 'proxima', titulo: `${manifestacao.PROTOCOLO || manifestacao.ID || 'Manifestação'} próxima do vencimento`, detalhe: setor(manifestacao), id: manifestacao.ID || manifestacao.PROTOCOLO })),
    ...abertas.filter(manifestacao => /TRIAGEM|ANALISE|DECISAO/.test(normalizar(status(manifestacao)))).slice(0, 4).map(manifestacao => ({ tipo: 'triagem', titulo: `${manifestacao.PROTOCOLO || manifestacao.ID || 'Manifestação'} aguardando triagem`, detalhe: setor(manifestacao), id: manifestacao.ID || manifestacao.PROTOCOLO })),
    ...abertas.filter(manifestacao => /VALIDACAO/.test(normalizar(status(manifestacao)))).slice(0, 4).map(manifestacao => ({ tipo: 'validacao', titulo: `${manifestacao.PROTOCOLO || manifestacao.ID || 'Manifestação'} aguardando validação SAC`, detalhe: setor(manifestacao), id: manifestacao.ID || manifestacao.PROTOCOLO })),
  ].slice(0, 8);
  const totalComSla = resolvidas.length;
  const concluidasNoPrazo = resolvidas.filter(noPrazo).length;
  const setores = [...porSetor.values()].map(item => {
    const encerradasSetor = mans.filter(m=>setor(m)===item.setor && encerrada(m));
    const elegiveisSetor = encerradasSetor.filter(m=>horasResolucao(m)!=null && slaHoras(m)!=null);
    return {
      ...item,
      finalizadas: encerradasSetor.length,
      slaCumprido: elegiveisSetor.length ? Math.round(elegiveisSetor.filter(noPrazo).length / elegiveisSetor.length * 100) : null,
      tempoMedio: media(item.tempos),
    };
  }).sort((a, b) => b.volume - a.volume);

  return {
    geral: {
      abertasPeriodo: abertas.length, finalizadasPeriodo: finalizadas.length, emAndamento: abertas.length, vencidas: atrasadas.length,
      aguardandoTriagem: abertas.filter(manifestacao => /TRIAGEM|ANALISE|DECISAO/.test(normalizar(status(manifestacao)))).length,
      aguardandoAprovacao: abertas.filter(manifestacao => /APROVA/.test(normalizar(status(manifestacao)))).length,
      aguardandoValidacao: abertas.filter(manifestacao => /VALIDACAO/.test(normalizar(status(manifestacao)))).length,
      proximasVencimento: proximasVencimento.length,
      tempoMedioResolucao: media(resolvidas.map(horasResolucao).filter(horas => horas != null)),
      cumprimentoSLA: totalComSla ? Math.round(concluidasNoPrazo / totalComSla * 100) : null,
      status: porStatus, causas: Object.entries(porCausa).sort((a, b) => b[1] - a[1]).slice(0, 8), setores: setores.slice(0, 8),
      evolucao: acumuladoPorMes(mans), alertas,
    },
    satisfacao: {
      nps: recomendacoes.length ? Math.round((promotores - detratores) / recomendacoes.length * 100) : null,
      media: media(notas), respostas: respostas.length, promotores, neutros, detratores, criticas: criticas.length,
      criterios: notasPorDimensao, distribuicao: { promotores, neutros, detratores }, evolucao: satisfacaoPorMes(respostas),
    },
    operacao: {
      cumprimentoSLAInterno: totalComSla ? Math.round(concluidasNoPrazo / totalComSla * 100) : null,
      tempoMedioResolucao: media(resolvidas.map(horasResolucao).filter(horas => horas != null)),
      concluidasNoPrazo, concluidasEmAtraso: totalComSla - concluidasNoPrazo,
      retrabalho: mans.filter(manifestacao => /COMPLEMENT/.test(normalizar([status(manifestacao), manifestacao.MOTIVO_DEVOLUCAO].filter(Boolean).join(' ')))).length,
      setores, proximasVencimento: proximasVencimento.length,
    },
    ia: { analises: analisesIA.length, taxaUtilizacao: manifestacoes.length ? Math.round(analisesIA.length / manifestacoes.length * 100) : null, aceitas: decisoes.aceitas, editadas: decisoes.editadas, rejeitadas: decisoes.rejeitadas, dadosInsuficientes: analisesIA.length === 0 },
  };
}

module.exports = { calcular };
