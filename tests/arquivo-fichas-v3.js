const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync('public/index.html', 'utf8');
const page = html.slice(html.indexOf('id="page-biblioteca-fichas"'), html.indexOf('id="page-biblioteca-fichas"') + 70000);

assert(page.includes('Histórico documental das manifestações do Grupo Chiacchio.'));
assert(page.includes('id="bib-sync-status"'));
assert(page.includes('>⚡ Sincronizar<'));
assert(page.includes('id="bib-kpis"'));
assert(page.includes('Protocolo, cliente, produto, lote ou palavra-chave...'));

const topbar = page.indexOf('class="af-topbar"');
const kpis = page.indexOf('id="bib-kpis"');
const tabs = page.indexOf('id="bib-abas"');
const filters = page.indexOf('id="bib-f-q"');
const content = page.indexOf('Os números abaixo incluem');
assert(topbar >= 0 && kpis > topbar && tabs > kpis && filters > tabs && content > filters,
  'ordem v3: cabeçalho → indicadores → abas → filtros → conteúdo');

for (const label of ['Todas', 'Abertas', 'Em andamento', 'Concluídas', 'Reincidentes', 'Arquivadas']) {
  assert(page.includes(label), `aba ausente: ${label}`);
}

console.log('Arquivo de Fichas v3: estrutura visual e ordem aprovadas.');
