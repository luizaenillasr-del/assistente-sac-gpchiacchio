# 10 — Relatório de Falhas Priorizadas
**Data:** 2026-11-03

---

## Legenda de Severidade

| Nível | Critério |
|---|---|
| **CRÍTICA** | Compromete segurança, integridade ou disponibilidade imediatamente |
| **ALTA** | Impacta operação, diagnóstico ou confiabilidade em produção |
| **MÉDIA** | Risco ou limitação funcional que deve ser corrigida |
| **BAIXA** | Melhoria de qualidade ou observabilidade |

---

## CRÍTICAS

### C1 — Matriz de Conhecimento sem Autenticação
**ID**: C1  
**Severidade**: CRÍTICA  
**Módulo**: `/api/matriz-conhecimento`  
**Descrição**: 12 rotas (GET, POST, PUT, DELETE e ações) do módulo de matriz de conhecimento não possuem nenhum middleware de autenticação ou autorização. Qualquer cliente HTTP pode ler e modificar a base de conhecimento sem login.  
**Impacto**: Exposição de dados internos, possibilidade de corrupção da base de conhecimento, deleção de entradas sem rastro.  
**Evidência**: Grep confirma ausência de `requerPerfil`/`requerPermissao` nas linhas 10329-10491 de `api/index.js`.  
**Correção**: Adicionar `requerPerfil('MASTER','ANALISTA SAC','APROVADOR')` (leitura) e `requerPerfil('MASTER','ANALISTA SAC')` (escrita/deleção) nas 12 rotas afetadas.

---

### C2 — `erroSeguro()` sem Logging Estruturado
**ID**: C2  
**Severidade**: CRÍTICA (operacional)  
**Módulo**: `api/index.js:1802`  
**Descrição**: Em produção, todos os erros retornam "Erro interno do servidor." sem qualquer referência rastreável. Não há logging estruturado associado que permita correlacionar o erro do usuário com o log do servidor.  
**Impacto**: Impossibilidade de diagnosticar falhas em produção sem acesso direto aos logs do servidor. Erros críticos de banco, autorização e lógica de negócio são indistinguíveis.  
**Evidência**: `function erroSeguro(e) { if (NODE_ENV==='production') return 'Erro interno do servidor.'; }`  
**Correção**: Adicionar logging estruturado com ID de correlação (ex: `console.error('[ERR]', correlationId, e)`) e retornar `{ erro: 'Erro interno', ref: correlationId }` para o cliente.

---

## ALTAS

### A1 — `PESQUISA_SPREADSHEET_ID` não configurada
**ID**: A1  
**Severidade**: ALTA  
**Módulo**: Módulo de pesquisas  
**Descrição**: A variável `PESQUISA_SPREADSHEET_ID` não está definida no ambiente de testes. O sistema usa uma planilha de fallback hardcoded no código. Se isso ocorrer em produção, respostas de pesquisas podem ser gravadas em uma planilha incorreta.  
**Evidência**: `[AVISO C5] PESQUISA_SPREADSHEET_ID não configurada — módulo de pesquisas usará planilha de fallback hardcoded.`  
**Correção**: Definir `PESQUISA_SPREADSHEET_ID` como variável obrigatória (exit se ausente em produção), igual a `SPREADSHEET_ID`.

---

### A2 — `AI_PROVIDER` não configurada explicitamente
**ID**: A2  
**Severidade**: ALTA  
**Módulo**: `aiService.js`  
**Descrição**: Se `AI_PROVIDER` não for definida, o sistema usa OpenAI como padrão mas emite aviso. Risco: mudança de provedor acidental se a variável for alterada ou removida.  
**Evidência**: `[AVISO C1] AI_PROVIDER não definida — usando padrão openai.`  
**Correção**: Definir `AI_PROVIDER=openai` explicitamente em produção.

---

### A3 — PostgreSQL offline falha silenciosamente
**ID**: A3  
**Severidade**: ALTA  
**Módulo**: Busca de similares, base de conhecimento  
**Descrição**: Quando PG está offline, `buscarParaSimilaridade` lança erro `Cannot read properties of null (reading 'manifestacao')` — o erro é logado mas a operação falha silenciosamente com fallback para Sheets ou retorno vazio. O usuário não sabe que a funcionalidade está degradada.  
**Evidência**: `[PG] buscarParaSimilaridade falhou (PG offline?): Cannot read properties of null (reading 'manifestacao')`  
**Correção**: Validar `conhecimentoRepo !== null` antes de acesso a propriedades; retornar estado de degradação na resposta (`{ fonte: 'degradado', motivo: '...' }`).

---

### A4 — Dual-write sem sincronização garantida
**ID**: A4  
**Severidade**: ALTA  
**Módulo**: Persistência geral  
**Descrição**: Dados são escritos em Google Sheets e PostgreSQL em momentos diferentes, sem transação distribuída. Uma falha entre as duas escritas deixa os bancos inconsistentes.  
**Impacto**: Dados em Sheets podem diferir dos dados em PG, causando comportamento diferente dependendo de qual fonte é consultada.  
**Correção**: Definir fonte autoritativa por tipo de dado; implementar reconciliação periódica ou migrar para single-source-of-truth.

---

## MÉDIAS

### M1 — Cache 60s pode servir dados desatualizados
**ID**: M1  
**Severidade**: MÉDIA  
**Módulo**: `lerAba()` — cache em memória  
**Descrição**: Abas não-críticas têm TTL de 60s. Escritas nessas abas não invalidam o cache. Leituras subsequentes podem ver dados da versão anterior por até 60s.  
**Impacto**: Configurações de setor, SLA, FAQ podem aparecer desatualizados brevemente após edição.  
**Correção**: Chamar `invalidarCacheAba(nome)` após escritas em abas com TTL>0.

---

### M2 — Arquivo único `api/index.js` com 12.204 linhas
**ID**: M2  
**Severidade**: MÉDIA (manutenibilidade)  
**Módulo**: `api/index.js`  
**Descrição**: Toda a lógica do servidor está em um único arquivo de 12.204 linhas. Dificulta revisão, teste unitário de funções individuais, e aumenta risco de conflitos de merge.  
**Impacto**: Manutenção lenta, risco de regressão ao editar qualquer parte do arquivo.  
**Correção**: Refatoração progressiva para extrair grupos de rotas em arquivos separados (ex: `routes/manifestacoes.js`, `routes/circa.js`). Não urgente, mas importante para sustentabilidade.

---

### M3 — `USUARIOS_JSON` como env var
**ID**: M3  
**Severidade**: MÉDIA  
**Módulo**: Autenticação  
**Descrição**: Usuários podem ser definidos via `USUARIOS_JSON` — JSON hardcoded em variável de ambiente. Senhas em texto plano ou hash dependem da implementação.  
**Correção**: Verificar se senhas em `USUARIOS_JSON` são hashadas; preferir criar usuários via banco de dados.

---

### M4 — SLA sem alertas automáticos
**ID**: M4  
**Severidade**: MÉDIA  
**Módulo**: SLA  
**Descrição**: O sistema calcula SLA corretamente (OK/Alerta/Vencido) mas não envia alertas automáticos por e-mail ou notificação quando o prazo está em risco.  
**Impacto**: Responsáveis precisam verificar ativamente o painel para identificar SLAs críticos.  
**Correção**: Implementar job periódico (ou verificação no acesso) que envia e-mail quando SLA entra em Alerta ou Vencido.

---

### M5 — `DRIVE_FOLDER_ID` ausente silencia upload de anexos
**ID**: M5  
**Severidade**: MÉDIA  
**Módulo**: Anexos  
**Descrição**: Se `DRIVE_FOLDER_ID` não estiver configurada, uploads de anexos falham silenciosamente com log de aviso.  
**Evidência**: `[ANEXOS] upload pendente: Google Drive indisponível: GOOGLE_CREDENTIALS não configurada`  
**Correção**: Retornar erro explícito ao usuário quando Drive não está disponível, em vez de silenciar.

---

### M6 — WhatsApp webhook sem validação HMAC
**ID**: M6  
**Severidade**: MÉDIA  
**Módulo**: WhatsApp  
**Descrição**: `POST /api/public/whatsapp/webhook` não valida a assinatura HMAC do payload, exigida pela API WhatsApp Business.  
**Impacto**: Qualquer cliente pode injetar mensagens falsas no sistema.  
**Correção**: Implementar validação `x-hub-signature-256` com a `WHATSAPP_APP_SECRET`.

---

## BAIXAS

### B1 — SESSION_SECRET aleatório em desenvolvimento
**ID**: B1  
**Severidade**: BAIXA  
**Módulo**: Autenticação  
**Descrição**: Sem `SESSION_SECRET` definida, sistema usa `crypto.randomBytes(32)`. Sessões são invalidadas a cada restart.  
**Correção**: Definir `SESSION_SECRET` fixo no `.env.local` de desenvolvimento.

---

### B2 — Bootstrap endpoint sem proteção documentada
**ID**: B2  
**Severidade**: BAIXA  
**Módulo**: `POST /api/bootstrap`  
**Descrição**: Endpoint `POST /api/bootstrap` não tem middleware de autenticação visível. Se o handler interno não valida uma chave secreta, qualquer cliente pode disparar um seed/inicialização.  
**Correção**: Verificar se `bootstrapHandler` valida token/chave; se não, adicionar `requerPerfil('MASTER')`.

---

### B3 — `relatorio-satisfacao.js` com timeout
**ID**: B3  
**Severidade**: BAIXA  
**Módulo**: Testes  
**Descrição**: Suíte `relatorio-satisfacao.js` excedeu 120s de timeout durante a auditoria — resultado não capturado.  
**Correção**: Investigar causa do timeout; adicionar timeout explícito no teste ou otimizar operação.

---

### B4 — Demo login pode ser habilitado em produção
**ID**: B4  
**Severidade**: BAIXA  
**Módulo**: Autenticação  
**Descrição**: Se `DEMO_LOGIN_ENABLED=true` em produção, sistema avisa mas não bloqueia completamente. Risco de logins de demonstração em ambiente real.  
**Evidência**: `if (DEMO_LOGIN_ENABLED && NODE_ENV==='production') console.warn(...)` — sem exit().  
**Correção**: `process.exit(1)` se `DEMO_LOGIN_ENABLED=true` em produção.

---

## Sumário Executivo de Falhas

| ID | Severidade | Status | Módulo |
|---|---|---|---|
| C1 | CRÍTICA | Aberto | Matriz conhecimento |
| C2 | CRÍTICA | Aberto | erroSeguro/logging |
| A1 | ALTA | Aberto | Pesquisas |
| A2 | ALTA | Aberto | AI_PROVIDER |
| A3 | ALTA | Aberto | PG/Similares |
| A4 | ALTA | Aberto | Dual-write |
| M1 | MÉDIA | Aberto | Cache |
| M2 | MÉDIA | Aberto | Monolito |
| M3 | MÉDIA | Aberto | USUARIOS_JSON |
| M4 | MÉDIA | Aberto | SLA |
| M5 | MÉDIA | Aberto | Anexos |
| M6 | MÉDIA | Aberto | WhatsApp |
| B1 | BAIXA | Aberto | Sessão dev |
| B2 | BAIXA | Aberto | Bootstrap |
| B3 | BAIXA | Aberto | Teste timeout |
| B4 | BAIXA | Aberto | Demo login |

**2 Críticas · 4 Altas · 5 Médias · 4 Baixas = 15 falhas total**
