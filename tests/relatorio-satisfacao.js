'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'test-secret-for-report-32chars-ok';
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
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
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

    // O MASTER do mock pode estar no onboarding; a função do relatório deve
    // continuar testável independentemente da etapa inicial do perfil.
    await page.evaluate(() => {
      window.mpPerfilPendente = false;
      window.navigate('relatorio-satisfacao');
    });
    await page.evaluate(() => window.relCarregar());
    await page.waitForTimeout(400);

    assert.equal(await page.locator('#rel-loading').count(), 0, 'o relatório não pode permanecer em Carregando');
    assert.ok((await page.locator('#rel-conteudo').innerText()).length > 0, 'o modelo do relatório deve ser renderizado');
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Relatório: carregamento sem dados e renderização do modelo aprovados.');
  } finally {
    await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
