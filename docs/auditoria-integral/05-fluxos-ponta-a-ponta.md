# 05 — Fluxos Ponta a Ponta
**Data:** 2026-11-03

---

## 1. Fluxo: Nova Manifestação

### Atores
- **Abertura**: ATENDENTE SAC, ANALISTA SAC, MASTER, RCA/REPRESENTANTE, canal público
- **Triagem**: ANALISTA SAC, GESTOR SAC

### Passos

```
1. Cliente ou atendente acessa formulário de 7 etapas
2. Preenche etapas 1-7 (rascunho salvo progressivamente)
3. POST /api/manifestacoes → cria com STATUS=RASCUNHO
   - Gera protocolo atômico único (protocoloAtomico.js)
   - Persiste em MANIFESTACOES (Sheets)
4. Ao finalizar etapa 7 → STATUS muda para REGISTRADA
5. ANALISTA SAC recebe notificação (GET /api/notificacoes/analista)
6. POST /api/analise → IA analisa e sugere: setor, tipo, tratativa, devolutiva
7. ANALISTA SAC revisa e confirma triagem (PATCH /api/manifestacoes/:id)
   → STATUS → EM_TRIAGEM
```

**Validações**:
- Idempotency key previne duplicidade de protocolo
- `DESCRICAO_ORIGINAL` preservada e nunca sobrescrita após criação
- Triagem não cria nova manifestação a partir de rascunho automaticamente

**Cobertura de testes**: `nova-manifestacao-v4.js`, `nova-manifestacao-correcao.js`, `fase1-operacional.js` (todos ✅)

---

## 2. Fluxo: Complementações CIRCA (Etapa 2)

### Atores
- **Complementação**: ANALISTA SAC, SETOR RESPONSÁVEL, ESPECIALISTA
- **Confirmação**: Sistema (automático)

### Passos

```
1. Manifestação em STATUS=EM_TRIAGEM
2. GET /api/manifestacoes/:id/circa → carrega estado CIRCA atual
3. ANALISTA preenche complementações na UI (Etapa 2 CIRCA)
4. PATCH /api/manifestacoes/:id/circa-dados
   - Valida campos por etapa2Validacao.js
   - Chama atualizarPorID('MANIFESTACOES', id, { ANALISE_IA: JSON })
   - Confirma via atualizacao.headers/valores (sem read-after-write)
   - Retorna HTTP 200 com complementações confirmadas
5. Campo ANALISE_IA.complementacoes atualizado em Sheets
   → cada campo tem: campo, status, valor, unidade, atualizadoPor, atualizadoEm
```

**Controle de concorrência**:
- `ultimaEdicaoConhecida` enviada pelo cliente
- Se campo foi editado por outro usuário → HTTP 409 Conflict

**Cobertura de testes**: `circa-confirmacao-complementacoes.js` (8 testes ✅), `circa-nova-manifestacao.js` ✅

---

## 3. Fluxo: Investigação e Tratativa

### Atores
- **Condução**: ANALISTA SAC, SETOR RESPONSÁVEL
- **Investigação**: SETOR RESPONSÁVEL, ESPECIALISTA

### Passos

```
1. STATUS=EM_INVESTIGACAO
2. POST /api/manifestacoes/:id/encaminhamentos → encaminha ao setor
3. SETOR preenche: o_que, causa, resolução, ação preventiva, responsável, prazo
   (PATCH /api/manifestacoes/:id com campos RESP_SETOR_*)
4. POST /api/manifestacoes/:id/tratativa/gerar → gera sugestão de tratativa
5. POST /api/manifestacoes/:id/tratativa/decisao → APROVADOR decide
6. POST /api/manifestacoes/:id/execucao → marca execução realizada
   → STATUS → EM_TRATATIVA → AGUARDANDO_VALIDACAO_SAC
```

**Cobertura de testes**: `behavior.js` (78 testes ✅)

---

## 4. Fluxo: Validação SAC

### Atores
- **Validação**: ANALISTA SAC, GESTOR SAC, APROVADOR

### Passos

```
1. STATUS=AGUARDANDO_VALIDACAO_SAC
2. POST /api/manifestacoes/:id/validacao-sac
   - Verifica: cliente informado, resolvida, data retorno
   - VALIDACAO_RESULTADO = 'APROVADA' | 'REPROVADA'
3. Se aprovada → STATUS → AGUARDANDO_DEVOLUTIVA
4. Se reprovada → STATUS → DEVOLVIDA_PARA_COMPLEMENTACAO
```

---

## 5. Fluxo: Devolutiva

### Atores
- **Geração**: ANALISTA SAC, GESTOR SAC
- **Aprovação**: APROVADOR, APROVADOR MASTER
- **Envio**: ANALISTA SAC

### Passos

```
1. STATUS=AGUARDANDO_DEVOLUTIVA
2. POST /api/manifestacoes/:id/devolutiva/gerar → gera texto sugerido via IA
3. ANALISTA revisa e edita texto
4. POST /api/manifestacoes/:id/devolutiva/aprovar → APROVADOR aprova
5. POST /api/manifestacoes/:id/devolutiva/enviar
   - Envia por e-mail (Resend) ou canal configurado
   - Marca DEVOLUTIVA_ENVIADA = true
   → STATUS → AGUARDANDO_ENCERRAMENTO
```

**Isolamento portal**: Devolutiva só aparece no portal após encerramento — testado em `portal-isolamento.js` ✅

---

## 6. Fluxo: Encerramento

### Atores
- **Encerramento**: ANALISTA SAC, APROVADOR

### Passos

```
1. STATUS=AGUARDANDO_ENCERRAMENTO
2. POST /api/manifestacoes/:id/finalizar
   - Verifica todas as etapas concluídas
   - Grava aprendizado na base (APRENDIZADO_CASO, APRENDIZADO_MATRIZ)
   - → STATUS → FINALIZADA
3. Devolutiva liberada no portal do cliente
4. Ficha gerada na biblioteca (/api/biblioteca/fichas)
```

---

## 7. Fluxo: Pesquisa de Satisfação

### Passos

```
1. Após encerramento, sistema/analista gera token de pesquisa
   POST /api/pesquisas/tokens/gerar
2. Token enviado ao cliente por e-mail (ou link no portal)
3. Cliente acessa /pesquisa/:token ou /api/pesquisa/:token
4. POST /api/pesquisas/resposta-token → resposta registrada
   - Rate limit: publicRateLimit
5. Analista visualiza via GET /api/pesquisas/relatorio
6. Ocorrências de notas críticas (≤6) viram notificações
```

**Cobertura de testes**: `pesquisas.js` (22 testes ✅)

---

## 8. Fluxo: Portal do Cliente

### Passos

```
1. Cliente acessa /portal
2. Informa protocolo ou CPF/CNPJ
3. GET /api/public/protocolo/:protocolo → consulta histórico
   - Somente informações liberadas para exibição
   - Devolutiva somente após STATUS=FINALIZADA
4. Cliente pode responder pesquisa se token disponível
```

**Cobertura de testes**: `portal-isolamento.js` (11 testes ✅)

---

## 9. Fluxo: Reclamação Pública (Canal Online)

```
1. Cliente acessa formulário público
2. POST /api/public/reclamacoes (com publicRateLimit)
   - Valida campos obrigatórios
   - Cria manifestação com ORIGEM='PORTAL_PUBLICO'
   - Gera protocolo atômico
3. Retorna número de protocolo ao cliente
4. E-mail de confirmação enviado (se Resend configurado)
5. Manifestação entra no fluxo normal a partir do STATUS=REGISTRADA
```

---

## 10. Status e Transições

```
RASCUNHO
  → REGISTRADA (ao finalizar etapa 7)
    → EM_TRIAGEM (após triagem SAC)
      → EM_INVESTIGACAO (após encaminhamento)
        → AGUARDANDO_INFORMACOES (se setor pede mais dados)
        → EM_TRATATIVA (após execução)
          → AGUARDANDO_VALIDACAO_SAC
            → DEVOLVIDA_PARA_COMPLEMENTACAO (se reprovada)
            → AGUARDANDO_DEVOLUTIVA (se aprovada)
              → AGUARDANDO_ENCERRAMENTO (após envio)
                → FINALIZADA
CANCELADA (qualquer status → MASTER)
REABERTA (FINALIZADA → MASTER)
```

**Aliases de status** suportados (compatibilidade legada):
- `ABERTA` → `REGISTRADA`
- `NOVA` → `REGISTRADA`
- `EM TRATAMENTO` → `EM_TRATATIVA`
- `ENCERRADA` → `FINALIZADA`
- etc.
