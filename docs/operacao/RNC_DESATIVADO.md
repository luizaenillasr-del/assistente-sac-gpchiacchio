# Módulo RNC temporariamente desativado

O módulo de Registro de Não Conformidade está desativado enquanto as regras oficiais do setor responsável não forem fornecidas.

- A flag operacional é `RNC_ENABLED`, com padrão `false`.
- As rotas `/api/rnc`, `/api/rnc/:id/*` e `/api/rnc-metricas` respondem `503` com o código `RNC_DESATIVADO`.
- O código, tabelas, documentos e registros históricos permanecem preservados.
- O fluxo CIRCA continua usando investigação, causas, ações corretivas, conhecimento e auditoria sem exigir RNC.
- Para reativar, revisar as regras, testes e permissões antes de configurar `RNC_ENABLED=true`.
