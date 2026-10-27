# Fase 4 — Estabilização final e homologação

Data: 2026-10-26
Escopo: auditoria e testes em desenvolvimento, sem merge, deploy ou alteração de dados reais.

## Adendo de validação de produção — 2026-10-27

Após a configuração declarada no ambiente Vercel, a validação pública foi repetida. As rotas `GET /api/health`, `GET /api/public/empresas`, `GET /api/public/pesquisas` e `GET /api/public/whatsapp` responderam `HTTP 500 FUNCTION_INVOCATION_FAILED`. Como todas falham antes de atender a rota, trata-se de falha de inicialização da função, não de autenticação, quota do Sheets ou de uma tela isolada.

O código publicado encerra o processo em produção se `SPREADSHEET_ID` estiver ausente ou se `SESSION_SECRET` estiver ausente/menor que 32 caracteres. Ele também inicializa `PORTAL_PUBLIC_URL` de forma estrita: deve ser uma origem HTTPS do Portal separado, sem caminho, parâmetros, credenciais ou o mesmo domínio do SAC. A configuração deve ser conferida no projeto Vercel do Assistente SAC e no escopo **Production**; os valores não foram registrados neste repositório.

Também foi verificado que as sete correções CIRCA descritas no relatório recebido não estavam no `origin/main` publicado. Elas foram aplicadas somente na branch de trabalho: contexto ampliado para análise, rascunho antes da análise determinística de ficha nova, aplicação não destrutiva de sugestões, preenchimento de validação, geração confirmada de devolutiva e resumo com causa sugerida. As suítes `nova-manifestacao-v4`, `circa-integration`, `circa` e `behavior` passaram localmente; persistência real permanece não validada. Não houve merge ou deploy.

## Parecer final: **NÃO APTO para publicação definitiva**

Os testes locais e os contratos de integração estão aprovados, mas a persistência real ponta a ponta não foi comprovada neste ambiente. PostgreSQL, Google Sheets com credenciais de homologação, Drive e IA externa não estão disponíveis para execução controlada. O Portal também não pode ser considerado homologado apenas por respostas HTTP de leitura.

## Correções da Fase 4

- `api/index.js`: leituras concorrentes da mesma aba agora são deduplicadas por chave; somente uma chamada chega ao Sheets enquanto as demais aguardam a mesma Promise.
- `api/index.js`: retry de leitura 429/503 usa backoff exponencial limitado e jitter; não há repetição para outros erros.
- `server-services/sheets.js`: mesmo controle de concorrência e backoff foi aplicado ao serviço compartilhado de Sheets.
- `server-routes/pesquisas.js`: catálogo público mantém snapshot curto somente para leitura e usa o último snapshot em erro transitório; escritas nunca usam cache como confirmação.
- A invalidação e os fluxos de escrita existentes foram preservados. Nenhuma tentativa foi adicionada a operações de gravação.

## Investigação do HTTP 429

Foram revisados os pontos de leitura em `api/index.js`, `server-services/sheets.js`, `server-services/pesquisaFormulariosService.js`, rotas de pesquisas, manifestações, Cérebro e matrizes. O risco principal era a combinação de leituras repetidas em renderizações concorrentes e chamadas simultâneas para o catálogo público.

Após a correção, a leitura pública consultada em 2026-10-26 respondeu HTTP 200 e retornou os três formulários publicados. O mesmo endpoint havia respondido HTTP 429 anteriormente com a mensagem de quota do Google Sheets. Isso demonstra recuperação do incidente, mas não prova que a quota/projeto externo esteja definitivamente corrigido; é necessário monitorar em homologação após publicação autorizada.

## Testes e evidências

- `npm test`: 0 falhas; suíte completa executada, incluindo regressão das Fases 1 e 2.
- `node tests/pesquisas.js`: 22/22 aprovados.
- `node tests/portal-isolamento.js`: 11/11 aprovados.
- `node tests/fase1-operacional.js`, `node tests/fase2-integracoes.js`, `node tests/circa-integration.js`: aprovados.
- `node --check api/index.js server-services/sheets.js server-routes/pesquisas.js`: aprovados.
- Portal separado: `node tests/portal-pesquisa-cards.js`: 10/10 aprovados; build estático concluído.
- Produção, somente leitura: `/api/health` HTTP 200; `/api/public/pesquisas` foi reconsultado e respondeu HTTP 200; nenhum POST real foi executado.
- `npm audit --omit=dev --audit-level=high`: nenhum high/critical; permanecem 7 moderadas transitivas relacionadas a `googleapis`/`uuid`, sendo que o relatório informa “No fix available” para `uuid`.
- `npm run test:fase4:preflight`: executado sem acessar serviços; identificou 0/5 variáveis de homologação presentes (`DATABASE_URL`, `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `GOOGLE_CREDENTIALS`, `SESSION_SECRET`).

## Homologação dos fluxos

Com dados sintéticos e Sheets mock: Portal → manifestação → protocolo CHIA/PLA/TUB → Central SAC → atualização de status → consulta pública; pesquisa → persistência → indicadores/relatório; nota até 6 → pendência SAC; isolamento por empresa; idempotência; revogação de sessão; usuários e permissões. Todos os cenários cobertos passaram.

Não executado com dados reais: criação de manifestação no Portal publicado, resposta de pesquisa publicada, atualização de status em nova sessão, leitura posterior no Portal, upload real ao Drive e chamada real de IA. Esses itens permanecem bloqueados por ausência de credenciais/ambiente autorizado.

## Usuários, permissões e segurança

MASTER, Gestor, Aprovador, Analista SAC e RCA possuem testes estruturais e comportamentais de autorização e isolamento. Ativação, desativação, exclusão lógica, revogação e auditoria foram aprovadas no ambiente isolado. O PostgreSQL está configurado como indisponível nos testes (`DATABASE_URL` ausente); portanto a persistência PostgreSQL e a restauração após nova sessão continuam não validadas.

Variáveis exigidas, sem exposição de valores: `DATABASE_URL`, `SPREADSHEET_ID`, `PESQUISA_SPREADSHEET_ID`, `GOOGLE_CREDENTIALS`, `SESSION_SECRET` e chaves de IA quando o provedor for habilitado. Backup/restauração externos não foram executados.

O preflight reproduzível está em `tests/fase4-preflight.js` e lista apenas nomes/formatos, nunca valores. Para a execução real ainda são necessárias contas sintéticas dos cinco perfis e um arquivo/objeto de credencial de homologação fornecido por variável de ambiente.

## Versões avaliadas

- Assistente SAC: branch `fix/usuarios-persistencia-edicao`, commit local `1971407`.
- Portal do Cliente: branch `fix/fidelidade-pesquisas-portal`, commit local `4351fb5`.
- Portal publicado correspondeu ao HTML local verificado; os projetos Vercel são separados.

## Checklist de publicação

- [x] Testes locais de regressão sem falhas.
- [x] Contratos públicos e isolamento revisados.
- [x] Mitigação de leituras concorrentes e retry controlado implementada.
- [ ] Credenciais de homologação fornecidas e verificadas.
- [ ] Persistência PostgreSQL e/ou Sheets comprovada ponta a ponta.
- [ ] Upload/consulta Drive comprovados com arquivo sintético.
- [ ] IA externa e tratamento de respostas inválidas comprovados.
- [ ] Fluxos reais Portal → SAC → Portal executados sem dados destrutivos.
- [ ] Monitoramento de quota 429 observado após publicação.
- [ ] Aprovação explícita para merge e deploy.

## Plano de rollback

Como não houve merge nem deploy, o rollback é simplesmente descartar a branch/working tree da Fase 4 e manter os commits publicados anteriores. Após eventual publicação autorizada, reverter para os commits de produção registrados de cada projeto Vercel e revalidar health, catálogo público e autenticação antes de reabrir o acesso.

Nenhum merge, deploy, exclusão ou alteração de dado real foi executado.
