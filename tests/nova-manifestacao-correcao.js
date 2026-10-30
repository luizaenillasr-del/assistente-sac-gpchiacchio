'use strict';

// Regressão isolada do fluxo Nova Manifestação. Não usa Vercel, Neon, Drive ou
// Google Sheets: o backend é executado contra o mock local.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'nova-manifestacao-correcao-secret-32';
process.env.SHEETS_MOCK_PATH = path.resolve(__dirname, 'sheets-mock.js');
process.env.DEMO_LOGIN_ENABLED = 'false';
delete process.env.DATABASE_URL;
delete process.env.GOOGLE_CREDENTIALS;

const html = fs.readFileSync(path.resolve(__dirname, '../public/index.html'), 'utf8');
assert.ok(html.includes('res.protocolo || res.id'), 'a tela deve exibir o protocolo oficial retornado pelo backend');
assert.ok(html.includes('/api/manifestacoes/${encodeURIComponent(technicalId)}/evidencias'), 'a ficha deve recuperar anexos pelo identificador técnico');
assert.match(html, /_nmRascunhoUltimaEdicao/, 'o rascunho deve controlar a versão retornada pelo armazenamento');
assert.match(html, /_nmEvidenciasPersistidas/, 'anexos persistidos devem continuar visíveis após reabrir a ficha');
assert.match(html, /ultimaEdicaoConhecida/, 'salvamentos concorrentes devem enviar a versão conhecida');
assert.match(fs.readFileSync(path.resolve(__dirname, '../api/index.js'), 'utf8'), /RASCUNHO_CONCORRENTE/, 'o backend deve rejeitar uma gravação fora de ordem');
assert.ok(html.includes('Preencha os campos obrigatórios:'), 'a navegação deve informar campos obrigatórios pendentes');
assert.ok(html.includes('nmTextoEstruturado'), 'valores estruturados do Cérebro devem ser normalizados antes da exibição');

function token(payload) {
  const body = Buffer.from(JSON.stringify({ ...payload, iat: Date.now(), exp: Date.now() + 3600000 })).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', process.env.SESSION_SECRET).update(body).digest('base64url')}`;
}

function request(base, method, route, auth, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(route, base);
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = http.request({ method, hostname:url.hostname, port:url.port, path:url.pathname + url.search,
      headers:{ 'Content-Type':'application/json', 'Content-Length':Buffer.byteLength(payload), Authorization:`Bearer ${auth}` } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => { let parsed = {}; try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { raw }; } resolve({ status:res.statusCode, body:parsed }); });
    });
    req.on('error', reject); if (body !== undefined) req.write(payload); req.end();
  });
}

(async () => {
  const mock = require('./sheets-mock');
  mock.protocoloPrisma.reset();
  Object.keys(require.cache).filter(k => k.includes('/api/index')).forEach(k => delete require.cache[k]);
  const app = require('../api/index');
  let server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const master = token({ perfil:'MASTER', empresa:'Grupo Chiacchio', usuario:'master.test', id:'USR-MST-001' });
  const key = 'NOVA-CORRECAO-001';
  let createdId = '', draftId = '', actionIds = [];
  try {
    const draft = await request(base, 'POST', '/api/manifestacoes', master, {
      rascunho:true, empresaReclamada:'PLASCHIO', empresaReclamante:'Cliente Rascunho', contato:'Contato Rascunho', cnpj:'123', telefone:'555', email:'draft@example.test',
      tipo:'Reclamação', canal:'TELEFONE', prioridade:'ALTA', produto:'Potes', lote:'L-9', nfe:'NF-9', quantidade:'10', descricao:'Relato original completo do rascunho que deve permanecer intacto após atualizações parciais.',
    });
    assert.equal(draft.status, 200, JSON.stringify(draft.body)); draftId=draft.body.id;
    let draftRow=mock.DB.MANIFESTACOES.find(r=>r.ID_MANIFESTACAO===draftId);
    assert.equal(draftRow.PRIORIDADE,'ALTA'); assert.equal(draftRow.DESCRICAO,'Relato original completo do rascunho que deve permanecer intacto após atualizações parciais.');
    draftRow.ANALISE_IA=JSON.stringify({hipoteses:['hipotese-preservada'],decisaoEtapa2:{status:'PENDENTE_VALIDACAO'}});
    const patchDraft=await request(base,'PATCH',`/api/manifestacoes/${encodeURIComponent(draftId)}/circa-dados`,master,{descricao:'Relato alterado somente no campo permitido.',empresaReclamante:'',analiseIA:JSON.stringify({orientacoes:['orientacao-nova']}),ultimaEdicaoConhecida:draft.body.atualizadoEm});
    assert.equal(patchDraft.status,200,JSON.stringify(patchDraft.body));
    draftRow=mock.DB.MANIFESTACOES.find(r=>r.ID_MANIFESTACAO===draftId);
    assert.equal(draftRow.DESCRICAO,'Relato alterado somente no campo permitido.'); assert.equal(draftRow.PRODUTO,'Potes'); assert.equal(draftRow.LOTE,'L-9'); assert.equal(draftRow.NFE,'NF-9'); assert.equal(draftRow.CANAL,'TELEFONE'); assert.equal(draftRow.EMPRESA_RECLAMANTE,'Cliente Rascunho');
    const analiseRascunho=JSON.parse(draftRow.ANALISE_IA); assert.deepEqual(analiseRascunho.hipoteses,['hipotese-preservada']); assert.deepEqual(analiseRascunho.orientacoes,['orientacao-nova']); assert.equal(analiseRascunho.decisaoEtapa2.status,'PENDENTE_VALIDACAO');
    const stale=await request(base,'PATCH',`/api/manifestacoes/${encodeURIComponent(draftId)}/circa-dados`,master,{produto:'Outro',ultimaEdicaoConhecida:draft.body.atualizadoEm});
    assert.equal(stale.status,409,'gravação com versão antiga deve ser rejeitada sem sobrescrever dados');

    const analise = await request(base, 'POST', '/api/analise', master, {
      descricao:'A embalagem chegou danificada e o cliente solicita retorno.', tipo:'Reclamação',
      empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Cliente Teste', produto:'Caixa',
      canal:'E-mail', nfe:'NF-123', quantidade:'2', nome:'Contato Teste', email:'contato@example.test',
    });
    assert.equal(analise.status, 200, JSON.stringify(analise.body));
    const ausentes = analise.body.analise?.informacoesAusentes || [];
    assert.ok(!ausentes.includes('DESCRICAO'), 'descrição preenchida não pode aparecer como ausente');
    assert.ok(!ausentes.includes('EMPRESA_RECLAMADA'), 'empresa preenchida não pode aparecer como ausente');
    assert.ok(!ausentes.includes('CANAL'), 'canal preenchido não pode aparecer como ausente');

    const plaschio = await request(base, 'POST', '/api/analise', master, {
      empresaReclamada:'PLASCHIO', empresaReclamante:'Cliente PLASCHIO', canal:'TELEFONE',
      tipo:'Reclamação', produto:'Potes', lote:'123', nfe:'3215', nome:'Cliente PLASCHIO',
      descricao:'Atraso de três dias na entrega e aproximadamente 1.200 potes com dificuldade de encaixe das tampas.',
    });
    assert.equal(plaschio.status, 200, JSON.stringify(plaschio.body));
    assert.deepEqual(plaschio.body.analise?.hipotesesClassificacao?.map(h => h.codigo), ['ATRASO_LOGISTICO', 'NAO_CONFORMIDADE_PRODUTO']);
    assert.deepEqual(plaschio.body.analise?.informacoesAusentes || [], [], 'o caso PLASCHIO não pode perder descrição/canal no backend');

    const anexo = { nome:'evidencia.txt', mimeType:'image/png', tamanho:3, categoria:'EVIDENCIA', dataBase64:'data:image/png;base64,AQID' };
    const criado = await request(base, 'POST', '/api/manifestacoes', master, {
      idempotencyKey:key, empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Cliente Teste',
      contato:'Contato Teste', descricao:'A entrega atrasou três dias e aproximadamente 1.200 potes apresentam dificuldade de encaixe das tampas. Relato completo para registrar a reclamação.', tipo:'Reclamação',
      canal:'TELEFONE', produto:'potes', lote:'123456', nfe:'987654',
      anexos:[anexo], analiseIA:JSON.stringify({ tipoDetectado:'Reclamação', devolutivaSugerida:'Recebemos seu relato e iniciaremos a apuração.' }),
    });
    assert.equal(criado.status, 200, JSON.stringify(criado.body));
    createdId = criado.body.id;
    assert.match(criado.body.protocolo, /^CHIA-\d{8}-[A-Z0-9]{2}-\d{4}$/, 'protocolo oficial deve ser exibido');
    const row = mock.DB.MANIFESTACOES.find(r => r.ID_MANIFESTACAO === criado.body.id);
    assert.equal(row.STATUS, 'AGUARDANDO_TRIAGEM_SAC');
    assert.equal(row.PROTOCOLO, criado.body.protocolo);
    assert.match(row.DESCRICAO, /atrasou três dias/i, 'o rascunho deve persistir o relato completo');
    assert.equal(row.CANAL, 'TELEFONE', 'o rascunho deve persistir o canal selecionado');
    assert.ok(!String(row.ANEXOS).includes('dataBase64'), 'Base64 não pode ser gravado na ficha');
    assert.ok(String(row.ANEXOS).includes('evidencia.txt'), 'metadado do anexo deve permanecer vinculado');

    const recuperada = await request(base, 'GET', `/api/manifestacoes/${encodeURIComponent(criado.body.id)}`, master);
    assert.equal(recuperada.status, 200, JSON.stringify(recuperada.body));
    assert.ok(String(recuperada.body.manifestacao?.ANALISE_IA || '').includes('tipoDetectado'), 'análise deve permanecer recuperável na ficha');
    const circaPersistido = await request(base, 'GET', `/api/manifestacoes/${encodeURIComponent(criado.body.id)}/circa`, master);
    assert.equal(circaPersistido.status, 200, JSON.stringify(circaPersistido.body));
    const ausentesPersistidos = circaPersistido.body.circa?.analiseEstruturada?.informacoesAusentes || [];
    assert.ok(!ausentesPersistidos.includes('DESCRICAO'), 'o CIRCA da ficha persistida deve reconhecer a descrição');
    assert.ok(!ausentesPersistidos.includes('CANAL'), 'o CIRCA da ficha persistida deve reconhecer o canal');
    const hipotesesPersistidas = circaPersistido.body.circa?.analiseEstruturada?.hipotesesClassificacao || [];
    assert.deepEqual(hipotesesPersistidas.map(h => h.codigo), ['ATRASO_LOGISTICO', 'NAO_CONFORMIDADE_PRODUTO'], 'o CIRCA deve distinguir atraso e possível defeito do produto');
    const evidencias = await request(base, 'GET', `/api/manifestacoes/${encodeURIComponent(criado.body.id)}/evidencias`, master);
    assert.equal(evidencias.status, 200, JSON.stringify(evidencias.body));
    assert.ok(evidencias.body.itens.some(item => item.nome === 'evidencia.txt'), 'anexo deve ser recuperável pelo protocolo interno');

    const actionBodies = [
      { tipo:'NOTIFICACAO', tarefa:'Solicitar retorno ao cliente', prazoOrigem:'SLA_RETORNO_CLIENTE_96H', idempotencyKey:key+'-cliente' },
      { tipo:'ENCAMINHAMENTO_TRATATIVA', setorDestino:'QUALIDADE', tarefa:'Investigar encaixe das tampas', prazo:'72', prazoOrigem:'SLA_RETORNO_SETOR_72H', idempotencyKey:key+'-qualidade' },
      { tipo:'ENCAMINHAMENTO_TRATATIVA', setorDestino:'LOGÍSTICA', tarefa:'Verificar atraso de entrega', prazo:'72', prazoOrigem:'SLA_RETORNO_SETOR_72H', idempotencyKey:key+'-logistica' },
    ];
    for (const body of actionBodies) {
      const createdAction = await request(base,'POST',`/api/manifestacoes/${encodeURIComponent(createdId)}/acionamentos`,master,body);
      assert.equal(createdAction.status,201,JSON.stringify(createdAction.body));
      actionIds.push(createdAction.body.item.ID_ACIONAMENTO);
    }
    const actionList = await request(base,'GET',`/api/manifestacoes/${encodeURIComponent(createdId)}/acionamentos`,master);
    assert.equal(actionList.status,200,JSON.stringify(actionList.body));
    assert.equal(actionList.body.diagnostico?.fonte,'ACIONAMENTOS_INTERNOS');
    assert.equal(actionList.body.diagnostico?.armazenamento,'Google Sheets');
    assert.equal(actionList.body.diagnostico?.totalCorrespondentes,3,'a leitura deve informar quantas ações realmente encontrou');
    assert.equal(actionList.body.itens.filter(a=>actionIds.includes(a.ID_ACIONAMENTO)).length,3,'as três frentes devem ser recuperáveis do armazenamento');
    assert.deepEqual(actionList.body.itens.filter(a=>actionIds.includes(a.ID_ACIONAMENTO)).map(a=>a.SETOR_DESTINO||a.TIPO),['NOTIFICACAO','QUALIDADE','LOGÍSTICA']);
    assert.equal(actionList.body.itens.find(a=>a.ID_ACIONAMENTO===actionIds[1]).PRAZO_ORIGEM,'SLA_RETORNO_SETOR_72H');
    const actionByProtocol = await request(base,'GET',`/api/manifestacoes/${encodeURIComponent(criado.body.protocolo)}/acionamentos`,master);
    assert.equal(actionByProtocol.status,200,JSON.stringify(actionByProtocol.body));
    assert.equal(actionByProtocol.body.itens.filter(a=>actionIds.includes(a.ID_ACIONAMENTO)).length,3,'o protocolo público deve resolver as mesmas frentes pelo vínculo persistido');
    const historyByProtocol = await request(base,'GET',`/api/manifestacoes/${encodeURIComponent(criado.body.protocolo)}/historico`,master);
    assert.equal(historyByProtocol.status,200,JSON.stringify(historyByProtocol.body));
    const evidenceByProtocol = await request(base,'GET',`/api/manifestacoes/${encodeURIComponent(criado.body.protocolo)}/evidencias`,master);
    assert.equal(evidenceByProtocol.status,200,JSON.stringify(evidenceByProtocol.body));
    await new Promise(resolve => server.close(resolve));
    server = http.createServer(app);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    const reopened = await request(base,'GET',`/api/manifestacoes/${encodeURIComponent(criado.body.protocolo)}/acionamentos`,master);
    assert.equal(reopened.status,200,JSON.stringify(reopened.body));
    assert.equal(reopened.body.itens.filter(a=>actionIds.includes(a.ID_ACIONAMENTO)).length,3,'as três ações devem sobreviver à reinicialização da aplicação');

    const repetido = await request(base, 'POST', '/api/manifestacoes', master, {
      idempotencyKey:key, empresaReclamada:'CHIACCHIO EMBALAGENS', empresaReclamante:'Outro cliente',
      contato:'Outro contato', descricao:'Tentativa repetida não deve criar segunda ficha.', canal:'E-mail',
    });
    assert.equal(repetido.status, 200);
    assert.equal(repetido.body.id, criado.body.id);
    assert.equal(mock.DB.MANIFESTACOES.filter(r => r.ID_MANIFESTACAO === criado.body.id).length, 1);
    console.log('Nova manifestação: análise com campos completos, salvamento sem HTTP 500, protocolo oficial único, triagem e anexo sem Base64 na ficha aprovados.');
  } finally {
    const i = mock.DB.MANIFESTACOES.findIndex(r => r.ID_MANIFESTACAO === createdId);
    if (i >= 0) mock.DB.MANIFESTACOES.splice(i, 1);
    const di = mock.DB.MANIFESTACOES.findIndex(r => r.ID_MANIFESTACAO === draftId);
    if (di >= 0) mock.DB.MANIFESTACOES.splice(di, 1);
    for (let i=mock.DB.ACIONAMENTOS_INTERNOS.length-1;i>=0;i--) if(actionIds.includes(mock.DB.ACIONAMENTOS_INTERNOS[i].ID_ACIONAMENTO)) mock.DB.ACIONAMENTOS_INTERNOS.splice(i,1);
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
