# Auditoria geral — Assistente SAC Grupo Chiacchio

**Data da auditoria:** 23/10/2026  
**Branch:** `audit/geral-sac`  
**Base auditada:** `origin/main` no commit `6eb8caa`  
**Escopo desta entrega:** diagnóstico técnico, funcional, visual e operacional. Nenhum código da aplicação, dado, permissão ou configuração de produção foi alterado.

## Parecer executivo

**Veredito: NÃO APTO PARA HOMOLOGAÇÃO DE PRODUÇÃO.**

A base possui uma cobertura automatizada relevante e os testes executáveis com dados simulados passaram. Foram confirmados controles de sessão, isolamento entre empresas, fluxo público do portal, regras de pesquisas, idempotência, concorrência e a regra de não gerar RNC automaticamente. Porém, há uma falha funcional confirmada no Relatório de Satisfação, há variáveis de produção ausentes no ambiente auditado e não foi possível comprovar persistência real em Google Sheets/PostgreSQL, integrações Google Drive/IA, deploy Vercel ou fidelidade visual contra todos os HTMLs aprovados.

O resultado positivo dos testes abaixo deve ser interpretado como **evidência em ambiente simulado**, e não como aprovação das integrações de produção.

## Evidências e limites

### Evidências coletadas

- Arquitetura, rotas, permissões, serviços, repositórios, configurações e testes foram inspecionados no checkout.
- `public/index.html` contém 34 páginas da SPA, 31.004 linhas, 44 blocos inline de JavaScript e 601 atribuições de `innerHTML`/`insertAdjacentHTML`.
- `api/index.js` contém 10.428 linhas. Foram contadas 323 declarações de rotas em `api/` e `server-routes/`.
- Há 16 serviços de servidor, 9 repositórios de banco e 7 arquivos de teste.
- `node --check api/index.js`: aprovado.
- Verificação sintática dos 44 scripts inline de `public/index.html` com `new Function`: 0 erros.
- `git diff --check`: aprovado.
- Smoke test em Chromium headless com usuário MASTER simulado: navegação entre páginas e carregamento do shell sem `pageerror` da aplicação; três recursos externos falharam por certificado do ambiente (Google Fonts, pdf.js e jsPDF).
- Teste de navegador existente `tests/meu-perfil-browser.js`: aprovado, incluindo login, cinco etapas, rascunho após recarregar, conclusão e reabertura.

### Limitações que impedem uma aprovação de produção

- Não foram fornecidas credenciais de usuário real nem autorização para gravar dados reais.
- `GOOGLE_CREDENTIALS`, `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `DATABASE_URL` e `OPENAI_API_KEY` não estavam disponíveis no ambiente de auditoria.
- A suíte usa `tests/sheets-mock.js`; os três testes de PostgreSQL foram pulados por ausência de `DATABASE_URL`.
- Não houve acesso ao painel Vercel, aos logs de produção, às variáveis de ambiente de produção ou ao deploy real.
- Os HTMLs de referência anexados em conversas anteriores não estão versionados neste checkout; existem somente alguns arquivos `design_mockup/*.dc.html`. Assim, não foi possível afirmar fidelidade visual pixel a pixel.
- A largura, responsividade e acessibilidade não foram validadas em todas as resoluções solicitadas.

## Achados priorizados

| ID | Severidade | Status | Achado e evidência | Impacto | Correção recomendada |
|---|---|---|---|---|---|
| AUD-001 | **Alta** | **Falha confirmada** | O Relatório de Satisfação permanece em `Carregando...`. No Chromium, após abrir a página, não foi emitido `GET /api/pesquisas/relatorio`; ao chamar o carregador, ocorre `ReferenceError: _meta is not defined` em `public/index.html:8568`. A mesma variável aparece em `8402`, `8407`, `8410`, `8415`, `8426`, `8450`, `8514` e `8580`, embora a função declare `getMeta()`. | Impede visualizar e editar o relatório, inclusive quando não há respostas. | Substituir as referências de `_meta` por uma fonte definida (`getMeta()` ou variável local) e adicionar teste de regressão para dados vazios, erro de API, rascunho e visão diretoria. |
| AUD-002 | **Alta** | **Risco confirmado no ambiente auditado; produção não verificada** | A inicialização registra `FATAL` para `SPREADSHEET_ID` e `SESSION_SECRET` ausentes, avisa sobre `PESQUISA_SPREADSHEET_ID` e usa segredo aleatório quando `SESSION_SECRET` não existe (`api/index.js:238-256`). Em produção o processo tenta sair, e em outros ambientes o segredo muda a cada reinício. | Pode impedir o deploy ou invalidar sessões após reinício; pesquisas podem cair em planilha de fallback. | Conferir as variáveis nos projetos Vercel, usar segredo estável com pelo menos 32 caracteres e configurar a planilha de pesquisas explicitamente. Não registrar valores no repositório. |
| AUD-003 | **Alta** | **Não testada** | Persistência real, PostgreSQL, Google Sheets e Drive não puderam ser validados. A suíte pulou 3 testes PG e usa mocks; os testes de anexos apenas exercitam o comportamento simulado. | Não há evidência suficiente de que leitura, escrita, anexos, concorrência e recuperação após recarregar funcionem com os dados institucionais. | Executar uma rodada em staging isolado com credenciais temporárias, banco de teste e planilha de teste, incluindo leitura/escrita, falha parcial e idempotência. |
| AUD-004 | **Média** | **Risco confirmado por inspeção** | O relatório de metas usa `localStorage` como cache e fonte inicial (`public/index.html:8204`, `8208`, `8214`, `8295`), embora também consulte a API. | Um navegador pode exibir meta antiga ou manter valor local quando a API falhar; isso pode divergir entre usuários. | Tornar o backend a fonte autoritativa, indicar explicitamente estado offline/erro e usar o armazenamento local somente como cache descartável com versionamento. |
| AUD-005 | **Média** | **Risco estrutural confirmado** | A SPA concentra 31 mil linhas, 44 scripts inline e múltiplas camadas que reatribuem `window.navigate`, `renderDashboard` e `pageLoaders` (por exemplo, blocos próximos a `10026`, `14652`, `17100`, `17775`, `28275` e `30475`). | A ordem de carregamento pode causar regressões silenciosas, páginas sem loader e sobreposição de responsabilidades. | Separar módulos por domínio gradualmente, manter um único dispatcher de navegação e adicionar testes de contrato para cada `pageLoader`. |
| AUD-006 | **Média** | **Falha potencial / não testada em produção** | Os testes exibem avisos repetidos de fallback de similaridade/conhecimento (`undefined` não é JSON, PG offline) e de Drive indisponível. As assertions continuam passando porque usam mocks e caminhos de fallback. | O SAC pode apresentar conhecimento ou anexos incompletos sem que a integração real esteja disponível. | Expor estado de dependência no diagnóstico, diferenciar “sem dados” de “falha de serviço” e validar IA, Drive e Sheets em staging. |
| AUD-007 | **Média** | **Não testada** | A comparação visual com os HTMLs de referência não pôde ser executada; os arquivos aprovados não estão no repositório e não há evidência de captura comparável para todas as telas. | Não é possível certificar dimensões, cortes, rolagem, responsividade ou identidade visual. | Versionar os HTMLs de referência ou disponibilizá-los no ambiente de validação; executar comparação nas larguras previstas e guardar capturas. |
| AUD-008 | **Baixa** | **Limitação do ambiente** | O smoke test sem ignorar certificados não carregou Google Fonts, pdf.js e jsPDF por `ERR_CERT_AUTHORITY_INVALID`. Com `--ignore-certificate-errors`, não houve `pageerror` da aplicação. | Pode alterar aparência e impedir PDF no ambiente local; não prova falha no domínio de produção. | Verificar a cadeia TLS/CDN no domínio publicado e preferir assets locais para dependências essenciais de interface/PDF. |

Não foram encontrados, nos testes automatizados, indícios de acesso cross-company, login com senha em texto puro, RNC automática por reclamação ou duplicidade em criações concorrentes. Esses resultados não substituem a validação com serviços reais.

## Inventário da arquitetura

| Camada | Evidência | Papel |
|---|---|---|
| Frontend | `public/index.html`, `public/assets/`, `public/portal.html`, `public/fichas.html` | SPA vanilla, páginas internas, portal e estilos/assets compartilhados. |
| API | `api/index.js`, `server-routes/manifestacoes.js`, `server-routes/pesquisas.js` | Express/Vercel Functions, autenticação, rotas internas e públicas. |
| Serviços | `server-services/*.js` | Dashboard, ficha, tratativa, devolutiva, Cérebro, IA, PDF, planilhas e portal. |
| Persistência | Google Sheets/Drive; PostgreSQL opcional em `database/` | Sheets é o caminho padrão quando `PG_LEITURA_ATIVA=false`; PostgreSQL depende de `DATABASE_URL`. |
| Deploy | `vercel.json`, `portal-cliente/vercel.json` | Projeto interno e projeto público estático separado. O estado do deploy real não foi consultado. |
| Sessão | HMAC SHA-256 em `api/index.js`, `sessionStorage`/token no frontend | TTL de 8 horas, refresh e checagem de usuário ativo. |
| IA | `server-services/aiService.js`, `cerebroServices.js` | Provider configurável, com análise determinística quando indisponível. |

## Inventário de telas

Os IDs encontrados em `public/index.html` foram: `page-visao-geral`, `page-nova-manifestacao`, `page-similares`, `page-painel-maquina`, `page-banco-rnc`, `page-central-cadastros`, `page-sugestoes-melhoria`, `page-relatorio-satisfacao`, `page-cerebro`, `page-matriz-causas-tratamentos`, `page-banco-devolutivas`, `page-base-conhecimento`, `page-biblioteca-fichas`, `page-aprovadores`, `page-auditoria`, `page-prazos-regionais`, `page-portal-admin`, `page-meu-perfil`, `page-central-sac`, `page-banco-manifestacoes`, `page-usuarios`, `page-setores`, `page-matriz`, `page-causas`, `page-matriz-conhecimento`, `page-rca`, `page-representantes`, `page-central-gerente`, `page-gestao-diretoria`, `page-alimentacao`, `page-tratativa`, `page-acompanhamento`, `page-fichas` e `page-rnc`.

As rotas amigáveis são mapeadas no próprio frontend (`/dashboard`, `/manifestacoes`, `/nova-manifestacao`, `/indicadores`, `/rnc`, `/relatorio-satisfacao`, `/cerebro`, `/banco-casos`, `/arquivo-fichas`, `/auditoria`, `/configuracoes` e outras). O mapa de rotas existente também documenta endpoints legados e seus escopos; ele deve ser revalidado após qualquer alteração de autorização.

## Matriz funcional por módulo

Legenda: **FUNCIONANDO** = evidência automatizada suficiente no ambiente simulado; **COM FALHA** = teste reproduzível com erro; **INCOMPLETA** = parte comprovada, parte sem evidência; **NÃO IMPLEMENTADA** = ausência comprovada; **NÃO TESTADA** = sem condições de execução.

| Módulo/fluxo | Classificação | Evidência e limite |
|---|---|---|
| Login, sessão, refresh e usuário inativo | **FUNCIONANDO** no mock | Suite cobre token, expiração, senha com hash, sessão e rejeição de usuário inativo. Produção não testada. |
| Perfis, permissões e escopo por empresa | **FUNCIONANDO** no mock | Testes cobrem MASTER, analistas, aprovadores, isolamento Chiacchio/Plaschio/Tubahia, escrita e leitura. Backend real não testado. |
| Nova manifestação, protocolo e concorrência | **FUNCIONANDO** no mock | Testes cobrem protocolo, IDs únicos, empresa e criação concorrente. Busca real de cliente e anexos reais não testados. |
| Central de Manifestações, encaminhamento e tratativa | **INCOMPLETA** | APIs e comportamento de escopo/status têm testes; navegação visual completa, tratamento por usuário real e persistência institucional não foram validados. |
| Aprovação, devolutiva e finalização | **INCOMPLETA** | Fila, decisões, devolutiva pública e isolamento têm cobertura simulada; não houve teste E2E com Sheets/Drive reais. |
| Análise IA e Busca de Similares | **INCOMPLETA** | Abstração e regras determinísticas foram verificadas; provider real, latência, erro de quota, conteúdo e auditoria de recomendações não foram testados. |
| Dashboard Executiva e indicadores | **INCOMPLETA** | Fórmulas de NPS, SLA e escopo foram testadas; carregamento visual, números em produção e todas as abas não foram certificados. |
| Central de Indicadores | **NÃO TESTADA** | Shell foi alcançado no smoke test, mas indicadores e filtros reais não foram exercitados com fonte institucional. |
| RNC | **FUNCIONANDO** quanto à regra de abertura automática | Suite confirma que reclamação não gera RNC automaticamente e cobre escopo; fluxo visual completo, aprovação e eficácia não foram testados. |
| Cadastros, usuários e Gestão de Acessos | **INCOMPLETA** | Rotas de usuários são MASTER-only e perfis/escopos têm testes; criação/edição/desativação/exclusão e sincronização profissional não foram validadas com persistência real. |
| Centro das Pesquisas | **FUNCIONANDO** no mock | 22 testes cobrem publicação, rascunho, respostas, NPS, convites, concorrência, histórico e decisões; interface e integrações reais não testadas. |
| Relatório de Satisfação | **COM FALHA** | Loader reproduz `ReferenceError: _meta is not defined` e deixa a tela em “Carregando...”. |
| Cérebro, Matriz de Causas/Tratamentos e Devolutivas | **INCOMPLETA** | Serviços, rotas e shell foram encontrados; persistência, aprovação, versionamento e navegação de todas as subtelas não foram validados. |
| Banco de Casos e Arquivo de Fichas | **INCOMPLETA** | Páginas, rotas e integração documental existem; importação, anexos, paginação, sincronização idempotente e dados reais não foram testados. |
| Portal público e Gestão do Portal | **FUNCIONANDO** no mock | 11 testes de isolamento e comportamento cobrem origem pública, rate limit, protocolo, pesquisa, manifestação e proteção de rotas. Deploy, domínio e Drive reais não foram testados. |
| Notificações e integrações de envio | **NÃO TESTADA** | Não houve credenciais/serviço real de e-mail, WhatsApp ou destinatários da Diretoria. |
| Auditoria e histórico | **INCOMPLETA** | Rotas e gravação simulada aparecem na suíte; consulta completa por perfil, retenção e cadeia de auditoria de produção não foram comprovadas. |
| Meu Perfil / Quem Sou Eu | **FUNCIONANDO** no mock | Teste Chromium existente aprovado para fluxo de cinco etapas e persistência simulada. Dados oficiais e regra administrativa real não testados. |
| Responsividade, acessibilidade e fidelidade visual | **NÃO TESTADA** | Não houve matriz completa de resoluções, comparação com cada HTML aprovado, leitor de tela ou auditoria de contraste. |

## Cobertura dos testes executados

### `npm test`

Comando executado na branch de auditoria:

```text
NODE_ENV=test npm test
```

Resultado: **157 aprovados, 0 falhas e 3 pulados**.

- `tests/suite.js`: **48 aprovados, 0 falhas, 3 pulados** (os 3 pulados exigem `DATABASE_URL`).
- `tests/behavior.js`: **76 aprovados, 0 falhas**.
- `tests/pesquisas.js`: **22 aprovados, 0 falhas**.
- `tests/portal-isolamento.js`: **11 aprovados, 0 falhas**.

Os testes também registraram warnings de `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `SESSION_SECRET`, `AI_PROVIDER`, PostgreSQL offline e Drive indisponível. Isso foi preservado como evidência de limitação, não convertido em aprovação de produção.

### Navegador

- `node tests/meu-perfil-browser.js`: aprovado.
- Smoke manual automatizado no Chromium headless: login simulado e navegação para páginas internas; nenhuma exceção `pageerror` da aplicação no shell exercitado.
- **Falha reproduzida:** Relatório de Satisfação continua em `Carregando...`; ao invocar seu carregador, o navegador acusa `ReferenceError: _meta is not defined`. A chamada `/api/pesquisas/relatorio` não é iniciada nesse fluxo.
- Recursos externos com certificado inválido no ambiente: Google Fonts, pdf.js e jsPDF. O teste não usou isso para declarar falha de produção.

### Testes não executados

- Fluxos com Sheets/Drive/PostgreSQL/IA reais.
- Login com contas reais e matriz completa de perfis no ambiente publicado.
- Importação de fichas/casos e anexos reais.
- Envio real de e-mail/WhatsApp/Diretoria.
- Exportação PDF validada por inspeção do arquivo final.
- Responsividade nas larguras 1920, 1440, 1366, 1024, 768 e 375–430 px.
- Comparação visual contra os HTMLs de referência anexados.
- Verificação de domínio, variáveis, logs e estado Ready na Vercel.

## Segurança, dados e operação

### Controles evidenciados

- Tokens assinados com HMAC SHA-256 e expiração.
- Senhas em texto puro são rejeitadas; o código aceita bcrypt e legado sha256 com migração prevista.
- Rotas administrativas utilizam `requerPerfil`/`requerPermissao`; usuários demo ficam desabilitados por padrão.
- Testes cobrem 401 sem token, 403 por empresa, usuário inativo, tentativa cross-company, rate limit público e isolamento do projeto público.
- Protocolos e devolutivas públicas têm regras de confirmação e exposição mínima testadas.
- Criações concorrentes geram IDs distintos; pesquisas usam marcadores/idempotência nos testes.

### Pontos que exigem validação antes de produção

- Garantir segredo de sessão estável e variáveis de Sheets/Drive/DB/IA em ambos os projetos corretos.
- Revalidar todas as rotas por ID e rotas administrativas após alterações de permissões; o documento `docs/MAPA_ROTAS.md` mantém uma lista de endpoints legados marcados para revalidação de escopo.
- Confirmar que a fonte autoritativa é sempre a persistência institucional e que caches do navegador não substituem APIs.
- Confirmar auditoria de exclusão, desativação, reabertura e reprocessamento sem perda de histórico.
- Medir tempo de resposta, limites de Vercel, quota Google e comportamento de falhas parciais.

## Fluxos críticos avaliados

1. **Portal → SAC:** testado com mock; manifestação chega à mesma base/fila, recebe protocolo e respeita isolamento.
2. **Pesquisa → análise humana:** testado com mock; nota crítica sinaliza o SAC e não abre OCP/manifestações automaticamente.
3. **Manifestação → RNC:** regra de não geração automática aprovada.
4. **Empresa → consulta/indicadores:** filtros de empresa e escopo aprovados em testes comportamentais.
5. **Finalização → conhecimento/banco de casos:** estrutura de serviços/rotas foi localizada, mas consolidação real e idempotente não foi comprovada ponta a ponta.
6. **Relatório mensal:** falha confirmada antes da etapa de consulta, por exceção de variável não definida.

## Plano de correção priorizado

### P0 — antes de qualquer homologação

1. Corrigir `AUD-001` e criar regressão do relatório para mês sem respostas, erro de API, rascunho, edição, visão Diretoria e PDF.
2. Conferir `SESSION_SECRET`, `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `GOOGLE_CREDENTIALS`, `DRIVE_FOLDER_ID`, `DATABASE_URL`, `OPENAI_API_KEY` e `AI_PROVIDER` nos ambientes corretos; repetir smoke e health checks sem expor segredos.
3. Criar staging isolado e executar os fluxos críticos com Sheets/Drive/PG reais, sem registros de clientes.

### P1 — integridade e operação

4. Validar consolidação de manifestações finalizadas no Arquivo/Banco de Casos, duplicidade, reabertura e auditoria.
5. Validar anexos, PDF, devolutivas, notificações e integrações externas com falha parcial e retentativa.
6. Revalidar rotas por ID, perfis e competências em uma matriz de autorização executada contra a API publicada.

### P2 — qualidade de interface e manutenção

7. Executar comparação visual dos HTMLs de referência e matriz responsiva completa.
8. Reduzir overrides globais e reatribuições de `window.navigate`/`renderDashboard`; adicionar contratos de carregamento por página.
9. Remover dependência de `localStorage` como fonte inicial de metas institucionais e diferenciar estados de cache, ausência e erro.

## Plano de revalidação após correções

- Reexecutar `node --check api/index.js`, parser dos scripts inline e `git diff --check`.
- Reexecutar as quatro suítes e eliminar os três skips em ambiente PG de staging.
- Executar teste E2E descartável: login → manifestação → aprovação → tratativa → devolutiva → encerramento → Arquivo/Banco de Casos → indicadores.
- Executar teste E2E do portal em origem separada, com protocolo, pesquisa, anexo, rate limit e consulta protegida.
- Validar todos os perfis e empresas, incluindo tentativa negativa cross-company.
- Abrir cada tela e aba em Chromium nas seis larguras previstas, guardar capturas e verificar ausência de `pageerror`, rolagem horizontal e elementos cortados.
- Conferir logs, auditoria, métricas, PDF e persistência depois de recarregar a página.

## Conclusão

O projeto apresenta uma base funcional significativa e bons controles automatizados para regras centrais do SAC, mas a auditoria não encontrou evidência suficiente para declarar a operação de produção íntegra. O bloqueio imediato é o Relatório de Satisfação em carregamento infinito; em seguida, é necessário validar a configuração e as integrações reais. Esta entrega é exclusivamente o diagnóstico solicitado. Nenhuma correção, migração, alteração de dados, merge ou deploy foi realizado.
