# 12 — Critérios de Homologação Final
**Data:** 2026-11-03

---

## Declaração

> O sistema **NÃO está homologado** para produção enquanto qualquer item do Grupo A (Bloqueadores) estiver aberto.

---

## Grupo A — Bloqueadores (obrigatórios para homologação)

| # | Critério | Status | Ref |
|---|---|---|---|
| A.1 | Autorização MC por perfil funcional — VISUALIZADOR/RCA bloqueados; APROVADOR_SETORIAL/DIRETORIA_GESTOR com leitura; ANALISTA/GESTOR SAC com edição | ✅ Corrigido (commits 595d543 + fb4323f) | C1 |
| A.2 | Logging estruturado ativo em produção para diagnóstico de erros | ✅ Corrigido (commit 595d543) | C2 |
| A.3 | `PESQUISA_SPREADSHEET_ID` configurada e validada obrigatoriamente em produção | ⚠️ Código corrigido (process.exit se ausente). Variável **não visível** no Vercel — confirmar existência ou adicionar antes do go-live | A1 |
| A.4 | `AI_PROVIDER` configurada explicitamente (`openai`) em produção | ✅ Confirmado no Vercel (Production, 2026-11-03) — visível nas screenshots do dashboard | A2 |
| A.5 | PG offline não causa null-pointer exceptions — fallback seguro implementado | ✅ Corrigido (commit 595d543) | A3 |
| A.6 | `npm test` passa com zero falhas — suítes com mock | ✅ 35/35 suítes em GitHub Actions CI (commit 3c99549) — incluindo 3 suítes Playwright | — |
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

## Distinção de Estados — Código vs. Configuração vs. Integração vs. Homologação

| Estado | Definição | Situação Atual |
|---|---|---|
| **Código corrigido** | Falha identificada, código alterado, teste unitário aprovado | 5 falhas corrigidas: C1, C2, A1, A3, B4 (commits 595d543, fb4323f) |
| **Configuração confirmada** | Variável de ambiente definida e validada no ambiente alvo | SPREADSHEET_ID, SESSION_SECRET, DEMO_LOGIN_ENABLED confirmadas. `PESQUISA_SPREADSHEET_ID` e `AI_PROVIDER`: **aguardam confirmação no Vercel** |
| **Integração testada** | Fluxo ponta a ponta executado com armazenamento real (Sheets/PG/Drive) | **Nenhum fluxo testado com armazenamento real** — todos somente mock |
| **Homologação aprovada** | Integração testada + assinatura do responsável técnico e do negócio | **Não iniciada** |

---

## Testes Executados, Bloqueados e Pendentes

### Executados com sucesso (mock)
| Suíte | Cenários | Observação |
|---|---|---|
| `foundation-safety.js` | Segurança geral | ✅ |
| `circa*.js` (9 suítes) | Fluxo CIRCA, tratativas | ✅ |
| `modelo-autorizacao.js` | Perfis funcionais | ✅ |
| `encaminhamento-*.js` (2 suítes) | Encaminhamento por setor/perfil | ✅ |
| `ficha-triagem-responsaveis.js` | Triagem e responsáveis | ✅ |
| `auth-resilience.js` | Resiliência de autenticação | ✅ |
| `nova-manifestacao-*.js` (2 suítes) | 7 etapas de criação | ✅ |
| `matriz-conhecimento-auth.js` | 56 cenários MC — 4 perfis funcionais + cross-company | ✅ |
| `behavior.js`, `suite.js` | Comportamento geral | ✅ |
| `pesquisas.js`, `portal-isolamento.js` | Pesquisas e portal | ✅ |
| `protocolo-atomico.js` | Unicidade de protocolo | ✅ |
| Demais (10 suítes) | Arquivos, relatórios, etc. | ✅ |

### Bloqueados por timeout (testes Playwright de browser)
| Suíte | Causa | Classificação |
|---|---|---|
| `navigation-pages.js` | Playwright + login real — trava em cloud container sem display persistente | Pré-existente (main), não regressão da PR |
| `relatorio-satisfacao.js` | Playwright — mesmo cenário | Pré-existente (B3) |
| `cerebro.js` | Playwright — mesmo cenário | Pré-existente |

### Pendentes — requerem armazenamento real isolado
| Fluxo | Acesso necessário | Prioridade |
|---|---|---|
| Login e autenticação real | Sheets com usuário de staging | ALTA |
| Nova manifestação — 7 etapas ponta a ponta | Sheets de staging (não produção) | ALTA |
| Rascunho → continuidade → envio | Sheets de staging | ALTA |
| Encaminhamento setorial + resposta setorial | Sheets de staging, usuário SETOR RESPONSÁVEL | ALTA |
| Validação SAC + aprovação APROVADOR_SETORIAL | Sheets de staging, múltiplos perfis | ALTA |
| Devolutiva (envio de e-mail) | Resend configurado em staging | MÉDIA |
| Upload de anexo | Drive com `DRIVE_FOLDER_ID` de staging | MÉDIA |
| Portal público (consulta + pesquisa) | Sheets de staging com token de cliente | ALTA |
| Pesquisa de satisfação end-to-end | Sheets de staging, `PESQUISA_SPREADSHEET_ID` configurada | ALTA |

---

## Fluxos Críticos — Validação Requerida

Para considerar o sistema homologado, os seguintes fluxos devem ser validados em ambiente de staging com armazenamento real isolado (não mock):

| Fluxo | Método de Validação | Status |
|---|---|---|
| Login e autenticação | Teste manual + `behavior.js` | ⚠️ Somente mock |
| Nova manifestação (7 etapas) | Teste manual ponta a ponta | ⚠️ Somente mock |
| Complementações CIRCA | `circa-confirmacao-complementacoes.js` + teste manual | ✅ Mock aprovado |
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
Estado do código:          5 falhas corrigidas (C1 reclassificada, C2, A1, A3, B4)
                           35/35 suítes passando em GitHub Actions CI (commit 3c99549)
                           incluindo 3 suítes Playwright — zero regressões
Configuração confirmada:   SPREADSHEET_ID ✅  SESSION_SECRET ✅  DEMO_LOGIN ✅
                           AI_PROVIDER ✅ confirmada no Vercel (Production, 2026-11-03)
                           GOOGLE_CREDENTIALS ✅  OPENAI_API_KEY ✅  RESEND_API_KEY ✅
                           PESQUISA_SPREADSHEET_ID ⚠️ não visível no dashboard — verificar
                           DRIVE_FOLDER_ID ⚠️ não visível — necessária para upload de anexos
Integração testada:        NENHUM fluxo testado com armazenamento real
Homologação aprovada:      NÃO INICIADA

CONCLUSÃO: Sistema NÃO HOMOLOGADO — PR #482 limpa, CI verde (35/35),
todos os bloqueadores de código resolvidos. Único bloqueador restante:
verificar/adicionar PESQUISA_SPREADSHEET_ID no Vercel e executar plano
de testes ponta a ponta em staging com armazenamento real isolado.
```
