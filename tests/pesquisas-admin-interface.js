const fs = require('fs');

const page = fs.readFileSync('public/index.html', 'utf8');
const admin = fs.readFileSync('public/assets/pesquisas-admin.js', 'utf8');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

check(/id="page-sugestoes-melhoria"/.test(page), 'rota do Centro das Pesquisas encontrada');
check(/#page-sugestoes-melhoria\.page\.active\{display:block!important\}/.test(page), 'Centro usa o fluxo de rolagem principal quando ativo');
check(/#page-sugestoes-melhoria>div:nth-child\(2\)\{[^}]*overflow:visible!important/.test(page), 'painel interno não cria uma segunda rolagem');
check(/\.cp-top\{[^}]*overflow:visible!important;flex-wrap:wrap!important/.test(page), 'cabeçalho pode distribuir controles em mais de uma linha');
check(/\.cp-top-actions\{[^}]*flex-wrap:wrap/.test(page), 'ações do cabeçalho não são cortadas na lateral');
check(/const main = document\.querySelector\('\.main'\)/.test(page), 'troca de aba reposiciona o contêiner principal');
check(/call\("formularios\/" \+ encodeURIComponent\(selectedId\)\)/.test(admin), 'Editar carrega o ID selecionado');
check(/r\.formulario\.id !== selectedId/.test(admin), 'Editor valida a identidade do formulário retornado');
check(/Tentar novamente/.test(admin), 'falha de carregamento oferece nova tentativa');
check(/Salvar rascunho/.test(admin) && /Visualizar prévia/.test(admin) && /Publicar alterações/.test(admin), 'ações do editor permanecem disponíveis');
check(/baseId = r\.formulario\.revision/.test(admin), 'salvamento mantém controle de versão');

console.log('PESQUISAS ADMIN: 11 verificações aprovadas');
