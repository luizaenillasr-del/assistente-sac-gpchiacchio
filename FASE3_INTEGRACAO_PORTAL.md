# Fase 3 — Integração do Portal do Cliente

Data da validação: 2026-10-26
Escopo: homologação técnica em desenvolvimento, sem merge, deploy ou alteração de dados reais.

## Resultado

A integração está implementada no código e os fluxos principais foram comprovados com dados sintéticos e mocks isolados. A integração definitiva ainda **não pode ser declarada homologada em produção**, porque as escritas reais do Portal e a leitura do catálogo de pesquisas dependem das credenciais externas. Durante a verificação pública, o catálogo `/api/public/pesquisas` respondeu HTTP 429 por quota do Google Sheets.

## Arquitetura e versões

| Projeto | Repositório | Branch | Commit local verificado | Produção observada |
|---|---|---|---|---|
| Assistente SAC | `luizaenillasr-del/assistente-sac-gpchiacchio` | `fix/usuarios-persistencia-edicao` | `1971407` — persistência de edição de acessos | `assistente-sac-gpchiacchio.vercel.app` |
| Portal do Cliente | `luizaenillasr-del/portal-cliente-gpchiacchio` | `fix/fidelidade-pesquisas-portal` | `4351fb5` — merge de conflitos do Portal | `portal-cliente-gpchiacchio.vercel.app` |

O Portal é um projeto Vercel separado. Seu `vercel.json` mantém apenas rewrites públicos e específicos para o backend do Assistente; não existe proxy administrativo genérico. A comparação SHA-256 do HTML publicado com `portal.html`/`dist/index.html` local foi idêntica (`21c850df...cde70e`), portanto a versão pública do Portal corresponde ao commit local verificado.

## Endpoints de integração

- `POST /api/public/reclamacoes`: registro idempotente da manifestação, geração de protocolo CHIA/PLA/TUB, ficha e fila SAC.
- `GET /api/public/empresas`: empresas autorizadas para o formulário.
- `GET /api/public/pesquisas-ativas`: catálogo operacional/fallback das empresas com pesquisa ativa.
- `GET /api/public/pesquisas` e `GET /api/public/pesquisas/:id`: catálogo e formulário publicado.
- `POST /api/pesquisas/resposta-portal`: grava resposta com versão, deduplicação e pendência para nota crítica.
- `GET /api/public/protocolo/:protocolo` e `GET /api/public/manifestacoes/:protocolo`: consulta pública protegida por confirmação do cliente.
- `GET /api/public/whatsapp`: somente o número/link oficial cadastrado; a resposta informa `LINK_MANUAL` e `integracaoTecnicaAtiva:false`.

O Portal não contém credenciais, rotas internas ou API de WhatsApp. A CSP restringe conexões e os rewrites encaminham somente os caminhos acima.

## Correções realizadas nesta fase

- `server-routes/pesquisas.js`: catálogo público passou a manter snapshot curto em memória e a servir o último catálogo consistente em caso de falha transitória do Sheets (429/503). Esse fallback é somente leitura; respostas e alterações continuam exigindo persistência real.
- `api/index.js`: leituras de abas passaram a reutilizar snapshot anterior em indisponibilidade transitória, sem mascarar falhas de escrita; validação de credenciais JSON ficou explícita.
- As correções das Fases 1 e 2 foram preservadas: exclusão lógica/revogação de usuários, rascunho CIRCA, persistência de permissões, validação de arquivos, funcionamento sem IA e deduplicação de conhecimento.

## Arquivos alterados

Nesta fase: `server-routes/pesquisas.js` e `api/index.js`.
Arquivos das Fases 1/2 preservados no mesmo working tree: `server-services/sheets.js`, `server-services/documentService`, `server-services/matrizConhecimentoService.js`, `package.json`, `package-lock.json`, `public/index.html` e testes/relatórios correspondentes. O repositório do Portal não foi alterado nesta fase.

## Testes executados

- `npm test`: **0 falhas**; 43 testes estruturais, 77 comportamentais, 22 de pesquisas, 11 de isolamento do Portal e regressões de interface/navegação aprovados. 8 testes foram pulados por dependerem de PostgreSQL/credenciais externas.
- `node tests/pesquisas.js`: 22/22 aprovados.
- `node tests/portal-isolamento.js`: 11/11 aprovados, incluindo Portal → mesma base, resposta → indicadores, consulta segura de protocolo, isolamento e proteção de rotas.
- `node tests/fase2-integracoes.js`, `node tests/fase1-operacional.js`, `node tests/circa-integration.js`: aprovados.
- `node --check server-routes/pesquisas.js`: aprovado.
- No repositório separado `/workspace/portal-cliente-gpchiacchio`, `node tests/portal-pesquisa-cards.js`: 10/10 verificações do Portal aprovadas; build estático concluído.
- Verificação pública somente leitura: health do Assistente HTTP 200; `/api/public/empresas` HTTP 200; `/api/public/pesquisas-ativas` HTTP 200; `/api/public/whatsapp` HTTP 200; `/api/public/pesquisas` HTTP 429 por quota do Sheets.

## Cenários obrigatórios

1. Portal → registro: aprovado em `behavior.js`/`portal-isolamento.js` com dados sintéticos.
2. Registro → protocolo: aprovado; prefixos CHIA, PLA e TUB cobertos.
3. Protocolo → Central SAC: aprovado em criação/listagem e isolamento.
4. SAC → atualização de status: aprovado nos testes comportamentais.
5. Status → consulta Portal: aprovado com devolutiva liberada somente após encerramento.
6. Pesquisa → persistência: aprovado em `tests/pesquisas.js` com fonte mock isolada.
7. Nota até 6 → pendência SAC: aprovado; nota zero também é preservada.
8. Pesquisa → Relatório: aprovado nos testes de resultados/relatório.
9. Consulta indevida: negada por confirmação, empresa e autorização.
10. Falha de API: erros são convertidos em mensagens seguras; a quota 429 real foi observada e documentada.

## Validações e bloqueios restantes

Validados: contrato de rotas públicas, isolamento do Portal, idempotência, protocolos, status/devolutiva, formulários publicados, deduplicação, link manual oficial de WhatsApp e correspondência do artefato publicado.

Não validados em produção: gravação real de manifestação e resposta de pesquisa, PostgreSQL com `DATABASE_URL`, Sheets com `SPREADSHEET_ID`/`PESQUISA_SPREADSHEET_ID` e `GOOGLE_CREDENTIALS`, Drive com credenciais reais, IA externa e sincronização após nova sessão. Os testes locais usam mock controlado e não comprovam esses serviços.

Pendências antes da publicação: disponibilizar credenciais de homologação, investigar/aumentar quota do projeto Google Sheets que retornou 429, executar os dois fluxos de escrita com dados sintéticos no ambiente autorizado e repetir a consulta após recarregamento. Depois disso, a publicação deverá ser feita separadamente em cada projeto, mediante autorização explícita.

Nenhum merge, deploy, exclusão ou alteração de dado real foi executado.
