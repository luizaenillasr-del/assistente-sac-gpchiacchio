# 06 — Auditoria CIRCA
**Data:** 2026-11-03

---

## 1. O que é o CIRCA

CIRCA (Captura, Investigação, Resolução, Condução e Aprendizado) é o workflow operacional central do sistema. Define as 7 etapas de tratamento de uma manifestação e controla as transições entre elas.

---

## 2. Arquitetura

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| `circaWorkflow.js` | `server-services/circaWorkflow.js` | Definição das etapas, status, aliases, transições |
| `circaEngine.js` | `server-services/circaEngine.js` | Motor de análise e complementações |
| `etapa2Validacao.js` | `server-services/etapa2Validacao.js` | Validações específicas da etapa 2 |
| Endpoints CIRCA | `api/index.js:7775-8200` | Rotas: GET circa, PATCH circa-dados, POST transicao |

---

## 3. Etapas e Status

### 3.1 Etapas CIRCA
```js
STAGES = [
  { id: 'registro',      label: 'Registro' },
  { id: 'analise',       label: 'Análise inteligente e triagem' },
  { id: 'conducao',      label: 'Condução' },
  { id: 'investigacao',  label: 'Investigação e resolução' },
  { id: 'validacao',     label: 'Validação SAC' },
  { id: 'devolutiva',    label: 'Devolutiva conclusiva' },
  { id: 'encerramento',  label: 'Encerramento e aprendizado' },
]
```

### 3.2 Status Canônicos
```
RASCUNHO, REGISTRADA, EM_TRIAGEM, EM_INVESTIGACAO,
AGUARDANDO_INFORMACOES, EM_TRATATIVA, AGUARDANDO_VALIDACAO_SAC,
DEVOLVIDA_PARA_COMPLEMENTACAO, AGUARDANDO_DEVOLUTIVA,
AGUARDANDO_ENCERRAMENTO, FINALIZADA, REABERTA, CANCELADA
```

### 3.3 Mapeamento Status → Etapa
`circaWorkflow.stageForStatus(status)` retorna o índice (1-7) da etapa correspondente ao status.

---

## 4. Complementações (Etapa 2) — Análise Detalhada

### 4.1 Estrutura de Dados
Armazenado em `MANIFESTACOES.ANALISE_IA` (JSON):

```json
{
  "complementacoes": {
    "QUANTIDADE": {
      "campo": "QUANTIDADE",
      "status": "confirmado",
      "valor": "500",
      "unidade": "kg",
      "atualizadoPor": "analista@chiacchio.com.br",
      "atualizadoEm": "2026-11-03T10:00:00.000Z"
    }
  },
  "hipoteses": ["hipotese1", "hipotese2"],
  "resultado": "NECESSITA_INVESTIGACAO"
}
```

### 4.2 Endpoint PATCH `/api/manifestacoes/:id/circa-dados`
- **Linha**: `api/index.js:7835`
- **Autorização**: `requerPermissao('manifestacoes.editar')` + `middlewareEscopoEmpresa()`
- **Campos permitidos** na whitelist `allowed` (linha 7849):
  - STATUS, STATUS_FICHA, campos de descrição, investigação, validação, devolutiva, aprendizado, ANALISE_IA, etc.
  - `CHECKLIST_CIRCA`, `PENDENCIAS_VALIDACAO_HUMANA` incluídos

### 4.3 Controle de Concorrência
```js
if (ultimaEdicaoConhecida && row.DATA_ULTIMA_EDICAO !== ultimaEdicaoConhecida) {
  throw HTTP 409 Conflict
}
```

### 4.4 Confirmação de Escrita (Corrigida em PR #482)
**Antes** (problemático):
```js
// Lia de volta do Sheets 3× com 150ms entre tentativas (450ms total)
// Sheets pode não ter propagado a escrita → ANALISE_IA retornava vazia
// → throw 'gravação não confirmada' → HTTP 500
```

**Depois** (correto):
```js
// Usa atualizacao.headers + atualizacao.valores (bytes efetivamente escritos)
const idxAnalise = atualizacao.headers.indexOf('ANALISE_IA');
const analiseEscrita = atualizacao.valores[idxAnalise];
const metaConfirmada = JSON.parse(analiseEscrita || '{}');
// Confirma cada campo esperado na resposta
const confirmado = Object.entries(complementacoesEsperadas).every(([campo, esperado]) => { ... });
if (!confirmado) throw new Error('A gravação das complementações não foi confirmada...');
```

---

## 5. Hipóteses Múltiplas

- CIRCA suporta múltiplas hipóteses por manifestação
- Contrato PLASCHIO (empresa legada): hipóteses com campo específico
- Testado em `circa-nova-manifestacao.js`: hipóteses múltiplas, regras inválidas, isolamento de reincidência ✅
- `circa-producao-regressao.js`: contrato legado PLASCHIO, duas hipóteses, estado de timeout sem falso resultado ✅

---

## 6. Aprendizado e Contrato

- `circa-learning-contract.js`: `CEREBRO_APRENDIZADO` reconhecido sem inventar status ✅
- `circa-knowledge.js`: matriz legada, modelos aprovados, hipóteses históricas, deduplicação ✅
  - **Aviso**: `Fallback Sheets para conhecimento: Cannot read properties of null (reading 'politica')` — PG retorna politica=null

---

## 7. Integração com IA

- Chamada à IA em `POST /api/analise`
- `aiService.js` (145 linhas): abstração sobre OpenAI/Anthropic
- Geração de hipóteses, sugestão de setor/tratativa/devolutiva
- **Controle**: A sugestão da IA nunca é enviada automaticamente — requer aprovação explícita do usuário
- Testado em `circa-integration.js` ✅

---

## 8. Autonomia Bloqueada

`circa.js` testa: "bloqueio de autonomia" ✅
- Sistema não pode finalizar manifestação sem validação humana
- Complementações não se tornam operacionais sem confirmação
- Rascunhos não são convertidos automaticamente

---

## 9. Acionamentos (Setoriais)

- `GET/POST /api/manifestacoes/:id/acionamentos`
- `PATCH /api/manifestacoes/:id/acionamentos/:acionamentoId`
- Registro de cada acionamento ao setor responsável com escopo e prazo

---

## 10. Análise de Qualidade do CIRCA

| Aspecto | Status |
|---|---|
| 7 etapas implementadas | ✅ |
| Transições de status | ✅ |
| Aliases de status legados | ✅ |
| Complementações com auditoria | ✅ |
| Controle de concorrência (409) | ✅ |
| Confirmação de escrita sem read-after-write | ✅ (PR #482) |
| Bloqueio de autonomia da IA | ✅ |
| Isolamento por empresa | ✅ |
| Histórico de modificações | ✅ |
| Aprendizado e base de conhecimento | ✅ |
| Múltiplas hipóteses | ✅ |
| Contrato legado PLASCHIO | ✅ |
| PG offline cai silenciosamente para Sheets | ⚠️ (ver doc 04) |
| Fallback politica=null em testes | ⚠️ (aviso não-bloqueante) |
