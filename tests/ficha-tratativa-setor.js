'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const page = html.slice(html.indexOf('id="page-tratativa"'), html.indexOf('<!-- ═══════════════════════════════════════════════════════════════════════\n     PORTAL DO CLIENTE'));

for (const [id, label] of [
  ['visao', 'Visão geral'], ['investigacao', 'Investigação'], ['tratativa', 'Tratativa'],
  ['apoio', 'Apoio e aprovações'], ['lideranca', 'Liderança'], ['resposta', 'Resposta ao SAC'], ['historico', 'Histórico e dossiê'],
]) {
  assert.match(page, new RegExp(`data-trat-tab="${id}"`), `aba ${id} deve existir`);
  assert.match(page, new RegExp(label), `rótulo da aba ${id} deve existir`);
}

assert.match(page, /encodeURIComponent\(_tratId\).*tratativa-completa/,
  'a ficha deve carregar o dossiê pelo endpoint agregado oficial');
assert.match(page, /\/tratativas-setoriais/,
  'a ficha deve preservar o endpoint de tratativas setoriais');
assert.match(page, /tratSalvarDiagnostico|tratRegistrarSetorial|tratSalvarExecucao/,
  'a ficha deve manter controles operacionais de investigação e execução');
assert.match(page, /tratValidarSAC|tratAprovarDevolutiva/,
  'a resposta deve permanecer submetida à validação do SAC');
assert.match(page, /tratMudarAba\('visao'\)/,
  'a renderização deve iniciar na visão geral e permitir troca de abas');

console.log('Ficha de Tratativa do Setor: sete abas, dossiê oficial, tratativas e validação SAC presentes.');
