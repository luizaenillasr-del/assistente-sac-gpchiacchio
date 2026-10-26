const fs = require('fs');
const assert = require('assert');

const api = fs.readFileSync('api/index.js', 'utf8');
const ui = fs.readFileSync('public/index.html', 'utf8');
const perms = fs.readFileSync('server-services/permissoesService.js', 'utf8');

assert(api.includes("process.env.RNC_ENABLED || 'false'"));
assert(api.includes("codigo: 'RNC_DESATIVADO'"));
assert(api.includes("app.use(['/api/rnc', '/api/rnc-metricas'], rncFeatureGuard)"));
assert(ui.includes('window.RNC_ENABLED = false'));
assert(ui.includes("if(page === rncPage)"));
assert(!perms.match(/MODULOS_SISTEMA[\s\S]{0,250}['\"]RNC['\"]/));
assert(!perms.match(/COMPETENCIAS_VALIDAS[\s\S]{0,180}['\"]RNC['\"]/));

console.log('RNC desativado: flag, bloqueio de rotas, UI e permissões verificados.');
