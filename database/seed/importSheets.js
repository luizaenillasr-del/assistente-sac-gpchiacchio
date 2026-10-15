'use strict';

// ============================================================
// F3 — Importador Sheets → PostgreSQL
// Lê dados do Google Sheets e insere/atualiza no PostgreSQL via Prisma
// Execute localmente com DATABASE_URL, GOOGLE_CREDENTIALS, SPREADSHEET_ID
// ============================================================

const { google } = require('googleapis');
const prisma = require('../connection');

async function getSheets() {
  const creds = JSON.parse(process.env.GOOGLE_CREDENTIALS);
  const auth = new google.auth.GoogleAuth({
    credentials: creds,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const client = await auth.getClient();
  return google.sheets({ version: 'v4', auth: client });
}

async function lerAba(sheets, nome, maxRows = 5000) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.SPREADSHEET_ID,
    range: `${nome}!A1:AZ${maxRows}`,
  });
  const rows = res.data.values || [];
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h) obj[h] = row[i] || ''; });
    return obj;
  });
}

async function importarEmpresas(sheets) {
  console.log('\n── Empresas ──────────────────');
  const rows = await lerAba(sheets, 'EMPRESAS').catch(() => []);
  let ok = 0, skip = 0;
  for (const r of rows) {
    const codigo = (r.CODIGO || r.EMPRESA || r.NOME || '').trim().toUpperCase();
    const nome = (r.NOME || r.EMPRESA || codigo).trim();
    if (!codigo) { skip++; continue; }
    await prisma.empresa.upsert({
      where: { codigo },
      update: { nome },
      create: { codigo, nome, cnpj: r.CNPJ || null },
    }).catch(() => { skip++; return null; });
    ok++;
  }
  console.log(`  ✓ ${ok} empresas | ignoradas ${skip}`);
}

async function importarUsuarios(sheets) {
  console.log('\n── Usuários ──────────────────');
  const rows = await lerAba(sheets, 'USUARIOS').catch(() => []);
  // Buscar empresa padrão e perfis para resolução
  const empresas = await prisma.empresa.findMany();
  const perfis = await prisma.perfil.findMany();
  const empDefault = empresas[0];

  function resolverEmpresa(nome) {
    if (!nome) return empDefault;
    const n = nome.toLowerCase();
    return empresas.find(e => e.nome.toLowerCase().includes(n) || e.codigo.toLowerCase().includes(n)) || empDefault;
  }

  function resolverPerfil(nome) {
    if (!nome) return perfis.find(p => p.codigo === 'ANALISTA_SAC') || perfis[0];
    const n = nome.toLowerCase().replace(/\s+/g, '_');
    return perfis.find(p => {
      const c = p.codigo.toLowerCase();
      const pn = p.nome.toLowerCase();
      return c.includes(n) || pn.includes(n.replace(/_/g, ' ')) || n.includes(c);
    }) || perfis.find(p => p.codigo === 'ANALISTA_SAC') || perfis[0];
  }

  let ok = 0, skip = 0;
  for (const r of rows) {
    const email = (r.EMAIL || '').toLowerCase().trim();
    const idOriginal = (r.ID_USUARIO || '').trim();
    const nome = (r.NOME || r.NOME_COMPLETO || '').trim();
    const senha = (r.SENHA_HASH || r.SENHA || '').trim();
    if (!email || !nome) { skip++; continue; }
    const emp = resolverEmpresa(r.EMPRESA || '');
    const perf = resolverPerfil(r.PERFIL || r.PERFIL_USUARIO || '');
    if (!emp || !perf) { skip++; continue; }
    await prisma.usuario.upsert({
      where: { email },
      update: { nome, senhaHash: senha, idOriginal: idOriginal || null, ativo: (r.STATUS || 'ATIVO').toUpperCase() !== 'INATIVO' },
      create: {
        email, nome, senhaHash: senha || 'PENDENTE',
        idOriginal: idOriginal || null,
        empresaId: emp.id, perfilId: perf.id,
        ativo: (r.STATUS || 'ATIVO').toUpperCase() !== 'INATIVO',
      },
    }).catch(e => { console.warn(`  ⚠ ${email}: ${e.message}`); skip++; return null; });
    ok++;
  }
  console.log(`  ✓ ${ok} usuários | ignorados ${skip}`);
}

async function importarClientes(sheets) {
  console.log('\n── Clientes ──────────────────');
  const empresas = await prisma.empresa.findMany();
  const empDefault = empresas[0];

  // Extrair clientes únicos das manifestações (EMPRESA_RECLAMANTE)
  const mans = await lerAba(sheets, 'MANIFESTACOES', 5000).catch(() => []);
  const map = new Map();
  mans.forEach(m => {
    const nome = (m.EMPRESA_RECLAMANTE || '').trim();
    if (!nome) return;
    if (!map.has(nome)) map.set(nome, { nome, contato: m.CONTATO || null });
  });
  const rows = [...map.values()];

  let ok = 0, skip = 0;
  for (const r of rows) {
    const nome = (r.nome || r.NOME || '').trim();
    if (!nome) { skip++; continue; }
    const exist = await prisma.cliente.findFirst({ where: { nome, empresaId: empDefault.id } });
    if (!exist) {
      await prisma.cliente.create({
        data: {
          nome,
          empresaId: empDefault.id,
          contatoOriginal: r.contato || null,
        },
      }).catch(e => { console.warn(`  ⚠ ${nome}: ${e.message}`); skip++; return null; });
    }
    ok++;
  }
  console.log(`  ✓ ${ok} clientes | ignorados ${skip}`);
}

async function importarManifestacoes(sheets) {
  console.log('\n── Manifestações ─────────────');
  const rows = await lerAba(sheets, 'MANIFESTACOES', 5000).catch(() => []);
  const empresas = await prisma.empresa.findMany();
  const empDefault = empresas[0];

  function resolverEmpresa(nome) {
    if (!nome) return empDefault;
    const n = nome.toLowerCase();
    return empresas.find(e => e.nome.toLowerCase().includes(n) || e.codigo.toLowerCase().includes(n)) || empDefault;
  }

  let ok = 0, skip = 0, ignored = 0;
  for (const r of rows) {
    const idOriginal = (r.ID_MANIFESTACAO || '').trim();
    if (!idOriginal) { skip++; continue; }
    const exist = await prisma.manifestacao.findFirst({ where: { idOriginal } });
    if (exist) { ignored++; continue; }
    const emp = resolverEmpresa(r.EMPRESA_RECLAMADA || r.EMPRESA_RECLAMANTE || '');
    if (!emp) { skip++; continue; }
    await prisma.manifestacao.create({
      data: {
        protocolo: idOriginal,
        idOriginal,
        empresaId: emp.id,
        empresaNome: r.EMPRESA_RECLAMADA || r.EMPRESA_RECLAMANTE || emp.nome,
        contato: r.CONTATO || null,
        descricao: r.DESCRICAO || r.DESCRICAO_MANIFESTACAO || '',
        tipo: r.TIPO || 'RECLAMACAO',
        produtoNome: r.PRODUTO || null,
        prioridade: r.PRIORIDADE || 'Media',
        status: r.STATUS || 'ABERTA',
        criadaEm: r.DATA_ABERTURA ? new Date(r.DATA_ABERTURA) : new Date(),
      },
    }).catch(e => { console.warn(`  ⚠ ${idOriginal}: ${e.message}`); skip++; return null; });
    ok++;
  }
  console.log(`  ✓ ${ok} novas | ${ignored} já existiam | ${skip} erros`);
}

async function main() {
  console.log('╔══════════════════════════════════════╗');
  console.log('║  F3 — Importador Sheets → PostgreSQL ║');
  console.log('╚══════════════════════════════════════╝');

  if (!process.env.GOOGLE_CREDENTIALS || !process.env.SPREADSHEET_ID) {
    console.error('❌ GOOGLE_CREDENTIALS e SPREADSHEET_ID são obrigatórios.');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL é obrigatória.');
    process.exit(1);
  }

  const sheets = await getSheets();
  const args = process.argv.slice(2);
  const tudo = args.length === 0 || args.includes('--all');

  try {
    if (tudo || args.includes('--empresas')) await importarEmpresas(sheets);
    if (tudo || args.includes('--usuarios')) await importarUsuarios(sheets);
    if (tudo || args.includes('--clientes')) await importarClientes(sheets);
    if (tudo || args.includes('--manifestacoes')) await importarManifestacoes(sheets);
    console.log('\n✅ Importação concluída.');
  } catch (e) {
    console.error('❌ Erro fatal:', e.message);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
