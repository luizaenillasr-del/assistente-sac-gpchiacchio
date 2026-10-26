'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-navigation-32chars-ok';
process.env.SHEETS_MOCK_PATH = path.join(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';

const express = require('express');
const app = require('../api/index.js');

(async () => {
  const outer = express();
  outer.use(express.static(path.join(__dirname, '../public')));
  outer.use(app);
  const server = http.createServer(outer);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/chromium',
    args: ['--no-sandbox', '--ignore-certificate-errors'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));

  try {
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#login-user').fill('master.test');
    await page.locator('#login-senha').fill('masterPass');
    await page.locator('.login-btn').first().click();
    await page.waitForTimeout(500);
    await page.evaluate(() => { window.mpPerfilPendente = false; });

    const routes = [
      ['visao-geral', 'Dashboard'],
      ['central-sac', 'Central de Manifestações'],
      ['sugestoes-melhoria', 'Centro das Pesquisas'],
      ['relatorio-satisfacao', 'Relatório de Satisfação'],
      ['cerebro', 'Cérebro'],
      ['portal-admin', 'Portal do Cliente'],
    ];
    for (const [route, label] of routes) {
      await page.evaluate(routeName => window.navigate(routeName), route);
      await page.waitForTimeout(250);
      const visible = await page.locator('.page').evaluateAll(nodes => nodes
        .filter(node => getComputedStyle(node).display !== 'none')
        .map(node => node.id));
      assert.deepEqual(visible, [`page-${route}`], `${label}: somente a página ativa deve estar visível`);
      if (route === 'portal-admin') {
        assert.equal(
          await page.locator('#page-portal-admin').evaluate(node => node.parentElement?.matches('main.main')),
          true,
          'Portal do Cliente: o painel deve ser montado dentro da área principal'
        );
      }
    }
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Navegação SPA: uma única página visível por rota aprovada.');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
