'use strict';
/**
 * Criação interativa de usuário na aba USUARIOS.
 * Lê senha por stdin (sem eco).
 * Valida perfil contra lista permitida e empresa contra mapa canônico.
 * Recusa usuário duplicado.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const crypto  = require('crypto');
const readline = require('readline');
const sheets  = require('../api/sheets');

// ─── Mapa canônico (idêntico ao api/index.js) ────────────────────────────────
function normalizarTexto(t) {
  return (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

const EMPRESA_MAP = {
  CHIACCHIO: ['chiacchio embalagens', 'chiachio embalagens', 'chiacchio'],
  PLASCHIO:  ['plaschio'],
  TUBAHIA:   ['tubahia', 'cesbap'],
  MASTER:    ['grupo chiacchio'],
};

function empresaCanonica(texto) {
  const norm = normalizarTexto(texto || '');
  if (!norm) return null;
  for (const [cod, grafias] of Object.entries(EMPRESA_MAP)) {
    if (grafias.some(g => norm === g)) return cod;
  }
  return null;
}

const PERFIS_VALIDOS = ['ANALISTA SAC', 'SUPERVISOR', 'MASTER'];

// ─── helpers readline ────────────────────────────────────────────────────────

function perguntar(rl, prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

function lerSenha(prompt) {
  return new Promise(resolve => {
    process.stdout.write(prompt);
    const stdin = process.stdin;
    const chunks = [];
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    function onData(ch) {
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(chunks.join(''));
      } else if (ch === '\u007f') {
        chunks.pop();
      } else {
        chunks.push(ch);
      }
    }
    stdin.on('data', onData);
  });
}

function sha256(s) {
  return 'sha256:' + crypto.createHash('sha256').update(s).digest('hex');
}

// ─── main ────────────────────────────────────────────────────────────────────

(async () => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });

  console.log('\n=== CRIAR USUÁRIO ===\n');

  // Carregar usuários existentes
  let usuariosExistentes;
  try {
    usuariosExistentes = await sheets.lerAba('USUARIOS');
  } catch (e) {
    console.error('Erro ao ler aba USUARIOS:', e.message);
    rl.close();
    process.exit(1);
  }

  const usuario = (await perguntar(rl, 'Usuário (login, sem espaços): ')).trim().toLowerCase();
  if (!usuario) { console.error('Usuário obrigatório.'); rl.close(); process.exit(1); }
  if (/\s/.test(usuario)) { console.error('Usuário não pode conter espaços.'); rl.close(); process.exit(1); }

  const duplicado = usuariosExistentes.find(u => (u.USUARIO || '').toLowerCase() === usuario);
  if (duplicado) { console.error(`Usuário "${usuario}" já existe.`); rl.close(); process.exit(1); }

  const nome  = (await perguntar(rl, 'Nome completo: ')).trim();
  const email = (await perguntar(rl, 'E-mail: ')).trim();

  // Perfil
  console.log(`Perfis disponíveis: ${PERFIS_VALIDOS.join(', ')}`);
  const perfilInput = (await perguntar(rl, 'Perfil: ')).trim().toUpperCase();
  if (!PERFIS_VALIDOS.includes(perfilInput)) {
    console.error(`Perfil inválido. Use um de: ${PERFIS_VALIDOS.join(', ')}`);
    rl.close(); process.exit(1);
  }

  // Empresa
  const empresasAceitas = Object.entries(EMPRESA_MAP).flatMap(([cod, grafias]) =>
    grafias.map(g => `${g} (→ ${cod})`)
  ).join('\n  ');
  console.log(`\nEmpresas aceitas:\n  ${empresasAceitas}\n`);
  const empresaInput = (await perguntar(rl, 'Empresa (grafia exata da planilha): ')).trim();
  const cod = empresaCanonica(empresaInput);
  if (!cod) {
    console.error(`Empresa "${empresaInput}" não reconhecida no mapa canônico.`);
    rl.close(); process.exit(1);
  }

  const setor = (await perguntar(rl, 'Setor (deixe em branco se global): ')).trim();

  // Senha (sem eco)
  rl.pause(); // libera stdin para modo raw
  let senha;
  try {
    senha = await lerSenha('Senha (sem eco): ');
  } catch (e) {
    console.error('\nErro ao ler senha:', e.message);
    rl.close(); process.exit(1);
  }
  rl.resume();
  rl.close();

  if (!senha || senha.length < 6) {
    console.error('Senha deve ter ao menos 6 caracteres.');
    process.exit(1);
  }

  const novoUsuario = {
    ID_USUARIO: `USR-${cod.slice(0,3)}-${Date.now()}`,
    USUARIO:    usuario,
    NOME:       nome,
    EMAIL:      email,
    SENHA:      sha256(senha),
    PERFIL:     perfilInput,
    EMPRESA:    empresaInput,
    SETOR:      setor || '',
    STATUS:     'ATIVO',
  };

  try {
    await sheets.appendObjeto('USUARIOS', novoUsuario);
  } catch (e) {
    console.error('Erro ao gravar usuário:', e.message);
    process.exit(1);
  }

  console.log(`\nUsuário "${usuario}" criado com sucesso. ID: ${novoUsuario.ID_USUARIO}`);
  process.exit(0);
})();
