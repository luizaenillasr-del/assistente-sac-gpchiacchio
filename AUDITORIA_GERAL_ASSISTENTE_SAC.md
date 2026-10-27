# Auditoria Geral — Assistente SAC Grupo Chiacchio

**Data:** 26/10/2026
**Escopo:** repositório `assistente-sac-gpchiacchio`, repositório separado `portal-cliente-gpchiacchio` e endpoint publicado `https://assistente-sac-gpchiacchio.vercel.app`.
**Método:** inspeção estática, inventário de rotas e páginas, execução da suíte automatizada, validação HTTP pública e análise de configuração. Não foram executadas escritas, exclusões ou revogações em dados reais.

## A. Resumo executivo

O Assistente SAC possui uma base funcional ampla, com autenticação, isolamento por empresa, fluxo de manifestações, CIRCA, pesquisas, portal público, auditoria e gestão administrativa implementados no código. A suíte local terminou com `EXIT:0`; os testes de integração de pesquisas, isolamento do portal, CIRCA e navegação também passaram.

O sistema **não pode ser declarado apto para uso definitivo com as evidências disponíveis**. A auditoria não teve credenciais administrativas de teste, acesso operacional ao banco/Sheets de produção para escrita controlada, navegador autenticado nem acesso ao projeto Vercel do Portal para validar o fluxo ponta a ponta. Portanto, persistência real, todos os perfis, revogação de sessão em produção e integração completa entre projetos permanecem sem comprovação independente.

Há riscos concretos: a aplicação mantém uma arquitetura dual PostgreSQL/Google Sheets; a execução local não possui `DATABASE_URL`, `SPREADSHEET_ID`, `GOOGLE_CREDENTIALS` ou chaves de IA; os testes registram erros de fallback no Cérebro e indisponibilidade do Drive; `npm audit` encontrou 2 vulnerabilidades altas e 7 moderadas; e o Portal separado está em uma branch diferente de `main`.

O endpoint publicado respondeu em 26/10/2026:

```json
{"sucesso":true,"status":"ok","versao":"5.6.0","postgresql":"online_com_dados","sheets":"acessível"}
```

Isso comprova disponibilidade do health check, mas não comprova que operações autenticadas de escrita, autorização e integração estejam corretas em produção.

## B. Inventário de funcionalidades

O frontend principal contém **34 páginas SPA** identificadas por `page-*`, incluindo Dashboard, Central de Manifestações, Nova Manifestação, Similares, Indicadores, Clientes e Produtos, Pesquisas, Relatório, Cérebro, Matrizes, Bancos de Casos/Devolutivas, Arquivo de Fichas, Gestão de Acessos, Auditoria, Meu Perfil e Portal Admin.

Foram encontradas **327 declarações de rotas HTTP** em `api/index.js` e `server-routes/`, incluindo rotas legadas e novas para pesquisas, manifestações e autenticação.

| Módulo | Situação | Evidência | Gravidade | Ação necessária |
|---|---|---|---|---|
| Login e sessão | PARCIAL | Testes negativos e de sessão passaram; produção não foi testada com usuário real | P1 | Executar matriz de perfis em homologação/produção controlada |
| Dashboard | PARCIAL | Testes de indicadores e comportamento passaram | P2 | Comparar cards com dados reais após filtros |
| Central de Manifestações | PARCIAL | APIs, isolamento e histórico cobertos por testes | P1 | Validar navegador, persistência e permissões por perfil |
| Nova Manifestação | PARCIAL | Teste estrutural v4 passou | P1 | Executar fluxo completo de sete etapas com gravação real sintética |
| Busca de Similares | PARCIAL | Código e testes de isolamento existem; logs exibem erros de fallback JSON | P1 | Corrigir/monitorar dados inválidos e testar com base real |
| Indicadores | PARCIAL | Testes de relatórios/metas passaram | P2 | Comparar resultados com origem em produção |
| Clientes e Produtos | PARCIAL | Rotas existem e testes gerais passam | P1 | Testar cadastro/importação CSV em ambiente isolado |
| Pesquisas de Satisfação | APROVADA EM TESTES LOCAIS | 22 testes funcionais e 12 de interface; PRs #395 e #396 mescladas | P1 | Confirmar escrita real e quota do Sheets |
| Relatório de Satisfação | PARCIAL | PDF e metas cobertos localmente | P2 | Validar exportação e dados reais por empresa/mês |
| Cérebro SAC/CIRCA | PARCIAL | 43 testes da suite e CIRCA passaram; logs de JSON inválido | P1 | Corrigir entradas inválidas e testar IA/sem IA |
| Matrizes/Bancos | PARCIAL | Serviços e rotas presentes | P2 | Validar versionamento, aprovação e reutilização do conhecimento |
| Arquivo de Fichas | PARCIAL | Testes estruturais v3 passaram | P2 | Comparar visualmente em produção e testar PDFs/evidências |
| Gestão de Acessos | PARCIAL | Testes estruturais passaram; PR #397 aberta, ainda não mesclada | P1 | Mesclar após autorização e executar teste real de CRUD |
| Auditoria | PARCIAL | Rotas e registros são implementados | P1 | Confirmar trilhas em Sheets/PG e consulta por usuário |
| Meu Perfil | PARCIAL | Testes de navegação e perfil existem | P1 | Testar primeiro acesso e integração com cadastro profissional |
| Portal do Cliente | PARCIAL | Projeto separado, 10 testes de cards; integração estática coberta | P1 | Validar deploy do projeto separado e ponta a ponta |

## C. Falhas e riscos identificados

### AUD-001 — Persistência dual sem validação ponta a ponta

- **Módulo:** banco, usuários e manifestações.
- **Resultado:** PARCIAL / BLOQUEADA para validação de produção.
- **Evidência:** `api/index.js` consulta PostgreSQL quando disponível e Sheets como complemento/fallback; execução local informa `PG_LEITURA_ATIVA=false`, sem `DATABASE_URL` e sem `SPREADSHEET_ID`.
- **Risco:** dados podem divergir entre fontes, especialmente em usuários, permissões, status e históricos.
- **Gravidade:** P1.
- **Ação:** definir fonte autoritativa por entidade, testar dual-write e verificar reconciliação após nova sessão.

### AUD-002 — Integrações externas não comprovadas no ambiente local

- **Módulo:** Drive, Google Sheets, IA e PostgreSQL.
- **Resultado:** BLOQUEADA.
- **Evidência:** logs locais registram `GOOGLE_CREDENTIALS não configurada`, `DATABASE_URL` ausente, `SPREADSHEET_ID` ausente e falha de upload no Drive. O health publicado informa serviços online, mas não houve escrita autenticada controlada.
- **Gravidade:** P1.
- **Ação:** executar staging com credenciais separadas e dados sintéticos; validar upload, auditoria e rollback.

### AUD-003 — Erros de dados inválidos no Cérebro

- **Módulo:** casos similares, reincidência e matriz de conhecimento.
- **Resultado:** PARCIAL.
- **Evidência:** durante `npm test`, repetem-se `"undefined" is not valid JSON` e falhas de auditoria do `MatrizConhecimento`; alguns cenários continuam passando por fallback.
- **Gravidade:** P1.
- **Ação:** validar campos JSON antes do parse, distinguir ausência de dado de JSON inválido e registrar erro sem mascarar a origem.

### AUD-004 — Dependências com vulnerabilidades conhecidas

- **Módulo:** dependências de produção.
- **Resultado:** REPROVADA em segurança preventiva.
- **Evidência:** `npm audit --omit=dev` encontrou 9 vulnerabilidades: `express/body-parser` alta e cadeia `googleapis/gaxios/google-auth-library/uuid` moderadas.
- **Gravidade:** P1.
- **Ação:** atualizar dependências compatíveis, executar testes completos e revisar impacto do `body-parser`.

### AUD-005 — Divergência de branch no Portal separado

- **Módulo:** Portal do Cliente.
- **Resultado:** BLOQUEADA para equivalência de produção.
- **Evidência:** o repositório separado está em `fix/fidelidade-pesquisas-portal`, enquanto `main` está em `38298fa` e atrás de quatro commits; não foi feito merge/deploy nesta auditoria.
- **Gravidade:** P1.
- **Ação:** identificar o commit efetivamente publicado no projeto Vercel do Portal e reconciliar com a branch aprovada.

### AUD-006 — Rotas e implementações legadas coexistentes

- **Módulo:** API e frontend.
- **Resultado:** PARCIAL.
- **Evidência:** há rotas novas em `server-routes/pesquisas.js` e rotas legadas no mesmo projeto; há múltiplos caminhos para questionários, respostas e usuários.
- **Gravidade:** P2.
- **Ação:** mapear precedência, remover duplicidades com testes de contrato e documentar a rota oficial por operação.

### AUD-007 — Testes externos pulados

- **Módulo:** PostgreSQL e integrações.
- **Resultado:** NÃO TESTADA.
- **Evidência:** a suite informa 43 testes aprovados e 8 pulados por ausência de `DATABASE_URL`/ambiente externo; nenhum teste destrutivo real foi executado.
- **Gravidade:** P1.
- **Ação:** executar a matriz em staging isolado com banco, Sheets, Drive e credenciais próprias.

### AUD-008 — Gestão de acessos ainda aguardando publicação

- **Módulo:** usuários e permissões.
- **Resultado:** PARCIAL.
- **Evidência:** a correção de persistência de edição está na PR #397 (`1971407`), aberta e não mesclada no momento da auditoria.
- **Gravidade:** P1.
- **Ação:** revisar e autorizar merge; depois repetir os 24 cenários da especificação com contas de homologação.

## D. Integrações

| Integração | Situação | Evidência |
|---|---|---|
| Assistente → Google Sheets | PARCIAL | Código e health publicado indicam acesso; quota 429 já ocorreu no editor de pesquisas |
| Assistente → PostgreSQL/Neon | PARCIAL | Produção declara `online_com_dados`; local não possui `DATABASE_URL` e Prisma não foi carregado |
| Assistente → Google Drive | NÃO TESTADA | Upload falhou localmente sem credencial; testes usam mock/fallback |
| Assistente → IA | PARCIAL | Abstração OpenAI/Anthropic existe; chaves ausentes localmente |
| Portal → Assistente | PARCIAL | `vercel.json` aponta APIs públicas do Assistente; testes estáticos e comportamentais passam |
| Portal Vercel → produção | BLOQUEADA | Projeto separado e branch efetiva não foram verificados via acesso autenticado |

## E. Segurança e dados

Pontos positivos verificados:

- Middleware de autenticação rejeita token ausente e usuários inativos/excluídos.
- Há controle de escopo por empresa em manifestações, histórico, tratativas, setor e indicadores.
- Usuários demo ficam desativados por padrão.
- O fluxo CIRCA impede geração automática de RNC e decisão autônoma da IA segundo os testes.
- Uploads públicos têm validação de tipo/tamanho e o Portal não expõe as APIs administrativas internas.

Riscos ou lacunas:

- A proteção de produção depende de variáveis como `SESSION_SECRET`, `GOOGLE_CREDENTIALS`, `DATABASE_URL` e chaves de IA; a auditoria não teve acesso para confirmar os valores e rotação.
- A fonte dual de identidade/permissões precisa de reconciliação formal.
- Vulnerabilidades de dependências ainda não foram tratadas.
- Não foi possível verificar backups, restauração, logs da Vercel, alertas ou retenção de auditoria.

## F. Plano de correção

1. **P0/P1 — ambiente de homologação:** criar banco, Sheets, Drive e credenciais separados; executar os 24 testes de gestão de acessos e o fluxo completo de manifestação.
2. **P1 — dependências:** atualizar `express/body-parser` e a cadeia Google/UUID; repetir toda a suíte.
3. **P1 — dados:** corrigir parse JSON inválido no Cérebro e monitorar erros sem fallback silencioso.
4. **P1 — publicação:** revisar/mesclar PR #397 e confirmar commit do Portal separado no Vercel.
5. **P1 — integração:** testar Portal → protocolo → SAC → pesquisa → relatório com registros sintéticos.
6. **P2 — arquitetura:** consolidar rotas legadas e documentar a fonte autoritativa de cada entidade.
7. **P2 — observabilidade:** adicionar métricas de quota Sheets, falhas Drive/IA, latência e auditoria de mutações.

## G. Matriz de homologação

| Categoria | Quantidade | Evidência |
|---|---:|---|
| Aprovados localmente | 43 na suite principal + 22 pesquisas + 10 Portal | Saída de `npm test`, `tests/pesquisas.js` e `tests/portal-pesquisa-cards.js` |
| Reprovados | 0 na suite automatizada | Não equivale a aprovação de produção |
| Pulados | 8 | Repositórios PostgreSQL e integrações externas sem ambiente |
| Bloqueados | 8+ fluxos de escrita/produção | Sem credenciais administrativas de teste e sem staging autorizado |
| Não testados | Navegação visual autenticada completa, backup/restore, todos os perfis em produção | Sem navegador/contas de homologação disponíveis |

## H. Parecer final

**O ASSISTENTE SAC ESTÁ APTO PARA USO DEFINITIVO? NÃO, ainda não com as evidências disponíveis.**

A base funcional e os testes automatizados são bons, e o endpoint publicado está operacional. Porém, a auditoria não comprovou escrita autenticada em produção, integração completa com o Portal separado, persistência consistente entre PostgreSQL e Sheets, funcionamento de Drive/IA, backup/restore e a matriz completa de perfis. A liberação definitiva deve aguardar a homologação isolada, o tratamento das vulnerabilidades e a confirmação ponta a ponta das integrações.

## Limitações da auditoria

- Nenhum dado real foi alterado, excluído ou revogado.
- Não foram usados tokens, senhas ou credenciais de usuários reais.
- Não foi realizado deploy, merge ou alteração no Portal durante esta auditoria.
- A resposta do health publicado foi observada, mas endpoints autenticados não foram exercitados sem credenciais de teste.
