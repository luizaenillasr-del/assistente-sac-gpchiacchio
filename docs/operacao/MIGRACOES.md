# Migrações do banco

O `postinstall` executa somente `prisma generate`. A instalação de dependências não altera o banco e não pode apagar dados.

Antes de aplicar uma mudança, valide o schema:

```bash
npm run db:validate
```

Em um ambiente isolado ou de staging, aplique apenas migrações versionadas já revisadas:

```bash
npm run db:migrate:deploy
```

Os comandos exigem `DATABASE_URL` e `DATABASE_URL_UNPOOLED` configuradas no ambiente. A aplicação não executa `prisma db push --accept-data-loss` automaticamente. Migrações novas devem ser criadas e revisadas fora de produção, com backup e plano de reversão definidos antes da execução.
