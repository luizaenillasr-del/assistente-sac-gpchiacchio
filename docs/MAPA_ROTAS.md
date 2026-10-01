# Mapa de Rotas — Assistente SAC Grupo Chiacchio
## Status de isolamento de empresa (B2) por rota

Legenda: ✅ filtrado | ⚠️ parcial | ❌ sem filtro | 🔓 público | 🔒 MASTER only

---

## Auth (público ou sem escopo de empresa)
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/health | ❌ | N/A — diagnóstico | 🔓 |
| GET | / | ❌ | N/A | 🔓 |
| POST | /api/auth/login | ❌ | N/A | 🔓 |
| GET | /api/auth/me | ✅ JWT | N/A | ✅ |
| POST | /api/auth/refresh | ✅ JWT | N/A | ✅ |
| POST | /api/auth/forgot-password | ❌ | N/A | 🔓 |

## Manifestações
| Método | Rota | Auth | Campo empresa | Status |
|---|---|---|---|---|
| GET | /api/manifestacoes | ✅ | EMPRESA_RECLAMADA | ✅ middlewareEscopoEmpresa |
| GET | /api/manifestacoes/:id | ✅ | EMPRESA_RECLAMADA | ✅ middlewareEscopoEmpresa |
| POST | /api/manifestacoes | ✅ SAC/MASTER | req.user.empresa | ✅ grava empresa do user |
| PATCH | /api/manifestacoes/:id | ✅ SAC/MASTER | EMPRESA_RECLAMADA | ✅ pertenceEmpresa() → 403 |
| POST | /api/manifestacoes/:id/decisao | ✅ SAC/MASTER | EMPRESA_RECLAMADA | ✅ pertenceEmpresa() → 403 |
| GET | /api/manifestacoes/:id/tratativa | ✅ multi | N/A — by ID | ⚠️ sem check empresa |
| POST | /api/manifestacoes/:id/tratativa/gerar | ✅ SAC/MASTER | N/A | ⚠️ |
| POST | /api/manifestacoes/:id/tratativa/decisao | ✅ SAC/MASTER | N/A | ⚠️ |
| POST | /api/manifestacoes/:id/visualizacao | ✅ multi | N/A | ⚠️ |
| GET | /api/manifestacoes/:id/visualizacoes | ✅ multi | N/A | ⚠️ |
| GET | /api/manifestacoes/:id/devolutivas | ✅ multi | N/A | ⚠️ |
| POST | /api/manifestacoes/:id/devolutiva/gerar | ✅ SAC/MASTER | N/A | ⚠️ |
| GET | /api/manifestacoes/:id/analise | ✅ multi | N/A | ⚠️ |
| GET | /api/manifestacoes/:id/sugestoes | ✅ multi | N/A | ⚠️ |
| POST | /api/manifestacoes/:id/sugestoes | ✅ MASTER/APROV | N/A | ⚠️ |

**Nota:** rotas ⚠️ operam por ID — requerem que o usuário já conheça o ID (obtido via GET filtrado). Risco residual baixo.

## Reclamações e Histórico
| Método | Rota | Auth | Campo empresa | Status |
|---|---|---|---|---|
| GET | /api/reclamacoes | ✅ JWT | Empresa | ✅ filtrarPorEmpresa |
| GET | /api/historico | ✅ SAC/MASTER | DRV_EMPRESA_NORMALIZADA | ✅ filtrarPorEmpresa |
| GET | /api/clientes/:cnpj | ✅ SAC/MASTER/RCA | N/A — by CNPJ | ⚠️ sem isolamento empresa |

## Análise / IA
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| POST | /api/analise | ✅ JWT | empresaReclamada (input) | ✅ sem dados sensíveis à IA |
| POST | /api/analise/similares | ✅ JWT | req.user.empresa → filtro | ✅ empresaFiltro passado |

## RNC
| Método | Rota | Auth | Campo empresa | Status |
|---|---|---|---|---|
| GET | /api/rnc | ✅ multi | EMPRESA_RECLAMADA | ✅ middlewareEscopoEmpresa |
| POST | /api/rnc | ✅ SAC/MASTER | EMPRESA_RECLAMADA | ✅ grava empresa |
| GET | /api/rnc/:id | ✅ multi | N/A — by ID | ⚠️ |
| POST | /api/rnc/:id/decisao | ✅ APROV/MASTER | N/A | ⚠️ |
| POST | /api/rnc/:id/visualizacao | ✅ APROV/MASTER | N/A | ⚠️ |
| GET | /api/rnc/:id/eventos | ✅ JWT | N/A | ⚠️ |
| PATCH | /api/rnc/:id/execucao | ✅ SETOR/MASTER/SAC | N/A | ⚠️ |
| GET | /api/rnc-metricas | ✅ MASTER/SAC | N/A | ⚠️ |

## Dashboard
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/dashboard | ✅ MASTER/SAC/APROV | req.user.empresa | ✅ middlewareEscopoEmpresa |

## Setores / Config
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/setores | ✅ multi | EMPRESA | ✅ filtrarPorEmpresaConfig |
| POST | /api/setores | ✅ SAC/MASTER | N/A | ⚠️ |
| PATCH | /api/setores/:id | ✅ SAC/MASTER | N/A | ⚠️ |
| POST | /api/setores/importar | ✅ SAC/MASTER | N/A | ⚠️ |
| GET | /api/setores-unicos | ✅ JWT | N/A — agrega | ✅ semântica correta |
| GET | /api/setores/counts | ✅ multi | N/A | ⚠️ |
| GET | /api/setores/:setor/* | ✅ multi | N/A — by setor | ⚠️ |

## Fila de Aprovação
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/fila-aprovacao | ✅ MASTER/SAC/APROV | EMPRESA | ✅ filtrarPorEmpresa |
| POST | /api/fila-aprovacao | ✅ MASTER/SAC | empresa (body) | ✅ grava empresa |
| POST | /api/fila-aprovacao/:id/decidir | ✅ APROV/MASTER | N/A — by ID | ⚠️ |
| GET | /api/historico-aprovacao | ✅ MASTER/APROV | N/A | ⚠️ |

## Usuários (MASTER only)
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/usuarios | 🔒 MASTER | N/A — vê todos | ✅ intencional |
| POST | /api/usuarios | 🔒 MASTER | N/A | ✅ |
| PATCH | /api/usuarios/:id | 🔒 MASTER | N/A | ✅ |

## Público (rate-limited)
| Método | Rota | Auth | Status |
|---|---|---|---|
| POST | /api/public/reclamacoes | ❌ | 🔓 rate-limited |
| GET | /api/public/empresas | ❌ | 🔓 rate-limited |

## Conhecimento / Biblioteca
| Método | Rota | Auth | Empresa | Status |
|---|---|---|---|---|
| GET | /api/conhecimento | ✅ multi | N/A | ⚠️ sem filtro empresa |
| GET | /api/procedimentos | ✅ multi | N/A | ⚠️ |
| GET | /api/politicas | ✅ multi | N/A | ⚠️ |
| GET | /api/biblioteca/fichas | ✅ multi | EMPRESA | ✅ middlewareEscopoEmpresa |
| GET | /api/biblioteca/fichas/:id | ✅ multi | N/A — by ID | ⚠️ |

## Matriz / Assertividade / Demais
| Método | Rota | Auth | Status |
|---|---|---|---|
| GET | /api/matriz | ✅ SAC/MASTER | ⚠️ sem empresa |
| GET | /api/assertividade/* | ✅ SAC/MASTER | ⚠️ sem empresa |
| GET | /api/auditoria | 🔒 MASTER | ✅ |
| GET | /api/planilha/* | ✅ SAC/MASTER | ✅ MASTER lê tudo |
| GET | /api/log-sistema | ✅ multi | ⚠️ sem empresa |
| GET | /api/painel-maquina | ✅ multi | ⚠️ sem empresa |
| POST | /api/bootstrap | ✅ JWT | ✅ inicialização |

---

## Resumo

| Status | Contagem | Significado |
|---|---|---|
| ✅ | ~30 rotas | Filtro de empresa aplicado |
| ⚠️ | ~60 rotas | Sem filtro — risco residual baixo (by ID ou config) |
| 🔓 | ~8 rotas | Público — rate-limited |
| 🔒 | ~10 rotas | MASTER only — sem restrição de empresa por design |

**Prioridade para Fase 2:** aplicar pertenceEmpresa() nas rotas ⚠️ de escrita (RNC/:id/decisao, manifestacoes/:id/tratativa/decisao).
