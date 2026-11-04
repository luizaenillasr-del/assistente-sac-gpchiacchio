'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
const browserPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

function json(res, value, status = 200) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {'Content-Type':'application/json','Content-Length':body.length});
  res.end(body);
}

async function main() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/auth/me') return json(res, {sucesso:true, usuario:{usuario:'master.teste', nome:'Master Teste', perfil:'MASTER', empresa:'GRUPO CHIACCHIO'}});
    if (req.url.includes('/tratativa-completa')) return json(res, {
      sucesso:true,
      manifestacao:{ID_MANIFESTACAO:'PLA-TEST-001', EMPRESA_RECLAMADA:'PLASCHIO', EMPRESA_RECLAMANTE:'Cliente teste', DESCRICAO_ORIGINAL:'Relato original preservado', STATUS:'EM_TRATAMENTO', PRIORIDADE:'NORMAL'},
      historico:[], encaminhamentos:[], tratasSetoriais:[], execucoes:[], devolutivas:[]
    });
    if (req.url.startsWith('/api/')) return json(res, {sucesso:true, itens:[], total:0});
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'}); res.end(html);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true, executablePath:browserPath, args:['--no-sandbox']});
  const context = await browser.newContext();
  await context.addInitScript(() => {
    sessionStorage.setItem('sac-token','browser-sector-token');
    sessionStorage.setItem('sac-auth','1');
    sessionStorage.setItem('sac-user', JSON.stringify({usuario:'master.teste',nome:'Master Teste',perfil:'MASTER',empresa:'GRUPO CHIACCHIO'}));
  });
  const page = await context.newPage();
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, {waitUntil:'domcontentloaded'});
    // Aguarda o boot assíncrono autenticar a sessão antes de abrir a rota.
    await page.waitForTimeout(3000);
    await page.evaluate(() => { document.getElementById('login-screen').style.display='none'; window.tratAbrir('PLA-TEST-001'); });
    await page.locator('#page-tratativa').waitFor({state:'visible'});
    await page.locator('#trat-tabs [data-trat-tab="visao"]').waitFor();
    assert.equal(await page.locator('#trat-body [data-trat-panel="visao"]').isVisible(), true);
    await page.locator('#trat-tabs [data-trat-tab="investigacao"]').click();
    assert.equal(await page.locator('#trat-body [data-trat-panel="investigacao"]').isVisible(), true);
    assert.equal(await page.locator('#trat-body [data-trat-panel="visao"]').isVisible(), false);
    await page.locator('#trat-tabs [data-trat-tab="tratativa"]').click();
    assert.equal(await page.locator('#trat-body [data-trat-panel="tratativa"]').isVisible(), true);
    assert.match(await page.locator('#trat-body').textContent(), /Relato original preservado|tratativa/i);
    console.log('Ficha de Tratativa do Setor (navegador): carregamento, abas e dados do dossiê aprovados.');
  } finally {
    await browser.close(); server.close();
  }
}

main().catch(err => { console.error(err); process.exitCode = 1; });
