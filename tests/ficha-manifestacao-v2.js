'use strict';
const fs = require('fs');
const html = fs.readFileSync('public/index.html','utf8');
const checks = [
  ['página V2 registrada', html.includes('id="page-ficha-manifestacao-v2"')],
  ['layout da referência (SLA, tabs e anexos)', ['fv2-sla','Dados','Triagem e Direcionamento','Tratativa','Validação e Devolutiva','Histórico','fv2-attachments'].every(x=>html.includes(x))],
  ['abertura do dossiê navega para a ficha V2', html.includes('window.fichaV2Open') && html.includes('ficha-manifestacao-v2-final-bridge') && html.includes('window.abrirDossie = function(item){ return window.fichaV2Open(item); }')],
  ['carregamento de dados reais', html.includes("/api/manifestacoes/'+encodeURIComponent(S.id)") && html.includes('DESCRICAO_ORIGINAL') && html.includes('ID_MANIFESTACAO')],
  ['anexos vinculados e upload integrado', html.includes("/api/manifestacoes/'+key+'/evidencias") && html.includes("_apiFetch('/api/anexos'")],
  ['histórico e CIRCA persistidos', html.includes("/historico") && html.includes("/circa")],
  ['ações usam ficha existente', html.includes("/api/manifestacoes/'+encodeURIComponent(id())+'/ficha") && html.includes("acao:'encaminhar_setor") && html.includes("acao:'salvar_investigacao")],
  ['não usa dados fictícios do standalone', !html.includes('PLAS-MVS6GPQV9JF')],
];
let fail=0; for(const [name,ok] of checks){console.log(`${ok?'PASS':'FAIL'} — ${name}`);if(!ok)fail++;}
if(fail) process.exit(1);
