const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('public/index.html', 'utf8');
const api = fs.readFileSync('api/index.js', 'utf8');

assert.match(html, /id="p-setor-reg"[^>]*type="search"[^>]*list="p-setores-list"/);
assert.match(html, /id="p-setores-list"/);
assert.match(html, /carregarSetoresFormulario/);
assert.match(html, /_portalSetoresAtivos\.find/);
assert.match(html, /origem: 'FORMULARIO_PUBLICO_SAC'/);
assert.match(html, /colaboradorRecebimento, setorRecebimento, empresa/);
assert.doesNotMatch(html.slice(html.indexOf('id="portal-screen"'), html.indexOf('function submitPortal')), /responsavel|responsável pela tratativa/i);

assert.match(api, /ORIGEM: viaCliente \? 'PORTAL_PUBLICO' : 'FORMULARIO_PUBLICO_SAC'/);
assert.match(api, /SETOR_ORIGEM: setorRecebimento/);
assert.match(api, /STATUS: 'AGUARDANDO_TRIAGEM_SAC'/);
assert.match(api, /SETOR: ''/);
assert.match(api, /setor de origem:/i);
assert.match(html, /\['Setor de origem', item\.SETOR_ORIGEM \|\| item\.SETOR_RECEBIMENTO/);

console.log('FORMULÁRIO SETOR DE ORIGEM: 11 verificações aprovadas');
