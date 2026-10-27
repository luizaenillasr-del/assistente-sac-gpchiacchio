# Auditoria Master — Assistente SAC Grupo Chiacchio

Data: 26/10/2026
Escopo: auditoria técnica, funcional, segurança, integração e CIRCA. Nenhuma correção, migração, merge ou deploy foi executado durante a auditoria.

## Parecer

**INAPTO para liberação real neste momento.** A suíte automatizada passa, mas não há evidência suficiente de homologação operacional em staging: PostgreSQL, Google Sheets/Drive, credenciais externas e testes completos por perfil não estão disponíveis. Há também um PR aberto para desativação do RNC; a `main` ainda não contém essa desativação.

## Evidências executadas

| Evidência | Resultado |
|---|---|
| `npm test` | APROVADO — 0 falhas nos testes executados; inclui CIRCA, canais, permissões, pesquisas, isolamento e navegação |
| `npm run test:perfil` | APROVADO — onboarding, rascunho, conclusão, retorno, autorização e escopo |
| `node tests/meu-perfil-browser.js` | APROVADO — login, cinco etapas, reload, conclusão e reabertura |
| `node tests/canais-integracao.js` | APROVADO em mock — idempotência, ficha/fila/CIRCA e webhook |
| `node tests/portal-isolamento.js` | APROVADO em mock — isolamento do portal e consulta de protocolo |
| `npm audit --omit=dev --audit-level=high` | REPROVADO — 9 vulnerabilidades (7 moderadas, 2 altas), sem correção disponível para as cadeias reportadas |
| `npm run db:validate` | BLOQUEADO — Prisma tentou gravar cache em filesystem somente leitura; não indica falha de schema |

## Inventário resumido

| Área | Implementação observada | Fonte/integração | Resultado de auditoria |
|---|---|---|---|
| Autenticação e sessão | Login, refresh, primeiro acesso, logout, recuperação | API + Sheets/PG opcional | PARCIAL — testes automatizados; credenciais reais não testadas |
| Quem Sou Eu | Onboarding, rascunho e perfil profissional | `/api/meu-perfil`, `/api/auth/completar-primeiro-acesso` | APROVADO em testes locais |
| Manifestações | Criação, ficha, status, tratativas, devolutiva, encerramento | `/api/manifestacoes/*` | PARCIAL — integração real bloqueada por infraestrutura |
| CIRCA | Captura, investigação, resolução, conhecimento e aprimoramento | `circaEngine`, `circaWorkflow`, Cérebro e matriz | APROVADO estruturalmente; PARCIAL operacionalmente |
| Pesquisas | Formulários, convites, respostas, análise e relatório | `/api/pesquisas/*` | APROVADO em testes automatizados; staging não testado |
| Portal do Cliente | Manifestação, protocolo, pesquisas e isolamento | artefato público + APIs restritas | APROVADO em testes de isolamento/mock; staging bloqueado |
| Arquivo de Fichas | Busca, filtros, histórico e importação | `/api/biblioteca/*` | PARCIAL — validação visual e documentos reais pendentes |
| Gestão de acessos | Usuários, perfis, permissões, ativação e exclusão lógica | `/api/admin/*`, Sheets/PG | APROVADO em testes locais; e-mail e persistência real pendentes |
| Clientes e Produtos | Cadastros e produtos | `/api/cadastros/*`, `/api/produtos/*` | PARCIAL — importação e dados reais não homologados |
| Banco de Casos/Devolutivas | Consulta, cadastro, aprovação e versionamento | `/api/caso*`, `/api/cerebro/*` | PARCIAL — dependente de persistência externa |
| Relatório de Satisfação | Metas, relatório, publicação e PDF | `/api/relatorios/*` | PARCIAL — Drive/PDF real não homologado |
| RNC | PR #382 aberto para desativação | `/api/rnc*` | NÃO CONFORME NA MAIN; a desativação existe apenas na branch do PR |

## Matriz de acessos

Os testes locais comprovaram bloqueios por perfil e empresa para manifestações, histórico, tratativas, visualizações, devolutivas, análise, sugestões e setores. Não foi possível comprovar todos os perfis com credenciais reais nem testar concorrência em staging. A matriz de permissões deve ser revalidada após a desativação do RNC na `main`.

## Fluxos ponta a ponta

| Fluxo | Resultado | Evidência/pendência |
|---|---|---|
| Portal → manifestação → fila → CIRCA → encerramento | PARCIAL | Teste de isolamento/mock aprovado; persistência real e atualização visual entre ambientes bloqueadas |
| Pesquisa nota ≤ 6 → triagem | PARCIAL | Regras e duplicidade testadas; envio real do portal não homologado |
| Primeiro acesso → Quem Sou Eu → colaboradores | APROVADO localmente | Teste browser local; sincronização com base real pendente |
| Arquivo → documento → vínculos | PARCIAL | APIs e interface presentes; Drive/PDF/DOCX reais pendentes |
| Investigação → causa → conhecimento → reincidência | PARCIAL | Determinístico e testes CIRCA passam; dados históricos reais indisponíveis |
| Apoio setorial → retorno → histórico | PARCIAL | Rotas e permissões testadas; notificação externa e calendário real pendentes |

## CIRCA

O motor mantém separação entre regras determinísticas, recomendações de IA e validação humana. Os testes comprovam que a IA não aprova, envia mensagens ou encerra automaticamente. A utilização operacional de matriz, histórico e conhecimento está implementada, mas a persistência real e a qualidade dos dados de produção não puderam ser comprovadas.

## Falhas e riscos

| ID | Severidade | Problema | Impacto |
|---|---|---|---|
| AUD-001 | P0 | Persistência PostgreSQL não homologada/disponível | Integridade e recuperação entre módulos não comprovadas |
| AUD-002 | P0 | Credenciais/IDs Google de staging ausentes | Portal, Sheets, Drive e sincronizações reais não comprovados |
| AUD-003 | P1 | RNC ainda ativo na `main` enquanto PR #382 está aberto | Divergência entre requisito de desativação e produção |
| AUD-004 | P1 | `npm audit` reporta 2 vulnerabilidades altas sem correção disponível | Risco de segurança dependente de mitigação/upgrade |
| AUD-005 | P1 | Não há execução completa com todos os perfis reais | Autorização efetiva não comprovada para liberação |
| AUD-006 | P2 | Homologação visual desktop/mobile de todas as telas não executada | Diferenças de layout podem permanecer |
| AUD-007 | P2 | Falhas de serviço exibem logs de fallback (`undefined`/credenciais ausentes) | Diagnóstico e operação degradada ficam incompletos |

## Plano de reteste

1. Disponibilizar ambiente PostgreSQL isolado e executar `prisma validate`/testes de repositórios.
2. Configurar `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, Google Drive e credenciais de staging.
3. Criar contas controladas para cada perfil e repetir a matriz de acessos por empresa/setor.
4. Executar os seis fluxos ponta a ponta com dados fictícios e verificar persistência entre telas.
5. Validar RNC após o PR #382, sem reintroduzir dependências no CIRCA.
6. Executar inspeção visual desktop/mobile e testes de resiliência com rede/API simuladas.
7. Revisar as vulnerabilidades de dependências e documentar mitigação ou upgrade.
