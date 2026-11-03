# 11 — Plano Consolidado de Correção
**Data:** 2026-11-03  
**Status**: Aguardando autorização para implementar

> ⚠️ Este documento descreve O QUE deve ser feito e em qual ordem. Nenhuma correção foi implementada. Aguardar autorização explícita antes de executar qualquer item.

---

## Fase 1 — Segurança Imediata (Críticas)

### 1.1 Corrigir autenticação nas rotas `/api/matriz-conhecimento` (C1)

**Arquivo**: `api/index.js` (linhas 10329-10491)  
**Esforço**: 1-2 horas  
**Risco**: Baixo — adicionar middleware, sem alterar lógica  

Ações:
1. Adicionar `requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL')` nas rotas GET
2. Adicionar `requerPerfil('MASTER','ANALISTA SAC')` nas rotas POST/PUT/PATCH
3. Adicionar `requerPerfil('MASTER','ANALISTA SAC')` nas rotas DELETE
4. Adicionar `middlewareEscopoEmpresa()` onde aplicável
5. Criar teste em `tests/matriz-conhecimento-auth.js` verificando 401 sem token

**Exemplo de correção**:
```js
// ANTES:
app.get('/api/matriz-conhecimento', async (req, res) => {

// DEPOIS:
app.get('/api/matriz-conhecimento', requerPerfil('MASTER','GESTOR SAC','ANALISTA SAC','APROVADOR','SETOR RESPONSÁVEL'), middlewareEscopoEmpresa(), async (req, res) => {
```

---

### 1.2 Adicionar logging estruturado em `erroSeguro` (C2)

**Arquivo**: `api/index.js` (~linha 1802)  
**Esforço**: 2-3 horas  
**Risco**: Baixo — não altera comportamento da resposta HTTP  

Ações:
1. Gerar `correlationId` por request (middleware de request ID)
2. Em `erroSeguro`, adicionar `console.error('[ERR]', correlationId, e.stack || e.message)`
3. Retornar `{ erro: 'Erro interno', ref: correlationId }` em vez de string plana
4. Garantir que correlationId apareça nos headers de resposta (`X-Request-Id`)

---

## Fase 2 — Confiabilidade em Produção (Altas)

### 2.1 Tornar `PESQUISA_SPREADSHEET_ID` obrigatória em produção (A1)

**Arquivo**: `api/index.js` (próximo à linha 376)  
**Esforço**: 30 minutos  

```js
// ANTES:
if (!process.env.PESQUISA_SPREADSHEET_ID) {
  console.warn('[AVISO C5]...')
}

// DEPOIS:
if (!process.env.PESQUISA_SPREADSHEET_ID) {
  console.warn('[AVISO C5]...')
  if (process.env.NODE_ENV === 'production') process.exit(1);
}
```

---

### 2.2 Validar `conhecimentoRepo` antes de acesso a propriedades (A3)

**Arquivo**: `api/index.js` e `server-services/cerebroServices.js`  
**Esforço**: 2-3 horas  

Ações:
1. Localizar todas as chamadas que acessam propriedades de objetos retornados pelo PG sem verificar null
2. Adicionar guarda `if (!result || !result.manifestacao)` antes de acesso
3. Em respostas degradadas, incluir `{ fonte: 'sheets', aviso: 'PG indisponível' }` opcional

---

### 2.3 Definir `AI_PROVIDER` obrigatória em produção (A2)

**Arquivo**: `api/index.js` (linha ~367)  
**Esforço**: 15 minutos  

Ações:
1. Adicionar `if (!process.env.AI_PROVIDER && NODE_ENV==='production') process.exit(1)`
2. Documentar `AI_PROVIDER=openai` como obrigatória no README/env.example

---

### 2.4 Documentar dual-write e criar estratégia de reconciliação (A4)

**Esforço**: 4-8 horas (análise + documentação + implementação básica)  

Ações:
1. Mapear todos os pontos onde Sheets e PG são escritos em sequência
2. Escolher fonte autoritativa por tipo de dado
3. Implementar verificação periódica de integridade (script de reconciliação)
4. **Não** tentar transação distribuída (overengineering) — preferir eventual consistency documentada

---

## Fase 3 — Qualidade Operacional (Médias)

### 3.1 Invalidar cache após escritas (M1)

**Arquivo**: `api/index.js`  
**Esforço**: 2-3 horas  

Localizar todos os POSTs e PATCHes que escrevem em abas com TTL>0 e chamar `invalidarCacheAba(nome)` após escrita bem-sucedida.

---

### 3.2 Validar HMAC no webhook WhatsApp (M6)

**Arquivo**: `api/index.js` (~linha 12003)  
**Esforço**: 1-2 horas  

```js
// Adicionar no início do handler POST:
const signature = req.headers['x-hub-signature-256'];
const expectedSig = 'sha256=' + crypto.createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
  .update(JSON.stringify(req.body)).digest('hex');
if (signature !== expectedSig) return res.status(403).json({ erro: 'Assinatura inválida' });
```

---

### 3.3 Alertas automáticos de SLA (M4)

**Esforço**: 4-8 horas  

Ações:
1. Criar função `verificarSLAsProximos()` que filtra manifestações com SLA ≥ 75% ou vencido
2. Chamar na rota de notificações ou como job periódico
3. Enviar e-mail via Resend para responsável quando SLA entrar em Alerta
4. Registrar em `HISTORICO_VALIDACOES` ou similar

---

### 3.4 Retornar erro explícito quando Drive indisponível (M5)

**Arquivo**: `api/index.js` (handler de anexos)  
**Esforço**: 30 minutos  

Em vez de absorver silenciosamente, retornar:
```json
{ "aviso": "Upload de anexo não disponível — Google Drive não configurado", "anexo": null }
```

---

### 3.5 Verificar e proteger `POST /api/bootstrap` (B2)

**Arquivo**: `api/index.js` (~linha 8807) + `bootstrapHandler`  
**Esforço**: 1 hora  

1. Verificar se `bootstrapHandler` valida token interno
2. Se não: adicionar verificação de chave `BOOTSTRAP_SECRET` no header ou no body
3. Ou adicionar `requerPerfil('MASTER')` se só deve ser executado por usuário autenticado

---

## Fase 4 — Qualidade e Sustentabilidade (Baixas)

### 4.1 Investigar timeout em `relatorio-satisfacao.js` (B3)
**Esforço**: 1-2 horas  

### 4.2 Demo login com exit em produção (B4)
**Esforço**: 15 minutos  

### 4.3 Extração progressiva de rotas de `api/index.js` (M2)
**Esforço**: 2-4 semanas (progressivo)  
Não urgente — priorizar depois das fases 1-3.

---

## Ordem de Execução Recomendada

```
Sprint 1 (Segurança imediata):
  1.1 — Autenticação matriz-conhecimento (C1) ← MAIS URGENTE
  1.2 — Logging estruturado erroSeguro (C2)

Sprint 2 (Produção):
  2.1 — PESQUISA_SPREADSHEET_ID obrigatória (A1)
  2.2 — Null-checks PG (A3)
  2.3 — AI_PROVIDER obrigatória (A2)
  3.5 — Bootstrap seguro (B2)
  3.2 — HMAC WhatsApp (M6)

Sprint 3 (Qualidade):
  2.4 — Estratégia dual-write (A4)
  3.1 — Invalidar cache (M1)
  3.3 — Alertas SLA (M4)
  3.4 — Erro Drive explícito (M5)

Sprint 4 (Sustentabilidade):
  4.1 — Timeout relatorio-satisfacao
  4.2 — Demo login exit
  4.3 — Refatoração routes (longo prazo)
```

---

## Critérios de Conclusão por Item

Cada item deve ser considerado concluído quando:
1. Correção implementada no código
2. Teste executável criado ou existente comprova o comportamento
3. `npm test` passa sem regressões
4. PR criada e revisada
5. Merge autorizado pelo responsável
