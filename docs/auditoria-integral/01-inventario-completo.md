# 01 — Inventário Completo do Repositório
**Data:** 2026-11-03

---

## 1. Arquivos Principais

| Arquivo | Linhas | Função |
|---|---|---|
| `api/index.js` | 12.204 | Servidor Express completo — todas as rotas, middleware, utilitários |
| `api/perfil-profissional.js` | — | Endpoint de perfil profissional (separado) |
| `prisma/schema.prisma` | ~400 | Schema PostgreSQL via Prisma ORM |
| `package.json` | 36 | Dependências, scripts |
| `public/index.html` | — | SPA principal |
| `public/fichas.html` | — | Biblioteca de fichas |
| `public/portal.html` | — | Portal do cliente |

---

## 2. Server-Services (módulos)

| Módulo | Linhas | Responsabilidade |
|---|---|---|
| `aiService.js` | 145 | Integração com IA (OpenAI/Anthropic) |
| `assertividadeService.js` | 261 | Métricas de assertividade das análises |
| `cerebroServices.js` | 1.215 | Base de conhecimento, causas, tratamentos, devolutivas |
| `circaEngine.js` | 243 | Motor de análise e complementações CIRCA |
| `circaWorkflow.js` | 113 | Workflow CIRCA — 7 etapas, transições de status |
| `dashboardExecutiva.js` | 180 | Dashboard executivo consolidado |
| `devolutivaEngine.js` | 371 | Geração e aprovação de devolutivas |
| `etapa2Validacao.js` | 89 | Validações da Etapa 2 de complementações |
| `fichaUnica.js` | 69 | Ficha única de manifestação |
| `matrizConhecimentoService.js` | 547 | CRUD da matriz de conhecimento |
| `matrizTratamentoService.js` | 265 | Matriz de tratamentos |
| `pdfFicha.js` | 240 | Geração de PDF da ficha |
| `pdfRelatorioSatisfacao.js` | 46 | PDF de relatório de satisfação |
| `permissoesService.js` | 161 | Serviço de permissões e controle de acesso |
| `pesquisaFormulariosService.js` | 950 | Formulários de pesquisa de satisfação |
| `portalConsulta.js` | 154 | Consulta pública de protocolos |
| `portalEndereco.js` | 48 | Endereço público do portal |
| `protocoloAtomico.js` | 112 | Geração atômica de protocolos (evita duplicidade) |
| `sheets.js` | 170 | Funções de acesso ao Google Sheets |
| `tratativaEngine.js` | 423 | Motor de tratativas setoriais |
| `documentService/` | — | Extração de documentos DOCX/PDF |
| **Total** | **5.802** | |

---

## 3. Rotas da API (314 registradas)

### 3.1 Autenticação e Sessão
- `POST /api/auth/login` — Login com usuário/senha
- `GET /api/auth/me` — Usuário autenticado atual
- `POST /api/auth/refresh` — Renovar sessão
- `POST /api/auth/completar-primeiro-acesso` — Definir senha no primeiro acesso
- `POST /api/auth/forgot-password` — Recuperação de senha
- `POST /api/auth/reset-password` — Reset de senha com token
- `GET /api/auth/permissoes` — Permissões do usuário atual

### 3.2 Usuários e Perfis
- `GET /api/usuarios` — Listar usuários (ver nota de segurança)
- `POST /api/usuarios` — Criar usuário
- `PATCH /api/usuarios/:id` — Editar usuário
- `DELETE /api/usuarios/:id` — Excluir (lógico)
- `POST /api/usuarios/:id/bloquear|desbloquear|desativar|ativar`
- `POST /api/usuarios/:id/permissoes` — Definir permissões individuais
- `GET /api/meu-perfil` / `PATCH /api/meu-perfil`
- `GET /api/perfis/especialistas` / `GET /api/perfis/colaboradores`

### 3.3 Manifestações (core)
- `GET /api/manifestacoes` — Listar com filtros
- `POST /api/manifestacoes` — Criar nova
- `GET /api/manifestacoes/:id` — Buscar por ID
- `PATCH /api/manifestacoes/:id` — Editar campos
- `PATCH /api/manifestacoes/:id/ficha` — Editar ficha
- `DELETE /api/manifestacoes/:id` — Exclusão lógica (MASTER)
- `POST /api/manifestacoes/:id/restaurar`
- `POST /api/manifestacoes/:id/decisao` — Decisão de aprovação
- `POST /api/manifestacoes/:id/decisao-sac`
- `GET /api/manifestacoes/:id/aprovacao` / `POST`
- `POST /api/manifestacoes/:id/encaminhamentos`
- `PUT /api/manifestacoes/:id/impacto-financeiro`
- `POST /api/manifestacoes/:id/execucao`
- `POST /api/manifestacoes/:id/validacao-sac`
- `POST /api/manifestacoes/:id/finalizar`
- `GET /api/manifestacoes/:id/historico`
- `GET /api/manifestacoes/:id/pdf`
- `GET /api/manifestacoes-excluidas` (MASTER)
- `POST /api/manifestacoes/excluir-lote` (MASTER)

### 3.4 CIRCA
- `GET /api/manifestacoes/:id/circa` — Dados CIRCA
- `PATCH /api/manifestacoes/:id/circa-dados` — Salvar complementações (CORRIGIDO em PR #482)
- `POST /api/manifestacoes/:id/transicao-circa` — Transição de etapa
- `GET /api/manifestacoes/:id/acionamentos` / `POST` / `PATCH /:acionamentoId`

### 3.5 Tratativa e Devolutiva
- `GET /api/manifestacoes/:id/tratativa` / `POST .../gerar` / `POST .../decisao`
- `GET /api/manifestacoes/:id/devolutivas` / `POST .../gerar` / `POST .../aprovar` / `POST .../enviar`
- `GET /api/manifestacoes/:id/tratativa-completa`
- `GET /api/manifestacoes/:id/tratativas-setoriais` / `POST` / `PUT /:idTrat`
- `POST /api/devolutivas/:idDev/decisao`

### 3.6 Análise e Similares
- `POST /api/analise` — Análise IA de manifestação
- `POST /api/analise/similares` — Busca similares
- `GET /api/manifestacoes/:id/analise` / `GET .../sugestoes` / `POST .../sugestoes`
- `POST /api/assertividade-ia`
- `GET /api/assertividade/metricas` / `GET .../sugestoes` / `POST .../resultado`

### 3.7 Setores e Cadastros
- `POST /api/setores` / `PATCH /:id` / `DELETE /:id` / `POST .../importar`
- `GET /api/setores/:setor/operacional` / `PATCH`
- `GET/POST /api/setores/:setor/faq|regras|procedimentos|politicas`
- `GET /api/cadastros/:tipo` / `POST` / `PATCH /:id` / `POST .../importar`
- `GET /api/produtos` / `POST .../importar`

### 3.8 Conhecimento e Cérebro
- `GET /api/cerebro/scan`
- `GET /api/cerebro/matriz-operacional`
- `GET /api/cerebro/causas/consultar` / `POST /api/cerebro/causas` / `PATCH /:id` / `DELETE /:id`
- `POST /api/cerebro/tratamentos` / `PATCH /:id` / `DELETE /:id`
- `POST /api/cerebro/aprimoramentos` / `PATCH /:id`
- `GET /api/cerebro/devolutivas` / `POST .../modelos` / `PATCH .../modelos/:id` / `POST .../modelos/:id/status`
- `GET /api/matriz-conhecimento` ⚠️ **SEM AUTH**
- `GET/POST /api/matriz-conhecimento/:id` ⚠️ **SEM AUTH**
- `PUT /api/matriz-conhecimento/:id` ⚠️ **SEM AUTH**
- `POST /api/matriz-conhecimento/:id/status|itens|evidencias|excecoes` ⚠️ **SEM AUTH**
- `DELETE /api/matriz-conhecimento/:id/itens|evidencias|excecoes` ⚠️ **SEM AUTH**
- `POST /api/matriz-conhecimento/resolver` ⚠️ **SEM AUTH**
- `GET /api/causas` / `POST` / `PATCH /:id` / `POST .../popular-historico`
- `GET /api/matriz-tratamento` / `POST .../consultar` / `POST` / `PATCH /:id`
- `GET /api/matriz` / `PATCH /:id`
- `GET /api/politicas` / `POST`
- `GET /api/procedimentos` / `POST`

### 3.9 Pesquisas de Satisfação
- `GET /api/pesquisas/resumo` / `GET .../relatorio` / `GET .../ocorrencias` / `GET .../questionario`
- `POST /api/pesquisas/resposta-manual|media-historica|relatorio-texto|decisao|resposta-publica|resposta-portal|resposta-token`
- `DELETE /api/pesquisas/respostas/:id`
- `PATCH /api/pesquisas/respostas/:id/analise`
- `GET /api/pesquisas/tokens` / `POST .../gerar` / `POST .../tokens/:token/abrir`
- `POST /api/pesquisas/ocorrencias` / `PATCH /:id` / `POST /:id/decisao`
- `GET /api/questionarios/:empresa` / `POST` / `POST .../publicar`
- Rotas públicas com `publicRateLimit`: `/api/pesquisas/resposta-publica`, `/pesquisa/:token`, `/api/pesquisa/:token`

### 3.10 Relatórios
- `GET /api/relatorios/lista|metas`
- `POST /api/relatorios/gerar|metas`
- `POST /api/relatorios/:id/submeter-revisao|publicar|nova-versao|link|enviar`
- `GET /api/relatorios/:id/pdf|envios`
- `GET /relatorio-publico/:token` — público sem auth (somente leitura via token)

### 3.11 Biblioteca de Fichas
- `GET /api/biblioteca/fichas` / `GET .../stats` / `GET .../fichas/:id`
- `POST /api/biblioteca/fichas/:id/evidencias|regenerar-pdf|arquivar|desarquivar`
- `PATCH /api/biblioteca/fichas/:id`
- `POST /api/biblioteca/importar-ficha`
- `POST /api/biblioteca/sincronizar-base`

### 3.12 Aprovação e Fila
- `GET /api/aprovadores` / `GET .../pendencias`
- `GET /api/setor/minhas-pendencias`
- `GET /api/fila-aprovacao` / `POST` / `POST /:id/decidir`
- `GET /api/historico-aprovacao`
- `GET /api/aprovadores-admin` / `POST` / `PUT /:id`
- `GET /api/regras-aprovacao` / `POST` / `PUT /:id`
- `GET /api/competencias-lista` / `POST`
- `POST /api/aprovador-competencias` / `DELETE /:id`

### 3.13 Admin e Configuração
- `GET/POST /api/admin/solicitacoes` / `GET /:id` / `POST /:id/rejeitar|aprovar`
- `GET /api/admin/usuarios` / `GET /:id` / `PATCH /:id/permissoes`
- `POST /api/admin/usuarios/:id/ativar|desativar`
- `GET /api/admin/auditoria-acesso`
- `GET /api/admin/config-permissoes`
- `GET /api/configuracoes` / `PUT`
- `GET /api/portal-admin/visao-geral|config|historico`
- `POST /api/portal-admin/config`
- `GET /api/config/whatsapp|status` / `POST /api/config/whatsapp`
- `GET /api/log-sistema`
- `GET /api/auditoria`
- `POST /api/bootstrap`

### 3.14 Canais e Integrações
- `GET /api/public/whatsapp` / webhook GET/POST
- `GET /api/public/protocolo/:protocolo` / `POST .../consultar`
- `GET /api/public/empresas`
- `POST /api/public/reclamacoes` — reclamação pública
- `POST /api/public/solicitar-acesso`
- `GET /api/public/pesquisas-ativas`
- Portal: `GET /portal`

### 3.15 Planilha e Importação
- `GET /api/planilha/abas|ler` / `GET ./:aba` / `GET ./:aba/cabecalhos` / `POST ./:aba/importar`
- `GET /api/alimentacao/status|historico|pendencias`
- `POST /api/alimentacao/upload-docx|analisar|confirmar`
- `POST /api/importacao/iniciar` / `GET .../historico` / `POST /:id/desfazer` / `GET .../pendencias`

### 3.16 Outros
- `GET /api/health` — health check público
- `GET /` — serve SPA
- `GET /api/dashboard-resumo`
- `GET /api/notificacoes/analista` / `POST /:id/lida`
- `GET /api/painel-maquina`
- `GET /api/sla` / `GET /api/tipos` / `GET /api/validacoes`
- `GET /api/caso/:fonte/:id` / `POST /api/caso-similar/usar-referencia`
- `GET /api/sugestoes-melhoria` / `POST` / `PATCH /:id`
- `GET /api/cliente-contexto`
- `GET /api/representantes/meus-clientes|minhas-manifestacoes` / `POST .../manifestacoes`
- `POST /api/ia/extrair-setor`
- `GET /api/calculadora/prazos-regionais`
- RNC: `POST /api/rnc/:id/enviar|aprovar|devolver|encerrar` / `PATCH /:id`

---

## 4. Variáveis de Ambiente

| Variável | Obrigatória | Finalidade |
|---|---|---|
| `SPREADSHEET_ID` | ✅ Sim | ID da planilha principal Google Sheets |
| `GOOGLE_CREDENTIALS` | ✅ Sim | JSON de credenciais Google API |
| `SESSION_SECRET` | ✅ Sim (≥32 chars) | Segredo de sessão JWT |
| `DATABASE_URL` | ✅ Sim (PG) | Conexão PostgreSQL pooled (Prisma) |
| `DATABASE_URL_UNPOOLED` | ✅ Sim (PG) | Conexão PostgreSQL direta |
| `RESEND_API_KEY` | Recomendada | Envio de e-mails transacionais |
| `EMAIL_FROM` | Opcional | Remetente padrão dos e-mails |
| `APP_URL` | Opcional | URL base da aplicação |
| `PORTAL_PUBLIC_URL` | Opcional | URL pública do portal do cliente |
| `DRIVE_FOLDER_ID` | Opcional | Pasta no Google Drive para anexos |
| `AI_PROVIDER` | Recomendada | Provedor de IA (deve ser `openai`) |
| `ANTHROPIC_API_KEY` | Condicional | Chave Anthropic (se AI_PROVIDER=anthropic) |
| `OPENAI_API_KEY` | Condicional | Chave OpenAI (se AI_PROVIDER=openai) |
| `PESQUISA_SPREADSHEET_ID` | ⚠️ Recomendada | Planilha de pesquisas (usa fallback hardcoded se ausente) |
| `PESQUISA_NOTA_CRITICA` | Opcional | Threshold de nota crítica (padrão: 6) |
| `RNC_ENABLED` | Opcional | Habilitar módulo RNC (padrão: false) |
| `DEMO_LOGIN_ENABLED` | Nunca em produção | Logins demo (deve estar false) |
| `USUARIOS_JSON` | Opcional | Usuários hardcoded em JSON |
| `PG_LEITURA_ATIVA` | Opcional | Habilitar leitura PostgreSQL (padrão: true) |
| `SHEETS_MOCK_PATH` | Testes | Caminho do mock de Sheets para testes |
| `NODE_ENV` | Recomendada | `production` para ocultar erros detalhados |

---

## 5. Dependências (npm)

| Pacote | Versão | Uso |
|---|---|---|
| `express` | ^4.21.2 | Framework HTTP |
| `@prisma/client` | ^5.22.0 | ORM PostgreSQL |
| `prisma` | ^5.22.0 | CLI Prisma |
| `pg` | ^8.23.1 | Driver PostgreSQL direto |
| `bcryptjs` | ^3.0.3 | Hash de senhas |
| `googleapis` | ^144.0.0 | Google Sheets, Drive, Gmail API |
| `resend` | ^6.32.0 | E-mail transacional |
| `pdfkit` | ^0.20.2 | Geração de PDFs |
| `busboy` | ^1.6.0 | Upload multipart |
| `adm-zip` | ^0.6.1 | Manipulação de arquivos ZIP |
| `compression` | ^1.8.2 | Compressão HTTP |
| `cors` | ^2.8.5 | CORS headers |
| `playwright` | ^1.64.1 | Testes de browser (dev) |

---

## 6. Modelos Prisma (PostgreSQL)

Modelos identificados no schema:
- `Empresa` — empresas do grupo (CHIACCHIO, PLASCHIO, TUBAHIA)
- `Setor` — setores por empresa
- `Perfil` — perfis de acesso
- `Usuario` — usuários com perfil e permissões
- `Manifestacao` — manifestações/reclamações
- `Rnc` — registros de não-conformidade
- `Politica`, `Procedimento`, `Regra` — base normativa
- `SlaConfig` — configurações de SLA
- `MatrizTratamento` — matriz de tratamentos
- `Documento` — documentos relacionados
- `Produto` — catálogo de produtos
- `Setor.BaseConhecimento` — base de conhecimento setorial
- `Responsavel` — responsáveis por setor

---

## 7. Suítes de Teste (40+)

| Arquivo | Resultado |
|---|---|
| `foundation-safety.js` | ✅ PASS |
| `circa-nova-manifestacao.js` | ✅ PASS |
| `circa-confirmacao-complementacoes.js` | ✅ PASS (8 testes) |
| `nova-manifestacao-correcao.js` | ✅ PASS |
| `portal-isolamento.js` | ✅ PASS (11 testes) |
| `behavior.js` | ✅ PASS (78 testes) |
| `suite.js` | ✅ PASS (63 pass, 3 skip) |
| `relatorio-metas.js` | ✅ PASS |
| `circa.js` | ✅ PASS |
| `circa-knowledge.js` | ✅ PASS (com aviso de fallback) |
| `circa-learning-contract.js` | ✅ PASS |
| `circa-data-integrity.js` | ✅ PASS |
| `circa-producao-regressao.js` | ✅ PASS |
| `circa-design.js` | ✅ PASS |
| `circa-integration.js` | ✅ PASS |
| `canais-integracao.js` | ✅ PASS |
| `admin-usuarios.js` | ✅ PASS |
| `fase1-operacional.js` | ✅ PASS |
| `fase2-integracoes.js` | ✅ PASS |
| `fase4-central.js` | ✅ PASS |
| `interface-usuarios-arquivo.js` | ✅ PASS (3 testes) |
| `arquivo-fichas-v3.js` | ✅ PASS |
| `ficha-manifestacao-v2.js` | ✅ PASS (3 testes) |
| `nova-manifestacao-v4.js` | ✅ PASS |
| `rnc-disabled.js` | ✅ PASS |
| `pesquisas.js` | ✅ PASS (22 testes) |
| `cerebro.js` | ✅ PASS |
| `navigation-pages.js` | ✅ PASS |
| `protocolo-atomico.js` | ✅ PASS |
| `leraba-coluna-larga.js` | ✅ PASS |
| `relatorio-satisfacao.js` | ⏳ Em execução (timeout 120s) |

---

## 8. Integrações Externas

| Serviço | Uso | Status |
|---|---|---|
| Google Sheets | Banco de dados principal de manifestações | ✅ Ativo |
| Google Drive | Upload de evidências/anexos | ⚠️ Condicional (DRIVE_FOLDER_ID) |
| PostgreSQL (Neon) | Banco relacional secundário | ✅ Ativo (offline em testes) |
| OpenAI API | Análise IA, extração de campos | ✅ Ativo (configurar AI_PROVIDER) |
| Resend | E-mail transacional | ⚠️ Condicional (RESEND_API_KEY) |
| WhatsApp | Canal de entrada via webhook | ✅ Rotas configuradas |
