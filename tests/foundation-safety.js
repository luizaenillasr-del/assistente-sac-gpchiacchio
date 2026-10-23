'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
assert.equal(pkg.scripts.postinstall, 'prisma generate', 'postinstall não pode alterar o banco');
assert.equal(pkg.scripts['db:migrate:deploy'], 'prisma migrate deploy', 'migração deve ser explícita e versionada');
assert.equal(pkg.scripts['db:validate'], 'prisma validate', 'schema deve possuir comando de validação');
assert.ok(!Object.values(pkg.scripts).some(command => command.includes('--accept-data-loss')), 'nenhum script deve aceitar perda de dados');

const migrationDoc = fs.readFileSync('docs/operacao/MIGRACOES.md', 'utf8');
assert.match(migrationDoc, /postinstall[\s\S]*somente `prisma generate`/i);
assert.match(migrationDoc, /npm run db:migrate:deploy/);
console.log('Fundação: instalação segura e migração explícita aprovadas.');
