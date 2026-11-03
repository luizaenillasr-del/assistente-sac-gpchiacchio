# 12 — Critérios de Homologação Final
**Data:** 2026-11-03

---

## Declaração

> O sistema **NÃO está homologado** para produção enquanto qualquer item do Grupo A (Bloqueadores) estiver aberto.

---

## Grupo A — Bloqueadores (obrigatórios para homologação)

| # | Critério | Status | Ref |
|---|---|---|---|
| A.1 | Autorização por perfil na MC — perfis restritos (SETOR/VISUALIZADOR/RCA/DIRETOR) não acessam leitura | ✅ Corrigido (commit 595d543) | C1 |
| A.2 | Logging estruturado ativo em produção para diagnóstico de erros | ✅ Corrigido (commit 595d543) | C2 |
| A.3 | `PESQUISA_SPREADSHEET_ID` configurada e validada obrigatoriamente em produção | ✅ Corrigido (commit 595d543) | A1 |
| A.4 | `AI_PROVIDER` configurada explicitamente (`openai`) em produção | ❌ Aberto | A2 |
| A.5 | PG offline não causa null-pointer exceptions — fallback seguro implementado | ✅ Corrigido (commit 595d543) | A3 |
| A.6 | `npm test` passa com zero falhas | ✅ Atendido (30 suítes) | — |
| A.7 | Nenhuma credencial (DATABASE_URL, GOOGLE_CREDENTIALS, chaves de API) exposta em respostas HTTP | ✅ Atendido | — |
| A.8 | `SESSION_SECRET` com ≥ 32 caracteres configurada em produção | ✅ Atendido (exit se ausente) | — |
| A.9 | Isolamento por empresa funcional — usuário de empresa A não acessa dados de empresa B | ✅ Atendido | — |
| A.10 | Controle de concorrência em complementações CIRCA (HTTP 409) funcional | ✅ Atendido | PR #482 |
| A.11 | `DEMO_LOGIN_ENABLED=false` em produção | ✅ Atendido (verificado em testes) | — |
| A.12 | `RNC_ENABLED` configurado conforme política da empresa | ✅ Atendido | — |

---

## Grupo B — Recomendados (não bloqueiam, mas devem ser atendidos antes do go-live)

| # | Critério | Status | Ref |
|---|---|---|---|
| B.1 | HMAC validado no webhook WhatsApp | ❌ Aberto | M6 |
| B.2 | Alertas automáticos de SLA vencido enviados por e-mail | ❌ Aberto | M4 |
| B.3 | Cache invalidado após escritas em abas com TTL>0 | ❌ Aberto | M1 |
| B.4 | `POST /api/bootstrap` protegido por autenticação | ❌ Aberto | B2 |
| B.5 | Google Drive configurado (`DRIVE_FOLDER_ID`) e erro explícito quando indisponível | ⚠️ Parcial | M5 |
| B.6 | `Resend` configurado para e-mails transacionais | ⚠️ Configurar | — |
| B.7 | Estratégia de dual-write Sheets ↔ PG documentada e fonte autoritativa definida | ❌ Aberto | A4 |

---

## Grupo C — Pós-Homologação (melhoria contínua)

| # | Critério | Ref |
|---|---|---|
| C.1 | Extração de rotas de `api/index.js` para módulos separados | M2 |
| C.2 | Testes de browser automatizados para fluxos críticos | — |
| C.3 | Testes dedicados para SLA, WhatsApp, bootstrap | — |
| C.4 | Investigação e correção do timeout em `relatorio-satisfacao.js` | B3 |
| C.5 | Monitoramento e alertas de quota da Google Sheets API | — |
| C.6 | Política explícita de backup do Google Sheets | — |
| C.7 | Documentação de runbook para incidentes em produção | — |

---

## Fluxos Críticos — Validação Requerida

Para considerar o sistema homologado, os seguintes fluxos devem ser validados em ambiente de produção (não apenas em testes unitários com mock):

| Fluxo | Método de Validação | Status |
|---|---|---|
| Login e autenticação | Teste manual + `behavior.js` | ⚠️ Somente mock |
| Nova manifestação (7 etapas) | Teste manual ponta a ponta | ⚠️ Somente mock |
| Complementações CIRCA | `circa-confirmacao-complementacoes.js` + teste manual | ✅ Mock + aprovado |
| Geração de protocolo único | `protocolo-atomico.js` + teste em produção | ⚠️ Somente mock |
| Envio de e-mail de devolutiva | Teste manual com Resend real | ❌ Não testado |
| Upload de anexo ao Drive | Teste manual com Drive real | ❌ Não testado |
| Resposta pública via portal | `portal-isolamento.js` + teste manual | ⚠️ Somente mock |
| Pesquisa de satisfação end-to-end | `pesquisas.js` + teste manual | ⚠️ Somente mock |
| Consulta de protocolo no portal | `portal-isolamento.js` + teste manual | ⚠️ Somente mock |

---

## Processo de Homologação

1. **Configurar** `AI_PROVIDER=openai` nas variáveis de ambiente do Vercel (único bloqueador restante — A.4)
2. **Executar** `npm test` e confirmar zero falhas
3. **Validar** fluxos críticos em ambiente de staging com dados reais (não mock)
4. **Revisar** este documento e atualizar status de cada critério
5. **Obter** assinatura do responsável técnico e do negócio
6. **Autorizar** deploy em produção

---

## Status Atual

```
Bloqueadores abertos: 1 (A.4 — AI_PROVIDER)
Bloqueadores corrigidos: 4 (A.1, A.2, A.3, A.5 — commit 595d543)
Bloqueadores atendidos anteriormente: 7 (A.6-A.12)
Recomendados abertos: 6
Fluxos validados apenas em mock: 7 de 9

CONCLUSÃO: Sistema NÃO HOMOLOGADO — aguardando configuração de AI_PROVIDER
em produção (A.4) e validação de fluxos críticos com armazenamento real
```
