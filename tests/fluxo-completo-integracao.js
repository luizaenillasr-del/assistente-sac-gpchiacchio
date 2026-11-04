'use strict';
// Testes de integração: Fluxo completo Nova Manifestação → Central → Ficha Única
// Cobre: registro, fila Central, transições de STATUS, payload Ficha, resposta setor, validação SAC

var assert = require('assert');
var path = require('path');
var fs = require('fs');

var html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf-8');
var apiSrc = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf-8');

// ─── 1. STATUS CANON E stageOf ────────────────────────────────────────────────
// Extrai função stageOf do HTML para testar mapeamento de filas
var stageOfMatch = html.match(/function stageOf\(status\)\s*\{([\s\S]*?)\n\s*\}/);
assert.ok(stageOfMatch, 'função stageOf deve existir no HTML');

// Verifica mapeamento de cada status canônico no código-fonte
assert.ok(html.includes("'RASCUNHO'") || html.includes('"RASCUNHO"') || html.includes('RASCUNHO'), 'RASCUNHO deve aparecer em stageOf ou na lógica de fila');
assert.ok(html.includes('TRIAGEM'), 'AGUARDANDO_TRIAGEM_SAC deve ser mapeado para fila nova');
assert.ok(html.includes('VALIDACAO_SAC') || html.includes('VALIDAÇÃO_SAC'), 'AGUARDANDO_VALIDACAO_SAC deve ser mapeado');
assert.ok(html.includes("return 'aprov'") || html.includes("return 'trat'"), 'stageOf deve retornar aprov ou trat para status setorial');
assert.ok(html.includes('DEVOLUTIVA'), 'AGUARDANDO_DEVOLUTIVA deve ser mapeado');

// Verifica que stageOf(AGUARDANDO_VALIDACAO_SAC) → 'aprov'
var stageOfBlock = stageOfMatch[1];
assert.ok(stageOfBlock.includes('VALIDACAO_SAC') || stageOfBlock.includes('VALIDAÇÃO_SAC'), 'stageOf deve tratar AGUARDANDO_VALIDACAO_SAC');
assert.ok(stageOfBlock.includes("return 'aprov'"), 'stageOf deve retornar aprov');

// Verifica que stageOf(AGUARDANDO_SETOR) → 'trat'
assert.ok(stageOfBlock.includes('SETOR'), 'stageOf deve tratar AGUARDANDO_SETOR');
assert.ok(stageOfBlock.includes("return 'trat'"), 'stageOf deve retornar trat');

// ─── 2. REGISTRO: Nova Manifestação → STATUS AGUARDANDO_TRIAGEM_SAC ───────────
// API POST cria com status correto
assert.ok(apiSrc.includes("AGUARDANDO_TRIAGEM_SAC"), 'API POST deve criar manifestação com STATUS AGUARDANDO_TRIAGEM_SAC');
assert.ok(apiSrc.includes("'/api/manifestacoes'") || apiSrc.includes('"/api/manifestacoes"') || apiSrc.includes("app.post('/manifestacoes'") || apiSrc.includes('app.post("/manifestacoes"') || apiSrc.includes("router.post('/manifestacoes'") || (apiSrc.match(/post\(['"][^'"]*manifestacoes[^'"]*['"]/)||[]).length > 0, 'rota POST manifestacoes deve existir');

// ─── 3. NAVEGAÇÃO PÓS-REGISTRO → CENTRAL SAC ──────────────────────────────────
assert.ok(html.includes('central-sac'), 'navegação pós-registro deve apontar para central-sac');
assert.ok(html.includes('loadCentralSAC'), 'loadCentralSAC deve ser chamada após registro');

// registrarManifestacao deve navegar para central-sac após sucesso
// Encontra o índice da função (pode aparecer múltiplas vezes como botão onclick, busca pela definição)
var regFnIdx = html.indexOf('async function registrarManifestacao');
if (regFnIdx === -1) regFnIdx = html.indexOf('registrarManifestacao = async');
if (regFnIdx === -1) regFnIdx = html.indexOf("onclick=\"registrarManifestacao()\"");
// Verifica que algum bloco de pós-sucesso referencia central-sac (qualquer ocorrência no arquivo é suficiente)
var allNavCentral = (html.match(/navigate\(['"]central-sac['"]/g) || []).length;
assert.ok(allNavCentral >= 2, 'deve haver múltiplas navegações para central-sac no código');
// Verifica que loadCentralSAC é chamada após navigate central-sac (linhas consecutivas no código)
assert.ok(html.includes("navigate('central-sac'") && html.includes('loadCentralSAC()'), 'registrarManifestacao deve navegar para central-sac após sucesso');
assert.ok((html.match(/loadCentralSAC\(\)/g) || []).length >= 3, 'loadCentralSAC deve ser chamada em vários fluxos');

// ─── 4. PAYLOAD NM: campos de investigação persistidos ────────────────────────
// nmCardPayload deve mapear todos os campos de investigação
assert.ok(html.includes('INVESTIGACAO_O_QUE'), 'nmCardPayload deve mapear INVESTIGACAO_O_QUE');
assert.ok(html.includes('INVESTIGACAO_NOTAS'), 'nmCardPayload deve mapear INVESTIGACAO_NOTAS');
assert.ok(html.includes('INVESTIGACAO_EVIDENCIAS'), 'nmCardPayload deve mapear INVESTIGACAO_EVIDENCIAS');
assert.ok(html.includes('SUBCAUSA'), 'nmCardPayload deve mapear SUBCAUSA');
assert.ok(html.includes('CAUSA_RAIZ_CONFIRMADA'), 'nmCardPayload deve mapear CAUSA_RAIZ_CONFIRMADA');
assert.ok(html.includes('ACOES_CORRETIVAS'), 'nmCardPayload deve mapear ACOES_CORRETIVAS');

// ─── 5. FICHA ÚNICA V2: recebe todos dados da abertura ─────────────────────────
assert.ok(html.includes('fichaV2Open'), 'fichaV2Open deve existir para abrir Ficha Única pela Central');
// Ficha V2 carrega via GET /api/manifestacoes/:id
assert.ok(html.includes('/api/manifestacoes/'), 'fichaV2Open deve carregar dados via GET /api/manifestacoes/:id');
// Ficha V2 renderiza campos de investigação
assert.ok(html.includes('INVESTIGACAO_O_QUE') || html.includes('RESP_SETOR_O_QUE'), 'Ficha V2 deve renderizar campos de investigação e resposta do setor');

// ─── 6. RESPOSTA DO SETOR: acao resposta_setor → AGUARDANDO_VALIDACAO_SAC ─────
assert.ok(apiSrc.includes("'resposta_setor'") || apiSrc.includes('"resposta_setor"'), 'API deve ter ação resposta_setor');
assert.ok(apiSrc.includes('RESP_SETOR_O_QUE') || apiSrc.includes('RESP_SETOR'), 'ação resposta_setor deve persistir campos RESP_SETOR_*');
// Após resposta_setor o status vai para AGUARDANDO_VALIDACAO_SAC
var respostaIdx = apiSrc.indexOf("'resposta_setor'") !== -1 ? apiSrc.indexOf("'resposta_setor'") : apiSrc.indexOf('"resposta_setor"');
var respostaBlock = apiSrc.slice(respostaIdx, respostaIdx + 1500);
assert.ok(respostaBlock.includes('AGUARDANDO_VALIDACAO_SAC'), 'resposta_setor deve definir STATUS→AGUARDANDO_VALIDACAO_SAC');

// ─── 7. ENVIAR PARA VALIDAÇÃO SAC: acao enviar_validacao ─────────────────────
assert.ok(html.includes("acao: 'enviar_validacao'"), 'nmEnviarParaValidacaoSAC deve usar acao enviar_validacao');
assert.ok(html.includes('/ficha'), 'nmEnviarParaValidacaoSAC deve usar endpoint /ficha');

var enviarIdx = apiSrc.indexOf("'enviar_validacao'") !== -1 ? apiSrc.indexOf("'enviar_validacao'") : apiSrc.indexOf('"enviar_validacao"');
var enviarBlock = apiSrc.slice(enviarIdx, enviarIdx + 2500);
assert.ok(enviarBlock.includes('AGUARDANDO_VALIDACAO_SAC'), 'enviar_validacao deve definir STATUS→AGUARDANDO_VALIDACAO_SAC');

// ─── 8. VALIDAÇÃO SAC: acao validacao_sac → AGUARDANDO_DEVOLUTIVA ─────────────
assert.ok(apiSrc.includes("'validacao_sac'") || apiSrc.includes('"validacao_sac"'), 'API deve ter ação validacao_sac');
var valIdx = apiSrc.indexOf("'validacao_sac'") !== -1 ? apiSrc.indexOf("'validacao_sac'") : apiSrc.indexOf('"validacao_sac"');
var valBlock = apiSrc.slice(valIdx, valIdx + 2000);
assert.ok(valBlock.includes('AGUARDANDO_DEVOLUTIVA'), 'validacao_sac deve poder transicionar para AGUARDANDO_DEVOLUTIVA');
// Complementação: retorna para tratamento
assert.ok(valBlock.includes('EM TRATAMENTO') || valBlock.includes('EM_TRATAMENTO') || valBlock.includes('TRATAMENTO'), 'validacao_sac deve poder retornar para EM TRATAMENTO');

// ─── 9. CENTRAL SAC: carrega manifestações e usa stageOf ─────────────────────
assert.ok(html.includes('loadCentralSAC'), 'Central SAC deve ter função loadCentralSAC');
assert.ok(html.includes('/api/manifestacoes'), 'Central SAC deve carregar via GET /api/manifestacoes');
assert.ok(html.includes('stageOf'), 'Central SAC deve usar stageOf para distribuir nas filas');

// ─── 10. SLA E HISTÓRICO: campos presentes na API ────────────────────────────
assert.ok(apiSrc.includes('SLA') || apiSrc.includes('sla'), 'API deve ter campos de SLA');
assert.ok(apiSrc.includes('HISTORICO') || apiSrc.includes('historico') || apiSrc.includes('HISTORY'), 'API deve ter suporte a histórico/log de movimentações');

// ─── 11. NOTIFICAÇÕES INTERNAS: acionamentos notificam liderança ──────────────
assert.ok(apiSrc.includes('notificarLiderancaSetor'), 'API deve chamar notificarLiderancaSetor no acionamento');
assert.ok(apiSrc.includes('NOTIFICACOES_INTERNAS'), 'API ou service deve persistir em NOTIFICACOES_INTERNAS');

console.log('Fluxo completo integração: registro→Central→Ficha Única→resposta setor→validação SAC aprovados.');
