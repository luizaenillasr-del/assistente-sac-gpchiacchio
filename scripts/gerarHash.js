'use strict';
/**
 * Gera hash sha256 de uma senha lida do stdin.
 * Saída: sha256:HASH — formato exato aceito por senhaValida().
 *
 * Uso: echo -n "minhaSenha" | node scripts/gerarHash.js
 *   ou: node scripts/gerarHash.js   (digita e pressiona Enter)
 */

const crypto = require('crypto');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
let input = '';

rl.on('line', line => { input += line; });
rl.on('close', () => {
  const senha = input.trim();
  if (!senha) { console.error('ERRO: nenhuma senha fornecida via stdin.'); process.exit(1); }
  const hash = crypto.createHash('sha256').update(senha).digest('hex');
  console.log(`sha256:${hash}`);
});
