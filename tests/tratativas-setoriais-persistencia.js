'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('api/index.js', 'utf8');
const start = source.indexOf("app.get('/api/manifestacoes/:id/tratativas-setoriais'");
const end = source.indexOf("// PUT atualizar tratativa setorial", start);
assert.ok(start >= 0 && end > start, 'rotas de tratativas setoriais devem existir');
const segment = source.slice(start, end);

assert.match(segment, /const rows = await lerAba\('TRATATIVAS_SETORIAIS', 3000\);/, 'GET não pode converter falha de leitura em lista vazia');
assert.match(segment, /res\.status\(500\)\.json\(\{ sucesso:false, erro:erroSeguro\(e\) \}\)/, 'GET deve expor erro operacional sanitizado');
assert.match(segment, /await appendObjeto\('TRATATIVAS_SETORIAIS', objeto\);/, 'POST deve aguardar persistência efetiva');
assert.match(segment, /confirmadas = await lerAba\('TRATATIVAS_SETORIAIS', 3000\);/, 'POST deve reler a fonte após gravar');
assert.match(segment, /r\.ID_TRATATIVA === idTrat && r\.ID_MANIFESTACAO === id/, 'POST deve confirmar o mesmo identificador e manifestação');
assert.match(segment, /A gravação da tratativa não pôde ser confirmada/, 'POST deve rejeitar falso sucesso quando a releitura divergir');
assert.doesNotMatch(segment, /rows2\.push\(objeto\)/, 'não pode existir fallback apenas em memória');

console.log('TRATATIVAS SETORIAIS: falhas de leitura/gravação não viram sucesso falso e a confirmação exige releitura.');
