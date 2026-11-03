# 08 — Segurança e Integridade
**Data:** 2026-11-03

---

## 1. Autenticação

### 1.1 Login
- `POST /api/auth/login` — verifica hash bcrypt da senha
- Cria sessão com TTL de 8 horas
- Demo login controlado por `DEMO_LOGIN_ENABLED` (deve estar `false` em produção)

### 1.2 Sessão
- `SESSION_SECRET` deve ter ≥ 32 caracteres
- Se não definida, sistema gera aleatória e loga aviso:
  ```js
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    // warn; em produção: process.exit(1)
  ```
- Em desenvolvimento: fallback com `crypto.randomBytes(32)` — sessões não persistem entre restarts

### 1.3 Hash de Senha
- `bcryptjs` — adequado para hash de senhas
- Versão `^3.0.3` — verificar se é bcrypt ou bcryptjs (diferença em segurança)

---

## 2. Autorização

### 2.1 Pontos Fortes
- `requerPerfil()` e `requerPermissao()` aplicados em 272 rotas
- `middlewareEscopoEmpresa()` garante isolamento de dados entre empresas
- Roles bem definidos: MASTER, APROVADOR, ANALISTA SAC, etc.
- Permissões granulares por recurso/ação

### 2.2 ⚠️ CRÍTICO: Matriz de Conhecimento sem Autenticação

12 rotas do módulo `/api/matriz-conhecimento` **não têm middleware de autenticação**:

```js
app.get('/api/matriz-conhecimento', async (req, res) => { ... })        // SEM AUTH
app.get('/api/matriz-conhecimento/:id', async (req, res) => { ... })    // SEM AUTH
app.post('/api/matriz-conhecimento', async (req, res) => { ... })       // SEM AUTH
app.put('/api/matriz-conhecimento/:id', async (req, res) => { ... })    // SEM AUTH
// + 8 rotas de subitens/ações
```

**Impacto**: Qualquer pessoa com acesso à URL da API pode:
- Ler toda a matriz de conhecimento da empresa
- Criar, editar e deletar entradas da matriz
- Resolver casos na matriz sem autenticação

---

## 3. Exposição de Informações

### 3.1 `erroSeguro()` — ALTA

```js
function erroSeguro(e) {
  if (process.env.NODE_ENV === 'production') return 'Erro interno do servidor.';
  return e?.message || 'Erro interno do servidor.';
}
```

**Problema 1**: Em produção, oculta completamente o erro — impossibilita diagnóstico remoto de falhas sem acesso aos logs do servidor.

**Problema 2**: Erros de validação, autorização e lógica de negócio são todos mascarados com a mesma mensagem genérica, sem código de erro ou referência para suporte.

**Contraste positivo**: A função impede exposição de stack traces e mensagens internas para o cliente em produção — **isso é correto**. O problema é que não há logging estruturado associado.

### 3.2 Credenciais

- `DATABASE_URL` e `DATABASE_URL_UNPOOLED`: usados pelo Prisma, não expostos em respostas
- `GOOGLE_CREDENTIALS`: JSON de service account, carregado na inicialização (`process.env.GOOGLE_CREDENTIALS`)
- `RESEND_API_KEY`: inicialização de cliente Resend
- `OPENAI_API_KEY` / `ANTHROPIC_API_KEY`: usados em `aiService.js`
- Nenhum desses foi encontrado em respostas HTTP no código auditado ✅

### 3.3 `GET /api/public/empresas`
- Rota pública expõe lista de empresas do grupo
- Sem autenticação, com `publicRateLimit`
- Possível information disclosure — verificar se a informação é sensível

---

## 4. Injeção e Validação

### 4.1 Injeção em Sheets
- Dados são passados diretamente para a API do Google Sheets
- Google Sheets API não é vulnerável a SQL injection por natureza
- Campos como `DESCRICAO` podem conter HTML — verificar se é renderizado no frontend sem sanitização

### 4.2 Validação de Entrada
- Whitelist de campos em PATCH endpoints (linha 7849: array `allowed`)
- Campos fora da whitelist são ignorados — proteção adequada contra mass assignment

### 4.3 WhatsApp Webhook

```js
app.post('/api/public/whatsapp/webhook', async (req, res) => { ... })
```

- Sem validação de assinatura HMAC (padrão da API WhatsApp Business)
- Qualquer cliente pode enviar payload simulado ao webhook
- **Impacto**: Possível injeção de mensagens falsas no sistema

---

## 5. CORS

- `cors` configurado globalmente
- Verificar se `origin` está restrito ao domínio da aplicação ou aberto (`*`)
- Não foi possível confirmar configuração sem ler linha específica de CORS setup

---

## 6. Rate Limiting

### `publicRateLimit` (linha 9132)
Aplicado em:
- `POST /api/public/reclamacoes`
- `GET /api/public/empresas`
- `GET /pesquisa/:token`
- `GET /api/public/protocolo/:protocolo`
- Etc.

Proteção adequada contra abuso de endpoints públicos.

---

## 7. Bootstrap Endpoint

```js
app.post('/api/bootstrap', async (req, res) => bootstrapHandler(req, res));
```

- Sem middleware de autenticação visível
- Endpoint de inicialização/seed — deve ter proteção adequada
- **Verificar** se bootstrapHandler valida uma chave secreta ou se só roda uma vez

---

## 8. Controle de Versão de Dados

- `ultimaEdicaoConhecida` previne edições concorrentes (HTTP 409)
- `DATA_ULTIMA_EDICAO` e `ATUALIZADO_POR` rastreados em complementações
- Histórico de alterações: `GET /api/manifestacoes/:id/historico`

---

## 9. Isolamento por Empresa

- `middlewareEscopoEmpresa()` aplica filtro por empresa em todas as listas
- Empresas: CHIACCHIO, PLASCHIO, TUBAHIA
- Isolamento testado em `portal-isolamento.js` ✅

---

## 10. Resumo de Vulnerabilidades

| ID | Descrição | Severidade | CVSS (estimado) |
|---|---|---|---|
| SEC-01 | `/api/matriz-conhecimento` sem autenticação | CRÍTICA | 9.1 |
| SEC-02 | WhatsApp webhook sem validação HMAC | MÉDIA | 5.3 |
| SEC-03 | `erroSeguro()` sem logging estruturado | ALTA | 4.0 (operacional) |
| SEC-04 | Bootstrap endpoint sem proteção clara | MÉDIA | 6.1 |
| SEC-05 | `GET /api/public/empresas` expõe estrutura interna | BAIXA | 3.1 |
| SEC-06 | Demo login pode ser habilitado em produção | BAIXA | 2.0 |
| SEC-07 | Sessão em memória perde estado em cold start | BAIXA | 2.0 |
