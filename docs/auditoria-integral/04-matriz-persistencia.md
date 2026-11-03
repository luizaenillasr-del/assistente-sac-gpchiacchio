# 04 — Matriz de Persistência de Dados
**Data:** 2026-11-03

---

## 1. Arquitetura de Persistência

O sistema usa **duas camadas de persistência em paralelo**:

1. **Google Sheets** — banco primário para manifestações e dados operacionais
2. **PostgreSQL (Neon)** — banco relacional para dados estruturados, usuários, SLA

Essa arquitetura dual cria **risco de divergência**: uma operação pode ser gravada em Sheets mas falhar no PG (ou vice-versa), deixando dados inconsistentes entre as camadas.

---

## 2. Google Sheets — Abas Utilizadas

Identificadas via `garantirAbaComCabecalhos` e `lerAba` em `api/index.js`:

| Aba | Dados | TTL Cache |
|---|---|---|
| `MANIFESTACOES` | Todas as manifestações com ~100 campos | 0 (sem cache) |
| `USUARIOS` | Usuários do sistema | 0 (sem cache) |
| `PERMISSOES_USUARIO` | Permissões individuais | 0 (sem cache) |
| `CONTADORES_PROTOCOLO` | Contadores atômicos de protocolo | 0 (sem cache) |
| `CONFIG_SETORES` | Configuração operacional de setores | 60s |
| `SLA_ESCALONAMENTO` | Regras de SLA | 60s |
| `HISTORICO_VALIDACOES` | Histórico de validações | 60s |
| `BANCO_HISTORICO` | Banco de casos históricos | 60s (com lock TTL 60s) |
| `PESQUISAS` | Respostas de pesquisas (se PESQUISA_SPREADSHEET_ID) | 60s |
| Outras abas de cadastro | FAQ, regras, procedimentos, políticas | 60s |

### 2.1 Funções Sheets

| Função | Comportamento |
|---|---|
| `lerAba(nome, maxRows)` | Lê aba com cache de 60s; TTL=0 para abas críticas |
| `appendObjeto(nome, dados)` | Insere nova linha |
| `atualizarPorID(nome, id, dados)` | Atualiza linha por ID; retorna `{rowIndex, headers, valores}` |
| `invalidarCacheAba(nome)` | Limpa cache de uma aba |
| `garantirAbaComCabecalhos(nome, cols)` | Cria aba se não existir, garante cabeçalhos |
| `_sheetsMock` | Mock em memória, ativado por `SHEETS_MOCK_PATH` |

### 2.2 Cache em Memória

```
const _lerAbaCache = new Map();
const LER_ABA_TTL_MS = 60_000; // 60s para abas normais
const TTL_POR_ABA = { MANIFESTACOES: 0, USUARIOS: 0, PERMISSOES_USUARIO: 0, CONTADORES_PROTOCOLO: 0 }
```

**Risco**: Cache de 60s pode servir dados desatualizados. Não há invalidação em operações de escrita para abas com TTL>0.

---

## 3. PostgreSQL (Prisma) — Modelos

| Modelo | Tabela | Dados |
|---|---|---|
| `Empresa` | `empresas` | Empresas do grupo |
| `Setor` | `setores` | Setores por empresa |
| `Perfil` | `perfis` | Perfis de acesso canônicos |
| `Usuario` | `usuarios` | Usuários, credenciais, perfil |
| `Manifestacao` | `manifestacoes` | Cópia/espelho de manifestações |
| `Rnc` | `rncs` | Registros de não-conformidade |
| `Politica` | `politicas` | Políticas normativas |
| `Procedimento` | `procedimentos` | Procedimentos operacionais |
| `Regra` | `regras` | Regras de negócio |
| `SlaConfig` | `sla_configs` | Configurações de SLA |
| `MatrizTratamento` | `matriz_tratamentos` | Matriz de tratamentos |
| `Documento` | `documentos` | Documentos relacionados |
| `Produto` | `produtos` | Catálogo de produtos |
| `BaseConhecimento` | (setores) | Base de conhecimento setorial |
| `Responsavel` | `responsaveis` | Responsáveis por setor |

### 3.1 Padrão de Leitura Dual (F12)

Em várias rotas, o sistema tenta PostgreSQL primeiro, com fallback para Sheets:

```js
// Padrão típico F12:
if (conhecimentoRepo) {
  try {
    const data = await conhecimentoRepo.find(...);
    if (data) return res.json({ ..., fonte: 'postgresql' });
  } catch (e) { console.warn('[F12] rota PG falhou:', e.message); }
}
// Fallback para Sheets:
const data = await lerAba('NOME_ABA', ...).catch(() => []);
res.json({ ..., fonte: 'sheets' });
```

**Problema**: Se PG está offline, todas as leituras caem para Sheets silenciosamente. Usuário não sabe de qual fonte veio o dado.

---

## 4. Campo `ANALISE_IA` (núcleo do CIRCA)

Campo JSON armazenado em Sheets `MANIFESTACOES.ANALISE_IA`:

```json
{
  "complementacoes": {
    "campo_x": {
      "campo": "campo_x",
      "status": "confirmado",
      "valor": "...",
      "unidade": "...",
      "atualizadoPor": "usuario@email.com",
      "atualizadoEm": "2026-11-03T..."
    }
  },
  "hipoteses": [...],
  "resultado": "..."
}
```

**Confirmação de escrita** (corrigida em PR #482):
- Usa `atualizacao.headers` + `atualizacao.valores` (bytes escritos)
- Elimina dependência de read-after-write com latência do Sheets
- Testado em `circa-confirmacao-complementacoes.js` (8 testes ✅)

---

## 5. Protocolo Atômico

Implementado em `server-services/protocoloAtomico.js`:
- Usa lock distribuído via Sheets (`CONTADORES_PROTOCOLO`)
- Lock TTL de 60s para evitar dead-locks
- Testado em `tests/protocolo-atomico.js` ✅
- **Risco**: Em ambiente serverless (Vercel), múltiplas instâncias concorrentes podem colidir no lock se o Sheets tiver latência alta

---

## 6. In-Memory Cache de Sessão

```js
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 horas
```

- Sessões armazenadas em memória da instância
- Em ambiente serverless, cada cold start perde todas as sessões ativas
- Usuários são deslogados automaticamente quando a instância é reiniciada

---

## 7. Matriz de Risco de Persistência

| Risco | Impacto | Probabilidade | Mitigação |
|---|---|---|---|
| Divergência Sheets ↔ PG | Alto | Média | Sincronização periódica necessária |
| Cache 60s com dado desatualizado | Médio | Alta | Aceito para dados não-críticos |
| Lock de protocolo expirado prematuramente | Alto | Baixa | TTL 60s é conservador |
| Cold start invalida sessões | Médio | Alta em serverless | Usar JWT stateless ou store externo |
| Quota Google Sheets excedida | Alto | Baixa | Cache mitiga; sem failover definido |
| PG offline silencioso | Médio | Baixa atualmente | Log existe; sem alerta ativo |
| `PESQUISA_SPREADSHEET_ID` não configurada | Alto | Se em produção | Configurar variável obrigatória |
