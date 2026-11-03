# 03 — Auditoria de Telas e Funcionalidades
**Data:** 2026-11-03

---

## 1. Páginas Frontend

### 1.1 `public/index.html` — SPA Principal

A aplicação principal é uma Single Page Application servida pelo Express em `GET /`.

**Módulos de navegação identificados** (via testes e rotas):
- Dashboard (`/api/dashboard-resumo`)
- Lista de manifestações (`/api/manifestacoes`)
- Nova manifestação (fluxo 7 etapas)
- Ficha individual de manifestação
- CIRCA — complementações e análise
- Tratativas e devolutivas
- Pesquisas de satisfação
- Relatórios e metas
- Gestão de usuários e acessos
- Configurações do sistema
- Cérebro (base de conhecimento)
- Biblioteca de fichas
- Painel máquina
- Log do sistema / auditoria
- Perfil do usuário

### 1.2 `public/fichas.html` — Biblioteca de Fichas
- Página separada da SPA principal
- Conectada à navegação via link
- CRUD de fichas com integração `/api/biblioteca/fichas`

### 1.3 `public/portal.html` — Portal do Cliente
- Página pública independente
- Consulta de protocolos por token
- Resposta a pesquisas de satisfação
- Isolamento testado em `tests/portal-isolamento.js` (11 testes ✅)

---

## 2. Fluxo de Nova Manifestação (7 Etapas)

Testado em `tests/nova-manifestacao-v4.js` e `tests/fase1-operacional.js` (ambos ✅).

| Etapa | Conteúdo | Status |
|---|---|---|
| 1 | Identificação da empresa e canal | ✅ Implementada |
| 2 | Dados do reclamante | ✅ Implementada |
| 3 | Descrição da ocorrência | ✅ Implementada |
| 4 | Produto e lote | ✅ Implementada |
| 5 | Pedido e entrega | ✅ Implementada |
| 6 | Impacto e quantidade | ✅ Implementada |
| 7 | Revisão e finalização | ✅ Implementada |

**Controles legados removidos**: testado em `nova-manifestacao-v4.js` — botões/controles das versões anteriores confirmados ausentes.

---

## 3. Fluxo CIRCA (7 Etapas Operacionais)

Testado em `circa.js`, `circa-design.js`, `circa-integration.js` (todos ✅).

| Etapa CIRCA | Label | Status |
|---|---|---|
| 1 | Registro | ✅ |
| 2 | Análise inteligente e triagem | ✅ |
| 3 | Condução | ✅ |
| 4 | Investigação e resolução | ✅ |
| 5 | Validação SAC | ✅ |
| 6 | Devolutiva conclusiva | ✅ |
| 7 | Encerramento e aprendizado | ✅ |

**Complementações (Etapa 2)**:
- PATCH `/api/manifestacoes/:id/circa-dados`
- Confirmação via `atualizacao.headers/valores` (corrigido em PR #482)
- HTTP 200 em todas as condições testadas

---

## 4. Funcionalidades Avaliadas

### 4.1 Gestão de Acessos
- ✅ CRUD de usuários com exclusão lógica
- ✅ Separação de status (ativo/inativo/bloqueado)
- ✅ Permissões individuais por usuário
- ✅ Solicitações de acesso público
- ✅ Aprovação de solicitações pelo MASTER
- Teste: `tests/admin-usuarios.js` ✅

### 4.2 Análise com IA
- ✅ Análise de manifestação via OpenAI
- ✅ Extração de campos do setor
- ✅ Busca de casos similares
- ✅ Sugestão de tratativa e devolutiva
- ⚠️ PG offline faz `buscarParaSimilaridade` falhar com stack trace visível nos logs

### 4.3 Dashboard e Relatórios
- ✅ Dashboard resumo por empresa
- ✅ Geração de relatórios PDF
- ✅ Envio de relatórios por e-mail
- ✅ Relatório público por token
- ✅ Metas: backend como fonte autoritativa
- Teste: `tests/relatorio-metas.js` ✅

### 4.4 Pesquisas de Satisfação
- ✅ Criação e configuração de questionários
- ✅ Envio por token
- ✅ Resposta pública e portal
- ✅ Análise de ocorrências
- ✅ Histórico preservado ao arquivar
- Teste: `tests/pesquisas.js` (22 testes ✅)

### 4.5 Portal do Cliente
- ✅ Consulta de protocolo público
- ✅ Somente devolutiva liberada após encerramento aparece
- ✅ Rate limit preservado
- ✅ Configurações internas refletidas no portal
- Teste: `tests/portal-isolamento.js` (11 testes ✅)

### 4.6 Módulo RNC
- ✅ Flag `RNC_ENABLED=false` desativa completamente
- ✅ Bloqueio de rotas quando desativado
- ✅ Permissões preservadas
- Teste: `tests/rnc-disabled.js` ✅

### 4.7 Cérebro (Base de Conhecimento)
- ✅ Matriz operacional
- ✅ Causas e tratamentos
- ✅ Modelos de devolutiva
- ✅ Aprimoramentos
- ⚠️ Fallback Sheets quando politica=null
- Teste: `tests/cerebro.js` ✅

### 4.8 Biblioteca de Fichas
- ✅ Listagem e busca de fichas
- ✅ Geração de PDF
- ✅ Arquivo/desarquivo
- ✅ Sincronização com base
- ✅ Importação de ficha

### 4.9 WhatsApp
- ✅ Webhook configurado (GET para verificação, POST para recebimento)
- ⚠️ Sem validação de assinatura HMAC no POST do webhook
- ✅ Configuração via `/api/config/whatsapp`

### 4.10 Importação de Dados
- ✅ Upload de DOCX para alimentação
- ✅ Análise e confirmação em dois passos
- ✅ Histórico de importações
- ✅ Desfazer importação (MASTER)

---

## 5. Funcionalidades Incompletas ou com Ressalvas

| Funcionalidade | Situação | Severidade |
|---|---|---|
| WhatsApp webhook sem validação de assinatura | Rota POST aceita qualquer payload | MÉDIA |
| Matriz de conhecimento sem autenticação | Ver doc 02 | CRÍTICA |
| `PESQUISA_SPREADSHEET_ID` não configurada | Usa fallback hardcoded | ALTA |
| SLA sem alertas automáticos | Cálculo existe, alerta proativo não | MÉDIA |
| Diagnóstico de erros em produção | `erroSeguro()` oculta tudo | ALTA |
| PG offline silencioso | Log aparece mas falha é absorvida | ALTA |
| Calculadora de prazos regionais | Rota existe, cobertura de testes não verificada | BAIXA |
| Sugestões de melhoria | Rota existe, sem testes dedicados | BAIXA |
| Notificações de analista | Rota existe, sem verificação de persistência | BAIXA |

---

## 6. Navegação e Rotas Desconectadas

Rotas identificadas que podem não ter link direto na navegação principal:
- `/api/bootstrap` — endpoint de inicialização, sem UI dedicada
- `/api/ia/extrair-setor` — ação interna, chamada internamente
- `/api/alimentacao/*` — alimentação de base, acesso via menu específico
- `/api/importacao/*` — importação, acesso via menu específico

Páginas identificadas com rota própria (não via SPA):
- `/portal` → `public/portal.html`
- `/pesquisa/:token` → HTML do formulário de pesquisa
- `/relatorio-publico/:token` → relatório público renderizado
