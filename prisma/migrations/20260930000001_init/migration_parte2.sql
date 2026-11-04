CREATE TABLE "classificacoes" (
    "id" SERIAL NOT NULL,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "subcategoria" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "classificacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_configs" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "setor_id" INTEGER,
    "tipo_manifestacao" TEXT,
    "categoria" TEXT,
    "prazo_horas" INTEGER NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'HORAS',
    "condicoes" TEXT,
    "excecoes" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_ate" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sla_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifestacoes" (
    "id" SERIAL NOT NULL,
    "protocolo" TEXT NOT NULL,
    "id_original" TEXT,
    "empresa_id" INTEGER NOT NULL,
    "cliente_id" INTEGER,
    "setor_id" INTEGER,
    "responsavel_id" INTEGER,
    "usuario_criacao_id" INTEGER,
    "usuario_responsavel_id" INTEGER,
    "classificacao_id" INTEGER,
    "produto_id" INTEGER,
    "sla_config_id" INTEGER,
    "descricao" TEXT NOT NULL,
    "empresa_nome" TEXT NOT NULL,
    "contato" TEXT,
    "produto_nome" TEXT,
    "tipo" TEXT NOT NULL,
    "categoria" TEXT,
    "subcategoria" TEXT,
    "prioridade" TEXT NOT NULL DEFAULT 'Media',
    "risco" TEXT,
    "origem" TEXT,
    "canal" TEXT,
    "observacoes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "sla_horas" INTEGER,
    "data_abertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prazo_final" TIMESTAMP(3),
    "data_encerramento" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manifestacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manifestacao_historico" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "campo" TEXT NOT NULL,
    "valor_anterior" TEXT,
    "valor_novo" TEXT,
    "usuario_id" INTEGER,
    "motivo" TEXT,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manifestacao_historico_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reincidencias" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "manifestacao_origem_id" INTEGER,
    "cliente_id" INTEGER,
    "empresa_id" INTEGER,
    "tipo" TEXT,
    "categoria" TEXT,
    "produto" TEXT,
    "periodo" INTEGER,
    "nivel" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL DEFAULT 0,
    "fundamentacao" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reincidencias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tratativas" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "usuario_id" INTEGER,
    "setor_id" INTEGER,
    "diagnostico" TEXT,
    "sugestao_ia" TEXT,
    "texto_proposto" TEXT,
    "texto_final" TEXT,
    "prioridade" TEXT,
    "risco" TEXT,
    "prazo" TIMESTAMP(3),
    "necessita_aprovacao" BOOLEAN NOT NULL DEFAULT false,
    "aprovado_por" INTEGER,
    "aprovado_em" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "resultado" TEXT,
    "eficaz" BOOLEAN,
    "evidencia" TEXT,
    "observacoes" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tratativas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tratativa_acoes" (
    "id" SERIAL NOT NULL,
    "tratativa_id" INTEGER NOT NULL,
    "descricao" TEXT NOT NULL,
    "responsavel" TEXT,
    "prazo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "resultado" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tratativa_acoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devolutivas" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "tratativa_id" INTEGER,
    "usuario_id" INTEGER,
    "tipo" TEXT NOT NULL DEFAULT 'RECEBIMENTO',
    "texto_ia" TEXT,
    "texto_final" TEXT,
    "editada" BOOLEAN NOT NULL DEFAULT false,
    "motivo_edicao" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "aprovado_por" INTEGER,
    "aprovado_em" TIMESTAMP(3),
    "motivo_rejeicao" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "devolutivas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rncs" (
    "id" SERIAL NOT NULL,
    "id_original" TEXT,
    "protocolo" TEXT NOT NULL,
    "manifestacao_id" INTEGER,
    "empresa_id" INTEGER NOT NULL,
    "origem_tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "produto" TEXT,
    "setor" TEXT,
    "responsavel" TEXT,
    "prioridade" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ABERTA',
    "data_abertura" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "data_encerramento" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rncs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rnc_investigacoes" (
    "id" SERIAL NOT NULL,
    "rnc_id" INTEGER NOT NULL,
    "metodologia" TEXT,
    "causa_raiz" TEXT,
    "evidencias" TEXT,
    "responsavel" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rnc_investigacoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rnc_acoes" (
    "id" SERIAL NOT NULL,
    "rnc_id" INTEGER NOT NULL,
    "tipo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "responsavel" TEXT,
    "prazo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PENDENTE',
    "resultado" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rnc_acoes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rnc_eficacia" (
    "id" SERIAL NOT NULL,
    "rnc_id" INTEGER NOT NULL,
    "criterio" TEXT,
    "resultado" TEXT,
    "eficaz" BOOLEAN,
    "verificado_por" TEXT,
    "verificado_em" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rnc_eficacia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "politicas" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "setor_id" INTEGER,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ATIVA',
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_ate" TIMESTAMP(3),
    "responsavel" TEXT,
    "fonte" TEXT,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "politicas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procedimentos" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "setor_id" INTEGER,
    "titulo" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "vigente_desde" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vigente_ate" TIMESTAMP(3),
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "procedimentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regras" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER NOT NULL,
    "setor_id" INTEGER,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "condicao" TEXT,
    "acao" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "base_conhecimento" (
    "id" SERIAL NOT NULL,
    "setor_id" INTEGER,
    "empresa_id" INTEGER,
    "tipo" TEXT NOT NULL,
    "pergunta" TEXT,
    "resposta" TEXT NOT NULL,
    "tags" TEXT[],
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "base_conhecimento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos" (
    "id" SERIAL NOT NULL,
    "empresa_id" INTEGER,
    "setor_id" INTEGER,
    "politica_id" INTEGER,
    "titulo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "url" TEXT,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'ATIVO',
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matriz_tratamento" (
    "id" SERIAL NOT NULL,
    "id_original" TEXT,
    "empresa_id" INTEGER,
    "setor_id" INTEGER,
    "tipo_manifestacao" TEXT,
    "categoria" TEXT,
    "subcategoria" TEXT,
    "condicao" TEXT,
    "setor_responsavel" TEXT,
    "responsavel" TEXT,
    "prioridade" TEXT,
    "risco" TEXT,
    "tratativa_obrigatoria" TEXT,
    "tratativa_recomendada" TEXT,
    "tratativa_condicional" TEXT,
    "tratativa_nao_permitida" TEXT,
    "prazo_tratativa" INTEGER,
    "necessita_aprovacao" BOOLEAN NOT NULL DEFAULT false,
    "quem_aprova" TEXT,
    "necessita_evidencia" BOOLEAN NOT NULL DEFAULT false,
    "necessita_analise_tecnica" BOOLEAN NOT NULL DEFAULT false,
    "necessita_rnc" BOOLEAN NOT NULL DEFAULT false,
    "necessita_escalonamento" BOOLEAN NOT NULL DEFAULT false,
    "modelo_devolutiva" TEXT,
    "regras_devolutiva" TEXT,
    "informacoes_permitidas" TEXT,
    "informacoes_proibidas" TEXT,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "versao" INTEGER NOT NULL DEFAULT 1,
    "criada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizada_em" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matriz_tratamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resultados_tratamento" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "resultado" TEXT NOT NULL,
    "observacao" TEXT,
    "registrado_por" INTEGER,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resultados_tratamento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_ia" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER NOT NULL,
    "recomendacao_ia" TEXT,
    "decisao_humana" TEXT,
    "execucao" TEXT,
    "resultado" TEXT,
    "eficaz" BOOLEAN,
    "reincidente" BOOLEAN,
    "reaberta" BOOLEAN,
    "modelo_usado" TEXT,
    "tokens_entrada" INTEGER,
    "tokens_saida" INTEGER,
    "custo_estimado" DOUBLE PRECISION,
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_ia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_analises" (
    "id" SERIAL NOT NULL,
    "manifestacao_id" INTEGER,
    "protocolo" TEXT,
    "usuario_id" INTEGER,
    "versao_cerebro" TEXT,
    "tipo_detectado" TEXT,
    "setores" TEXT[],
    "similares_encontrados" INTEGER NOT NULL DEFAULT 0,
    "reincidencia" TEXT,
    "sla_status" TEXT,
    "confianca_nivel" TEXT,
    "confianca_score" INTEGER,
    "ia_disponivel" BOOLEAN NOT NULL DEFAULT false,
    "ia_modelo" TEXT,
    "ia_tokens_entrada" INTEGER,
    "ia_tokens_saida" INTEGER,
    "conflitos" INTEGER NOT NULL DEFAULT 0,
    "necessita_validacao" BOOLEAN NOT NULL DEFAULT false,
    "tempo_ms" INTEGER,
    "erros" TEXT[],
    "criado_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_analises_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "versoes_cerebro" (
    "id" SERIAL NOT NULL,
    "versao" TEXT NOT NULL,
    "descricao" TEXT,
    "ativa" BOOLEAN NOT NULL DEFAULT true,
    "lancada_em" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "versoes_cerebro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_codigo_key" ON "empresas"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "setores_empresa_id_codigo_key" ON "setores"("empresa_id", "codigo");

-- CreateIndex
CREATE UNIQUE INDEX "perfis_codigo_key" ON "perfis"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_email_key" ON "usuarios"("email");

-- CreateIndex
CREATE UNIQUE INDEX "manifestacoes_protocolo_key" ON "manifestacoes"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "rncs_protocolo_key" ON "rncs"("protocolo");

-- CreateIndex
CREATE UNIQUE INDEX "versoes_cerebro_versao_key" ON "versoes_cerebro"("versao");

-- AddForeignKey
ALTER TABLE "setores" ADD CONSTRAINT "setores_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_perfil_id_fkey" FOREIGN KEY ("perfil_id") REFERENCES "perfis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "responsaveis" ADD CONSTRAINT "responsaveis_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clientes" ADD CONSTRAINT "clientes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "produtos" ADD CONSTRAINT "produtos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_configs" ADD CONSTRAINT "sla_configs_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_configs" ADD CONSTRAINT "sla_configs_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_responsavel_id_fkey" FOREIGN KEY ("responsavel_id") REFERENCES "responsaveis"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_usuario_criacao_id_fkey" FOREIGN KEY ("usuario_criacao_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_usuario_responsavel_id_fkey" FOREIGN KEY ("usuario_responsavel_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_classificacao_id_fkey" FOREIGN KEY ("classificacao_id") REFERENCES "classificacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_produto_id_fkey" FOREIGN KEY ("produto_id") REFERENCES "produtos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacoes" ADD CONSTRAINT "manifestacoes_sla_config_id_fkey" FOREIGN KEY ("sla_config_id") REFERENCES "sla_configs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manifestacao_historico" ADD CONSTRAINT "manifestacao_historico_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reincidencias" ADD CONSTRAINT "reincidencias_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tratativas" ADD CONSTRAINT "tratativas_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tratativas" ADD CONSTRAINT "tratativas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tratativa_acoes" ADD CONSTRAINT "tratativa_acoes_tratativa_id_fkey" FOREIGN KEY ("tratativa_id") REFERENCES "tratativas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolutivas" ADD CONSTRAINT "devolutivas_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolutivas" ADD CONSTRAINT "devolutivas_tratativa_id_fkey" FOREIGN KEY ("tratativa_id") REFERENCES "tratativas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devolutivas" ADD CONSTRAINT "devolutivas_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rncs" ADD CONSTRAINT "rncs_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rncs" ADD CONSTRAINT "rncs_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rnc_investigacoes" ADD CONSTRAINT "rnc_investigacoes_rnc_id_fkey" FOREIGN KEY ("rnc_id") REFERENCES "rncs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rnc_acoes" ADD CONSTRAINT "rnc_acoes_rnc_id_fkey" FOREIGN KEY ("rnc_id") REFERENCES "rncs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rnc_eficacia" ADD CONSTRAINT "rnc_eficacia_rnc_id_fkey" FOREIGN KEY ("rnc_id") REFERENCES "rncs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politicas" ADD CONSTRAINT "politicas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "politicas" ADD CONSTRAINT "politicas_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedimentos" ADD CONSTRAINT "procedimentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procedimentos" ADD CONSTRAINT "procedimentos_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras" ADD CONSTRAINT "regras_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "regras" ADD CONSTRAINT "regras_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "base_conhecimento" ADD CONSTRAINT "base_conhecimento_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos" ADD CONSTRAINT "documentos_politica_id_fkey" FOREIGN KEY ("politica_id") REFERENCES "politicas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriz_tratamento" ADD CONSTRAINT "matriz_tratamento_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matriz_tratamento" ADD CONSTRAINT "matriz_tratamento_setor_id_fkey" FOREIGN KEY ("setor_id") REFERENCES "setores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resultados_tratamento" ADD CONSTRAINT "resultados_tratamento_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_ia" ADD CONSTRAINT "feedback_ia_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_analises" ADD CONSTRAINT "log_analises_manifestacao_id_fkey" FOREIGN KEY ("manifestacao_id") REFERENCES "manifestacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_analises" ADD CONSTRAINT "log_analises_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

