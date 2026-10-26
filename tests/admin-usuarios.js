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
assert.match(html, /data-status-view="PRIMEIRO_ACESSO"/);
assert.match(html, /id="usr-count-primeiro_acesso"/);
assert.match(html, /onclick="usuAbrir\('\$\{uid\}'\)"/);
assert.match(html, /usuStatus\('\$\{uid\}',\s*'desativar'\)/);
assert.match(html, /st==='PRIMEIRO_ACESSO'[\s\S]{0,220}usuStatus\('\$\{uid\}',\s*'desativar'\)/);
assert.match(html, /usuExcluir\('\$\{uid\}'/);
assert.match(html, /window\.loadUsuariosV5 = loadUsuariosMasterPainel/);
assert.match(html, /function _fmtDataHora/);
assert.match(html, /prompt\('Informe o motivo da exclusão lógica:/);
assert.match(api, /app\.delete\('\/api\/usuarios\/:id'/);
assert.match(api, /Informe o motivo da exclusão lógica/);
assert.match(api, /DATA_EXCLUSAO/);
assert.match(api, /MOTIVO_EXCLUSAO/);
assert.match(api, /Não é possível excluir o único MASTER ativo/);
assert.match(api, /não pode excluir sua própria conta/i);
assert.match(api, /async function persistirStatusUsuario/);
assert.match(api, /app\.post\('\/api\/usuarios\/:id\/restaurar'/);
assert.match(api, /USUARIO_RESTAURADO/);
assert.match(api, /Usuário excluído só pode ser restaurado pelo fluxo administrativo/);
assert.match(api, /Não é possível inativar o único MASTER ativo do sistema/);
assert.match(html, /usuRestaurar\('\$\{uid\}'/);
assert.match(api, /\['INATIVO','BLOQUEADO','EXCLUIDO'\]/, 'sessões de usuários sem acesso devem ser revogadas');
assert.match(api, /\['inativo','bloqueado','excluido'\]/, 'login deve recusar usuários sem acesso');
assert.match(api, /Usuário excluído\. Contate o administrador/, 'login deve informar exclusão lógica');
assert.doesNotMatch(api, /DESATIVAR usuario Sheets\].message\);/);

console.log('GESTAO ACESSOS: tabela, ficha, separação de status e exclusão lógica protegida aprovados.');
