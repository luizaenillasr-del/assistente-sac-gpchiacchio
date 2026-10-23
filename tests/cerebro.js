'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-cerebro-32chars-ok';
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
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      window.mpPerfilPendente = false;
      window.navigate('cerebro');
    });
    await page.evaluate(() => window.cdLoadCerebroHome());
    await page.waitForSelector('#cb-home-kpis');
    await page.waitForTimeout(500);

    assert.equal(await page.locator('#cb-home-kpis .cb-kpi').count(), 4, 'a home deve ter quatro KPIs');
    assert.equal(await page.locator('#cerebro-tabbar > .cb-nav-btn').count(), 6, 'as seis abas principais devem estar acessíveis');
    if (await page.locator('#cb-home-cards .cb-home-section').count() !== 3) {
      console.error('Cérebro home HTML:', (await page.locator('#cb-home-cards').innerText()).slice(0, 400), 'errors:', errors);
    }
    assert.equal(await page.locator('#cb-home-cards .cb-home-section').count(), 3, 'a home deve agrupar conhecimento, inteligência e governança');
    assert.equal(await page.locator('#cb-home-cards .cb-hcard').count(), 13, 'os atalhos devem ser renderizados sem duplicidade');

    for (const tab of ['setores', 'matriz-cb', 'aprovacao-cb', 'auditoria']) {
      await page.locator(`#cd-tab-btn-${tab === 'matriz-cb' ? 'matriz' : tab === 'aprovacao-cb' ? 'aprovacao' : tab}`).click();
      assert.equal(await page.locator(`#cdp-${tab}`).isVisible(), true, `painel ${tab} deve abrir`);
    }
    await page.locator('.cb-more-toggle').click();
    assert.equal(await page.locator('#cb-more-menu').isVisible(), true, 'menu Mais deve abrir');
    await page.locator('#cb-more-menu button').first().click();
    assert.equal(await page.locator('#cdp-causas-cd').isVisible(), true, 'recurso contextual de causas deve abrir');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Cérebro: KPIs, agrupamentos, abas principais e menu contextual aprovados.');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

