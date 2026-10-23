/* Verificações estruturais da gestão administrativa. Os cenários que gravam
 * usuários exigem Sheets/PostgreSQL de staging e ficam cobertos no ambiente
 * de integração; este teste garante que as proteções não sejam removidas por
 * regressões de markup ou rota. */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const api = fs.readFileSync('api/index.js', 'utf8');

assert.match(html, /id="usr-status-tabs"/);
assert.match(html, /data-status-view="EXCLUIDO"/);
assert.match(html, /onclick="usuAbrir\('\$\{uid\}'\)"/);
assert.match(html, /function _fmtDataHora/);
assert.match(html, /prompt\('Informe o motivo da exclusão lógica:/);
assert.match(api, /app\.delete\('\/api\/usuarios\/:id'/);
assert.match(api, /Informe o motivo da exclusão lógica/);
assert.match(api, /DATA_EXCLUSAO/);
assert.match(api, /MOTIVO_EXCLUSAO/);
assert.match(api, /Não é possível excluir o único MASTER ativo/);
assert.match(api, /não pode excluir sua própria conta/i);

console.log('GESTAO ACESSOS: tabela, ficha, separação de status e exclusão lógica protegida aprovados.');
