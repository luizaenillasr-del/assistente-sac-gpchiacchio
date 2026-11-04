# Migrações de reconciliação de dados

Esta pasta é reservada a migrações de dados aprovadas. Nenhuma migração foi criada ou executada nesta etapa porque não houve acesso autorizado ao conteúdo de produção.

Fluxo obrigatório para uma futura migração:

1. Executar inventário somente leitura e salvar relatório sanitizado.
2. Criar snapshot/backup no provedor do banco e registrar o identificador.
3. Medir duplicidades por cada chave candidata (`id_original`, IDs das abas e protocolo).
4. Preparar script idempotente em transação, com tabela de auditoria e operação inversa documentada.
5. Testar em uma cópia isolada usando os mesmos nomes de colunas e tipos.
6. Obter autorização explícita para o ambiente de destino.
7. Executar com `DATABASE_URL_UNPOOLED`, validar contagens e relações e guardar o log.

Não use `db push`, `migrate reset` ou scripts que excluam/mesclem registros automaticamente. A ausência de uma restrição no schema não autoriza deduplicação por aproximação.
