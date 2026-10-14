'use strict';
// Seed de demonstração no Postgres: 1 master + manifestações de exemplo.
// Uso: DATABASE_URL=... node scripts/seed-pg-demo.js
const bcrypt = require('bcryptjs');
const prisma = require('../database/connection');

async function main() {
  const empresa = await prisma.empresa.findFirst({ where: { codigo: 'CHIACCHIO' } });
  const empresaPla = await prisma.empresa.findFirst({ where: { codigo: 'PLASCHIO' } });
  const perfilMaster = await prisma.perfil.findFirst({ where: { codigo: 'MASTER' } });
  if (!empresa || !perfilMaster) throw new Error('Rode o seed base antes (database/seed/seed.js).');

  const senhaHash = await bcrypt.hash('masterPass', 10);
  const master = await prisma.usuario.upsert({
    where: { email: 'master.test' },
    update: { senhaHash, ativo: true },
    create: { email: 'master.test', nome: 'Master Teste', senhaHash, ativo: true, empresaId: empresa.id, perfilId: perfilMaster.id },
  });
  console.log('✓ Usuário master:', master.email, '(id=' + master.id + ')');

  const base = [
    { emp: empresa,    tipo: 'RECLAMACAO', desc: 'Embalagem chegou danificada no transporte', status: 'EM_ANALISE', prio: 'Alta' },
    { emp: empresa,    tipo: 'RECLAMACAO', desc: 'Produto fora da especificação de cor', status: 'EM_TRATAMENTO', prio: 'Media' },
    { emp: empresa,    tipo: 'ELOGIO',     desc: 'Atendimento rápido e cordial', status: 'ENCERRADA', prio: 'Baixa' },
    { emp: empresaPla, tipo: 'SUGESTAO',   desc: 'Melhorar prazo de entrega na região sul', status: 'EM_ANALISE', prio: 'Media' },
    { emp: empresaPla, tipo: 'RECLAMACAO', desc: 'Nota fiscal com valor divergente', status: 'AGUARDANDO_APROVACAO', prio: 'Alta' },
  ];
  let n = 0;
  for (let i = 0; i < base.length; i++) {
    const b = base[i];
    if (!b.emp) continue;
    const protocolo = 'PG-2026-' + String(i + 1).padStart(4, '0');
    await prisma.manifestacao.upsert({
      where: { protocolo },
      update: {},
      create: {
        protocolo, empresaId: b.emp.id, empresaNome: b.emp.nome,
        descricao: b.desc, tipo: b.tipo, status: b.status, prioridade: b.prio,
        canal: 'Portal', origem: 'SEED_PG',
      },
    });
    n++;
  }
  console.log('✓ Manifestações de exemplo:', n);

  const total = await prisma.manifestacao.count();
  console.log('\n✅ Seed PG demo concluído. Total de manifestações no banco:', total);
}

main().catch(e => { console.error('Erro no seed PG demo:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect && prisma.$disconnect());
