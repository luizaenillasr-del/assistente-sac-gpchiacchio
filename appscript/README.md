# SAC Grupo Chiacchio — Google Apps Script

Versão completa do sistema SAC em Google Apps Script (GAS), sem dependências externas (Node.js, Vercel, PostgreSQL).

## Arquivos

| Arquivo | Descrição |
|---|---|
| `appsscript.json` | Manifesto do projeto (escopos OAuth, tipo webapp) |
| `Code.gs` | Entry point: `doGet()` serve o HTML; `apiCall()` é o router da API |
| `Config.gs` | Configurações globais via `PropertiesService` |
| `Sheets.gs` | CRUD no Google Sheets (substitui googleapis SDK) |
| `Auth.gs` | Autenticação com `CacheService` (substitui JWT) |
| `IA.gs` | Chamadas à OpenAI / Anthropic via `UrlFetchApp` |
| `Email.gs` | Envio de e-mail via `GmailApp` / `MailApp` |
| `Drive.gs` | Upload de arquivos via `DriveApp` |
| `Routes.gs` | Todos os handlers de rotas (manifestações, RNC, dashboard…) |
| `Index.html` | Frontend adaptado com shim GAS (substitui fetch por google.script.run) |

## Passo a passo para implantar

### 1. Criar o projeto no Apps Script

1. Acesse [script.google.com](https://script.google.com) e clique em **Novo projeto**.
2. Renomeie o projeto para `SAC Grupo Chiacchio`.

### 2. Copiar os arquivos

Para cada arquivo `.gs`, crie um arquivo correspondente no editor:
- Clique em **+** → **Script** e cole o conteúdo.
- Para `Index.html`: clique em **+** → **HTML** e cole o conteúdo de `Index.html`.
- Substitua o conteúdo de `appsscript.json` pelo arquivo do projeto (aba **Projeto** → ícone de engrenagem → editar manifesto).

### 3. Configurar as propriedades do script

Vá em **Configurações do projeto** → **Propriedades do script** e adicione:

| Propriedade | Descrição |
|---|---|
| `SPREADSHEET_ID` | ID da planilha Google Sheets principal |
| `DRIVE_FOLDER_ID` | ID da pasta no Drive para uploads (opcional) |
| `OPENAI_API_KEY` | Chave da API OpenAI (se usar OpenAI) |
| `ANTHROPIC_API_KEY` | Chave da API Anthropic (se usar Anthropic) |
| `AI_PROVIDER` | `openai` ou `anthropic` |
| `AI_MODEL` | Modelo padrão (ex: `gpt-4o-mini`) |
| `APP_URL` | URL pública do webapp (preencher após deploy) |
| `DEMO_LOGIN_ENABLED` | `true` para habilitar usuários de demonstração |
| `RESEND_API_KEY` | Deixar vazio (e-mail é feito via GmailApp) |

### 4. Implantar como Web App

1. Clique em **Implantar** → **Nova implantação**.
2. Tipo: **Aplicativo da Web**.
3. Executar como: **Eu** (sua conta Google).
4. Quem tem acesso: **Qualquer pessoa** (ou domínio, conforme necessidade).
5. Clique em **Implantar** e copie a URL gerada.
6. Cole essa URL na propriedade `APP_URL`.

### 5. Estrutura da planilha

A planilha deve conter as seguintes abas (criadas automaticamente se não existirem):

- `MANIFESTACOES`
- `RNC`
- `USUARIOS`
- `SETORES`
- `EMPRESAS`
- `PRODUTOS`
- `CONHECIMENTO`
- `MATRIZ_CONHECIMENTO`
- `HISTORICO`
- `AUDITORIA`
- `RESET_TOKENS`

### 6. Primeiro acesso (bootstrap)

Se a aba `USUARIOS` estiver vazia, acesse a URL do webapp e use o endpoint de bootstrap para criar o primeiro usuário master, ou habilite `DEMO_LOGIN_ENABLED=true` e use o login demo:

- `demo.master` / `master123`
- `joao.aprovador` / `aprovador123`
- `ana.sac` / `analista123`

## Arquitetura

```
Frontend (Index.html)
  └─ google.script.run.apiCall(params)
       └─ Code.gs: apiCall() → verifica sessão → _dispatch()
            ├─ Auth.gs: login, logout, sessão (CacheService)
            ├─ Routes.gs: handlers de todas as rotas
            ├─ Sheets.gs: CRUD na planilha
            ├─ IA.gs: OpenAI / Anthropic
            ├─ Email.gs: GmailApp
            └─ Drive.gs: DriveApp
```

## Diferenças em relação à versão Node.js

| Node.js / Vercel | Apps Script |
|---|---|
| Express routes (214) | `apiCall()` dispatcher único |
| JWT (jsonwebtoken) | Token aleatório + CacheService |
| googleapis SDK | SpreadsheetApp / DriveApp nativos |
| Resend (e-mail) | GmailApp / MailApp |
| fetch() / axios | UrlFetchApp |
| PostgreSQL / Prisma | Removido (Sheets-only) |
| `process.env` | PropertiesService.getScriptProperties() |
| Node crypto SHA-256 | Utilities.computeDigest() |
