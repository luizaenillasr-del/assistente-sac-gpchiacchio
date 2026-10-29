# Correção pontual do CIRCA — Matriz e histórico

## Escopo

Esta alteração parte da `main` após as PRs #448 e #449. Ela corrige apenas as
validações que impediam a base CIRCA de distinguir regras, tratamentos e casos
históricos incompletos. Nenhuma planilha, banco, protocolo ou anexo real foi
alterado.

## Matriz de tratamento

`ID_REGRA` identifica a regra que seleciona um tratamento. `ID_TRATAMENTO`
identifica o procedimento associado. O normalizador agora preserva ambos e não
usa um como substituto do outro.

Os contratos legado e canônico são validados separadamente. Uma regra ativa
canônica sem identificador, empresa, classificação, setor ou procedimento
obrigatório é inelegível. Uma regra ativa legada precisa de `ID_REGRA`, empresa,
tipo, setor, SLA, prioridade e tratamento padrão. Regras inativas continuam
preservadas, mas não são retornadas pelo motor.

A linha `MTR-MVR3OOD1WG5` se enquadra na decisão aprovada: deve permanecer
preservada e inativa. O código não a desativa remotamente. A operação pontual
autorizável é um update idempotente somente do campo `ATIVO`, condicionado à
identificação exata de `ID_REGRA` e à leitura do valor atual `SIM`:

```text
ler MATRIZ_TRATAMENTO;
localizar ID_REGRA = MTR-MVR3OOD1WG5;
se ATIVO == SIM, atualizar somente ATIVO = NAO;
registrar auditoria com linha, valor anterior e novo valor;
se ATIVO == NAO, concluir sem nova escrita;
se houver mais de uma linha, abortar.
```

Essa operação depende de autorização explícita para escrita na planilha e não
foi executada nesta PR.

## BANCO_HISTORICO

`HIST-0058` continua preservado como `STATUS_DADO=INCOMPLETO`. O CIRCA agora
exige identificador confiável, empresa e descrição antes de usar um histórico
para similaridade, reincidência ou hipótese de conhecimento. Registros sem
identificador ou com chave composta apenas de vazios e data também ficam fora
da deduplicação operacional. A chave original não é apagada nem reescrita.

Uma causa provável continua marcada como hipótese; nunca é promovida a causa
confirmada por esse fluxo.

## Testes

`tests/circa-data-integrity.js` cobre regra completa ativa, regra incompleta
ativa/inativa, separação dos identificadores, histórico completo/incompleto,
histórico sem empresa, deduplicação, isolamento entre empresas e preservação
de hipóteses. Os testes usam somente fixtures em memória.

Validações com Sheets, Neon e Drive reais continuam pendentes e exigem
ambiente autorizado. Não há homologação definitiva de produção nesta etapa.
