# Auditoria mestre — Assistente SAC, Portal e CIRCA

**Data:** 23/10/2026  
**Branch desta auditoria:** `audit/mestre-circa-portal`  
**Base:** `origin/main` em `b93bf0c`, com a resolução do PR #364 em `efd9e83`

## Parecer

A base possui uma implementação operacional relevante, mas **ainda não está apta para homologação de produção ponta a ponta**. O CIRCA determinístico, a separação de permissões e vários fluxos de portal/pesquisa foram verificados em ambiente de testes com armazenamento simulado. Persistência institucional, PostgreSQL, Google Sheets/Drive, credenciais de staging, navegador publicado e integrações externas ainda não foram comprovados.

Não foram alterados dados de produção, executadas migrações destrutivas, feitos deploys ou merges nesta auditoria.

## Estado do repositório e dos PRs

- `origin/main` usa `prisma generate` no `postinstall`; não há `prisma db push --accept-data-loss` no `package.json` efetivo da main.
- O conflito do PR #364 em `package.json` foi resolvido preservando a suíte de testes da main e o `postinstall` seguro. O branch do PR está mergeável; os checks devem ser acompanhados no GitHub.
- O PR #362 (`fix/cerebro-circa`) está redundante/conflitante com #364: as alterações de fundação do CIRCA já estão na linha de trabalho do #364. Não se deve recriar nem integrar os dois conjuntos.
- O Portal separado está no branch `feat/portal-cards-pesquisas`, commit `ce0bcf1`; o build estático foi executado com sucesso.

## Evidências executadas

| Verificação | Resultado | Limite |
|---|---|---|
| `npm test` na branch de auditoria | **Aprovado:** fundação 43/0/8 pulados; comportamento 76/0; pesquisas 22/0; isolamento 11/0; relatório, Cérebro e navegação aprovados | Suíte usa mocks; PostgreSQL/Sheets/Drive reais não estavam disponíveis |
| `node --check api/index.js` | Aprovado | Não substitui teste de execução publicado |
| `git diff --check` | Aprovado | — |
| `node scripts/build.js` no Portal | Aprovado; `dist/` gerado | Não testa o backend remoto configurado no deploy |
| Scripts inline do Portal | 2 scripts analisados, sem erro de sintaxe | Não testa interação no navegador publicado |
| CIRCA determinístico (`tests/circa.js`) | Captura, investigação, resolução, governança e bloqueio de autonomia aprovados | Não comprova persistência de evidências/resultados em infraestrutura real |
| CIRCA integração (`tests/circa-integration.js`) | Autenticação, escopo de empresa, cinco etapas e endpoint somente leitura aprovados | Não comprova o fluxo completo com dados institucionais |
| Portal/integrações (`tests/canais-integracao.js`, `tests/portal-isolamento.js`) | Idempotência, ficha/fila, isolamento, protocolo, pesquisa e não criação automática de manifestação aprovados em mock | Não houve staging isolado com banco/planilha reais |

## Matriz objetiva de capacidade

| Funcionalidade | Resultado atual | Evidência | Problema/limite | Próximo PR ou pendência |
|---|---|---|---|---|
| Captura de manifestação pelo Portal | **Parcialmente operacional** | Rotas `/api/public/reclamacoes`, testes de protocolo, ficha e fila | Deploy do Portal encaminha APIs para o backend fixo de produção; não há isolamento de staging | PR de configuração de origem por ambiente; variável externa de staging |
| Pesquisas Portal → Central | **Parcialmente operacional** | Rotas públicas, cards dinâmicos e testes de respostas/idempotência | Endpoint publicado de pesquisas retornou 503/sem dados no ambiente observado | Configurar `PESQUISA_SPREADSHEET_ID`/fonte staging e repetir E2E |
| CIRCA — captura | **Implementado em modo determinístico** | `server-services/circaEngine.js`, `tests/circa.js` | Usa campos existentes; modelo completo de evidências ainda não foi persistido ponta a ponta | PR CIRCA de persistência e contrato de evidências |
| CIRCA — investigação | **Parcial** | Etapa e recomendações são retornadas no endpoint protegido | Não há prova de causa, subcausa, evidência e análise técnica persistidas no fluxo real | PR de investigação persistente e auditoria |
| CIRCA — resolução | **Parcial** | Finalização consolida `CIRCA_RESULTADO`/`CIRCA_VERSAO` | Autonomia depende de campos completos e permanece bloqueada para prioridades críticas; falta E2E real | PR de resolução, alçadas e retentativa idempotente |
| CIRCA — conhecimento | **Parcial** | Consolidação no encerramento e serviços de Cérebro/Banco de Casos existem | Não comprovado que cada finalização alimente as bases reais sem duplicidade | PR de sincronização idempotente Arquivo/Banco/Cérebro |
| CIRCA — aprimoramento | **Não comprovado** | Estrutura de etapa existe | Não há ciclo operacional mensurado de feedback, métricas e revisão em staging | PR de métricas, revisão e auditoria |
| Regras vs IA | **Aprovado estruturalmente** | Engine determinístico separado, `governanca.exigeAprovacaoHumana` | Provider de IA, quota, timeout e conteúdo real não foram testados | Credenciais de IA em staging e testes de falha |
| Autenticação e escopo | **Aprovado em mock** | Suite cobre 401/403, usuário inativo, empresas e MASTER | Contas reais e APIs publicadas não foram exercitadas | Matriz de autorização em staging |
| Persistência | **Não homologada** | Repositórios Sheets/PG localizados; suíte usa fallback/mocks | `DATABASE_URL` e credenciais Google ausentes; PG local não gerou Prisma Client | Ambiente PostgreSQL/Sheets de staging |
| Auditoria | **Parcial** | Rotas e registros simulados na suíte | Cadeia completa de decisões, exclusão, reprocessamento e retenção não foi validada | PR de auditoria de eventos e consulta |
| WhatsApp | **Fora do escopo do prompt mestre** | O código atual possui webhook Meta no PR #361 | Prompt mestre determina somente link dinâmico, sem API/webhook/chatbot; há divergência de escopo | Decisão de produto; não remover silenciosamente |
| Portal público | **Funcional em mock/build** | Isolamento, rotas públicas e build aprovados | Status live de pesquisas depende de ambiente e backend remoto | Variáveis, domínio e staging separados |

## Achados críticos

### Fonte de dados e ambiente

O código suporta PostgreSQL opcional (`PG_LEITURA_ATIVA`) e fallback para Google Sheets. No ambiente desta auditoria, o PG não estava disponível (`@prisma/client/default` ausente) e as variáveis `DATABASE_URL`, `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `GOOGLE_CREDENTIALS` e chaves de IA não estavam configuradas. Portanto, os resultados positivos são de execução controlada, não de persistência institucional.

### Isolamento do Portal

O `vercel.json` do Portal encaminha as APIs públicas para `https://assistente-sac-gpchiacchio.vercel.app`. Isso é compatível com produção, mas impede considerar previews como staging isolado: uma validação de escrita em preview pode atingir a base de produção. A origem do backend deve ser parametrizada por ambiente antes dos testes de ponta a ponta.

### CIRCA

As cinco etapas e a governança humana existem, mas o aceite mestre exige mais que o endpoint: recomendações, evidências, alçadas, resultados, causas, tratamentos e aprendizado precisam ser persistidos e rastreáveis. Essa comprovação ainda está pendente em banco/planilha de staging.

### Segurança e permissões

Os testes simulados confirmam sessão, perfis e escopo por empresa. Ainda falta repetir a matriz contra a API publicada com usuários de teste, incluindo tentativas negativas e decisões simultâneas.

## Dependências externas bloqueadoras

1. Ambiente PostgreSQL de staging, com `DATABASE_URL` e `DATABASE_URL_UNPOOLED`, Prisma Client gerado e migrações não destrutivas já aprovadas.
2. Planilhas de staging (`SPREADSHEET_ID` e `PESQUISA_SPREADSHEET_ID`) e `GOOGLE_CREDENTIALS` temporárias.
3. `SESSION_SECRET` estável e específico por ambiente.
4. Chave/provider de IA de staging, se a análise generativa for habilitada.
5. Origem de backend do Portal configurável para preview/staging.
6. Acesso ao domínio publicado, logs Vercel e contas de teste.
7. Definição de produto sobre o webhook Meta já presente no PR #361 versus o escopo mais recente, que determina WhatsApp somente como link.

## Ordem de execução recomendada

1. Isolar o Portal e as fontes de dados em staging.
2. Executar persistência real e E2E Portal → SAC/Pesquisa.
3. Persistir investigação, evidências, causas, tratamentos e consolidação CIRCA de forma idempotente.
4. Validar perfis, competências, alçadas, auditoria e decisões concorrentes.
5. Validar Arquivo de Fichas, Banco de Casos, Banco de Devolutivas, Cérebro, RNC e indicadores no mesmo conjunto de dados.
6. Executar testes de navegador nas resoluções previstas e validar as referências HTML.
7. Repetir regressão completa e só então abrir PRs de implementação sequenciais.

## Conclusão

O projeto está em condição de continuar a implementação e a validação em branches próprias, mas não há evidência suficiente para declarar prontidão operacional de produção. A suíte automatizada está verde no ambiente simulado; os bloqueios restantes são principalmente persistência real, isolamento de staging, integrações externas, navegador publicado e completude operacional do CIRCA.
