# 07 — Auditoria de SLAs
**Data:** 2026-11-03

---

## 1. Definição de SLA no Sistema

O SLA (Service Level Agreement) é o prazo máximo para resolução de uma manifestação, medido em horas, a partir da data de abertura.

---

## 2. Implementação Atual

### 2.1 Campos de SLA

Na aba `MANIFESTACOES` (Sheets):
- `SLA_HORAS` — horas máximas para resolução (numérico)
- `DATA_ABERTURA` — data/hora de abertura da manifestação
- `DATA_CONCLUSAO_MANIFESTACAO` — data de conclusão

### 2.2 Cálculo de SLA

Identificado no código (`api/index.js:2906-2920`):

```js
// Calcular SLA restante
// Se abertura é null (data desconhecida), adotar postura conservadora: SLA vencido
// SLA vencido há Xh | SLA restante Xh
```

Lógica: calcula a diferença entre `DATA_ABERTURA` e agora; compara com `SLA_HORAS`.

### 2.3 Configuração de SLA por Produto

A aba `CONFIG_SETORES` tem campo `SLA_HORAS` por setor.

Produtos têm campos:
```
TEMPO_MEDIO_DIAS, TEMPO_MIN_DIAS, TEMPO_MAX_DIAS, TIPO_DIA (CORRIDOS|ÚTEIS)
```

A calculadora de prazos (`/api/calculadora/prazos-regionais`) permite configurar prazos regionais específicos.

### 2.4 Fonte Autoritativa

`GET /api/sla` (linha 6813):
- Tenta PostgreSQL primeiro (`conhecimentoRepo.findSla`)
- Fallback para Sheets (`SLA_ESCALONAMENTO`)
- Requer perfil: MASTER, ANALISTA SAC, SETOR RESPONSÁVEL, APROVADOR

---

## 3. Monitoramento de SLA

### 3.1 Painel Máquina (`GET /api/painel-maquina`, linha 8615)

```js
const slaStatus = { ok: 0, alerta: 0, vencido: 0 };
// Para cada manifestação ativa:
if (elapsed >= slaH) slaStatus.vencido++;
else if (elapsed >= slaH * 0.75) slaStatus.alerta++;
```

- **OK**: < 75% do SLA consumido
- **Alerta**: ≥ 75% do SLA consumido
- **Vencido**: ≥ 100% do SLA consumido (prazo estourado)

### 3.2 Biblioteca de Fichas (linha 9742)

```js
// SLA: 'VENCIDO' ou 'OK'
// Se STATUS = 'CONCLUIDA', ignora SLA
// Calcula prazo = DATA_ABERTURA + SLA_HORAS
// Compara prazo com agora
```

### 3.3 Notificações de Analista (`GET /api/notificacoes/analista`, linha 6491)

As notificações incluem:
- `OCP_VENCIDA` — ocorrência vencida
- `OCP_PROXIMA_PRAZO` — ocorrência próxima do vencimento
- `OCP_ATRIBUIDA` — ocorrência atribuída

```js
const vencida = prazo && !isNaN(prazo) && prazo < new Date();
const proxima = prazo && !isNaN(prazo) && (prazo - new Date()) < 86400000; // 24h
```

---

## 4. O que Está Implementado

| Funcionalidade | Status |
|---|---|
| Campo `SLA_HORAS` na manifestação | ✅ |
| Cálculo de prazo restante | ✅ |
| Indicador OK/Alerta/Vencido | ✅ |
| Painel consolidado de SLA | ✅ |
| Configuração por setor | ✅ |
| Configuração por produto (dias/tipo) | ✅ |
| Calculadora de prazos regionais | ✅ |
| Notificação de analista (painel) | ✅ |
| Postura conservadora (data nula = vencido) | ✅ |

---

## 5. O que Está Ausente ou Incompleto

| Funcionalidade | Status | Severidade |
|---|---|---|
| Alertas automáticos por e-mail quando SLA vence | ❌ Não implementado | MÉDIA |
| Alertas automáticos 24h antes do vencimento | ❌ Não implementado | MÉDIA |
| Notificação push/webhook quando SLA entra em alerta | ❌ Não implementado | BAIXA |
| Relatório periódico de SLAs vencidos | ⚠️ Somente via painel, sem envio automático | BAIXA |
| Escalação automática quando SLA vence | ❌ Não implementado | MÉDIA |
| Registro de histórico de mudanças no SLA | ⚠️ Não identificado | BAIXA |

---

## 6. Risco Operacional

O sistema calcula e exibe o SLA corretamente, mas **não notifica automaticamente** quando o prazo está prestes a vencer ou já venceu. Os responsáveis precisam verificar ativamente o painel para identificar SLAs em risco.

**Impacto**: Manifestações podem vencer o SLA sem que nenhum responsável seja alertado proativamente, dependendo da frequência com que verificam o painel.

---

## 7. Configuração de SLA por Empresa

- Cada empresa (`CHIACCHIO`, `PLASCHIO`, `TUBAHIA`) pode ter SLAs diferentes
- `middlewareEscopoEmpresa()` garante isolamento entre empresas
- `SlaConfig` no modelo Prisma permite configuração por empresa + setor
