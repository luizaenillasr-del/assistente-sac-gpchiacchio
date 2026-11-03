# 02 — Matriz de Acessos e Permissões
**Data:** 2026-11-03

---

## 1. Perfis Canônicos

| Perfil | Nível | Escopo |
|---|---|---|
| `MASTER` | Máximo | Acesso total ao sistema |
| `APROVADOR MASTER` | Alto | Aprovação, relatórios, devolutivas |
| `GESTOR SAC` | Alto | Gestão operacional do SAC |
| `ANALISTA SAC` | Médio-Alto | Análise, tratativas, relatórios |
| `ATENDENTE SAC` | Médio | Abertura, acompanhamento |
| `SETOR RESPONSÁVEL` | Médio | Investigação setorial |
| `ESPECIALISTA` | Médio | Análise especializada |
| `APROVADOR` | Médio | Aprovação de devolutivas |
| `RCA / REPRESENTANTE` | Restrito | Manifestações dos seus clientes |
| `DIRETOR` | Consulta | Dashboards, relatórios |
| `SETOR DIRETORIA` | Consulta | Relatórios de diretoria |
| `VISUALIZADOR` | Consulta | Somente leitura |
| `AUDITOR` | Consulta | Auditoria e logs |
| `CONSULTA` | Mínimo | Consultas básicas |

---

## 2. Middleware de Autenticação

### `requerPerfil(...perfis)` (linha ~1970 de api/index.js)
Verifica se `req.usuario.PERFIL` está na lista de perfis permitidos.

### `requerPermissao(permissao)` (linha ~1980)
Verifica se o usuário tem a permissão específica no campo `PERMISSOES` (JSON).

### `middlewareEscopoEmpresa()` (linha ~530)
Isola queries por `EMPRESA_RECLAMADA` do usuário — impede cross-company data leak.

### `middlewareEscopoSetor()` (linha ~560)
Isola queries pelo setor do usuário — aplicado em rotas setoriais.

---

## 3. Rotas Públicas (sem autenticação)

| Rota | Proteção | Observação |
|---|---|---|
| `GET /api/health` | Nenhuma | Aceitável — health check |
| `GET /` | Nenhuma | Serve SPA — aceitável |
| `GET /portal` | Nenhuma | Portal do cliente — aceitável |
| `POST /api/auth/login` | Nenhuma | Login — necessário |
| `POST /api/auth/forgot-password` | Nenhuma | Recuperação — necessário |
| `POST /api/auth/reset-password` | Nenhuma | Reset — necessário |
| `GET /api/portal/endereco` | Nenhuma | Endereço do portal — aceitável |
| `GET /relatorio-publico/:token` | Token no path | OK — token é a auth |
| `POST /api/pesquisas/resposta-publica` | publicRateLimit | OK — pesquisa pública |
| `POST /api/pesquisas/tokens/:token/abrir` | Nenhuma | OK — token é a auth |
| `GET /pesquisa` / `/pesquisa/:token` | publicRateLimit | OK — frontend de pesquisa |
| `POST /api/pesquisas/resposta-token` | Nenhuma | OK — token é a auth |
| `POST /api/public/reclamacoes` | publicRateLimit | OK — canal público |
| `GET /api/public/empresas` | publicRateLimit | ⚠️ Expõe lista de empresas |
| `GET /api/public/pesquisas-ativas` | publicRateLimit | Aceitável |
| `POST /api/pesquisas/resposta-portal` | Nenhuma | OK — portal público |
| `GET /api/public/protocolo/:protocolo` | publicRateLimit | OK — consulta por protocolo |
| `POST /api/public/protocolo/consultar` | publicRateLimit | OK |
| `GET /api/public/whatsapp` | publicRateLimit | Webhook WhatsApp |
| `POST /api/public/whatsapp/webhook` | Nenhuma | ⚠️ Sem validação de assinatura |
| `GET /api/public/whatsapp/webhook` | Nenhuma | OK — verificação de webhook |
| `POST /api/public/solicitar-acesso` | Nenhuma | OK — solicitação pública |
| `GET /api/pesquisa/:token` | publicRateLimit | OK |
| `POST /api/pesquisas/resposta/:token` | publicRateLimit | OK |
| `POST /api/bootstrap` | Nenhuma | ⚠️ Inicialização — verificar proteção |

---

## 4. ⚠️ CRÍTICO: Rotas sem Autenticação que deveriam ter

| Rota | Problema |
|---|---|
| `GET /api/matriz-conhecimento` | Sem `requerPerfil` nem `requerPermissao` |
| `GET /api/matriz-conhecimento/:id` | Sem autenticação |
| `POST /api/matriz-conhecimento` | Escrita sem autenticação |
| `PUT /api/matriz-conhecimento/:id` | Escrita sem autenticação |
| `POST /api/matriz-conhecimento/:id/status` | Escrita sem autenticação |
| `POST /api/matriz-conhecimento/:id/itens` | Escrita sem autenticação |
| `DELETE /api/matriz-conhecimento/:id/itens/:itemId` | Deleção sem autenticação |
| `POST /api/matriz-conhecimento/:id/evidencias` | Escrita sem autenticação |
| `DELETE /api/matriz-conhecimento/:id/evidencias/:evId` | Deleção sem autenticação |
| `POST /api/matriz-conhecimento/:id/excecoes` | Escrita sem autenticação |
| `DELETE /api/matriz-conhecimento/:id/excecoes/:exId` | Deleção sem autenticação |
| `POST /api/matriz-conhecimento/resolver` | Escrita sem autenticação |

**Impacto**: Qualquer cliente HTTP pode ler, criar, editar e deletar a matriz de conhecimento sem se autenticar.

---

## 5. Rotas com Auth Parcial

| Rota | Situação |
|---|---|
| `GET /api/usuarios` | Tem handler especial (linha 7169) — verificar lógica interna |
| `GET /api/auth/me` | Verifica sessão internamente |
| `POST /api/auth/refresh` | Verifica token internamente |
| `GET /api/meu-perfil` | Verifica sessão internamente |
| `PATCH /api/meu-perfil` | Verifica sessão internamente |

---

## 6. Controle de Escopo por Empresa

`middlewareEscopoEmpresa()` aplicado em:
- `GET /api/manifestacoes`
- `GET /api/manifestacoes/:id`
- `PATCH /api/manifestacoes/:id`
- `POST /api/manifestacoes/:id/decisao`
- `GET /api/manifestacoes/:id/aprovacao`
- `GET /api/manifestacoes/:id/tratativa`
- `GET /api/manifestacoes/:id/devolutivas`
- `GET /api/manifestacoes/:id/tratativa-completa`
- `POST /api/manifestacoes/:id/encaminhamentos`
- `PUT /api/manifestacoes/:id/impacto-financeiro`
- `POST /api/manifestacoes/:id/execucao`
- `POST /api/manifestacoes/:id/validacao-sac`
- `POST /api/manifestacoes/:id/finalizar`
- `GET /api/manifestacoes/:id/historico`
- `GET /api/manifestacoes/:id/circa`
- `PATCH /api/manifestacoes/:id/circa-dados`
- `POST /api/manifestacoes/:id/transicao-circa`
- `GET /api/manifestacoes/:id/acionamentos`
- `POST /api/manifestacoes/:id/acionamentos`
- `PATCH /api/manifestacoes/:id/acionamentos/:acionamentoId`
- `GET /api/manifestacoes/:id/analise`
- `GET /api/manifestacoes/:id/sugestoes`
- E muitas outras

---

## 7. Permissões Granulares (além de perfil)

O sistema suporta permissões individuais por recurso/ação:

| Permissão | Aplicada em |
|---|---|
| `manifestacoes.visualizar` | GET de manifestações |
| `manifestacoes.editar` | PATCH de manifestações |
| `manifestacoes.abrir` | POST de manifestações |
| `manifestacoes.encaminhar` | POST encaminhamentos |
| `manifestacoes.aprovar` | POST decisão |
| `aprovacoes.visualizar` | GET fila de aprovação |
| `aprovacoes.aprovar` | POST fila de aprovação |
| `pesquisas.visualizar` | GET pesquisas |
| `pesquisas.criar` | POST respostas |
| `pesquisas.editar` | PATCH pesquisas |
| `pesquisas.gerenciar` | DELETE pesquisas |
| `usuarios.criar` | POST usuários |
| `usuarios.editar` | PATCH usuários |
| `usuarios.gerenciar` | DELETE/bloquear usuários |
| `base-conhecimento.visualizar` | GET cérebro/causas |
| `dashboard.visualizar` | GET dashboard |

---

## 8. Gestão de Sessão

- **Tipo**: JWT-like com SESSION_SECRET
- **TTL**: 8 horas (`SESSION_TTL_MS = 8 * 60 * 60 * 1000`)
- **Armazenamento**: In-memory no servidor (`req.session` ou similar)
- **Risco**: Sessões não persistem entre restarts do servidor se `SESSION_SECRET` for aleatório (sem variável definida)
- **Senha**: bcrypt para hash

---

## 9. Avaliação Global de Segurança de Acesso

| Item | Status |
|---|---|
| Autenticação implementada | ✅ |
| Perfis de acesso definidos | ✅ |
| Permissões granulares | ✅ |
| Isolamento por empresa | ✅ |
| Rotas sensíveis sem auth | ❌ `/api/matriz-conhecimento` (12 rotas) |
| Rate limiting público | ✅ `publicRateLimit` |
| Hash de senha seguro | ✅ bcrypt |
| Token de reset de senha | ✅ |
| WhatsApp webhook sem validação | ⚠️ |
| Bootstrap endpoint aberto | ⚠️ Verificar proteção |
