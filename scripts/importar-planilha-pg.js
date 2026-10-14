'use strict';
// ============================================================
// Importa usuários e manifestações da PLANILHA para o Postgres.
// Fonte: por padrão o mock (tests/sheets-mock.js), que replica a estrutura da
// planilha. Para a planilha REAL do Google, use database/seed/importSheets.js
// com GOOGLE_CREDENTIALS + SPREADSHEET_ID.
// Uso: DATABASE_URL=... node scripts/importar-planilha-pg.js
// ============================================================
const prisma = require('../database/connection');
const fonte = require('../tests/sheets-mock');

function resolverEmpresa(empresas, nomeRaw) {
  const n = String(nomeRaw || '').toLowerCase().trim();
  if (!n) return empresas[0];
  return empresas.find(e => n.includes(e.codigo.toLowerCase())) ||
         empresas.find(e => e.nome.toLowerCase().split(/\s+/).some(t => t.length > 3 && n.includes(t))) ||
         empresas.find(e => e.codigo.toLowerCase().includes(n) || e.nome.toLowerCase().includes(n)) ||
         empresas[0];
}

function dataValida(v) {
  if (!v) return new Date();
  const d = new Date(v);
  return isNaN(d.getTime()) ? new Date() : d;
}

async function main() {
  const empresas = await prisma.empresa.findMany();
  const perfis = await prisma.perfil.findMany();
  if (!empresas.length || !perfis.length) throw new Error('Rode o seed base antes: node database/seed/seed.js');

  // ── Usuários ──
  const usuarios = await fonte.lerAba('USUARIOS').catch(() => []);
  let uOk = 0;
  for (const r of usuarios) {
    const email = String(r.EMAIL || r.USUARIO || '').toLowerCase().trim();
    const nome = String(r.NOME || r.USUARIO || '').trim();
    if (!email || !nome) continue;
    const emp = resolverEmpresa(empresas, r.EMPRESA || '');
    const perf = perfis.find(p => p.codigo === 'SAC') || perfis[0];
    await prisma.usuario.upsert({
      where: { email },
      update: { nome },
      create: {
        email, nome, senhaHash: r.SENHA || r.SENHA_HASH || 'PENDENTE',
        idOriginal: r.ID_USUARIO || null, empresaId: emp.id, perfilId: perf.id,
        ativo: String(r.STATUS || 'ATIVO').toUpperCase() !== 'INATIVO',
      },
    }).catch(() => {});
    uOk++;
  }

  // ── Manifestações ──
  const mans = await fonte.lerAba('MANIFESTACOES').catch(() => []);
  let mOk = 0, mSkip = 0;
  for (const m of mans) {
    const idOriginal = String(m.ID_MANIFESTACAO || '').trim();
    if (!idOriginal) { mSkip++; continue; }
    const emp = resolverEmpresa(empresas, m.EMPRESA_RECLAMADA || m.EMPRESA_RECLAMANTE || '');
    try {
      await prisma.manifestacao.upsert({
        where: { protocolo: idOriginal },
        update: {},
        create: {
          protocolo: idOriginal, idOriginal,
          empresaId: emp.id,
          empresaNome: m.EMPRESA_RECLAMADA || m.EMPRESA_RECLAMANTE || emp.nome,
          contato: m.EMPRESA_RECLAMANTE || m.CONTATO || null,
          descricao: m.DESCRICAO || m.DESCRICAO_MANIFESTACAO || m.DESCRICAO_RECLAMACAO || '(sem descrição)',
          tipo: m.TIPO || m.TIPO_CONFIRMADO || 'RECLAMACAO',
          prioridade: m.PRIORIDADE || 'Media',
          status: m.STATUS || 'ABERTA',
          canal: m.CANAL || null,
          origem: m.ORIGEM || 'IMPORT_PLANILHA',
          criadaEm: dataValida(m.DATA_ABERTURA || m.DATA_REGISTRO),
          dataAbertura: dataValida(m.DATA_ABERTURA || m.DATA_REGISTRO),
        },
      });
      mOk++;
    } catch (e) { mSkip++; }
  }

  // ── RNCs ──
  const rncs = await fonte.lerAba('BANCO_RNC').catch(() => []);
  let rOk = 0, rSkip = 0;
  for (const x of rncs) {
    const idOriginal = String(x.ID_RNC || '').trim();
    if (!idOriginal) { rSkip++; continue; }
    const emp = resolverEmpresa(empresas, x.EMPRESA_RECLAMADA || x.EMPRESA || '');
    try {
      await prisma.rnc.upsert({
        where: { protocolo: idOriginal },
        update: {},
        create: {
          protocolo: idOriginal, idOriginal,
          empresaId: emp.id,
          origemTipo: x.ORIGEM || 'MANIFESTACAO',
          descricao: x.NAO_CONFORMIDADE || x.DESCRICAO || x.DESCRICAO_RNC || '(sem descrição)',
          produto: x.PRODUTO || null,
          setor: x.SETOR || x.SETOR_RESPONSAVEL || null,
          responsavel: x.RESPONSAVEL || null,
          prioridade: x.PRIORIDADE || null,
          status: x.STATUS || 'ABERTA',
          dataAbertura: dataValida(x.DATA_ABERTURA || x.DATA_REGISTRO),
        },
      });
      rOk++;
    } catch (e) { rSkip++; }
  }

  const total = await prisma.manifestacao.count();
  console.log(`\n✅ Importação concluída.`);
  console.log(`   Usuários processados: ${uOk}`);
  console.log(`   Manifestações importadas: ${mOk} (ignoradas/erro: ${mSkip})`);
  console.log(`   RNCs importadas: ${rOk} (ignoradas/erro: ${rSkip})`);
  console.log(`   Total de manifestações no banco: ${total}`);
}

main().catch(e => { console.error('Erro na importação:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect && prisma.$disconnect());
