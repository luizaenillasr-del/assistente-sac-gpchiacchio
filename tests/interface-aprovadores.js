const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const page = html.match(/<div class="page" id="page-aprovadores">[\s\S]*?<\/div>\s*<!-- =====/);
check(page, 'página de aprovadores encontrada');
check(/class="aprov-admin-wrap"/.test(html), 'listagem usa contêiner com rolagem local');
check(/class="aprov-admin-table"/.test(html), 'listagem usa tabela compacta escopada');
check(/<th[^>]*>Aprovador<\/th>[\s\S]*?<th[^>]*>Login<\/th>[\s\S]*?<th[^>]*>Empresa<\/th>[\s\S]*?<th[^>]*>Status<\/th>[\s\S]*?<th[^>]*>Ações<\/th>/.test(html), 'colunas principais estão resumidas');
check(!/<th[^>]*>Setor<\/th>/.test(html.match(/class="aprov-admin-table"[\s\S]*?<\/table>/)?.[0] || ''), 'setores extensos não poluem a tabela principal');
check(/new Set\(String\(value\|\|' '\)\.split\(','\)/.test(html) || /new Set\(String\(value\|\|''\)\.split\(','\)/.test(html), 'empresas duplicadas são normalizadas');
check(/Editar ficha/.test(html), 'detalhamento permanece acessível pela ficha');
console.log('APROVADORES: 7 verificações aprovadas');
