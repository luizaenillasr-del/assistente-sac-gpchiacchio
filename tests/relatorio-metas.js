'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('let _dir=false,_d=null,_per=6');
const end = html.indexOf('window.relCarregar=async function', start);
assert.ok(start >= 0 && end > start, 'bloco de metas não encontrado');
const block = html.slice(start, end);
assert.equal(block.includes('localStorage'), false, 'localStorage não pode ser fonte das metas');
assert.match(block, /fetch\('\/api\/relatorios\/metas'/);
assert.match(block, /!r\.ok/);
assert.match(block, /_metas=\{\}/);
console.log('Relatório: metas usam backend como fonte autoritativa.');
