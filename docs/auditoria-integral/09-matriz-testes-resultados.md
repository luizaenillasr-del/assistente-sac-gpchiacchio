# 09 — Matriz de Testes e Resultados
**Data:** 2026-11-03 · Ambiente: Isolado (mock Sheets, PG offline)

---

## 1. Resultados por Suíte

| Arquivo de Teste | Resultado | Testes | Observações |
|---|---|---|---|
| `foundation-safety.js` | ✅ PASS | — | Instalação segura e migração explícita |
| `circa.js` | ✅ PASS | — | Captura, investigação, resolução, governança, bloqueio autonomia |
| `circa-knowledge.js` | ✅ PASS (com aviso) | — | Aviso: `politica=null` no PG offline |
| `circa-learning-contract.js` | ✅ PASS | — | CEREBRO_APRENDIZADO reconhecido |
| `circa-data-integrity.js` | ✅ PASS | — | Matriz, histórico incompleto, deduplicação, isolamento |
| `circa-nova-manifestacao.js` | ✅ PASS | — | Campos PLASCHIO, múltiplas hipóteses, regras inválidas |
| `circa-producao-regressao.js` | ✅ PASS | — | Contrato legado, timeout sem falso resultado |
| `circa-design.js` | ✅ PASS | — | 7 etapas, componentes legados removidos |
| `circa-integration.js` | ✅ PASS | — | Auth, escopo empresa, etapas determinísticas |
| `circa-confirmacao-complementacoes.js` | ✅ PASS | 8 | Ver seção 2 |
| `nova-manifestacao-correcao.js` | ✅ PASS | — | Análise completa, sem HTTP 500, protocolo único |
| `nova-manifestacao-v4.js` | ✅ PASS | — | Fluxo 7 etapas, persistência, controles legados removidos |
| `behavior.js` | ✅ PASS | 78 | Comportamentos do sistema |
| `suite.js` | ✅ PASS | 66 (63+3 skip) | Suíte geral |
| `relatorio-metas.js` | ✅ PASS | — | Metas via backend autoritativo |
| `portal-isolamento.js` | ✅ PASS | 11 | Isolamento e rate limit do portal |
| `pesquisas.js` | ✅ PASS | 22 | CRUD pesquisas, auth, histórico |
| `cerebro.js` | ✅ PASS | — | Base de conhecimento |
| `canais-integracao.js` | ✅ PASS | — | Canais de integração |
| `admin-usuarios.js` | ✅ PASS | — | Tabela, ficha, status, exclusão lógica |
| `fase1-operacional.js` | ✅ PASS | — | Gestão acessos + nova manifestação |
| `fase2-integracoes.js` | ✅ PASS | — | Credenciais, arquivos, JSON, IA, deduplicação |
| `fase4-central.js` | ✅ PASS | — | Exclusão lógica MASTER, restauração, ações |
| `interface-usuarios-arquivo.js` | ✅ PASS | 3 | Interface gestão de acessos |
| `arquivo-fichas-v3.js` | ✅ PASS | — | Estrutura visual e ordem |
| `ficha-manifestacao-v2.js` | ✅ PASS | 3 | Histórico, CIRCA, ações |
| `rnc-disabled.js` | ✅ PASS | — | RNC desativado: flag, rotas, UI, permissões |
| `navigation-pages.js` | ✅ PASS | — | Páginas de navegação |
| `protocolo-atomico.js` | ✅ PASS | — | Protocolo atômico único |
| `leraba-coluna-larga.js` | ✅ PASS | — | Leitura de aba com colunas largas |
| `relatorio-satisfacao.js` | ⏳ Timeout | — | Excedeu 120s — resultado não capturado |

**Total confirmado**: 30 suítes PASS, 1 timeout

---

## 2. Detalhamento: `circa-confirmacao-complementacoes.js`

| Cenário | Descrição | Resultado |
|---|---|---|
| 1 | HTTP 200 com lerAba interceptada (stale) | ✅ PASS |
| 2 | atualizarPorID lança exceção → não retorna sucesso | ✅ PASS |
| 3 | Metadados de auditoria no mock.DB | ✅ PASS |
| 4 | GET `/circa` retorna complementações após PATCH | ✅ PASS |
| 5 | Documentação: mock vs Sheets real | ✅ PASS |
| 6a | HTTP 409 com ultimaEdicaoConhecida desatualizada | ✅ PASS |
| 6b | DESCRICAO_RECLAMACAO e DESCRICAO_ORIGINAL preservadas | ✅ PASS |
| 7 | Contrato estrutural: mensagem de erro preservada, sem loop | ✅ PASS |

---

## 3. Avisos Recorrentes (Não-Bloqueantes)

| Aviso | Frequência | Causa | Impacto |
|---|---|---|---|
| `[PG] buscarParaSimilaridade falhou: Cannot read properties of null` | Múltiplas suítes | PG offline no ambiente de teste | Busca de similares desabilitada; absorbida silenciosamente |
| `Fallback Sheets para conhecimento: Cannot read properties of null (reading 'politica')` | circa-knowledge, fase2 | PG retorna politica=null | Fallback para Sheets funciona |
| `[AVISO C5] PESQUISA_SPREADSHEET_ID não configurada` | fase1, circa-learning-contract | Variável de ambiente ausente | Usa planilha fallback hardcoded |
| `[SEGURANÇA] Usuários demo desabilitados` | cerca de 5 suítes | DEMO_LOGIN_ENABLED=false | Correto; informativo |
| `[ANEXOS][MANIFESTACAO] upload pendente: evidencia.txt Google Drive indisponível` | nova-manifestacao-correcao | GOOGLE_CREDENTIALS não configurada | Anexos não fazem upload; teste prossegue |

---

## 4. Cobertura por Módulo

| Módulo | Cobertura de Testes | Status |
|---|---|---|
| Nova manifestação (7 etapas) | ✅ Alta | 4 suítes |
| CIRCA complementações | ✅ Alta | 5+ suítes |
| Autenticação e sessão | ✅ Média | behavior.js, suite.js |
| Gestão de usuários | ✅ Média | admin-usuarios.js, fase1 |
| Pesquisas de satisfação | ✅ Alta | pesquisas.js (22 testes) |
| Portal do cliente | ✅ Alta | portal-isolamento.js (11 testes) |
| Relatórios | ✅ Média | relatorio-metas.js |
| Protocolo atômico | ✅ Alta | protocolo-atomico.js |
| Base de conhecimento (Cérebro) | ✅ Média | cerebro.js |
| RNC | ✅ Média | rnc-disabled.js |
| Biblioteca de fichas | ✅ Média | arquivo-fichas-v3.js |
| WhatsApp | ⚠️ Baixa | canais-integracao.js (genérico) |
| SLA e calculadora | ⚠️ Baixa | Não identificada suíte dedicada |
| Bootstrap | ❌ Não identificada | — |
| Matriz de conhecimento | ❌ Sem auth — sem teste de auth | — |
| Importação DOCX | ⚠️ Baixa | fase2-integracoes.js |
| Devolutiva completa | ⚠️ Média | behavior.js (parcial) |

---

## 5. Testes Não Executados / Não no Conjunto Padrão

Arquivos de teste encontrados mas **não incluídos em `npm test`**:

| Arquivo | Propósito |
|---|---|
| `tests/meu-perfil.js` | Perfil do usuário (script separado) |
| `tests/fase4-preflight.js` | Preflight fase 4 |
| `tests/nova-manifestacao-etapa1-browser.js` | Browser — requer Playwright |
| `tests/meu-perfil-browser.js` | Browser — requer Playwright |
| `tests/circa-etapa2-validacao.js` | Validação etapa 2 (não no script principal) |
| `tests/circa-reconciliacao-readonly.js` | Reconciliação readonly |
| `tests/distribuicao-tratativas.js` | Distribuição de tratativas |
| `tests/formulario-setor-origem.js` | Formulário setor de origem |
| `tests/integridade-ficha.js` | Integridade da ficha |
| `tests/interface-aprovadores.js` | Interface de aprovadores |
| `tests/inventario-circa.js` | Inventário CIRCA |
| `tests/pesquisas-admin-interface.js` | Interface admin de pesquisas |
| `tests/portal-pesquisa-cards.js` | Cards de pesquisa no portal |

---

## 6. Conclusão

- **30 suítes passando** com zero falhas declaradas
- 1 timeout em `relatorio-satisfacao.js` (excedeu 120s)
- Cobertura é **alta para os fluxos principais** (manifestação, CIRCA, pesquisas, portal)
- Cobertura é **baixa para SLA, WhatsApp, bootstrap e matriz de conhecimento**
- PG offline em testes não causa falhas — absorbido com fallback Sheets
- Não há testes de browser automatizados no conjunto padrão para verificar UI real
