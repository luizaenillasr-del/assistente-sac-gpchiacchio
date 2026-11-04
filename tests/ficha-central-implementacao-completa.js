'use strict';
// Testes funcionais: Ficha Única V2 + Central SAC — implementação integral
// Cobertura: investigação CIRCA, tratativa cronológica, dossiê, visões, renderFilaGrupos agrupada

var assert = require('assert');
var path = require('path');
var fs = require('fs');

var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
var apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf-8');

// ─── 1. FICHA V2 — INVESTIGAÇÃO CIRCA (7 campos obrigatórios) ─────────────────
assert.ok(html.includes('fv2-inv-o-que'), 'renderTreatment deve ter campo fv2-inv-o-que (O que aconteceu)');
assert.ok(html.includes('fv2-inv-como'), 'renderTreatment deve ter campo fv2-inv-como (Como aconteceu)');
assert.ok(html.includes('fv2-inv-quando'), 'renderTreatment deve ter campo fv2-inv-quando (Quando)');
assert.ok(html.includes('fv2-inv-onde'), 'renderTreatment deve ter campo fv2-inv-onde (Onde)');
assert.ok(html.includes('fv2-inv-quem'), 'renderTreatment deve ter campo fv2-inv-quem (Quem)');
assert.ok(html.includes('fv2-inv-notas'), 'renderTreatment deve ter campo fv2-inv-notas (Notas)');
assert.ok(html.includes('fv2-inv-evidencias'), 'renderTreatment deve ter campo fv2-inv-evidencias (Evidências)');
assert.ok(html.includes('fv2-inv-hipotese'), 'renderTreatment deve ter campo fv2-inv-hipotese (Hipótese/Subcausa)');

// ─── 2. CIRCA — recomendações reais, seleção, rastreabilidade ─────────────────
assert.ok(html.includes('circa.tratativas') || html.includes('circaTrats'), 'CIRCA deve renderizar lista de tratativas sugeridas');
assert.ok(html.includes('circa-trat-') || html.includes('circa_trat'), 'CIRCA deve ter inputs de seleção de tratativa (radio)');
assert.ok(html.includes('fichaV2AplicarCircaTrat'), 'fichaV2AplicarCircaTrat deve existir para rastrear seleção CIRCA');
assert.ok(html.includes('circa.casos') || html.includes('circaCasos'), 'CIRCA deve renderizar casos similares');

// ─── 3. INVESTIGAÇÃO — resultado operacional ──────────────────────────────────
assert.ok(html.includes('fv2-resultado'), 'renderTreatment deve ter seletor de resultado operacional');
assert.ok(html.includes('RESOLVIDO'), 'resultado operacional deve ter opção RESOLVIDO');
assert.ok(html.includes('PARCIALMENTE_RESOLVIDO'), 'resultado operacional deve ter opção PARCIALMENTE_RESOLVIDO');
assert.ok(html.includes('NAO_RESOLVIDO'), 'resultado operacional deve ter opção NAO_RESOLVIDO');
assert.ok(html.includes('INCONCLUSIVO'), 'resultado operacional deve ter opção INCONCLUSIVO');
assert.ok(html.includes('NAO_PROCEDENTE'), 'resultado operacional deve ter opção NAO_PROCEDENTE');

// ─── 4. TRATATIVA — atualizações cronológicas ─────────────────────────────────
assert.ok(html.includes('fv2-trat-update'), 'renderTreatment deve ter campo de nova atualização (fv2-trat-update)');
assert.ok(html.includes('fichaV2RegistrarUpdate'), 'fichaV2RegistrarUpdate deve existir para atualizações cronológicas');
assert.ok(html.includes('tratativaUpdates'), 'S.tratativaUpdates deve ser usado para log cronológico');
assert.ok(html.includes('Evolução cronológica'), 'renderTreatment deve exibir cabeçalho de evolução cronológica');

// ─── 5. INVESTIGAÇÃO — fichaV2SalvarInvestigacao persiste todos os campos ─────
var salvarIdx = html.indexOf('fichaV2SalvarInvestigacao=async');
assert.ok(salvarIdx !== -1, 'fichaV2SalvarInvestigacao deve existir');
var salvarBlock = html.slice(salvarIdx, salvarIdx + 1500);
assert.ok(salvarBlock.includes('INVESTIGACAO_COMO'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_COMO');
assert.ok(salvarBlock.includes('INVESTIGACAO_QUANDO'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_QUANDO');
assert.ok(salvarBlock.includes('INVESTIGACAO_ONDE'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_ONDE');
assert.ok(salvarBlock.includes('INVESTIGACAO_QUEM'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_QUEM');
assert.ok(salvarBlock.includes('INVESTIGACAO_NOTAS'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_NOTAS');
assert.ok(salvarBlock.includes('INVESTIGACAO_EVIDENCIAS'), 'fichaV2SalvarInvestigacao deve persistir INVESTIGACAO_EVIDENCIAS');
assert.ok(salvarBlock.includes('RESULTADO_OPERACIONAL'), 'fichaV2SalvarInvestigacao deve persistir RESULTADO_OPERACIONAL');

// ─── 6. VALIDAÇÃO — resposta do setor (RESP_SETOR_*) ─────────────────────────
assert.ok(html.includes('RESP_SETOR_O_QUE'), 'renderValidation deve exibir RESP_SETOR_O_QUE');
assert.ok(html.includes('RESP_SETOR_COMO'), 'renderValidation deve exibir RESP_SETOR_COMO');
assert.ok(html.includes('RESP_SETOR_QUANDO'), 'renderValidation deve exibir RESP_SETOR_QUANDO');
assert.ok(html.includes('RESP_SETOR_ONDE'), 'renderValidation deve exibir RESP_SETOR_ONDE');
assert.ok(html.includes('RESP_SETOR_QUEM'), 'renderValidation deve exibir RESP_SETOR_QUEM');
assert.ok(html.includes('RESP_SETOR_RESOLUCAO'), 'renderValidation deve exibir RESP_SETOR_RESOLUCAO');
assert.ok(html.includes('RESP_SETOR_ACAO_PREV'), 'renderValidation deve exibir RESP_SETOR_ACAO_PREV');

// ─── 7. VALIDAÇÃO — complementação com texto obrigatório ─────────────────────
assert.ok(html.includes('fv2-valid-complementacao'), 'renderValidation deve ter campo fv2-valid-complementacao');
var validarIdx = html.indexOf('fichaV2Validar=async');
var validarBlock = html.slice(validarIdx, validarIdx + 500);
assert.ok(validarBlock.includes('complementacao') && validarBlock.includes('COMPLEMENTAR'), 'fichaV2Validar deve exigir texto para ação COMPLEMENTAR');

// ─── 8. DOSSIÊ — eventos unificados (histórico + acionamentos + liderança) ────
var histIdx = html.indexOf('function renderHistory');
assert.ok(histIdx !== -1, 'renderHistory deve existir');
var histBlock = html.slice(histIdx, histIdx + 2000);
assert.ok(histBlock.includes('S.acionamentos') || histBlock.includes('acionamentos'), 'renderHistory deve incluir acionamentos no dossiê');
assert.ok(histBlock.includes('liderancaComentarios') || histBlock.includes('S.liderancaComentarios'), 'renderHistory deve incluir comentários da liderança no dossiê');
assert.ok(histBlock.includes('tratativaUpdates') || histBlock.includes('S.tratativaUpdates'), 'renderHistory deve incluir atualizações de tratativa no dossiê');
assert.ok(histBlock.includes('allEvents') || histBlock.includes('all_events'), 'renderHistory deve unificar todos os eventos em uma lista');
assert.ok(histBlock.includes('sort'), 'renderHistory deve ordenar eventos cronologicamente');
assert.ok(html.includes('Dossiê') || html.includes('dossie') || html.includes('unificada'), 'renderHistory deve exibir título de dossiê');

// ─── 9. APOIO — STATUS das solicitações e campo assunto ──────────────────────
assert.ok(html.includes('fv2-apoio-assunto'), 'renderApoio deve ter campo de assunto');
assert.ok(html.includes('ST_APOIO_COLOR') || html.includes('stAp'), 'renderApoio deve exibir STATUS colorido das solicitações');
assert.ok(html.includes('RESPOSTA') && html.includes('DECISAO'), 'renderApoio deve exibir resposta e decisão quando preenchidas');

// ─── 10. CENTRAL — visões personalizadas ─────────────────────────────────────
assert.ok(html.includes('minha_fila'), 'baseList deve ter visão minha_fila');
assert.ok(html.includes('meu_setor'), 'baseList deve ter visão meu_setor');
assert.ok(html.includes('aguardando_minha_acao'), 'baseList deve ter visão aguardando_minha_acao');
assert.ok(html.includes('aguardando_terceiros'), 'baseList deve ter visão aguardando_terceiros');
assert.ok(html.includes("'criticas'") || html.includes('"criticas"'), 'baseList deve ter visão criticas');

var scopeIdx = html.indexOf('setCenFiltroScope');
var scopeBlock = html.slice(scopeIdx, scopeIdx + 400);
assert.ok(scopeBlock.includes('VALID') || scopeBlock.includes("'minha_fila'"), 'setCenFiltroScope deve aceitar escopos nomeados');

// ─── 11. CENTRAL — renderFilaGrupos agrupada com data-h e data-gid ───────────
assert.ok(html.includes('_renderManCard'), '_renderManCard deve existir como função separada de card');
assert.ok(html.includes('data-h='), 'cards da fila devem ter atributo data-h com horas SLA');
assert.ok(html.includes('data-gid='), 'grupos da fila devem ter atributo data-gid');
assert.ok(html.includes('FILA_GRUPOS.map') || html.includes('FILA_GRUPOS'), 'renderFilaGrupos deve iterar FILA_GRUPOS para agrupar');
assert.ok(html.includes('mc-grupo'), 'renderFilaGrupos deve criar elementos mc-grupo por estágio');

// ─── 12. CENTRAL — proximaAcao por perfil ────────────────────────────────────
var paIdx = html.indexOf('function proximaAcao');
var paBlock = html.slice(paIdx, paIdx + 1500);
assert.ok(paBlock.includes('isSetor') || paBlock.includes('perfil'), 'proximaAcao deve verificar perfil do usuário');
assert.ok(paBlock.includes('SETOR') || paBlock.includes('setor'), 'proximaAcao deve ter ramo específico para perfil de setor');

// ─── 13. SINCRONIZAÇÃO — fichaV2Voltar refresca Central ──────────────────────
var voltarIdx = html.indexOf('fichaV2Voltar=');
var voltarBlock = html.slice(voltarIdx, voltarIdx + 400);
assert.ok(voltarBlock.includes('loadCentralSAC'), 'fichaV2Voltar deve chamar loadCentralSAC ao retornar para central-sac');

// ─── 14. LIDERANÇA — permissão e tipos ───────────────────────────────────────
assert.ok(html.includes('INTERVENCAO'), 'renderLideranca deve suportar tipo INTERVENCAO');
assert.ok(html.includes('SUGESTAO'), 'renderLideranca deve suportar tipo SUGESTAO');
assert.ok(html.includes('OBSERVACAO'), 'renderLideranca deve suportar tipo OBSERVACAO');
assert.ok(html.includes('fichaV2SalvarComentarioLideranca'), 'fichaV2SalvarComentarioLideranca deve existir');
assert.ok(html.includes('/lideranca/comentarios'), 'fichaV2SalvarComentarioLideranca deve usar endpoint real /lideranca/comentarios');

// ─── 15. 7 ABAS — verificação do array de dispatch ───────────────────────────
assert.ok(html.includes('renderApoio,renderLideranca,renderHistory'), 'renderContent deve despachar para 7 funções de aba');
assert.ok(html.includes("'Apoio e Aprovações'") || html.includes("Apoio e Aprovações"), 'renderTabs deve incluir aba Apoio e Aprovações');
assert.ok(html.includes("'Liderança'") || html.includes("Liderança"), 'renderTabs deve incluir aba Liderança');

console.log('Ficha Central implementação completa: todos os 15 grupos de testes aprovados.');
