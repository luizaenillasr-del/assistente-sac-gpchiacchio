# Homologação funcional CIRCA — etapa final

## Evidência do inventário

Foi analisado o artefato sanitizado da execução `40865853333` do workflow
`Inventário CIRCA (somente leitura)`. Não foram lidos valores pessoais ou
relatos fora do relatório.

| Base | Resultado | Conclusão técnica |
| --- | --- | --- |
| `CAUSAS` | 0 registros | Catálogo vazio; não é preenchido automaticamente por hipóteses históricas. |
| `MATRIZ_TRATAMENTO` | 19 registros | Linha 20 sem ID/tratamento obrigatório e uma versão ausente. O relatório não contém os valores necessários para identificar a origem. |
| `BANCO_HISTORICO` | 95 registros | Linha 59 sem `DRV_EMPRESA_NORMALIZADA`; há campos de empresa original no contrato, mas o valor da linha não foi exposto no artefato. |
| `CEREBRO_APRENDIZADO` | 24 registros | Contrato real usa `ID_CASO`, `TIPO_DESCRICAO` e `CAUSA_RAIZ`; não possui `STATUS` operacional. |

### CAUSAS vazia

O endpoint `/api/causas/popular-historico` é uma operação explícita do SAC; não
há importação automática no fechamento ou na análise. O Cérebro usa causas do
histórico como `HIPOTESE_HISTORICA`, com `confirmada: false`. Assim, a base
vazia é uma consequência de governança, não uma perda de registros. Nenhuma
causa foi criada nesta etapa.

### Matriz, linha 20

O inventário confirma somente a ausência de `ID_TRATAMENTO` e
`TRATATIVA_OBRIGATORIA` na linha 20. Como o relatório é sanitizado, não é
possível afirmar se a linha é um rascunho, uma entrada legada ou um erro de
origem. O sistema continua usando aliases legados em memória e não completa ou
remove a linha.

### Histórico, linha 59

O inventário confirma somente a ausência de `DRV_EMPRESA_NORMALIZADA`. Embora
`ORIG_EMPRESA` exista no contrato, o valor da linha não está disponível no
artefato. A empresa não foi inferida nem sobrescrita. A correção exige revisão
humana do registro original ou uma consulta pontual autorizada.

### CEREBRO_APRENDIZADO

Os 24 registros são dados reais da base de aprendizado, mas o perfil antigo do
inventário esperava `ID_APRIMORAMENTO`, `DESCRICAO` e `STATUS`. O código agora
reconhece `ID_CASO` e `TIPO_DESCRICAO`, preserva a ausência de status e não a
trata como aprovado. Leituras exibem aliases normalizados; gravações usam o
contrato real somente quando todos os campos mínimos são conhecidos. Contratos
incompatíveis são recusados sem escrita.

## Correções realizadas

- Atualizado o perfil do inventário para reconhecer `ID_CASO` e
  `TIPO_DESCRICAO`.
- Adaptação de leitura da API para `CEREBRO_APRENDIZADO` sem inventar status.
- Aprendizado no fechamento mapeado para o contrato real (`ID_CASO`,
  `TIPO_DESCRICAO`, `CAUSA_RAIZ`, etc.), mantendo validação humana pendente.
- Criação/edição bloqueada quando a estrutura da aba não permite uma gravação
  segura.
- Adicionado teste HTTP de contrato real da aba.

## Homologação executada

Executados em ambiente isolado, com Sheets mock e sem banco/serviços reais:

- Nova manifestação, persistência, anexos pendentes e protocolo único.
- Consulta CIRCA determinística, isolamento por empresa e ausência de escrita.
- Matriz com campos legados e tratamento recomendado.
- Modelos aprovados de devolutiva.
- Hipóteses históricas sem promoção automática a causa confirmada.
- CEREBRO_APRENDIZADO reconhecido por `ID_CASO`/`TIPO_DESCRICAO`.
- Reincidência sem duplicação entre manifestação e histórico.
- Suíte visual com Chromium do sistema: Cérebro, relatório, navegação SPA e
  Nova Manifestação passaram.
- `npm test` completo: passou sem falhas; os testes de PostgreSQL foram
  pulados por ausência de `DATABASE_URL` no ambiente isolado.

Não foram executadas gravações em planilhas reais, migrações, alterações no
Neon ou deploy de produção.

## Pendências de decisão humana

1. Revisar os valores originais da linha 20 da matriz e decidir se deve ser
   corrigida, inativada ou mantida como legado.
2. Revisar o valor original da empresa na linha 59 do histórico antes de
   preencher `DRV_EMPRESA_NORMALIZADA`.
3. Definir se `CEREBRO_APRENDIZADO` receberá formalmente uma coluna de status
   em uma alteração planejada. Esta PR não cria essa coluna.
4. Executar os cenários de PostgreSQL/Sheets/Drive reais em homologação
   autorizada.

**Veredito: homologação isolada aprovada com ressalvas; produção bloqueada.**
O fluxo CIRCA está funcional no ambiente controlado, mas os dois registros
incompletos e a ausência de status no contrato real exigem decisão humana antes
de qualquer correção de dados ou publicação.
