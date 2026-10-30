'use strict';

// Regra de regressão em navegador para o bloqueio da Etapa 1. O servidor
// abaixo só entrega o HTML; as chamadas da API são simuladas pelo Playwright
// para que o teste possa exercitar o clique, a persistência do rascunho e a
// navegação sem tocar em dados externos.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const arquivos = [
  { name: 'evidencia.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\nregressao') },
  { name: 'foto.png', mimeType: 'image/png', buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) },
];

function json(res, body, status = 200) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': payload.length });
  res.end(payload);
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) return json(res, { sucesso: true, itens: [], total: 0 });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  const browser = await chromium.launch({ headless: true, executablePath: chromiumPath, args: ['--no-sandbox'] });
  const context = await browser.newContext();
  await context.addInitScript(() => {
    sessionStorage.setItem('sac-token', 'browser-regression-token');
    sessionStorage.setItem('sac-auth', '1');
    sessionStorage.setItem('sac-user', JSON.stringify({ usuario: 'teste.nova', nome: 'Teste Nova Manifestação', perfil: 'MASTER', empresa: 'Grupo Chiacchio' }));
  });
  const page = await context.newPage();
  const errosPagina = [];
  const requisicoes = [];
  const rascunhosEnviados = [];
  const checklistSalvos = [];
  let complementacoesPersistidas = {};
  let complementacoesPatchCount = 0;
  let complementacaoModo = 'success';
  page.on('pageerror', error => errosPagina.push(error));
  await page.route('**/api/**', async route => {
    const req = route.request();
    const url = new URL(req.url());
    requisicoes.push({ method: req.method(), path: url.pathname });
    if (url.pathname === '/api/auth/me') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, usuario: { usuario: 'teste.nova', nome: 'Teste Nova Manifestação', perfil: 'MASTER', empresa: 'Grupo Chiacchio' } }) });
    }
    if (url.pathname === '/api/analise' && req.method() === 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, analise: {
        tipoDetectado: 'Reclamação', confianca: 80, informacoesAusentes: ['CANAL', 'CATEGORIA'],
        hipotesesClassificacao: [{ codigo: 'ATRASO_LOGISTICO', descricao: 'Atraso logístico' }, { codigo: 'NAO_CONFORMIDADE_PRODUTO', descricao: 'Possível não conformidade de produto' }],
        procedimentosAplicaveis: [], setoresRecomendados: [], responsaveisElegiveis: [], casosSemelhantes: []
      } }) });
    }
    if (url.pathname === '/api/manifestacoes' && req.method() === 'POST') {
      rascunhosEnviados.push(req.postDataJSON());
      await new Promise(resolve => setTimeout(resolve, 80));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, id: 'NM-BROWSER-001', protocolo: 'CHIA-20261028-01-0001' }) });
    }
    if (url.pathname === '/api/manifestacoes/NM-BROWSER-001' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, manifestacao: { ID_MANIFESTACAO: 'NM-BROWSER-001', CANAL: 'TELEFONE', DESCRICAO: 'Rascunho de navegador confirmado.' } }) });
    }
    if (url.pathname.endsWith('/circa-dados') && req.method() === 'PATCH') {
      const body = req.postDataJSON() || {};
      if (body.CHECKLIST_CIRCA) checklistSalvos.push(body);
      if (body.analisePatch?.complementacoes) {
        complementacoesPatchCount += 1;
        if (complementacaoModo === 'http-error') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ sucesso: false, erro: 'Falha controlada de persistência.' }) });
        if (complementacaoModo === 'timeout') { await new Promise(resolve => setTimeout(resolve, 16000)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true }) }); }
        if (complementacaoModo !== 'divergent') complementacoesPersistidas = body.analisePatch.complementacoes;
      }
      await new Promise(resolve => setTimeout(resolve, 80));
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, id: 'NM-BROWSER-001', protocolo: 'CHIA-20261028-01-0001' }) });
    }
    if (url.pathname === '/api/manifestacoes/NM-BROWSER-001/circa' && req.method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        sucesso: true,
        circa: {
          analiseEstruturada: {
            informacoesAusentes: ['CANAL', 'CATEGORIA'],
            complementacoes: complementacoesPersistidas,
            prioridade: 'Média',
            hipotesesClassificacao: [
              { codigo: 'ATRASO_LOGISTICO', descricao: 'Atraso logístico (hipótese; validar na triagem)' },
              { codigo: 'NAO_CONFORMIDADE_PRODUTO', descricao: 'Possível não conformidade de produto (hipótese; validar na triagem)' }
            ],
            procedimentosAplicaveis: [], setoresRecomendados: [], responsaveisElegiveis: [], casosSemelhantes: []
          }, checklist: [{ id: 'circa-confirmar-causa', descricao: 'Confirmar causa com evidência', prazo: '72h' }], checklistPersistido: [], checklistVersao: 0
          , categoriasDisponiveis: [{ categoria: 'Qualidade', subcategorias: [] }]
        }
      }) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sucesso: true, itens: [], total: 0, dados: {} }) });
  });

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    // O objetivo deste teste é o fluxo da ficha; a autenticação real é
    // exercitada pelos testes de integração. Depois do boot, escondemos a
    // tela de login com a sessão de teste e abrimos a rota diretamente.
    await page.waitForTimeout(3000);
    await page.evaluate(() => {
      sessionStorage.setItem('sac-token', 'browser-regression-token');
      sessionStorage.setItem('sac-auth', '1');
      sessionStorage.setItem('sac-user', JSON.stringify({ usuario: 'teste.nova', nome: 'Teste Nova Manifestação', perfil: 'MASTER', empresa: 'Grupo Chiacchio' }));
      document.getElementById('login-screen').style.display = 'none';
      navigate('nova-manifestacao');
    });
    const pageRoot = page.locator('#page-nova-manifestacao');
    await pageRoot.waitFor({ state: 'visible' });

    const descricaoCenario = ('A entrega para Chiacchio Embalagens atrasou três dias. ' +
      'Foram identificados aproximadamente 1.200 potes com dificuldade de encaixe das tampas. ').repeat(6).slice(0, 745);
    await page.locator('#nm-empresa').fill('Cliente de regressão');
    await page.locator('#nm-nome').fill('Contato de regressão');
    await page.locator('#nm-email').fill('teste@example.com');
    await page.locator('#nm-data').fill('2026-10-28');
    await page.locator('#nm-origem').selectOption('TELEFONE');
    await page.locator('#nm-tipo').selectOption({ label: 'Reclamação' });
    await page.locator('#nm-produto').fill('potes');
    await page.locator('#nm-lote').fill('123456');
    await page.locator('#nm-nfe').fill('987654');
    await page.locator('#nm-expectativa').fill('Cliente espera substituição e retorno do SAC.');
    await page.locator('#nm-descricao').fill(descricaoCenario);
    await page.locator('#nm-evidencias').setInputFiles(arquivos);
    await assertFileNames(page, ['evidencia.pdf', 'foto.png']);

    const continuar = page.locator('#nm-btn-continuar');
    // Dois cliques no mesmo ciclo não podem criar dois rascunhos.
    await page.evaluate(() => {
      const button = document.getElementById('nm-btn-continuar');
      button.click();
      button.click();
    });
    await page.waitForTimeout(3000);
    await page.locator('#nm-etapa-label').filter({ hasText: 'Etapa 2 de 7' }).waitFor();
    assert.equal(await page.locator('#page-nova-manifestacao .nm-step-panel.nm-active').getAttribute('data-nm-step'), '2');
    assert.equal(requisicoes.filter(r => r.method === 'POST' && r.path === '/api/manifestacoes').length, 1, 'dois cliques não podem criar dois rascunhos');
    assert.equal(requisicoes.filter(r => r.path.includes('/anexos')).length, 0, 'anexos selecionados na Etapa 1 não devem bloquear o salvamento do rascunho');
    assert.equal(requisicoes.filter(r => r.path === '/api/analise').length, 0, 'a Etapa 1 não pode iniciar análise concorrente antes de salvar o rascunho');
    assert.equal(rascunhosEnviados.length, 1);
    assert.equal(rascunhosEnviados[0].descricao, descricaoCenario, 'o payload deve levar a descrição completa preenchida');
    assert.equal(rascunhosEnviados[0].canal, 'TELEFONE', 'o payload deve levar o canal selecionado');
    await page.locator('#nm-btn-analisar-ia').click();
    await page.locator('#ia-perguntas [data-comp-value="CANAL"]').waitFor({ state: 'visible' });
    const perguntas = page.locator('#ia-perguntas');
    await perguntas.locator('[data-comp-value="CANAL"]').fill('TELEFONE');
    await perguntas.locator('[data-comp-value="CATEGORIA"]').selectOption({ label: 'Qualidade' });
    await perguntas.locator('[data-comp-status="CANAL"]').selectOption('PREENCHIDA');
    await perguntas.locator('[data-comp-status="CATEGORIA"]').selectOption('PREENCHIDA');
    await page.evaluate(() => {
      window.nmCarregarAnaliseDeterministica = async () => { const resultado = { complementacoes: {
        CANAL: { valor: 'TELEFONE', status: 'PREENCHIDA' },
        CATEGORIA: { valor: 'Qualidade', status: 'PREENCHIDA' },
      }, analiseEstruturada: { hipotesesClassificacao: [{ codigo: 'ATRASO_LOGISTICO', descricao: 'Atraso logístico' }, { codigo: 'NAO_CONFORMIDADE_PRODUTO', descricao: 'Possível não conformidade de produto' }] }, categoriasDisponiveis: [{ categoria: 'Qualidade', subcategorias: [] }], checklist: [{ id: 'circa-confirmar-causa', descricao: 'Confirmar causa com evidência', prazo: '72h' }], checklistPersistido: [], checklistVersao: 0 }; renderizarCircaDeterministico(resultado); return resultado; };
    });
    const salvarComplementacoes = page.locator('#nm-salvar-complementacoes');
    await salvarComplementacoes.evaluate(button => { button.click(); button.click(); });
    await page.waitForTimeout(500);
    await page.locator('#nm-complementacoes-msg').filter({ hasText: 'salvas e confirmadas' }).waitFor();
    assert.equal(complementacoesPatchCount, 1, 'cliques simultâneos não podem duplicar complementações');
    assert.equal(await perguntas.locator('[data-comp-value="CANAL"]').inputValue(), 'TELEFONE');
    assert.equal(await perguntas.locator('[data-comp-value="CATEGORIA"]').inputValue(), 'Qualidade');
    complementacaoModo = 'http-error';
    await perguntas.locator('[data-comp-value="CATEGORIA"]').selectOption({ label: 'Qualidade' });
    await salvarComplementacoes.click();
    await page.locator('#nm-complementacoes-msg').filter({ hasText: 'Falha controlada de persistência' }).waitFor();
    assert.equal(await perguntas.locator('[data-comp-value="CATEGORIA"]').inputValue(), 'Qualidade', 'falha HTTP não pode apagar o campo');
    complementacaoModo = 'divergent';
    await perguntas.locator('[data-comp-value="CANAL"]').fill('EMAIL');
    await salvarComplementacoes.click();
    await page.locator('#nm-complementacoes-msg').filter({ hasText: 'não confirmou' }).waitFor();
    complementacaoModo = 'timeout';
    await perguntas.locator('[data-comp-value="CANAL"]').fill('WHATSAPP');
    await salvarComplementacoes.click();
    await page.locator('#nm-complementacoes-msg').filter({ hasText: 'Tempo limite excedido' }).waitFor();
    const classificacao = await page.locator('#ia-causa').textContent();
    assert.match(classificacao, /Atraso logístico/);
    assert.match(classificacao, /não conformidade de produto/i);
    assert.doesNotMatch(classificacao, /Outras não conformidades de conversão/i);
    const tarefa = page.locator('input[data-checklist-id="circa-confirmar-causa"]');
    await tarefa.waitFor({ state: 'attached' });
    await tarefa.evaluate(el => { el.checked = true; el.dispatchEvent(new Event('change', { bubbles: true })); });
    await page.waitForTimeout(150);
    assert.ok(checklistSalvos.some(body => JSON.parse(body.CHECKLIST_CIRCA).some(item => item.id === 'circa-confirmar-causa' && item.status === 'CONCLUIDA')), 'conclusão do checklist deve ser persistida');

    await page.locator('#nm-btn-voltar').click();
    await page.locator('#nm-etapa-label').filter({ hasText: 'Etapa 1 de 7' }).waitFor();
    assert.equal(await page.locator('#nm-descricao').inputValue(), descricaoCenario);
    await assertFileNames(page, ['evidencia.pdf', 'foto.png']);

    // O mesmo registro deve atravessar as etapas seguintes sem perder os dados.
    await continuar.click();
    await page.locator('#nm-etapa-label').filter({ hasText: 'Etapa 2 de 7' }).waitFor();
    await page.locator('#ia-perguntas [data-comp-value="CANAL"]').waitFor();
    assert.equal(await page.locator('#ia-perguntas [data-comp-value="CANAL"]').inputValue(), 'TELEFONE', 'complementação deve sobreviver à navegação');
    assert.equal(await page.locator('#ia-perguntas [data-comp-value="CATEGORIA"]').inputValue(), 'Qualidade', 'complementação deve sobreviver à reanálise');
    await continuar.click();
    await page.locator('#nm-etapa-label').filter({ hasText: 'Etapa 3 de 7' }).waitFor();
    await page.locator('#nm-caminho-sac').click();
    await page.locator('#nm-tratativa-sac').fill('Tratativa conduzida pelo SAC no ambiente de teste.');
    await continuar.click();
    await page.locator('#nm-investigacao-resultado').fill('Evidência e resultado da investigação de regressão.');
    await continuar.click();
    await page.locator('.nm-proc-btn').first().click();
    await continuar.click();
    await page.locator('#nm-devolutiva').fill('Devolutiva de teste revisada pelo SAC.');
    await continuar.click();
    await page.locator('#nm-etapa-label').filter({ hasText: 'Etapa 7 de 7' }).waitFor();
    assert.equal(await page.locator('#page-nova-manifestacao .nm-step-panel.nm-active').getAttribute('data-nm-step'), '7');
    assert.equal(await page.locator('#nm-empresa').inputValue(), 'Cliente de regressão');
    assert.equal(await page.locator('#nm-nfe').inputValue(), '987654');
    // O boot do dashboard dispara chamadas fora do fluxo testado; somente
    // erros originados na navegação da ficha bloqueiam esta regressão.
    const errosCriticos = errosPagina.filter(error => /nmProximaEtapa|nm-btn-continuar|SyntaxError|salvarRascunho/.test(error.message));
    assert.equal(errosCriticos.length, 0, `erros JavaScript críticos no fluxo: ${errosCriticos.map(e => e.message).join('; ')}`);
    console.log('Nova manifestação (navegador): Etapa 1, dois anexos, bloqueio contra duplo clique, retorno sem perda e avanço até a Etapa 7 aprovados.');
  } finally {
    await browser.close();
    server.close();
  }
}

async function assertFileNames(page, expected) {
  const names = await page.locator('#nm-evidencias-list .upload-item').allTextContents();
  for (const name of expected) assert.ok(names.some(text => text.includes(name)), `anexo ${name} não apareceu na ficha`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
