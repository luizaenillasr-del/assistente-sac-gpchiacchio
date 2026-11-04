# Migração planejada de tabelas auxiliares

`20261104_auxiliary_tables.sql` é um artefato de preparação. Ele não está no
diretório `prisma/migrations` e, portanto, não será executado por
`prisma migrate deploy`.

## Pré-validação somente leitura

Antes de executar, confirmar no banco de homologação/destino:

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('pesquisa_respostas', 'relatorios_sac', 'solicitacoes_acesso');

SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('pesquisa_respostas', 'relatorios_sac', 'solicitacoes_acesso')
ORDER BY table_name, ordinal_position;
```

Comparar o resultado com `prisma/schema.prisma`. Se a tabela existir com
estrutura diferente, interromper e preparar uma migração de compatibilidade;
`CREATE TABLE IF NOT EXISTS` não corrige colunas divergentes.

## Execução autorizada

1. Criar snapshot/backup e guardar o identificador.
2. Executar o arquivo em uma transação usando `DATABASE_URL_UNPOOLED`.
3. Consultar novamente tabelas, colunas, índices e contagens.
4. Registrar o resultado em auditoria.
5. Só então avaliar a inclusão de uma migração Prisma versionada.

## Reversão

Não existe `DROP TABLE` automático. A reversão só pode ser feita pelo
responsável pelo banco, após verificar no snapshot quais tabelas foram criadas
por esta operação e confirmar que estão vazias. Dados existentes nunca devem
ser removidos por um rollback genérico.
