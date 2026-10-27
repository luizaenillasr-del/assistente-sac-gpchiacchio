# Fase 2 — persistência, integrações e segurança

Data: 26/10/2026
Branch: `fix/usuarios-persistencia-edicao`
Base preservada: Fase 1 sem merge, deploy ou alteração de dados reais.

## Problemas identificados e causas-raiz

1. **Sheets e PostgreSQL:** a aplicação possui caminhos duplos. Usuários, manifestações, configurações e históricos são lidos principalmente por `api/index.js`/Sheets quando `PG_LEITURA_ATIVA=false`; os repositórios Prisma são usados quando `DATABASE_URL` e `PG_LEITURA_ATIVA=true`. Pesquisas fazem merge com Sheets como fonte de verdade e PostgreSQL como complemento. O ambiente local não possui as credenciais para provar a reconciliação real.
2. **Cérebro:** os serviços `cerebroServices` e `matrizConhecimentoService` importavam o Sheets real mesmo durante testes com mock. A ausência de `GOOGLE_CREDENTIALS` acabava registrada como `"undefined" is not valid JSON`, mascarando indisponibilidade de infraestrutura como erro de dado.
3. **Documentos/Drive:** o serviço aceitava entrada Base64 sem validação centralizada de tipo, conteúdo e tamanho. Falhas de credencial eram retornadas como erro genérico.
4. **Conhecimento:** itens ativos da mesma fonte podiam ser anexados mais de uma vez à mesma matriz.
5. **Dependências:** a auditoria apontava duas vulnerabilidades altas na cadeia Express/body-parser e vulnerabilidades moderadas na cadeia Google/UUID.

## Correções implementadas

- `server-services/sheets.js` aceita mock apenas quando `SHEETS_MOCK_PATH` é explicitamente definido em teste, evitando acesso externo acidental e permitindo testar Cérebro/Matriz com a mesma fonte isolada da API.
- Credenciais Google agora são validadas com mensagens distintas para ausente, JSON malformado e objeto inválido.
- `server-services/documentService` valida Base64, MIME permitido e limite de 50 MB antes de Drive ou IA.
- Falhas de arquivo, credencial externa e resposta de extração JSON agora têm códigos distintos; as APIs retornam 400, 503 ou 422 conforme a causa.
- Respostas de extração vazias ou sem objeto JSON não são mais tratadas como dado válido.
- A Matriz de Conhecimento rejeita vínculo ativo duplicado por fonte ou título, retornando conflito 409 na API.
- O lockfile foi atualizado para eliminar as vulnerabilidades altas de Express/body-parser sem aplicar o upgrade breaking do `googleapis`.
- O novo teste isolado foi incluído em `npm test`.

Arquivos alterados:

- `api/index.js`
- `server-services/sheets.js`
- `server-services/documentService`
- `server-services/matrizConhecimentoService.js`
- `package.json`
- `package-lock.json`
- `tests/fase2-integracoes.js`

## Fontes e operações

| Entidade | Fonte/caminho atual | Risco verificado |
|---|---|---|
| Usuários, status e permissões | Aba `USUARIOS` + `PERMISSOES_USUARIO`; Prisma quando PG está ativo | Divergência foi tratada na Fase 1, mas precisa de staging real |
| Manifestações, etapas e históricos | Aba `MANIFESTACOES`, `HISTORICO`, `CIRCA`; repositórios Prisma no caminho PG | Sem transação real comprovada no ambiente local |
| Pesquisas e respostas | Sheets como fonte de verdade, PG como complemento | Merge por identificador coberto localmente |
| Anexos | Drive para binário, `ANEXOS`/`EVIDENCIAS` para vínculo | Drive real não validado |
| Conhecimento/Matriz | Abas `MATRIZ_CONHECIMENTO`, `MC_ITENS_CONHECIMENTO` e auditoria; repositório de conhecimento no caminho PG | Deduplicação agora bloqueada no serviço |

Não foram executadas migrações, exclusões ou escritas em fontes reais.

## Testes executados

- `node tests/fase2-integracoes.js`: passou; valida credenciais, tipos/tamanhos, JSON ausente/inválido, IA indisponível, modo sem IA e deduplicação.
- `node tests/circa-integration.js`: passou.
- `node tests/fase1-operacional.js`: passou, preservando a Fase 1.
- `node --check` para API, Sheets, documentos e Matriz: passou.
- `npm test`: passou sem falhas; 43 testes estruturais, 77 comportamentais, 22 de pesquisas, 11 de isolamento do Portal e demais testes de regressão aprovados; 8 cenários externos permaneceram pulados por ambiente.
- `npm audit --omit=dev`: 0 altas, 0 críticas, 7 moderadas restantes na cadeia `googleapis`/`uuid`.

## Integrações validadas

Em ambiente isolado, foram validados os contratos de fallback, o funcionamento determinístico do CIRCA sem IA, a classificação de indisponibilidade externa, a rejeição de arquivos inválidos e a preservação da Fase 1.

## Integrações ainda bloqueadas

PostgreSQL real, Google Sheets real, Google Drive real, OpenAI/Anthropic, quota/rate limit de produção, transações/rollback, backups e nova sessão após gravação real continuam **NÃO VALIDADOS** porque não há `DATABASE_URL`, `SPREADSHEET_ID`, `GOOGLE_CREDENTIALS` ou chaves de IA disponíveis neste ambiente. Mocks não foram considerados evidência de produção.

## Riscos restantes

- As sete vulnerabilidades moderadas exigem avaliar upgrade potencialmente breaking para `googleapis` 188 antes de alterar a cadeia em produção.
- A fonte autoritativa dual precisa de homologação com registros sintéticos em PostgreSQL e Sheets simultaneamente.
- Upload e extração continuam dependentes de credenciais e limites externos.
- O mapeamento completo das 327 rotas ainda contém caminhos legados; não foram removidos sem contrato e dependência comprovados.

Nenhum merge ou deploy foi executado.
