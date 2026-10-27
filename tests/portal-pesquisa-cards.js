const fs = require('fs');
const html = fs.readFileSync('public/portal.html', 'utf8');

function check(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✓ ${message}`);
}

const section = html.match(/id="page-pesquisa"[\s\S]*?<!-- ===== PROTOCOLO =====/);
check(section, 'etapa pública de pesquisas encontrada');
const source = section[0];
check(/id="surveyCardsGrid"/.test(source), 'seleção usa grade de cards');
check(/Selecione a empresa/.test(source), 'título segue o layout aprovado');
check(/survey-card-logo/.test(html), 'cards possuem identidade visual da empresa');
check(/apiJson\('\/api\/public\/pesquisas'\)/.test(html), 'catálogo de pesquisas continua vindo do backend');
check(/loadPublishedSurvey\(form\.id\)/.test(html), 'card e botão abrem o formulário pelo identificador real');
check(/Não há pesquisas disponíveis no momento/.test(html), 'estado vazio é tratado');
check(/grid-template-columns:1fr 1fr/.test(html) && /grid-template-columns:1fr\}/.test(html), 'cards são responsivos em tablet e celular');
console.log('PORTAL PESQUISAS: 7 verificações aprovadas');
