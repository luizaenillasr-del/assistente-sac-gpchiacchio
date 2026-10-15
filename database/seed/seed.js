'use strict';

const prisma = require('../connection');

// ── Dados base ────────────────────────────────────────────────────────────────

const EMPRESAS = [
  { codigo: 'CHIACCHIO', nome: 'Grupo Chiacchio', cnpj: null },
  { codigo: 'PLASCHIO',  nome: 'Plaschio',         cnpj: null },
  { codigo: 'TUBAHIA',   nome: 'Tubahia / CESBAP', cnpj: null },
];

const PERFIS = [
  {
    codigo: 'MASTER',
    nome: 'Master',
    permissoes: ['*'],
  },
  {
    codigo: 'ADMINISTRADOR',
    nome: 'Administrador',
    permissoes: ['usuarios:*', 'manifestacoes:*', 'rnc:*', 'relatorios:*', 'configuracoes:*'],
  },
  {
    codigo: 'SAC',
    nome: 'SAC',
    permissoes: ['manifestacoes:*', 'clientes:read', 'clientes:write', 'relatorios:read'],
  },
  {
    codigo: 'GESTOR_DE_SETOR',
    nome: 'Gestor de Setor',
    permissoes: ['manifestacoes:read', 'manifestacoes:write', 'tratativas:*', 'rnc:*', 'relatorios:read'],
  },
  {
    codigo: 'USUARIO_DE_SETOR',
    nome: 'Usuário de Setor',
    permissoes: ['manifestacoes:read', 'tratativas:read', 'tratativas:write'],
  },
  {
    codigo: 'REPRESENTANTE',
    nome: 'Representante',
    permissoes: ['manifestacoes:read', 'clientes:read'],
  },
];

const SETORES_BASE = [
  { codigo: 'SAC',        nome: 'SAC',                    descricao: 'Serviço de Atendimento ao Cliente' },
  { codigo: 'QUALIDADE',  nome: 'Qualidade',              descricao: 'Gestão da Qualidade e RNC' },
  { codigo: 'COMERCIAL',  nome: 'Comercial',              descricao: 'Setor Comercial' },
  { codigo: 'PRODUCAO',   nome: 'Produção',               descricao: 'Setor de Produção' },
  { codigo: 'LOGISTICA',  nome: 'Logística',              descricao: 'Setor de Logística' },
  { codigo: 'FINANCEIRO', nome: 'Financeiro',             descricao: 'Setor Financeiro' },
  { codigo: 'TI',         nome: 'Tecnologia da Informação', descricao: 'TI e Sistemas' },
  { codigo: 'DIRETORIA',  nome: 'Diretoria',              descricao: 'Alta Direção' },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Iniciando seed...\n');

  // 1. Perfis
  console.log('📋 Criando perfis...');
  for (const p of PERFIS) {
    await prisma.perfil.upsert({
      where:  { codigo: p.codigo },
      update: { nome: p.nome, permissoes: p.permissoes },
      create: { codigo: p.codigo, nome: p.nome, permissoes: p.permissoes },
    });
    console.log(`   ✓ ${p.codigo}`);
  }

  // 2. Empresas + setores
  console.log('\n🏢 Criando empresas e setores...');
  for (const e of EMPRESAS) {
    const empresa = await prisma.empresa.upsert({
      where:  { codigo: e.codigo },
      update: { nome: e.nome },
      create: { codigo: e.codigo, nome: e.nome, cnpj: e.cnpj },
    });
    console.log(`   ✓ Empresa: ${empresa.codigo} (id=${empresa.id})`);

    for (const s of SETORES_BASE) {
      await prisma.setor.upsert({
        where:  { empresaId_codigo: { empresaId: empresa.id, codigo: s.codigo } },
        update: { nome: s.nome, descricao: s.descricao },
        create: { empresaId: empresa.id, codigo: s.codigo, nome: s.nome, descricao: s.descricao },
      });
    }
    console.log(`      └─ ${SETORES_BASE.length} setores criados/atualizados`);
  }

  // 3. Resumo
  const [totalEmpresas, totalSetores, totalPerfis] = await Promise.all([
    prisma.empresa.count(),
    prisma.setor.count(),
    prisma.perfil.count(),
  ]);

  console.log('\n✅ Seed concluído!');
  console.log(`   Empresas: ${totalEmpresas}`);
  console.log(`   Setores:  ${totalSetores}`);
  console.log(`   Perfis:   ${totalPerfis}`);
}

main()
  .catch((err) => { console.error('❌ Erro no seed:', err); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
