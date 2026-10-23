'use strict';
const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
function ok(condition, message) { if (!condition) throw new Error(message); console.log('✓ ' + message); }
const users = html.slice(html.indexOf('<div class="page" id="page-usuarios"'), html.indexOf('<!-- ===== MODAL CONFIGURAR ACESSO'));
const head = users.match(/<table class="usr-user-table"[\s\S]*?<thead>([\s\S]*?)<\/thead>/)?.[1] || '';
const labels = [...head.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(m => m[1].trim());
ok(labels.join('|') === 'Usuário|Perfil|Empresa|Status|Último acesso', 'tabela de usuários tem cinco colunas de localização');
ok(!head.includes('Setor') && !head.includes('Ações'), 'setor e ações não vazam para a listagem principal');
ok(html.includes('class="usr-user-row"') && html.includes('usuAbrir'), 'linha e usuário abrem a ficha administrativa');
ok(html.includes('Nunca acessou') && html.includes('empresas'), 'último acesso e contagem de empresas têm estados compactos');
const archive = html.slice(html.indexOf('id="page-biblioteca-fichas"'), html.indexOf('<!-- DETALHE DA FICHA'));
ok(archive.includes('toggleFiltrosBib()') && archive.includes('af-advanced'), 'filtros avançados do arquivo são recolhíveis');
ok(html.includes('TOTAL DE FICHAS') && html.includes('CRIADAS NO SISTEMA') && html.includes('HISTÓRICAS IMPORTADAS'), 'indicadores do arquivo distinguem sistema e histórico');
ok(archive.includes('<th>Assunto</th>') && archive.includes('<th>Situação</th>') && archive.includes('<th>Origem</th>'), 'tabela do arquivo usa colunas resumidas e rastreáveis');
console.log('INTERFACES: 8 verificações aprovadas');
