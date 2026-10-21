'use strict';
const normalizar = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
const fechado = m => /ENCERR|FINALIZ|CONCLUID/.test(normalizar(m.STATUS_FICHA || m.STATUS));
const numero = v => {
  if (v == null || String(v).trim() === '') return null;
  const n=Number(String(v).replace(',','.'));
  return Number.isFinite(n)?n:null;
};
const data = v => { const d=new Date(v); return Number.isNaN(d.getTime())?null:d; };
function emPeriodo(m, inicio, fim) {
  const d=data(m.DATA_ABERTURA||m.DATA_REGISTRO||m.DATA);
  if (!d) return !inicio && !fim;
  return (!inicio||d>=inicio) && (!fim||d<=fim);
}
function media(xs){ return xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : null; }
function calcular({ manifestacoes=[], respostas=[], logsIA=[], inicio=null, fim=null }) {
  const mans=manifestacoes.filter(m=>emPeriodo(m,inicio,fim));
  const abertas=mans.filter(m=>!fechado(m)); const finalizadas=mans.filter(fechado);
  const sla=finalizadas.filter(m=>m.DATA_ABERTURA&& (m.DATA_ENCERRAMENTO||m.DATA_CONCLUSAO_MANIFESTACAO));
  const tempos=sla.map(m=>{const a=data(m.DATA_ABERTURA),f=data(m.DATA_ENCERRAMENTO||m.DATA_CONCLUSAO_MANIFESTACAO);return a&&f?(f-a)/36e5:null;}).filter(n=>n!=null&&n>=0);
  const status={}; mans.forEach(m=>{const s=m.STATUS_FICHA||m.STATUS||'SEM STATUS';status[s]=(status[s]||0)+1;});
  const causas={}; mans.forEach(m=>{const c=m.CAUSA_RAIZ_CONFIRMADA||'';if(c)causas[c]=(causas[c]||0)+1;});
  const notas=respostas.flatMap(r=>['ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO'].map(k=>numero(r[k])).filter(n=>n!=null));
  const rec=respostas.map(r=>numero(r.RECOMENDACAO)).filter(n=>n!=null&&n>=0&&n<=10);
  const prom=rec.filter(n=>n>=9).length, neut=rec.filter(n=>n>=7&&n<=8).length, det=rec.filter(n=>n<=6).length;
  const porCriterio=['ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO'].map(k=>({criterio:k,media:media(respostas.map(r=>numero(r[k])).filter(n=>n!=null))}));
  const acoes=logsIA.filter(l=>String(l.ACAO||'').includes('IA'));
  return { geral:{abertasPeriodo:abertas.length,finalizadasPeriodo:finalizadas.length,emAndamento:abertas.length,aguardandoTriagem:mans.filter(m=>/TRIAGEM|ANALISE|DECISAO/.test(normalizar(m.STATUS))).length,aguardandoValidacao:mans.filter(m=>/VALIDACAO/.test(normalizar(m.STATUS))).length,tempoMedioResolucao:media(tempos),cumprimentoSLA:sla.length?Math.round(sla.filter(m=>{const a=data(m.DATA_ABERTURA),f=data(m.DATA_ENCERRAMENTO||m.DATA_CONCLUSAO_MANIFESTACAO),h=numero(m.SLA_HORAS)||72;return a&&f&&(f-a)<=h*36e5;}).length/sla.length*100):null,status,causas:Object.entries(causas).sort((a,b)=>b[1]-a[1]).slice(0,8)}, satisfacao:{nps:rec.length?Math.round((prom-det)/rec.length*100):null,media:media(notas),respostas:respostas.length,promotores:prom,neutros:neut,detratores:det,criticas:respostas.filter(r=>['ATENDIMENTO','PRAZO_ENTREGA','QUALIDADE','RECOMENDACAO'].some(k=>(numero(r[k])??11)<=6)).length,criterios:porCriterio}, operacao:{tempoMedioResolucao:media(tempos),concluidasNoPrazo:sla.length?slasNoPrazo(sla):null,retrabalho:mans.filter(m=>/COMPLEMENT/.test(normalizar([m.STATUS,m.STATUS_FICHA,m.MOTIVO_DEVOLUCAO].filter(Boolean).join(' ')))).length}, ia:{analises:acoes.length,dadosInsuficientes:acoes.length===0} };
}
function slasNoPrazo(items){return items.filter(m=>{const a=data(m.DATA_ABERTURA),f=data(m.DATA_ENCERRAMENTO||m.DATA_CONCLUSAO_MANIFESTACAO),h=numero(m.SLA_HORAS)||72;return a&&f&&(f-a)<=h*36e5;}).length;}
module.exports={calcular};
