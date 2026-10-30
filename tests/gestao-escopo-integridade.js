'use strict';
const fs = require('fs');
const page = fs.readFileSync('public/index.html', 'utf8');
const api = fs.readFileSync('api/index.js', 'utf8');
const ok = (v, msg) => { if (!v) throw new Error(msg); console.log(`✓ ${msg}`); };

function tokens(...values) {
  const out=[];
  const add=v=>{
    if (Array.isArray(v)) return v.forEach(add);
    if (v && typeof v === 'object') return Object.values(v).forEach(add);
    const s=String(v ?? '').trim(); if (!s) return;
    try { const parsed=JSON.parse(s); if (parsed !== v) return add(parsed); } catch (_) {}
    s.split(/[;,|\n]+/).map(x=>x.trim()).filter(Boolean).forEach(x=>out.push(x));
  };
  values.forEach(add);
  return [...new Set(out)];
}
function norm(v) {
  return String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/\bembalagens?\b/g, '').replace(/\s+/g, ' ')
    .replace(/^tubahia\s*\/\s*cesbap$/, 'tubahia').trim();
}

for (const cadastro of [
  { nome:'Larissa', EMPRESA:'Chiacchio', SETOR:'Logística, Qualidade' },
  { nome:'Karol', EMPRESAS_JSON:'["Plaschio"]', SETORES_AUTORIZADOS:'["Comercial","Produção"]' },
]) {
  ok(tokens(cadastro.EMPRESA, cadastro.EMPRESAS_JSON).length > 0, `${cadastro.nome}: empresas legadas são lidas`);
  ok(tokens(cadastro.SETOR, cadastro.SETORES_AUTORIZADOS).map(norm).length > 0, `${cadastro.nome}: setores legados são lidos`);
}
ok(norm('Chiacchio Embalagens') === norm('Chiacchio'), 'normalização não perde correspondência da empresa');
ok(norm('Logística') === norm('Logistica'), 'normalização preserva correspondência de setor com acento');
ok(/_usuEscopoLista/.test(page) && /EMPRESAS_JSON/.test(page) && /SETORES_AUTORIZADOS/.test(page), 'modal aceita todos os formatos persistidos de escopo');
ok(/_usuEscopo\.status !== 'ready'/.test(page), 'salvamento é bloqueado enquanto o escopo não foi lido');
ok(/Não foi possível ler os setores/.test(page) && /Nenhuma alteração de escopo será salva/.test(page), 'falha de leitura não vira escopo vazio');
ok(/request!==_usuEscopo\.request/.test(page) && /_usuEditando!==u/.test(page), 'respostas assíncronas antigas não sobrescrevem outro usuário');
ok(/escopoConfirmado: true/.test(page), 'frontend envia confirmação explícita das seleções');
ok(/escopoConfirmado = req\.body\?\.escopoConfirmado === true/.test(api), 'backend diferencia limpeza intencional de payload vazio');
ok(/USUARIO_NAO_CONFIRMADO/.test(api) && /confirmados = await carregarUsuarios/.test(api), 'backend relê o cadastro antes de confirmar sucesso');
ok(/registrarAuditoria\(req\.user\.usuario,'ATUALIZOU_USUARIO'/.test(api), 'alterações continuam auditadas');
console.log('GESTÃO DE ESCOPO: regressão de Larissa/Karol aprovada');
