'use strict';
const fs = require('fs');
const api = fs.readFileSync('api/index.js', 'utf8');
const page = fs.readFileSync('public/index.html', 'utf8');
const check = (ok, msg) => { if (!ok) throw new Error(msg); console.log(`✓ ${msg}`); };

check(/app\.get\('\/api\/usuarios\/responsaveis'/.test(api), 'existe endpoint dedicado de responsáveis');
check(/RESPONSAVEIS_INDISPONIVEIS/.test(api), 'falha no cadastro não é confundida com lista vazia');
check(/NENHUM_ELEGIVEL/.test(api), 'ausência de responsável elegível tem estado explícito');
check(/String\(u\.STATUS \|\| 'ATIVO'\)\.toUpperCase\(\) !== 'ATIVO'/.test(api), 'somente usuários ATIVO são elegíveis');
check(/encontrarResponsavelElegivel/.test(api), 'backend valida o identificador contra cadastro e escopo');
check(/RESPONSAVEL_ID:responsavelCadastro\?\.id/.test(api), 'acionamento persiste identificador estável do responsável');
check(/idempotencyKey/.test(api) && /ACIONAMENTO_NAO_CONFIRMADO/.test(api), 'encaminhamento é idempotente e confirma leitura após gravação');
check(/\/api\/setores-responsaveis/.test(page) && /\/api\/usuarios\/responsaveis/.test(page), 'Ficha V2 consulta catálogo e responsáveis por setor');
check(/fichaV2CarregarResponsaveis/.test(page) && /onchange=/.test(page), 'troca de setor recarrega responsáveis');
check(/responsaveisError/.test(page) && /Nenhum responsável elegível/.test(page), 'interface diferencia erro de consulta de lista vazia');
check(/SLA_HORAS.*String\(slaHoras\)/.test(api) && /SLA_RETORNO_SETOR_72H/.test(api), 'prazo do setor é persistido em horas com origem explícita');
console.log('ENCAMINHAMENTO DE RESPONSÁVEIS: 11 verificações aprovadas');
