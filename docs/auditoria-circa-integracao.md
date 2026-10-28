# Auditoria e integração do motor CIRCA

## A — Evidência usada

O inventário somente leitura do workflow `Inventário CIRCA` (execução
`40760652954`, artefato `inventario-circa-40760652954`) foi a fonte dos
quantitativos abaixo. O relatório do artefato não contém relatos, nomes,
e-mails ou valores livres.

| Base | Registros | Situação observada |
| --- | ---: | --- |
| `CAUSAS` | 0 | Aba existente, cabeçalho válido, catálogo vazio |
| `MATRIZ_TRATAMENTO` | 19 | 18 globais (`TODAS`) e 1 de Tubahia; todos ativos; uma linha sem ID canônico e sem tratamento obrigatório |
| `MODELOS_DEVOLUTIVA` | 30 | Todos aprovados; 29 globais e 1 de Tubahia; IDs e versões presentes |
| `DEVOLUTIVAS` | 0 | Aba e contrato existentes, sem comunicações gravadas |
| `BANCO_HISTORICO` | 95 | 47 Chiacchio, 44 Plaschio, 3 Tubahia e 1 sem empresa; IDs presentes; uma linha sem empresa |
| `APRIMORAMENTOS_CEREBRO` | — | O nome esperado não foi resolvido pelo inventário original |

Os metadados da mesma execução mostram a aba real `CEREBRO_APRENDIZADO`.
O resolver agora a reconhece como alias da base de aprimoramentos, sem criar
`APRIMORAMENTOS_CEREBRO`; a contagem e o contrato dessa aba ainda dependem de
uma nova execução manual do inventário.

## B — Diagnóstico

O caminho determinístico de `/api/manifestacoes/:id/circa` lia apenas
`CAUSAS_SUBCAUSAS`, embora a base canônica fosse `CAUSAS`. Isso fazia a etapa
de conhecimento perder causas cadastradas. A rota agora lê `CAUSAS` e só usa o
alias antigo quando a aba canônica estiver vazia.

As 19 linhas da matriz usam campos novos e legados ao mesmo tempo. A leitura
agora normaliza `ID_REGRA`, `TRATATIVA_PADRAO`, `SLA_HORAS`,
`REQUER_APROVACAO` e `DEVOLUTIVA_PADRAO` sem reescrever a planilha. Valores
`TODAS` passam a ter o mesmo significado de curinga que `*`, e causa/subcausa
participam do ranqueamento quando presentes.

Os 30 modelos aprovados não eram usados pelo gerador da Ficha. A geração agora
é somente leitura, seleciona o modelo aprovado mais específico e faz a
substituição dos marcadores; se não houver modelo compatível, mantém o template
determinístico existente. A aba `DEVOLUTIVAS` só é criada/alterada em uma ação
explícita de gravação.

O histórico usa `CAUSA_RAIZ_VALIDADA` e `COMP_CAUSA_PROVAVEL`, enquanto o
serviço consultava apenas aliases incompletos. A leitura agora inclui os nomes
reais e expõe achados históricos como `HIPOTESE_HISTORICA` com
`confirmada: false`. Nenhuma hipótese é promovida automaticamente a fato.

Durante a transição, a mesma manifestação pode aparecer em `MANIFESTACOES` e
`BANCO_HISTORICO`; a detecção de reincidência agora deduplica por ID persistido.

## C — Fluxo de fontes e contratos

- `matrizTratamentoService` lê `MATRIZ_TRATAMENTO` e normaliza o contrato em
  memória.
- `devolutivaEngine` lê `MODELOS_DEVOLUTIVA`; grava `DEVOLUTIVAS` somente ao
  salvar uma devolutiva.
- `cerebroServices` prioriza repositórios PostgreSQL quando habilitados e usa
  Sheets como fallback; no fallback, consulta `CAUSAS`, `BANCO_HISTORICO`,
  `POLITICAS`, `PROCEDIMENTOS` e `BASE_CONHECIMENTO`.
- A rota CIRCA determinística lê manifestação, tratativa, devolutiva, matriz e
  causas e não grava dados.
- A base de aprimoramentos é resolvida para `CEREBRO_APRENDIZADO` quando esse
  nome existe. O alias legado só é usado se a base canônica não estiver
  disponível; nenhuma aba é criada por uma leitura.

## D — Correções implementadas

- `api/index.js`: alias canônico de causas no CIRCA; leitura sem criação na
  listagem de devolutivas; resolução segura de `CEREBRO_APRENDIZADO`; escrita
  de aprimoramentos somente em uma aba existente; aliases corretos de causas
  históricas no popularizador.
- `server-services/matrizTratamentoService.js`: normalização legada, curingas
  de empresa, pontuação de causa/subcausa e ausência de escrita durante leitura.
- `server-services/devolutivaEngine.js`: uso de modelos aprovados, versão/origem
  do modelo no resultado e geração sem criação de aba.
- `server-services/cerebroServices.js`: hipóteses históricas explícitas,
  deduplicação de reincidência e propagação de causa/subcausa para matriz e
  devolutiva.
- `scripts/inventario-circa.js`: reconhecimento do nome real
  `CEREBRO_APRENDIZADO`.

## E — Validação executada

- `node --check` em API, serviços e testes: aprovado.
- `npm run test:circa:knowledge`: aprovado; cobre matriz legada, modelo
  aprovado, hipótese histórica, deduplicação e ausência de escrita.
- `node tests/circa.js`: aprovado.
- `node tests/circa-integration.js`: aprovado; autenticação, isolamento por
  empresa, etapas determinísticas e consulta sem gravação.
- `node tests/inventario-circa.js`: aprovado; o teste inclui o alias
  `CEREBRO_APRENDIZADO`.

Não houve acesso adicional às planilhas, PostgreSQL, Vercel ou serviços de IA
nesta correção. Portanto, não há homologação de produção nem confirmação da
estrutura interna de `CEREBRO_APRENDIZADO` além do nome retornado pelos
metadados do inventário.

## F — Pendências e conclusão

1. `CAUSAS` está vazia; as causas históricas só podem ser sugestões até uma
   validação humana.
2. `DEVOLUTIVAS` está vazia; não há histórico de comunicações para validar.
3. A linha incompleta da matriz e a linha histórica sem empresa precisam de
   tratamento administrativo, sem preenchimento automático nesta PR.
4. Deve-se executar novamente o workflow de inventário para obter o contrato
   sanitizado de `CEREBRO_APRENDIZADO`.
5. Não foram executados testes de produção, gravações, migrações ou deploy.

**Veredito: integrado com ressalvas.** Os caminhos de leitura e seleção estão
conectados aos contratos reais observados e protegidos contra promoção
automática de hipóteses. A homologação operacional completa depende de uma
nova execução somente leitura do inventário e de dados aprovados nas bases
vazias.
