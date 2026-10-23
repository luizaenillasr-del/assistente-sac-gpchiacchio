'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
const {chromium}=require('playwright');
process.env.NODE_ENV='test';
process.env.SESSION_SECRET='test-secret-for-behavioral-tests-32chars-ok';
process.env.SHEETS_MOCK_PATH=path.join(__dirname,'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED='false';
const express=require('express');const app=require('../api/index.js');const outer=express();outer.use(express.static(path.join(__dirname,'../public')));outer.get('/meu-perfil',(req,res)=>res.sendFile(path.join(__dirname,'../public/index.html')));outer.use(app);
(async()=>{
 const server=http.createServer(outer);await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'domcontentloaded'});
  await page.locator('#login-user').fill('ana.chiacchio');await page.locator('#login-senha').fill('senhaChia');await page.locator('.login-btn').first().click();
  try{await page.locator('#page-meu-perfil.active').waitFor({timeout:10000})}catch(e){console.log('DEBUG',await page.evaluate(()=>({loginError:document.getElementById('login-err')?.textContent,loginDisplay:document.getElementById('login-screen')?.style.display,token:!!sessionStorage.getItem('sac-token'),profileLoaded:!!window.perfilProfissionalVerificar,profilePending:window.mpPerfilPendente,active:[...document.querySelectorAll('.page.active')].map(x=>x.id)})),errors);throw e}
  assert.equal(await page.locator('#mp-step-label').innerText(),'Etapa 1 de 5');await page.screenshot({path:'/tmp/meu-perfil-onboarding.png'});
  await page.locator('#mp-next').click();await page.locator('#mp-step-label').getByText('Etapa 2 de 5').waitFor();
  await page.locator('[data-mp-key="descricaoFuncao"]').fill('Analisa entregas');
  await page.locator('#mp-next').click();await page.locator('[data-mp-key="responsabilidades"]').fill('Atendimento; Prazo');await page.locator('#mp-status').getByText('Salvo',{exact:true}).waitFor();
  await page.reload({waitUntil:'domcontentloaded'});try{await page.locator('#page-meu-perfil.active').waitFor({timeout:10000})}catch(e){console.log('RELOAD_URL',page.url(),'RELOAD',await page.evaluate(()=>({loginDisplay:document.getElementById('login-screen')?.style.display,token:!!sessionStorage.getItem('sac-token'),profileLoaded:!!window.perfilProfissionalVerificar,profilePending:window.mpPerfilPendente,active:[...document.querySelectorAll('.page.active')].map(x=>x.id),error:document.getElementById('mp-error')?.textContent})),errors);throw e}
  await page.locator('#mp-step-label').getByText('Etapa 1 de 5').waitFor();await page.locator('#mp-next').click();assert.equal(await page.locator('[data-mp-key="descricaoFuncao"]').inputValue(),'Analisa entregas');
  for(let i=0;i<3;i++){await page.locator('#mp-next').click();try{await page.locator('#mp-step-label').getByText(`Etapa ${i+3} de 5`).waitFor({timeout:5000})}catch(e){console.log('STEP',i,await page.evaluate(()=>({step:document.getElementById('mp-step-label')?.textContent,error:document.getElementById('mp-error')?.textContent,status:document.getElementById('mp-status')?.textContent})),errors);throw e}}
  await page.locator('#mp-next').click();try{await page.locator('#page-visao-geral.active').waitFor({timeout:12000})}catch(e){console.log('FINISH',await page.evaluate(()=>({step:document.getElementById('mp-step-label')?.textContent,error:document.getElementById('mp-error')?.textContent,status:document.getElementById('mp-status')?.textContent,pending:window.mpPerfilPendente,badge:document.getElementById('mp-badge')?.textContent,active:[...document.querySelectorAll('.page.active')].map(x=>x.id)})),errors,require('./sheets-mock').DB.PERFIS_PROFISSIONAIS);throw e}
  await page.locator('#mp-user-link').click();await page.locator('#page-meu-perfil.active').waitFor();
  assert.ok(!errors.some(x=>x.includes('meu-perfil')),errors.join('\n'));
  console.log('Browser: login, 5 etapas, rascunho após reload, conclusão e reabertura aprovados.');
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
