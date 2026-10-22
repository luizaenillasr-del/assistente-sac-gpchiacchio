'use strict';
const assert=require('node:assert/strict');
const http=require('node:http');
const path=require('node:path');
process.env.NODE_ENV='test';
process.env.SESSION_SECRET='test-secret-for-behavioral-tests-32chars-ok';
process.env.SHEETS_MOCK_PATH=path.join(__dirname,'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED='false';
const app=require('../api/index.js');
const mock=require('./sheets-mock.js');
async function main(){
 const server=http.createServer(app);
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${server.address().port}`;
 async function request(route,method='GET',token='',body){const r=await fetch(base+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()}}
 try{
  let login=await request('/api/auth/login','POST','',{usuario:'ana.chiacchio',senha:'senhaChia'});
  assert.equal(login.status,200);assert.equal(login.body.usuarioInfo.perfilProfissionalCompleto,false);
  let token=login.body.token;
  assert.equal((await request('/api/manifestacoes','GET',token)).status,428);
  let p=await request('/api/meu-perfil','GET',token);assert.equal(p.status,200);assert.equal(p.body.completo,false);
  let draft=await request('/api/meu-perfil','PATCH',token,{descricaoFuncao:'Analisa entregas',responsabilidades:['Atendimento'],perfil:'MASTER',empresa:'PLASCHIO'});
  assert.equal(draft.status,200);assert.equal(draft.body.completo,false);assert.equal(draft.body.perfil.empresa,'CHIACCHIO EMBALAGENS');
  p=await request('/api/meu-perfil','GET',token);assert.equal(p.body.perfil.descricaoFuncao,'Analisa entregas');
  const invalid=await request('/api/meu-perfil','PATCH',token,{descricaoFuncao:'',responsabilidades:[],concluir:true});assert.equal(invalid.status,400);
  const done=await request('/api/meu-perfil','PATCH',token,{descricaoFuncao:'Analisa entregas',responsabilidades:['Atendimento'],processos:['Expedição'],concluir:true});
  assert.equal(done.status,200);assert.equal(done.body.completo,true);token=done.body.token;
  assert.notEqual((await request('/api/manifestacoes','GET',token)).status,428);
  const again=await request('/api/auth/login','POST','',{usuario:'ana.chiacchio',senha:'senhaChia'});assert.equal(again.body.usuarioInfo.perfilProfissionalCompleto,true);
  const tamper=await request('/api/meu-perfil','PATCH',token,{descricaoFuncao:'',responsabilidades:[]});assert.equal(tamper.status,400);
  mock.DB.PERFIS_PROFISSIONAIS.push({ID_USUARIO:'USR-PLA-001',STATUS:'CONCLUIDO',DADOS_JSON:JSON.stringify({descricaoFuncao:'Expedição',responsabilidades:['Transporte'],processos:['Expedição']})});
  const list=await request('/api/perfis/colaboradores','GET',token);assert.equal(list.status,200);assert.ok(list.body.itens.some(x=>x.idUsuario==='USR-CHI-001'));assert.ok(!list.body.itens.some(x=>x.idUsuario==='USR-PLA-001'));
  const experts=await request('/api/perfis/especialistas?processo=expedicao','GET',token);assert.equal(experts.status,200);assert.ok(experts.body.itens.every(x=>x.empresa!=='PLASCHIO'));
  mock.DB.USUARIOS.push({ID_USUARIO:'USR-RCA-TEST',USUARIO:'rca.teste',NOME:'Representante Teste',PERFIL:'RCA / REPRESENTANTE',EMPRESA:'CHIACCHIO EMBALAGENS',CODIGO_RCA:'RCA-TEST',STATUS:'ATIVO'});
  mock.DB.PERFIS_PROFISSIONAIS.push({ID_USUARIO:'USR-RCA-TEST',STATUS:'CONCLUIDO',DADOS_JSON:JSON.stringify({descricaoFuncao:'Representação',responsabilidades:['Clientes']})});
  const rcas=await request('/api/cadastros/rcas','GET',token);assert.equal(rcas.status,200);assert.ok(rcas.body.itens.some(x=>x.USUARIO_ID==='USR-RCA-TEST'&&x.ORIGEM_PERFIL==='SIM'));
  assert.equal(rcas.body.itens.filter(x=>x.USUARIO_ID==='USR-RCA-TEST').length,1);
  console.log('Perfil: onboarding, rascunho, dados oficiais, conclusão, retorno, autorização e escopo aprovados.');
 }finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(e);process.exitCode=1});
