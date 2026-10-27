const fs = require('fs');
const html = fs.readFileSync('public/index.html', 'utf8');
const start = html.indexOf('<!-- ETAPA 1: DADOS DA MANIFESTAÇÃO -->');
const end = html.indexOf('</div><!-- /nm-steps-body -->', start);
if (start < 0 || end < 0) throw new Error('bloco do fluxo CIRCA não encontrado');
const flow = html.slice(start, end);
const panels = [...flow.matchAll(/data-nm-step="(\d+)"/g)].map(m => m[1]);
if (panels.join(',') !== '1,2,3,4,5,6,7') throw new Error(`etapas inválidas: ${panels.join(',')}`);
for (const label of ['Dados da Manifestação','Análise Inteligente e Triagem','Condução','Investigação e Resolução','Validação SAC','Devolutiva Conclusiva','Encerramento e Aprendizado']) {
  if (!flow.includes(label)) throw new Error(`etapa ausente: ${label}`);
}
for (const legacy of ['Análise com IA','Impacto Financeiro','Revisão Final','Tipo e Classificação']) {
  if (flow.includes(legacy)) throw new Error(`componente legado ainda visível: ${legacy}`);
}
for (const id of ['nm-descricao','nm-empresa-reclamada','nm-procedente','nm-caminho-tratativa','nm-devolutiva','nm-resumo-grid','ia-tratativa','ia-similares','ia-setores']) {
  if (!flow.includes(`id="${id}"`)) throw new Error(`integração ausente: ${id}`);
}
if (flow.includes('display:none!important')) throw new Error('fluxo usa ocultação proibida');
if (!fs.readFileSync('api/index.js','utf8').includes("/api/manifestacoes/:id/circa-dados")) throw new Error('persistência do card CIRCA ausente');
const map = html.match(/var PANEL_MAP = (\{[^;]+\});/);
if (!map || !map[1].includes('1:[1]') || !map[1].includes('7:[7]')) throw new Error('navegação não aponta cada etapa para seu painel');
console.log('CIRCA design: sete etapas, componentes legados removidos e integrações essenciais presentes.');
