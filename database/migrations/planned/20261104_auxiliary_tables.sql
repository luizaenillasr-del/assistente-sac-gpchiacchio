-- PLANEJADA — NÃO É MIGRAÇÃO AUTOMÁTICA DO PRISMA
-- Assistente SAC / CIRCA
--
-- Este arquivo só pode ser executado após inventário, snapshot e autorização
-- explícita do ambiente de destino. Ele não deve ser movido para
-- prisma/migrations sem revisão do histórico real.
-- A operação é aditiva e idempotente; não contém DROP/DELETE/TRUNCATE.

BEGIN;

CREATE TABLE IF NOT EXISTS "pesquisa_respostas" (
  "id" SERIAL PRIMARY KEY,
  "id_original" TEXT UNIQUE,
  "token" TEXT,
  "empresa" TEXT NOT NULL,
  "nome_cliente" TEXT,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "atendimento" INTEGER,
  "prazo_entrega" INTEGER,
  "qualidade" INTEGER,
  "recomendacao" INTEGER,
  "comentario" TEXT,
  "nota_media" DOUBLE PRECISION,
  "nota_baixa" BOOLEAN NOT NULL DEFAULT false,
  "status_ocp" TEXT,
  "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "pesquisa_respostas_empresa_idx" ON "pesquisa_respostas" ("empresa");

CREATE TABLE IF NOT EXISTS "relatorios_sac" (
  "id" SERIAL PRIMARY KEY,
  "id_original" TEXT UNIQUE,
  "chave" TEXT NOT NULL,
  "empresa" TEXT NOT NULL,
  "ano" TEXT NOT NULL,
  "mes" TEXT NOT NULL,
  "versao" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'RASCUNHO',
  "indicador" TEXT,
  "nps_score" TEXT,
  "textos_json" TEXT,
  "dados_json" TEXT,
  "link_token" TEXT,
  "criado_por" TEXT,
  "publicado_em" TIMESTAMP(3),
  "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "relatorios_sac_chave_idx" ON "relatorios_sac" ("chave");

CREATE TABLE IF NOT EXISTS "solicitacoes_acesso" (
  "id" SERIAL PRIMARY KEY,
  "id_solicitacao" TEXT UNIQUE NOT NULL,
  "nome" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "empresa" TEXT NOT NULL,
  "setor" TEXT NOT NULL,
  "cargo" TEXT NOT NULL,
  "telefone" TEXT,
  "justificativa" TEXT,
  "status" TEXT NOT NULL DEFAULT 'PENDENTE',
  "motivo_rejeicao" TEXT,
  "decidido_por" TEXT,
  "data_decisao" TIMESTAMP(3),
  "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "solicitacoes_acesso_status_idx" ON "solicitacoes_acesso" ("status");
CREATE INDEX IF NOT EXISTS "solicitacoes_acesso_email_idx" ON "solicitacoes_acesso" ("email");

COMMIT;
