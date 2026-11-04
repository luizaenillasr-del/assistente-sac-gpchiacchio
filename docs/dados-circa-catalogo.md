# Catálogo e contrato de dados do SAC CIRCA

Este documento descreve a organização da persistência sem alterar telas, fluxos ou registros. A fonte de cada domínio deve ser tratada como explícita até que uma reconciliação autorizada prove o contrário.

## Fontes oficiais atuais

| Domínio | Fonte oficial | Chave estável | Observação |
| --- | --- | --- | --- |
| Empresas, usuários, perfis, setores e responsáveis | PostgreSQL/Prisma (`empresas`, `usuarios`, `perfis`, `setores`, `responsaveis`) | ID interno; `id_original` para legado | Escopo empresarial e setorial deve ser validado no backend. |
| Manifestação operacional | Sheets `MANIFESTACOES` | `ID_MANIFESTACAO` e `PROTOCOLO` | O relato original é preservado em `DESCRICAO_ORIGINAL`/`DESCRICAO_RECLAMACAO`; aliases não devem apagar valores preenchidos. |
| Tratativa executada | PostgreSQL (`tratativas`, `tratativa_acoes`, `resultados_tratamento`) | IDs relacionais | Sugestão de IA e decisão humana são campos distintos. |
| Acionamentos setoriais | Sheets `ACIONAMENTOS_INTERNOS` | ID do acionamento + `ID_MANIFESTACAO` | Cada frente é independente e permanece vinculada ao mesmo protocolo. |
| Histórico operacional | Sheets `BANCO_HISTORICO` | `ID_HISTORICO`/`ORIG_ID_MANIFESTACAO` | Só registros com empresa e relato identificáveis alimentam similaridade/reincidência. |
| Causas e subcausas | Sheets `CAUSAS` | `ID_CAUSA` | Hipótese histórica nunca equivale a causa confirmada. |
| Matriz de tratamentos | Sheets `MATRIZ_TRATAMENTO` | `ID_TRATAMENTO`; `ID_REGRA` apenas em contrato legado | Ativo é estado cadastral; elegibilidade estrutural exige campos obrigatórios e correspondência com o caso. |
| Modelos de devolutiva | Sheets `MODELOS_DEVOLUTIVA` | ID do modelo | `APROVADA`/`PUBLICADA` e texto não vazio são pré-condições de disponibilidade, não prova de adequação ao caso. |
| Devolutivas realizadas | PostgreSQL (`devolutivas`) | ID + `manifestacao_id` | Modelo usado e comunicação efetivamente enviada são eventos distintos. |
| Aprendizado CIRCA | Sheets `CEREBRO_APRENDIZADO` ou `APRIMORAMENTOS_CEREBRO` | ID da base | O nome real deve ser descoberto pelos metadados; nunca criar uma aba durante leitura. |
| Pesquisas e indicadores | PostgreSQL (`pesquisa_respostas`, `relatorios_sac`) | ID original/chave de relatório | São domínios separados da manifestação. |

## Estrutura relacional

`Empresa` é a raiz do isolamento. `Setor`, `Usuario`, `Cliente`, `Produto`, `SlaConfig`, `Politica`, `Procedimento`, `Regra` e `MatrizTratamento` apontam para a empresa (setor quando aplicável). `Manifestacao` aponta para empresa e opcionalmente para cliente, setor, responsável, criador, classificação, produto e SLA. Histórico, reincidências, tratativas, devolutivas, resultados e logs apontam para a manifestação. A migração Prisma inicial contém chaves estrangeiras para esse grafo.

O identificador externo (`id_original`) é compatibilidade com Sheets; o ID interno do PostgreSQL não deve ser usado como protocolo público. Protocolos possuem unicidade própria e a reserva atômica está em `protocol_counter`/`protocol_reservation`.

## Regras de integridade

1. Cada domínio precisa de um identificador estável. Linhas sem ID são inelegíveis para uso operacional e devem aparecer no inventário como inconsistentes.
2. Empresa é normalizada apenas para comparação; o valor original permanece preservado. Registro sem empresa não pode participar de isolamento, similaridade ou reincidência.
3. `ATIVO=SIM` não significa aprovação operacional. Matriz exige ID, empresa, tipo, categoria, setor e procedimento; o motor ainda deve comparar os critérios com a manifestação.
4. Hipótese, causa confirmada, recomendação e tratativa executada são estados diferentes. Uma coluna de texto não pode promover um estado automaticamente.
5. Atualização parcial não deve escrever vazio para campos não enviados. A ausência de uma propriedade e a limpeza intencional precisam ser diferenciadas.
6. Histórico é append-only. Correções cadastrais devem registrar anterior, novo valor, usuário e data.
7. Relacionamentos entre empresas são inválidos salvo escopo global explicitamente cadastrado.
8. Modelos aprovados podem ser oferecidos para seleção; somente a decisão humana registra o uso efetivo.

## Divergências estruturais encontradas no repositório

- O código mantém leitura operacional de `MANIFESTACOES` no Sheets e possui um modelo relacional paralelo `manifestacoes` no Prisma. Isso é compatibilidade dual-write, não sincronização automática; qualquer reconciliação precisa comparar as chaves antes de importar.
- `prisma/migrations/20260930000001_init/migration_parte2.sql` repete as tabelas da migração `migration.sql`. O Prisma não executa arquivos fora do `migration.sql`, portanto o sidecar é um artefato de referência e não deve ser executado.
- O schema atual também mapeia `pesquisa_respostas`, `relatorios_sac` e `solicitacoes_acesso`, mas essas três tabelas não aparecem na migração inicial versionada. A origem real precisa ser confirmada no ambiente autorizado antes de qualquer baseline ou migração; este trabalho não cria essas tabelas.
- A Matriz aceita contrato canônico e legado (`ID_TRATAMENTO`/`TRATATIVA_OBRIGATORIA` e `ID_REGRA`/`TRATATIVA_PADRAO`). Os identificadores não podem ser misturados.
- O serviço Sheets possui operações de escrita e credencial com escopo de escrita. Inventários devem usar uma credencial/escopo `spreadsheets.readonly` separado; este trabalho não altera credenciais.

## Reorganização segura aplicada no código

`database/circaDataContract.js` concentra normalização de empresa, estados e validações sanitizadas para manifestações, matriz, histórico e modelos. O módulo é puro e não acessa serviços externos. `scripts/validate-circa-structure.js` compara o schema Prisma com o SQL versionado e aponta artefatos duplicados. Ambos podem ser usados em CI ou em inventário autorizado sem modificar banco ou planilha.

## O que ainda depende de autorização

Não foi criada migração de dados nem restrição nova no banco. Antes de adicionar `UNIQUE` para chaves legadas, remover aliases ou consolidar Sheets e PostgreSQL, é necessário executar inventário somente leitura, gerar backup/snapshot e aprovar um plano reversível. A migração deve ser criada somente depois de medir duplicidades reais; nenhum dado foi alterado nesta etapa.
